// Keyword search over saved visits. Pure functions, no React Native imports.

import type { Visit } from '../storage/visits';
import { speakerLabel } from '../transcript/speakers';
import { formatDuration } from '../utils/time';

/** A [start, end) character range in the original text. */
export type Range = [number, number];

/**
 * Lowercased, accent-free text plus, for each of its characters, where that
 * character came from in the original. `null` maps mean "same positions"
 * (plain ASCII, the common case).
 */
type Folded = { text: string; starts: number[] | null; ends: number[] | null };

const ASCII = /^[\x00-\x7f]*$/;
const MARKS = /\p{M}/gu;

function foldChar(char: string): string {
  return char
    .normalize('NFD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'");
}

/** Case- and accent-insensitive form of `text`: "Café" → "cafe". */
function fold(text: string): Folded {
  if (ASCII.test(text)) return { text: text.toLowerCase(), starts: null, ends: null };
  let out = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const char of text) {
    const folded = foldChar(char);
    for (let k = 0; k < folded.length; k++) {
      starts.push(i);
      ends.push(i + char.length);
    }
    out += folded;
    i += char.length;
  }
  return { text: out, starts, ends };
}

/** The query split into search words, folded the same way as the text. Empty means "no search". */
export function queryTerms(query: string): string[] {
  const terms = fold(query)
    .text.split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
  return [...new Set(terms)];
}

export type SearchField = 'title' | 'summary' | 'nextStep' | 'transcript';

type IndexedText = {
  field: SearchField;
  /** Shown above the snippet: "Summary", "Next step", "Doctor · 2:15". */
  label: string;
  text: string;
  folded: Folded;
  /** Where this line starts in the recording, for transcript lines. */
  startMs?: number;
};

export type IndexedVisit = { visit: Visit; title: IndexedText; texts: IndexedText[] };

function indexed(field: SearchField, label: string, text: string, startMs?: number): IndexedText {
  return { field, label, text, folded: fold(text), startMs };
}

/**
 * Folds every searchable text once, so typing a query only runs `indexOf`.
 * Searches the title, summary, next steps and transcript; not the safety
 * check's removed items, which the patient was told to ignore.
 */
export function buildSearchIndex(visits: Visit[]): IndexedVisit[] {
  return visits.map((visit) => {
    const texts: IndexedText[] = [];
    for (const item of visit.summary ?? []) texts.push(indexed('summary', 'Summary', item.text));
    for (const step of visit.nextSteps ?? []) texts.push(indexed('nextStep', 'Next step', step.text));
    for (const turn of visit.turns ?? []) {
      const label = `${speakerLabel(turn.speakerId, visit.speakerMap)} · ${formatDuration(turn.startMs)}`;
      texts.push(indexed('transcript', label, turn.text, turn.startMs));
    }
    return { visit, title: indexed('title', 'Title', visit.title), texts };
  });
}

/** Every place any term occurs in `entry`, in original-text positions, sorted and merged. */
function findRanges(entry: IndexedText, terms: string[]): Range[] {
  const { text, starts, ends } = entry.folded;
  const ranges: Range[] = [];
  for (const term of terms) {
    let at = text.indexOf(term);
    while (at !== -1) {
      const last = at + term.length - 1;
      ranges.push([starts ? starts[at] : at, ends ? ends[last] : last + 1]);
      at = text.indexOf(term, at + term.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const range of ranges) {
    const prev = merged[merged.length - 1];
    if (prev && range[0] <= prev[1]) prev[1] = Math.max(prev[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

export type Snippet = {
  field: SearchField;
  label: string;
  /** A short window of the text around the first match, with "…" where it was cut. */
  text: string;
  highlights: Range[];
  startMs?: number;
};

export type SearchResult = {
  visit: Visit;
  titleHighlights: Range[];
  /** The first few matching lines, in visit order (summary, next steps, transcript). */
  snippets: Snippet[];
  /** How many lines matched in all, title excluded. */
  matchingLines: number;
};

const BEFORE = 40;
const WINDOW = 150;

/** Cuts `text` to about WINDOW characters around the first range, at word boundaries. */
export function makeSnippet(text: string, ranges: Range[]): { text: string; highlights: Range[] } {
  if (text.length <= WINDOW) return { text, highlights: ranges };
  const first = ranges[0];
  let start = Math.max(0, first[0] - BEFORE);
  if (start > 0) {
    const space = text.indexOf(' ', start);
    start = space !== -1 && space < first[0] ? space + 1 : start;
  }
  let end = Math.min(text.length, Math.max(start + WINDOW, first[1]));
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    end = space > first[1] ? space : end;
  }
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const shift = prefix.length - start;
  const highlights: Range[] = ranges
    .filter(([s, e]) => e > start && s < end)
    .map(([s, e]) => [Math.max(s, start) + shift, Math.min(e, end) + shift]);
  return { text: prefix + text.slice(start, end) + suffix, highlights };
}

const MAX_SNIPPETS = 3;

/**
 * Visits where every search word appears somewhere (title, summary, next
 * steps or transcript), in the order given. Words match anywhere inside a
 * word, ignoring case and accents: "head" finds "Headache".
 */
export function searchVisits(index: IndexedVisit[], query: string): SearchResult[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const results: SearchResult[] = [];
  for (const entry of index) {
    const all = [entry.title, ...entry.texts];
    const everyTermFound = terms.every((term) => all.some((t) => t.folded.text.includes(term)));
    if (!everyTermFound) continue;

    const snippets: Snippet[] = [];
    let matchingLines = 0;
    for (const t of entry.texts) {
      const ranges = findRanges(t, terms);
      if (ranges.length === 0) continue;
      matchingLines++;
      if (snippets.length < MAX_SNIPPETS) {
        snippets.push({ field: t.field, label: t.label, startMs: t.startMs, ...makeSnippet(t.text, ranges) });
      }
    }
    results.push({
      visit: entry.visit,
      titleHighlights: findRanges(entry.title, terms),
      snippets,
      matchingLines,
    });
  }
  return results;
}
