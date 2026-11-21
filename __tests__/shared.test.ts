import { SHARED_RECORD_VERSION, isShared, sharedVisitRecord } from '../src/share/shared';
import type { Visit } from '../src/storage/visits';

const base: Visit = {
  id: 'v1',
  date: new Date(2026, 10, 21, 9, 30).toISOString(),
  title: 'Visit on 21 Nov 2026',
  durationMs: 21_000,
  status: 'summarized',
  turns: [
    { speakerId: 0, startMs: 900, endMs: 5000, text: ' I had a terrible headache. ' },
    { speakerId: 1, startMs: 14_000, endMs: 20_000, text: 'We will check again in 2 weeks.' },
    { speakerId: 2, startMs: 20_000, endMs: 21_000, text: 'Next, please.' },
  ],
  speakerMap: { '0': 'me', '1': 'doctor' },
  summary: [{ text: 'Your blood pressure is fine.', evidence: 'blood pressure looks fine' }],
  nextSteps: [
    { text: 'Come back in 2 weeks', evidence: 'check again in 2 weeks', followUp: { amount: 2, unit: 'weeks' } },
    { text: 'Keep a headache diary', evidence: 'keep a headache diary' },
  ],
  removed: [
    { section: 'summary', kind: 'item', text: 'Start metformin', evidence: 'x', reason: 'Mentions a medicine' },
  ],
  summarizedAt: '2026-11-21T10:00:00.000Z',
  openQuestions: [{ id: 'q', text: 'Is it serious?', evidence: 'is it serious' }],
  reminders: { k: { eventId: 'e', day: '2026-12-05', addedAt: '2026-11-21T10:05:00.000Z' } as never },
  sharing: { shared: true, includeTranscript: false },
};

describe('the shared visit record', () => {
  it('is null while the switch is off or missing', () => {
    expect(sharedVisitRecord({ ...base, sharing: undefined })).toBeNull();
    expect(sharedVisitRecord({ ...base, sharing: { shared: false, includeTranscript: true } })).toBeNull();
    expect(isShared({ ...base, sharing: undefined })).toBe(false);
  });

  it('is null without a safety-checked summary, even when shared', () => {
    expect(sharedVisitRecord({ ...base, removed: undefined })).toBeNull();
    expect(sharedVisitRecord({ ...base, summary: undefined })).toBeNull();
  });

  it('has the summary, next steps and follow-up day', () => {
    const record = sharedVisitRecord(base)!;
    expect(record.version).toBe(SHARED_RECORD_VERSION);
    expect(record).toMatchObject({ id: 'v1', title: base.title, date: base.date, durationMs: 21_000 });
    expect(record.summarizedAt).toBe(base.summarizedAt);
    expect(record.summary).toEqual([{ text: 'Your blood pressure is fine.', evidence: 'blood pressure looks fine' }]);
    expect(record.nextSteps[0]).toEqual({
      text: 'Come back in 2 weeks',
      evidence: 'check again in 2 weeks',
      followUp: { amount: 2, unit: 'weeks' },
      day: '2026-12-05',
    });
    expect(record.nextSteps[1]).toEqual({ text: 'Keep a headache diary', evidence: 'keep a headache diary' });
  });

  it('leaves out the transcript unless it is switched on', () => {
    expect(sharedVisitRecord(base)!.transcript).toBeNull();
    const withTranscript = sharedVisitRecord({ ...base, sharing: { shared: true, includeTranscript: true } })!;
    expect(withTranscript.transcript).toEqual([
      { speaker: 'patient', startMs: 900, text: 'I had a terrible headache.' },
      { speaker: 'doctor', startMs: 14_000, text: 'We will check again in 2 weeks.' },
      { speaker: 'unknown', startMs: 20_000, text: 'Next, please.' },
    ]);
  });

  it('never carries removed items, open questions, reminders or the audio', () => {
    const record = sharedVisitRecord({ ...base, sharing: { shared: true, includeTranscript: true } })!;
    expect(Object.keys(record).sort()).toEqual(
      ['date', 'durationMs', 'id', 'nextSteps', 'summarizedAt', 'summary', 'title', 'transcript', 'version'].sort(),
    );
    const json = JSON.stringify(record);
    expect(json).not.toContain('metformin');
    expect(json).not.toContain('Is it serious');
    expect(json).not.toContain('eventId');
    expect(json).not.toContain('audio');
  });

  it('is the same for the same visit, so saving it again adds nothing to the store', () => {
    expect(JSON.stringify(sharedVisitRecord(base))).toBe(JSON.stringify(sharedVisitRecord({ ...base })));
  });
});
