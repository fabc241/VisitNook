import { Link, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useClipPlayer } from '../../../audio/useClipPlayer';
import { FollowUpReminder } from '../../../components/FollowUpReminder';
import { ShareVisit } from '../../../components/ShareVisit';
import { ShareWithPeople } from '../../../components/ShareWithPeople';
import { VisitPlayback } from '../../../components/VisitPlayback';
import { checkSummary, describeFollowUp, type CheckedSummary } from '../../../guardrails/check';
import {
  clearSummaryError,
  ensureSafetyChecked,
  summarizeVisit,
  useSummaryJob,
  type SummaryPhase,
} from '../../../qvac/summarize';
import {
  clearTranscriptionError,
  transcribeVisit,
  useTranscriptionJob,
} from '../../../qvac/transcribe';
import { reminderCandidates, reminderKey, type ReminderCandidate } from '../../../reminders/plan';
import { canShare } from '../../../share/visit';
import {
  getVisit,
  type NextStep,
  type RemovedItem,
  type SummaryItem,
  type Visit,
} from '../../../storage/visits';
import { hasDoctorLines, transcriptLines } from '../../../summary/transcript';
import { roleOf, speakerLabel, speakerOverview } from '../../../transcript/speakers';
import { formatDuration } from '../../../utils/time';

export default function VisitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [visit, setVisit] = useState<Visit | null | undefined>(undefined);
  const job = useTranscriptionJob(id);
  const summaryJob = useSummaryJob(id);

  const reload = useCallback(() => {
    getVisit(id)
      .then((v) => (v ? ensureSafetyChecked(v) : v))
      .then(setVisit)
      .catch(() => setVisit(null));
  }, [id]);

  // Reload when coming back from the speaker screen…
  useFocusEffect(reload);
  // …and when a transcription or summary finishes.
  useEffect(() => {
    if (job === null && summaryJob === null) reload();
  }, [job, summaryJob, reload]);

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

      {!running && visit.status !== 'recorded' && (
        <>
          {turns.length === 0 ? (
            <Text style={styles.body}>No speech was found in this recording.</Text>
          ) : (
            <>
              {visit.speakerMap && <SummarySection visit={visit} onChanged={reload} />}
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

function SummarySection({ visit, onChanged }: { visit: Visit; onChanged: () => void }) {
  const job = useSummaryJob(visit.id);
  const [devTest, setDevTest] = useState<CheckedSummary | null>(null);

  if (job?.state === 'running') {
    return <Summarizing startedAt={job.startedAt} phase={job.phase} onCancel={job.cancel} />;
  }
  if (job?.state === 'failed') {
    return (
      <View style={styles.card}>
        <Text style={styles.error}>The summary could not be written: {job.error}</Text>
        <Pressable
          style={styles.primary}
          onPress={() => {
            clearSummaryError(visit.id);
            void summarizeVisit(visit.id);
          }}
        >
          <Text style={styles.primaryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (!visit.summary || !visit.nextSteps) {
    if (!hasDoctorLines(visit.turns ?? [], visit.speakerMap)) {
      return (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Summary</Text>
          <Text style={styles.body}>
            Every line is marked as you, so there is nothing from your doctor to summarize. If that
            is wrong, change which voice is yours below.
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Summary</Text>
        <Text style={styles.body}>
          Write a plain-English summary of what your doctor said, and the next steps they gave you.
          This runs on this iPhone and can take a few minutes.
        </Text>
        <Pressable style={styles.primary} onPress={() => void summarizeVisit(visit.id)}>
          <Text style={styles.primaryText}>Write summary</Text>
        </Pressable>
      </View>
    );
  }

  const shown = devTest ?? {
    summary: visit.summary,
    nextSteps: visit.nextSteps,
    removed: visit.removed ?? [],
  };
  // Calendar buttons only for the saved, checked summary, never the developer test.
  const reminders = new Map<string, ReminderCandidate>(
    devTest ? [] : reminderCandidates(visit).map((c) => [c.key, c]),
  );

  return (
    <>
      {devTest && (
        <View style={[styles.card, styles.devCard]}>
          <Text style={styles.body}>
            Developer test: a made-up line naming metformin was added and checked. Nothing is saved.
          </Text>
          <Pressable style={styles.secondary} onPress={() => setDevTest(null)}>
            <Text style={styles.secondaryText}>End the test</Text>
          </Pressable>
        </View>
      )}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>What your doctor said</Text>
        {shown.summary.length === 0 ? (
          <Text style={styles.body}>No summary points were found in this visit.</Text>
        ) : (
          shown.summary.map((item, i) => <SummaryLine key={i} item={item} />)
        )}
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Next steps</Text>
        {shown.nextSteps.length === 0 ? (
          <Text style={styles.body}>Your doctor did not give any next steps in this recording.</Text>
        ) : (
          shown.nextSteps.map((item, i) => {
            const candidate = reminders.get(reminderKey(item));
            return (
              <View key={i}>
                <SummaryLine item={item} />
                {candidate && (
                  <FollowUpReminder visitId={visit.id} candidate={candidate} onAdded={onChanged} />
                )}
              </View>
            );
          })
        )}
      </View>
      <RemovedSection removed={shown.removed} />
      <Text style={styles.disclaimer}>
        Written on this iPhone from the recording. It can contain mistakes. It is not medical advice;
        check with your doctor if anything is unclear.
      </Text>
      {!devTest && canShare(visit) && <ShareVisit visit={visit} />}
      {!devTest && canShare(visit) && <ShareWithPeople visit={visit} onChanged={onChanged} />}
      <Pressable style={styles.secondary} onPress={() => void summarizeVisit(visit.id)}>
        <Text style={styles.secondaryText}>Write the summary again</Text>
      </Pressable>
      {__DEV__ && !devTest && (
        <Pressable style={styles.secondary} onPress={() => setDevTest(safetyCheckDevTest(visit))}>
          <Text style={styles.secondaryText}>Test the safety check (developer)</Text>
        </Pressable>
      )}
    </>
  );
}

/**
 * Developer-only: adds a summary line naming a medicine the doctor never
 * said, quoting a real doctor line so only the medicine check can catch it.
 */
function safetyCheckDevTest(visit: Visit): CheckedSummary {
  const lines = transcriptLines(visit.turns ?? [], visit.speakerMap);
  const doctorLine = lines
    .filter((l) => l.speaker === 'Doctor')
    .sort((a, b) => b.text.length - a.text.length)[0];
  const quote = (doctorLine?.text ?? '').split(/\s+/).slice(0, 20).join(' ');
  const fake: SummaryItem = { text: 'You will start metformin 500 mg twice a day.', evidence: quote };
  const checked = checkSummary(
    { summary: [...(visit.summary ?? []), fake], nextSteps: visit.nextSteps ?? [] },
    lines,
  );
  return { ...checked, removed: [...checked.removed, ...(visit.removed ?? [])] };
}

function RemovedSection({ removed }: { removed: RemovedItem[] }) {
  const [open, setOpen] = useState(false);

  if (removed.length === 0) {
    return (
      <Text style={styles.safetyOk}>
        Safety check: every line above matches something your doctor said.
      </Text>
    );
  }
  return (
    <View style={[styles.card, styles.removedCard]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={styles.removedHeader}
      >
        <Text style={styles.cardTitle}>Removed by safety check ({removed.length})</Text>
        <Text style={styles.chevron}>{open ? '▲' : '▼'}</Text>
      </Pressable>
      <Text style={styles.body}>
        These were written by the app but could not be matched to what your doctor said, so they
        were left out.
      </Text>
      {open &&
        removed.map((item, i) => (
          <View key={i} style={styles.removedItem}>
            <Text style={styles.removedSection}>
              {item.section === 'summary' ? 'Summary' : 'Next step'}
              {item.kind === 'followUp' && item.followUp
                ? ` · time frame “${describeFollowUp(item.followUp)}” removed`
                : ''}
            </Text>
            <Text style={[styles.itemText, item.kind === 'item' && styles.struck]}>{item.text}</Text>
            <Text style={styles.reason}>{item.reason}</Text>
            <Text style={styles.evidence}>Quote given: “{item.evidence}”</Text>
          </View>
        ))}
    </View>
  );
}

function SummaryLine({ item }: { item: SummaryItem | NextStep }) {
  const followUp = 'followUp' in item ? item.followUp : undefined;
  return (
    <View style={styles.item}>
      <Text style={styles.itemText}>• {item.text}</Text>
      {followUp && (
        <Text style={styles.followUp}>
          In {followUp.amount} {followUp.amount === 1 ? followUp.unit.replace(/s$/, '') : followUp.unit}
        </Text>
      )}
      <Text style={styles.evidence}>Doctor: “{item.evidence}”</Text>
    </View>
  );
}

function phaseText(phase: SummaryPhase): string {
  switch (phase.kind) {
    case 'loading':
      return 'Loading the language model…';
    case 'measuring':
      return 'Reading the transcript…';
    case 'writing':
      return phase.parts > 1
        ? `Writing the summary, part ${phase.part} of ${phase.parts}…`
        : 'Writing the summary…';
    case 'merging':
      return 'Putting the parts together…';
  }
}

function Summarizing({
  startedAt,
  phase,
  onCancel,
}: {
  startedAt: number;
  phase: SummaryPhase;
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
        <Text style={styles.cardTitle}>{phaseText(phase)}</Text>
      </View>
      <Text style={styles.body}>
        {formatDuration(now - startedAt)} elapsed. Keep the app open; the screen stays on while
        this runs.
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
  item: { gap: 3 },
  itemText: { fontSize: 16, lineHeight: 22, color: '#24292F' },
  followUp: { fontSize: 14, fontWeight: '600', color: '#1A7F37', marginLeft: 12 },
  evidence: { fontSize: 13, lineHeight: 18, color: '#888', fontStyle: 'italic', marginLeft: 12 },
  disclaimer: { fontSize: 13, lineHeight: 18, color: '#888' },
  safetyOk: { fontSize: 13, lineHeight: 18, color: '#1A7F37' },
  removedCard: { backgroundColor: 'rgba(207,34,46,0.08)' },
  removedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chevron: { fontSize: 13, color: '#888' },
  removedItem: { gap: 3, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ccc' },
  removedSection: { fontSize: 12, fontWeight: '600', color: '#888', textTransform: 'uppercase' },
  struck: { textDecorationLine: 'line-through', color: '#666' },
  reason: { fontSize: 14, lineHeight: 19, color: '#CF222E' },
  devCard: { backgroundColor: 'rgba(191,135,0,0.15)' },
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
