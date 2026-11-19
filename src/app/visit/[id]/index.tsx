import { Link, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useClipPlayer } from '../../../audio/useClipPlayer';
import { VisitPlayback } from '../../../components/VisitPlayback';
import {
  clearTranscriptionError,
  transcribeVisit,
  useTranscriptionJob,
} from '../../../qvac/transcribe';
import { getVisit, type Visit } from '../../../storage/visits';
import { roleOf, speakerLabel, speakerOverview } from '../../../transcript/speakers';
import { formatDuration } from '../../../utils/time';

export default function VisitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [visit, setVisit] = useState<Visit | null | undefined>(undefined);
  const job = useTranscriptionJob(id);

  const reload = useCallback(() => {
    getVisit(id)
      .then(setVisit)
      .catch(() => setVisit(null));
  }, [id]);

  // Reload when coming back from the speaker screen…
  useFocusEffect(reload);
  // …and when a transcription finishes.
  useEffect(() => {
    if (job === null) reload();
  }, [job, reload]);

  if (visit === undefined) {
    return <ActivityIndicator style={styles.loading} />;
  }
  if (visit === null) {
    return <Text style={styles.missing}>This visit could not be found.</Text>;
  }

  const turns = visit.turns ?? [];
  const speakers = speakerOverview(turns);
  const running = job?.state === 'running';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: visit.title }} />
      <VisitPlayback visit={visit} />

      {running ? (
        <Transcribing startedAt={job.startedAt} audioMs={visit.durationMs} onCancel={job.cancel} />
      ) : job?.state === 'failed' ? (
        <View style={styles.card}>
          <Text style={styles.error}>Transcription failed: {job.error}</Text>
          <Pressable
            style={styles.primary}
            onPress={() => {
              clearTranscriptionError(visit.id);
              void transcribeVisit(visit.id);
            }}
          >
            <Text style={styles.primaryText}>Try again</Text>
          </Pressable>
        </View>
      ) : visit.status === 'recorded' ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Transcript</Text>
          <Text style={styles.body}>
            Turn the recording into text on this iPhone. It can take a few minutes for a long visit.
            Keep the app open while it works.
          </Text>
          <Pressable style={styles.primary} onPress={() => void transcribeVisit(visit.id)}>
            <Text style={styles.primaryText}>Transcribe</Text>
          </Pressable>
        </View>
      ) : null}

      {!running && visit.status === 'transcribed' && (
        <>
          {turns.length === 0 ? (
            <Text style={styles.body}>No speech was found in this recording.</Text>
          ) : (
            <>
              {!visit.speakerMap ? (
                <View style={[styles.card, styles.callout]}>
                  <Text style={styles.cardTitle}>Which voice is yours?</Text>
                  <Text style={styles.body}>
                    {speakers.length === 1
                      ? 'One voice was found. Tell the app whether it is you or your doctor.'
                      : `${speakers.length} voices were found. Listen to a few lines and tap the one that is you.`}
                  </Text>
                  <Link href={{ pathname: '/visit/[id]/speakers', params: { id: visit.id } }} asChild>
                    <Pressable style={styles.primary}>
                      <Text style={styles.primaryText}>Choose my voice</Text>
                    </Pressable>
                  </Link>
                </View>
              ) : (
                <Link href={{ pathname: '/visit/[id]/speakers', params: { id: visit.id } }} asChild>
                  <Pressable style={styles.secondary}>
                    <Text style={styles.secondaryText}>Change which voice is mine</Text>
                  </Pressable>
                </Link>
              )}
              <Transcript visit={visit} />
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

function Transcribing({
  startedAt,
  audioMs,
  onCancel,
}: {
  startedAt: number;
  audioMs: number;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <ActivityIndicator />
        <Text style={styles.cardTitle}>Transcribing…</Text>
      </View>
      <Text style={styles.body}>
        {formatDuration(now - startedAt)} elapsed for {formatDuration(audioMs)} of audio. Keep the
        app open; the screen stays on while this runs.
      </Text>
      <Pressable style={styles.secondary} onPress={onCancel}>
        <Text style={styles.secondaryText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function Transcript({ visit }: { visit: Visit }) {
  const clips = useClipPlayer(visit.id);
  return (
    <View style={styles.transcript}>
      <Text style={styles.sectionTitle}>Transcript · tap a line to hear it</Text>
      {(visit.turns ?? []).map((turn, index) => {
        const key = String(index);
        const playing = clips.activeKey === key;
        const role = roleOf(turn.speakerId, visit.speakerMap);
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityHint={playing ? 'Stops playback' : 'Plays this part of the recording'}
            disabled={!clips.ready}
            onPress={() => (playing ? clips.stop() : void clips.play(key, turn.startMs, turn.endMs))}
            style={[styles.turn, role === 'me' && styles.turnMe, playing && styles.turnPlaying]}
          >
            <Text style={[styles.speaker, role === 'doctor' && styles.speakerDoctor]}>
              {speakerLabel(turn.speakerId, visit.speakerMap)}
              <Text style={styles.time}>
                {'  '}
                {formatDuration(turn.startMs)}
                {playing ? '  ▶︎ playing' : ''}
              </Text>
            </Text>
            <Text style={styles.turnText}>{turn.text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 48 },
  missing: { margin: 24, fontSize: 16, color: '#666' },
  container: { padding: 20, gap: 14 },
  card: { borderRadius: 14, backgroundColor: 'rgba(127,127,127,0.12)', padding: 16, gap: 10 },
  callout: { backgroundColor: 'rgba(31,111,235,0.12)' },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21, color: '#666' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  error: { fontSize: 15, color: '#CF222E' },
  primary: { backgroundColor: '#1F6FEB', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  secondary: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1F6FEB',
  },
  secondaryText: { color: '#1F6FEB', fontSize: 16, fontWeight: '600' },
  transcript: { gap: 8, marginTop: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#888', textTransform: 'uppercase' },
  turn: { borderRadius: 12, padding: 12, gap: 4, backgroundColor: 'rgba(127,127,127,0.08)' },
  turnMe: { backgroundColor: 'rgba(31,111,235,0.10)' },
  turnPlaying: { borderWidth: 1, borderColor: '#1F6FEB' },
  speaker: { fontSize: 14, fontWeight: '700', color: '#1F6FEB' },
  speakerDoctor: { color: '#1A7F37' },
  time: { fontSize: 13, fontWeight: '400', color: '#888', fontVariant: ['tabular-nums'] },
  turnText: { fontSize: 16, lineHeight: 22, color: '#24292F' },
});
