import { router, useFocusEffect } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { describeFollowUp } from '../../guardrails/check';
import {
  EMPTY_STORE,
  buildPrepList,
  ownKey,
  pruneDone,
  shareText,
  type PrepItem,
  type PrepList,
  type PrepStore,
} from '../../prep/list';
import { findPrepQuestions, usePrepJob } from '../../qvac/prep';
import { readPrepStore, writePrepStore } from '../../storage/prep';
import { listVisits, type Visit } from '../../storage/visits';

function openVisit(visitId: string) {
  router.push({ pathname: '/visit/[id]', params: { id: visitId } });
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PrepScreen() {
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [store, setStore] = useState<PrepStore>(EMPTY_STORE);
  const storeRef = useRef(store);
  const [draft, setDraft] = useState('');
  const job = usePrepJob();
  const headerHeight = useHeaderHeight();
  // Changes to the store are written in order, never two at once.
  const writing = useRef<Promise<void>>(Promise.resolve());

  const reload = useCallback(async () => {
    const [all, saved] = await Promise.all([listVisits().catch(() => []), readPrepStore()]);
    setVisits(all);
    storeRef.current = pruneDone(saved, new Set(all.map((v) => v.id)));
    setStore(storeRef.current);
    return all;
  }, []);

  // On focus: load, then look for open questions in visits not checked yet,
  // unless the last run was cancelled or failed (then "Check again" does it).
  const { cancelled, error } = job;
  useFocusEffect(
    useCallback(() => {
      void reload().then((all) => {
        if (!cancelled && !error && buildPrepList(all, EMPTY_STORE).pending > 0) {
          void findPrepQuestions();
        }
      });
    }, [reload, cancelled, error]),
  );

  // Show the new questions as soon as a run ends.
  const running = !!job.running;
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) void reload();
    wasRunning.current = running;
  }, [running, reload]);

  const change = useCallback((next: (s: PrepStore) => PrepStore) => {
    const updated = next(storeRef.current);
    storeRef.current = updated;
    setStore(updated);
    writing.current = writing.current
      .then(() => writePrepStore(updated))
      .catch((e) => Alert.alert('Could not save your list', e instanceof Error ? e.message : String(e)));
  }, []);

  const toggle = (key: string) =>
    change((s) => {
      const done = { ...s.done };
      if (key in done) delete done[key];
      else done[key] = new Date().toISOString();
      return { ...s, done };
    });

  const add = () => {
    const text = draft.replace(/\s+/g, ' ').trim();
    if (!text) return;
    setDraft('');
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    change((s) => ({ ...s, own: [...s.own, { id, text, createdAt: new Date().toISOString() }] }));
  };

  const remove = (id: string) =>
    change((s) => {
      const done = { ...s.done };
      delete done[ownKey(id)];
      return { own: s.own.filter((q) => q.id !== id), done };
    });

  if (visits === null) return <ActivityIndicator style={styles.loading} />;

  const list = buildPrepList(visits, store);
  const share = () => void Share.share({ message: shareText(list) }).catch(() => undefined);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        <Intro list={list} onShare={share} />
        <Status job={job} pending={list.pending} />

        <Section title="My questions" hint="Questions you want to ask next time.">
          {list.own.map((item) => (
            <Row key={item.key} item={item} onToggle={toggle} onRemove={remove} />
          ))}
          <View style={styles.addRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Add a question"
              placeholderTextColor="#888"
              accessibilityLabel="Your own question"
              maxLength={300}
              style={styles.input}
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              onSubmitEditing={add}
            />
            <Pressable
              onPress={add}
              disabled={!draft.trim()}
              style={({ pressed }) => [styles.addButton, !draft.trim() && styles.disabled, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Add question"
            >
              <Text style={styles.addText}>Add</Text>
            </Pressable>
          </View>
        </Section>

        <Section
          title="Not answered last time"
          hint="Questions you asked that the doctor did not answer."
          empty={
            list.questions.length || list.pending
              ? undefined
              : list.visits.length
                ? 'Every question you asked was answered.'
                : 'Nothing yet: this fills in once a visit has a summary.'
          }
        >
          {list.questions.map((item) => (
            <Row key={item.key} item={item} onToggle={toggle} />
          ))}
        </Section>

        <Section
          title="Your doctor asked you to"
          hint="The next steps from your visits."
          empty={
            list.followUps.length
              ? undefined
              : list.visits.length
                ? 'No next steps in these visits.'
                : 'Nothing yet.'
          }
        >
          {list.followUps.map((item) => (
            <Row key={item.key} item={item} onToggle={toggle} />
          ))}
        </Section>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Intro({ list, onShare }: { list: PrepList; onShare: () => void }) {
  const count = list.visits.length;
  const from =
    count === 0
      ? 'Once a visit has a summary, '
      : `From your last ${count === 1 ? 'visit' : `${count} visits`}: `;
  return (
    <View style={styles.intro}>
      <Text style={styles.introText}>
        {from}
        questions the doctor did not answer and what they asked you to do. Tick things off as you go.
        This list only repeats your visits; it never adds advice.
      </Text>
      <Pressable
        onPress={onShare}
        style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.shareText}>Share list</Text>
      </Pressable>
    </View>
  );
}

function Status({ job, pending }: { job: ReturnType<typeof usePrepJob>; pending: number }) {
  if (job.running) {
    const { done, total } = job.running;
    return (
      <View style={styles.statusRow} accessibilityLiveRegion="polite">
        <ActivityIndicator size="small" />
        <Text style={styles.status}>
          Looking for open questions ({Math.min(done + 1, total)} of {total}{' '}
          {total === 1 ? 'visit' : 'visits'})…
        </Text>
        <Pressable onPress={job.running.cancel} hitSlop={8} accessibilityRole="button">
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      </View>
    );
  }
  if (!pending) return null;
  return (
    <View style={[styles.notice, job.error ? styles.errorNotice : null]}>
      <Text style={styles.noticeText}>
        {job.error
          ? job.error
          : `${pending === 1 ? '1 visit has' : `${pending} visits have`} not been checked for open questions yet.`}
      </Text>
      <Pressable
        onPress={() => void findPrepQuestions()}
        style={({ pressed }) => [styles.checkButton, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.checkText}>{job.error ? 'Try again' : 'Check now'}</Text>
      </Pressable>
    </View>
  );
}

function Section({
  title,
  hint,
  empty,
  children,
}: {
  title: string;
  hint: string;
  empty?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.hint}>{hint}</Text>
      {children}
      {empty && <Text style={styles.empty}>{empty}</Text>}
    </View>
  );
}

function Row({
  item,
  onToggle,
  onRemove,
}: {
  item: PrepItem;
  onToggle: (key: string) => void;
  onRemove?: (id: string) => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => onToggle(item.key)}
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.done }}
        accessibilityLabel={item.text}
      >
        <View style={[styles.box, item.done && styles.boxDone]}>
          {item.done && <Text style={styles.tick}>✓</Text>}
        </View>
        <View style={styles.rowText}>
          <Text style={[styles.itemText, item.done && styles.doneText]}>{item.text}</Text>
          {item.kind === 'question' && item.evidence && tidy(item.evidence) !== tidy(item.text) && (
            <Text style={styles.detail}>You asked: “{item.evidence}”</Text>
          )}
          {item.kind === 'followUp' && item.followUp && item.due && (
            <Text style={styles.due}>
              Your doctor said {describeFollowUp(item.followUp)} · around {shortDate(item.due)}
            </Text>
          )}
        </View>
      </Pressable>
      {item.kind !== 'own' ? (
        <Pressable
          onPress={() => openVisit(item.visitId)}
          style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
          accessibilityRole="link"
          accessibilityHint="Opens this visit"
        >
          <Text style={styles.chipText}>{item.label.replace(/^Visit – /, '')}</Text>
        </Pressable>
      ) : (
        onRemove && (
          <Pressable
            onPress={() => onRemove(item.id)}
            hitSlop={10}
            style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Remove “${item.text}”`}
          >
            <Text style={styles.removeText}>✕</Text>
          </Pressable>
        )
      )}
    </View>
  );
}

function tidy(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const styles = StyleSheet.create({
  loading: { marginTop: 40 },
  container: { flex: 1 },
  content: { padding: 16, gap: 18, paddingBottom: 40 },
  intro: { gap: 10 },
  introText: { fontSize: 15, lineHeight: 21, color: '#666' },
  shareButton: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1F6FEB',
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  shareText: { color: '#1F6FEB', fontSize: 15, fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { flex: 1, fontSize: 14, color: '#666' },
  cancel: { fontSize: 15, color: '#CF222E', fontWeight: '600' },
  notice: { borderRadius: 12, padding: 12, gap: 8, backgroundColor: 'rgba(127,127,127,0.12)' },
  errorNotice: { backgroundColor: 'rgba(207,34,46,0.1)' },
  noticeText: { fontSize: 14, lineHeight: 20, color: '#24292F' },
  checkButton: { alignSelf: 'flex-start', paddingVertical: 4 },
  checkText: { color: '#1F6FEB', fontSize: 15, fontWeight: '600' },
  section: { gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#888', textTransform: 'uppercase' },
  hint: { fontSize: 14, color: '#888', marginTop: -4 },
  empty: { fontSize: 15, color: '#666', fontStyle: 'italic' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(127,127,127,0.08)',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#1F6FEB',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxDone: { backgroundColor: '#1F6FEB' },
  tick: { color: '#fff', fontSize: 14, fontWeight: '700' },
  rowText: { flex: 1, gap: 3 },
  itemText: { fontSize: 16, lineHeight: 22, color: '#24292F' },
  doneText: { color: '#888', textDecorationLine: 'line-through' },
  detail: { fontSize: 13, lineHeight: 18, color: '#666' },
  due: { fontSize: 14, fontWeight: '600', color: '#1A7F37' },
  chip: {
    borderRadius: 999,
    backgroundColor: 'rgba(31,111,235,0.12)',
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  chipText: { color: '#1F6FEB', fontSize: 12, fontWeight: '600' },
  remove: { padding: 4 },
  removeText: { color: '#888', fontSize: 16 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: 'rgba(127,127,127,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: '#24292F',
  },
  addButton: { backgroundColor: '#1F6FEB', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16 },
  addText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
});
