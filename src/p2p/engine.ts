// Talks to the P2P worklet (p2p/worker.js, packed into p2p/build). The worklet
// is started the first time something needs it and then stays up; Hyperswarm
// itself only runs between `startTest()` and `stopTest()`.

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

type Command =
  | { type: 'start'; code: string }
  | { type: 'stop' }
  | { type: 'send'; text: string }
  | { type: 'refresh' };

type Ipc = Awaited<ReturnType<typeof worker.start>>['ipc'];

const listeners = new Set<(event: WorkerEvent) => void>();
let ipcPromise: Promise<Ipc> | null = null;

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
            emit(JSON.parse(line) as WorkerEvent);
          } catch {
            console.warn(`[p2p] unreadable message from the worker: ${line.slice(0, 200)}`);
          }
        }
      });
      ipc.on('close', () => {
        ipcPromise = null;
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
