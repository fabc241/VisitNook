import { Directory, File, Paths } from 'expo-file-system';

import FileProtection from '../../modules/file-protection';

export type VisitStatus = 'recorded' | 'transcribed' | 'summarized';

/** One stretch of speech by one voice. `speakerId` is zero-based, from the diarization model. */
export type Turn = {
  speakerId: number;
  startMs: number;
  endMs: number;
  text: string;
};

export type SpeakerRole = 'me' | 'doctor';

/** speakerId (as a string key) → who that voice is. Set on the "Which voice is yours?" screen. */
export type SpeakerMap = Record<string, SpeakerRole>;

/** One summary line, with the doctor's words that support it. */
export type SummaryItem = {
  text: string;
  /** A quote of what the doctor said. Checked against the transcript in the safety step. */
  evidence: string;
};

export type FollowUpUnit = 'days' | 'weeks' | 'months' | 'years';
export type FollowUp = { amount: number; unit: FollowUpUnit };

export type NextStep = SummaryItem & { followUp?: FollowUp };

/**
 * Something the safety check took out of the summary. `kind: 'item'` removes
 * the whole line; `kind: 'followUp'` keeps the next step but drops its time frame.
 */
export type RemovedItem = {
  section: 'summary' | 'nextSteps';
  kind: 'item' | 'followUp';
  text: string;
  evidence: string;
  followUp?: FollowUp;
  /** Plain-English reason shown to the patient. */
  reason: string;
};

/** Stored as `visits/<id>/visit.json`. Later steps add removed items, reminders, etc. */
export type Visit = {
  id: string;
  /** ISO timestamp of when the recording started. */
  date: string;
  title: string;
  durationMs: number;
  status: VisitStatus;
  turns?: Turn[];
  speakerMap?: SpeakerMap;
  /** ISO timestamp of the last successful transcription. */
  transcribedAt?: string;
  summary?: SummaryItem[];
  nextSteps?: NextStep[];
  /** What the safety check removed. Present once the summary has been checked. */
  removed?: RemovedItem[];
  /** ISO timestamp of the last successful summary. */
  summarizedAt?: string;
};

const AUDIO_FILE = 'audio.wav';
const VISIT_FILE = 'visit.json';

export const visitsRoot = new Directory(Paths.document, 'visits');

function visitDirectory(id: string): Directory {
  return new Directory(visitsRoot, id);
}

export function visitAudioFile(id: string): File {
  return new File(visitDirectory(id), AUDIO_FILE);
}

export function newVisitId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${suffix}`;
}

function defaultTitle(date: Date): string {
  return `Visit on ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/**
 * Moves a finished recording into `visits/<id>/audio.wav` and writes the
 * `visit.json` stub. The moved file keeps its own protection class, so it is
 * switched back to `complete` explicitly.
 */
export async function saveRecordedVisit(params: {
  id: string;
  recordingUri: string;
  startedAt: Date;
  durationMs: number;
}): Promise<Visit> {
  const { id, recordingUri, startedAt, durationMs } = params;

  visitsRoot.create({ intermediates: true, idempotent: true });
  await FileProtection.excludeFromBackup(visitsRoot.uri);

  const dir = visitDirectory(id);
  dir.create({ intermediates: true, idempotent: true });
  await FileProtection.setProtection(dir.uri, 'complete');
  await FileProtection.excludeFromBackup(dir.uri);

  const audio = new File(recordingUri);
  if (!audio.exists) {
    throw new Error('The recording file is missing.');
  }
  const destination = visitAudioFile(id);
  audio.moveSync(destination);
  await FileProtection.setProtection(destination.uri, 'complete');
  await FileProtection.excludeFromBackup(destination.uri);

  const visit: Visit = {
    id,
    date: startedAt.toISOString(),
    title: defaultTitle(startedAt),
    durationMs,
    status: 'recorded',
  };
  writeVisit(visit);
  return visit;
}

export function writeVisit(visit: Visit): void {
  const file = new File(visitDirectory(visit.id), VISIT_FILE);
  file.write(JSON.stringify(visit, null, 2));
}

/** Reads, changes and writes back one visit. Throws if the visit does not exist. */
export async function updateVisit(id: string, change: (visit: Visit) => Visit): Promise<Visit> {
  const current = await getVisit(id);
  if (!current) throw new Error('This visit no longer exists.');
  const next = change(current);
  writeVisit(next);
  return next;
}

/** The visit without its summary. Used whenever the transcript or the voice choice changes. */
export function withoutSummary(visit: Visit): Visit {
  const {
    summary: _summary,
    nextSteps: _nextSteps,
    removed: _removed,
    summarizedAt: _summarizedAt,
    ...rest
  } = visit;
  return { ...rest, status: rest.turns ? 'transcribed' : rest.status };
}

/** A plain filesystem path (no `file://`) for native code such as the QVAC worker. */
export function toFilePath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

export async function getVisit(id: string): Promise<Visit | null> {
  const file = new File(visitDirectory(id), VISIT_FILE);
  if (!file.exists) return null;
  return JSON.parse(await file.text()) as Visit;
}

/**
 * Permanently removes `visits/<id>/` (audio, transcript and summary).
 * Callers also call `forgetVisit(id)` (src/qvac/rag.ts) to remove its search documents.
 */
export function deleteVisit(id: string): void {
  const dir = visitDirectory(id);
  if (dir.exists) dir.delete();
}

/** All visits, newest first. Folders without a readable `visit.json` are skipped. */
export async function listVisits(): Promise<Visit[]> {
  if (!visitsRoot.exists) return [];
  const visits: Visit[] = [];
  for (const entry of visitsRoot.list()) {
    if (!(entry instanceof Directory)) continue;
    try {
      const visit = await getVisit(entry.name);
      if (visit) visits.push(visit);
    } catch {
      // Ignore a corrupt or partially written visit.
    }
  }
  return visits.sort((a, b) => b.date.localeCompare(a.date));
}
