const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { build } = require('esbuild')
const root = path.resolve(__dirname, '..'), output = fs.mkdtempSync(path.join(require('node:os').tmpdir(),'xinhai-music-store-035-'))
const data = new Map(), audio = [], checks = []
let writeFails = false, manifestFails = false, importsFail = false, invalidImports = false, cloudFails = false
let imported = [{ file: 'file:///synthetic/local-one.mp3', title: 'Imported one', tag: 'local', id: 'local-one' }]
const bundled = [{ file: 'first.ogg', title: 'First', tag: 'calm' }, { file: 'second.ogg', title: 'Second', tag: 'calm' }, { file: 'third.ogg', title: 'Third', tag: 'battle' }]
data.set('xinhai-music-prefs', JSON.stringify({ mode: 'loop', volume: .37, file: 'second.ogg', hiddenBuiltinFiles: ['second.ogg'] }))
global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { if (writeFails) throw Error('synthetic storage failure'); data.set(key, value) }, removeItem: key => data.delete(key) }
let fetches = 0, deferred = null
global.fetch = async () => {
  fetches++
  if (manifestFails) throw Error('synthetic manifest failure')
  if (deferred) { const current = deferred; deferred = null; return current.promise }
  return { ok: true, json: async () => bundled }
}
global.window = { api: { musicList: async () => { if (importsFail) throw Error('synthetic import-list failure'); return invalidImports ? null : imported.map(track => ({ ...track })) } } }
global.__musicAudio = audio
global.__musicCloud = () => { if (cloudFails) throw Error('synthetic cloud failure'); return [] }
const pass = text => { checks.push(text); console.log('PASS ' + text) }

async function main() {
  const compiled = path.join(output, 'music-store.cjs')
  await build({ entryPoints: [path.join(root, 'src/renderer/src/store/music.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: compiled, plugins: [{ name: 'synthetic-audio-cloud', setup(builder) {
    builder.onResolve({ filter: /\/lib\/(bgm|cloudLibrary)$/ }, args => ({ path: args.path.endsWith('/bgm') ? 'audio' : 'cloud', namespace: 'synthetic' }))
    builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, args => ({ contents: args.path === 'audio' ? "export const bgm={pause(){globalThis.__musicAudio.push('pause')},dispose(){globalThis.__musicAudio.push('dispose')}}" : 'export const cloudLibraryTracks=()=>globalThis.__musicCloud()', loader: 'js' }))
  } }] })
  const { useMusic } = require(compiled), state = () => useMusic.getState()
  await state().load()
  assert.equal(state().allTracks.length, 4)
  assert.deepEqual(state().hiddenBuiltinTracks.map(track => track.file), ['second.ogg'])
  assert.equal(state().tracks[state().index].file, 'first.ogg')
  assert.equal(state().mode, 'loop'); assert.equal(state().musicVolume, .37)
  pass('saved hidden builtins stay out of the visible queue and saved selection; mode and volume remain unchanged')

  state().play(0); audio.length = 0
  state().setBuiltinHidden('first.ogg', true)
  assert.deepEqual(audio, ['pause', 'dispose'])
  assert.equal(state().playing, false)
  assert(!state().tracks.some(track => track.file === 'first.ogg'))
  assert(JSON.parse(data.get('xinhai-music-prefs')).hiddenBuiltinFiles.includes('first.ogg'))
  pass('hiding the current builtin durably saves the choice, releases audio and pauses the queue')

  state().play(0); const before = state(), eventsBefore = audio.length, savedBefore = data.get('xinhai-music-prefs')
  writeFails = true
  assert.throws(() => state().setBuiltinHidden('third.ogg', true), /storage failure/)
  assert.equal(state(), before); assert.equal(audio.length, eventsBefore); assert.equal(data.get('xinhai-music-prefs'), savedBefore)
  writeFails = false
  pass('a failed hidden-preference write changes neither list nor playback nor the previous stored choice')

  const currentFile = state().tracks[state().index].file
  state().restoreAllBuiltins()
  assert.equal(state().hiddenBuiltinTracks.length, 0)
  assert.equal(state().tracks[state().index].file, currentFile)
  assert.equal(state().playing, true); assert.equal(audio.length, eventsBefore)
  pass('restore-all preserves the current song and playing state without touching audio')

  state().play(state().tracks.findIndex(track => track.tag === 'local')); audio.length = 0
  state().replaceImportedTracks([])
  assert.deepEqual(audio, ['pause', 'dispose']); assert.equal(state().playing, false)
  assert(state().tracks.every(track => track.tag !== 'local'))
  state().replaceImportedTracks(imported); state().play(0); audio.length = 0
  state().replaceImportedTracks([])
  assert.equal(state().playing, true); assert.equal(state().tracks[state().index].file, 'first.ogg'); assert.equal(audio.length, 0)
  pass('removing the current import releases it; removing another import leaves current playback untouched')

  state().replaceImportedTracks(imported)
  const previousFiles = state().allTracks.map(track => track.file)
  manifestFails = importsFail = cloudFails = true
  await state().load(true)
  assert.deepEqual(state().allTracks.map(track => track.file), previousFiles); assert(state().loadError)
  manifestFails = importsFail = cloudFails = false
  invalidImports = true; await state().load(true); assert.deepEqual(state().allTracks.map(track => track.file), previousFiles)
  invalidImports = false
  pass('failed or malformed source reads preserve the last successful rows instead of treating errors as deletions')

  let resolveManifest
  deferred = { promise: new Promise(resolve => { resolveManifest = resolve }) }
  const startFetches = fetches, oldRead = state().load(true)
  await Promise.resolve()
  imported = [{ file: 'file:///synthetic/new-import.mp3', title: 'New import', tag: 'local', id: 'new-import' }]
  state().replaceImportedTracks(imported)
  const seenOldRows = []
  const unsubscribe = useMusic.subscribe(value => { if (value.tracks.some(track => track.id === 'local-one')) seenOldRows.push(true) })
  const refresh = state().load(true), sameRefresh = state().load(true)
  assert.equal(refresh, sameRefresh)
  resolveManifest({ ok: true, json: async () => bundled })
  await Promise.all([oldRead, refresh])
  unsubscribe()
  assert.equal(fetches, startFetches + 2)
  assert.equal(seenOldRows.length, 0)
  assert(state().tracks.some(track => track.id === 'new-import'))
  assert(!state().tracks.some(track => track.id === 'local-one'))
  pass('forced refresh queues behind an in-flight read; immediate mutation rows cannot be overwritten by that stale read')

  for (const track of bundled) state().setBuiltinHidden(track.file, true)
  state().replaceImportedTracks([])
  assert.equal(state().tracks.length, 0); assert.equal(state().playing, false)
  state().toggle(); state().next(); state().prev(); assert.equal(state().playing, false)
  state().restoreAllBuiltins(); assert.equal(state().tracks.length, bundled.length)
  pass('an empty visible queue stays paused and can restore all builtin songs without losing its source rows')

  const report = { ok: true, checks, scope: 'source store with synthetic storage, source responses and audio hooks; no real profile, media file mutation or device playback', output }
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ ok: true, checks: checks.length, result: path.join(output, 'result.json') }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
