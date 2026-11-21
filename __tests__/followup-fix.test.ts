import {
  SAFETY_CHECK_VERSION,
  checkSummary,
  cleanQuote,
  uncheckedResult,
  withFollowUpFromQuote,
} from '../src/guardrails/check';
import { datesIn } from '../src/reminders/dates';
import { reminderCandidates, suggestionText } from '../src/reminders/plan';
import type { Visit } from '../src/storage/visits';
import type { Line } from '../src/summary/transcript';

const P = (text: string): Line => ({ speaker: 'Patient', text });
const D = (text: string): Line => ({ speaker: 'Doctor', text });

// The 21 Nov 2026 test visit, as transcribed on the phone.
const phoneLines: Line[] = [
  P('Hi Doc, I had a terrible headache yesterday and I was here for it.'),
  D('I um did you take some medicine?'),
  P("No doc, I didn't take anything. I was waiting for your visit."),
  D('Okay, we will check into two weeks in the third of December'),
];
const phoneStep = {
  text: 'Wait for appointment in 2 weeks',
  evidence: 'Doctor said we will check in 2 weeks in third of December',
};

describe('quotes the model narrated', () => {
  it.each([
    ['Doctor said we will check in 2 weeks', 'we will check in 2 weeks'],
    ['The doctor said that you should rest', 'you should rest'],
    ['Dr. says: come back Monday', 'come back Monday'],
    ['Doctor: “take it with food”', 'take it with food'],
    ['"we will see you soon"', 'we will see you soon'],
    ['my doctor told me to rest', 'to rest'],
  ])('%s → %s', (input, expected) => {
    expect(cleanQuote(input)).toBe(expected);
  });

  it('leaves a quote that does not start with an attribution alone', () => {
    expect(cleanQuote('Doctors usually say that')).toBe('Doctors usually say that');
    expect(cleanQuote('the doctor will call you')).toBe('the doctor will call you');
  });

  it('keeps the next step from the phone test, with the time frame from the quote', () => {
    const checked = checkSummary({ summary: [], nextSteps: [phoneStep] }, phoneLines);
    expect(checked.removed).toEqual([]);
    expect(checked.nextSteps).toEqual([
      {
        text: phoneStep.text,
        evidence: 'we will check in 2 weeks in third of December',
        followUp: { amount: 2, unit: 'weeks' },
      },
    ]);
  });

  it('still removes a narrated quote the doctor never said', () => {
    const checked = checkSummary(
      { summary: [], nextSteps: [{ text: 'Start a new pill', evidence: 'Doctor said start the new pill tomorrow' }] },
      phoneLines,
    );
    expect(checked.nextSteps).toEqual([]);
    expect(checked.removed[0].reason).toBe('Not found in what the doctor said.');
  });
});

describe('time frame taken from the doctor’s quote', () => {
  it('only when the quote names exactly one', () => {
    const step = { text: 'x', evidence: 'come back in two weeks' };
    expect(withFollowUpFromQuote(step).followUp).toEqual({ amount: 2, unit: 'weeks' });
    expect(withFollowUpFromQuote({ ...step, evidence: 'come back soon' }).followUp).toBeUndefined();
    expect(
      withFollowUpFromQuote({ ...step, evidence: 'in two weeks, or else in a month' }).followUp,
    ).toBeUndefined();
  });
});

describe('re-checking a saved summary', () => {
  it('puts removed items and time frames back for the newer check', () => {
    const result = uncheckedResult({
      summary: [{ text: 'a', evidence: 'qa' }],
      nextSteps: [{ text: 'b', evidence: 'qb' }],
      removed: [
        { section: 'summary', kind: 'item', text: 'c', evidence: 'qc', reason: 'r' },
        { section: 'nextSteps', kind: 'followUp', text: 'b', evidence: 'qb', followUp: { amount: 1, unit: 'months' }, reason: 'r' },
        { section: 'nextSteps', kind: 'item', text: 'd', evidence: 'qd', followUp: { amount: 3, unit: 'days' }, reason: 'r' },
      ],
    });
    expect(result.summary).toEqual([
      { text: 'a', evidence: 'qa' },
      { text: 'c', evidence: 'qc' },
    ]);
    expect(result.nextSteps).toEqual([
      { text: 'b', evidence: 'qb', followUp: { amount: 1, unit: 'months' } },
      { text: 'd', evidence: 'qd', followUp: { amount: 3, unit: 'days' } },
    ]);
  });

  it('brings back the phone test’s next step', () => {
    const saved = {
      summary: [],
      nextSteps: [],
      removed: [
        { section: 'nextSteps' as const, kind: 'item' as const, ...phoneStep, reason: 'Not found in what the doctor said.' },
      ],
    };
    const checked = checkSummary(uncheckedResult(saved), phoneLines);
    expect(checked.nextSteps).toHaveLength(1);
    expect(SAFETY_CHECK_VERSION).toBeGreaterThan(1);
  });
});

describe('spoken dates', () => {
  const from = '2026-11-21';
  it.each([
    ['in the third of December', '2026-12-03', 'the third of December'],
    ['on December 3rd', '2026-12-03', 'December 3rd'],
    ['see you Dec. 3', '2026-12-03', 'Dec. 3'],
    ['on the 3rd of Dec', '2026-12-03', 'the 3rd of Dec'],
    ['the twenty-first of January', '2027-01-21', 'the twenty-first of January'],
    ['come back 15 March', '2027-03-15', '15 March'],
    ['on the first of May', '2027-05-01', 'the first of May'],
    ['on the 21st of November', '2026-11-21', 'the 21st of November'],
    ['on the 20th of November', '2027-11-20', 'the 20th of November'],
  ])('%s → %s', (text, day, said) => {
    expect(datesIn(text, from)).toEqual([{ day, said }]);
  });

  it.each([
    'you may first try resting',
    'in two weeks',
    'march on to the next thing',
    'the thirty-first of November',
    'second opinion in december',
  ])('no date in “%s”', (text) => {
    expect(datesIn(text, from)).toEqual([]);
  });

  it('finds two different dates', () => {
    expect(datesIn('the 3rd of December or the 10th of December', from)).toHaveLength(2);
  });
});

describe('calendar day from a date the doctor said', () => {
  const turns = phoneLines.map((l, i) => ({
    speakerId: l.speaker === 'Doctor' ? 1 : 0,
    startMs: i * 1000,
    endMs: i * 1000 + 900,
    text: l.text,
  }));
  const base: Visit = {
    id: 'v',
    date: new Date(2026, 10, 21, 2, 6).toISOString(),
    title: 'Visit',
    durationMs: 21000,
    status: 'summarized',
    turns,
    speakerMap: { '0': 'me', '1': 'doctor' },
    summary: [],
    nextSteps: checkSummary({ summary: [], nextSteps: [phoneStep] }, phoneLines).nextSteps,
    removed: [],
  };

  it('uses the named date over the time frame', () => {
    const [c] = reminderCandidates(base, new Date(2026, 10, 21, 12));
    expect(c.suggestedDay).toBe('2026-12-03');
    expect(c.source).toEqual({ kind: 'date', said: 'third of December' });
    expect(suggestionText(c)).toBe('Your doctor said “third of December”, which is Thu, Dec 3, 2026.');
  });

  it('ignores a date in the quote that is not in the transcript', () => {
    const visit = {
      ...base,
      nextSteps: [{ ...base.nextSteps![0], evidence: 'we will check in 2 weeks in fourth of December' }],
    };
    const [c] = reminderCandidates(visit, new Date(2026, 10, 21, 12));
    expect(c.source.kind).toBe('interval');
    expect(c.suggestedDay).toBe('2026-12-05');
  });

  it('a step with a date but no time frame still gets a button', () => {
    const visit = { ...base, nextSteps: [{ text: 'Check-up', evidence: 'in the third of December' }] };
    expect(reminderCandidates(visit, new Date(2026, 10, 21, 12))[0].suggestedDay).toBe('2026-12-03');
  });
});
