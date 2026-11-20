import {
  cancel,
  downloadAsset,
  getModelInfo,
  loadModel,
  unloadModel,
  type LoadModelOptions,
  type ModelProgressUpdate,
} from '@qvac/sdk';

import { MODELS, type CatalogModel, type ModelKey } from './catalog';
import { CHAT_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT } from './prompts';

export const SUMMARY_CTX_SIZE = 8192;
/** Smaller than the summary's: five short excerpts fit, and it leaves room for the embedder. */
export const CHAT_CTX_SIZE = 4096;

// ---------------------------------------------------------------------------
// Cache status
// ---------------------------------------------------------------------------

export type CacheStatus = Record<ModelKey, boolean>;

const STATUS_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Asks the worker which models are already in the on-device cache. */
export async function getCacheStatus(): Promise<CacheStatus> {
  const started = Date.now();
  console.log('[models] checking cache status');
  try {
    const entries = await withTimeout(
      Promise.all(
        MODELS.map(async (m) => {
          const info = await getModelInfo({ name: m.descriptor.name });
          console.log(`[models] ${m.key}: cached=${info.isCached} (${Date.now() - started} ms)`);
          return [m.key, info.isCached] as const;
        }),
      ),
      STATUS_TIMEOUT_MS,
      'Checking the models',
    );
    return Object.fromEntries(entries) as CacheStatus;
  } catch (error) {
    console.warn(`[models] cache status failed: ${errorMessage(error)}`);
    throw error;
  }
}

export function allCached(status: CacheStatus): boolean {
  return MODELS.every((m) => status[m.key]);
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export type DownloadProgress = { downloaded: number; total: number };

function bytesFrom(update: ModelProgressUpdate, model: CatalogModel): DownloadProgress {
  const overall = update.fileSetInfo ?? update.shardInfo;
  if (overall) return { downloaded: overall.overallDownloaded, total: overall.overallTotal };
  return { downloaded: update.downloaded, total: update.total || model.descriptor.expectedSize };
}

/**
 * Downloads one model into the QVAC cache without loading it. A cancelled or
 * failed registry download keeps its blocks, so calling this again resumes.
 */
export function downloadModel(
  model: CatalogModel,
  onProgress: (progress: DownloadProgress) => void,
): { done: Promise<void>; cancel: () => Promise<void> } {
  const op = downloadAsset({
    assetSrc: model.descriptor,
    onProgress: (update) => onProgress(bytesFrom(update, model)),
  });
  return {
    done: op.then(() => undefined),
    cancel: () => cancel({ requestId: op.requestId }),
  };
}

// ---------------------------------------------------------------------------
// Model manager: one group in memory at a time, one operation at a time
// ---------------------------------------------------------------------------

/**
 * A model to have in memory. `id` must change whenever `options` changes in a
 * way that needs a reload (for example a different `system_prompt`).
 */
export type LoadSpec = { id: string; options: LoadModelOptions };

/** Ready-made load specs. Later steps add `system_prompt` etc. with their own ids. */
export const LOAD_SPECS = {
  transcription: {
    id: 'parakeet+diarization',
    options: {
      modelSrc: MODELS[0].descriptor,
      modelType: 'parakeet-transcription',
      modelConfig: { speakerAttribution: { modelSrc: MODELS[1].descriptor } },
    },
  },
  medpsy: {
    id: 'medpsy:ctx8192',
    options: { modelSrc: MODELS[2].descriptor, modelType: 'llm', modelConfig: { ctx_size: 8192 } },
  },
  summary: {
    id: 'medpsy:ctx8192:summary-v1',
    options: {
      modelSrc: MODELS[2].descriptor,
      modelType: 'llm',
      modelConfig: { ctx_size: SUMMARY_CTX_SIZE, system_prompt: SUMMARY_SYSTEM_PROMPT, temp: 0.2 },
    },
  },
  chat: {
    id: 'medpsy:ctx4096:chat-v2',
    options: {
      modelSrc: MODELS[2].descriptor,
      modelType: 'llm',
      modelConfig: {
        ctx_size: CHAT_CTX_SIZE,
        system_prompt: CHAT_SYSTEM_PROMPT,
        temp: 0.2,
        // Answers quote short excerpts; thinking first only made each answer
        // minutes slower on the phone.
        reasoning_budget: 0,
      },
    },
  },
  embedder: {
    id: 'embeddinggemma',
    options: { modelSrc: MODELS[3].descriptor, modelType: 'llamacpp-embedding' },
  },
} satisfies Record<string, LoadSpec>;

/** spec id → QVAC model id, for what is in memory right now. */
const loaded = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();

/** Runs `fn` after every previously queued operation has settled. */
export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

async function unloadExcept(keep: Set<string>): Promise<void> {
  for (const [specId, modelId] of [...loaded]) {
    if (keep.has(specId)) continue;
    loaded.delete(specId);
    await unloadModel({ modelId });
  }
}

/**
 * Makes sure exactly `specs` are in memory (unloading anything else first, so
 * two groups never overlap), then runs `task` with their model ids. Calls are
 * serialized: a second call waits for the first to finish. The models stay
 * loaded afterwards so the next call with the same specs is instant; call
 * `unloadAll()` to free memory.
 *
 * Do not call `withModels` from inside `task` — it would wait on itself.
 */
export function withModels<T>(
  specs: LoadSpec[],
  task: (modelIds: string[]) => Promise<T>,
): Promise<T> {
  return runExclusive(async () => {
    await unloadExcept(new Set(specs.map((s) => s.id)));
    const ids: string[] = [];
    for (const spec of specs) {
      let modelId = loaded.get(spec.id);
      if (!modelId) {
        modelId = await loadModel(spec.options);
        loaded.set(spec.id, modelId);
      }
      ids.push(modelId);
    }
    return task(ids);
  });
}

/** Frees every model the manager loaded. Waits for any running operation first. */
export function unloadAll(): Promise<void> {
  return runExclusive(() => unloadExcept(new Set()));
}

export type LoadCheckResult = { name: string; ok: boolean; ms: number; error?: string };

/**
 * Loads each group on its own, then unloads it. Used by the setup screen to
 * prove the cached models load with no network (airplane mode).
 */
export async function checkModelsLoad(
  onResult: (result: LoadCheckResult) => void,
): Promise<void> {
  const groups: [string, LoadSpec][] = [
    ['Speech to text + voice separation', LOAD_SPECS.transcription],
    ['Medical language model', LOAD_SPECS.medpsy],
    ['Search model', LOAD_SPECS.embedder],
  ];
  for (const [name, spec] of groups) {
    const started = Date.now();
    console.log(`[models] loading ${spec.id}`);
    try {
      await withModels([spec], async () => undefined);
      console.log(`[models] loaded ${spec.id} in ${Date.now() - started} ms`);
      onResult({ name, ok: true, ms: Date.now() - started });
    } catch (error) {
      console.warn(`[models] load ${spec.id} failed: ${errorMessage(error)}`);
      onResult({ name, ok: false, ms: Date.now() - started, error: errorMessage(error) });
    }
  }
  await unloadAll();
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
