import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { HighlightedText } from '../../components/HighlightedText';
import { forgetVisit } from '../../qvac/rag';
import { useSummaryJob } from '../../qvac/summarize';
import { useTranscriptionJob } from '../../qvac/transcribe';
import {
  buildSearchIndex,
  queryTerms,
  searchVisits,
  type Range,
  type SearchResult,
  type Snippet,
} from '../../search/visits';
import { deleteVisit, listVisits, type Visit } from '../../storage/visits';
import { formatDuration } from '../../utils/time';

type Row = { visit: Visit; titleHighlights: Range[]; snippets: Snippet[]; matchingLines: number };
type Section = { title: string; data: Row[] };

function monthTitle(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Newest first, one section per month. */
function timelineSections(visits: Visit[]): Section[] {
  const sections: Section[] = [];
  for (const visit of visits) {
    const title = monthTitle(visit.date);
    const row: Row = { visit, titleHighlights: [], snippets: [], matchingLines: 0 };
    const last = sections[sections.length - 1];
    if (last?.title === title) last.data.push(row);
    else sections.push({ title, data: [row] });
  }
  return sections;
}

function resultSection(results: SearchResult[], query: string): Section[] {
  const count = results.length;
  const title =
    count === 0
      ? `No visits mention “${query.trim()}”`
      : `${count} ${count === 1 ? 'visit' : 'visits'} found`;
  return [{ title, data: results }];
}

export default function VisitsScreen() {
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [query, setQuery] = useState('');

  const reload = useCallback(() => {
    listVisits()
      .then(setVisits)
      .catch(() => setVisits([]));
  }, []);
  useFocusEffect(reload);

  // Folding the text for search happens once per load, not on every keystroke.
  const index = useMemo(() => buildSearchIndex(visits ?? []), [visits]);
  const searching = queryTerms(query).length > 0;
  const sections = useMemo(
    () =>
      searching ? resultSection(searchVisits(index, query), query) : timelineSections(visits ?? []),
    [searching, index, query, visits],
  );

  const confirmDelete = useCallback(
    (visit: Visit, busy: boolean) => {
      if (busy) {
        Alert.alert('Visit in use', 'Wait for the transcript or summary to finish, then try again.');
        return;
      }
      Alert.alert(
        'Delete this visit?',
        `“${visit.title}” — the recording, transcript, summary and its search data will be removed from this iPhone. This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              try {
                deleteVisit(visit.id);
                void forgetVisit(visit.id);
              } catch (error) {
                Alert.alert('Could not delete', error instanceof Error ? error.message : String(error));
              }
              reload();
            },
          },
        ],
      );
    },
    [reload],
  );

  if (visits === null) {
    return <ActivityIndicator style={styles.loading} />;
  }

  if (visits.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No visits yet</Text>
          <Text style={styles.body}>
            Record your next doctor visit and it will appear here, with its transcript and summary.
          </Text>
          <Pressable style={styles.primary} onPress={() => router.navigate('/record')}>
            <Text style={styles.primaryText}>Record a visit</Text>
          </Pressable>
        </View>
        <ModelsButton />
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(row) => row.visit.id}
      contentContainerStyle={styles.list}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={<SearchBar value={query} onChange={setQuery} />}
      renderSectionHeader={({ section }) => (
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {section.title}
        </Text>
      )}
      renderItem={({ item }) => (
        <VisitRow row={item} searching={searching} onDelete={confirmDelete} onJobDone={reload} />
      )}
      ListFooterComponent={
        <View style={styles.footer}>
          {!searching && (
            <Text style={styles.hint}>Press and hold a visit to delete it.</Text>
          )}
          <ModelsButton />
        </View>
      }
    />
  );
}

function SearchBar({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  return (
    <View style={styles.searchRow}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Search visits, summaries and transcripts"
        placeholderTextColor="#888"
        accessibilityLabel="Search visits"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
        style={styles.search}
      />
    </View>
  );
}

function statusText(visit: Visit, transcribing: boolean, summarizing: boolean): string {
  if (transcribing) return 'Transcribing…';
  if (summarizing) return 'Writing summary…';
  if (visit.status === 'recorded') return 'Not transcribed yet';
  if (visit.status === 'transcribed') {
    if (!visit.turns?.length) return 'No speech found';
    return visit.speakerMap ? 'Transcript ready' : 'Choose your voice';
  }
  return 'Summary ready';
}

function previewText(visit: Visit): string | null {
  const first = visit.summary?.[0]?.text ?? visit.turns?.[0]?.text;
  return first ?? null;
}

function fieldLabel(snippet: Snippet): string {
  return snippet.field === 'transcript' ? `Transcript · ${snippet.label}` : snippet.label;
}

function VisitRow({
  row,
  searching,
  onDelete,
  onJobDone,
}: {
  row: Row;
  searching: boolean;
  onDelete: (visit: Visit, busy: boolean) => void;
  onJobDone: () => void;
}) {
  const { visit, titleHighlights, snippets, matchingLines } = row;
  const transcribing = useTranscriptionJob(visit.id)?.state === 'running';
  const summarizing = useSummaryJob(visit.id)?.state === 'running';
  const busy = transcribing || summarizing;

  // A job that finishes while this list is showing changes the saved visit.
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) onJobDone();
    wasBusy.current = busy;
  }, [busy, onJobDone]);

  const date = new Date(visit.date);
  const when = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const preview = previewText(visit);
  const status = statusText(visit, transcribing, summarizing);
  const more = matchingLines - snippets.length;

  return (
    <Link href={{ pathname: '/visit/[id]', params: { id: visit.id } }} asChild>
      <Pressable
        onLongPress={() => onDelete(visit, busy)}
        accessibilityActions={[{ name: 'delete', label: 'Delete visit' }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'delete') onDelete(visit, busy);
        }}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <HighlightedText text={visit.title} highlights={titleHighlights} style={styles.rowTitle} />
        <Text style={styles.meta}>
          {when} · {time} · {formatDuration(visit.durationMs)}
        </Text>
        <View style={styles.statusRow}>
          {busy && <ActivityIndicator size="small" />}
          <Text style={[styles.status, visit.status === 'summarized' && !busy && styles.statusDone]}>
            {status}
          </Text>
        </View>
        {searching ? (
          <>
            {snippets.map((snippet, i) => (
              <View key={i} style={styles.snippet}>
                <Text style={styles.snippetLabel}>{fieldLabel(snippet)}</Text>
                <HighlightedText
                  text={snippet.text}
                  highlights={snippet.highlights}
                  style={styles.snippetText}
                />
              </View>
            ))}
            {more > 0 && (
              <Text style={styles.more}>
                +{more} more {more === 1 ? 'match' : 'matches'} in this visit
              </Text>
            )}
          </>
        ) : (
          preview && (
            <Text style={styles.preview} numberOfLines={2}>
              {preview}
            </Text>
          )
        )}
      </Pressable>
    </Link>
  );
}

function ModelsButton() {
  return (
    <Link href="/setup" asChild>
      <Pressable style={styles.secondary}>
        <Text style={styles.secondaryText}>On-device models</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 48 },
  container: { flex: 1, padding: 24 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyTitle: { fontSize: 22, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, color: '#666', textAlign: 'center' },
  list: { padding: 16, gap: 10 },
  searchRow: { marginBottom: 4 },
  search: {
    borderRadius: 12,
    backgroundColor: 'rgba(127,127,127,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#24292F',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 2,
  },
  row: { borderRadius: 14, backgroundColor: 'rgba(127,127,127,0.12)', padding: 14, gap: 4 },
  pressed: { opacity: 0.6 },
  rowTitle: { fontSize: 17, fontWeight: '600', color: '#24292F' },
  meta: { fontSize: 14, color: '#666', fontVariant: ['tabular-nums'] },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { fontSize: 13, fontWeight: '600', color: '#9A6700' },
  statusDone: { color: '#1A7F37' },
  preview: { fontSize: 15, lineHeight: 21, color: '#444', marginTop: 4 },
  snippet: {
    marginTop: 6,
    paddingTop: 6,
    gap: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ccc',
  },
  snippetLabel: { fontSize: 12, fontWeight: '600', color: '#888', textTransform: 'uppercase' },
  snippetText: { fontSize: 15, lineHeight: 21, color: '#444' },
  more: { fontSize: 13, color: '#888', marginTop: 4 },
  footer: { gap: 12, marginTop: 16 },
  hint: { fontSize: 13, color: '#888', textAlign: 'center' },
  primary: {
    backgroundColor: '#1F6FEB',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  secondary: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1F6FEB',
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryText: { color: '#1F6FEB', fontSize: 16, fontWeight: '600' },
});
