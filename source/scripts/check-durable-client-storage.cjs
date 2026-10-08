const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const esbuild = require('esbuild')

const root = path.resolve(__dirname, '..')

function loadBundle(entry) {
  const result = esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    write: false,
    logLevel: 'silent'
  })
  const loaded = new Module(entry, module)
  loaded.filename = entry
  loaded.paths = Module._nodeModulePaths(path.dirname(entry))
  loaded._compile(result.outputFiles[0].text, entry)
  return loaded.exports
}

function makeStorageClass() {
  return class FakeStorage {
    constructor() { this.values = new Map() }
    get length() { return this.values.size }
    key(index) { return Array.from(this.values.keys())[index] ?? null }
    getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null }
    setItem(key, value) { this.values.set(String(key), String(value)) }
    removeItem(key) { this.values.delete(String(key)) }
    clear() { this.values.clear() }
  }
}

function makeBackend(seed = {}, initialized = false) {
  const rows = new Map(Object.entries(seed))
  const calls = []
  const state = { initialized, failSet: null, failRemove: null, failClear: false }
  const backend = {
    calls,
    rows,
    state,
    initialize(browserState) {
      calls.push(['initialize', { ...browserState }])
      if (!state.initialized) {
        for (const [key, value] of Object.entries(browserState)) rows.set(key, value)
        state.initialized = true
      }
      return Object.fromEntries(rows)
    },
    set(key, value) {
      calls.push(['set', key, value])
      if (state.failSet === key) throw Error('injected native set failure')
      rows.set(key, value)
    },
    remove(key) {
      calls.push(['remove', key])
      if (state.failRemove === key) throw Error('injected native remove failure')
      rows.delete(key)
    },
    clear() {
      calls.push(['clear'])
      if (state.failClear) throw Error('injected native clear failure')
      rows.clear()
    }
  }
  return backend
}

function freshInstall(durable, state = {}, seed = {}, initialized = false) {
  const FakeStorage = makeStorageClass()
  const local = new FakeStorage()
  for (const [key, value] of Object.entries(state)) local.setItem(key, value)
  const backend = makeBackend(seed, initialized)
  durable.installDurableClientStorage(local, backend)
  return { FakeStorage, local, backend }
}

function setPending(windowObject, pending, onAck) {
  windowObject.api = {
    backupClientRestore: async () => pending,
    backupAcknowledgeRestore: async token => { onAck(token) },
    saveFile: async () => false
  }
}

async function main() {
  const durable = loadBundle(path.join(root, 'src/mobile/durableClientStorage.ts'))

  // First boot migrates exact raw text once. On later boot the native copy wins.
  const rawDraft = '{not parsed or normalized}\u0000 trailing spaces  '
  const first = freshInstall(durable, {
    'xinhai-journal-draft-v1': rawDraft,
    'unrelated-setting': 'preserve'
  })
  assert.equal(first.backend.rows.get('xinhai-journal-draft-v1'), rawDraft)
  assert.equal(first.local.getItem('xinhai-journal-draft-v1'), rawDraft)
  assert.equal(first.local.getItem('unrelated-setting'), 'preserve')
  const initializeCount = first.backend.calls.filter(call => call[0] === 'initialize').length
  durable.installDurableClientStorage(first.local, first.backend)
  assert.equal(first.backend.calls.filter(call => call[0] === 'initialize').length, initializeCount, 'duplicate installation must not reinitialize')

  const FailedStorage = makeStorageClass()
  const failedLocal = new FailedStorage()
  failedLocal.setItem('xinhai-journal-draft-v1', 'keep after failed initialization')
  const originalSetter = FailedStorage.prototype.setItem
  const failedBackend = makeBackend()
  failedBackend.initialize = () => { throw Error('injected native initialization failure') }
  assert.throws(() => durable.installDurableClientStorage(failedLocal, failedBackend), /injected native initialization failure/)
  assert.equal(FailedStorage.prototype.setItem, originalSetter, 'initialization failure must not be hidden by installing the shim')
  assert.equal(failedLocal.getItem('xinhai-journal-draft-v1'), 'keep after failed initialization')

  const stale = new first.FakeStorage()
  stale.setItem('xinhai-journal-draft-v1', 'stale WebView copy')
  stale.setItem('unrelated-setting', 'keep this copy')
  durable.installDurableClientStorage(stale, first.backend)
  assert.equal(stale.getItem('xinhai-journal-draft-v1'), rawDraft, 'native state must replace stale WebView state')
  assert.equal(stale.getItem('unrelated-setting'), 'keep this copy', 'hydration must preserve unrelated browser keys')

  // A write is acknowledged only after the native operation succeeds.
  const prefsKey = 'xinhai-music-prefs'
  stale.setItem(prefsKey, 'before')
  assert.equal(first.backend.rows.get(prefsKey), 'before')
  first.backend.state.failSet = prefsKey
  assert.throws(() => stale.setItem(prefsKey, 'after'), /injected native set failure/)
  assert.equal(stale.getItem(prefsKey), 'before', 'failed native update must roll back the browser value')
  assert.equal(first.backend.rows.get(prefsKey), 'before')
  first.backend.state.failSet = null
  stale.setItem(prefsKey, 'after')
  assert.equal(first.backend.rows.get(prefsKey), 'after')
  let keyConversions = 0
  const objectKey = { toString() { keyConversions++; return 'xinhai-music-resume' } }
  const callsBeforeObjectKey = first.backend.calls.length
  stale.setItem(objectKey, '{"file":"fixture","seconds":0,"playing":false}')
  assert.equal(keyConversions, 1, 'a Web Storage key object must be coerced once')
  assert.equal(first.backend.rows.get('xinhai-music-resume'), '{"file":"fixture","seconds":0,"playing":false}')
  assert.equal(first.backend.calls.length, callsBeforeObjectKey + 1, 'a coerced allowlisted key must be durable')
  let removeKeyConversions = 0
  stale.removeItem({ toString() { removeKeyConversions++; return 'xinhai-music-resume' } })
  assert.equal(removeKeyConversions, 1, 'removeItem must normalize an object key once')
  assert.equal(first.backend.rows.has('xinhai-music-resume'), false)
  assert.throws(() => stale.setItem(Symbol('storage-key'), 'invalid'), TypeError, 'Symbol keys must keep Web Storage conversion failure')
  assert.throws(() => stale.setItem(), TypeError, 'missing setItem arguments must still fail')
  assert.throws(() => stale.removeItem(), TypeError, 'missing removeItem key must still fail')

  first.backend.state.failRemove = prefsKey
  assert.throws(() => stale.removeItem(prefsKey), /injected native remove failure/)
  assert.equal(stale.getItem(prefsKey), 'after', 'failed native remove must restore the browser value')
  assert.equal(first.backend.rows.get(prefsKey), 'after')
  first.backend.state.failRemove = null
  stale.removeItem(prefsKey)
  assert.equal(first.backend.rows.has(prefsKey), false)

  // Only the registered localStorage object is durable; sessionStorage and unknown keys retain native Storage behavior.
  const callsBeforeBypass = first.backend.calls.length
  stale.setItem('unapproved-key', 'browser only')
  let unknownKeyConversions = 0
  stale.setItem({ toString() { unknownKeyConversions++; return 'another-unapproved-key' } }, 'browser only')
  const session = new first.FakeStorage()
  session.setItem('xinhai-music-resume', 'session only')
  assert.equal(stale.getItem('unapproved-key'), 'browser only')
  assert.equal(stale.getItem('another-unapproved-key'), 'browser only')
  assert.equal(unknownKeyConversions, 1)
  assert.equal(session.getItem('xinhai-music-resume'), 'session only')
  assert.equal(first.backend.calls.length, callsBeforeBypass, 'unknown/session keys must not call the native backend')

  // clear() clears browser storage as usual and the allowlisted native rows. A later old copy cannot resurrect them.
  stale.setItem('xinhai-note:C:/fixture/note.md', '{"content":"native note","revision":"r1"}')
  stale.setItem('unrelated-setting', 'will be cleared')
  stale.clear()
  assert.equal(stale.length, 0)
  assert.equal(first.backend.rows.size, 0)
  const oldCopy = new first.FakeStorage()
  oldCopy.setItem('xinhai-journal-draft-v1', rawDraft)
  durable.installDurableClientStorage(oldCopy, first.backend)
  assert.equal(oldCopy.getItem('xinhai-journal-draft-v1'), null, 'clear must remain authoritative after restart')

  const clearCase = freshInstall(durable, {
    'xinhai-review-draft-v1': 'raw review draft',
    unrelated: 'unrelated'
  })
  clearCase.backend.state.failClear = true
  assert.throws(() => clearCase.local.clear(), /injected native clear failure/)
  assert.equal(clearCase.local.getItem('xinhai-review-draft-v1'), 'raw review draft', 'failed durable clear must restore all browser data')
  assert.equal(clearCase.local.getItem('unrelated'), 'unrelated')
  assert.equal(clearCase.backend.rows.get('xinhai-review-draft-v1'), 'raw review draft')

  // Exercise the real replay helper: remove-phase and set-phase failures must leave its SQLite queue unacknowledged.
  const replayModule = loadBundle(path.join(root, 'src/renderer/src/lib/backupClientState.ts'))
  const noteKey = 'xinhai-note:C:/fixture/restore.md'
  const noteValue = JSON.stringify({ content: 'restored note', revision: 'r2' })
  const oldNote = JSON.stringify({ content: 'old note', revision: 'r1' })
  const savedLocal = global.localStorage
  const savedWindow = global.window
  try {
    let ackCount = 0
    const removeCase = freshInstall(durable, { [noteKey]: oldNote })
    global.localStorage = removeCase.local
    global.window = {}
    setPending(global.window, { token: 'remove-fail', state: { [noteKey]: noteValue } }, () => ackCount++)
    removeCase.backend.state.failRemove = noteKey
    await assert.rejects(replayModule.replayBackupClientState(), /injected native remove failure/)
    assert.equal(ackCount, 0, 'remove-phase failure must not acknowledge backup restore')
    assert.equal(removeCase.local.getItem(noteKey), oldNote, 'remove-phase failure must restore the current browser value')

    ackCount = 0
    const setCase = freshInstall(durable)
    global.localStorage = setCase.local
    setPending(global.window, { token: 'set-fail', state: { [noteKey]: noteValue } }, () => ackCount++)
    setCase.backend.state.failSet = noteKey
    await assert.rejects(replayModule.replayBackupClientState(), /injected native set failure/)
    assert.equal(ackCount, 0, 'set-phase failure must not acknowledge backup restore')
    assert.equal(setCase.local.getItem(noteKey), null, 'set-phase failure must roll back its browser write')
  } finally {
    if (savedLocal === undefined) delete global.localStorage
    else global.localStorage = savedLocal
    if (savedWindow === undefined) delete global.window
    else global.window = savedWindow
  }

  console.log('PASS durable client storage: one-time migration, native authority, write rollback, tombstones, clear rollback, target scoping, and backup replay acknowledgment')
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
