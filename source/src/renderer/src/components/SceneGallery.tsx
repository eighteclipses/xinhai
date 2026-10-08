import {useEffect,useRef} from 'react'
import {backgroundScenes} from '../lib/scenes'
import {useReducedEffects} from '../lib/motion'
import {sampleCardPose,sampleSpring,CARD_WAVE_SECONDS,type WaveCell,type WaveEvent,type SpringState,type MotionContext} from '../../../shared/sceneMotion'
import type {BackgroundId} from '../../../shared/types'
import '../styles/scene-wave.css'
type Entry=(typeof backgroundScenes)[number]
type Track={at:number;from:SpringState;target:number}
type Controller={select:(id:BackgroundId)=>void}
export default function SceneGallery({scenes,selected,onSelect}:{scenes:Entry[];selected:BackgroundId;onSelect:(id:BackgroundId)=>void}){
 const root=useRef<HTMLDivElement>(null),controller=useRef<Controller|null>(null),selectedRef=useRef(selected);selectedRef.current=selected
 const reduced=useReducedEffects(),sceneKey=scenes.map(s=>s.id).join('|')
 useEffect(()=>{
  const gallery=root.current!,buttons=[...gallery.querySelectorAll<HTMLButtonElement>('.scene-card')]
  const states=new Map<string,Track>(),cells=new Map<string,WaveCell>()
  let events:WaveEvent[]=[],raf=0,disposed=false,current=selectedRef.current
  let context:MotionContext={width:innerWidth,height:innerHeight,reducedMotion:reduced,compact:innerWidth<=1180||!!document.querySelector('.android-app')}
  const measure=()=>{
   context={width:innerWidth,height:innerHeight,reducedMotion:reduced,compact:innerWidth<=1180||!!document.querySelector('.android-app')}
   const rows=[...new Set(buttons.map(b=>b.offsetTop))].sort((a,b)=>a-b),columns=[...new Set(buttons.map(b=>b.offsetLeft))].sort((a,b)=>a-b)
   for(const button of buttons)cells.set(button.dataset.sceneId!,{row:rows.indexOf(button.offsetTop),column:columns.indexOf(button.offsetLeft)})
  }
  const paint=(button:HTMLButtonElement,lift:number,time:number)=>{
   const wave=sampleCardPose(time,cells.get(button.dataset.sceneId!)!,events,context),factor=context.compact?.75:1,surface=button.querySelector<HTMLElement>('.scene-card-surface')!
   const y=reduced?0:-12*lift*factor+wave.y,scale=reduced?1:1+.02*lift
   surface.style.transform=`translate3d(0,${y.toFixed(3)}px,0) rotate(${wave.rotate.toFixed(3)}deg) scale(${scale.toFixed(5)})`
  }
  const settle=()=>{
   cancelAnimationFrame(raf);raf=0;events=[];measure();const now=performance.now()/1000
   for(const button of buttons){const target=button.dataset.sceneId===current?1:0;states.set(button.dataset.sceneId!,{at:now,from:{value:target,velocity:0},target});paint(button,target,now)}
   gallery.dataset.motion='settled'
  }
  const tick=()=>{
   if(disposed)return
   const time=performance.now()/1000;events=events.filter(e=>time-e.at<CARD_WAVE_SECONDS+1.5);let moving=events.length>0
   for(const button of buttons){const track=states.get(button.dataset.sceneId!)!,spring=sampleSpring(track.from,track.target,time-track.at);paint(button,spring.value,time);moving ||= Math.abs(spring.value-track.target)>.001||Math.abs(spring.velocity)>.01}
   if(moving){gallery.dataset.motion='running';raf=requestAnimationFrame(tick)}else settle()
  }
  const select=(id:BackgroundId)=>{
   if(id===current)return
   const time=performance.now()/1000
   for(const button of buttons){const key=button.dataset.sceneId!,old=states.get(key)!;states.set(key,{at:time,from:sampleSpring(old.from,old.target,time-old.at),target:key===id?1:0})}
   current=id;if(reduced||document.hidden){settle();return}
   const origin=cells.get(id);if(origin)events=[...events,{at:time,origin:{...origin},strength:1}].slice(-3)
   cancelAnimationFrame(raf);tick()
  }
  settle();controller.current={select};let measuredWidth=gallery.clientWidth
  const observer=new ResizeObserver(()=>{if(gallery.clientWidth!==measuredWidth){measuredWidth=gallery.clientWidth;settle()}});observer.observe(gallery)
  const visibility=()=>{if(document.hidden)settle()}
  window.addEventListener('resize',settle);document.addEventListener('visibilitychange',visibility)
  return()=>{disposed=true;cancelAnimationFrame(raf);observer.disconnect();window.removeEventListener('resize',settle);document.removeEventListener('visibilitychange',visibility);controller.current=null}
 },[sceneKey,reduced])
 useEffect(()=>{controller.current?.select(selected)},[selected,sceneKey,reduced])
 return <div ref={root} className="scene-gallery wave-scene-gallery" role="group" aria-label="选择心海场景" data-effects={reduced?'reduced':'wave'}>
  {scenes.map(scene=><button key={scene.id} data-scene-id={scene.id} className="scene-card" style={{'--scene-accent':'var(--theme-color)'} as React.CSSProperties} aria-pressed={selected===scene.id} onClick={()=>onSelect(scene.id as BackgroundId)}>
   <span className="scene-card-surface"><img src={scene.poster} alt="" loading="lazy"/><span className="scene-card-kind">{scene.kind==='video'?'动态':scene.kind==='procedural'?'心海':'静帧'}</span><span className="scene-card-copy"><strong>{scene.label}</strong><small>{scene.description}</small></span>{selected===scene.id&&<span className="scene-selected">✓ 已选择</span>}</span>
  </button>)}
 </div>
}
