import { sceneCatalog as scenes } from './sceneCatalog'
import type { BackgroundId } from './types'

// Keep these aliases for settings from older installs and imported backups.
export const legacySceneIds: Readonly<Record<string, BackgroundId>> = {
  'p3r-theme-1': 'makoto-blue',
  'p3r-theme-2': 'makoto-blue',
  'p3r-theme-3': 'makoto-blue',
  'p3r-theme-4': 'makoto-blue',
  'p3r-theme-5': 'makoto-blue',
  'p3r-theme-6': 'makoto-blue'
}
const available = new Set(scenes.filter(s => s.id !== 'journal' && s.id !== 'stats').map(s => s.id))

export function migratedSceneId(value: unknown, hasCustom = false): BackgroundId | null {
  if (typeof value !== 'string') return null
  if (value === 'custom') return hasCustom ? 'custom' : null
  const id = Object.prototype.hasOwnProperty.call(legacySceneIds, value) ? legacySceneIds[value] : value
  return available.has(id) ? id as BackgroundId : null
}
