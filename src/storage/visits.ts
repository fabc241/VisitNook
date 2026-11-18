import { Directory, File, Paths } from 'expo-file-system';

import FileProtection from '../../modules/file-protection';

export type VisitStatus = 'recorded';

/** Stored as `visits/<id>/visit.json`. Later steps add transcript, summary, etc. */
export type Visit = {
  id: string;
  /** ISO timestamp of when the recording started. */
  date: string;
  title: string;
  durationMs: number;
  status: VisitStatus;
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

export async function getVisit(id: string): Promise<Visit | null> {
  const file = new File(visitDirectory(id), VISIT_FILE);
  if (!file.exists) return null;
  return JSON.parse(await file.text()) as Visit;
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
