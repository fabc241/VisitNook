import { calcTokens, cancel, completion } from '@qvac/sdk';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSyncExternalStore } from 'react';

import { needsQuestions, prepVisits } from '../prep/list';
import {
  MAX_QUESTIONS_PER_EXCERPT,
  findQuestions,
  formatExcerpt,
  openQuestions,
  parsePrepAnswer,
  questionExcerpts,
  type Candidate,
  type Decision,
  type Excerpt,
} from '../prep/questions';
import { listVisits, updateVisit, type OpenQuestion, type Visit } from '../storage/visits';
import { transcriptLines, type Line } from '../summary/transcript';
import { LOAD_SPECS, PREP_CTX_SIZE, errorMessage, unloadAll, withModels } from './models';
import { PREP_JSON_SCHEMA, PREP_STRICT_JSON_REMINDER, PREP_SYSTEM_PROMPT, prepMessage } from './prompts';

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/** One decision and a short question for up to 8 questions. */
const MAX_OUTPUT_TOKENS = 600;
const SAFETY_TOKENS = 64;
const PROMPT_BUDGET = PREP_CTX_SIZE - MAX_OUTPUT_TOKENS - SAFETY_TOKENS;
/** Line lengths tried, longest first, until an excerpt fits the budget on its own. */
const LINE_CLIPS = [600, 250, 100];
const KEEP_AWAKE_TAG = 'prep';

// ---------------------------------------------------------------------------
// Job state (survives leaving the screen)
// ---------------------------------------------------------------------------

export type PrepJob = {
  running: { done: number; total: number; cancel: () => void } | null;
  /** What went wrong in the last run, for the patient. */
  error: string | null;
  /** The patient pressed Cancel; the tab then waits for "Check again". */
  cancelled: boolean;
};

let state: PrepJob = { running: null, error: null, cancelled: false };
/** Set before the first await, so two quick calls never start two runs. */
let busy = false;
const listeners = new Set<() => void>();

function setState(next: Partial<PrepJob>): void {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function usePrepJob(): PrepJob {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

class CancelledError extends Error {
  constructor() {
    super('Cancelled');
  }
}

// ---------------------------------------------------------------------------
// Model calls
// ---------------------------------------------------------------------------

type Ctx = { modelId: string; isCancelled: () => boolean; onRequest: (id: string) => void };

function check(ctx: Ctx): void {
  if (ctx.isCancelled()) throw new CancelledError();
}

function countPrompt(ctx: Ctx, excerpts: string[]): Promise<number> {
  return calcTokens({
    modelId: ctx.modelId,
    history: [
      { role: 'system', content: PREP_SYSTEM_PROMPT },
      { role: 'user', content: prepMessage(excerpts) },
    ],
  });
}

type Batch = { texts: string[]; questions: number[] };

/**
 * Packs the excerpts into as few prompts as fit the budget, at most 8
 * questions each. An excerpt too long on its own is sent with shorter lines.
 */
async function planBatches(ctx: Ctx, lines: Line[], candidates: Candidate[], excerpts: Excerpt[]): Promise<Batch[]> {
  const batches: Batch[] = [];
  let current: Batch = { texts: [], questions: [] };
  for (const excerpt of excerpts) {
    check(ctx);
    let text = formatExcerpt(lines, candidates, excerpt, LINE_CLIPS[0]);
    const tooMany = current.questions.length + excerpt.questions.length > MAX_QUESTIONS_PER_EXCERPT;
    if (current.texts.length && !tooMany && (await countPrompt(ctx, [...current.texts, text])) <= PROMPT_BUDGET) {
      current.texts.push(text);
      current.questions.push(...excerpt.questions);
      continue;
    }
    if (current.texts.length) batches.push(current);
    for (const clip of LINE_CLIPS.slice(1)) {
      if ((await countPrompt(ctx, [text])) <= PROMPT_BUDGET) break;
      text = formatExcerpt(lines, candidates, excerpt, clip);
    }
    current = { texts: [text], questions: [...excerpt.questions] };
  }
  if (current.texts.length) batches.push(current);
  return batches;
}

/** Reads only `final.contentText`; reasoning is never stored, shown or logged. */
async function generate(ctx: Ctx, batch: Batch, strict: boolean): Promise<string> {
  check(ctx);
  const user = prepMessage(batch.texts);
  const run = completion({
    modelId: ctx.modelId,
    // No system message: the load-time `system_prompt` applies.
    history: [{ role: 'user', content: strict ? `${user}\n\n${PREP_STRICT_JSON_REMINDER}` : user }],
    stream: true,
    captureThinking: true,
    generationParams: { predict: MAX_OUTPUT_TOKENS, reasoning_budget: 0 },
    ...(strict
      ? {}
      : {
          responseFormat: {
            type: 'json_schema' as const,
            json_schema: { name: 'open_questions', schema: PREP_JSON_SCHEMA },
          },
        }),
  });
  ctx.onRequest(run.requestId);
  const final = await run.final;
  if (ctx.isCancelled() || final.stopReason === 'cancelled') throw new CancelledError();
  return final.contentText;
}

/** One batch with one retry; the retry adds a stricter JSON instruction and no grammar. */
async function decide(ctx: Ctx, batch: Batch): Promise<Map<number, Decision>> {
  try {
    const parsed = parsePrepAnswer(await generate(ctx, batch, false), batch.questions);
    if (parsed) return parsed;
  } catch (error) {
    if (error instanceof CancelledError) throw error;
    console.warn(`[prep] batch failed (${errorMessage(error)}), retrying`);
  }
  const parsed = parsePrepAnswer(await generate(ctx, batch, true), batch.questions);
  if (parsed) return parsed;
  throw new Error('The language model did not return a readable answer.');
}

async function findOpenQuestions(ctx: Ctx, lines: Line[], candidates: Candidate[]): Promise<OpenQuestion[]> {
  const batches = await planBatches(ctx, lines, candidates, questionExcerpts(lines, candidates));
  const decisions = new Map<number, Decision>();
  for (const batch of batches) {
    for (const [n, d] of await decide(ctx, batch)) decisions.set(n, d);
  }
  return openQuestions(candidates, decisions);
}

/** Saves the result unless the visit was re-summarized while this ran. */
async function save(visit: Visit, questions: OpenQuestion[]): Promise<void> {
  await updateVisit(visit.id, (v) =>
    v.summarizedAt !== visit.summarizedAt
      ? v
      : { ...v, openQuestions: questions, openQuestionsFor: visit.summarizedAt },
  );
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Looks for unanswered patient questions in the recent visits that have not
 * been looked at since their last summary. Visits where the patient asked no
 * questions are saved without loading the model. Counts are logged, never text.
 */
export async function findPrepQuestions(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await run();
  } finally {
    busy = false;
  }
}

async function run(): Promise<void> {
  let cancelled = false;
  let requestId: string | null = null;

  const todo = prepVisits(await listVisits().catch(() => [])).filter(needsQuestions);
  if (!todo.length) {
    setState({ error: null, cancelled: false });
    return;
  }
  setState({
    running: {
      done: 0,
      total: todo.length,
      cancel: () => {
        cancelled = true;
        if (requestId) void cancel({ requestId }).catch(() => undefined);
      },
    },
    error: null,
    cancelled: false,
  });

  const failed: string[] = [];
  let done = 0;
  const step = () => {
    done++;
    if (state.running) setState({ running: { ...state.running, done } });
  };

  await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
  const started = Date.now();
  let usedModel = false;
  try {
    const withQuestions: { visit: Visit; lines: Line[]; candidates: Candidate[] }[] = [];
    for (const visit of todo) {
      const lines = transcriptLines(visit.turns!, visit.speakerMap);
      const candidates = findQuestions(lines);
      if (candidates.length) {
        withQuestions.push({ visit, lines, candidates });
        continue;
      }
      await save(visit, []).catch((error) => failed.push(errorMessage(error)));
      step();
    }

    if (withQuestions.length && !cancelled) {
      usedModel = true;
      await withModels([LOAD_SPECS.prep], async ([modelId]) => {
        const ctx: Ctx = {
          modelId,
          isCancelled: () => cancelled,
          onRequest: (id) => {
            requestId = id;
          },
        };
        for (const { visit, lines, candidates } of withQuestions) {
          check(ctx);
          const visitStarted = Date.now();
          try {
            const questions = await findOpenQuestions(ctx, lines, candidates);
            await save(visit, questions);
            console.log(
              `[prep] ${visit.id}: ${questions.length} of ${candidates.length} questions open ` +
                `(${Date.now() - visitStarted} ms)`,
            );
          } catch (error) {
            if (cancelled || error instanceof CancelledError) throw new CancelledError();
            console.warn(`[prep] ${visit.id} failed: ${errorMessage(error)}`);
            failed.push(errorMessage(error));
          }
          step();
        }
      });
    }
    console.log(`[prep] ${todo.length} visits checked in ${Date.now() - started} ms, ${failed.length} failed`);
    setState({ running: null, error: failedMessage(failed), cancelled: false });
  } catch (error) {
    if (cancelled || error instanceof CancelledError) {
      setState({ running: null, error: null, cancelled: true });
    } else {
      console.warn(`[prep] failed: ${errorMessage(error)}`);
      setState({ running: null, error: errorMessage(error), cancelled: false });
    }
  } finally {
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    if (usedModel) await unloadAll().catch(() => undefined);
  }
}

function failedMessage(failed: string[]): string | null {
  if (!failed.length) return null;
  const visits = failed.length === 1 ? '1 visit' : `${failed.length} visits`;
  return `Could not check ${visits} for open questions: ${failed[0]}`;
}
