// Keeps the patient's shared visits store (an encrypted Hyperbee in the P2P
// worklet, p2p/shared-store.js) in step with the visits on this phone.
//
// - `sharing/key.json` holds the store's encryption key. It is made the first
//   time a visit is shared; until then the worklet is never started for this.
// - `sharing/store/` is the Corestore. Both are kept out of backups.
// - Every visit write goes through `onVisitChange`, so a rewritten summary, a
//   changed voice or a deleted visit updates the store on its own.
// - The first open after launch compares the store with the visits and fixes
//   anything a crash or a closed app left behind.
//
// What a record contains is decided in src/share/shared.ts.

import { Directory, File, Paths } from 'expo-file-system';

import FileProtection from '../../modules/file-protection';
import { isShared, sharedVisitRecord, type SharedVisitRecord } from '../share/shared';
import {
  listVisits,
  onVisitChange,
  toFilePath,
  updateVisit,
  type Visit,
  type VisitSharing,
} from '../storage/visits';
import { request } from './engine';

/** The store's core. Removing someone later (function 6) moves to a new name and key. */
const CORE_NAME = 'shared-visits/1';

const sharingRoot = new Directory(Paths.document, 'sharing');
const storeDir = new Directory(sharingRoot, 'store');
const keyFile = new File(sharingRoot, 'key.json');

type KeyFile = { version: 1; coreName: string; encryptionKey: string; createdAt: string };

export type StoreInfo = { key: string; discoveryKey: string; length: number; byteLength: number };

export type SharedEntry = { id: string; record: SharedVisitRecord };

export type EncryptionCheck = StoreInfo & {
  blocks: number;
  /** False when the store has no visit blocks yet to look at. */
  checked: boolean;
  /** The newest block, read from disk without the key, is not readable text. */
  rawLooksEncrypted?: boolean;
  /** The same block, decrypted with the key, has its readable `visit/…` key. */
  decryptedHasProbe?: boolean;
  rawSample?: string;
};

export type SharedOverview = {
  /** `null` when nothing has ever been shared from this phone. */
  info: StoreInfo | null;
  entries: SharedEntry[];
  check: EncryptionCheck | null;
};

// Every store operation runs one after another, in order.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

let foldersReady = false;
let reconciled = false;

/** The store has been created on this phone (something was shared at least once). */
function storeExists(): boolean {
  return keyFile.exists;
}

async function readKeyFile(): Promise<KeyFile | null> {
  if (!keyFile.exists) return null;
  const saved = JSON.parse(await keyFile.text()) as KeyFile;
  if (typeof saved.encryptionKey !== 'string' || typeof saved.coreName !== 'string') {
    throw new Error('The sharing key file is damaged.');
  }
  return saved;
}

async function prepareFolders(): Promise<void> {
  if (foldersReady) return;
  sharingRoot.create({ intermediates: true, idempotent: true });
  // The database keeps files open and adds new ones while it works, so it
  // uses "complete unless open": unreadable once the phone locks, except
  // files the app already has open.
  await FileProtection.setProtection(sharingRoot.uri, 'completeUnlessOpen');
  await FileProtection.excludeFromBackup(sharingRoot.uri);
  foldersReady = true;
}

/** Opens the store in the worklet (a no-op there when it is already open). */
async function open(): Promise<StoreInfo> {
  await prepareFolders();
  const saved = await readKeyFile();
  // Without its key an old store cannot be read, so start a fresh one.
  if (!saved && storeDir.exists) storeDir.delete();
  const opened = await request<StoreInfo & { encryptionKey?: string }>({
    type: 'shared-open',
    dir: toFilePath(storeDir.uri),
    coreName: saved?.coreName ?? CORE_NAME,
    encryptionKey: saved?.encryptionKey ?? null,
  });
  if (!saved) {
    if (!opened.encryptionKey) throw new Error('The sharing worker did not return a key.');
    const created: KeyFile = {
      version: 1,
      coreName: CORE_NAME,
      encryptionKey: opened.encryptionKey,
      createdAt: new Date().toISOString(),
    };
    keyFile.write(JSON.stringify(created));
    await FileProtection.setProtection(keyFile.uri, 'complete');
  }
  const { encryptionKey: _key, ...info } = opened;
  if (!reconciled) {
    await reconcile();
    reconciled = true;
  }
  return info;
}

/** Stores or removes one visit's record. Must run inside `serial`. */
async function apply(visit: Visit): Promise<void> {
  const record = sharedVisitRecord(visit);
  if (record) await request({ type: 'shared-put', id: visit.id, record });
  else await request({ type: 'shared-del', id: visit.id });
}

/** Makes the store match the visits: puts what is shared, removes the rest. */
async function reconcile(): Promise<void> {
  const visits = await listVisits();
  const stored = await request<SharedEntry[]>({ type: 'shared-list' });
  const keep = new Set<string>();
  for (const visit of visits) {
    if (sharedVisitRecord(visit)) keep.add(visit.id);
    if (isShared(visit)) await apply(visit);
  }
  for (const { id } of stored) {
    if (!keep.has(id)) await request({ type: 'shared-del', id });
  }
}

// Follow every visit write and delete. A visit whose switch was never turned
// on does not start the worklet unless the store already exists.
const latest = new Map<string, Promise<void>>();
onVisitChange(({ id, visit }) => {
  const needed = visit ? isShared(visit) || storeExists() : storeExists();
  if (!needed) return;
  const run = serial(async () => {
    await open();
    if (visit) await apply(visit);
    else await request({ type: 'shared-del', id });
  });
  latest.set(id, run);
  run
    .catch((error: unknown) => console.warn(`[sharing] could not update visit ${id}:`, error))
    .finally(() => {
      if (latest.get(id) === run) latest.delete(id);
    });
});

/**
 * Turns sharing on or off for one visit (and the transcript with it), and
 * waits until the store has the change.
 */
export async function setVisitSharing(visitId: string, sharing: VisitSharing): Promise<Visit> {
  const saved = await updateVisit(visitId, (v) => ({ ...v, sharing }));
  await latest.get(visitId);
  return saved;
}

/**
 * What the store holds, read back and decrypted, plus a check that the
 * newest block on disk is unreadable without the key.
 */
export function readSharedVisits(): Promise<SharedOverview> {
  if (!storeExists()) return Promise.resolve({ info: null, entries: [], check: null });
  return serial(async () => {
    await open();
    const entries = await request<SharedEntry[]>({ type: 'shared-list' });
    const check = await request<EncryptionCheck>({ type: 'shared-check' });
    const { key, discoveryKey, length, byteLength } = check;
    return { info: { key, discoveryKey, length, byteLength }, entries, check };
  });
}
