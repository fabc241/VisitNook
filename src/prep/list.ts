// The Prep tab's list: the patient's own questions, questions from past
// visits the doctor did not answer, and what the doctor asked the patient to
// do. Pure TypeScript, unit-tested.

import { visitLabels } from '../chat/citations';
import { isSearchable } from '../chat/documents';
import { checkSummary } from '../guardrails/check';
import type { FollowUp, NextStep, Visit } from '../storage/visits';
import { transcriptLines } from '../summary/transcript';

/** Prep looks at this many of the most recent summarized visits. */
export const PREP_VISIT_COUNT = 5;

export type OwnQuestion = { id: string; text: string; createdAt: string };

/** Saved as `visits/prep.json`. `done` maps an item key to when it was ticked. */
export type PrepStore = { own: OwnQuestion[]; done: Record<string, string> };

export const EMPTY_STORE: PrepStore = { own: [], done: {} };

export type VisitRef = { visitId: string; label: string };

export type PrepItem =
  | { key: string; kind: 'own'; id: string; text: string; done: boolean }
  | ({ key: string; kind: 'question'; text: string; evidence: string; done: boolean } & VisitRef)
  | ({ key: string; kind: 'followUp'; text: string; followUp?: FollowUp; due?: string; done: boolean } & VisitRef);

export type PrepList = {
  own: PrepItem[];
  questions: PrepItem[];
  followUps: PrepItem[];
  /** Visits prep looked at, newest first. */
  visits: VisitRef[];
  /** Of those, how many still need their questions looked for. */
  pending: number;
};

/** A short, stable id for a piece of text (djb2). */
export function hashText(text: string): string {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export const ownKey = (id: string) => `own:${id}`;
const questionKey = (visitId: string, evidence: string) => `q:${visitId}:${hashText(evidence)}`;
const followUpKey = (visitId: string, text: string) => `f:${visitId}:${hashText(text)}`;

/** The visit id inside an item key, or `null` for the patient's own questions. */
export function visitIdOfKey(key: string): string | null {
  const m = /^[qf]:(.+):[^:]+$/.exec(key);
  return m ? m[1] : null;
}

/** The most recent summarized visits, newest first. */
export function prepVisits(visits: Visit[]): Visit[] {
  return visits
    .filter(isSearchable)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, PREP_VISIT_COUNT);
}

/** The visit's open questions are missing or belong to an older summary. */
export function needsQuestions(visit: Visit): boolean {
  return !visit.openQuestions || visit.openQuestionsFor !== visit.summarizedAt;
}

/** The visit date plus the doctor's time frame, as an ISO date. */
export function dueDate(visitDate: string, { amount, unit }: FollowUp): string {
  const d = new Date(visitDate);
  if (unit === 'days') d.setDate(d.getDate() + amount);
  else if (unit === 'weeks') d.setDate(d.getDate() + amount * 7);
  else if (unit === 'months') d.setMonth(d.getMonth() + amount);
  else d.setFullYear(d.getFullYear() + amount);
  return d.toISOString();
}

/** Only next steps the safety check kept (a summary from before the check is checked here). */
function keptNextSteps(visit: Visit): NextStep[] {
  const { summary = [], nextSteps = [] } = visit;
  if (visit.removed || !visit.turns || !visit.speakerMap) return nextSteps;
  return checkSummary({ summary, nextSteps }, transcriptLines(visit.turns, visit.speakerMap)).nextSteps;
}

export function buildPrepList(visits: Visit[], store: PrepStore): PrepList {
  const recent = prepVisits(visits);
  const labels = visitLabels(recent);
  const isDone = (key: string) => key in store.done;

  const questions: PrepItem[] = [];
  const followUps: PrepItem[] = [];
  for (const visit of recent) {
    const ref: VisitRef = { visitId: visit.id, label: labels.get(visit.id)! };
    // Questions found for an older summary are not shown: the voices may have changed.
    if (!needsQuestions(visit)) {
      for (const q of visit.openQuestions ?? []) {
        const key = questionKey(visit.id, q.evidence);
        questions.push({ key, kind: 'question', text: q.text, evidence: q.evidence, done: isDone(key), ...ref });
      }
    }
    for (const step of keptNextSteps(visit)) {
      const key = followUpKey(visit.id, step.text);
      followUps.push({
        key,
        kind: 'followUp',
        text: step.text,
        followUp: step.followUp,
        due: step.followUp ? dueDate(visit.date, step.followUp) : undefined,
        done: isDone(key),
        ...ref,
      });
    }
  }

  const own: PrepItem[] = store.own.map((q) => {
    const key = ownKey(q.id);
    return { key, kind: 'own', id: q.id, text: q.text, done: isDone(key) };
  });

  return {
    own,
    questions,
    followUps,
    visits: recent.map((v) => ({ visitId: v.id, label: labels.get(v.id)! })),
    pending: recent.filter(needsQuestions).length,
  };
}

/** Ticks for visits that no longer exist are dropped. */
export function pruneDone(store: PrepStore, visitIds: Set<string>): PrepStore {
  const done = Object.fromEntries(
    Object.entries(store.done).filter(([key]) => {
      const id = visitIdOfKey(key);
      if (id === null) return store.own.some((q) => ownKey(q.id) === key);
      return visitIds.has(id);
    }),
  );
  return Object.keys(done).length === Object.keys(store.done).length ? store : { ...store, done };
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** The not-yet-ticked items as plain text for the share sheet. */
export function shareText(list: PrepList): string {
  const blocks: string[] = ['For my next doctor visit'];
  const questions = [...list.own, ...list.questions].filter((i) => !i.done);
  if (questions.length) {
    blocks.push(['Questions to ask:', ...questions.map((q) => `- ${q.text}`)].join('\n'));
  }
  const steps = list.followUps.filter((i) => !i.done);
  if (steps.length) {
    blocks.push(
      [
        'What my doctor asked me to do:',
        ...steps.map((s) => {
          const due = s.kind === 'followUp' && s.due ? ` (around ${shortDate(s.due)})` : '';
          const from = s.kind === 'own' ? '' : ` [${s.label}]`;
          return `- ${s.text}${due}${from}`;
        }),
      ].join('\n'),
    );
  }
  if (blocks.length === 1) blocks.push('Nothing left on my list.');
  blocks.push('Made with Visit Notes from my own visit recordings. Not medical advice.');
  return blocks.join('\n\n');
}
