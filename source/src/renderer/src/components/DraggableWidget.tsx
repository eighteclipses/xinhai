import {useEffect,useRef,useState,type ReactNode,type PointerEvent,type KeyboardEvent} from 'react'
import {useApp} from '../store/app'

type Position={x:number;y:number}
const clamp=(v:number,max:number)=>Math.max(0,Math.min(Math.max(0,max),v))
/** Store proportions of available travel, so resizing never strands a widget offscreen. */
export default function DraggableWidget({kind,width,height,scale=1,unrestricted=false,children}:{kind:'clock'|'player';width:number;height:number;scale?:number;unrestricted?:boolean;children:(scale:number)=>ReactNode}){
 const key=kind==='clock'?'clockPosition':'playerPosition'
 const saved=useApp(s=>s.settings[key]),setSettings=useApp(s=>s.setSettings)
 const [viewport,setViewport]=useState(()=>({w:innerWidth,h:innerHeight}))
 const [drag,setDrag]=useState<Position|null>(null)
 const active=useRef<{pointer:number;x:number;y:number;left:number;top:number;last:Position;started:boolean}|null>(null)
 const top=unrestricted?8:52,bottom=unrestricted?8:8+(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-height'))||66)
 const effective=Math.max(.1,Math.min(scale,(viewport.w-16)/width,(viewport.h-top-bottom)/height))
 const w=width*effective,h=height*effective,maxX=Math.max(0,viewport.w-w-16),maxY=Math.max(0,viewport.h-h-top-bottom)
 const defaultPos=kind==='clock'?{x:1,y:0}:{x:0,y:1}
 const ratio=saved??defaultPos
 const pos=drag??{x:8+clamp(ratio.x*maxX,maxX),y:top+clamp(ratio.y*maxY,maxY)}
 useEffect(()=>{const resized=()=>{setViewport({w:innerWidth,h:innerHeight});active.current=null;setDrag(null)};addEventListener('resize',resized);return()=>removeEventListener('resize',resized)},[])
 const save=(p:Position)=>void setSettings({[key]:{x:maxX?clamp(p.x-8,maxX)/maxX:0,y:maxY?clamp(p.y-top,maxY)/maxY:0}})
 const down=(e:PointerEvent<HTMLDivElement>)=>{
  if(e.button!==0||(e.target as HTMLElement).closest('button,input,select,a,[data-no-drag]'))return
  active.current={pointer:e.pointerId,x:e.clientX,y:e.clientY,left:pos.x,top:pos.y,last:pos,started:false}
  e.currentTarget.setPointerCapture(e.pointerId)
 }
 const move=(e:PointerEvent<HTMLDivElement>)=>{
  const a=active.current;if(!a||a.pointer!==e.pointerId)return
  if(!a.started&&Math.hypot(e.clientX-a.x,e.clientY-a.y)<5)return
  a.started=true;a.last={x:8+clamp(a.left+e.clientX-a.x-8,maxX),y:top+clamp(a.top+e.clientY-a.y-top,maxY)};setDrag(a.last)
 }
 const up=(e:PointerEvent<HTMLDivElement>)=>{
  const a=active.current;if(!a)return;active.current=null
  if(a.started)save(a.last);setDrag(null)
  if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)
 }
 const keyboard=(e:KeyboardEvent<HTMLDivElement>)=>{
  if(e.target!==e.currentTarget)return
  const delta=({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]} as Record<string,number[]>)[e.key]
  if(!delta)return;e.preventDefault();const step=e.shiftKey?30:8;save({x:pos.x+delta[0]*step,y:pos.y+delta[1]*step})
 }
 return <div className={'floating-widget floating-widget-'+kind+(drag?' is-dragging':'')} style={{left:pos.x,top:pos.y,width:w,height:h}} tabIndex={0} role="group" aria-label={(kind==='clock'?'日期时钟':'随身听')+'，可拖动；聚焦后用方向键移动'} title="拖动调整位置" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{active.current=null;setDrag(null)}} onLostPointerCapture={()=>{active.current=null;setDrag(null)}} onKeyDown={keyboard}>
  {children(effective)}
 </div>
}
