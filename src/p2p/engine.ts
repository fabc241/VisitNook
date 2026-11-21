// Talks to the P2P worklet (p2p/worker.js, packed into p2p/build). The worklet
// is started the first time something needs it and then stays up; Hyperswarm
// itself only runs between `startTest()` and `stopTest()`.
//
// Two kinds of messages go to the worklet: commands (fire and forget, the
// answers arrive as events) and requests (`request()`, one reply each).

import b4a from 'b4a';

import worker from '../../p2p/build';

export type PeerInfo = {
  publicKey: string;
  host: string | null;
  port: number | null;
  /** True for a private (local network) address, false for a public one. */
  sameNetwork: boolean | null;
  /** True when this phone dialled the other peer. */
  initiator: boolean;
  relayed: boolean;
};

/** Heartbeat counters for one connection; `silentMs` is the time since anything arrived. */
export type PeerStats = { publicKey: string; pingsIn: number; pingsOut: number; silentMs: number };

export type NetworkInfo = {
  ownKey: string;
  host: string | null;
  port: number | null;
  /** True while the network has not confirmed this phone can be reached directly. */
  firewalled: boolean;
  /** True behind a random NAT: a new port per connection, so two such peers cannot connect directly. */
  randomized: boolean;
  bootstrapped: boolean;
};

export type WorkerEvent =
  | { type: 'ready' }
  | { type: 'status'; state: 'joining' | 'listening' | 'stopped'; network: NetworkInfo | null }
  | { type: 'peer-joined'; peer: PeerInfo }
  | { type: 'peer-left'; publicKey: string }
  | { type: 'peer-stats'; peers: PeerStats[] }
  | { type: 'message'; from: string; text: string }
  | { type: 'sent'; text: string; to: number }
  | { type: 'log'; text: string }
  | { type: 'error'; text: string };

type Reply = { type: 'reply'; rid: number; ok: true; result: unknown } | { type: 'reply'; rid: number; ok: false; error: string };

/** Requests the worklet answers once each. Results are typed by the caller (src/p2p/shared.ts). */
export type Request =
  | { type: 'shared-open'; dir: string; coreName: string; encryptionKey: string | null }
  | { type: 'shared-close' }
  | { type: 'shared-put'; id: string; record: unknown }
  | { type: 'shared-del'; id: string }
  | { type: 'shared-list' }
  | { type: 'shared-check' };

const REQUEST_TIMEOUT_MS = 30_000;

type Command =
  | { type: 'start'; code: string }
  | { type: 'stop' }
  | { type: 'send'; text: string }
  | { type: 'refresh' };

type Ipc = Awaited<ReturnType<typeof worker.start>>['ipc'];

const listeners = new Set<(event: WorkerEvent) => void>();
let ipcPromise: Promise<Ipc> | null = null;
let nextRid = 1;
const pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();

function settle(reply: Reply): void {
  const waiting = pending.get(reply.rid);
  if (!waiting) return;
  pending.delete(reply.rid);
  if (reply.ok) waiting.resolve(reply.result);
  else waiting.reject(new Error(reply.error));
}

function emit(event: WorkerEvent): void {
  if (event.type === 'error' || event.type === 'log') console.log(`[p2p] ${event.type}: ${event.text}`);
  for (const listener of listeners) listener(event);
}

function connect(): Promise<Ipc> {
  ipcPromise ??= worker
    .start({ timeout: 30_000 })
    .then(({ ipc }) => {
      let buffered = '';
      ipc.on('data', (chunk) => {
        buffered += b4a.toString(chunk as Uint8Array);
        let newline: number;
        while ((newline = buffered.indexOf('\n')) !== -1) {
          const line = buffered.slice(0, newline);
          buffered = buffered.slice(newline + 1);
          try {
            const message = JSON.parse(line) as WorkerEvent | Reply;
            if (message.type === 'reply') settle(message);
            else emit(message);
          } catch {
            console.warn(`[p2p] unreadable message from the worker: ${line.slice(0, 200)}`);
          }
        }
      });
      ipc.on('close', () => {
        ipcPromise = null;
        for (const waiting of pending.values()) waiting.reject(new Error('The sharing worker stopped.'));
        pending.clear();
        emit({ type: 'status', state: 'stopped', network: null });
      });
      console.log('[p2p] worklet started');
      return ipc;
    })
    .catch((error: unknown) => {
      ipcPromise = null;
      throw error;
    });
  return ipcPromise;
}

async function command(message: Command): Promise<void> {
  const ipc = await connect();
  ipc.write(b4a.from(JSON.stringify(message) + '\n'));
}

/** Sends one request and waits for its reply (or fails after 30 s). */
export async function request<T>(message: Request): Promise<T> {
  const ipc = await connect();
  const rid = nextRid++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(rid);
      reject(new Error('The sharing worker did not answer in time.'));
    }, REQUEST_TIMEOUT_MS);
    pending.set(rid, {
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result as T);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    ipc.write(b4a.from(JSON.stringify({ ...message, rid }) + '\n'));
  });
}

export function subscribe(listener: (event: WorkerEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const startTest = (code: string) => command({ type: 'start', code });
export const stopTest = () => command({ type: 'stop' });
export const sendTest = (text: string) => command({ type: 'send', text });
export const refreshTest = () => command({ type: 'refresh' });

/** First 8 hex characters of a public key: enough to tell peers apart on screen. */
export const shortKey = (key: string) => key.slice(0, 8);
