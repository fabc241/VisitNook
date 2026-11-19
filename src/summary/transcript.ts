import type { SpeakerMap, Turn } from '../storage/visits';
import { roleOf } from '../transcript/speakers';

/** One labelled transcript line as the model sees it. */
export type Line = { speaker: 'Doctor' | 'Patient'; text: string };

/** Longer turns are split at sentence ends so a chunk boundary can fall inside them. */
const MAX_LINE_CHARS = 3000;

function splitLongText(text: string): string[] {
  if (text.length <= MAX_LINE_CHARS) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const pieces: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > MAX_LINE_CHARS) {
      pieces.push(current.trim());
      current = '';
    }
    // A single run-on "sentence" longer than the limit is cut at a space.
    let rest = sentence;
    while (rest.length > MAX_LINE_CHARS) {
      const cut = rest.lastIndexOf(' ', MAX_LINE_CHARS);
      const at = cut > 0 ? cut : MAX_LINE_CHARS;
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at);
    }
    current += rest;
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces;
}

/**
 * Turns into labelled lines. The voice saved as "me" is the Patient; every
 * other voice is the Doctor, matching the speaker screen.
 */
export function transcriptLines(turns: Turn[], map: SpeakerMap | undefined): Line[] {
  const lines: Line[] = [];
  for (const turn of turns) {
    const speaker = roleOf(turn.speakerId, map) === 'me' ? 'Patient' : 'Doctor';
    for (const text of splitLongText(turn.text)) lines.push({ speaker, text });
  }
  return lines;
}

export function hasDoctorLines(turns: Turn[], map: SpeakerMap | undefined): boolean {
  return turns.some((t) => roleOf(t.speakerId, map) !== 'me');
}

export function formatLines(lines: Line[]): string {
  return lines.map((l) => `${l.speaker}: ${l.text}`).join('\n');
}

/**
 * Splits `lines` into `count` consecutive groups of roughly equal length,
 * cutting only between lines. Never returns an empty group.
 */
export function splitLines(lines: Line[], count: number): Line[][] {
  const n = Math.max(1, Math.min(count, lines.length));
  const total = lines.reduce((sum, l) => sum + l.text.length + l.speaker.length + 3, 0);
  const groups: Line[][] = [];
  let current: Line[] = [];
  let used = 0;
  lines.forEach((line, i) => {
    current.push(line);
    used += line.text.length + line.speaker.length + 3;
    const groupsLeft = n - groups.length - 1;
    const linesLeft = lines.length - i - 1;
    const reachedTarget = used >= (total * (groups.length + 1)) / n;
    if (groupsLeft > 0 && (reachedTarget || linesLeft === groupsLeft)) {
      groups.push(current);
      current = [];
    }
  });
  if (current.length) groups.push(current);
  return groups;
}
