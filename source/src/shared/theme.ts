import { sceneCatalog as scenes } from './sceneCatalog'
import legacyScenes from './scenes.json'
import { originalThemes } from './originalThemes'
import type { Settings } from './types'

export const DEFAULT_THEME_COLOR = '#21bce7'
export function effectiveThemeColor(settings: Pick<Settings,'themeMode'|'themeColor'|'background'|'customBackground'> & Partial<Pick<Settings,'wallpaperThemeColors'>>):string {
  if(settings.themeMode==='fixed')return normalizeThemeColor(settings.themeColor)??DEFAULT_THEME_COLOR
  if(settings.background==='custom')return normalizeThemeColor(settings.customBackground?.themeColor)??normalizeThemeColor(settings.themeColor)??DEFAULT_THEME_COLOR
  return normalizeThemeColor(settings.wallpaperThemeColors?.[settings.background])??scenes.find(scene=>scene.id===settings.background)?.themeColor??DEFAULT_THEME_COLOR
}
export function normalizeThemeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const color = value.trim().toLowerCase()
  if (/^#[\da-f]{6}$/.test(color)) return color
  if (/^#[\da-f]{3}$/.test(color)) return '#' + [...color.slice(1)].map(c => c + c).join('')
  return null
}

// Use both catalogs so cross-edition backups retain all known builtin choices.
const wallpaperIds = new Set([...legacyScenes, ...originalThemes].map(scene=>scene.id))
export function parseWallpaperThemeColors(value:unknown):Record<string,string> {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('壁纸配色设置无效')
  const result:Record<string,string>={}
  for(const [id,color] of Object.entries(value)){
    if(!wallpaperIds.has(id)||typeof color!=='string'||!/^#[\da-f]{6}$/i.test(color))throw Error('壁纸配色含无效壁纸或颜色')
    result[id]=color.toLowerCase()
  }
  return result
}
export function normalizeWallpaperThemeColors(value:unknown):Record<string,string> {
  if(!value||typeof value!=='object'||Array.isArray(value))return {}
  return Object.fromEntries(Object.entries(value).filter(([id,color])=>wallpaperIds.has(id)&&typeof color==='string'&&/^#[\da-f]{6}$/i.test(color)).map(([id,color])=>[id,(color as string).toLowerCase()]))
}
export function wallpaperColorTarget(settings:Pick<Settings,'background'|'customBackground'>):string {
  return settings.background==='custom'?JSON.stringify(['custom',settings.customBackground?.id??'',settings.customBackground?.src??'']):settings.background
}
/** A stale palette cannot recolor a subsequently selected wallpaper. */
export function wallpaperColorPatch(settings:Settings,target:string,value:string|null):Partial<Settings> {
  if(wallpaperColorTarget(settings)!==target)throw Error('壁纸已切换，请重新提取颜色。')
  const color=value===null?null:normalizeThemeColor(value)
  if(value!==null&&!color)throw Error('壁纸颜色无效')
  if(settings.background==='custom'){
    const custom=settings.customBackground
    if(!custom)throw Error('请先选择一张壁纸')
    const recolor=<T extends {themeColor?:string}>(item:T):T=>{const next={...item};if(color)next.themeColor=color;else delete next.themeColor;return next}
    return {themeMode:'wallpaper',customBackground:recolor(custom),wallpaperLibrary:settings.wallpaperLibrary.map(item=>
      (custom.id&&item.id===custom.id)||item.src===custom.src?recolor(item):item)}
  }
  if(!wallpaperIds.has(settings.background))throw Error('当前壁纸不支持保存配色')
  const colors=normalizeWallpaperThemeColors(settings.wallpaperThemeColors)
  if(color)colors[settings.background]=color;else delete colors[settings.background]
  return {themeMode:'wallpaper',wallpaperThemeColors:colors}
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
