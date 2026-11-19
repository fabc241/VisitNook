import { Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { MODELS, TOTAL_DOWNLOAD_BYTES, type ModelKey } from '../qvac/catalog';
import {
  allCached,
  checkModelsLoad,
  downloadModel,
  errorMessage,
  getCacheStatus,
  type CacheStatus,
  type DownloadProgress,
  type LoadCheckResult,
} from '../qvac/models';
import { setModelsReady, useModelsReady } from '../qvac/readiness';
import { formatBytes } from '../utils/bytes';

type Phase = 'checking' | 'idle' | 'downloading' | 'error' | 'ready';

const KEEP_AWAKE_TAG = 'model-download';
/** Space to leave free on top of the models themselves. */
const DISK_MARGIN_BYTES = 500e6;

export default function SetupScreen() {
  const readyNow = useModelsReady();
  // Opened from the Visits header (already set up) vs. first-run gate.
  const [wasReadyOnOpen] = useState(readyNow === true);
  const [phase, setPhase] = useState<Phase>('checking');
  const [status, setStatus] = useState<CacheStatus | null>(null);
  const [progress, setProgress] = useState<Partial<Record<ModelKey, DownloadProgress>>>({});
  const [active, setActive] = useState<ModelKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<LoadCheckResult[] | null>(null);
  const [checking, setChecking] = useState(false);

  const job = useRef<{ cancel: () => Promise<void> } | null>(null);
  const cancelled = useRef(false);
  const pending = useRef<Partial<Record<ModelKey, DownloadProgress>>>({});

  const applyStatus = useCallback((fresh: CacheStatus) => {
    setStatus(fresh);
    const ready = allCached(fresh);
    setModelsReady(ready);
    setPhase(ready ? 'ready' : 'idle');
  }, []);

  const applyError = useCallback((e: unknown) => {
    setError(errorMessage(e));
    setPhase('error');
  }, []);

  const refresh = () => {
    setPhase('checking');
    setError(null);
    return getCacheStatus().then(applyStatus, applyError);
  };

  useEffect(() => {
    getCacheStatus().then(applyStatus, applyError);
  }, [applyStatus, applyError]);

  // Progress events arrive many times a second; repaint at most 4 times a second.
  useEffect(() => {
    if (phase !== 'downloading') return;
    const timer = setInterval(() => setProgress({ ...pending.current }), 250);
    return () => clearInterval(timer);
  }, [phase]);

  const missing = status ? MODELS.filter((m) => !status[m.key]) : [];
  const missingBytes = missing.reduce((sum, m) => sum + m.descriptor.expectedSize, 0);

  const startDownload = async () => {
    const free = Paths.availableDiskSpace;
    if (free < missingBytes + DISK_MARGIN_BYTES) {
      Alert.alert(
        'Not enough space',
        `The models need ${formatBytes(missingBytes)} and this iPhone has ${formatBytes(free)} free. Free up some space and try again.`,
      );
      return;
    }

    cancelled.current = false;
    pending.current = {};
    setProgress({});
    setError(null);
    setPhase('downloading');
    await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    try {
      for (const model of missing) {
        setActive(model.key);
        const download = downloadModel(model, (p) => {
          pending.current[model.key] = p;
        });
        job.current = download;
        await download.done;
        job.current = null;
        setStatus((s) => (s ? { ...s, [model.key]: true } : s));
      }
      setActive(null);
      await refresh();
    } catch (e) {
      setActive(null);
      if (cancelled.current) {
        setPhase('idle');
      } else {
        setError(errorMessage(e));
        setPhase('error');
      }
    } finally {
      job.current = null;
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    }
  };

  const cancelDownload = () => {
    cancelled.current = true;
    void job.current?.cancel();
  };

  const runLoadCheck = async () => {
    setChecking(true);
    setChecks([]);
    try {
      await checkModelsLoad((r) => setChecks((prev) => [...(prev ?? []), r]));
    } finally {
      setChecking(false);
    }
  };

  const bytesFor = (key: ModelKey, expected: number): number => {
    if (status?.[key]) return expected;
    return progress[key]?.downloaded ?? 0;
  };
  const doneBytes = MODELS.reduce((sum, m) => sum + bytesFor(m.key, m.descriptor.expectedSize), 0);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>On-device models</Text>
      <Text style={styles.body}>
        Visit Notes transcribes and summarizes your visits on this iPhone. To do that it needs four
        AI models, about {formatBytes(TOTAL_DOWNLOAD_BYTES)} in total. They download once. After
        that the app works without internet, and your recordings, transcripts and summaries never
        leave this phone.
      </Text>

      {MODELS.map((m) => {
        const expected = m.descriptor.expectedSize;
        const cached = status?.[m.key] === true;
        const fraction = Math.min(1, bytesFor(m.key, expected) / expected);
        return (
          <View key={m.key} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{m.label}</Text>
              <Text style={[styles.badge, cached && styles.badgeDone]}>
                {cached ? 'Downloaded' : active === m.key ? `${Math.floor(fraction * 100)}%` : formatBytes(expected)}
              </Text>
            </View>
            <Text style={styles.cardBody}>{m.purpose}</Text>
            {(phase === 'downloading' || cached) && (
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${fraction * 100}%` }, cached && styles.fillDone]} />
              </View>
            )}
          </View>
        );
      })}

      {phase === 'checking' && <ActivityIndicator style={styles.spacer} />}

      {phase === 'idle' && (
        <>
          <Text style={styles.hint}>Use Wi-Fi and keep the app open until the download finishes.</Text>
          <Pressable style={styles.primary} onPress={() => void startDownload()}>
            <Text style={styles.primaryText}>Download {formatBytes(missingBytes)}</Text>
          </Pressable>
        </>
      )}

      {phase === 'downloading' && (
        <>
          <Text style={styles.hint}>
            {formatBytes(doneBytes)} of {formatBytes(TOTAL_DOWNLOAD_BYTES)}. Keep the app open; the
            screen stays on while this runs.
          </Text>
          <Pressable style={styles.secondary} onPress={cancelDownload}>
            <Text style={styles.secondaryText}>Pause download</Text>
          </Pressable>
        </>
      )}

      {phase === 'error' && (
        <>
          <Text style={styles.error}>The download stopped: {error}</Text>
          <Text style={styles.hint}>Check your connection. Downloaded parts are kept.</Text>
          <Pressable style={styles.primary} onPress={() => void refresh()}>
            <Text style={styles.primaryText}>Try again</Text>
          </Pressable>
        </>
      )}

      {phase === 'ready' && (
        <>
          <Text style={styles.ready}>All models are on this iPhone.</Text>
          {!wasReadyOnOpen && (
            <Pressable style={styles.primary} onPress={() => router.replace('/')}>
              <Text style={styles.primaryText}>Continue</Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.secondary, checking && styles.disabled]}
            disabled={checking}
            onPress={() => void runLoadCheck()}>
            <Text style={styles.secondaryText}>{checking ? 'Loading models…' : 'Check models load'}</Text>
          </Pressable>
          {checks?.map((c) => (
            <Text key={c.name} style={c.ok ? styles.checkOk : styles.error}>
              {c.ok ? '✓' : '✗'} {c.name} — {(c.ms / 1000).toFixed(1)} s{c.error ? `: ${c.error}` : ''}
            </Text>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12 },
  title: { fontSize: 24, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 22, color: '#444' },
  card: { borderRadius: 12, backgroundColor: '#F2F4F7', padding: 14, gap: 6 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardBody: { fontSize: 14, color: '#555' },
  badge: { fontSize: 13, color: '#555', fontVariant: ['tabular-nums'] },
  badgeDone: { color: '#1A7F37', fontWeight: '600' },
  track: { height: 6, borderRadius: 3, backgroundColor: '#D8DEE4', overflow: 'hidden' },
  fill: { height: 6, backgroundColor: '#1F6FEB' },
  fillDone: { backgroundColor: '#1A7F37' },
  spacer: { marginTop: 12 },
  hint: { fontSize: 14, color: '#666', textAlign: 'center' },
  primary: { backgroundColor: '#1F6FEB', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  secondary: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#1F6FEB' },
  secondaryText: { color: '#1F6FEB', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  ready: { fontSize: 16, color: '#1A7F37', textAlign: 'center', fontWeight: '600' },
  error: { fontSize: 14, color: '#CF222E' },
  checkOk: { fontSize: 14, color: '#1A7F37' },
});
