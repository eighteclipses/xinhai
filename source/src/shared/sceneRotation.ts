import {migratedSceneId} from './sceneMigration'
import {DEFAULT_SCENE_ID,FALLBACK_POSTER} from './sceneCatalog'
import {COMMERCIAL_EDITION} from './edition'
import {normalizeThemeCollections} from './themeLibrary'
import {characterArtById} from './characterArt'
import type {BackgroundId,Settings} from './types'

// Return the next future deadline, or zero when the interval is not due.
export function rotationDue(now:number,deadline:number,interval:number):number{
 if(now<deadline)return 0
 return deadline+(Math.floor((now-deadline)/interval)+1)*interval
}
export function rotationScenes(value:unknown,hasCustom=false):BackgroundId[]{
 return Array.isArray(value)?[...new Set(value.map(id=>migratedSceneId(id,hasCustom)).filter((id):id is BackgroundId=>id!==null))]:[]
}
export function normalizeSceneSettings(settings:Settings):Settings{
 settings=normalizeThemeCollections(settings)
 const hasCustom=!!settings.customBackground
 const next={...settings,background:migratedSceneId(settings.background,hasCustom)??DEFAULT_SCENE_ID,autoSceneIds:rotationScenes(settings.autoSceneIds,hasCustom)} as Settings
 next.sceneTransition=['fade','arc','none'].includes(next.sceneTransition)?next.sceneTransition:'fade'
 next.ambientEffect=['none','motes','stars'].includes(next.ambientEffect)?next.ambientEffect:'none'
 next.wallpaperMotion=next.wallpaperMotion===true
 next.characterArtId=characterArtById(next.characterArtId)?.id??''
 next.characterStyle=['auto','seated','uniform','battle','gallery','hidden'].includes(next.characterStyle)?next.characterStyle:'auto'
 if(next.characterStyle==='gallery'&&!next.characterArtId)next.characterStyle='auto'
 if(COMMERCIAL_EDITION){
  next.showCharacter=false;next.characterStyle='hidden';next.characterArtId='';next.voiceEnabled=false;next.focusAlloutEnabled=false;next.pageBackgrounds=false
  if(next.clockStyle==='p3r')next.clockStyle='minimal'
  if(next.playerStyle==='mp3')next.playerStyle='card'
  if(next.customBackground?.kind==='video'&&!/^(file:|https:\/\/app\.xinhai\.local\/local\/)/.test(next.customBackground.poster))next.customBackground={...next.customBackground,poster:FALLBACK_POSTER}
 }
 return next
}
export function rotationSeconds(value:unknown):number{
 const number=Number(value)
 return Number.isFinite(number)?Math.max(10,Math.min(86400,Math.round(number))):300
}
export function nextRotationScene(pool:BackgroundId[],current:BackgroundId,mode:Settings['autoSceneMode'],random=Math.random):BackgroundId|null{
 const candidates=pool.filter(id=>id!==current)
 if(pool.length<2||!candidates.length)return null
 return mode==='sequence'?pool[(pool.indexOf(current)+1)%pool.length]:candidates[Math.min(candidates.length-1,Math.floor(Math.max(0,random())*candidates.length))]
}
