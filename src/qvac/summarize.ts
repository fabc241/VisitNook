import { calcTokens, cancel, completion } from '@qvac/sdk';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSyncExternalStore } from 'react';

import { checkSummary, type CheckedSummary } from '../guardrails/check';
import { getVisit, updateVisit, type Visit } from '../storage/visits';
import { concatResults, parseSummary, type SummaryResult } from '../summary/parse';
import {
  formatLines,
  hasDoctorLines,
  splitLines,
  transcriptLines,
  type Line,
} from '../summary/transcript';
import { LOAD_SPECS, SUMMARY_CTX_SIZE, errorMessage, unloadAll, withModels } from './models';
import {
  STRICT_JSON_REMINDER,
  SUMMARY_JSON_SCHEMA,
  SUMMARY_SYSTEM_PROMPT,
  extractionMessage,
  mergeMessage,
  type TranscriptPart,
} from './prompts';
import { refreshIndexInBackground } from './rag';

// ---------------------------------------------------------------------------
// Token budget
// ---------------------------------------------------------------------------

/** Most tokens one answer may use, reasoning included. */
const MAX_OUTPUT_TOKENS = 2048;
/** Reasoning is capped so it cannot eat the JSON's share of the output. */
const REASONING_BUDGET = 512;
/** Headroom for chat-template tokens that calcTokens and the real prompt may count differently. */
const SAFETY_TOKENS = 64;
/** Largest prompt (system + user turn) one pass may send. */
export const PROMPT_BUDGET = SUMMARY_CTX_SIZE - MAX_OUTPUT_TOKENS - SAFETY_TOKENS;
/** A transcript that still does not fit after this many parts is refused. */
const MAX_PARTS = 12;

// ---------------------------------------------------------------------------
// Running jobs (survive leaving the screen)
// ---------------------------------------------------------------------------

export type SummaryPhase =
  | { kind: 'loading' }
  | { kind: 'measuring' }
  | { kind: 'writing'; part: number; parts: number }
  | { kind: 'merging' };

export type SummaryJob =
  | { state: 'running'; startedAt: number; phase: SummaryPhase; cancel: () => void }
  | { state: 'failed'; error: string };

const jobs = new Map<string, SummaryJob>();
const listeners = new Set<() => void>();
const KEEP_AWAKE_TAG = 'summary';

function setJob(visitId: string, job: SummaryJob | null): void {
  if (job) jobs.set(visitId, job);
  else jobs.delete(visitId);
  listeners.forEach((l) => l());
}

function setPhase(visitId: string, phase: SummaryPhase): void {
  const job = jobs.get(visitId);
  if (job?.state === 'running') setJob(visitId, { ...job, phase });
}

export function useSummaryJob(visitId: string): SummaryJob | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => jobs.get(visitId) ?? null,
  );
}

export function clearSummaryError(visitId: string): void {
  if (jobs.get(visitId)?.state === 'failed') setJob(visitId, null);
}

class CancelledError extends Error {
  constructor() {
    super('Cancelled');
  }
}

// ---------------------------------------------------------------------------
// Model calls
// ---------------------------------------------------------------------------

type Ctx = {
  modelId: string;
  isCancelled: () => boolean;
  onRequest: (requestId: string) => void;
  visitId: string;
};

/** Prompt tokens for one pass. The system prompt is counted explicitly so the count is never low. */
function countPrompt(ctx: Ctx, user: string): Promise<number> {
  return calcTokens({
    modelId: ctx.modelId,
    history: [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
  });
}

/**
 * Runs one completion and reads only `final.contentText`. Reasoning arrives
 * separately (`captureThinking`) and is dropped here: it is never stored,
 * shown or logged. `final.raw.fullText` is never read because it still holds
 * the `<think>` text.
 */
async function generate(ctx: Ctx, user: string, strict: boolean): Promise<string> {
  if (ctx.isCancelled()) throw new CancelledError();
  const run = completion({
    modelId: ctx.modelId,
    // No system message: the load-time `system_prompt` applies.
    history: [{ role: 'user', content: strict ? `${user}\n\n${STRICT_JSON_REMINDER}` : user }],
    stream: true,
    captureThinking: true,
    generationParams: {
      predict: MAX_OUTPUT_TOKENS,
      // The strict retry skips reasoning so the whole budget goes to the JSON.
      reasoning_budget: strict ? 0 : REASONING_BUDGET,
    },
    // First try: a grammar keeps the output to the schema. The retry runs
    // without it in case the grammar itself was the problem.
    ...(strict
      ? {}
      : {
          responseFormat: {
            type: 'json_schema' as const,
            json_schema: { name: 'visit_summary', schema: SUMMARY_JSON_SCHEMA },
          },
        }),
  });
  ctx.onRequest(run.requestId);
  const final = await run.final;
  if (ctx.isCancelled() || final.stopReason === 'cancelled') throw new CancelledError();
  console.log(
    `[summary] ${ctx.visitId}: pass done (${strict ? 'strict' : 'schema'}), ` +
      `stop=${final.stopReason ?? '?'}, ${final.stats?.generatedTokens ?? '?'} tokens`,
  );
  return final.contentText;
}

/** One pass with one retry: the retry adds a stricter JSON instruction. */
async function generateSummary(ctx: Ctx, user: string): Promise<SummaryResult> {
  let firstError: unknown;
  try {
    const parsed = parseSummary(await generate(ctx, user, false));
    if (parsed) return parsed;
    console.warn(`[summary] ${ctx.visitId}: answer was not valid JSON, retrying`);
  } catch (error) {
    if (error instanceof CancelledError) throw error;
    firstError = error;
    console.warn(`[summary] ${ctx.visitId}: pass failed (${errorMessage(error)}), retrying`);
  }
  const parsed = parseSummary(await generate(ctx, user, true));
  if (parsed) return parsed;
  throw new Error(
    firstError
      ? `The summary could not be written: ${errorMessage(firstError)}`
      : 'The language model did not return a readable summary. Please try again.',
  );
}

/**
 * Splits the transcript into the fewest parts whose prompts all fit the
 * budget. Cuts fall only between lines (speaker turns, or sentence pieces of
 * a very long turn).
 */
async function planParts(ctx: Ctx, lines: Line[]): Promise<Line[][]> {
  const whole = await countPrompt(ctx, extractionMessage(formatLines(lines), null));
  console.log(`[summary] ${ctx.visitId}: ${whole} prompt tokens, budget ${PROMPT_BUDGET}`);
  if (whole <= PROMPT_BUDGET) return [lines];

  let count = Math.ceil(whole / (PROMPT_BUDGET * 0.9));
  for (; count <= Math.min(MAX_PARTS, lines.length); count++) {
    if (ctx.isCancelled()) throw new CancelledError();
    const groups = splitLines(lines, count);
    let fits = true;
    for (const [i, group] of groups.entries()) {
      const part: TranscriptPart = { index: i + 1, count: groups.length };
      if ((await countPrompt(ctx, extractionMessage(formatLines(group), part))) > PROMPT_BUDGET) {
        fits = false;
        break;
      }
    }
    if (fits) return groups;
  }
  throw new Error('This visit is too long to summarize on this iPhone.');
}

async function mergeParts(ctx: Ctx, parts: SummaryResult[]): Promise<SummaryResult> {
  const fallback = concatResults(parts);
  const user = mergeMessage(JSON.stringify(parts.map((p, i) => ({ part: i + 1, ...p }))));
  if ((await countPrompt(ctx, user)) > PROMPT_BUDGET) {
    console.log(`[summary] ${ctx.visitId}: merge input too long, joining parts in order`);
    return fallback;
  }
  try {
    return await generateSummary(ctx, user);
  } catch (error) {
    if (error instanceof CancelledError) throw error;
    console.warn(`[summary] ${ctx.visitId}: merge failed (${errorMessage(error)}), joining parts`);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Writes the plain-English summary and next steps for a transcribed visit
 * whose voices have been chosen, saves them into `visit.json` and unloads
 * MedPsy. Long transcripts are summarized part by part and then merged.
 */
export async function summarizeVisit(visitId: string): Promise<Visit | null> {
  if (jobs.get(visitId)?.state === 'running') return null;

  let requestId: string | null = null;
  let cancelled = false;
  setJob(visitId, {
    state: 'running',
    startedAt: Date.now(),
    phase: { kind: 'loading' },
    cancel: () => {
      cancelled = true;
      if (requestId) void cancel({ requestId }).catch(() => undefined);
    },
  });

  await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
  const started = Date.now();
  let indexAfter = false;
  try {
    const visit = await getVisit(visitId);
    if (!visit?.turns?.length) throw new Error('This visit has no transcript yet.');
    if (!visit.speakerMap) throw new Error('Choose which voice is yours first.');
    if (!hasDoctorLines(visit.turns, visit.speakerMap)) {
      throw new Error('No lines are labelled Doctor, so there is nothing to summarize.');
    }
    const speakerMap = visit.speakerMap;
    const lines = transcriptLines(visit.turns, speakerMap);

    const result = await withModels([LOAD_SPECS.summary], async ([modelId]) => {
      const ctx: Ctx = {
        modelId,
        visitId,
        isCancelled: () => cancelled,
        onRequest: (id) => {
          requestId = id;
        },
      };
      if (cancelled) throw new CancelledError();
      console.log(`[summary] ${visitId}: model ready after ${Date.now() - started} ms`);

      setPhase(visitId, { kind: 'measuring' });
      const groups = await planParts(ctx, lines);

      const parts: SummaryResult[] = [];
      for (const [i, group] of groups.entries()) {
        setPhase(visitId, { kind: 'writing', part: i + 1, parts: groups.length });
        const part = groups.length > 1 ? { index: i + 1, count: groups.length } : null;
        parts.push(await generateSummary(ctx, extractionMessage(formatLines(group), part)));
      }
      if (parts.length === 1) return parts[0];

      setPhase(visitId, { kind: 'merging' });
      return mergeParts(ctx, parts);
    });
    if (cancelled) throw new CancelledError();

    console.log(
      `[summary] ${visitId}: ${result.summary.length} summary items, ` +
        `${result.nextSteps.length} next steps in ${Date.now() - started} ms`,
    );
    const checked = checkSummary(result, lines);
    logCheck(visitId, checked);
    const saved = await updateVisit(visitId, (v) => {
      // The voices were changed while this ran; this result is stale.
      if (JSON.stringify(v.speakerMap) !== JSON.stringify(speakerMap)) return v;
      return {
        ...v,
        status: 'summarized',
        summary: checked.summary,
        nextSteps: checked.nextSteps,
        removed: checked.removed,
        summarizedAt: new Date().toISOString(),
      };
    });
    setJob(visitId, null);
    indexAfter = saved.status === 'summarized';
    return saved;
  } catch (error) {
    if (cancelled || error instanceof CancelledError) {
      setJob(visitId, null);
      return null;
    }
    console.warn(`[summary] ${visitId} failed: ${errorMessage(error)}`);
    setJob(visitId, { state: 'failed', error: errorMessage(error) });
    return null;
  } finally {
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    await unloadAll().catch(() => undefined);
    // Makes the new summary searchable in "Ask" (MedPsy is unloaded first).
    if (indexAfter) refreshIndexInBackground();
  }
}

// ---------------------------------------------------------------------------
// Safety check
// ---------------------------------------------------------------------------

/** Counts only: the text of a summary is never logged. */
function logCheck(visitId: string, checked: CheckedSummary): void {
  const items = checked.removed.filter((r) => r.kind === 'item').length;
  const timeFrames = checked.removed.length - items;
  console.log(
    `[safety] ${visitId}: kept ${checked.summary.length} summary items and ` +
      `${checked.nextSteps.length} next steps; removed ${items} items and ${timeFrames} time frames`,
  );
}

/**
 * A summary saved before the safety check existed has no `removed` list.
 * It is checked (no model needed) the first time the visit is opened.
 */
export async function ensureSafetyChecked(visit: Visit): Promise<Visit> {
  if (!visit.summary || !visit.nextSteps || visit.removed || !visit.turns || !visit.speakerMap) {
    return visit;
  }
  return updateVisit(visit.id, (v) => {
    if (!v.summary || !v.nextSteps || v.removed || !v.turns || !v.speakerMap) return v;
    const checked = checkSummary(
      { summary: v.summary, nextSteps: v.nextSteps },
      transcriptLines(v.turns, v.speakerMap),
    );
    logCheck(v.id, checked);
    return { ...v, ...checked };
  });
}
