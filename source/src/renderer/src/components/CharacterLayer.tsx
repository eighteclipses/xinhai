import {resolveScene} from '../lib/scenes'
import {useReducedEffects} from '../lib/motion'
import {motion} from 'framer-motion'
import type {CSSProperties} from 'react'
import {useApp} from '../store/app'
import {characterArtById} from '../../../shared/characterArt'
import {COMMERCIAL_EDITION} from '../../../shared/edition'
import {fitCharacterPlacement} from '../../../shared/characterPlacement'
import {useCharacterViewport} from '../lib/characterViewport'
import CharacterVisual,{characterAspect,hasHiddenCharacter} from './CharacterVisual'
import '../styles/character-gallery.css'

export default function CharacterLayer(){
 const page=useApp(s=>s.page),mood=useApp(s=>s.characterMood),settings=useApp(s=>s.settings),reduce=useReducedEffects(),viewport=useCharacterViewport()
 const selected=settings.characterStyle==='gallery'?characterArtById(settings.characterArtId):undefined
 const style=settings.characterStyle==='gallery'&&!selected?'auto':settings.characterStyle
 if(COMMERCIAL_EDITION||!settings.showCharacter||style==='hidden'||hasHiddenCharacter(settings)||(style==='auto'&&resolveScene(settings.background,page,settings.pageBackgrounds,settings.customBackground).hasCharacter))return null
 const rect=fitCharacterPlacement(viewport,characterAspect(settings),settings.characterPosition,settings.characterScale)
 return <motion.div className={'character-layer character-positioned character-page-'+page+(selected?' character-gallery-layer':'')} data-selected-character-art={selected?.id}
  style={{position:'fixed',zIndex:1,pointerEvents:'none','--portrait-left':rect.left+'px','--portrait-top':rect.top+'px','--portrait-width':rect.width+'px','--portrait-height':rect.height+'px',opacity:settings.characterOpacity} as CSSProperties}
  animate={reduce?{y:0}:{y:[0,-4,0]}} transition={{duration:7,repeat:Infinity,ease:'easeInOut'}}><CharacterVisual settings={settings} mood={mood} reduce={reduce}/></motion.div>
}
