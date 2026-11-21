import { Link } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { setVisitSharing } from '../p2p/shared';
import type { Visit, VisitSharing } from '../storage/visits';

/**
 * The visit's "Share with people" switches: share this visit, and whether
 * its transcript goes with it. Saving waits until the shared store has it.
 */
export function ShareWithPeople({ visit, onChanged }: { visit: Visit; onChanged: (visit: Visit) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sharing: VisitSharing = visit.sharing ?? { shared: false, includeTranscript: false };
  const hasTranscript = (visit.turns ?? []).length > 0;

  const save = async (next: VisitSharing) => {
    setSaving(true);
    setError(null);
    try {
      onChanged(await setVisitSharing(visit.id, next));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text style={styles.title}>Share with people</Text>
          <Text style={styles.small}>
            The people you share with will see this visit in their Visit Notes app.
          </Text>
        </View>
        {saving ? (
          <ActivityIndicator />
        ) : (
          <Switch
            value={sharing.shared}
            onValueChange={(shared) => void save({ ...sharing, shared })}
            accessibilityLabel="Share this visit with people"
          />
        )}
      </View>

      {sharing.shared && (
        <>
          <View style={styles.row}>
            <View style={styles.text}>
              <Text style={styles.label}>Include the transcript</Text>
              <Text style={styles.small}>
                {hasTranscript
                  ? 'Everything you and your doctor said, word for word.'
                  : 'This visit has no transcript.'}
              </Text>
            </View>
            <Switch
              value={sharing.includeTranscript && hasTranscript}
              onValueChange={(includeTranscript) => void save({ ...sharing, includeTranscript })}
              disabled={!hasTranscript || saving}
              accessibilityLabel="Include the transcript"
            />
          </View>
          <Text style={styles.small}>
            Shared: what your doctor said, the next steps and their follow-up days
            {sharing.includeTranscript && hasTranscript ? ', and the transcript' : ''}. Never shared:
            the recording and items the safety check removed. Stored encrypted on this iPhone.
          </Text>
          <Link href="/shared-visits" asChild>
            <Pressable accessibilityRole="button">
              <Text style={styles.link}>See everything you share</Text>
            </Pressable>
          </Link>
        </>
      )}

      {error && <Text style={styles.error}>Could not save: {error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, backgroundColor: 'rgba(127,127,127,0.12)', padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 17, fontWeight: '600' },
  label: { fontSize: 16, fontWeight: '500' },
  small: { fontSize: 13, lineHeight: 18, color: '#888' },
  link: { fontSize: 15, color: '#1F6FEB', fontWeight: '600' },
  error: { fontSize: 14, color: '#CF222E' },
});
