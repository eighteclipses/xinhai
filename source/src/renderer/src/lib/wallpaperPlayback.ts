import { firstVideoFrameDeadline } from './videoFrameWait'

export const WALLPAPER_WATCH_MS = 2_000
export const WALLPAPER_EOF_RECOVERY_MS = 4_000
export const WALLPAPER_SOFT_RECOVERY_MS = 12_000
export const WALLPAPER_RELOAD_MS = 30_000
export const WALLPAPER_RELOAD_COOLDOWN_MS = 60_000
const MAX_RELOADS = 2
const MAX_PLAY_ATTEMPTS = 5
const EOF_POSITION_TOLERANCE = 0.001

type PlaybackOptions = {
  intro: boolean
  startTime?: number
  // Keep native lifecycle state when the intro element is replaced by its loop.
  activity?: { paused: boolean }
  onIntroEnded: () => void
  onPlaying: () => void
  onFailure: () => void
}

/** Recover a visible wallpaper without periodically reloading healthy video. */
export function watchWallpaperPlayback(video: HTMLVideoElement, options: PlaybackOptions) {
  const activity = options.activity ?? { paused: false }
  let disposed = false, failed = false, completed = false, active = false
  let retry: ReturnType<typeof setTimeout> | undefined
  let monitor: ReturnType<typeof setTimeout> | undefined
  let generation = 0, pendingPlay = false, playAttempts = 0
  let observedTime = video.currentTime, progressVersion = 0, sampledVersion = 0
  let lastProgressAt = performance.now(), healthySamples = 0, softRecovered = false
  let reloads = 0, lastReloadAt = -Infinity, endedPending = false
  let hasPlayed = false, eofRecovered = false
  let initialMetadata = true, pendingSeek: number | undefined
  const usable = () => !disposed && !failed && !completed
  const visible = () => usable() && active && !activity.paused && !document.hidden
  const clearRetry = () => { if (retry !== undefined) { clearTimeout(retry); retry = undefined } }
  const clearMonitor = () => { if (monitor !== undefined) { clearTimeout(monitor); monitor = undefined } }
  const frameDeadline = firstVideoFrameDeadline(video, () => fail())

  const suspend = () => {
    active = false
    generation++
    pendingPlay = false
    clearRetry()
    clearMonitor()
    frameDeadline.pause()
    if (!video.paused) video.pause()
  }
  const fail = () => {
    if (!usable()) return
    failed = true
    suspend()
    options.onFailure()
  }
  const finishIntro = () => {
    if (!usable() || !options.intro) return
    completed = true
    suspend()
    // An ended event can arrive after the app was hidden. Advance the source
    // once, but leave playback of the new loop to its own visibility check.
    options.onIntroEnded()
  }
  const observeProgress = () => {
    if (pendingSeek !== undefined) { observedTime = video.currentTime; return }
    const position = video.currentTime
    // Small forward steps at the final frame still count as progress. A broad
    // 10ms threshold could otherwise mistake slow tail playback for silent EOF.
    if (!Number.isFinite(position) || Math.abs(position - observedTime) < 0.000001) return
    observedTime = position
    if (!video.paused && video.readyState >= 2 && video.videoWidth > 0) hasPlayed = true
    eofRecovered = false
    progressVersion++
    lastProgressAt = performance.now()
    softRecovered = false
    playAttempts = 0
    clearRetry()
  }
  const schedulePlay = (delay = 350) => {
    if (!visible() || retry !== undefined || playAttempts >= MAX_PLAY_ATTEMPTS) return
    retry = setTimeout(() => { retry = undefined; play() }, delay)
  }
  const play = (force = false) => {
    if (!visible() || pendingPlay || playAttempts >= MAX_PLAY_ATTEMPTS) return
    if (video.ended || endedPending) {
      if (options.intro) { finishIntro(); return }
      endedPending = false
      try { video.currentTime = 0; observedTime = video.currentTime }
      catch { playAttempts++; endedPending = true; schedulePlay(); return }
      force = true
    }
    if (!force && !video.paused) return
    const token = generation
    pendingPlay = true
    playAttempts++
    const settled = (rejected: boolean) => {
      // A play promise can settle after onPause or source disposal.
      if (!visible()) { if (!video.paused) video.pause(); return }
      if (token !== generation) return
      pendingPlay = false
      if (rejected || video.paused) schedulePlay(Math.min(700 * 2 ** (playAttempts - 1), 6_000))
    }
    try { void video.play().then(() => settled(false), () => settled(true)) }
    catch { settled(true) }
  }
  const metadata = () => {
    if (!usable()) return
    const target = pendingSeek ?? (initialMetadata ? options.startTime : undefined)
    initialMetadata = false
    if (target === undefined || video.readyState < 1) return
    pendingSeek = target
    try {
      const duration = video.duration
      video.currentTime = Number.isFinite(duration) && duration > 0 ? Math.min(target, Math.max(0, duration - 0.01)) : target
      observedTime = video.currentTime
      pendingSeek = undefined
    } catch { /* Some WebViews expose metadata before seeking is available. */ }
  }
  const reload = () => {
    // Re-open only after prolonged lack of progress. Preserve intro position,
    // so decoder recovery cannot replay the introduction from its beginning.
    pendingSeek = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : Math.max(0, observedTime)
    generation++
    pendingPlay = false
    playAttempts = 0
    clearRetry()
    reloads++
    lastReloadAt = lastProgressAt = performance.now()
    healthySamples = 0
    softRecovered = false
    try { video.load(); play() }
    catch { fail() }
  }
  const watch = () => {
    monitor = undefined
    if (!visible()) { syncActivity(); return }
    if (video.ended && options.intro) { finishIntro(); return }
    observeProgress()
    if (progressVersion !== sampledVersion) {
      sampledVersion = progressVersion
      // A lone decoded frame after reload is not evidence of sustained recovery.
      if (++healthySamples >= 3) reloads = 0
    } else healthySamples = 0
    const stalledFor = performance.now() - lastProgressAt
    const remaining = video.duration - video.currentTime
    if (hasPlayed && !video.ended && !endedPending && !eofRecovered && pendingSeek === undefined && !video.seeking &&
        Number.isFinite(video.duration) && video.duration > 0 && Number.isFinite(remaining) &&
        Math.abs(remaining) <= EOF_POSITION_TOLERANCE && stalledFor >= WALLPAPER_EOF_RECOVERY_MS) {
      // Some WebViews reach duration without setting ended or performing loop.
      // Only treat a stationary, exact tail as EOF; approaching the final frame
      // is not a reason to shorten a healthy clip or to reload its decoder.
      eofRecovered = true
      if (options.intro) { finishIntro(); return }
      generation++
      pendingPlay = false
      playAttempts = 0
      clearRetry()
      endedPending = true
      play(true)
      if (visible()) monitor = setTimeout(watch, WALLPAPER_WATCH_MS)
      return
    }
    if (video.ended || endedPending || video.paused) schedulePlay()
    if (stalledFor >= WALLPAPER_SOFT_RECOVERY_MS && !softRecovered) {
      softRecovered = true
      // A decoder can freeze while paused is false. A bounded pause/play kick
      // restarts that pipeline; waiting/stalled events alone do not reload it.
      if (!video.paused) video.pause()
      clearRetry()
      play(true)
    }
    if (stalledFor >= WALLPAPER_RELOAD_MS) {
      if (reloads >= MAX_RELOADS) { fail(); return }
      if (performance.now() - lastReloadAt >= WALLPAPER_RELOAD_COOLDOWN_MS) reload()
    }
    if (visible()) monitor = setTimeout(watch, WALLPAPER_WATCH_MS)
  }
  const syncActivity = () => {
    if (!usable()) return
    if (video.ended && options.intro) { finishIntro(); return }
    if (document.hidden || activity.paused) { suspend(); return }
    if (!active) {
      active = true
      observedTime = video.currentTime
      sampledVersion = progressVersion
      lastProgressAt = performance.now()
      healthySamples = 0
      softRecovered = false
      eofRecovered = false
      playAttempts = 0
      frameDeadline.resume()
      monitor = setTimeout(watch, WALLPAPER_WATCH_MS)
    }
    play()
  }
  const nativePause = () => { activity.paused = true; syncActivity() }
  const nativeResume = () => { activity.paused = false; syncActivity() }
  const recover = () => { if (visible() && (video.paused || video.ended)) schedulePlay() }
  const ended = () => {
    if (!usable()) return
    if (options.intro) finishIntro()
    else { endedPending = true; schedulePlay() }
  }
  const playing = () => {
    if (!visible()) { if (!video.paused) video.pause(); return }
    hasPlayed = true
    frameDeadline.resume()
    options.onPlaying()
  }
  const timeupdate = () => { if (visible()) observeProgress() }
  const events: [string, EventListener][] = [
    ['pause', recover], ['waiting', recover], ['stalled', recover],
    ['ended', ended], ['playing', playing], ['timeupdate', timeupdate],
    ['loadedmetadata', metadata], ['canplay', metadata], ['error', fail]
  ]
  for (const [name, handler] of events) video.addEventListener(name, handler)
  document.addEventListener('visibilitychange', syncActivity)
  window.addEventListener('xinhai-pause', nativePause)
  window.addEventListener('xinhai-resume', nativeResume)
  if (video.error) fail()
  else { if (video.readyState >= 1) metadata(); syncActivity() }

  return () => {
    if (disposed) return
    disposed = true
    suspend()
    frameDeadline.dispose()
    for (const [name, handler] of events) video.removeEventListener(name, handler)
    document.removeEventListener('visibilitychange', syncActivity)
    window.removeEventListener('xinhai-pause', nativePause)
    window.removeEventListener('xinhai-resume', nativeResume)
  }
}
