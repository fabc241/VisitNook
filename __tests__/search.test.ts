import { buildSearchIndex, makeSnippet, queryTerms, searchVisits, type Range } from '../src/search/visits';
import type { Visit } from '../src/storage/visits';

const march: Visit = {
  id: 'a',
  date: '2026-03-03T10:00:00.000Z',
  title: 'Visit on Mar 3, 2026',
  durationMs: 600_000,
  status: 'summarized',
  speakerMap: { '0': 'doctor', '1': 'me' },
  turns: [
    { speakerId: 0, startMs: 0, endMs: 4_000, text: 'Good morning. What brings you in today?' },
    { speakerId: 1, startMs: 4_000, endMs: 9_000, text: "I've had Headaches for a week, mostly at night." },
    { speakerId: 0, startMs: 75_000, endMs: 80_000, text: 'Start lisinopril ten milligrams once a day.' },
  ],
  summary: [{ text: 'Your blood pressure is a little high.', evidence: 'pressure is high' }],
  nextSteps: [{ text: 'Come back in two weeks.', evidence: 'come back in two weeks' }],
};

const april: Visit = {
  id: 'b',
  date: '2026-04-10T10:00:00.000Z',
  title: 'Visite chez le médecin',
  durationMs: 300_000,
  status: 'transcribed',
  turns: [{ speakerId: 0, startMs: 0, endMs: 3_000, text: 'Prenez un café le matin, pas le soir.' }],
};

const recordedOnly: Visit = {
  id: 'c',
  date: '2026-05-01T10:00:00.000Z',
  title: 'Visit on May 1, 2026',
  durationMs: 60_000,
  status: 'recorded',
};

const index = buildSearchIndex([march, april, recordedOnly]);

function highlighted(text: string, ranges: Range[]): string[] {
  return ranges.map(([s, e]) => text.slice(s, e));
}

describe('queryTerms', () => {
  it('lowercases, drops accents and edge punctuation, and dedupes', () => {
    expect(queryTerms('  Café, CAFE "headache"? ')).toEqual(['cafe', 'headache']);
  });

  it('is empty for blank or punctuation-only queries', () => {
    expect(queryTerms('   ')).toEqual([]);
    expect(queryTerms('?! ,')).toEqual([]);
  });
});

describe('searchVisits', () => {
  it('finds a word said in the transcript, ignoring case', () => {
    const results = searchVisits(index, 'headaches');
    expect(results.map((r) => r.visit.id)).toEqual(['a']);
    const [snippet] = results[0].snippets;
    expect(snippet.field).toBe('transcript');
    expect(snippet.label).toBe('Me · 0:04');
    expect(highlighted(snippet.text, snippet.highlights)).toEqual(['Headaches']);
  });

  it('matches part of a word', () => {
    const results = searchVisits(index, 'lisino');
    expect(results.map((r) => r.visit.id)).toEqual(['a']);
    expect(results[0].snippets[0].label).toBe('Doctor · 1:15');
  });

  it('ignores accents both ways and highlights the original characters', () => {
    const plain = searchVisits(index, 'cafe');
    expect(plain.map((r) => r.visit.id)).toEqual(['b']);
    const { text, highlights } = plain[0].snippets[0];
    expect(highlighted(text, highlights)).toEqual(['café']);

    const accented = searchVisits(index, 'MÉDECIN');
    expect(accented.map((r) => r.visit.id)).toEqual(['b']);
    expect(highlighted(accented[0].visit.title, accented[0].titleHighlights)).toEqual(['médecin']);
  });

  it('searches the summary and next steps', () => {
    expect(searchVisits(index, 'blood pressure')[0].snippets[0]).toMatchObject({
      field: 'summary',
      label: 'Summary',
    });
    expect(searchVisits(index, 'weeks')[0].snippets[0].field).toBe('nextStep');
  });

  it('needs every word, but they may be in different places', () => {
    expect(searchVisits(index, 'headaches weeks').map((r) => r.visit.id)).toEqual(['a']);
    expect(searchVisits(index, 'headaches café')).toEqual([]);
  });

  it('matches the title, which holds the date', () => {
    const results = searchVisits(index, 'may');
    expect(results.map((r) => r.visit.id)).toEqual(['c']);
    expect(results[0].snippets).toEqual([]);
    expect(highlighted(recordedOnly.title, results[0].titleHighlights)).toEqual(['May']);
  });

  it('highlights every occurrence of every word, merged where they overlap', () => {
    const results = searchVisits(index, 'day to toda');
    const turn = results[0].snippets.find((s) => s.text.startsWith('Good'));
    // "to", "toda" and "day" all overlap inside "today".
    expect(turn && highlighted(turn.text, turn.highlights)).toEqual(['today']);
    expect(results[0].matchingLines).toBe(2);
  });

  it('returns nothing for an empty query or an unknown word', () => {
    expect(searchVisits(index, '')).toEqual([]);
    expect(searchVisits(index, 'metformin')).toEqual([]);
  });
});

describe('makeSnippet', () => {
  const long =
    'At the start of the visit we talked about the weather and your trip and the long drive here, ' +
    'and then about your sleep. Your blood pressure is a little high today so we will recheck it ' +
    'in two weeks and see how things look after that, and we can talk about the results then.';

  it('cuts long text around the first match, at word boundaries, with ellipses', () => {
    const at = long.indexOf('pressure');
    const { text, highlights } = makeSnippet(long, [[at, at + 'pressure'.length]]);
    expect(text.startsWith('…')).toBe(true);
    expect(text.endsWith('…')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(155);
    expect(highlighted(text, highlights)).toEqual(['pressure']);
    expect(text).not.toMatch(/^… /);
  });

  it('keeps short text whole', () => {
    expect(makeSnippet('Come back in two weeks.', [[13, 16]])).toEqual({
      text: 'Come back in two weeks.',
      highlights: [[13, 16]],
    });
  });
});
