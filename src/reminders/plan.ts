// Calendar reminders for the doctor's follow-ups. Pure TypeScript, unit-tested;
// the calendar write itself is in src/features/reminders.ts.

import { describeFollowUp } from '../guardrails/check';
import { dueDate, hashText } from '../prep/list';
import type { FollowUp, NextStep, Visit } from '../storage/visits';
import { transcriptLines } from '../summary/transcript';
import { datesIn } from './dates';

/** Saved in `visit.reminders`, keyed by `reminderKey(step)`. */
export type ReminderRecord = {
  /** The calendar day the patient confirmed, as local `YYYY-MM-DD`. */
  day: string;
  /** ISO timestamp of when the event was written. */
  addedAt: string;
  /** EventKit's id for the event, when it returns one. */
  eventId?: string;
};

/** Where the suggested day comes from: a date the doctor named, or the visit date + a time frame. */
export type ReminderSource = { kind: 'date'; said: string } | { kind: 'interval'; followUp: FollowUp };

export type ReminderCandidate = {
  key: string;
  step: NextStep;
  source: ReminderSource;
  /** The day the doctor gave, as local `YYYY-MM-DD`. */
  suggestedDay: string;
  /** The suggested day is before today, so the sheet starts on today instead. */
  passed: boolean;
  added?: ReminderRecord;
};

/** The calendar event's title. Kept general so a lock screen or widget shows nothing medical. */
export const EVENT_TITLE = 'Doctor follow-up';

/** The alert fires at 9 AM the day before (minutes from the all-day event's midnight start). */
export const ALERT_OFFSET_MINUTES = -15 * 60;

/** The sheet does not go further out than this. */
export const MAX_DAYS_AHEAD = 5 * 366;

export const reminderKey = (step: Pick<NextStep, 'text'>) => hashText(step.text);

/** Local `YYYY-MM-DD` for a date. */
export function toDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local midnight of a `YYYY-MM-DD` day. */
export function fromDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(day: string, days: number): string {
  const date = fromDay(day);
  date.setDate(date.getDate() + days);
  return toDay(date);
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`). Safe across daylight-saving changes. */
export function daysBetween(from: string, to: string): number {
  const utc = (day: string) => {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** Keeps a day between today and `MAX_DAYS_AHEAD` from today. */
export function clampDay(day: string, today: string): string {
  const last = addDays(today, MAX_DAYS_AHEAD);
  if (day < today) return today;
  if (day > last) return last;
  return day;
}

/**
 * A date named in the step's quote that the doctor also said in the
 * transcript. Only one: two different dates are left for the patient to pick.
 */
function doctorDate(step: NextStep, visitDay: string, doctorText: string) {
  const inQuote = datesIn(step.evidence, visitDay);
  if (inQuote.length !== 1) return null;
  const said = new Set(datesIn(doctorText, visitDay).map((d) => d.day));
  return said.has(inQuote[0].day) ? inQuote[0] : null;
}

/**
 * The visit's checked next steps with a day from the doctor: a date they
 * named ("the third of December"), else their time frame ("in two weeks").
 * Steps with neither, and a summary that has not been safety-checked, give nothing.
 */
export function reminderCandidates(visit: Visit, now = new Date()): ReminderCandidate[] {
  if (!visit.removed || !visit.nextSteps) return [];
  const today = toDay(now);
  const visitDay = toDay(new Date(visit.date));
  const doctorText = transcriptLines(visit.turns ?? [], visit.speakerMap)
    .filter((l) => l.speaker === 'Doctor')
    .map((l) => l.text)
    .join('\n');
  const candidates: ReminderCandidate[] = [];
  for (const step of visit.nextSteps) {
    const date = doctorDate(step, visitDay, doctorText);
    let source: ReminderSource;
    let suggestedDay: string;
    if (date) {
      source = { kind: 'date', said: date.said };
      suggestedDay = date.day;
    } else if (step.followUp) {
      source = { kind: 'interval', followUp: step.followUp };
      suggestedDay = toDay(new Date(dueDate(visit.date, step.followUp)));
    } else {
      continue;
    }
    const key = reminderKey(step);
    candidates.push({
      key,
      step,
      source,
      suggestedDay,
      passed: suggestedDay < today,
      added: visit.reminders?.[key],
    });
  }
  return candidates;
}

/** The day the confirmation sheet starts on. */
export function initialDay(candidate: ReminderCandidate, now = new Date()): string {
  return clampDay(candidate.suggestedDay, toDay(now));
}

/** What is written to the calendar. The note holds only the doctor's instruction. */
export function eventDetails(step: NextStep, day: string) {
  const start = fromDay(day);
  return {
    title: EVENT_TITLE,
    notes: step.text,
    startDate: start,
    endDate: start,
    allDay: true,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    alarms: [{ relativeOffset: ALERT_OFFSET_MINUTES }],
  };
}

/** "Tue, Mar 3, 2026" */
export function dayLabel(day: string): string {
  return fromDay(day).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "Your doctor said in 2 weeks, which is Tue, Mar 17, 2026." */
export function suggestionText(candidate: ReminderCandidate): string {
  const { source } = candidate;
  const said =
    source.kind === 'date'
      ? `Your doctor said “${source.said}”`
      : `Your doctor said ${describeFollowUp(source.followUp)}`;
  const label = dayLabel(candidate.suggestedDay);
  return candidate.passed
    ? `${said}, which was ${label}. That day has passed, so pick a new one.`
    : `${said}, which is ${label}.`;
}
