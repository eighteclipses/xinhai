import { cloudLibraryTracks } from '../lib/cloudLibrary'
import { bgm } from '../lib/bgm'
import { create } from 'zustand'
import type { ImportedTrack } from '../../../shared/musicLibrary'

export interface Track { file: string; title: string; tag: 'calm' | 'battle' | 'ambient' | 'local' | 'netease'; id?: string }
export type PlayMode = 'seq' | 'loop' | 'random'
interface MusicPrefs { mode?: PlayMode; volume?: number; file?: string; hiddenBuiltinFiles?: string[] }
interface MusicStore {
  allTracks: Track[]; tracks: Track[]; hiddenBuiltinTracks: Track[]; hiddenBuiltinFiles: string[]
  index: number; playing: boolean; mode: PlayMode; musicVolume: number; loadError: string
  load: (force?: boolean) => Promise<void>
  replaceImportedTracks: (tracks: ImportedTrack[]) => void
  setBuiltinHidden: (file: string, hidden: boolean) => void
  restoreAllBuiltins: () => void
  play: (i?: number) => void; pause: () => void; toggle: () => void; next: () => void; prev: () => void
  setMode: (m: PlayMode) => void; setMusicVolume: (v: number) => void
}
const preferenceKey = 'xinhai-music-prefs'
const builtin = (track: Track) => track.tag === 'calm' || track.tag === 'battle' || track.tag === 'ambient'
let prefs: MusicPrefs = {}
try {
  const value: unknown = JSON.parse(localStorage.getItem(preferenceKey) || '{}')
  if (value && typeof value === 'object' && !Array.isArray(value)) prefs = value as MusicPrefs
} catch {}
const initialHidden = Array.isArray(prefs.hiddenBuiltinFiles)
  ? [...new Set(prefs.hiddenBuiltinFiles.filter(file => typeof file === 'string' && file.length > 0 && file.length <= 1024))]
  : []
let builtinCache: Track[] = [], importedCache: ImportedTrack[] = [], cloudCache: Track[] = []
let importedRevision = 0
let loading: Promise<void> | null = null, queuedRefresh: Promise<void> | null = null

function musicPrefs(state: Pick<MusicStore, 'tracks' | 'index' | 'mode' | 'musicVolume' | 'hiddenBuiltinFiles'>): MusicPrefs {
  return { mode: state.mode, volume: state.musicVolume, file: state.tracks[state.index]?.file, hiddenBuiltinFiles: state.hiddenBuiltinFiles }
}
function writePrefs(value: MusicPrefs) {
  localStorage.setItem(preferenceKey, JSON.stringify(value))
  prefs = value
}
function importedTracks(value: unknown): ImportedTrack[] {
  if (!Array.isArray(value) || !value.every(track => track && typeof track.file === 'string' && typeof track.title === 'string' && track.tag === 'local' && typeof track.id === 'string')) {
    throw Error('音乐列表未完整读取，请重试。')
  }
  return value
}
function selection(allTracks: Track[], hiddenBuiltinFiles: string[], previous: MusicStore) {
  const hidden = new Set(hiddenBuiltinFiles)
  const tracks = allTracks.filter(track => !builtin(track) || !hidden.has(track.file))
  const hiddenBuiltinTracks = allTracks.filter(track => builtin(track) && hidden.has(track.file))
  const oldTrack = previous.tracks[previous.index]
  const previousFile = oldTrack?.file ?? prefs.file
  const selected = tracks.findIndex(track => track.file === previousFile)
  const first = tracks.findIndex(track => track.tag === 'calm')
  const lostCurrent = !!oldTrack && selected < 0
  return { allTracks, tracks, hiddenBuiltinTracks, hiddenBuiltinFiles, index: selected >= 0 ? selected : Math.max(0, first), playing: !!tracks.length && previous.playing && !lostCurrent, lostCurrent }
}
function stopRemovedCurrent(lostCurrent: boolean) {
  if (!lostCurrent) return
  bgm.pause()
  bgm.dispose()
}

export const useMusic = create<MusicStore>((set, get) => {
  const applySources = () => {
    const next = selection([...builtinCache, ...importedCache, ...cloudCache], get().hiddenBuiltinFiles, get())
    stopRemovedCurrent(next.lostCurrent)
    const { lostCurrent: _lostCurrent, ...state } = next
    set(state)
  }
  const updateHidden = (files: string[]) => {
    const next = selection(get().allTracks, files, get())
    // A failed durable write must leave both the visible list and playback alone.
    writePrefs(musicPrefs({ ...get(), ...next }))
    stopRemovedCurrent(next.lostCurrent)
    const { lostCurrent: _lostCurrent, ...state } = next
    set(state)
  }
  return {
    allTracks: [], tracks: [], hiddenBuiltinTracks: [], hiddenBuiltinFiles: initialHidden,
    index: 0, playing: false, mode: ['seq', 'loop', 'random'].includes(prefs.mode || '') ? prefs.mode! : 'seq',
    musicVolume: typeof prefs.volume === 'number' ? Math.max(0, Math.min(1, prefs.volume)) : .6, loadError: '',
    load: (force = false) => {
      if (loading) {
        if (!force) return queuedRefresh ?? loading
        // A mutation may finish after the current read captured its old rows.
        // Its forced refresh must run after that read, rather than sharing it.
        const refresh = () => {
          queuedRefresh = null
          return get().load(true)
        }
        if (!queuedRefresh) queuedRefresh = loading.then(refresh, refresh)
        return queuedRefresh
      }
      if (get().allTracks.length && !force) return Promise.resolve()
      const revision = importedRevision
      loading = (async () => {
        const [bundled, imported] = await Promise.allSettled([
          fetch('music/manifest.json').then(async response => {
            if (!response.ok) throw Error('manifest')
            const value: unknown = await response.json()
            if (!Array.isArray(value)) throw Error('manifest')
            return value.filter((track): track is Track => track && typeof track.file === 'string' && typeof track.title === 'string' && builtin(track))
          }),
          window.api.musicList ? window.api.musicList().then(importedTracks) : Promise.resolve([])
        ])
        if (bundled.status === 'fulfilled') builtinCache = bundled.value
        // Immediate mutation results take precedence over an older in-flight read.
        if (imported.status === 'fulfilled' && revision === importedRevision) importedCache = imported.value
        let cloudFailed = false
        try { cloudCache = cloudLibraryTracks() } catch { cloudFailed = true }
        applySources()
        set({ loadError: bundled.status === 'rejected' || imported.status === 'rejected' || cloudFailed ? '部分音乐暂未读到，已保留上次列表。可以重试读取。' : '' })
      })().finally(() => { loading = null })
      return loading
    },
    replaceImportedTracks: tracks => {
      const next = importedTracks(tracks)
      importedRevision++
      importedCache = next
      applySources()
    },
    setBuiltinHidden: (file, hidden) => {
      if (!get().allTracks.some(track => builtin(track) && track.file === file)) throw Error('这首内置音乐暂未读到，请重试读取。')
      const files = new Set(get().hiddenBuiltinFiles)
      if (hidden) files.add(file)
      else files.delete(file)
      updateHidden([...files])
    },
    restoreAllBuiltins: () => updateHidden([]),
    play: i => { if (get().tracks[i ?? get().index]) set({ index: i ?? get().index, playing: true }) },
    pause: () => set({ playing: false }),
    toggle: () => { if (get().tracks.length) set(state => ({ playing: !state.playing })) },
    next: () => {
      const state = get(), count = state.tracks.length
      if (!count) return
      const step = state.mode === 'random' && count > 1 ? 1 + Math.floor(Math.random() * (count - 1)) : 1
      set({ index: (state.index + step) % count, playing: true })
    },
    prev: () => { const state = get(); if (state.tracks.length) set({ index: (state.index - 1 + state.tracks.length) % state.tracks.length, playing: true }) },
    setMode: mode => set({ mode }), setMusicVolume: musicVolume => set({ musicVolume })
  }
})
useMusic.subscribe(state => { try { writePrefs(musicPrefs(state)) } catch {} })
