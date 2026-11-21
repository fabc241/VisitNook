import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  refreshTest,
  sendTest,
  shortKey,
  startTest,
  stopTest,
  subscribe,
  type NetworkInfo,
  type PeerInfo,
  type PeerStats,
} from '../p2p/engine';

type State = 'idle' | 'starting' | 'joining' | 'listening' | 'stopped';
type LogLine = { id: number; at: string; text: string; tone?: 'in' | 'out' | 'error' };

let nextLogId = 1;

function randomCode(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += letters[Math.floor(Math.random() * letters.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function describePeer(peer: PeerInfo): string {
  const where =
    peer.sameNetwork === null ? 'unknown route' : peer.sameNetwork ? 'same Wi-Fi' : 'over the internet';
  const address = peer.host ? `${peer.host}:${peer.port}` : 'no address';
  return `${shortKey(peer.publicKey)} · ${where}${peer.relayed ? ' (relayed)' : ''} · ${address}`;
}

/**
 * Function 1 of "Share with people": checks that this iPhone can find and talk
 * to another peer over Hyperswarm, with no server of ours in between.
 */
export default function ConnectionTestScreen() {
  const [code, setCode] = useState(randomCode);
  const [state, setState] = useState<State>('idle');
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [stats, setStats] = useState<Record<string, PeerStats>>({});
  const [draft, setDraft] = useState('');
  const [log, setLog] = useState<LogLine[]>([]);

  const addLog = useCallback((text: string, tone?: LogLine['tone']) => {
    const at = new Date().toLocaleTimeString();
    setLog((lines) => [{ id: nextLogId++, at, text, tone }, ...lines].slice(0, 80));
  }, []);

  useEffect(
    () =>
      subscribe((event) => {
        switch (event.type) {
          case 'status':
            // The refresh timer repeats the status; only log real changes.
            setState((previous) => {
              if (previous !== event.state && event.state === 'listening') {
                addLog('Announced on the network. Waiting for the other peer…');
              }
              return event.state;
            });
            setNetwork(event.network);
            if (event.state === 'stopped') setPeers([]);
            break;
          case 'peer-stats':
            setStats(Object.fromEntries(event.peers.map((p) => [p.publicKey, p])));
            break;
          case 'peer-joined':
            setPeers((list) => [...list.filter((p) => p.publicKey !== event.peer.publicKey), event.peer]);
            addLog(`Connected: ${describePeer(event.peer)}`, 'in');
            break;
          case 'peer-left':
            setPeers((list) => list.filter((p) => p.publicKey !== event.publicKey));
            addLog(`Disconnected: ${shortKey(event.publicKey)}`);
            break;
          case 'message':
            addLog(`${shortKey(event.from)}: ${event.text}`, 'in');
            break;
          case 'sent':
            addLog(`You → ${event.to} peer${event.to === 1 ? '' : 's'}: ${event.text}`, 'out');
            break;
          case 'log':
            addLog(event.text);
            break;
          case 'error':
            addLog(event.text, 'error');
            break;
        }
      }),
    [addLog],
  );

  // Leave the swarm when the screen closes, so the test never runs in the background.
  useFocusEffect(
    useCallback(
      () => () => {
        stopTest().catch(() => {});
      },
      [],
    ),
  );

  // While connected, re-read the network details now and then: the public
  // address and the "firewalled" flag settle a few seconds after joining.
  useEffect(() => {
    if (state !== 'listening') return;
    const timer = setInterval(() => void refreshTest().catch(() => {}), 2000);
    return () => clearInterval(timer);
  }, [state]);

  const running = state === 'starting' || state === 'joining' || state === 'listening';

  const start = async () => {
    setState('starting');
    setPeers([]);
    addLog(`Joining with code "${code.trim().toLowerCase()}"…`);
    try {
      await startTest(code);
    } catch (error) {
      setState('stopped');
      addLog(`Could not start the P2P worker: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const stop = async () => {
    await stopTest().catch(() => {});
    addLog('Stopped.');
  };

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await sendTest(text).catch((error) => addLog(String(error), 'error'));
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.body}>
        Checks that this iPhone can reach another device directly, with no server in between. Type the
        same code on the other device (another iPhone with Visit Notes, or the Mac test peer), then tap
        Start on both.
      </Text>

      <Text style={styles.label}>Test code</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={setCode}
        editable={!running}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {running ? (
        <Pressable style={styles.secondary} onPress={() => void stop()}>
          <Text style={styles.secondaryText}>Stop</Text>
        </Pressable>
      ) : (
        <Pressable
          style={[styles.primary, !code.trim() && styles.disabled]}
          disabled={!code.trim()}
          onPress={() => void start()}>
          <Text style={styles.primaryText}>Start</Text>
        </Pressable>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>This iPhone</Text>
        <Text style={styles.row}>State: {state}</Text>
        {network && (
          <>
            <Text style={styles.row}>ID: {shortKey(network.ownKey)}</Text>
            <Text style={styles.row}>
              Public address: {network.host ? `${network.host}${network.port ? `:${network.port}` : ''}` : 'not known yet'}
            </Text>
            <Text style={styles.row}>
              Reachable directly: {network.firewalled ? 'no (behind a firewall or carrier NAT)' : 'yes'}
            </Text>
            <Text style={styles.row}>
              NAT type:{' '}
              {!network.host
                ? 'not known yet'
                : !network.firewalled
                  ? 'open'
                  : network.randomized
                    ? 'random (cannot connect to another random NAT)'
                    : 'consistent (hole punching works)'}
            </Text>
          </>
        )}
        {state === 'listening' && peers.length === 0 && (
          <Text style={styles.hint}>No peer yet. Finding one usually takes 5–30 seconds.</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Connected peers ({peers.length})</Text>
        {peers.length === 0 ? (
          <Text style={styles.row}>None</Text>
        ) : (
          peers.map((p) => {
            const s = stats[p.publicKey];
            return (
              <View key={p.publicKey}>
                <Text style={styles.row}>{describePeer(p)}</Text>
                {s && (
                  <Text style={[styles.row, s.silentMs > 6000 && styles.logError]}>
                    Heartbeat: {s.pingsIn} in, {s.pingsOut} out · last heard {Math.round(s.silentMs / 1000)} s ago
                  </Text>
                )}
              </View>
            );
          })
        )}
      </View>

      <View style={styles.sendRow}>
        <TextInput
          style={[styles.input, styles.flex]}
          value={draft}
          onChangeText={setDraft}
          placeholder={peers.length ? 'Message to send' : 'Connect first'}
          editable={peers.length > 0}
          onSubmitEditing={() => void send()}
          returnKeyType="send"
        />
        <Pressable
          style={[styles.sendButton, (!peers.length || !draft.trim()) && styles.disabled]}
          disabled={!peers.length || !draft.trim()}
          onPress={() => void send()}>
          <Text style={styles.primaryText}>Send</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>Log</Text>
      {log.map((line) => (
        <Text
          key={line.id}
          style={[
            styles.log,
            line.tone === 'in' && styles.logIn,
            line.tone === 'out' && styles.logOut,
            line.tone === 'error' && styles.logError,
          ]}>
          {line.at} {line.text}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12 },
  body: { fontSize: 15, lineHeight: 21, color: '#444' },
  label: { fontSize: 14, fontWeight: '600', color: '#555', marginTop: 4 },
  input: {
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  flex: { flex: 1 },
  primary: { backgroundColor: '#1F6FEB', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#1F6FEB' },
  secondaryText: { color: '#1F6FEB', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  card: { borderRadius: 12, backgroundColor: '#F2F4F7', padding: 14, gap: 4 },
  cardTitle: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  row: { fontSize: 14, color: '#333', fontVariant: ['tabular-nums'] },
  hint: { fontSize: 13, color: '#666', marginTop: 4 },
  sendRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  sendButton: { backgroundColor: '#1F6FEB', borderRadius: 10, paddingVertical: 11, paddingHorizontal: 16 },
  log: { fontSize: 13, color: '#555', fontFamily: 'Menlo' },
  logIn: { color: '#1A7F37' },
  logOut: { color: '#1F6FEB' },
  logError: { color: '#CF222E' },
});
