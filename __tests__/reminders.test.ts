import {
  ALERT_OFFSET_MINUTES,
  EVENT_TITLE,
  MAX_DAYS_AHEAD,
  addDays,
  clampDay,
  daysBetween,
  eventDetails,
  fromDay,
  initialDay,
  reminderCandidates,
  reminderKey,
  suggestionText,
  toDay,
} from '../src/reminders/plan';
import type { NextStep, Visit } from '../src/storage/visits';

const twoWeeks: NextStep = {
  text: 'Come back for a check in two weeks.',
  evidence: 'come back in two weeks',
  followUp: { amount: 2, unit: 'weeks' },
};
const noTimeFrame: NextStep = { text: 'Keep a food diary.', evidence: 'keep a food diary' };

function visit(over: Partial<Visit> = {}): Visit {
  return {
    id: 'v1',
    date: new Date(2026, 2, 3, 10, 30).toISOString(),
    title: 'Visit',
    durationMs: 1000,
    status: 'summarized',
    summary: [],
    nextSteps: [twoWeeks, noTimeFrame],
    removed: [],
    ...over,
  };
}

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

describe('day helpers', () => {
  it('round-trips a local day', () => {
    expect(toDay(fromDay('2026-03-03'))).toBe('2026-03-03');
    expect(fromDay('2026-03-03').getHours()).toBe(0);
  });

  it('adds days across months and years', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-10', -7)).toBe('2026-03-03');
  });

  it('counts days across a daylight-saving change', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-03-03', '2026-03-03')).toBe(0);
  });

  it('keeps the day between today and the limit', () => {
    expect(clampDay('2026-03-01', '2026-03-03')).toBe('2026-03-03');
    expect(clampDay('2026-03-04', '2026-03-03')).toBe('2026-03-04');
    expect(clampDay('2040-01-01', '2026-03-03')).toBe(addDays('2026-03-03', MAX_DAYS_AHEAD));
  });
});

describe('which next steps get a calendar button', () => {
  it('only steps with a time frame, dated from the visit', () => {
    const [c, ...rest] = reminderCandidates(visit(), at(2026, 3, 5));
    expect(rest).toHaveLength(0);
    expect(c.step.text).toBe(twoWeeks.text);
    expect(c.suggestedDay).toBe('2026-03-17');
    expect(c.passed).toBe(false);
    expect(initialDay(c, at(2026, 3, 5))).toBe('2026-03-17');
    expect(suggestionText(c)).toBe('Your doctor said in 2 weeks, which is Tue, Mar 17, 2026.');
  });

  it('nothing before the safety check has run', () => {
    expect(reminderCandidates(visit({ removed: undefined }))).toEqual([]);
    expect(reminderCandidates(visit({ nextSteps: undefined }))).toEqual([]);
  });

  it('a passed day starts the sheet on today', () => {
    const [c] = reminderCandidates(visit(), at(2026, 4, 1));
    expect(c.passed).toBe(true);
    expect(initialDay(c, at(2026, 4, 1))).toBe('2026-04-01');
    expect(suggestionText(c)).toContain('That day has passed');
  });

  it('the follow-up day itself is not passed', () => {
    const [c] = reminderCandidates(visit(), at(2026, 3, 17));
    expect(c.passed).toBe(false);
    expect(initialDay(c, at(2026, 3, 17))).toBe('2026-03-17');
  });

  it('months use the calendar month', () => {
    const v = visit({ nextSteps: [{ ...twoWeeks, followUp: { amount: 3, unit: 'months' } }] });
    expect(reminderCandidates(v, at(2026, 3, 5))[0].suggestedDay).toBe('2026-06-03');
  });

  it('shows a step as added', () => {
    const record = { day: '2026-03-18', addedAt: '2026-03-05T12:00:00.000Z' };
    const v = visit({ reminders: { [reminderKey(twoWeeks)]: record } });
    expect(reminderCandidates(v, at(2026, 3, 5))[0].added).toEqual(record);
  });

  it('a rewritten step with the same words keeps its added mark', () => {
    expect(reminderKey({ text: 'Come back for a check in two weeks' })).toBe(reminderKey(twoWeeks));
  });
});

describe('the calendar event', () => {
  it('has a general title and only the instruction in its note', () => {
    const e = eventDetails(twoWeeks, '2026-03-17');
    expect(e.title).toBe(EVENT_TITLE);
    expect(e.title).not.toMatch(/check|weeks/i);
    expect(e.notes).toBe(twoWeeks.text);
    expect(e.notes).not.toContain(twoWeeks.evidence);
  });

  it('is all-day on the chosen local day, alerting 9 AM the day before', () => {
    const e = eventDetails(twoWeeks, '2026-03-17');
    expect(e.allDay).toBe(true);
    expect(toDay(e.startDate)).toBe('2026-03-17');
    expect(e.startDate.getHours()).toBe(0);
    expect(e.endDate).toEqual(e.startDate);
    expect(e.alarms).toEqual([{ relativeOffset: ALERT_OFFSET_MINUTES }]);
    expect(24 * 60 + ALERT_OFFSET_MINUTES).toBe(9 * 60);
  });
});
