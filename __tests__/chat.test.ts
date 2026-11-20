import {
  NOT_FOUND_ANSWER,
  citedVisitIds,
  isNotFound,
  parseAnswer,
  visitLabels,
  withoutCitations,
} from '../src/chat/citations';
import {
  DOCTOR_TURNS_PER_CHUNK,
  MAX_CHUNK_CHARS,
  chunkLines,
  docId,
  visitDocuments,
  visitIdOf,
} from '../src/chat/documents';
import { precheckQuestion } from '../src/chat/precheck';
import { unsupportedMention } from '../src/guardrails/check';
import type { Visit } from '../src/storage/visits';
import type { Line } from '../src/summary/transcript';

describe('advice pre-check', () => {
  it.each([
    'Should I double my dose?',
    'should i double my dose',
    'Can I stop taking my lisinopril?',
    'Is it safe to drink alcohol with this?',
    'Is it OK to skip a dose?',
    'How many pills should I take?',
    'Can I take ibuprofen?',
    'What if I take an extra pill tonight?',
    'Do I have diabetes?',
    'What’s wrong with me?',
    'Is this serious?',
    'What medicine do you recommend?',
    'Should I go to the ER?',
    'Did my doctor say I should double my dose?',
  ])('declines “%s”', (q) => {
    expect(precheckQuestion(q).declined).toBe(true);
  });

  it.each([
    'What did my doctor say about my dose?',
    'When did my doctor want me to come back?',
    'Did my doctor change my medicine?',
    'What tests did the doctor order?',
    'What did the doctor recommend for my back pain?',
    'What did I ask about my blood pressure?',
    'When is my next appointment?',
    'What was I told about exercise?',
  ])('allows “%s”', (q) => {
    expect(precheckQuestion(q).declined).toBe(false);
  });

  it('gives a dose reason for a dose change', () => {
    expect(precheckQuestion('Should I double my dose?')).toEqual({ declined: true, reason: 'dose' });
  });
});

describe('visit labels and citations', () => {
  const visits = [
    { id: 'a', date: '2026-03-03T10:00:00' },
    { id: 'b', date: '2026-04-10T09:30:00' },
    { id: 'c', date: '2026-04-10T15:05:00' },
  ];
  const labels = visitLabels(visits);

  it('labels by date, adding the time only when two visits share a day', () => {
    expect(labels.get('a')).toBe('Visit – Mar 3, 2026');
    expect(labels.get('b')).toBe('Visit – Apr 10, 2026, 9:30 AM');
    expect(labels.get('c')).toBe('Visit – Apr 10, 2026, 3:05 PM');
  });

  it('turns citations into links and keeps the text', () => {
    const segments = parseAnswer(
      'Your doctor said to come back in two weeks [Visit – Mar 3, 2026]. Your blood test was normal [Visit - Apr 10 2026, 9:30 AM].',
      labels,
    );
    expect(segments).toEqual([
      { kind: 'text', text: 'Your doctor said to come back in two weeks' },
      { kind: 'cite', label: 'Visit – Mar 3, 2026', visitId: 'a' },
      { kind: 'text', text: '. Your blood test was normal' },
      { kind: 'cite', label: 'Visit – Apr 10, 2026, 9:30 AM', visitId: 'b' },
      { kind: 'text', text: '.' },
    ]);
    expect(citedVisitIds(segments)).toEqual(['a', 'b']);
  });

  it('drops citations of visits that were not given, and repeats', () => {
    const segments = parseAnswer(
      'Rest your knee. [Visit – Jan 1, 2020] Ice it. [Visit – Mar 3, 2026] [Visit – Mar 3, 2026]',
      labels,
    );
    expect(segments).toEqual([
      { kind: 'text', text: 'Rest your knee. Ice it.' },
      { kind: 'cite', label: 'Visit – Mar 3, 2026', visitId: 'a' },
    ]);
  });

  it('strips citations for the safety check', () => {
    expect(withoutCitations('Take it daily [Visit – Mar 3, 2026].')).toBe('Take it daily.');
  });

  it('recognizes the not-found reply', () => {
    expect(isNotFound(NOT_FOUND_ANSWER)).toBe(true);
    expect(isNotFound('I could not find that in your visit notes.')).toBe(true);
    expect(isNotFound('Your doctor found nothing wrong [Visit – Mar 3, 2026].')).toBe(false);
  });
});

describe('search documents', () => {
  const visit: Visit = {
    id: '20260303T100000-abcd',
    date: '2026-03-03T10:00:00.000Z',
    title: 'Visit on Mar 3, 2026',
    durationMs: 600_000,
    status: 'summarized',
    summarizedAt: '2026-03-03T11:00:00.000Z',
    speakerMap: { '0': 'doctor', '1': 'me' },
    turns: [
      { speakerId: 0, startMs: 0, endMs: 1, text: 'Your blood pressure is high.' },
      { speakerId: 1, startMs: 1, endMs: 2, text: 'What should I do?' },
      { speakerId: 0, startMs: 2, endMs: 3, text: 'Come back in two weeks.' },
    ],
    summary: [{ text: 'Your blood pressure is high.', evidence: 'Your blood pressure is high.' }],
    nextSteps: [{ text: 'Come back in two weeks.', evidence: 'Come back in two weeks.' }],
    removed: [],
  };

  it('makes a summary document and transcript chunks with visit-linked ids', () => {
    const docs = visitDocuments(visit);
    expect(docs.map((d) => d.id)).toEqual([docId(visit.id, 's'), docId(visit.id, 't0')]);
    expect(docs[0].content).toBe(
      'Summary:\n- Your blood pressure is high.\n\nNext steps:\n- Come back in two weeks.',
    );
    expect(docs[1].content).toContain('Patient: What should I do?');
    expect(docs.every((d) => visitIdOf(d.id) === visit.id)).toBe(true);
  });

  it('indexes only summarized visits', () => {
    expect(visitDocuments({ ...visit, status: 'transcribed', summarizedAt: undefined })).toEqual([]);
  });

  it('checks a summary saved before the safety check existed', () => {
    const legacy: Visit = {
      ...visit,
      removed: undefined,
      summary: [{ text: 'Take metformin.', evidence: 'Your blood pressure is high.' }],
    };
    expect(visitDocuments(legacy)[0].content).not.toContain('metformin');
  });

  it('chunks at 15 doctor turns or the character limit', () => {
    const lines: Line[] = Array.from({ length: 40 }, (_, i) => ({
      speaker: i % 2 ? 'Patient' : 'Doctor',
      text: `Line ${i}.`,
    }));
    const chunks = chunkLines(lines);
    expect(chunks[0].filter((l) => l.speaker === 'Doctor')).toHaveLength(DOCTOR_TURNS_PER_CHUNK);
    expect(chunks.flat()).toHaveLength(40);

    const long: Line[] = Array.from({ length: 6 }, () => ({ speaker: 'Doctor', text: 'x'.repeat(1000) }));
    for (const chunk of chunkLines(long)) {
      expect(chunk.reduce((n, l) => n + l.text.length, 0)).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    }
  });
});

describe('chat answer check', () => {
  const sources = ['Doctor: Keep taking lisinopril 10 mg once a day.', 'Summary:\n- Your blood pressure is high.'];

  it('passes an answer that only names what the notes name', () => {
    expect(unsupportedMention('Your doctor said to keep taking lisinopril 10 mg once a day.', sources)).toBeNull();
  });

  it('flags an invented medicine or dose', () => {
    expect(unsupportedMention('You can also take metformin.', sources)).toMatch(/metformin/);
    expect(unsupportedMention('Take lisinopril 20 mg.', sources)).toMatch(/20 mg/);
  });
});
