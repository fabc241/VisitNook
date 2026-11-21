// Peer-to-peer worker. Runs in its own Bare worklet, next to the QVAC worker,
// and reuses the native addons the QVAC Expo plugin already links into the app
// (udx-native, sodium-native, ...). Packed by `npm run p2p:pack`.
//
// Function 1 (connection test): join a Hyperswarm topic made from a test code,
// report every connection, and pass short text messages both ways.
//
// IPC with the app: one JSON object per line, both directions.

const Hyperswarm = require('hyperswarm')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')

const TOPIC_PREFIX = 'visit-notes/connection-test/v1:'
const MAX_MESSAGE_BYTES = 4096
const HEARTBEAT_MS = 2000

module.exports = function start(ipc) {
  let swarm = null
  let discovery = null
  const peers = new Map() // public key (hex) → { conn, peer, pingsIn, pingsOut, lastHeardAt, connectedAt }
  let inbound = ''

  function send(message) {
    ipc.write(b4a.from(JSON.stringify(message) + '\n'))
  }

  function log(text) {
    send({ type: 'log', text })
  }

  function errorText(error) {
    return error && error.message ? error.message : String(error)
  }

  function describe(conn, info) {
    const raw = conn.rawStream || {}
    const host = raw.remoteHost || null
    return {
      publicKey: b4a.toString(info.publicKey, 'hex'),
      host,
      port: raw.remotePort || null,
      sameNetwork: host ? isPrivateAddress(host) : null,
      initiator: !!info.client,
      relayed: !!(conn.relayedThrough || info.relayedThrough)
    }
  }

  function network() {
    const dht = swarm && swarm.dht
    if (!dht) return null
    return {
      ownKey: b4a.toString(swarm.keyPair.publicKey, 'hex'),
      host: dht.host || null,
      port: dht.port || null,
      firewalled: dht.firewalled,
      // A random NAT gives every connection a new port. Two peers that are
      // both behind one cannot hole-punch (HOLEPUNCH_DOUBLE_RANDOMIZED_NATS).
      randomized: dht.randomized,
      bootstrapped: dht.bootstrapped
    }
  }

  async function startSwarm(code) {
    await stopSwarm()
    const topic = topicFor(code)
    swarm = new Hyperswarm()

    swarm.on('connection', (conn, info) => {
      const peer = describe(conn, info)
      const entry = { conn, peer, pingsIn: 0, pingsOut: 0, lastHeardAt: Date.now(), connectedAt: Date.now() }
      // A newer connection to the same device replaces the older one.
      peers.set(peer.publicKey, entry)
      send({ type: 'peer-joined', peer })

      // Heartbeat: shows on both sides whether data still flows each way.
      const heartbeat = setInterval(() => {
        entry.pingsOut++
        conn.write(b4a.from(JSON.stringify({ ping: entry.pingsOut }) + '\n'))
      }, HEARTBEAT_MS)

      let buffered = ''
      conn.on('data', (data) => {
        entry.lastHeardAt = Date.now()
        buffered += b4a.toString(data)
        let newline
        while ((newline = buffered.indexOf('\n')) !== -1) {
          const line = buffered.slice(0, newline)
          buffered = buffered.slice(newline + 1)
          if (line.length > MAX_MESSAGE_BYTES) continue
          try {
            const message = JSON.parse(line)
            if (message && typeof message.ping === 'number') {
              entry.pingsIn++
            } else if (message && typeof message.text === 'string') {
              send({ type: 'message', from: peer.publicKey, text: message.text.slice(0, 1000) })
            }
          } catch {
            // Ignore anything that is not one of our messages.
          }
        }
        if (buffered.length > MAX_MESSAGE_BYTES) buffered = ''
      })
      let closeReason = 'closed'
      conn.on('error', (error) => {
        closeReason = errorText(error)
      })
      conn.on('close', () => {
        clearInterval(heartbeat)
        const seconds = Math.round((Date.now() - entry.connectedAt) / 1000)
        log(`${peer.publicKey.slice(0, 8)} disconnected after ${seconds} s: ${closeReason} (pings in ${entry.pingsIn}, out ${entry.pingsOut})`)
        if (peers.get(peer.publicKey) === entry) {
          peers.delete(peer.publicKey)
          send({ type: 'peer-left', publicKey: peer.publicKey })
        }
      })
    })

    send({ type: 'status', state: 'joining', network: network() })
    discovery = swarm.join(topic, { server: true, client: true })
    await discovery.flushed()
    send({ type: 'status', state: 'listening', network: network() })
  }

  async function stopSwarm() {
    const current = swarm
    swarm = null
    discovery = null
    peers.clear()
    if (current) await current.destroy()
  }

  function peerStats() {
    const now = Date.now()
    return [...peers.values()].map((e) => ({
      publicKey: e.peer.publicKey,
      pingsIn: e.pingsIn,
      pingsOut: e.pingsOut,
      silentMs: now - e.lastHeardAt
    }))
  }

  function sendText(text) {
    const line = JSON.stringify({ text: String(text).slice(0, 1000) }) + '\n'
    for (const { conn } of peers.values()) conn.write(b4a.from(line))
    send({ type: 'sent', text, to: peers.size })
  }

  async function handle(message) {
    try {
      if (message.type === 'start') {
        await startSwarm(String(message.code))
      } else if (message.type === 'stop') {
        await stopSwarm()
        send({ type: 'status', state: 'stopped', network: null })
      } else if (message.type === 'send') {
        sendText(message.text)
      } else if (message.type === 'refresh') {
        send({ type: 'status', state: swarm ? 'listening' : 'stopped', network: network() })
        send({ type: 'peer-stats', peers: peerStats() })
      }
    } catch (error) {
      send({ type: 'error', text: errorText(error) })
    }
  }

  ipc.on('data', (data) => {
    inbound += b4a.toString(data)
    let newline
    while ((newline = inbound.indexOf('\n')) !== -1) {
      const line = inbound.slice(0, newline)
      inbound = inbound.slice(newline + 1)
      try {
        handle(JSON.parse(line))
      } catch (error) {
        send({ type: 'error', text: `bad message from the app: ${errorText(error)}` })
      }
    }
  })

  send({ type: 'ready' })
}

/** The swarm topic for a test code. Both peers must type the same code. */
function topicFor(code) {
  return crypto.hash(b4a.from(TOPIC_PREFIX + String(code).trim().toLowerCase()))
}

function isPrivateAddress(host) {
  return (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^127\./.test(host) ||
    /^(fc|fd|fe80)/i.test(host)
  )
}

module.exports.topicFor = topicFor
module.exports.isPrivateAddress = isPrivateAddress
