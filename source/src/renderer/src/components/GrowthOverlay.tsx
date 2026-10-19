import { usePresentationFocus } from '../lib/presentation'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp, type GrowthPopup } from '../store/app'
import { DIMENSION_COLORS,DIMENSION_NAMES,levelOf,idiomOf } from '../../../shared/types'
import { playNoteBeat,playLevelUp } from '../lib/audio'
import { useReducedEffects } from '../lib/motion'
import { changedDimensions,noteCount,growthPhrase } from '../lib/growthPresentation'
import GrowthNotes,{NoteGlyph} from './GrowthNotes'
import PersonaRadar from './PersonaRadar'

export function GrowthMoment({current,onDone}:{current:GrowthPopup;onDone:()=>void}){
 const reduce=useReducedEffects(),particles=useApp(s=>s.settings.particles)
 const button=usePresentationFocus(),done=useRef(false)
 const [exiting,setExiting]=useState(false)
 const timers=useRef<ReturnType<typeof setTimeout>[]>([])
 const exitTimer=useRef<ReturnType<typeof setTimeout>>()
 const completed=useRef(false),callback=useRef(onDone);callback.current=onDone
 const finish=()=>{if(!completed.current){completed.current=true;clearTimeout(exitTimer.current);callback.current()}}
 const dismiss=()=>{
   if(done.current)return
   done.current=true;timers.current.forEach(clearTimeout);timers.current=[]
   if(reduce){finish();return}
   setExiting(true)
   // The dialog stays mounted and owns keyboard focus through its exit.
   // A hidden window may suspend Framer's completion callback, so guarantee cleanup.
   exitTimer.current=setTimeout(finish,450)
 }
 useEffect(()=>()=>clearTimeout(exitTimer.current),[])
 const after=current.after??useApp.getState().stats
 const before=current.before??{...after,[current.dimension]:Math.max(0,after[current.dimension]-current.points)}
 const gained=changedDimensions(before,after)
 const countFor=(d:typeof gained[number])=>current.noteCount!==undefined&&d==='knowledge'?Math.min(128,current.noteCount):noteCount(after[d]-before[d])
 const exact=current.noteCount!==undefined
 const maxNotes=Math.max(0,...gained.map(countFor)),spacing=maxNotes>8?Math.min(.12,7/maxNotes):.2
 const noteDuration=Math.max(1650,900+maxNotes*spacing*1000)
 const upgraded=gained.filter(d=>levelOf(after[d])>levelOf(before[d]))
 const [phase,setPhase]=useState<'notes'|'chart'>(reduce?'chart':'notes')
 useEffect(()=>{
   if(done.current)return
   const scheduled:ReturnType<typeof setTimeout>[]=[]
   timers.current=scheduled
   if(reduce)setPhase('chart')
   else {
     setPhase('notes')
     gained.forEach((d,i)=>{for(let n=0;n<countFor(d);n++)scheduled.push(setTimeout(()=>playNoteBeat(n),180+i*160+n*spacing*1000))})
     scheduled.push(setTimeout(()=>setPhase('chart'),noteDuration))
     if(upgraded.length)scheduled.push(setTimeout(playLevelUp,noteDuration+900))
   }
   scheduled.push(setTimeout(dismiss,reduce?4200:noteDuration+(upgraded.length?4850:3950)))
   const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopImmediatePropagation();dismiss()}}
   window.addEventListener('keydown',key,true)
   return()=>{scheduled.forEach(clearTimeout);window.removeEventListener('keydown',key,true)}
 },[reduce])
 return <motion.section initial={false} animate={{opacity:exiting?0:1}} transition={{duration:.26}} onAnimationComplete={()=>{if(done.current)finish()}} data-exiting={exiting} className={'growth-stage persona-growth phase-'+phase+(reduce?' motion-still':'')} role="dialog" aria-modal="true" aria-label="五维成长结算" data-growth>
   <AnimatePresence>{phase==='notes'&&<motion.div className="notes-arrival" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0,y:-30}} transition={{duration:.22}}>
     <span className="notes-arrival-caption">{current.preview?'演出预览':exact?'收下 '+current.noteCount+' 个学习音符':'这一刻，有所收获。'}</span>
     <div className="notes-arrival-groups">{gained.map((d,i)=><div className="notes-arrival-dimension" key={d} style={{'--note-color':DIMENSION_COLORS[d]} as CSSProperties}>
       <div className="flying-notes" style={exact?{flexWrap:'wrap',maxWidth:'min(80vw,760px)',height:'auto',minHeight:68,maxHeight:'50vh',overflowY:'auto',rowGap:12}:undefined}>{Array.from({length:countFor(d)},(_,n)=><motion.span data-arriving-note key={n} initial={{y:36,scale:.35,opacity:0,rotate:-18}} animate={{y:[36,-18,-26],scale:[.35,1.15,1],opacity:[0,1,1],rotate:[-18,8,0]}} transition={{duration:.72,delay:.12+i*.16+n*spacing}}><NoteGlyph/></motion.span>)}</div>
       <strong>{DIMENSION_NAMES[d]}</strong>
     </div>)}</div>
     {particles&&<div className="note-sparks" aria-hidden="true">{Array.from({length:9},(_,i)=><i key={i} style={{left:(10+i*10)+'%',animationDelay:i*.07+'s'}}/>)}</div>}
   </motion.div>}</AnimatePresence>
   {phase==='chart'&&<motion.div className="persona-status-panel" data-growth-chart initial={reduce?false:{x:160,opacity:0,rotate:-3}} animate={exiting?{x:-70,opacity:0,rotate:1.5}:{x:0,opacity:1,rotate:0}} transition={{duration:exiting?.24:.38,ease:[.16,1,.3,1]}}>
     <div className="persona-panel-orbit" aria-hidden="true"/>
     <header className="persona-status-heading"><small>{current.preview?'PREVIEW / 演出预览':'SOCIAL STATUS / 心之成长'}</small><h2>{upgraded.length?'RANK UP!':gained.length?'POINT UP!':'STAY IN THE BLUE'}</h2><p>{upgraded.length?'新的自己，正在显现。':gained.length?'每一份投入，都留下痕迹。':'把这一刻留在心海。'}</p></header>
     <PersonaRadar values={after} before={before} active={gained} animateGrowth/>
     <div className="persona-gain-captions" role="status" aria-live="polite">{gained.map(d=><div key={d} style={{color:DIMENSION_COLORS[d]}}><span>{DIMENSION_NAMES[d]}</span><GrowthNotes points={exact&&d==='knowledge'?current.noteCount!:after[d]-before[d]} exact={exact&&d==='knowledge'}/><small>{exact&&d==='knowledge'?current.noteCount+' 个学习音符':upgraded.includes(d)?`${idiomOf(d,levelOf(before[d]))} → ${idiomOf(d,levelOf(after[d]))}`:growthPhrase(after[d]-before[d])}</small></div>)}</div>
   </motion.div>}
   <button ref={button} className="growth-skip persona-continue" onClick={dismiss} aria-disabled={exiting}>继续 · Esc →</button>
 </motion.section>
}
const popupIds=new WeakMap<GrowthPopup,number>();let popupSequence=0
function idOf(popup:GrowthPopup){if(!popupIds.has(popup))popupIds.set(popup,++popupSequence);return popupIds.get(popup)}
export default function GrowthOverlay(){
 const current=useApp(s=>s.popups[0]),focusFinish=useApp(s=>s.focusFinish),rewards=useApp(s=>s.focusRewardPresentation)
 return <AnimatePresence>{!focusFinish&&!rewards&&current&&<GrowthMoment key={idOf(current)} current={current} onDone={()=>useApp.getState().shiftPopup()}/>}</AnimatePresence>
}
