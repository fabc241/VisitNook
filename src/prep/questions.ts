// Finding the questions a patient asked during a visit, the transcript around
// each one for the model to judge, and checking the model's rewording. Pure
// TypeScript, unit-tested.

import { unsupportedMention } from '../guardrails/check';
import { stemmedTokens, tokenize } from '../guardrails/normalize';
import type { OpenQuestion } from '../storage/visits';
import { firstJsonObject, stripThinking } from '../summary/parse';
import type { Line } from '../summary/transcript';

/** One question sentence in a "Patient:" line. `n` numbers them from 1 within a visit. */
export type Candidate = { n: number; line: number; sentence: number; text: string };

/** Visits with very many questions keep only the first ones, so prep stays quick. */
export const MAX_QUESTIONS_PER_VISIT = 24;
/** Lines of transcript shown before and after a question. */
export const LINES_BEFORE = 1;
export const LINES_AFTER = 6;
/** One excerpt never holds more than this many questions or lines. */
export const MAX_QUESTIONS_PER_EXCERPT = 8;
const MAX_LINES_PER_EXCERPT = 16;

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/** Sentence pieces, each with its end punctuation. */
export function sentences(text: string): string[] {
  return (text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
}

const FILLERS = new Set([
  'so', 'and', 'but', 'um', 'umm', 'uh', 'uhm', 'er', 'erm', 'okay', 'ok', 'well', 'oh', 'also',
  'doctor', 'doc', 'like', 'just', 'then', 'alright', 'right', 'yeah', 'yes', 'sorry', 'hmm',
]);

/** The sentence's words without the fillers it starts with ("So, um, can I…" → "can i …"). */
function coreWords(sentence: string): string[] {
  const words = tokenize(sentence);
  let i = 0;
  while (i < words.length && FILLERS.has(words[i])) i++;
  return words.slice(i);
}

const QUESTION_WORDS = new Set([
  'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how', 'should', 'shall', 'can',
  'could', 'may', 'might', 'will', 'would', 'is', 'are', 'am', 'was', 'were', 'do', 'does', 'did',
  'have', 'has', 'any', 'anything',
]);

/** Checking they heard right, or small talk: never a question to bring back. */
const NOT_QUESTIONS = new Set([
  'what', 'what was that', 'what did you say', 'is that right', 'is that it', 'is that ok',
  'is that okay', 'is that all', 'does that make sense', 'how are you', 'how are you doing',
  'how about you', 'and you', 'you know', 'can you repeat that', 'could you repeat that',
  'can you say that again', 'could you say that again', 'pardon', 'excuse me', 'really',
  'is it', 'are you sure', 'do you', 'what do you mean', 'right', 'huh',
]);

/**
 * A question the patient asked: a sentence ending in "?", or (when the
 * transcriber left out the punctuation) one that starts with a question word
 * and has no end mark at all. Echoes and small talk are left out.
 */
export function isQuestion(sentence: string): boolean {
  const s = sentence.trim();
  const words = coreWords(s);
  if (words.length < 3) return false;
  if (NOT_QUESTIONS.has(words.join(' '))) return false;
  if (/\?["')\]]*$/.test(s)) return true;
  return !/[.!]["')\]]*$/.test(s) && QUESTION_WORDS.has(words[0]);
}

/** Every question in the patient's lines, in visit order, at most `MAX_QUESTIONS_PER_VISIT`. */
export function findQuestions(lines: Line[]): Candidate[] {
  const found: Candidate[] = [];
  lines.forEach((line, i) => {
    if (line.speaker !== 'Patient') return;
    sentences(line.text).forEach((text, j) => {
      if (isQuestion(text) && found.length < MAX_QUESTIONS_PER_VISIT) {
        found.push({ n: found.length + 1, line: i, sentence: j, text });
      }
    });
  });
  return found;
}

// ---------------------------------------------------------------------------
// Excerpts
// ---------------------------------------------------------------------------

/** A stretch of the transcript around one or more questions. */
export type Excerpt = { from: number; to: number; questions: number[] };

/**
 * One window per question (a line before, six after), merged where they
 * overlap. A merged window stops growing at 8 questions or 16 lines; the
 * next one then starts fresh and may repeat a few lines.
 */
export function questionExcerpts(lines: Line[], candidates: Candidate[]): Excerpt[] {
  const excerpts: Excerpt[] = [];
  for (const c of candidates) {
    const from = Math.max(0, c.line - LINES_BEFORE);
    const to = Math.min(lines.length - 1, c.line + LINES_AFTER);
    const last = excerpts[excerpts.length - 1];
    if (
      last &&
      from <= last.to + 1 &&
      last.questions.length < MAX_QUESTIONS_PER_EXCERPT &&
      to - last.from + 1 <= MAX_LINES_PER_EXCERPT
    ) {
      last.to = Math.max(last.to, to);
      last.questions.push(c.n);
    } else {
      excerpts.push({ from, to, questions: [c.n] });
    }
  }
  return excerpts;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(' ', max);
  return `${text.slice(0, cut > max / 2 ? cut : max).trim()} …`;
}

/**
 * The excerpt as the model sees it. In a question line, each of this
 * excerpt's questions is marked "[Qn]" and kept whole, with the sentence just
 * before it; other lines are clipped to `maxLineChars`.
 */
export function formatExcerpt(
  lines: Line[],
  candidates: Candidate[],
  excerpt: Excerpt,
  maxLineChars: number,
): string {
  const mine = candidates.filter((c) => excerpt.questions.includes(c.n));
  const out: string[] = [];
  for (let i = excerpt.from; i <= excerpt.to; i++) {
    const line = lines[i];
    const marks = mine.filter((c) => c.line === i);
    if (!marks.length) {
      out.push(`${line.speaker}: ${clip(line.text, maxLineChars)}`);
      continue;
    }
    const parts = sentences(line.text);
    const keep = new Set<number>();
    for (const m of marks) {
      keep.add(m.sentence);
      if (m.sentence > 0) keep.add(m.sentence - 1);
    }
    const pieces: string[] = [];
    let previous = -1;
    for (const j of [...keep].sort((a, b) => a - b)) {
      if (j !== previous + 1) pieces.push('…');
      const mark = marks.find((m) => m.sentence === j);
      pieces.push(mark ? `[Q${mark.n}] ${parts[j]}` : clip(parts[j], maxLineChars));
      previous = j;
    }
    if (previous < parts.length - 1) pieces.push('…');
    out.push(`${line.speaker}: ${pieces.join(' ')}`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// The model's answer
// ---------------------------------------------------------------------------

export type Decision = { open: boolean; text: string };

/**
 * Reads `{"questions":[{"q":1,"open":true,"text":"…"}]}` into question
 * number → decision, for the numbers that were asked about. Returns `null`
 * when the answer is not that shape.
 */
export function parsePrepAnswer(raw: string, asked: number[]): Map<number, Decision> | null {
  const json = firstJsonObject(stripThinking(raw));
  if (!json) return null;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const list = (data as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) return null;
  const wanted = new Set(asked);
  const decisions = new Map<number, Decision>();
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const { q, open, answered, text } = entry as { q?: unknown; open?: unknown; answered?: unknown; text?: unknown };
    const n = typeof q === 'string' ? Number(q.replace(/^q/i, '')) : q;
    if (typeof n !== 'number' || !wanted.has(n) || decisions.has(n)) continue;
    let isOpen: boolean | null = typeof open === 'boolean' ? open : null;
    // A model that wrote "answered" instead of "open".
    if (isOpen === null && typeof answered === 'boolean') isOpen = !answered;
    if (isOpen === null) continue;
    decisions.set(n, { open: isOpen, text: typeof text === 'string' ? text : '' });
  }
  return decisions;
}

// ---------------------------------------------------------------------------
// The patient's question, as shown
// ---------------------------------------------------------------------------

const MIN_KEPT_SHARE = 0.6;
const MAX_TEXT_CHARS = 200;

/** Short words that a rewording may add or drop freely. */
const GLUE = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'about', 'there', 'then', 'what', 'when', 'how',
  'can', 'could', 'should', 'would', 'will', 'does', 'did', 'are', 'was', 'were', 'have', 'has',
  'get', 'any', 'you', 'your', 'mine', 'myself', 'need', 'okay', 'still', 'also', 'from', 'into',
  'its', 'just', 'really', 'something', 'thing', 'some', 'like', 'one', 'they', 'them', 'their',
  'which', 'who', 'why', 'where', 'whether', 'doctor', 'is', 'am', 'be', 'it', 'do', 'to', 'of',
  'in', 'on', 'at', 'my', 'me', 'we', 'us', 'or', 'if', 'so', 'a', 'an', 'i',
]);

function contentWords(text: string): string[] {
  return stemmedTokens(text).filter((w) => w.length >= 3 && !GLUE.has(w));
}

/** The patient's own words, tidied: fillers off the front, a capital letter, a question mark. */
export function tidyQuestion(sentence: string): string {
  let s = sentence.replace(/\s+/g, ' ').trim();
  // Drop leading fillers, keeping the original spelling of what follows.
  for (;;) {
    const m = /^([A-Za-z]+)[,\s]+/.exec(s);
    if (!m || !FILLERS.has(m[1].toLowerCase()) || tokenize(s).length <= 3) break;
    s = s.slice(m[0].length);
  }
  s = s.replace(/[.!?,;:\s]+$/, '');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}?`;
}

/**
 * Why the model's rewording of `original` cannot be shown, or `null` when it
 * can: it must still be one question, name nothing medical the patient did
 * not say, and keep most of the patient's own words.
 */
export function rewordingProblem(rewording: string, original: string): string | null {
  const t = rewording.replace(/\s+/g, ' ').trim();
  if (!t) return 'empty';
  if (t.length > MAX_TEXT_CHARS) return 'too long';
  if (!t.endsWith('?') || (t.match(/\?/g) ?? []).length > 1) return 'not one question';
  if (unsupportedMention(t, [original])) return 'names something new';
  const said = new Set(contentWords(original));
  const words = contentWords(t);
  if (words.length && words.filter((w) => said.has(w)).length / words.length < MIN_KEPT_SHARE) {
    return 'different words';
  }
  return null;
}

/**
 * The open questions to save: every candidate the model marked open, worded
 * by the model when that wording passes the check, else in the patient's own
 * (tidied) words. Candidates the model did not decide on are left out.
 */
export function openQuestions(candidates: Candidate[], decisions: Map<number, Decision>): OpenQuestion[] {
  const out: OpenQuestion[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const d = decisions.get(c.n);
    if (!d?.open) continue;
    const rewording = d.text.replace(/\s+/g, ' ').trim();
    const text = rewordingProblem(rewording, c.text) ? tidyQuestion(c.text) : rewording;
    const key = tokenize(text).join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `q${c.n}`, text, evidence: c.text });
  }
  return out;
}
