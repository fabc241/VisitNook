// What a shared visit contains, as plain text and as HTML for the PDF.
// Pure TypeScript, unit-tested; the share sheet itself is src/features/share.ts.
//
// Shared: the checked summary, next steps (with the doctor's day) and a
// disclaimer. Never shared: removed items or model reasoning (which is never
// stored). The transcript only when the patient turns it on.

import { describeFollowUp } from '../guardrails/check';
import { dayLabel, reminderCandidates, reminderKey } from '../reminders/plan';
import type { NextStep, Visit } from '../storage/visits';
import { speakerLabel } from '../transcript/speakers';
import { formatDuration } from '../utils/time';

export type ShareOptions = { includeTranscript: boolean };

export const DISCLAIMER =
  'Written by the Visit Notes app on my iPhone from a recording of the visit. ' +
  'It can contain mistakes. It is not medical advice.';

/** The visit has a safety-checked summary to share. */
export function canShare(visit: Visit): boolean {
  return Boolean(visit.summary && visit.nextSteps && visit.removed);
}

function visitDate(visit: Visit): string {
  return new Date(visit.date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "in 2 weeks · around Thu, Dec 3, 2026", or `null` when the doctor gave no day. */
function whenText(step: NextStep, days: Map<string, string>): string | null {
  const day = days.get(reminderKey(step));
  const parts = [step.followUp ? describeFollowUp(step.followUp) : null, day ? `around ${dayLabel(day)}` : null];
  const text = parts.filter(Boolean).join(' · ');
  return text || null;
}

function stepDays(visit: Visit): Map<string, string> {
  return new Map(reminderCandidates(visit).map((c) => [c.key, c.suggestedDay]));
}

function transcriptRows(visit: Visit) {
  return (visit.turns ?? []).map((turn) => ({
    speaker: speakerLabel(turn.speakerId, visit.speakerMap),
    time: formatDuration(turn.startMs),
    text: turn.text.trim(),
  }));
}

/** A safe file name: "Visit on 21 Nov 2026" → "Visit on 21 Nov 2026.pdf". */
export function pdfFileName(visit: Visit): string {
  const base = visit.title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${(base || 'Visit notes').slice(0, 80)}.pdf`;
}

export function visitShareText(visit: Visit, { includeTranscript }: ShareOptions): string {
  const days = stepDays(visit);
  const blocks: string[] = [`${visit.title}\n${visitDate(visit)}`];

  const summary = visit.summary ?? [];
  blocks.push(
    ['What my doctor said:', ...(summary.length ? summary.map((s) => `- ${s.text}`) : ['- No summary points.'])].join('\n'),
  );

  const steps = visit.nextSteps ?? [];
  blocks.push(
    [
      'Next steps:',
      ...(steps.length
        ? steps.map((s) => {
            const when = whenText(s, days);
            return `- ${s.text}${when ? ` (${when})` : ''}`;
          })
        : ['- No next steps were given.']),
    ].join('\n'),
  );

  if (includeTranscript) {
    const rows = transcriptRows(visit);
    if (rows.length) {
      blocks.push(['Transcript:', ...rows.map((r) => `${r.speaker} (${r.time}): ${r.text}`)].join('\n'));
    }
  }

  blocks.push(DISCLAIMER);
  return blocks.join('\n\n');
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function visitShareHtml(visit: Visit, { includeTranscript }: ShareOptions): string {
  const e = escapeHtml;
  const days = stepDays(visit);
  const summary = visit.summary ?? [];
  const steps = visit.nextSteps ?? [];

  const summaryHtml = summary.length
    ? `<ul>${summary
        .map((s) => `<li><p>${e(s.text)}</p><p class="quote">Doctor: “${e(s.evidence)}”</p></li>`)
        .join('')}</ul>`
    : '<p class="empty">No summary points.</p>';

  const stepsHtml = steps.length
    ? `<ul>${steps
        .map((s) => {
          const when = whenText(s, days);
          return (
            `<li><p>${e(s.text)}</p>` +
            (when ? `<p class="when">${e(when)}</p>` : '') +
            `<p class="quote">Doctor: “${e(s.evidence)}”</p></li>`
          );
        })
        .join('')}</ul>`
    : '<p class="empty">No next steps were given.</p>';

  const rows = includeTranscript ? transcriptRows(visit) : [];
  const transcriptHtml = rows.length
    ? `<h2>Transcript</h2><table>${rows
        .map(
          (r) =>
            `<tr><td class="who">${e(r.speaker)}<br><span class="time">${e(r.time)}</span></td><td>${e(r.text)}</td></tr>`,
        )
        .join('')}</table>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(visit.title)}</title>
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1f2328; font-size: 12pt; line-height: 1.45; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 2pt; }
  .meta { color: #59636e; margin: 0 0 18pt; }
  h2 { font-size: 14pt; margin: 18pt 0 6pt; padding-bottom: 3pt; border-bottom: 1px solid #d1d9e0; }
  ul { margin: 0; padding-left: 16pt; }
  li { margin: 0 0 8pt; page-break-inside: avoid; }
  li p { margin: 0; }
  .when { font-weight: 600; color: #1a7f37; }
  .quote { color: #59636e; font-style: italic; font-size: 10.5pt; }
  .empty { color: #59636e; }
  table { border-collapse: collapse; width: 100%; font-size: 10.5pt; }
  td { vertical-align: top; padding: 4pt 6pt; border-bottom: 1px solid #eef1f4; }
  tr { page-break-inside: avoid; }
  .who { width: 60pt; font-weight: 600; white-space: nowrap; }
  .time { font-weight: 400; color: #59636e; }
  .disclaimer { margin-top: 24pt; color: #59636e; font-size: 9.5pt; }
</style>
</head>
<body>
<h1>${e(visit.title)}</h1>
<p class="meta">${e(visitDate(visit))} · ${e(formatDuration(visit.durationMs))} recording</p>
<h2>What my doctor said</h2>
${summaryHtml}
<h2>Next steps</h2>
${stepsHtml}
${transcriptHtml}
<p class="disclaimer">${e(DISCLAIMER)}</p>
</body>
</html>`;
}
