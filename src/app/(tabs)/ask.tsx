import { router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  askQuestion,
  clearChat,
  useChat,
  type ChatMessage,
  type ChatPhase,
  type Source,
} from '../../qvac/chat';

const EXAMPLES = [
  'What did my doctor say about my blood pressure?',
  'When did my doctor want me to come back?',
  'Which tests did my doctor order?',
];

function phaseText(phase: ChatPhase): string {
  switch (phase.kind) {
    case 'preparing':
      return 'Getting ready…';
    case 'indexing':
      return `Preparing your visits for search (${phase.done + 1} of ${phase.total})…`;
    case 'searching':
      return 'Searching your visits…';
    case 'writing':
      return 'Writing the answer…';
  }
}

function openVisit(visitId: string) {
  router.push({ pathname: '/visit/[id]', params: { id: visitId } });
}

export default function AskScreen() {
  const { messages, running } = useChat();
  const [draft, setDraft] = useState('');
  const headerHeight = useHeaderHeight();
  const list = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    if (messages.length) requestAnimationFrame(() => list.current?.scrollToEnd({ animated: true }));
  }, [messages.length, running]);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || running) return;
    setDraft('');
    void askQuestion(q);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <FlatList
        ref={list}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={<Intro showExamples={!messages.length} onExample={send} busy={!!running} />}
        renderItem={({ item }) => <Bubble message={item} />}
        ListFooterComponent={
          running ? (
            <View style={styles.statusRow} accessibilityLiveRegion="polite">
              <ActivityIndicator size="small" />
              <Text style={styles.status}>{phaseText(running.phase)}</Text>
              <Pressable onPress={running.cancel} hitSlop={8} accessibilityRole="button">
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            </View>
          ) : messages.length ? (
            <Pressable onPress={clearChat} style={styles.clear} accessibilityRole="button">
              <Text style={styles.clearText}>Clear conversation</Text>
            </Pressable>
          ) : undefined
        }
      />
      <View style={styles.inputBar}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask about your visits"
          placeholderTextColor="#888"
          accessibilityLabel="Your question"
          multiline
          maxLength={500}
          style={styles.input}
          submitBehavior="blurAndSubmit"
          returnKeyType="send"
          onSubmitEditing={() => send(draft)}
        />
        <Pressable
          onPress={() => send(draft)}
          disabled={!draft.trim() || !!running}
          style={({ pressed }) => [
            styles.send,
            (!draft.trim() || !!running) && styles.sendDisabled,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Ask"
        >
          <Text style={styles.sendText}>Ask</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Intro({
  showExamples,
  onExample,
  busy,
}: {
  showExamples: boolean;
  onExample: (q: string) => void;
  busy: boolean;
}) {
  return (
    <View style={styles.intro}>
      <Text style={styles.introText}>
        Answers come only from your own visit notes, on this iPhone. This can’t give medical advice:
        for that, please ask your doctor.
      </Text>
      {showExamples && (
        <View style={styles.examples}>
          <Text style={styles.examplesTitle}>Try asking</Text>
          {EXAMPLES.map((q) => (
            <Pressable
              key={q}
              onPress={() => onExample(q)}
              disabled={busy}
              style={({ pressed }) => [styles.example, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.exampleText}>{q}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <View style={[styles.bubble, styles.user]}>
        <Text style={styles.userText}>{message.text}</Text>
      </View>
    );
  }

  if (message.kind === 'answer') {
    return (
      <View style={[styles.bubble, styles.assistant]}>
        <Text style={styles.answerText}>
          {message.segments.map((s, i) =>
            s.kind === 'text' ? (
              s.text
            ) : (
              <Text
                key={i}
                style={styles.cite}
                onPress={() => openVisit(s.visitId)}
                accessibilityRole="link"
                accessibilityHint="Opens this visit"
              >
                {` ${s.label} `}
              </Text>
            ),
          )}
        </Text>
        <Sources sources={message.sources} title="From" />
      </View>
    );
  }

  const tone =
    message.kind === 'declined' || message.kind === 'withheld'
      ? styles.notice
      : message.kind === 'error'
        ? styles.error
        : styles.assistant;
  return (
    <View style={[styles.bubble, tone]}>
      {message.kind === 'declined' && <Text style={styles.noticeTitle}>Not medical advice</Text>}
      {message.kind === 'withheld' && <Text style={styles.noticeTitle}>Removed by safety check</Text>}
      <Text style={styles.answerText}>{message.text}</Text>
      {message.note && <Text style={styles.note}>{message.note}</Text>}
      {message.sources && <Sources sources={message.sources} title="Searched" />}
    </View>
  );
}

function Sources({ sources, title }: { sources: Source[]; title: string }) {
  if (!sources.length) return null;
  return (
    <View style={styles.sources}>
      <Text style={styles.sourcesTitle}>{title}</Text>
      {sources.map((s) => (
        <Pressable
          key={s.visitId}
          onPress={() => openVisit(s.visitId)}
          style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
          accessibilityRole="link"
        >
          <Text style={styles.chipText}>{s.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, gap: 10 },
  intro: { gap: 12, marginBottom: 6 },
  introText: { fontSize: 15, lineHeight: 21, color: '#666' },
  examples: { gap: 8 },
  examplesTitle: { fontSize: 13, fontWeight: '600', color: '#888', textTransform: 'uppercase' },
  example: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1F6FEB',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  exampleText: { color: '#1F6FEB', fontSize: 15 },
  bubble: { borderRadius: 14, padding: 12, maxWidth: '92%', gap: 6 },
  user: { alignSelf: 'flex-end', backgroundColor: '#1F6FEB' },
  userText: { color: '#fff', fontSize: 16, lineHeight: 22 },
  assistant: { alignSelf: 'flex-start', backgroundColor: 'rgba(127,127,127,0.12)' },
  notice: { alignSelf: 'flex-start', backgroundColor: 'rgba(154,103,0,0.12)' },
  error: { alignSelf: 'flex-start', backgroundColor: 'rgba(207,34,46,0.1)' },
  noticeTitle: { fontSize: 13, fontWeight: '700', color: '#9A6700', textTransform: 'uppercase' },
  answerText: { fontSize: 16, lineHeight: 23, color: '#24292F' },
  cite: { color: '#1F6FEB', fontWeight: '600', fontSize: 14 },
  note: { fontSize: 14, lineHeight: 20, color: '#555' },
  sources: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 2 },
  sourcesTitle: { fontSize: 12, fontWeight: '600', color: '#888', textTransform: 'uppercase' },
  chip: {
    borderRadius: 999,
    backgroundColor: 'rgba(31,111,235,0.12)',
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  chipText: { color: '#1F6FEB', fontSize: 13, fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  status: { flex: 1, fontSize: 14, color: '#666' },
  cancel: { fontSize: 15, color: '#CF222E', fontWeight: '600' },
  clear: { alignSelf: 'center', paddingVertical: 8 },
  clearText: { color: '#888', fontSize: 14 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ccc',
  },
  input: {
    flex: 1,
    maxHeight: 120,
    borderRadius: 12,
    backgroundColor: 'rgba(127,127,127,0.12)',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    color: '#24292F',
  },
  send: {
    backgroundColor: '#1F6FEB',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 18,
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
