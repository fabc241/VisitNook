// The patient's shared visits: one Hyperbee on an encrypted Hypercore,
// stored on this phone with Corestore. Used by p2p/worker.js.
//
// Keys are `visit/<visit id>`, values are the JSON records the app builds
// (src/share/shared.ts). The app decides what goes in; this file only stores.
//
// Every block of the core is encrypted with `encryptionKey`. A device that
// copies the core without that key sees only random bytes. People you share
// with get the key when they pair (function 3).

const Corestore = require('corestore')
const Hyperbee = require('hyperbee')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')

const PREFIX = 'visit/'

class SharedStore {
  constructor() {
    this.store = null
    this.core = null
    this.bee = null
    this.dir = null
    this.coreName = null
    // Writes run one after another, in the order the app sent them.
    this.queue = Promise.resolve()
  }

  get isOpen() {
    return this.bee !== null
  }

  /**
   * Opens (or creates) the store in `dir`. With no `encryptionKey` a new one
   * is made; the app saves it and passes it in on every later open.
   */
  async open({ dir, coreName, encryptionKey }) {
    if (this.bee && this.dir === dir && this.coreName === coreName) return this.info()
    await this.close()

    const key = encryptionKey ? b4a.from(encryptionKey, 'hex') : crypto.randomBytes(32)
    if (key.byteLength !== 32) throw new Error('The sharing key must be 32 bytes.')

    const store = new Corestore(dir)
    try {
      const core = store.get({ name: coreName, encryption: { key } })
      const bee = new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'json' })
      await bee.ready()
      this.store = store
      this.core = core
      this.bee = bee
      this.dir = dir
      this.coreName = coreName
    } catch (error) {
      await store.close().catch(() => {})
      throw error
    }
    return { ...this.info(), encryptionKey: b4a.toString(key, 'hex') }
  }

  async close() {
    const store = this.store
    this.store = null
    this.core = null
    this.bee = null
    this.dir = null
    this.coreName = null
    if (store) await store.close()
  }

  info() {
    return {
      key: b4a.toString(this.core.key, 'hex'),
      discoveryKey: b4a.toString(this.core.discoveryKey, 'hex'),
      length: this.core.length,
      byteLength: this.core.byteLength
    }
  }

  _serial(task) {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => {})
    return run
  }

  _needOpen() {
    if (!this.bee) throw new Error('The shared visits store is not open.')
  }

  /** Stores the record, unless the stored one is already identical (no new block then). */
  put(id, record) {
    return this._serial(async () => {
      this._needOpen()
      const before = this.core.length
      await this.bee.put(PREFIX + id, record, {
        cas: (prev, next) => JSON.stringify(prev.value) !== JSON.stringify(next.value)
      })
      return { changed: this.core.length !== before }
    })
  }

  /** Removes the visit. Nothing is written when it was not there. */
  del(id) {
    return this._serial(async () => {
      this._needOpen()
      const existing = await this.bee.get(PREFIX + id)
      if (!existing) return { changed: false }
      await this.bee.del(PREFIX + id)
      return { changed: true }
    })
  }

  /** Every shared visit as stored (read back and decrypted). */
  list() {
    return this._serial(async () => {
      this._needOpen()
      const entries = []
      for await (const { key, value } of this.bee.createReadStream({ gt: PREFIX, lt: PREFIX + '\xff' })) {
        entries.push({ id: key.slice(PREFIX.length), record: value })
      }
      return entries
    })
  }

  /**
   * Checks that the blocks on disk are encrypted: reads the newest block both
   * without and with the key. Every Hyperbee block holds its key in plain
   * form (`visit/...`), so the decrypted one must contain it and the raw one
   * must not.
   */
  check() {
    return this._serial(async () => {
      this._needOpen()
      const length = this.core.length
      // Block 0 is the Hyperbee header; visit blocks start at 1.
      if (length < 2) return { ...this.info(), blocks: length, checked: false }
      const index = length - 1
      const raw = await this.core.get(index, { decrypt: false, valueEncoding: 'binary' })
      const plain = await this.core.get(index, { valueEncoding: 'binary' })
      return {
        ...this.info(),
        blocks: length,
        checked: true,
        rawLooksEncrypted: !b4a.includes(raw, PREFIX) && !b4a.equals(raw.subarray(raw.byteLength - plain.byteLength), plain),
        decryptedHasProbe: b4a.includes(plain, PREFIX),
        rawSample: b4a.toString(raw.subarray(0, 16), 'hex')
      }
    })
  }
}

module.exports = SharedStore
