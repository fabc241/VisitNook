import {
  embedBatch,
  ragCloseWorkspace,
  ragDeleteEmbeddings,
  ragSaveEmbeddings,
  ragSearch,
} from '@qvac/sdk';
import { File } from 'expo-file-system';

import {
  EMBED_DOC_PREFIX,
  EMBED_QUERY_PREFIX,
  indexSignature,
  isSearchable,
  visitDocuments,
  visitIdOf,
} from '../chat/documents';
import { listVisits, visitsRoot, type Visit } from '../storage/visits';
import { MODELS } from './catalog';
import { LOAD_SPECS, errorMessage, runExclusive, unloadAll, withModels } from './models';

/** The QVAC RAG workspace that holds every visit's search documents. */
export const WORKSPACE = 'visits';

/**
 * Stored with every vector. The vector store refuses documents from a
 * different model, so this must stay the same for the life of the workspace.
 */
const EMBEDDING_MODEL_KEY = MODELS[3].descriptor.name;
const EMBED_BATCH = 8;

// ---------------------------------------------------------------------------
// Manifest: which documents of which visit are in the workspace
// ---------------------------------------------------------------------------

type Manifest = {
  version: 1;
  visits: Record<string, { ids: string[]; signature: string }>;
  /** Ids whose delete has not gone through yet. Retried on every sync. */
  pendingDeletes: string[];
};

// Inside `visits/`, so it shares that folder's backup exclusion and file
// protection. `listVisits()` only reads sub-folders, so it ignores this file.
const manifestFile = new File(visitsRoot, '_search-index.json');

function readManifest(): Manifest {
  try {
    if (manifestFile.exists) {
      const parsed = JSON.parse(manifestFile.textSync()) as Manifest;
      if (parsed.version === 1) return { ...parsed, pendingDeletes: parsed.pendingDeletes ?? [] };
    }
  } catch (error) {
    console.warn(`[rag] manifest unreadable, starting over: ${errorMessage(error)}`);
  }
  return { version: 1, visits: {}, pendingDeletes: [] };
}

function writeManifest(manifest: Manifest): void {
  visitsRoot.create({ intermediates: true, idempotent: true });
  manifestFile.write(JSON.stringify(manifest));
}

/** Deletes `ids` from the workspace. Ids that fail stay in `pendingDeletes`. */
async function deleteIds(manifest: Manifest, ids: string[]): Promise<void> {
  if (!ids.length) return;
  manifest.pendingDeletes = [...new Set([...manifest.pendingDeletes, ...ids])];
  writeManifest(manifest);
  const gone = new Set(ids);
  const settle = () => {
    manifest.pendingDeletes = manifest.pendingDeletes.filter((id) => !gone.has(id));
    writeManifest(manifest);
  };
  try {
    await ragDeleteEmbeddings({ ids, workspace: WORKSPACE });
    settle();
  } catch (error) {
    // No workspace on disk means there is nothing left to delete.
    if (/not initialized/i.test(errorMessage(error))) settle();
    else console.warn(`[rag] delete of ${ids.length} documents failed, will retry: ${errorMessage(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export type SyncProgress = { done: number; total: number };

async function embedAndSave(modelId: string, visit: Visit): Promise<string[]> {
  const docs = visitDocuments(visit);
  const ids: string[] = [];
  for (let i = 0; i < docs.length; i += EMBED_BATCH) {
    const batch = docs.slice(i, i + EMBED_BATCH);
    const { embedding } = await embedBatch({
      modelId,
      inputs: batch.map((d) => EMBED_DOC_PREFIX + d.content),
    });
    const results = await ragSaveEmbeddings({
      workspace: WORKSPACE,
      documents: batch.map((d, j) => ({
        id: d.id,
        content: d.content,
        embedding: embedding[j],
        embeddingModelId: EMBEDDING_MODEL_KEY,
        metadata: { visitId: visit.id },
      })),
    });
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) throw new Error(failed.error ?? 'A search document could not be saved.');
    ids.push(...batch.map((d) => d.id));
  }
  return ids;
}

/**
 * Brings the workspace in line with the visits on disk: removes documents of
 * deleted, re-transcribed or re-summarized visits, and adds every summarized
 * visit that is missing. Needs the embedder loaded. Progress is saved after
 * each visit, so an interrupted sync picks up where it stopped.
 */
export async function syncIndex(
  embedderId: string,
  onProgress?: (progress: SyncProgress) => void,
): Promise<void> {
  const manifest = readManifest();
  const visits = (await listVisits()).filter(isSearchable);
  const wanted = new Map(visits.map((v) => [v.id, v]));

  const retry = [...manifest.pendingDeletes];
  if (retry.length) await deleteIds(manifest, retry);

  for (const [visitId, entry] of Object.entries(manifest.visits)) {
    const visit = wanted.get(visitId);
    if (visit && indexSignature(visit) === entry.signature) continue;
    delete manifest.visits[visitId];
    await deleteIds(manifest, entry.ids);
  }

  const missing = visits.filter((v) => !manifest.visits[v.id]);
  const started = Date.now();
  for (const [i, visit] of missing.entries()) {
    onProgress?.({ done: i, total: missing.length });
    const ids = await embedAndSave(embedderId, visit);
    manifest.visits[visit.id] = { ids, signature: indexSignature(visit) };
    writeManifest(manifest);
  }
  if (missing.length) {
    onProgress?.({ done: missing.length, total: missing.length });
    console.log(`[rag] indexed ${missing.length} visits in ${Date.now() - started} ms`);
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export type Hit = { id: string; visitId: string; content: string; score: number };

/** The `topK` documents closest to `question`, limited to visits the manifest lists. */
export async function searchVisits(embedderId: string, question: string, topK = 5): Promise<Hit[]> {
  const manifest = readManifest();
  const listed = new Set(Object.values(manifest.visits).flatMap((v) => v.ids));
  if (!listed.size) return [];
  const results = await ragSearch({
    modelId: embedderId,
    query: EMBED_QUERY_PREFIX + question.trim(),
    topK,
    workspace: WORKSPACE,
  });
  return results
    .filter((r) => listed.has(r.id))
    .map((r) => ({ id: r.id, visitId: visitIdOf(r.id), content: r.content, score: r.score }));
}

/** Frees the workspace's memory and file handles. Its data stays on disk. */
export async function closeIndex(): Promise<void> {
  await ragCloseWorkspace({ workspace: WORKSPACE }).catch(() => undefined);
}

export function indexedVisitCount(): number {
  return Object.keys(readManifest().visits).length;
}

// ---------------------------------------------------------------------------
// Entry points that schedule their own work
// ---------------------------------------------------------------------------

/**
 * Indexes new summaries in the background (after a summary is written), then
 * frees the embedder. Errors are logged: the next question syncs again.
 */
export function refreshIndexInBackground(): void {
  void withModels([LOAD_SPECS.embedder], async ([embedderId]) => {
    try {
      await syncIndex(embedderId);
    } finally {
      await closeIndex();
    }
  })
    .catch((error) => console.warn(`[rag] background sync failed: ${errorMessage(error)}`))
    .finally(() => void unloadAll().catch(() => undefined));
}

/**
 * Removes a deleted visit's documents. Needs no model. If the delete fails,
 * the ids stay listed for the next sync to retry; until then search ignores
 * them because they are no longer in the manifest's visits.
 */
export function forgetVisit(visitId: string): Promise<void> {
  return runExclusive(async () => {
    const manifest = readManifest();
    const entry = manifest.visits[visitId];
    if (!entry) return;
    delete manifest.visits[visitId];
    await deleteIds(manifest, entry.ids);
    await closeIndex();
  }).catch((error) => console.warn(`[rag] forget ${visitId} failed: ${errorMessage(error)}`));
}
