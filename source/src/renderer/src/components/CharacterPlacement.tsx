import {useEffect,useRef,useState,type KeyboardEvent,type PointerEvent} from 'react'
import {createPortal} from 'react-dom'
import {useApp} from '../store/app'
import {CHARACTER_SCALE_MIN,CHARACTER_SCALE_MAX,characterPositionAt,fitCharacterPlacement,normalizeCharacterPosition,normalizeCharacterScale,type CharacterPosition,type CharacterRect} from '../../../shared/characterPlacement'
import {useCharacterViewport} from '../lib/characterViewport'
import CharacterVisual,{characterAspect} from './CharacterVisual'
import '../styles/character-gallery.css'

export default function CharacterPlacement({onClose}:{onClose:()=>void}){
 const settings=useApp(s=>s.settings),setSettings=useApp(s=>s.setSettings),original=useRef(settings)
 const [position,setPosition]=useState<CharacterPosition|null>(()=>normalizeCharacterPosition(settings.characterPosition)),[scale,setScale]=useState(()=>normalizeCharacterScale(settings.characterScale)),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const viewport=useCharacterViewport(),aspect=characterAspect(original.current),rect=fitCharacterPlacement(viewport,aspect,position,scale)
 const dialog=useRef<HTMLDivElement>(null),frame=useRef<HTMLDivElement>(null),saving=useRef(false),gesture=useRef<{id:number;x:number;y:number;rect:CharacterRect;kind:'move'|'resize'}|null>(null)
 useEffect(()=>{
  const shell=document.querySelector<HTMLElement>('.study-shell'),wasInert=shell?.inert,hadClass=document.body.classList.contains('character-placement-active'),previous=document.activeElement as HTMLElement|null
  if(shell)shell.inert=true
  document.body.classList.add('character-placement-active')
  const key=(event:globalThis.KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!saving.current)onClose();return}
   if(event.key!=='Tab')return
   const controls=[...dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')??[]].filter(e=>e.getClientRects().length)
   if(!controls.length)return
   const i=controls.indexOf(document.activeElement as HTMLElement),next=event.shiftKey?(i<=0?controls.length-1:i-1):(i<0||i===controls.length-1?0:i+1)
   event.preventDefault();event.stopPropagation();controls[next].focus()
  }
  const blur=()=>{gesture.current=null}
  document.addEventListener('keydown',key,true);window.addEventListener('blur',blur);frame.current?.focus()
  return()=>{document.removeEventListener('keydown',key,true);window.removeEventListener('blur',blur);if(shell)shell.inert=wasInert??false;if(!hadClass)document.body.classList.remove('character-placement-active');previous?.focus()}
 },[])
 useEffect(()=>{gesture.current=null},[viewport.width,viewport.height])
 function begin(event:PointerEvent<HTMLElement>,kind:'move'|'resize'){
  if(saving.current||gesture.current||event.button!==0)return
  event.preventDefault();event.stopPropagation()
  // The full-screen editing surface also owns move/up events when an embedded
  // WebView cannot retain pointer capture while crossing the portrait bounds.
  try{event.currentTarget.setPointerCapture(event.pointerId)}catch{/* Surface handlers remain available. */}
  gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY,rect,kind}
 }
 function move(event:PointerEvent<HTMLElement>){
  const active=gesture.current;if(!active||active.id!==event.pointerId||saving.current)return
  event.preventDefault();const dx=event.clientX-active.x,dy=event.clientY-active.y
  if(active.kind==='move')setPosition(characterPositionAt(active.rect,active.rect.left+dx,active.rect.top+dy))
  else{
   const delta=Math.abs(dy)>=Math.abs(dx/aspect)?dy:dx/aspect,next=Math.max(CHARACTER_SCALE_MIN,Math.min(CHARACTER_SCALE_MAX,(active.rect.height+delta)/active.rect.baseHeight))
   const resized=fitCharacterPlacement(viewport,aspect,position,next)
   setScale(next);setPosition(characterPositionAt(resized,active.rect.left,active.rect.top))
  }
 }
 function end(event:PointerEvent<HTMLElement>){if(gesture.current?.id===event.pointerId)gesture.current=null}
 function keyboard(event:KeyboardEvent<HTMLElement>,resize=false){
  if(saving.current)return
  const step=event.shiftKey?24:8,key=event.key
  if(key==='+'||key==='='||key==='-'||(resize&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key))){event.preventDefault();event.stopPropagation();setScale(value=>Math.max(CHARACTER_SCALE_MIN,Math.min(CHARACTER_SCALE_MAX,value+((key==='-'||key==='ArrowDown'||key==='ArrowLeft')?-.05:.05))));return}
  const offsets:Record<string,[number,number]>={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}
  if(offsets[key]){event.preventDefault();event.stopPropagation();setPosition(characterPositionAt(rect,rect.left+offsets[key][0],rect.top+offsets[key][1]))}
 }
 async function save(){if(saving.current)return;saving.current=true;gesture.current=null;setBusy(true);setError('');try{await setSettings({characterPosition:position,characterScale:Math.round(scale*1000)/1000});onClose()}catch(e){setError(e instanceof Error?e.message:'立绘位置未保存，请重试');saving.current=false;setBusy(false)}}
 return createPortal(<div ref={dialog} className="character-placement-dialog" role="dialog" aria-modal="true" aria-labelledby="character-placement-title" aria-describedby="character-placement-instructions" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
  <p id="character-placement-instructions" className="character-placement-instructions">拖动立绘移动，拖右下角缩放。方向键微调位置，＋ / − 调整大小。较大立绘会自动适配屏幕。</p>
  <div ref={frame} className="character-placement-frame" tabIndex={0} role="group" aria-label="可移动立绘，方向键微调位置" style={{left:rect.left,top:rect.top,width:rect.width,height:rect.height}} onPointerDown={e=>begin(e,'move')} onLostPointerCapture={end} onKeyDown={e=>keyboard(e)}>
   <CharacterVisual settings={original.current} reduce/>
   <button className="character-placement-resize" type="button" disabled={busy} aria-label="缩放立绘，方向键或加减键调整" onPointerDown={e=>begin(e,'resize')} onKeyDown={e=>keyboard(e,true)}>↘</button>
  </div>
  <section className="character-placement-toolbar"><header><h2 id="character-placement-title">调整立绘</h2><div><button className="btn" disabled={busy} onClick={()=>{gesture.current=null;setPosition(null);setScale(1);setError('')}}>恢复位置</button><button className="btn" disabled={busy} onClick={onClose}>取消</button><button className="btn primary" disabled={busy} onClick={()=>void save()}>{busy?'保存中…':'完成保存'}</button></div></header><label>大小 <output>{Math.round(scale*100)}%</output><input aria-label="调整立绘大小" type="range" min={CHARACTER_SCALE_MIN} max={CHARACTER_SCALE_MAX} step={.01} disabled={busy} value={scale} onChange={e=>setScale(Number(e.target.value))}/><small>取消保留原位置；恢复位置需完成保存才生效。</small></label>{error&&<p role="alert">{error}</p>}</section>
 </div>,document.body)
}
