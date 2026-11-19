import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useClipPlayer } from '../../../audio/useClipPlayer';
import { errorMessage } from '../../../qvac/models';
import { getVisit, updateVisit, type Visit } from '../../../storage/visits';
import { buildSpeakerMap, meSpeakerId, speakerOverview } from '../../../transcript/speakers';
import { formatDuration } from '../../../utils/time';

export default function SpeakersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [visit, setVisit] = useState<Visit | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const clips = useClipPlayer(id);

  useEffect(() => {
    getVisit(id)
      .then(setVisit)
      .catch(() => setVisit(null));
  }, [id]);

  if (visit === undefined) return <ActivityIndicator style={styles.loading} />;
  if (!visit?.turns?.length) {
    return <Text style={styles.missing}>This visit has no transcript yet.</Text>;
  }

  const turns = visit.turns;
  const speakers = speakerOverview(turns);
  const current = visit.speakerMap ? meSpeakerId(visit.speakerMap) : undefined;

  const choose = async (me: number | null) => {
    clips.stop();
    setSaving(true);
    try {
      await updateVisit(visit.id, (v) => ({ ...v, speakerMap: buildSpeakerMap(turns, me) }));
      router.back();
    } catch (error) {
      setSaving(false);
      Alert.alert('Could not save your choice', errorMessage(error));
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.intro}>
        Listen to a few lines from each voice, then tap “This is me” on yours. Every other voice is
        labelled Doctor. You can change this later.
      </Text>

      {speakers.map((s) => {
        const isCurrent = current === s.speakerId;
        return (
          <View key={s.speakerId} style={[styles.card, isCurrent && styles.cardChosen]}>
            <View style={styles.header}>
              <Text style={styles.title}>Voice {s.speakerId + 1}</Text>
              <Text style={styles.meta}>
                {s.turnCount} {s.turnCount === 1 ? 'turn' : 'turns'} · {formatDuration(s.talkMs)}{' '}
                talking{isCurrent ? ' · you' : ''}
              </Text>
            </View>

            {s.samples.map((turn) => {
              const key = `${turn.speakerId}-${turn.startMs}`;
              const playing = clips.activeKey === key;
              return (
                <View key={key} style={styles.sample}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={playing ? 'Stop' : `Play line at ${formatDuration(turn.startMs)}`}
                    disabled={!clips.ready}
                    onPress={() =>
                      playing ? clips.stop() : void clips.play(key, turn.startMs, turn.endMs)
                    }
                    style={({ pressed }) => [styles.play, (pressed || !clips.ready) && styles.dim]}
                  >
                    <Text style={styles.playText}>{playing ? '■' : '▶︎'}</Text>
                  </Pressable>
                  <Text style={styles.sampleText} numberOfLines={3}>
                    “{turn.text}”
                  </Text>
                </View>
              );
            })}

            <Pressable
              disabled={saving}
              onPress={() => void choose(s.speakerId)}
              style={({ pressed }) => [styles.primary, (pressed || saving) && styles.dim]}
            >
              <Text style={styles.primaryText}>This is me</Text>
            </Pressable>
          </View>
        );
      })}

      <Pressable
        disabled={saving}
        onPress={() => void choose(null)}
        style={({ pressed }) => [
          styles.secondary,
          current === null && styles.cardChosen,
          (pressed || saving) && styles.dim,
        ]}
      >
        <Text style={styles.secondaryText}>
          {speakers.length === 1 ? 'This is my doctor, not me' : 'None of these is me'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 48 },
  missing: { margin: 24, fontSize: 16, color: '#666' },
  container: { padding: 20, gap: 14 },
  intro: { fontSize: 16, lineHeight: 22, color: '#444' },
  card: { borderRadius: 14, backgroundColor: 'rgba(127,127,127,0.12)', padding: 16, gap: 12 },
  cardChosen: { borderWidth: 2, borderColor: '#1F6FEB' },
  header: { gap: 2 },
  title: { fontSize: 18, fontWeight: '700' },
  meta: { fontSize: 13, color: '#888', fontVariant: ['tabular-nums'] },
  sample: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  play: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1F6FEB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playText: { color: '#fff', fontSize: 16 },
  sampleText: { flex: 1, fontSize: 15, lineHeight: 21, color: '#24292F' },
  primary: { backgroundColor: '#1F6FEB', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  secondary: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1F6FEB',
  },
  secondaryText: { color: '#1F6FEB', fontSize: 16, fontWeight: '600' },
  dim: { opacity: 0.5 },
});
