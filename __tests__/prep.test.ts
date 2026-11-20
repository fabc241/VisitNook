import {
  EMPTY_STORE,
  PREP_VISIT_COUNT,
  buildPrepList,
  dueDate,
  ownKey,
  pruneDone,
  shareText,
  visitIdOfKey,
} from '../src/prep/list';
import {
  LINES_AFTER,
  MAX_QUESTIONS_PER_EXCERPT,
  findQuestions,
  formatExcerpt,
  isQuestion,
  openQuestions,
  parsePrepAnswer,
  questionExcerpts,
  rewordingProblem,
  tidyQuestion,
} from '../src/prep/questions';
import type { Turn, Visit } from '../src/storage/visits';
import type { Line } from '../src/summary/transcript';

const P = (text: string): Line => ({ speaker: 'Patient', text });
const D = (text: string): Line => ({ speaker: 'Doctor', text });

describe('finding the patient’s questions', () => {
  it.each([
    'Can I take my pills at night?',
    'So, um, is the rash from the new cream?',
    'how long will the swelling last',
    'What about my blood test results?',
  ])('counts “%s”', (s) => {
    expect(isQuestion(s)).toBe(true);
  });

  it.each([
    'Sorry, what?',
    'Is that right?',
    'How are you?',
    'Really?',
    'What I mean is the pain is worse.',
    'I take it every morning.',
    'Okay, is it?',
  ])('skips “%s”', (s) => {
    expect(isQuestion(s)).toBe(false);
  });

  it('only reads patient lines and numbers questions in order', () => {
    const lines = [
      D('Do you have any questions?'),
      P('Yes. Can I still drive? And what about my blood pressure pills?'),
      D('Driving is fine.'),
      P('Okay. How long until the results come back?'),
    ];
    const found = findQuestions(lines);
    expect(found.map((c) => [c.n, c.line, c.text])).toEqual([
      [1, 1, 'Can I still drive?'],
      [2, 1, 'And what about my blood pressure pills?'],
      [3, 3, 'How long until the results come back?'],
    ]);
  });
});

describe('excerpts', () => {
  const lines: Line[] = [
    D('Hello.'),
    P('Can I still drive after the surgery?'),
    ...Array.from({ length: 10 }, (_, i) => D(`Line ${i} about something.`)),
    P('Will I need another scan later on?'),
    D('We will see.'),
  ];

  it('windows each question and merges close ones', () => {
    const candidates = findQuestions(lines);
    const excerpts = questionExcerpts(lines, candidates);
    expect(excerpts).toEqual([
      { from: 0, to: 1 + LINES_AFTER, questions: [1] },
      { from: 11, to: 13, questions: [2] },
    ]);

    const close = [P('Can I eat before it?'), P('Can I drink water before it?'), D('Yes to both.')];
    expect(questionExcerpts(close, findQuestions(close))).toEqual([{ from: 0, to: 2, questions: [1, 2] }]);
  });

  it('never puts more than the limit of questions in one excerpt', () => {
    const many = Array.from({ length: 20 }, (_, i) => P(`Can I ask question number ${i + 1}?`));
    const excerpts = questionExcerpts(many, findQuestions(many));
    expect(excerpts.length).toBeGreaterThan(1);
    for (const e of excerpts) expect(e.questions.length).toBeLessThanOrEqual(MAX_QUESTIONS_PER_EXCERPT);
    expect(excerpts.flatMap((e) => e.questions)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('marks questions and keeps them whole while clipping long lines', () => {
    const long = `${'The knee has been sore for weeks and weeks. '.repeat(20)}Is it the arthritis again?`;
    const ls = [P(long), D(`Let me look. ${'It is a long explanation. '.repeat(40)}`)];
    const candidates = findQuestions(ls);
    const text = formatExcerpt(ls, candidates, questionExcerpts(ls, candidates)[0], 100);
    expect(text).toContain('[Q1] Is it the arthritis again?');
    expect(text.split('\n')[0]).toMatch(/^Patient: … The knee has been sore/);
    expect(text.split('\n')[1].length).toBeLessThan(130);
  });
});

describe('the model’s answer', () => {
  it('reads decisions for the asked questions only', () => {
    const raw =
      '<think>hmm</think>{"questions":[{"q":1,"open":true,"text":"Can I drive?"},{"q":2,"open":false,"text":""},{"q":9,"open":true,"text":"x"}]}';
    const d = parsePrepAnswer(raw, [1, 2]);
    expect(d && [...d]).toEqual([
      [1, { open: true, text: 'Can I drive?' }],
      [2, { open: false, text: '' }],
    ]);
  });

  it('accepts "answered" and "Q1" spellings, rejects other shapes', () => {
    const d = parsePrepAnswer('{"questions":[{"q":"Q1","answered":false,"text":"Can I drive?"}]}', [1]);
    expect(d?.get(1)).toEqual({ open: true, text: 'Can I drive?' });
    expect(parsePrepAnswer('{"items":[]}', [1])).toBeNull();
    expect(parsePrepAnswer('not json', [1])).toBeNull();
  });
});

describe('rewording check', () => {
  const original = 'So um is it okay if I take the lisinopril at night instead?';

  it('keeps a faithful rewording', () => {
    expect(rewordingProblem('Can I take my lisinopril at night instead?', original)).toBeNull();
  });

  it.each([
    ['Can I take metformin at night?', 'names something new'],
    ['Can I take 20 mg of lisinopril at night?', 'names something new'],
    ['Should I see a heart specialist about my chest pain?', 'different words'],
    ['I can take lisinopril at night.', 'not one question'],
    ['Can I exercise more often and lose weight?', 'different words'],
  ])('rejects “%s”', (rewording, problem) => {
    expect(rewordingProblem(rewording, original)).toBe(problem);
  });

  it('falls back to the patient’s own tidied words', () => {
    const lines = [P(original), D('Let’s talk about the cough.')];
    const candidates = findQuestions(lines);
    const out = openQuestions(candidates, new Map([[1, { open: true, text: 'Can I take metformin at night?' }]]));
    expect(out).toEqual([
      { id: 'q1', text: 'Is it okay if I take the lisinopril at night instead?', evidence: original },
    ]);
  });

  it('leaves out answered and undecided questions', () => {
    const lines = [P('Can I drive next week?'), P('Will it scar badly?'), P('Do I need stitches out?')];
    const candidates = findQuestions(lines);
    const out = openQuestions(
      candidates,
      new Map([
        [1, { open: false, text: '' }],
        [2, { open: true, text: 'Will it scar badly?' }],
      ]),
    );
    expect(out.map((q) => q.id)).toEqual(['q2']);
  });

  it('tidies fillers, capitals and the question mark', () => {
    expect(tidyQuestion('so, um, can I still drive.')).toBe('Can I still drive?');
    expect(tidyQuestion('okay so what happens next')).toBe('What happens next?');
  });
});

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

function visit(id: string, date: string, extra: Partial<Visit> = {}): Visit {
  const turns: Turn[] = [
    { speakerId: 0, startMs: 0, endMs: 1000, text: 'Can I still drive?' },
    { speakerId: 1, startMs: 1000, endMs: 2000, text: 'Please book a blood test and come back in two weeks.' },
  ];
  return {
    id,
    date,
    title: id,
    durationMs: 2000,
    status: 'summarized',
    turns,
    speakerMap: { '0': 'me', '1': 'doctor' },
    summarizedAt: `${date}#s`,
    summary: [],
    nextSteps: [
      {
        text: 'Book a blood test and come back in 2 weeks.',
        evidence: 'Please book a blood test and come back in two weeks.',
        followUp: { amount: 2, unit: 'weeks' },
      },
    ],
    removed: [],
    openQuestions: [{ id: 'q1', text: 'Can I still drive?', evidence: 'Can I still drive?' }],
    openQuestionsFor: `${date}#s`,
    ...extra,
  };
}

describe('prep list', () => {
  it('lists open questions and next steps from recent summarized visits', () => {
    const list = buildPrepList(
      [visit('a', '2026-03-03T10:00:00.000Z'), visit('b', '2026-01-10T10:00:00.000Z', { status: 'transcribed' })],
      EMPTY_STORE,
    );
    expect(list.visits.map((v) => v.visitId)).toEqual(['a']);
    expect(list.questions).toHaveLength(1);
    expect(list.followUps).toHaveLength(1);
    const step = list.followUps[0];
    expect(step.kind === 'followUp' && step.due?.slice(0, 10)).toBe('2026-03-17');
    expect(list.pending).toBe(0);
  });

  it('hides questions found for an older summary and counts the visit as pending', () => {
    const list = buildPrepList(
      [visit('a', '2026-03-03T10:00:00.000Z', { summarizedAt: 'newer' })],
      EMPTY_STORE,
    );
    expect(list.questions).toEqual([]);
    expect(list.pending).toBe(1);
  });

  it(`looks at the ${PREP_VISIT_COUNT} newest visits only`, () => {
    const visits = Array.from({ length: PREP_VISIT_COUNT + 2 }, (_, i) =>
      visit(`v${i}`, `2026-0${i + 1}-01T10:00:00.000Z`),
    );
    const list = buildPrepList(visits, EMPTY_STORE);
    expect(list.visits).toHaveLength(PREP_VISIT_COUNT);
    expect(list.visits[0].visitId).toBe(`v${PREP_VISIT_COUNT + 1}`);
  });

  it('applies ticks and the patient’s own questions; prunes ticks of deleted visits', () => {
    const v = visit('a', '2026-03-03T10:00:00.000Z');
    const first = buildPrepList([v], EMPTY_STORE);
    const qKey = first.questions[0].key;
    expect(visitIdOfKey(qKey)).toBe('a');

    const store = {
      own: [{ id: 'x1', text: 'Ask about the knee', createdAt: '2026-03-04T00:00:00.000Z' }],
      done: { [qKey]: '2026-03-05T00:00:00.000Z', 'q:gone:abc': '2026-03-05T00:00:00.000Z' },
    };
    const list = buildPrepList([v], store);
    expect(list.questions[0].done).toBe(true);
    expect(list.own).toEqual([{ key: ownKey('x1'), kind: 'own', id: 'x1', text: 'Ask about the knee', done: false }]);

    const pruned = pruneDone(store, new Set(['a']));
    expect(Object.keys(pruned.done)).toEqual([qKey]);

    const text = shareText(list);
    expect(text).toContain('- Ask about the knee');
    expect(text).not.toContain('Can I still drive?');
    expect(text).toContain('Book a blood test');
    expect(text).toContain('Not medical advice');
  });

  it('adds months without drifting', () => {
    expect(dueDate('2026-01-15T10:00:00.000Z', { amount: 3, unit: 'months' }).slice(0, 10)).toBe('2026-04-15');
  });
});
