import {
  DISCLAIMER,
  canShare,
  escapeHtml,
  pdfFileName,
  visitShareHtml,
  visitShareText,
} from '../src/share/visit';
import type { Visit } from '../src/storage/visits';

const visit: Visit = {
  id: 'v',
  date: new Date(2026, 10, 21, 2, 6).toISOString(),
  title: 'Visit on 21 Nov 2026',
  durationMs: 21_000,
  status: 'summarized',
  turns: [
    { speakerId: 0, startMs: 900, endMs: 5000, text: 'I had a terrible headache.' },
    { speakerId: 1, startMs: 14_000, endMs: 20_000, text: 'Okay, we will check into two weeks in the third of December' },
  ],
  speakerMap: { '0': 'me', '1': 'doctor' },
  summary: [{ text: 'Your blood pressure is <fine> & steady.', evidence: 'blood pressure looks fine' }],
  nextSteps: [
    {
      text: 'Wait for appointment in 2 weeks',
      evidence: 'we will check in 2 weeks in third of December',
      followUp: { amount: 2, unit: 'weeks' },
    },
    { text: 'Keep a headache diary', evidence: 'keep a headache diary' },
  ],
  removed: [
    { section: 'summary', kind: 'item', text: 'Start metformin', evidence: 'x', reason: 'Mentions a medicine' },
  ],
};

describe('sharing a visit as text', () => {
  const text = visitShareText(visit, { includeTranscript: false });

  it('has the summary, next steps with the doctor’s day, and the disclaimer', () => {
    expect(text).toContain('Visit on 21 Nov 2026\nSaturday, November 21, 2026');
    expect(text).toContain('What my doctor said:\n- Your blood pressure is <fine> & steady.');
    expect(text).toContain('- Wait for appointment in 2 weeks (in 2 weeks · around Thu, Dec 3, 2026)');
    expect(text).toContain('- Keep a headache diary\n');
    expect(text.endsWith(DISCLAIMER)).toBe(true);
  });

  it('leaves out removed items, quotes and the transcript', () => {
    expect(text).not.toContain('metformin');
    expect(text).not.toContain('Mentions a medicine');
    expect(text).not.toContain('Doctor: “');
    expect(text).not.toContain('terrible headache');
  });

  it('adds the transcript only when asked', () => {
    const withTranscript = visitShareText(visit, { includeTranscript: true });
    expect(withTranscript).toContain('Transcript:\nMe (0:00): I had a terrible headache.\nDoctor (0:14): Okay');
  });

  it('says so when there is nothing', () => {
    const empty = visitShareText({ ...visit, summary: [], nextSteps: [] }, { includeTranscript: false });
    expect(empty).toContain('- No summary points.');
    expect(empty).toContain('- No next steps were given.');
  });
});

describe('sharing a visit as PDF', () => {
  const html = visitShareHtml(visit, { includeTranscript: false });

  it('escapes everything from the visit', () => {
    expect(html).toContain('Your blood pressure is &lt;fine&gt; &amp; steady.');
    expect(html).not.toContain('<fine>');
    expect(escapeHtml(`<script>"a" & 'b'</script>`)).toBe(
      '&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;',
    );
  });

  it('shows the doctor’s quotes and days, not removed items', () => {
    expect(html).toContain('Doctor: “we will check in 2 weeks in third of December”');
    expect(html).toContain('<p class="when">in 2 weeks · around Thu, Dec 3, 2026</p>');
    expect(html).not.toContain('metformin');
    expect(html).not.toContain('Transcript');
  });

  it('adds the transcript only when asked', () => {
    const withTranscript = visitShareHtml(visit, { includeTranscript: true });
    expect(withTranscript).toContain('<h2>Transcript</h2>');
    expect(withTranscript).toContain('<td class="who">Doctor<br><span class="time">0:14</span></td>');
  });
});

describe('helpers', () => {
  it('only a checked summary can be shared', () => {
    expect(canShare(visit)).toBe(true);
    expect(canShare({ ...visit, removed: undefined })).toBe(false);
    expect(canShare({ ...visit, summary: undefined })).toBe(false);
  });

  it('makes a safe PDF file name', () => {
    expect(pdfFileName(visit)).toBe('Visit on 21 Nov 2026.pdf');
    expect(pdfFileName({ ...visit, title: 'a/b: "c"?' })).toBe('a b c.pdf');
    expect(pdfFileName({ ...visit, title: '  ' })).toBe('Visit notes.pdf');
  });
});
