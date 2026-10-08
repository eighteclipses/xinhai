import { sceneCatalog as scenes } from './sceneCatalog'
import type { Settings } from './types'

export const DEFAULT_THEME_COLOR = '#21bce7'
export function effectiveThemeColor(settings: Pick<Settings,'themeMode'|'themeColor'|'background'|'customBackground'>):string {
  if(settings.themeMode==='fixed')return normalizeThemeColor(settings.themeColor)??DEFAULT_THEME_COLOR
  if(settings.background==='custom')return normalizeThemeColor(settings.customBackground?.themeColor)??normalizeThemeColor(settings.themeColor)??DEFAULT_THEME_COLOR
  return scenes.find(scene=>scene.id===settings.background)?.themeColor??DEFAULT_THEME_COLOR
}
export function normalizeThemeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const color = value.trim().toLowerCase()
  if (/^#[\da-f]{6}$/.test(color)) return color
  if (/^#[\da-f]{3}$/.test(color)) return '#' + [...color.slice(1)].map(c => c + c).join('')
  return null
}

// Preserve the previous accent as the initial fixed-colour choice.
// Wallpaper mode resolves its own accent without changing this saved choice.
export function migratedThemeColor(settings: { themeColor?: unknown; background?: string }): string {
  const legacyColors:Record<string,string>={'masq-aigis-red':'#ed153b','rain-aigis':'#e6b751','rain-yukari':'#d580a2'}
  return normalizeThemeColor(settings.themeColor)
    ?? (settings.background&&Object.prototype.hasOwnProperty.call(legacyColors,settings.background) ? legacyColors[settings.background] : undefined)
    ?? scenes.find(scene => scene.id === settings.background)?.themeColor
    ?? DEFAULT_THEME_COLOR
}
