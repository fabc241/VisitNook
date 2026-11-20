import { requestRecordingPermissionsAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  RECORDING_OPTIONS,
  enablePlaybackMode,
  enableRecordingMode,
  prepareRecordingDirectory,
  protectActiveRecording,
} from '../../audio/recorder';
import { VisitPlayback } from '../../components/VisitPlayback';
import { listVisits, newVisitId, saveRecordedVisit, type Visit } from '../../storage/visits';
import { formatDuration } from '../../utils/time';

type Phase = 'idle' | 'starting' | 'recording' | 'saving';

export default function RecordScreen() {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 500);
  const [phase, setPhase] = useState<Phase>('idle');
  const [lastVisit, setLastVisit] = useState<Visit | null>(null);
  const session = useRef<{ id: string; startedAt: Date } | null>(null);

  // Reload on focus so a visit deleted from the Visits tab disappears here too.
  useFocusEffect(
    useCallback(() => {
      listVisits()
        .then((visits) => setLastVisit(visits[0] ?? null))
        .catch(() => setLastVisit(null));
    }, []),
  );

  const askForConsent = () => {
    Alert.alert(
      'Before you record',
      'Have you asked your doctor for permission to record this visit?',
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Yes, start recording', onPress: () => void start() },
      ],
    );
  };

  const start = async () => {
    setPhase('starting');
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setPhase('idle');
        Alert.alert(
          'Microphone access needed',
          'Turn on microphone access for Visit Notes in Settings to record visits.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => void Linking.openSettings() },
          ],
        );
        return;
      }

      await enableRecordingMode();
      await prepareRecordingDirectory();

      const id = newVisitId();
      await recorder.prepareToRecordAsync({ ...RECORDING_OPTIONS, fileName: id });
      if (recorder.uri) {
        // The folder's class already applies to new files; this is a fallback.
        await protectActiveRecording(recorder.uri).catch(() => undefined);
      }
      recorder.record();
      session.current = { id, startedAt: new Date() };
      setPhase('recording');
    } catch (error) {
      session.current = null;
      setPhase('idle');
      await enablePlaybackMode().catch(() => undefined);
      Alert.alert('Could not start recording', errorMessage(error));
    }
  };

  const stop = async () => {
    const current = session.current;
    if (!current) return;
    setPhase('saving');
    const durationMs = Math.round(recorder.currentTime * 1000);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      await enablePlaybackMode();
      if (!uri) throw new Error('The recorder did not return a file.');
      const visit = await saveRecordedVisit({
        id: current.id,
        recordingUri: uri,
        startedAt: current.startedAt,
        durationMs,
      });
      setLastVisit(visit);
      router.push({ pathname: '/visit/[id]', params: { id: visit.id } });
    } catch (error) {
      Alert.alert('Could not save the recording', errorMessage(error));
    } finally {
      session.current = null;
      setPhase('idle');
    }
  };

  const isRecording = phase === 'recording';
  const busy = phase === 'starting' || phase === 'saving';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.timer}>{formatDuration(isRecording ? recorderState.durationMillis : 0)}</Text>
      <Text style={styles.hint}>
        {isRecording
          ? 'Recording. You can lock your screen; recording continues.'
          : phase === 'saving'
            ? 'Saving…'
            : 'Record your visit. Audio stays on this iPhone.'}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isRecording ? 'Stop and save recording' : 'Start recording'}
        disabled={busy}
        onPress={isRecording ? () => void stop() : askForConsent}
        style={({ pressed }) => [
          styles.recordButton,
          isRecording && styles.stopButton,
          (pressed || busy) && styles.dim,
        ]}
      >
        <Text style={styles.recordButtonText}>{isRecording ? 'Stop & save' : 'Start recording'}</Text>
      </Pressable>

      {lastVisit && !isRecording ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Last recording</Text>
          <VisitPlayback key={lastVisit.id} visit={lastVisit} />
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/visit/[id]', params: { id: lastVisit.id } })}
            style={({ pressed }) => [styles.openButton, pressed && styles.dim]}
          >
            <Text style={styles.openText}>Open visit & transcript</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: 'center', padding: 24, paddingTop: 48, gap: 16 },
  timer: { fontSize: 56, fontWeight: '300', fontVariant: ['tabular-nums'] },
  hint: { fontSize: 16, color: '#888', textAlign: 'center', minHeight: 44 },
  recordButton: {
    backgroundColor: '#1F6FEB',
    paddingVertical: 16,
    paddingHorizontal: 36,
    borderRadius: 32,
    minWidth: 220,
    alignItems: 'center',
  },
  stopButton: { backgroundColor: '#D1242F' },
  recordButtonText: { color: 'white', fontSize: 18, fontWeight: '600' },
  dim: { opacity: 0.6 },
  section: { alignSelf: 'stretch', marginTop: 24, gap: 8 },
  openButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1F6FEB',
    paddingVertical: 12,
    alignItems: 'center',
  },
  openText: { color: '#1F6FEB', fontSize: 16, fontWeight: '600' },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#888', textTransform: 'uppercase' },
});
