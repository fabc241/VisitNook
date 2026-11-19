import type { FollowUp, FollowUpUnit, NextStep, SummaryItem } from '../storage/visits';

export type SummaryResult = { summary: SummaryItem[]; nextSteps: NextStep[] };

/**
 * Removes any reasoning that slipped into the answer text. The app reads only
 * `final.contentText`, so this is a fallback: a closed `<think>…</think>`
 * block anywhere, or an unclosed one that runs to the end, or a stray
 * `</think>` whose opening tag was in the prompt template.
 */
export function stripThinking(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  out = out.replace(/<think>[\s\S]*$/i, '');
  const close = out.search(/<\/think>/i);
  if (close !== -1) out = out.slice(close + '</think>'.length);
  return out.trim();
}

/** The first balanced `{…}` in `text`, ignoring braces inside JSON strings. */
export function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

const UNITS: Record<string, FollowUpUnit> = {
  day: 'days',
  days: 'days',
  week: 'weeks',
  weeks: 'weeks',
  month: 'months',
  months: 'months',
  year: 'years',
  years: 'years',
};

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.replace(/\s+/g, ' ').trim();
  return s ? s : null;
}

function cleanFollowUp(value: unknown): FollowUp | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { amount, unit } = value as { amount?: unknown; unit?: unknown };
  const n = typeof amount === 'string' ? Number(amount) : amount;
  const u = typeof unit === 'string' ? UNITS[unit.trim().toLowerCase()] : undefined;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || !u) return undefined;
  return { amount: n, unit: u };
}

function cleanItem(value: unknown): SummaryItem | null {
  if (!value || typeof value !== 'object') return null;
  const { text, evidence } = value as { text?: unknown; evidence?: unknown };
  const t = cleanString(text);
  const e = cleanString(evidence);
  if (!t || !e) return null;
  return { text: t, evidence: e.replace(/^["“”']+|["“”']+$/g, '').trim() || e };
}

function cleanList<T>(value: unknown, clean: (v: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(clean).filter((v): v is T => v !== null);
}

/**
 * Reads the model's answer into a `SummaryResult`. Items without text or
 * evidence are dropped; a malformed `followUp` is dropped from its step.
 * Returns `null` when there is no JSON object with both lists.
 */
export function parseSummary(raw: string): SummaryResult | null {
  const json = firstJsonObject(stripThinking(raw));
  if (!json) return null;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const { summary, nextSteps } = data as { summary?: unknown; nextSteps?: unknown };
  if (!Array.isArray(summary) || !Array.isArray(nextSteps)) return null;
  return {
    summary: cleanList(summary, cleanItem),
    nextSteps: cleanList(nextSteps, (v) => {
      const item = cleanItem(v);
      if (!item) return null;
      const followUp = cleanFollowUp((v as { followUp?: unknown }).followUp);
      return followUp ? { ...item, followUp } : item;
    }),
  };
}

function key(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Joins the results of several parts in order, dropping repeated items. Used when no merge pass runs. */
export function concatResults(parts: SummaryResult[], maxSummary = 8): SummaryResult {
  const dedupe = <T extends SummaryItem>(items: T[]): T[] => {
    const seen = new Set<string>();
    return items.filter((item) => {
      const k = key(item.text);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  return {
    summary: dedupe(parts.flatMap((p) => p.summary)).slice(0, maxSummary),
    nextSteps: dedupe(parts.flatMap((p) => p.nextSteps)),
  };
}
