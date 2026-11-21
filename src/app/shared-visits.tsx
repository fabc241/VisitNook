import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { readSharedVisits, type SharedOverview } from '../p2p/shared';
import { shortKey } from '../p2p/engine';
import type { SharedVisitRecord } from '../share/shared';

/**
 * Everything "Share with people" holds, read back from the encrypted store
 * (not from the visits), so it shows exactly what people would get.
 */
export default function SharedVisitsScreen() {
  const [overview, setOverview] = useState<SharedOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    readSharedVisits()
      .then(setOverview)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useFocusEffect(load);

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>Could not read your shared visits: {error}</Text>
        <Pressable style={styles.secondary} onPress={load}>
          <Text style={styles.secondaryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (!overview) return <ActivityIndicator style={styles.loading} />;

  const entries = [...overview.entries].sort((a, b) => b.record.date.localeCompare(a.record.date));

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.body}>
        These are the visits the people you share with will see. Turn sharing on or off on each
        visit. Adding people comes in a later step, so nobody can see them yet.
      </Text>

      {entries.length === 0 ? (
        <Text style={styles.body}>You are not sharing any visits.</Text>
      ) : (
        entries.map(({ id, record }) => <SharedRow key={id} record={record} />)
      )}

      {overview.check && (
        <View style={styles.card}>
          <Text style={styles.label}>Stored encrypted</Text>
          {overview.check.checked ? (
            <Text style={overview.check.rawLooksEncrypted && overview.check.decryptedHasProbe ? styles.ok : styles.error}>
              {overview.check.rawLooksEncrypted && overview.check.decryptedHasProbe
                ? 'Yes. The newest saved block is unreadable without the key, and readable with it.'
                : 'Check failed: the newest saved block may not be encrypted.'}
            </Text>
          ) : (
            <Text style={styles.small}>Nothing saved yet to check.</Text>
          )}
          <Text style={styles.small}>
            Store {shortKey(overview.check.key)} · {overview.check.blocks} blocks ·{' '}
            {overview.check.byteLength} bytes
            {overview.check.rawSample ? ` · raw ${overview.check.rawSample.slice(0, 16)}…` : ''}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function SharedRow({ record }: { record: SharedVisitRecord }) {
  const followUps = record.nextSteps.filter((s) => s.day || s.followUp).length;
  const parts = [
    `${record.summary.length} summary ${record.summary.length === 1 ? 'point' : 'points'}`,
    `${record.nextSteps.length} next ${record.nextSteps.length === 1 ? 'step' : 'steps'}`,
    `${followUps} with a follow-up day`,
    record.transcript ? `transcript (${record.transcript.length} lines)` : 'no transcript',
  ];
  return (
    <Link href={{ pathname: '/visit/[id]', params: { id: record.id } }} asChild>
      <Pressable style={styles.card} accessibilityRole="button">
        <Text style={styles.title}>{record.title}</Text>
        <Text style={styles.small}>
          {new Date(record.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        </Text>
        <Text style={styles.body}>{parts.join(' · ')}</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 48 },
  container: { padding: 20, gap: 14 },
  card: { borderRadius: 14, backgroundColor: 'rgba(127,127,127,0.12)', padding: 16, gap: 6 },
  title: { fontSize: 17, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '600', color: '#888', textTransform: 'uppercase' },
  body: { fontSize: 15, lineHeight: 21, color: '#666' },
  small: { fontSize: 13, lineHeight: 18, color: '#888' },
  ok: { fontSize: 15, lineHeight: 21, color: '#1A7F37' },
  error: { fontSize: 15, lineHeight: 21, color: '#CF222E' },
  secondary: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1F6FEB',
  },
  secondaryText: { color: '#1F6FEB', fontSize: 16, fontWeight: '600' },
});
