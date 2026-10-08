import type { BackgroundId, CustomBackground, Settings } from './types'

export const ORIGINAL_IDS = ['original-deep-sea','original-forest-dawn','original-orbital-night'] as const
export type OriginalId = typeof ORIGINAL_IDS[number]
export const LIBRARY_LIMIT = 100
export interface WallpaperItem extends CustomBackground { id: string; addedAt: number }
export type ThemeAppearance = Pick<Settings, 'themeMode'|'themeColor'|'sceneTransition'|'ambientEffect'|'wallpaperMotion'|'backgroundFit'|'panelOpacity'|'panelBlur'|'wallpaperDim'|'clockStyle'|'clockScale'|'playerStyle'|'playerScale'|'timerPosition'|'wallpaperClock'|'clockPosition'|'playerPosition'|'particles'>
export interface SavedTheme {
  id: string; name: string; createdAt: number; appearance: ThemeAppearance
  wallpaper: {type:'builtin';id:OriginalId}|{type:'library';id:string}
}
export interface ThemeManifest {
  format: 'xinhai-theme'; version: 1; name: string; appearance: ThemeAppearance
  wallpaper: {type:'builtin';id:OriginalId}|{type:'embedded';file:string;name:string;kind:'image'|'video'}
}
export interface ThemeImportResult { manifest: ThemeManifest; wallpaper: CustomBackground|null; receipt: string|null }

function object(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('主题文件结构无效')
  return value as Record<string,unknown>
}
function keys(value:Record<string,unknown>,allowed:string[]){
  if(Object.keys(value).some(key=>!allowed.includes(key)))throw Error('主题文件含不支持的字段，未导入')
}
export function themeName(value:unknown):string {
  if(typeof value!=='string'||!value.trim()||[...value.trim()].length>40||/[\u0000-\u001f\u007f]/.test(value))throw Error('名称请输入 1～40 个字符')
  return value.trim()
}
function oneOf<T extends string>(value:unknown,allowed:readonly T[],label:string):T {
  if(typeof value!=='string'||!allowed.includes(value as T))throw Error('主题中的'+label+'无效')
  return value as T
}
function number(value:unknown,min:number,max:number,label:string):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error('主题中的'+label+'超出范围')
  return value
}
function boolean(value:unknown,label:string):boolean {if(typeof value!=='boolean')throw Error('主题中的'+label+'无效');return value}
function position(value:unknown):{x:number;y:number}|null {
  if(value===null)return null
  const row=object(value);keys(row,['x','y'])
  return {x:number(row.x,0,1,'控件横坐标'),y:number(row.y,0,1,'控件纵坐标')}
}
const APPEARANCE_KEYS=['themeMode','themeColor','sceneTransition','ambientEffect','wallpaperMotion','backgroundFit','panelOpacity','panelBlur','wallpaperDim','clockStyle','clockScale','playerStyle','playerScale','timerPosition','wallpaperClock','clockPosition','playerPosition','particles']
export function parseThemeAppearance(value:unknown):ThemeAppearance {
  const row=object(value);keys(row,APPEARANCE_KEYS)
  if(typeof row.themeColor!=='string'||!/^#[\da-f]{6}$/i.test(row.themeColor))throw Error('主题色必须为六位十六进制颜色')
  return {
    themeMode:oneOf(row.themeMode,['wallpaper','fixed'],'配色模式'),themeColor:row.themeColor.toLowerCase(),
    sceneTransition:oneOf(row.sceneTransition,['fade','arc','none'],'切换效果'),ambientEffect:oneOf(row.ambientEffect,['none','motes','stars'],'环境光点'),
    wallpaperMotion:boolean(row.wallpaperMotion,'壁纸动态'),backgroundFit:oneOf(row.backgroundFit,['cover','contain'],'背景显示方式'),
    panelOpacity:number(row.panelOpacity,0,.9,'面板不透明度'),panelBlur:number(row.panelBlur,0,20,'面板模糊'),wallpaperDim:number(row.wallpaperDim,0,.6,'壁纸暗化'),
    clockStyle:oneOf(row.clockStyle,['minimal','classic','hidden'],'时钟样式'),clockScale:number(row.clockScale,.5,1,'时钟大小'),
    playerStyle:oneOf(row.playerStyle,['card','bar'],'播放器样式'),playerScale:number(row.playerScale,.65,1.2,'播放器大小'),
    timerPosition:oneOf(row.timerPosition,['center','left','right','bottom'],'计时位置'),wallpaperClock:boolean(row.wallpaperClock,'壁纸计时'),
    clockPosition:position(row.clockPosition),playerPosition:position(row.playerPosition),particles:boolean(row.particles,'成长粒子')
  }
}
export function captureAppearance(settings:Settings):ThemeAppearance {
  return parseThemeAppearance(Object.fromEntries(APPEARANCE_KEYS.map(key=>[key,settings[key as keyof Settings]])))
}
export function parseThemeManifest(value:unknown):ThemeManifest {
  const row=object(value);keys(row,['format','version','name','appearance','wallpaper'])
  if(row.format!=='xinhai-theme'||row.version!==1)throw Error('不支持的主题格式或版本')
  const wallpaper=object(row.wallpaper)
  let background:ThemeManifest['wallpaper']
  if(wallpaper.type==='builtin'){
    keys(wallpaper,['type','id']);background={type:'builtin',id:oneOf(wallpaper.id,ORIGINAL_IDS,'内置壁纸')}
  }else if(wallpaper.type==='embedded'){
    keys(wallpaper,['type','file','name','kind'])
    const kind=oneOf(wallpaper.kind,['image','video'],'附件类型')
    if(typeof wallpaper.file!=='string'||!(kind==='video'?/^wallpaper\.(mp4|webm)$/:/^wallpaper\.(png|jpg|jpeg|webp)$/).test(wallpaper.file))throw Error('主题附件名称或类型无效')
    // Display names cannot become archive paths or native file destinations.
    if(typeof wallpaper.name!=='string'||!wallpaper.name.trim()||wallpaper.name.length>200||/[\u0000-\u001f]/.test(wallpaper.name))throw Error('壁纸名称无效')
    background={type:'embedded',file:wallpaper.file,name:wallpaper.name,kind}
  }else throw Error('主题壁纸描述无效')
  return {format:'xinhai-theme',version:1,name:themeName(row.name),appearance:parseThemeAppearance(row.appearance),wallpaper:background}
}

function sourceId(src:string):string {
  // Stable migration ID only, not a security hash. New files normally have UUID/hash names.
  let a=2166136261,b=5381
  for(const char of src){a=Math.imul(a^char.charCodeAt(0),16777619);b=Math.imul(b,33)^char.charCodeAt(0)}
  return 'wall-'+(a>>>0).toString(16)+'-'+(b>>>0).toString(16)
}
function wallpaperItem(value:unknown):WallpaperItem {
  const row=object(value)
  if(typeof row.src!=='string'||!row.src||row.src.length>8192||typeof row.poster!=='string')throw Error('壁纸地址无效')
  const id=typeof row.id==='string'&&/^[\w-]{1,120}$/.test(row.id)?row.id:sourceId(row.src)
  return {id,name:typeof row.name==='string'?row.name.slice(0,200):'本地壁纸',src:row.src,poster:row.poster,
    kind:oneOf(row.kind,['image','video'],'壁纸类型'),addedAt:typeof row.addedAt==='number'&&Number.isFinite(row.addedAt)?row.addedAt:0,
    ...(typeof row.themeColor==='string'&&/^#[\da-f]{6}$/i.test(row.themeColor)?{themeColor:row.themeColor.toLowerCase()}:{})}
}
export function normalizeThemeCollections(settings:Settings):Settings {
  const wallpaperLibrary:WallpaperItem[]=[],savedThemes:SavedTheme[]=[]
  for(const row of Array.isArray(settings.wallpaperLibrary)?settings.wallpaperLibrary.slice(0,LIBRARY_LIMIT):[]){
    try{const item=wallpaperItem(row);if(!wallpaperLibrary.some(other=>other.id===item.id||other.src===item.src))wallpaperLibrary.push(item)}catch{/* Keep invalid legacy rows out of the active UI. */}
  }
  let customBackground:CustomBackground|null=null
  if(settings.customBackground){try{
    const item=wallpaperItem(settings.customBackground)
    const existing=wallpaperLibrary.find(other=>other.src===item.src)
    if(existing&&item.themeColor)existing.themeColor=item.themeColor
    if(!existing&&wallpaperLibrary.length<LIBRARY_LIMIT)wallpaperLibrary.push(item)
    customBackground=existing?{...existing,...(item.themeColor?{themeColor:item.themeColor}:{})}:item
  }catch{/* Invalid legacy media falls back to built-in imagery. */}}
  for(const value of Array.isArray(settings.savedThemes)?settings.savedThemes.slice(0,LIBRARY_LIMIT):[]){try{
    const row=object(value),wallpaper=object(row.wallpaper)
    if(typeof row.id!=='string'||!/^[\w-]{1,120}$/.test(row.id)||savedThemes.some(other=>other.id===row.id))continue
    const background:SavedTheme['wallpaper']=wallpaper.type==='builtin'?{type:'builtin',id:oneOf(wallpaper.id,ORIGINAL_IDS,'内置壁纸')}:{type:'library',id:String(wallpaper.id)}
    if(background.type==='library'&&!wallpaperLibrary.some(item=>item.id===background.id))continue
    savedThemes.push({id:row.id,name:themeName(row.name),createdAt:typeof row.createdAt==='number'?row.createdAt:0,appearance:parseThemeAppearance(row.appearance),wallpaper:background})
  }catch{/* Corrupt entries do not execute or import arbitrary settings. */}}
  return {...settings,customBackground,wallpaperLibrary,savedThemes}
}
export function rememberWallpaper(settings:Settings,custom:CustomBackground):Partial<Settings> {
  const current=normalizeThemeCollections(settings),item=wallpaperItem({...custom,addedAt:Date.now()})
  const existing=current.wallpaperLibrary.find(row=>row.src===item.src)
  if(!existing&&current.wallpaperLibrary.length>=LIBRARY_LIMIT)throw Error('壁纸收藏已达到 100 张，请先移除不需要的收藏')
  const selected=existing||item
  return {wallpaperLibrary:existing?current.wallpaperLibrary:[...current.wallpaperLibrary,item],customBackground:selected,background:'custom'}
}
export function wallpaperById(settings:Settings,id:string):WallpaperItem {
  const item=settings.wallpaperLibrary.find(row=>row.id===id);if(!item)throw Error('壁纸已不存在，请刷新后重试');return item
}
export function savedThemeById(settings:Settings,id:string):SavedTheme {
  const item=settings.savedThemes.find(row=>row.id===id);if(!item)throw Error('主题已不存在，请刷新后重试');return item
}
export function captureTheme(settings:Settings,name:string,id:string):SavedTheme {
  const wallpaper:SavedTheme['wallpaper']=settings.background==='custom'&&settings.customBackground?.id?
    {type:'library',id:wallpaperById(settings,settings.customBackground.id).id}:
    {type:'builtin',id:oneOf(settings.background,ORIGINAL_IDS,'当前壁纸')}
  return {id,name:themeName(name),createdAt:Date.now(),appearance:captureAppearance(settings),wallpaper}
}
export function applyThemePatch(settings:Settings,theme:SavedTheme):Partial<Settings> {
  const media=theme.wallpaper.type==='library'?wallpaperById(settings,theme.wallpaper.id):null
  return {...parseThemeAppearance(theme.appearance),background:media?'custom':theme.wallpaper.id as BackgroundId,
    ...(media?{customBackground:media}:{}),pageBackgrounds:false,showCharacter:false,characterStyle:'hidden',voiceEnabled:false,focusAlloutEnabled:false}
}
