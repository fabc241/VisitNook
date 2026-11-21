// Writes a confirmed follow-up to the iPhone's default calendar. Uses
// write-only access (iOS 17+): the app can add events but never reads the
// patient's calendar.

import * as Calendar from 'expo-calendar';

import { eventDetails, reminderKey, type ReminderRecord } from '../reminders/plan';
import { updateVisit, type NextStep } from '../storage/visits';

export class CalendarAccessDenied extends Error {
  constructor() {
    super('Calendar access is turned off for Visit Notes.');
  }
}

async function ensureWriteAccess(): Promise<void> {
  let permission = await Calendar.getCalendarPermissions(true);
  if (!permission.granted && permission.canAskAgain) {
    permission = await Calendar.requestCalendarPermissions(true);
  }
  if (!permission.granted) throw new CalendarAccessDenied();
}

/** Adds one all-day event on `day` and records it on the visit. Call only after the patient confirms. */
export async function addFollowUpToCalendar(
  visitId: string,
  step: NextStep,
  day: string,
): Promise<ReminderRecord> {
  await ensureWriteAccess();
  const event = await Calendar.getDefaultCalendarSync().createEvent(eventDetails(step, day));
  const record: ReminderRecord = {
    day,
    addedAt: new Date().toISOString(),
    ...(event.id ? { eventId: event.id } : {}),
  };
  await updateVisit(visitId, (visit) => ({
    ...visit,
    reminders: { ...visit.reminders, [reminderKey(step)]: record },
  }));
  return record;
}
