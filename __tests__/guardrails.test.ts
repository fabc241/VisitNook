import {
  checkSummary,
  extractEntities,
  followUpSupported,
  intervalsIn,
  isAdvice,
  isInstruction,
} from '../src/guardrails/check';
import { normalize } from '../src/guardrails/normalize';
import type { NextStep, SummaryItem } from '../src/storage/visits';
import type { Line } from '../src/summary/transcript';

const doctor = (text: string): Line => ({ speaker: 'Doctor', text });
const patient = (text: string): Line => ({ speaker: 'Patient', text });

/**
 * Seeded visit. The doctor never names metformin, an MRI or a 20 mg dose.
 * "lisinoprel" is spelled the way the transcriber might hear it.
 */
const VISIT: Line[] = [
  doctor('Good morning. What brings you in today?'),
  patient("I've been having headaches, and I take ibuprofen sometimes. My dad had diabetes."),
  doctor('Your blood pressure is a little high today, one forty over ninety.'),
  doctor('I want you to start lisinoprel ten milligrams once a day.'),
  patient('Okay.'),
  doctor("Let's get some blood work done before your next visit."),
  doctor('Come back in two weeks so we can check your pressure again.'),
];

const BP_QUOTE = 'Your blood pressure is a little high today, 140 over 90.';
const START_QUOTE = 'I want you to start lisinoprel ten milligrams once a day.';
const LABS_QUOTE = "Let's get some blood work done before your next visit.";
const COME_BACK_QUOTE = 'Come back in two weeks so we can check your pressure again.';

function checkOne(item: SummaryItem, section: 'summary' | 'nextSteps', lines = VISIT) {
  const result =
    section === 'summary'
      ? checkSummary({ summary: [item], nextSteps: [] }, lines)
      : checkSummary({ summary: [], nextSteps: [item as NextStep] }, lines);
  return { kept: [...result.summary, ...result.nextSteps], removed: result.removed };
}

describe('normalize', () => {
  it('turns number words into digits', () => {
    expect(normalize('Take five hundred milligrams twice daily')).toBe('take 500 mg twice daily');
    expect(normalize('twenty-five')).toBe('25');
    expect(normalize('one hundred and fifty')).toBe('150');
    expect(normalize('one forty over ninety')).toBe('1 40 over 90');
    expect(normalize('one or two')).toBe('1 or 2');
  });

  it('keeps decimals, drops thousands commas and splits units', () => {
    expect(normalize('0.5mg')).toBe('0.5 mg');
    expect(normalize('1,000 mg')).toBe('1000 mg');
    expect(normalize('10 Milligrams')).toBe('10 mg');
    expect(normalize('2%')).toBe('2 percent');
  });

  it('strips punctuation and case', () => {
    expect(normalize('“Don’t stop — OK?”')).toBe('don t stop ok');
  });
});

describe('entities', () => {
  it('finds medicines by name, brand and drug-name ending', () => {
    const keys = extractEntities('Take Tylenol and atorvastatin, plus olmesartan.').map((e) => e.key);
    expect(keys).toEqual(
      expect.arrayContaining(['medicine:acetaminophen', 'medicine:atorvastatin', 'medicine:olmesartan']),
    );
  });

  it('finds doses and schedules', () => {
    const keys = extractEntities('Take 500 mg three times a day, and 2 puffs as needed.').map((e) => e.key);
    expect(keys).toEqual(
      expect.arrayContaining(['dose:500 mg', 'frequency:3/day', 'dose:2 puff', 'frequency:as needed']),
    );
  });

  it('does not count "twice a day" as "once a day"', () => {
    const keys = extractEntities('twice a day').map((e) => e.key);
    expect(keys).toEqual(['frequency:2/day']);
  });

  it('ignores ordinary words', () => {
    expect(extractEntities('Keep up your routine and imagine the plan.')).toEqual([]);
  });
});

describe('checkSummary', () => {
  it('keeps an item backed by a correct doctor quote', () => {
    const { kept, removed } = checkOne(
      { text: 'Your blood pressure is a little high today.', evidence: BP_QUOTE },
      'summary',
    );
    expect(kept).toHaveLength(1);
    expect(removed).toEqual([]);
  });

  it('removes an invented medicine (seeded case)', () => {
    const { kept, removed } = checkOne(
      { text: 'You will take metformin for your blood sugar.', evidence: BP_QUOTE },
      'summary',
    );
    expect(kept).toEqual([]);
    expect(removed).toHaveLength(1);
    expect(removed[0].reason).toBe('Mentions a medicine (metformin) the doctor did not say.');
  });

  it('removes a medicine only the patient mentioned', () => {
    const { removed } = checkOne(
      { text: 'Keep taking ibuprofen for headaches.', evidence: START_QUOTE },
      'nextSteps',
    );
    expect(removed[0].reason).toBe('Mentions a medicine (ibuprofen) the doctor did not say.');
  });

  it('keeps a medicine the transcriber misspelled, with the dose in words', () => {
    const { kept, removed } = checkOne(
      { text: 'Start lisinopril 10 mg once a day.', evidence: START_QUOTE },
      'nextSteps',
    );
    expect(removed).toEqual([]);
    expect(kept).toHaveLength(1);
  });

  it('removes an invented dose', () => {
    const { removed } = checkOne(
      { text: 'Start lisinopril 20 mg once a day.', evidence: START_QUOTE },
      'nextSteps',
    );
    expect(removed[0].reason).toBe('Mentions a dose (20 mg) the doctor did not say.');
  });

  it('removes an invented schedule', () => {
    const { removed } = checkOne(
      { text: 'Start lisinopril 10 mg twice a day.', evidence: START_QUOTE },
      'nextSteps',
    );
    expect(removed[0].reason).toBe('Mentions how often (twice a day) the doctor did not say.');
  });

  it('removes an invented test but keeps a synonym of one the doctor ordered', () => {
    expect(
      checkOne({ text: 'Get an MRI of your head.', evidence: LABS_QUOTE }, 'nextSteps').removed[0].reason,
    ).toBe('Mentions a test (MRI) the doctor did not say.');
    expect(
      checkOne({ text: 'Get a blood test before your next visit.', evidence: LABS_QUOTE }, 'nextSteps')
        .removed,
    ).toEqual([]);
  });

  it('removes an invented diagnosis', () => {
    const { removed } = checkOne({ text: 'You have diabetes.', evidence: BP_QUOTE }, 'summary');
    expect(removed[0].reason).toBe('Mentions a condition (diabetes) the doctor did not say.');
  });

  it('removes invented advice', () => {
    const { removed } = checkOne({ text: 'You should cut back on salt.', evidence: BP_QUOTE }, 'summary');
    expect(removed[0].reason).toBe('Gives advice the doctor did not give.');
  });

  it('removes a next step that is not an instruction', () => {
    const { removed } = checkOne(
      { text: 'Your blood pressure was 140 over 90.', evidence: BP_QUOTE },
      'nextSteps',
    );
    expect(removed[0].reason).toBe('Not an instruction the doctor gave.');
  });

  it('removes a quote the doctor never said', () => {
    const { removed } = checkOne(
      { text: 'Your heart sounds fine.', evidence: 'Your heart sounds completely fine to me.' },
      'summary',
    );
    expect(removed[0].reason).toBe('Not found in what the doctor said.');
  });

  it('explains when the quote is the patient’s own words', () => {
    const { removed } = checkOne({ text: 'Your dad had diabetes.', evidence: 'My dad had diabetes.' }, 'summary');
    expect(removed[0].reason).toBe('The quote is something you said, not the doctor.');
  });

  it('removes a quote too short to check', () => {
    const { removed } = checkOne({ text: 'You agreed.', evidence: 'Okay.' }, 'summary');
    expect(removed[0].reason).toBe('The quote from the doctor is too short to check.');
  });

  it('tolerates small transcription differences in the quote', () => {
    const { removed } = checkOne(
      { text: 'Come back in two weeks.', evidence: 'Come back in 2 weeks so we can check your blood pressure again' },
      'nextSteps',
    );
    expect(removed).toEqual([]);
  });

  it('accepts a medicine group when the doctor named a medicine in it', () => {
    const lines = [doctor("I'm going to put you on lisinopril for your blood pressure.")];
    const { removed } = checkOne(
      {
        text: 'You are starting a blood pressure medicine.',
        evidence: "I'm going to put you on lisinopril for your blood pressure.",
      },
      'nextSteps',
      lines,
    );
    expect(removed).toEqual([]);
  });
});

describe('follow-up time frames', () => {
  it('keeps a time frame the doctor said', () => {
    const result = checkSummary(
      {
        summary: [],
        nextSteps: [
          { text: 'Come back in two weeks.', evidence: COME_BACK_QUOTE, followUp: { amount: 2, unit: 'weeks' } },
        ],
      },
      VISIT,
    );
    expect(result.nextSteps[0].followUp).toEqual({ amount: 2, unit: 'weeks' });
    expect(result.removed).toEqual([]);
  });

  it('drops an unsupported time frame but keeps the step', () => {
    const result = checkSummary(
      {
        summary: [],
        nextSteps: [
          { text: 'Come back for a check.', evidence: COME_BACK_QUOTE, followUp: { amount: 3, unit: 'months' } },
        ],
      },
      VISIT,
    );
    expect(result.nextSteps).toEqual([{ text: 'Come back for a check.', evidence: COME_BACK_QUOTE }]);
    expect(result.removed).toEqual([
      expect.objectContaining({
        kind: 'followUp',
        followUp: { amount: 3, unit: 'months' },
        reason: "The time frame (in 3 months) is not in the doctor's words, so it was taken off this step.",
      }),
    ]);
  });

  it('reads intervals in words, ranges and equivalents', () => {
    expect(intervalsIn('see you in six to eight weeks')).toEqual(
      expect.arrayContaining([
        { amount: 8, unit: 'weeks' },
        { amount: 6, unit: 'weeks' },
      ]),
    );
    expect(intervalsIn('come back next month')).toEqual([{ amount: 1, unit: 'months' }]);
    expect(intervalsIn('in a fortnight')).toEqual([{ amount: 2, unit: 'weeks' }]);
    expect(intervalsIn('take it twice a day')).toEqual([]);
    expect(followUpSupported({ amount: 14, unit: 'days' }, COME_BACK_QUOTE)).toBe(true);
    expect(followUpSupported({ amount: 1, unit: 'years' }, 'See you in twelve months')).toBe(true);
  });
});

describe('advice and instructions', () => {
  it('spots advice in an item', () => {
    expect(isAdvice('Avoid salty food.')).toBe(true);
    expect(isAdvice('You should rest.')).toBe(true);
    expect(isAdvice('Your blood pressure is high.')).toBe(false);
  });

  it('spots an instruction or plan in the doctor’s words', () => {
    expect(isInstruction(COME_BACK_QUOTE)).toBe(true);
    expect(isInstruction(LABS_QUOTE)).toBe(true);
    expect(isInstruction("We'll check your A1c again in three months.")).toBe(true);
    expect(isInstruction(BP_QUOTE)).toBe(false);
  });
});
