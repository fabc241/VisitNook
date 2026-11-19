import { cancel, transcribe, type TranscribeSegment } from '@qvac/sdk';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSyncExternalStore } from 'react';

import {
  toFilePath,
  updateVisit,
  visitAudioFile,
  withoutSummary,
  type Turn,
  type Visit,
} from '../storage/visits';
import { LOAD_SPECS, errorMessage, unloadAll, withModels } from './models';

// ---------------------------------------------------------------------------
// Segments → turns (pure)
// ---------------------------------------------------------------------------

/**
 * With `speakerAttribution`, Parakeet returns one segment per diarized turn.
 * Adjacent segments from the same voice are merged anyway (the native merge
 * can leave splits around short pauses) and empty ones are dropped.
 */
export function segmentsToTurns(segments: TranscribeSegment[]): Turn[] {
  const turns: Turn[] = [];
  for (const segment of segments) {
    const text = segment.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const speakerId = segment.speakerId ?? 0;
    const last = turns[turns.length - 1];
    if (last && last.speakerId === speakerId) {
      last.text = `${last.text} ${text}`;
      last.endMs = Math.max(last.endMs, segment.endMs);
    } else {
      turns.push({ speakerId, startMs: segment.startMs, endMs: segment.endMs, text });
    }
  }
  return turns;
}

// ---------------------------------------------------------------------------
// Running jobs (survive leaving the screen)
// ---------------------------------------------------------------------------

export type TranscriptionJob =
  | { state: 'running'; startedAt: number; cancel: () => void }
  | { state: 'failed'; error: string };

const jobs = new Map<string, TranscriptionJob>();
const listeners = new Set<() => void>();
const KEEP_AWAKE_TAG = 'transcription';

function setJob(visitId: string, job: TranscriptionJob | null): void {
  if (job) jobs.set(visitId, job);
  else jobs.delete(visitId);
  listeners.forEach((l) => l());
}

export function useTranscriptionJob(visitId: string): TranscriptionJob | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => jobs.get(visitId) ?? null,
  );
}

/**
 * Transcribes the whole `audio.wav` with speaker attribution, saves the turns
 * into `visit.json` and unloads the models. A new transcription clears the old
 * speaker choice, because speaker numbers can change between runs.
 */
export async function transcribeVisit(visitId: string): Promise<Visit | null> {
  if (jobs.get(visitId)?.state === 'running') return null;

  let requestId: string | null = null;
  let cancelled = false;
  setJob(visitId, {
    state: 'running',
    startedAt: Date.now(),
    cancel: () => {
      cancelled = true;
      if (requestId) void cancel({ requestId }).catch(() => undefined);
    },
  });

  await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
  const started = Date.now();
  try {
    const audioPath = toFilePath(visitAudioFile(visitId).uri);
    const segments = await withModels([LOAD_SPECS.transcription], async ([modelId]) => {
      if (cancelled) throw new Error('Cancelled');
      console.log(`[transcribe] ${visitId}: models ready after ${Date.now() - started} ms`);
      const call = transcribe({ modelId, audioChunk: audioPath, metadata: true });
      requestId = call.requestId;
      const result = await call;
      const stats = await call.stats.catch(() => undefined);
      console.log(
        `[transcribe] ${visitId}: ${result.length} segments in ${Date.now() - started} ms` +
          (stats?.realTimeFactor !== undefined ? `, RTF ${stats.realTimeFactor.toFixed(2)}` : ''),
      );
      return result;
    });
    if (cancelled) throw new Error('Cancelled');

    const turns = segmentsToTurns(segments);
    // The old summary was written from the old transcript, so it goes too.
    const visit = await updateVisit(visitId, (v) => ({
      ...withoutSummary(v),
      status: 'transcribed',
      turns,
      speakerMap: undefined,
      transcribedAt: new Date().toISOString(),
    }));
    setJob(visitId, null);
    return visit;
  } catch (error) {
    if (cancelled) {
      setJob(visitId, null);
      return null;
    }
    console.warn(`[transcribe] ${visitId} failed: ${errorMessage(error)}`);
    setJob(visitId, { state: 'failed', error: errorMessage(error) });
    return null;
  } finally {
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    // Free Parakeet + diarization so the language model has room next.
    await unloadAll().catch(() => undefined);
  }
}

export function clearTranscriptionError(visitId: string): void {
  if (jobs.get(visitId)?.state === 'failed') setJob(visitId, null);
}
