import { isMarchFifth } from '../../../shared/anniversary'

// The bundled Reload recording is キミの記憶 (Memories of You).
export const MARCH_MEMORY_TRACK_FILE = '2.26 Memories of You -Reload-.ogg'

/** One cue per year in this renderer session. Navigation and manual controls
 * must never keep pulling the listener back to the anniversary song. */
export function createMarchMusicCue(enabled: boolean) {
  const playedYears = new Set<number>()
  return (tracks: ReadonlyArray<{ file: string }>, date = new Date()): number => {
    if (!enabled || !isMarchFifth(date) || playedYears.has(date.getFullYear())) return -1
    const index = tracks.findIndex(track => track.file === MARCH_MEMORY_TRACK_FILE)
    if (index < 0) return -1
    playedYears.add(date.getFullYear())
    return index
  }
}
