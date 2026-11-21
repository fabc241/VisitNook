// A second peer for the connection test, run on the Mac with Node:
//
//   npm run p2p:peer -- <test code>
//
// It joins the same topic as the app (same code → same topic, from
// p2p/worker.js), prints every connection, answers each message with an echo,
// and sends whatever you type here. Ctrl+C to stop.

import Hyperswarm from 'hyperswarm';
import b4a from 'b4a';
import { createRequire } from 'node:module';
import readline from 'node:readline';

const require = createRequire(import.meta.url);
const { topicFor, isPrivateAddress } = require('./worker.js');

const code = process.argv[2];
if (!code) {
  console.error('Usage: npm run p2p:peer -- <test code shown in the app>');
  process.exit(1);
}

const short = (key) => b4a.toString(key, 'hex').slice(0, 8);
const time = () => new Date().toLocaleTimeString();
const say = (text) => console.log(`${time()} ${text}`);
const swarm = new Hyperswarm();
const connections = new Set();

swarm.on('connection', (conn, info) => {
  const raw = conn.rawStream ?? {};
  const host = raw.remoteHost;
  const where = host ? (isPrivateAddress(host) ? 'same Wi-Fi' : 'over the internet') : 'unknown route';
  say(`+ connected ${short(info.publicKey)} · ${where} · ${host}:${raw.remotePort}`);
  connections.add(conn);
  const connectedAt = Date.now();
  let pingsIn = 0;
  let pingsOut = 0;
  let lastHeardAt = Date.now();
  let warned = false;
  const heartbeat = setInterval(() => {
    pingsOut++;
    conn.write(b4a.from(JSON.stringify({ ping: pingsOut }) + '\n'));
    const silent = Date.now() - lastHeardAt;
    if (silent > 6000 && !warned) {
      warned = true;
      say(`? nothing from ${short(info.publicKey)} for ${Math.round(silent / 1000)} s (pings in ${pingsIn}, out ${pingsOut})`);
    }
    if (pingsOut % 10 === 0) say(`♥ ${short(info.publicKey)}: pings in ${pingsIn}, out ${pingsOut}`);
  }, 2000);
  let closeReason = 'closed';

  let buffered = '';
  conn.on('data', (data) => {
    lastHeardAt = Date.now();
    if (warned) {
      warned = false;
      say(`! ${short(info.publicKey)} is talking again`);
    }
    buffered += b4a.toString(data);
    let newline;
    while ((newline = buffered.indexOf('\n')) !== -1) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      try {
        const message = JSON.parse(line);
        if (typeof message.ping === 'number') {
          pingsIn++;
          continue;
        }
        const { text } = message;
        say(`< ${short(info.publicKey)}: ${text}`);
        conn.write(b4a.from(JSON.stringify({ text: `Mac got: ${text}` }) + '\n'));
      } catch {
        // not one of our messages
      }
    }
  });
  conn.on('error', (error) => {
    closeReason = error.message;
  });
  conn.on('close', () => {
    clearInterval(heartbeat);
    connections.delete(conn);
    const seconds = Math.round((Date.now() - connectedAt) / 1000);
    say(`- disconnected ${short(info.publicKey)} after ${seconds} s: ${closeReason} (pings in ${pingsIn}, out ${pingsOut})`);
  });
});

console.log(`Joining with code "${code.trim().toLowerCase()}"…`);
const discovery = swarm.join(topicFor(code), { server: true, client: true });
await discovery.flushed();
const dht = swarm.dht;
console.log(`Announced. Mac ID ${short(swarm.keyPair.publicKey)}, public address ${dht.host}, firewalled: ${dht.firewalled}, NAT: ${!dht.firewalled ? 'open' : dht.randomized ? 'random' : 'consistent'}`);
console.log('Type a message and press Enter to send it to the iPhone.');

const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  for (const conn of connections) conn.write(b4a.from(JSON.stringify({ text }) + '\n'));
  say(`> sent to ${connections.size} peer(s)`);
});

process.on('SIGINT', async () => {
  console.log('\nLeaving…');
  input.close();
  await swarm.destroy();
  process.exit(0);
});
