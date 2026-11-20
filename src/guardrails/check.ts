// Deterministic safety check for the summary. Every statement must be backed
// by something the doctor said; anything else is removed with a reason the
// patient can read. Pure TypeScript: no React Native imports, unit-tested.

import type { FollowUp, NextStep, RemovedItem, SummaryItem } from '../storage/visits';
import type { SummaryResult } from '../summary/parse';
import type { Line } from '../summary/transcript';
import {
  ADVICE_PATTERN,
  CONDITIONS,
  IMPERATIVE_VERBS,
  INSTRUCTION_PATTERN,
  MEDICINES,
  MEDICINE_CATEGORIES,
  MEDICINE_SUFFIXES,
  NOT_MEDICINES,
  PARENT_CATEGORIES,
  TESTS,
  type Term,
} from './lexicons';
import { editDistance, normalize, stem, stemmedTokens, tokenize } from './normalize';

export type CheckedSummary = SummaryResult & { removed: RemovedItem[] };

/** Share of the quote's words that must appear, in one stretch, in what the doctor said. */
export const QUOTE_MATCH_THRESHOLD = 0.8;
/** Shorter quotes ("Yes, okay.") would match almost anything. */
export const MIN_QUOTE_WORDS = 3;

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export type EntityKind = 'medicine' | 'category' | 'dose' | 'frequency' | 'test' | 'condition';

export type Entity = {
  kind: EntityKind;
  /** Same key ⇔ same thing (synonyms share a key). */
  key: string;
  /** What the patient sees in the reason, e.g. "metformin" or "500 mg". */
  label: string;
  /** The normalized words that matched, for fuzzy comparison. */
  matched: string;
  /** For medicines: the key of the group it belongs to. */
  category?: string;
};

type Phrase = {
  tokens: string[];
  kind: EntityKind;
  key: string;
  label: string;
  category?: string;
};

function categoryKey(name: string): string {
  return `category:${normalize(name)}`;
}

function phrasesFor(terms: Term[], kind: EntityKind): Phrase[] {
  return terms.flatMap((term) => {
    const key = `${kind}:${normalize(term.variants[0])}`;
    const category = term.category ? categoryKey(term.category) : undefined;
    return term.variants.map((variant) => ({
      tokens: stemmedTokens(variant),
      kind,
      key,
      label: term.variants[0],
      category,
    }));
  });
}

/** All lexicon phrases, indexed by their first word, longest first. */
const PHRASE_INDEX: Map<string, Phrase[]> = (() => {
  const all = [
    ...phrasesFor(MEDICINES, 'medicine'),
    ...phrasesFor(MEDICINE_CATEGORIES, 'category').map((p) => ({ ...p, key: categoryKey(p.label) })),
    ...phrasesFor(TESTS, 'test'),
    ...phrasesFor(CONDITIONS, 'condition'),
  ];
  const index = new Map<string, Phrase[]>();
  for (const phrase of all) {
    if (!phrase.tokens.length) continue;
    const list = index.get(phrase.tokens[0]) ?? [];
    list.push(phrase);
    index.set(phrase.tokens[0], list);
  }
  for (const list of index.values()) list.sort((a, b) => b.tokens.length - a.tokens.length);
  return index;
})();

function suffixCategory(word: string): string | null | undefined {
  if (word.length < 6 || NOT_MEDICINES.has(word) || /\d/.test(word)) return undefined;
  for (const [suffix, category] of MEDICINE_SUFFIXES) {
    if (word.endsWith(suffix)) return category;
  }
  return undefined;
}

type FrequencyRule = { pattern: RegExp; key: (m: RegExpExecArray) => string };

/** Most specific first; each match is blanked out before the next rule runs. */
const FREQUENCY_RULES: FrequencyRule[] = [
  { pattern: /\b(\d+) times (?:a|per|each|every) (day|week|month)\b/g, key: (m) => `${m[1]}/${m[2]}` },
  { pattern: /\b(\d+) times (daily|weekly)\b/g, key: (m) => `${m[1]}/${m[2] === 'daily' ? 'day' : 'week'}` },
  { pattern: /\b(?:twice|2 times) (?:a|per|each|every) (day|week|month)\b/g, key: (m) => `2/${m[1]}` },
  { pattern: /\btwice (daily|weekly)\b/g, key: (m) => `2/${m[1] === 'daily' ? 'day' : 'week'}` },
  { pattern: /\b(?:once|1 time) (?:a|per|each|every) (day|week|month)\b/g, key: (m) => `1/${m[1]}` },
  { pattern: /\bonce (daily|weekly)\b/g, key: (m) => `1/${m[1] === 'daily' ? 'day' : 'week'}` },
  { pattern: /\b(?:every|each) (\d+) (hour|day|week|month)s?\b/g, key: (m) => `every ${m[1]} ${m[2]}` },
  { pattern: /\b(?:every day|each day|daily)\b/g, key: () => '1/day' },
  { pattern: /\b(?:every week|each week|weekly)\b/g, key: () => '1/week' },
  { pattern: /\b(?:every night|nightly|at bedtime|before bed|at night)\b/g, key: () => 'bedtime' },
  { pattern: /\bevery morning\b/g, key: () => 'morning' },
  { pattern: /\b(?:as needed|when needed|if needed)\b/g, key: () => 'as needed' },
];

const DOSE_PATTERN =
  /\b(\d+(?:\.\d+)?) (mg|mcg|g|ml|units|iu|percent|tablets?|pills?|capsules?|puffs?|drops?)\b/g;

function frequencies(text: string): Entity[] {
  let rest = text;
  const found: Entity[] = [];
  for (const rule of FREQUENCY_RULES) {
    for (const m of [...rest.matchAll(rule.pattern)]) {
      found.push({ kind: 'frequency', key: `frequency:${rule.key(m)}`, label: m[0], matched: m[0] });
      // Blank the match (same length, so later indices stay valid).
      rest = rest.slice(0, m.index) + ' '.repeat(m[0].length) + rest.slice(m.index + m[0].length);
    }
  }
  return found;
}

function doses(text: string): Entity[] {
  return [...text.matchAll(DOSE_PATTERN)].map((m) => {
    const label = `${m[1]} ${stem(m[2])}`;
    return { kind: 'dose', key: `dose:${label}`, label, matched: label };
  });
}

/** Medicines, medicine groups, doses, schedules, tests and conditions named in `text`. */
export function extractEntities(text: string): Entity[] {
  const raw = tokenize(text);
  const tokens = raw.map(stem);
  const entities: Entity[] = [];

  for (let i = 0; i < tokens.length; ) {
    const candidates = PHRASE_INDEX.get(tokens[i]) ?? [];
    const hit = candidates.find((p) => p.tokens.every((t, j) => tokens[i + j] === t));
    if (hit) {
      entities.push({
        kind: hit.kind,
        key: hit.key,
        label: hit.label,
        matched: tokens.slice(i, i + hit.tokens.length).join(' '),
        category: hit.category,
      });
      i += hit.tokens.length;
      continue;
    }
    const category = suffixCategory(tokens[i]);
    if (category !== undefined) {
      entities.push({
        kind: 'medicine',
        key: `medicine:${tokens[i]}`,
        label: raw[i],
        matched: tokens[i],
        category: category ? categoryKey(category) : undefined,
      });
    }
    i++;
  }

  const joined = raw.join(' ');
  return [...entities, ...doses(joined), ...frequencies(joined)];
}

// ---------------------------------------------------------------------------
// What the doctor said
// ---------------------------------------------------------------------------

export type DoctorFacts = {
  /** Stemmed words of each uninterrupted stretch of doctor lines. */
  doctorStreams: string[][];
  /** The same for the patient, to explain a quote taken from the wrong speaker. */
  patientStreams: string[][];
  keys: Set<string>;
  /** Medicine groups the doctor named, directly or through a medicine in that group. */
  categories: Set<string>;
  doctorWords: Set<string>;
};

function streams(lines: Line[], speaker: Line['speaker']): string[][] {
  const out: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.speaker !== speaker) {
      current = null;
      continue;
    }
    if (!current) {
      current = [];
      out.push(current);
    }
    current.push(...stemmedTokens(line.text));
  }
  return out;
}

export function doctorFacts(lines: Line[]): DoctorFacts {
  const doctorText = lines
    .filter((l) => l.speaker === 'Doctor')
    .map((l) => l.text)
    .join('\n');
  const entities = extractEntities(doctorText);
  const categories = new Set<string>();
  for (const e of entities) {
    if (e.kind === 'category') categories.add(e.key);
    if (e.category) categories.add(e.category);
  }
  for (const [child, parent] of Object.entries(PARENT_CATEGORIES)) {
    if (categories.has(categoryKey(child))) categories.add(categoryKey(parent));
  }
  const doctorStreams = streams(lines, 'Doctor');
  return {
    doctorStreams,
    patientStreams: streams(lines, 'Patient'),
    keys: new Set(entities.map((e) => e.key)),
    categories,
    doctorWords: new Set(doctorStreams.flat()),
  };
}

/** Medicine names are often spelled a little differently by the transcriber. */
function closeToDoctorWord(word: string, facts: DoctorFacts): boolean {
  if (word.length < 5 || word.includes(' ')) return false;
  const max = word.length >= 8 ? 2 : 1;
  for (const w of facts.doctorWords) {
    if (w[0] === word[0] && editDistance(w, word, max) <= max) return true;
  }
  return false;
}

export function isSupported(entity: Entity, facts: DoctorFacts): boolean {
  if (facts.keys.has(entity.key)) return true;
  switch (entity.kind) {
    case 'category':
      return facts.categories.has(entity.key);
    case 'medicine':
      return closeToDoctorWord(entity.matched, facts);
    default:
      return false;
  }
}

function entityReason(entity: Entity): string {
  switch (entity.kind) {
    case 'medicine':
    case 'category':
      return `Mentions a medicine (${entity.label}) the doctor did not say.`;
    case 'dose':
      return `Mentions a dose (${entity.label}) the doctor did not say.`;
    case 'frequency':
      return `Mentions how often (${entity.label}) the doctor did not say.`;
    case 'test':
      return `Mentions a test (${entity.label}) the doctor did not say.`;
    case 'condition':
      return `Mentions a condition (${entity.label}) the doctor did not say.`;
  }
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

/**
 * The best share of `quote`'s words found inside any window of the same
 * length in one stream (word order inside the window is ignored).
 */
export function quoteOverlap(quote: string[], streamsToSearch: string[][]): number {
  const n = quote.length;
  if (n === 0) return 0;
  const need = new Map<string, number>();
  for (const t of quote) need.set(t, (need.get(t) ?? 0) + 1);

  let best = 0;
  for (const stream of streamsToSearch) {
    const have = new Map<string, number>();
    let overlap = 0;
    for (let i = 0; i < stream.length; i++) {
      const added = stream[i];
      const h = (have.get(added) ?? 0) + 1;
      have.set(added, h);
      if (h <= (need.get(added) ?? 0)) overlap++;
      if (i >= n) {
        const dropped = stream[i - n];
        const d = have.get(dropped)!;
        have.set(dropped, d - 1);
        if (d <= (need.get(dropped) ?? 0)) overlap--;
      }
      if (overlap > best) best = overlap;
    }
    if (best === n) break;
  }
  return best / n;
}

/** `null` when the quote is found in what the doctor said, else the reason it failed. */
export function quoteProblem(evidence: string, facts: DoctorFacts): string | null {
  const quote = stemmedTokens(evidence);
  if (quote.length < MIN_QUOTE_WORDS) return 'The quote from the doctor is too short to check.';
  if (quoteOverlap(quote, facts.doctorStreams) >= QUOTE_MATCH_THRESHOLD) return null;
  if (quoteOverlap(quote, facts.patientStreams) >= QUOTE_MATCH_THRESHOLD) {
    return 'The quote is something you said, not the doctor.';
  }
  return 'Not found in what the doctor said.';
}

// ---------------------------------------------------------------------------
// Advice
// ---------------------------------------------------------------------------

function startsWithImperative(text: string): boolean {
  const first = tokenize(text).find((t) => t !== 'please' && t !== 'just' && t !== 'so');
  return first !== undefined && IMPERATIVE_VERBS.has(first);
}

/** The item tells the patient what to do. */
export function isAdvice(text: string): boolean {
  return ADVICE_PATTERN.test(normalize(text)) || startsWithImperative(text);
}

/** The doctor's words give an instruction or say what happens next. */
export function isInstruction(evidence: string): boolean {
  const s = normalize(evidence);
  return ADVICE_PATTERN.test(s) || INSTRUCTION_PATTERN.test(s) || startsWithImperative(evidence);
}

// ---------------------------------------------------------------------------
// Follow-up intervals
// ---------------------------------------------------------------------------

const INTERVAL_UNITS: Record<string, FollowUp['unit']> = {
  day: 'days',
  week: 'weeks',
  month: 'months',
  year: 'years',
};

/** Words that make "a day" a frequency ("twice a day") rather than an interval. */
const FREQUENCY_WORDS = new Set(['once', 'twice', 'time', 'times']);

/** Every time span named in `text`: "in 2 weeks", "next month", "6 to 8 weeks", "a fortnight". */
export function intervalsIn(text: string): FollowUp[] {
  const tokens = tokenize(text);
  const found: FollowUp[] = [];
  const num = (t: string | undefined) => (t !== undefined && /^\d+(\.\d+)?$/.test(t) ? Number(t) : null);

  tokens.forEach((token, i) => {
    if (token === 'fortnight') {
      found.push({ amount: 2, unit: 'weeks' });
      return;
    }
    const unit = INTERVAL_UNITS[stem(token)];
    if (!unit) return;
    const prev = tokens[i - 1];
    const amount = num(prev);
    if (amount !== null) {
      found.push({ amount, unit });
      // "6 to 8 weeks", "6 or 8 weeks"
      const low = num(tokens[i - 3]);
      if ((tokens[i - 2] === 'to' || tokens[i - 2] === 'or') && low !== null) {
        found.push({ amount: low, unit });
      }
    } else if (['a', 'an', 'next', 'another'].includes(prev ?? '') && !FREQUENCY_WORDS.has(tokens[i - 2] ?? '')) {
      found.push({ amount: 1, unit });
    } else if (prev === 'of' && tokens[i - 2] === 'couple') {
      found.push({ amount: 2, unit });
    }
  });
  return found;
}

function inDays({ amount, unit }: FollowUp): number | null {
  if (unit === 'days') return amount;
  if (unit === 'weeks') return amount * 7;
  return null;
}

function inMonths({ amount, unit }: FollowUp): number | null {
  if (unit === 'months') return amount;
  if (unit === 'years') return amount * 12;
  return null;
}

function sameInterval(a: FollowUp, b: FollowUp): boolean {
  if (a.unit === b.unit) return a.amount === b.amount;
  const days = [inDays(a), inDays(b)];
  if (days[0] !== null && days[1] !== null) return days[0] === days[1];
  const months = [inMonths(a), inMonths(b)];
  return months[0] !== null && months[1] !== null && months[0] === months[1];
}

export function followUpSupported(followUp: FollowUp, evidence: string): boolean {
  return intervalsIn(evidence).some((found) => sameInterval(found, followUp));
}

export function describeFollowUp({ amount, unit }: FollowUp): string {
  return `in ${amount} ${amount === 1 ? unit.replace(/s$/, '') : unit}`;
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/** `null` if the item is supported, else why it is removed. */
export function itemProblem(
  item: SummaryItem,
  section: RemovedItem['section'],
  facts: DoctorFacts,
): string | null {
  const quote = quoteProblem(item.evidence, facts);
  if (quote) return quote;

  const unsupported = extractEntities(item.text).find((e) => !isSupported(e, facts));
  if (unsupported) return entityReason(unsupported);

  if (section === 'nextSteps') {
    if (!isInstruction(item.evidence)) return 'Not an instruction the doctor gave.';
  } else if (isAdvice(item.text) && !isInstruction(item.evidence)) {
    return 'Gives advice the doctor did not give.';
  }
  return null;
}

/**
 * Splits the model's summary into what is backed by the doctor's words and
 * what is removed. A next step whose time frame is not in the doctor's quote
 * is kept without the time frame, and the time frame is listed as removed.
 */
export function checkSummary(result: SummaryResult, lines: Line[]): CheckedSummary {
  const facts = doctorFacts(lines);
  const removed: RemovedItem[] = [];

  const summary = result.summary.filter((item) => {
    const reason = itemProblem(item, 'summary', facts);
    if (reason) removed.push({ section: 'summary', kind: 'item', text: item.text, evidence: item.evidence, reason });
    return !reason;
  });

  const nextSteps: NextStep[] = [];
  for (const step of result.nextSteps) {
    const reason = itemProblem(step, 'nextSteps', facts);
    if (reason) {
      removed.push({ section: 'nextSteps', kind: 'item', text: step.text, evidence: step.evidence, reason, followUp: step.followUp });
      continue;
    }
    if (step.followUp && !followUpSupported(step.followUp, step.evidence)) {
      const { followUp, ...rest } = step;
      removed.push({
        section: 'nextSteps',
        kind: 'followUp',
        text: step.text,
        evidence: step.evidence,
        followUp,
        reason: `The time frame (${describeFollowUp(followUp)}) is not in the doctor's words, so it was taken off this step.`,
      });
      nextSteps.push(rest);
      continue;
    }
    nextSteps.push(step);
  }

  return { summary, nextSteps, removed };
}
