import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { visitAudioFile, type Visit } from '../storage/visits';
import { formatDuration } from '../utils/time';

type Props = { visit: Visit };

export function VisitPlayback({ visit }: Props) {
  const file = visitAudioFile(visit.id);
  const player = useAudioPlayer({ uri: file.uri });
  const status = useAudioPlayerStatus(player);

  const toggle = async () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) {
      await player.seekTo(0);
    }
    player.play();
  };

  const sizeKb = file.exists ? Math.round(file.size / 1024) : 0;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{visit.title}</Text>
      <Text style={styles.meta}>
        {formatDuration(visit.durationMs)} · {sizeKb} KB · visits/{visit.id}/audio.wav
      </Text>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={status.playing ? 'Pause recording' : 'Play recording'}
          onPress={toggle}
          disabled={!status.isLoaded}
          style={({ pressed }) => [styles.button, (pressed || !status.isLoaded) && styles.dim]}
        >
          <Text style={styles.buttonText}>{status.playing ? 'Pause' : 'Play'}</Text>
        </Pressable>
        <Text style={styles.progress}>
          {formatDuration(status.currentTime * 1000)} / {formatDuration((status.duration || 0) * 1000)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    padding: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(127,127,127,0.12)',
    gap: 6,
  },
  title: { fontSize: 17, fontWeight: '600', color: '#1F6FEB' },
  meta: { fontSize: 13, color: '#888' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  button: { backgroundColor: '#1F6FEB', paddingVertical: 10, paddingHorizontal: 22, borderRadius: 22 },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  progress: { fontSize: 15, color: '#888', fontVariant: ['tabular-nums'] },
  dim: { opacity: 0.5 },
});
