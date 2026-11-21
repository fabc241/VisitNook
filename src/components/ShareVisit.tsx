import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { shareVisitAsPdf, shareVisitAsText } from '../features/share';
import type { Visit } from '../storage/visits';

type Busy = null | 'pdf' | 'text';

/** "Share this visit…" and its sheet: pick what to include, then text or PDF. */
export function ShareVisit({ visit }: { visit: Visit }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable style={styles.secondary} onPress={() => setOpen(true)} accessibilityRole="button">
        <Text style={styles.secondaryText}>Share this visit…</Text>
      </Pressable>
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        {open && <ShareSheet visit={visit} onClose={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

function ShareSheet({ visit, onClose }: { visit: Visit; onClose: () => void }) {
  const [includeTranscript, setIncludeTranscript] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const hasTranscript = (visit.turns ?? []).length > 0;

  const share = async (kind: 'pdf' | 'text') => {
    setBusy(kind);
    try {
      const options = { includeTranscript: includeTranscript && hasTranscript };
      if (kind === 'pdf') await shareVisitAsPdf(visit, options);
      else await shareVisitAsText(visit, options);
      onClose();
    } catch (error) {
      Alert.alert('Could not share', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={styles.sheet} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Share this visit</Text>
        <Text style={styles.body}>
          Send your notes to a family member, a carer or another doctor. You choose the app and the
          person in the next step.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Included</Text>
          <Text style={styles.item}>• What your doctor said</Text>
          <Text style={styles.item}>• Next steps, with the day your doctor gave</Text>
          <Text style={styles.item}>• A note that the app wrote it and it is not medical advice</Text>
          <Text style={styles.small}>
            The PDF also shows your doctor’s words under each point.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.cardTitle}>Include the transcript</Text>
              <Text style={styles.small}>
                {hasTranscript
                  ? 'Everything you and your doctor said, word for word.'
                  : 'This visit has no transcript.'}
              </Text>
            </View>
            <Switch
              value={includeTranscript && hasTranscript}
              onValueChange={setIncludeTranscript}
              disabled={!hasTranscript || busy !== null}
              accessibilityLabel="Include the transcript"
            />
          </View>
        </View>

        <Text style={styles.small}>
          Never included: items the safety check removed. The PDF is made on this iPhone and deleted
          from it once the share sheet closes.
        </Text>

        <Pressable
          style={[styles.primary, busy !== null && styles.disabled]}
          disabled={busy !== null}
          onPress={() => void share('pdf')}
          accessibilityRole="button"
        >
          {busy === 'pdf' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Share as PDF</Text>}
        </Pressable>
        <Pressable
          style={[styles.secondary, busy !== null && styles.disabled]}
          disabled={busy !== null}
          onPress={() => void share('text')}
          accessibilityRole="button"
        >
          {busy === 'text' ? <ActivityIndicator /> : <Text style={styles.secondaryText}>Share as text</Text>}
        </Pressable>
        <Pressable style={styles.cancel} disabled={busy !== null} onPress={onClose} accessibilityRole="button">
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  content: { padding: 20, gap: 14 },
  title: { fontSize: 22, fontWeight: '700', marginTop: 8 },
  body: { fontSize: 15, lineHeight: 21, color: '#666' },
  card: { borderRadius: 14, backgroundColor: 'rgba(127,127,127,0.12)', padding: 16, gap: 6 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '600', color: '#888', textTransform: 'uppercase' },
  item: { fontSize: 16, lineHeight: 22, color: '#24292F' },
  small: { fontSize: 13, lineHeight: 18, color: '#888' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchText: { flex: 1, gap: 2 },
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
  cancel: { paddingVertical: 10, alignItems: 'center' },
  cancelText: { color: '#1F6FEB', fontSize: 16 },
  disabled: { opacity: 0.4 },
});
