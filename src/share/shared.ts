// What "Share with people" puts in the patient's shared visits store, one
// record per visit. Pure TypeScript, unit-tested; storing it is
// src/p2p/shared.ts.
//
// Shared: the title and date, the checked summary and next steps (with the
// doctor's quotes), and each follow-up's time frame and day. The transcript
// only when the patient turns it on. Never shared: the recording, items the
// safety check removed, open questions, calendar reminders, or anything else
// not copied below.

import { reminderCandidates, reminderKey } from '../reminders/plan';
import type { FollowUp, Visit } from '../storage/visits';
import { canShare } from './visit';

/** Bump when the record's shape changes, so recipients can tell versions apart. */
export const SHARED_RECORD_VERSION = 1;

export type SharedSummaryItem = { text: string; evidence: string };

export type SharedNextStep = SharedSummaryItem & {
  followUp?: FollowUp;
  /** The follow-up day the doctor gave or that the time frame points to, local `YYYY-MM-DD`. */
  day?: string;
};

/** `patient` is the person sharing; `unknown` is a voice they never named. */
export type SharedSpeaker = 'patient' | 'doctor' | 'unknown';

export type SharedTranscriptLine = { speaker: SharedSpeaker; startMs: number; text: string };

export type SharedVisitRecord = {
  version: typeof SHARED_RECORD_VERSION;
  id: string;
  title: string;
  /** ISO timestamp of when the recording started. */
  date: string;
  durationMs: number;
  /** When the summary was written; changes whenever the summary is rewritten. */
  summarizedAt: string | null;
  summary: SharedSummaryItem[];
  nextSteps: SharedNextStep[];
  /** `null` when the patient did not include the transcript. */
  transcript: SharedTranscriptLine[] | null;
};

/** The visit's switch is on. It is only stored while the visit has a checked summary. */
export function isShared(visit: Visit): boolean {
  return visit.sharing?.shared === true;
}

function speakerOf(visit: Visit, speakerId: number): SharedSpeaker {
  const role = visit.speakerMap?.[String(speakerId)];
  if (role === 'me') return 'patient';
  if (role === 'doctor') return 'doctor';
  return 'unknown';
}

/**
 * The record to store for this visit, or `null` when nothing should be
 * stored: the switch is off, or there is no safety-checked summary (for
 * example while it is being written again).
 */
export function sharedVisitRecord(visit: Visit): SharedVisitRecord | null {
  if (!isShared(visit) || !canShare(visit)) return null;

  const days = new Map(reminderCandidates(visit).map((c) => [c.key, c.suggestedDay]));

  const nextSteps = (visit.nextSteps ?? []).map((step): SharedNextStep => {
    const shared: SharedNextStep = { text: step.text, evidence: step.evidence };
    if (step.followUp) shared.followUp = { amount: step.followUp.amount, unit: step.followUp.unit };
    const day = days.get(reminderKey(step));
    if (day) shared.day = day;
    return shared;
  });

  const transcript = visit.sharing?.includeTranscript
    ? (visit.turns ?? []).map((turn) => ({
        speaker: speakerOf(visit, turn.speakerId),
        startMs: turn.startMs,
        text: turn.text.trim(),
      }))
    : null;

  return {
    version: SHARED_RECORD_VERSION,
    id: visit.id,
    title: visit.title,
    date: visit.date,
    durationMs: visit.durationMs,
    summarizedAt: visit.summarizedAt ?? null,
    summary: (visit.summary ?? []).map((item) => ({ text: item.text, evidence: item.evidence })),
    nextSteps,
    transcript,
  };
}
