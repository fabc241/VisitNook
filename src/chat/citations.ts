// Visit labels the model cites ("[Visit – Mar 3, 2026]") and turning its
// answer into text and tappable citations. Pure TypeScript, unit-tested.

import { normalize } from '../guardrails/normalize';

export type LabelledVisit = { id: string; date: string };

/** `[Visit – Mar 3, 2026]` without the brackets. English, so it matches the prompt. */
function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * One label per visit, unique among `visits`. Two visits on the same day get
 * the time added; two in the same minute get a number.
 */
export function visitLabels(visits: LabelledVisit[]): Map<string, string> {
  const byDate = new Map<string, LabelledVisit[]>();
  for (const v of visits) {
    const key = dateLabel(v.date);
    byDate.set(key, [...(byDate.get(key) ?? []), v]);
  }
  const labels = new Map<string, string>();
  for (const [day, group] of byDate) {
    if (group.length === 1) {
      labels.set(group[0].id, `Visit – ${day}`);
      continue;
    }
    const seen = new Map<string, number>();
    for (const v of [...group].sort((a, b) => a.date.localeCompare(b.date))) {
      const base = `Visit – ${day}, ${timeLabel(v.date)}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      labels.set(v.id, n === 1 ? base : `${base} (${n})`);
    }
  }
  return labels;
}

export type AnswerSegment =
  | { kind: 'text'; text: string }
  | { kind: 'cite'; label: string; visitId: string };

/** "[Visit – Mar 3, 2026]", "[Visit - Mar 3 2026]", "[visit: Mar 3, 2026]" … */
const CITATION = /\s*\[\s*visit\b\s*[-–—:]?\s*([^\]\n]*?)\s*\]/gi;

/** The label's words after "Visit", for matching the model's spelling loosely. */
function citationKey(label: string): string {
  return normalize(label.replace(/^\s*visit\b\s*[-–—:]?/i, ''));
}

/**
 * Splits the answer into text and citations. A citation that names none of
 * the given visits is dropped, and the same visit cited twice in a row is
 * shown once.
 */
export function parseAnswer(answer: string, labels: Map<string, string>): AnswerSegment[] {
  const byKey = new Map<string, { visitId: string; label: string }>();
  for (const [visitId, label] of labels) byKey.set(citationKey(label), { visitId, label });

  const segments: AnswerSegment[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last?.kind === 'text') last.text += text;
    else segments.push({ kind: 'text', text });
  };

  let at = 0;
  for (const m of answer.matchAll(CITATION)) {
    pushText(answer.slice(at, m.index));
    at = m.index + m[0].length;
    const hit = byKey.get(normalize(m[1]));
    if (!hit) continue;
    const last = segments[segments.length - 1];
    const prev = segments[segments.length - 2];
    const repeat =
      (last?.kind === 'cite' && last.visitId === hit.visitId) ||
      (last?.kind === 'text' && /^[\s.,;:]*$/.test(last.text) && prev?.kind === 'cite' && prev.visitId === hit.visitId);
    if (!repeat) segments.push({ kind: 'cite', label: hit.label, visitId: hit.visitId });
  }
  pushText(answer.slice(at));

  // Tidy the text pieces: no space before punctuation left by a dropped citation.
  for (const s of segments) if (s.kind === 'text') s.text = s.text.replace(/\s+([.,;:!?])/g, '$1');
  const first = segments[0];
  if (first?.kind === 'text') first.text = first.text.trimStart();
  const last = segments[segments.length - 1];
  if (last?.kind === 'text') last.text = last.text.trimEnd();
  return segments.filter((s) => s.kind === 'cite' || s.text.length > 0);
}

/** The answer's words with every citation taken out, for the safety check. */
export function withoutCitations(answer: string): string {
  return answer.replace(CITATION, ' ').replace(/\s+([.,;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
}

export function citedVisitIds(segments: AnswerSegment[]): string[] {
  return [...new Set(segments.flatMap((s) => (s.kind === 'cite' ? [s.visitId] : [])))];
}

/** The model's fixed reply when the excerpts do not answer the question. */
export const NOT_FOUND_ANSWER = "I couldn't find that in your visit notes.";

export function isNotFound(answer: string): boolean {
  const s = normalize(answer);
  return /\b(couldn t|could not|can t|cannot|did not|didn t) find\b/.test(s) && /\bvisit notes?\b/.test(s);
}
