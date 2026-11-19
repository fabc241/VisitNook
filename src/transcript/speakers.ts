import type { SpeakerMap, SpeakerRole, Turn } from '../storage/visits';

export type SpeakerOverview = {
  speakerId: number;
  turnCount: number;
  talkMs: number;
  /** A few of this voice's longest turns, in time order, for the patient to listen to. */
  samples: Turn[];
};

const SAMPLES_PER_SPEAKER = 3;

/** One entry per detected voice, in the order each voice first speaks. */
export function speakerOverview(turns: Turn[]): SpeakerOverview[] {
  const byId = new Map<number, Turn[]>();
  for (const turn of turns) {
    const list = byId.get(turn.speakerId) ?? [];
    list.push(turn);
    byId.set(turn.speakerId, list);
  }
  return [...byId.entries()].map(([speakerId, list]) => {
    const samples = [...list]
      .sort((a, b) => b.text.length - a.text.length)
      .slice(0, SAMPLES_PER_SPEAKER)
      .sort((a, b) => a.startMs - b.startMs);
    return {
      speakerId,
      turnCount: list.length,
      talkMs: list.reduce((sum, t) => sum + (t.endMs - t.startMs), 0),
      samples,
    };
  });
}

/** The tapped voice is "me"; every other detected voice is the doctor. `null` means none is me. */
export function buildSpeakerMap(turns: Turn[], meSpeakerId: number | null): SpeakerMap {
  const map: SpeakerMap = {};
  for (const { speakerId } of speakerOverview(turns)) {
    map[String(speakerId)] = speakerId === meSpeakerId ? 'me' : 'doctor';
  }
  return map;
}

export function roleOf(speakerId: number, map: SpeakerMap | undefined): SpeakerRole | undefined {
  return map?.[String(speakerId)];
}

/** "Me", "Doctor", or "Voice 1", "Voice 2"… before the patient has chosen. */
export function speakerLabel(speakerId: number, map: SpeakerMap | undefined): string {
  const role = roleOf(speakerId, map);
  if (role === 'me') return 'Me';
  if (role === 'doctor') return 'Doctor';
  return `Voice ${speakerId + 1}`;
}

/** The speakerId saved as "me", or `null`. */
export function meSpeakerId(map: SpeakerMap | undefined): number | null {
  const entry = Object.entries(map ?? {}).find(([, role]) => role === 'me');
  return entry ? Number(entry[0]) : null;
}
