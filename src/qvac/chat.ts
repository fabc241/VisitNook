import { assessModelFit, calcTokens, cancel, completion } from '@qvac/sdk';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSyncExternalStore } from 'react';

import {
  NOT_FOUND_ANSWER,
  isNotFound,
  parseAnswer,
  visitLabels,
  withoutCitations,
  type AnswerSegment,
} from '../chat/citations';
import { DECLINE_HINT, DECLINE_MESSAGE, precheckQuestion } from '../chat/precheck';
import { unsupportedMention } from '../guardrails/check';
import { getVisit, type Visit } from '../storage/visits';
import { stripThinking } from '../summary/parse';
import { CHAT_CTX_SIZE, LOAD_SPECS, errorMessage, unloadAll, withModels } from './models';
import { CHAT_SYSTEM_PROMPT, chatMessage, type ChatExcerpt } from './prompts';
import {
  closeIndex,
  indexedVisitCount,
  searchVisits,
  syncIndex,
  type Hit,
  type SyncProgress,
} from './rag';

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

const TOP_K = 5;
/** Most tokens one answer may use: five short sentences with citations fit easily. */
const MAX_OUTPUT_TOKENS = 320;
const SAFETY_TOKENS = 64;
const PROMPT_BUDGET = CHAT_CTX_SIZE - MAX_OUTPUT_TOKENS - SAFETY_TOKENS;
/** Models stay loaded this long after an answer, so a follow-up question is quick. */
const IDLE_UNLOAD_MS = 90_000;
const KEEP_AWAKE_TAG = 'chat';

// ---------------------------------------------------------------------------
// Conversation store (lives in memory only; never written to disk)
// ---------------------------------------------------------------------------

export type Source = { visitId: string; label: string };

export type ChatMessage =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; kind: 'answer'; segments: AnswerSegment[]; sources: Source[] }
  | {
      id: string;
      role: 'assistant';
      kind: 'declined' | 'notFound' | 'withheld' | 'error';
      text: string;
      note?: string;
      sources?: Source[];
    };

export type ChatPhase =
  | { kind: 'preparing' }
  | { kind: 'indexing'; done: number; total: number }
  | { kind: 'searching' }
  | { kind: 'writing' };

export type ChatState = {
  messages: ChatMessage[];
  running: { phase: ChatPhase; cancel: () => void } | null;
};

let state: ChatState = { messages: [], running: null };
const listeners = new Set<() => void>();

function setState(next: Partial<ChatState>): void {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function push(message: ChatMessage): void {
  setState({ messages: [...state.messages, message] });
}

function setPhase(phase: ChatPhase): void {
  if (state.running) setState({ running: { ...state.running, phase } });
}

export function useChat(): ChatState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

export function clearChat(): void {
  if (!state.running) setState({ messages: [] });
}

let nextId = 0;
const newId = () => `m${++nextId}`;

class CancelledError extends Error {
  constructor() {
    super('Cancelled');
  }
}

// ---------------------------------------------------------------------------
// Memory plan: MedPsy and the embedder together, or one after the other
// ---------------------------------------------------------------------------

let together: Promise<boolean> | null = null;

/**
 * Asks QVAC once per launch whether MedPsy (at the chat context size) and
 * EmbeddingGemma fit in memory together. Anything but a clear "fits" means
 * they are loaded one after the other.
 */
function canLoadTogether(): Promise<boolean> {
  together ??= assessModelFit({
    models: [LOAD_SPECS.chat.options, LOAD_SPECS.embedder.options],
  })
    .then((result) => {
      console.log(
        `[chat] model fit: ${result.verdict} (${result.models.map((m) => m.status).join(', ')})`,
      );
      return result.verdict === 'fits';
    })
    .catch((error) => {
      console.warn(`[chat] model fit check failed, loading one at a time: ${errorMessage(error)}`);
      return false;
    });
  return together;
}

let idleTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleIdleUnload(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (!state.running) void unloadAll().catch(() => undefined);
  }, IDLE_UNLOAD_MS);
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

type Ctx = { isCancelled: () => boolean; onRequest: (id: string) => void };

function check(ctx: Ctx): void {
  if (ctx.isCancelled()) throw new CancelledError();
}

async function retrieve(ctx: Ctx, embedderId: string, question: string): Promise<Hit[]> {
  const started = Date.now();
  try {
    await syncIndex(embedderId, (p: SyncProgress) => {
      if (p.total > 0 && p.done < p.total) setPhase({ kind: 'indexing', ...p });
    });
    check(ctx);
    setPhase({ kind: 'searching' });
    const hits = await searchVisits(embedderId, question, TOP_K);
    console.log(`[chat] search done: ${hits.length} hits in ${Date.now() - started} ms`);
    return hits;
  } finally {
    await closeIndex();
  }
}

type Prepared = { excerpts: ChatExcerpt[]; labels: Map<string, string>; sources: Source[]; texts: string[] };

/** Groups hits by visit (oldest visit first) and labels each visit for citing. */
async function prepare(hits: Hit[]): Promise<Prepared> {
  const visits = new Map<string, Visit>();
  for (const hit of hits) {
    if (visits.has(hit.visitId)) continue;
    const visit = await getVisit(hit.visitId).catch(() => null);
    if (visit) visits.set(hit.visitId, visit);
  }
  const kept = hits.filter((h) => visits.has(h.visitId));
  const labels = visitLabels([...visits.values()]);
  const order = [...visits.values()].sort((a, b) => a.date.localeCompare(b.date)).map((v) => v.id);
  const excerpts = order.map((id) => ({
    label: labels.get(id)!,
    // The summary document first, then transcript chunks in visit order.
    texts: kept
      .filter((h) => h.visitId === id)
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
      .map((h) => h.content),
  }));
  return {
    excerpts,
    labels,
    sources: order.map((visitId) => ({ visitId, label: labels.get(visitId)! })),
    texts: kept.map((h) => h.content),
  };
}

/** Drops the lowest-scoring hits until the prompt fits the context budget. */
async function fitHits(modelId: string, hits: Hit[], question: string): Promise<Prepared> {
  let used = [...hits].sort((a, b) => b.score - a.score);
  while (used.length) {
    const prepared = await prepare(used);
    const tokens = await calcTokens({
      modelId,
      history: [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        { role: 'user', content: chatMessage(prepared.excerpts, question) },
      ],
    });
    if (tokens <= PROMPT_BUDGET || used.length === 1) {
      console.log(`[chat] ${used.length} excerpts, ${tokens} prompt tokens (budget ${PROMPT_BUDGET})`);
      return prepared;
    }
    used = used.slice(0, -1);
  }
  return prepare([]);
}

/** Reads only `final.contentText`; any reasoning is dropped and never stored or shown. */
async function generate(ctx: Ctx, modelId: string, user: string): Promise<string> {
  check(ctx);
  const started = Date.now();
  const run = completion({
    modelId,
    // No system message: the load-time `system_prompt` applies.
    history: [{ role: 'user', content: user }],
    stream: true,
    captureThinking: true,
    generationParams: { predict: MAX_OUTPUT_TOKENS, reasoning_budget: 0 },
  });
  ctx.onRequest(run.requestId);
  const final = await run.final;
  if (ctx.isCancelled() || final.stopReason === 'cancelled') throw new CancelledError();
  console.log(
    `[chat] answer done, stop=${final.stopReason ?? '?'}, ${final.stats?.generatedTokens ?? '?'} tokens in ${Date.now() - started} ms`,
  );
  return stripThinking(final.contentText);
}

async function answer(ctx: Ctx, modelId: string, hits: Hit[], question: string): Promise<ChatMessage> {
  setPhase({ kind: 'writing' });
  const prepared = await fitHits(modelId, hits, question);
  if (!prepared.excerpts.length) {
    return { id: newId(), role: 'assistant', kind: 'notFound', text: NOT_FOUND_ANSWER };
  }
  const text = await generate(ctx, modelId, chatMessage(prepared.excerpts, question));

  if (!text || isNotFound(text)) {
    return {
      id: newId(),
      role: 'assistant',
      kind: 'notFound',
      text: NOT_FOUND_ANSWER,
      sources: prepared.sources,
    };
  }
  // Every medicine, dose, schedule, test and condition in the answer must be
  // in the excerpts the model was given.
  const problem = unsupportedMention(withoutCitations(text), prepared.texts);
  if (problem) {
    console.log('[safety] chat answer withheld (unsupported mention)');
    return {
      id: newId(),
      role: 'assistant',
      kind: 'withheld',
      text: 'The answer was not shown because it did not match your visit notes.',
      note: `${problem} Please check the visit itself or ask your doctor.`,
      sources: prepared.sources,
    };
  }
  return {
    id: newId(),
    role: 'assistant',
    kind: 'answer',
    segments: parseAnswer(text, prepared.labels),
    sources: prepared.sources,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Answers a question from the patient's own visits. Advice-seeking questions
 * are declined before any model loads. The question and answer are kept in
 * memory for this session only.
 */
export async function askQuestion(question: string): Promise<void> {
  const q = question.trim();
  if (!q || state.running) return;
  push({ id: newId(), role: 'user', text: q });

  const pre = precheckQuestion(q);
  if (pre.declined) {
    console.log(`[chat] question declined before generation (${pre.reason})`);
    push({ id: newId(), role: 'assistant', kind: 'declined', text: DECLINE_MESSAGE, note: DECLINE_HINT });
    return;
  }

  if (idleTimer) clearTimeout(idleTimer);
  let cancelled = false;
  let requestId: string | null = null;
  setState({
    running: {
      phase: { kind: 'preparing' },
      cancel: () => {
        cancelled = true;
        if (requestId) void cancel({ requestId }).catch(() => undefined);
      },
    },
  });
  const ctx: Ctx = {
    isCancelled: () => cancelled,
    onRequest: (id) => {
      requestId = id;
    },
  };

  await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
  const started = Date.now();
  try {
    let reply: ChatMessage;
    if (await canLoadTogether()) {
      reply = await withModels([LOAD_SPECS.chat, LOAD_SPECS.embedder], async ([llmId, embedderId]) => {
        const hits = await retrieve(ctx, embedderId, q);
        check(ctx);
        if (!hits.length) return noVisitsMessage();
        return answer(ctx, llmId, hits, q);
      });
    } else {
      const hits = await withModels([LOAD_SPECS.embedder], ([embedderId]) => retrieve(ctx, embedderId, q));
      check(ctx);
      // Loading the medical model takes a few seconds; say what is happening.
      if (hits.length) setPhase({ kind: 'writing' });
      reply = hits.length
        ? await withModels([LOAD_SPECS.chat], ([llmId]) => answer(ctx, llmId, hits, q))
        : noVisitsMessage();
    }
    check(ctx);
    console.log(`[chat] ${reply.role === 'assistant' ? reply.kind : ''} in ${Date.now() - started} ms`);
    push(reply);
  } catch (error) {
    if (!(cancelled || error instanceof CancelledError)) {
      console.warn(`[chat] failed: ${errorMessage(error)}`);
      push({
        id: newId(),
        role: 'assistant',
        kind: 'error',
        text: 'Something went wrong while answering. Please try again.',
        note: errorMessage(error),
      });
    }
  } finally {
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    setState({ running: null });
    scheduleIdleUnload();
  }
}

function noVisitsMessage(): ChatMessage {
  return {
    id: newId(),
    role: 'assistant',
    kind: 'notFound',
    text: NOT_FOUND_ANSWER,
    // Only explain the limit when there is nothing to search at all.
    note: indexedVisitCount() ? undefined : 'Only visits with a finished summary can be searched.',
  };
}
