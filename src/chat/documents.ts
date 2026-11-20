// The search documents made from one visit: its checked summary and next
// steps, and the transcript in chunks of about 15 doctor turns. Pure
// TypeScript, unit-tested.

import { checkSummary } from '../guardrails/check';
import type { Visit } from '../storage/visits';
import { formatLines, transcriptLines, type Line } from '../summary/transcript';

export type IndexDoc = { id: string; content: string };

/** EmbeddingGemma's prompt for stored documents. */
export const EMBED_DOC_PREFIX = 'title: none | text: ';
/** EmbeddingGemma's prompt for search queries. */
export const EMBED_QUERY_PREFIX = 'task: search result | query: ';

export const DOCTOR_TURNS_PER_CHUNK = 15;
/** Keeps each chunk well inside the embedder's context and the chat prompt budget. */
export const MAX_CHUNK_CHARS = 2500;

const SEPARATOR = '~';

export function docId(visitId: string, part: string): string {
  return `${visitId}${SEPARATOR}${part}`;
}

export function visitIdOf(id: string): string {
  const at = id.indexOf(SEPARATOR);
  return at === -1 ? id : id.slice(0, at);
}

/** Only summarized visits are searchable: their transcript labels are settled. */
export function isSearchable(visit: Visit): boolean {
  return (
    visit.status === 'summarized' &&
    !!visit.summarizedAt &&
    !!visit.turns?.length &&
    !!visit.speakerMap
  );
}

/** Changes whenever the visit's indexed text could have changed. */
export function indexSignature(visit: Visit): string {
  return visit.summarizedAt ?? '';
}

/**
 * Only items the safety check kept. A summary saved before the check existed
 * has no `removed` list, so it is checked here first.
 */
function summaryContent(visit: Visit, lines: Line[]): string | null {
  let { summary = [], nextSteps = [] } = visit;
  if (!visit.removed) ({ summary, nextSteps } = checkSummary({ summary, nextSteps }, lines));
  const parts: string[] = [];
  if (summary.length) {
    parts.push(['Summary:', ...summary.map((s) => `- ${s.text}`)].join('\n'));
  }
  if (nextSteps.length) {
    parts.push(['Next steps:', ...nextSteps.map((s) => `- ${s.text}`)].join('\n'));
  }
  return parts.length ? parts.join('\n\n') : null;
}

/** Consecutive transcript lines with at most 15 doctor lines and ~2,500 characters each. */
export function chunkLines(lines: Line[]): Line[][] {
  const chunks: Line[][] = [];
  let current: Line[] = [];
  let chars = 0;
  let doctorTurns = 0;
  const close = () => {
    if (current.length) chunks.push(current);
    current = [];
    chars = 0;
    doctorTurns = 0;
  };
  for (const line of lines) {
    const size = line.speaker.length + 2 + line.text.length + 1;
    if (current.length && chars + size > MAX_CHUNK_CHARS) close();
    current.push(line);
    chars += size;
    if (line.speaker === 'Doctor') doctorTurns++;
    if (doctorTurns >= DOCTOR_TURNS_PER_CHUNK) close();
  }
  close();
  return chunks;
}

export function visitDocuments(visit: Visit): IndexDoc[] {
  if (!isSearchable(visit)) return [];
  const docs: IndexDoc[] = [];
  const lines = transcriptLines(visit.turns!, visit.speakerMap);
  const summary = summaryContent(visit, lines);
  if (summary) docs.push({ id: docId(visit.id, 's'), content: summary });
  chunkLines(lines).forEach((chunk, i) => {
    docs.push({ id: docId(visit.id, `t${i}`), content: formatLines(chunk) });
  });
  return docs;
}
