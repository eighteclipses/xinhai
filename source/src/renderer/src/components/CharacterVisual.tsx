import {motion} from 'framer-motion'
import type {Settings} from '../../../shared/types'
import {characterArtById,characterArtViewBox,isCharacterArtVisible} from '../../../shared/characterArt'
import CharacterPortrait from './CharacterPortrait'
const charIdle = 'optional/char-idle.png'
const charFocus = 'optional/char-focus.png'
const charSummon = 'optional/char-summon.png'
const MOOD_ART:Record<string,string>={idle:charIdle,night:charIdle,rest:charIdle,write:charIdle,focus:charIdle,levelup:charSummon}
const MOOD_FILTER:Record<string,string>={idle:'brightness(.95)',night:'brightness(.72) saturate(.9)',rest:'brightness(.85)',write:'brightness(.82) saturate(.9)',focus:'brightness(1) saturate(1.05)',levelup:'brightness(1.08) saturate(1.15) drop-shadow(0 0 28px var(--cyan-dim))'}
export function characterAspect(settings:Pick<Settings,'characterStyle'|'characterArtId'>):number {
 const selected=settings.characterStyle==='gallery'?characterArtById(settings.characterArtId):undefined
 if(selected){const box=characterArtViewBox(selected);return box.width/box.height}
 return settings.characterStyle==='battle'?1215/2431:settings.characterStyle==='seated'?1151/1732:1728/2432
}
export function hasHiddenCharacter(settings:Pick<Settings,'characterStyle'|'characterArtId'>):boolean {return settings.characterStyle==='gallery'&&!!characterArtById(settings.characterArtId)&&!isCharacterArtVisible(characterArtById(settings.characterArtId))}
export default function CharacterVisual({settings,mood='idle',reduce=true}:{settings:Pick<Settings,'characterStyle'|'characterArtId'>;mood?:string;reduce?:boolean}){
 const selected=settings.characterStyle==='gallery'?characterArtById(settings.characterArtId):undefined
 if(selected)return isCharacterArtVisible(selected)?<CharacterPortrait art={selected} align="bottom"/>:null
 const style=settings.characterStyle==='gallery'?'auto':settings.characterStyle,effectiveMood=style==='auto'?mood:'chosen'
 const art=style==='auto'?MOOD_ART:{chosen:style==='battle'?charFocus:style==='uniform'?charIdle:charIdle}
 return <>{Object.entries(art).map(([key,src])=><motion.img key={key} src={src} onError={event=>{event.currentTarget.style.display='none'}} alt="" draggable={false} style={{position:'absolute',right:0,bottom:0,width:'100%',height:'100%',objectFit:'contain',objectPosition:'right bottom',filter:MOOD_FILTER[key],maskImage:'linear-gradient(to top,transparent 0%,black 10%)',WebkitMaskImage:'linear-gradient(to top,transparent 0%,black 10%)'}} initial={false} animate={{opacity:effectiveMood===key?1:0}} transition={{duration:reduce?0:.4}}/>)}</>
}
