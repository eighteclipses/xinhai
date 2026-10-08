import {useEffect,useRef,useState,type PointerEvent,type KeyboardEvent} from 'react'
import {useApp} from '../store/app'

type Point={x:number;y:number}
const unit=(n:number)=>Number.isFinite(n)?Math.max(0,Math.min(1,n)):0
export function useMusicPanelPosition(wallpaper:boolean){
 const saved=useApp(s=>s.settings.musicLibraryPosition)
 const [ratio,setRatio]=useState<Point|null>(saved)
 const [viewport,setViewport]=useState(()=>({w:innerWidth,h:innerHeight}))
 const [drag,setDrag]=useState<Point|null>(null)
 const active=useRef<{id:number;x:number;y:number;start:Point;last:Point}|null>(null)
 const top=wallpaper?12:52,bottom=wallpaper?12:78
 const width=Math.min(620,viewport.w-24),height=Math.min(660,viewport.h-top-bottom)
 const travel={x:Math.max(0,viewport.w-width-24),y:Math.max(0,viewport.h-height-top-bottom)}
 const current=ratio??{x:1,y:.5}
 const position=drag??{x:12+unit(current.x)*travel.x,y:top+unit(current.y)*travel.y}
 useEffect(()=>setRatio(saved),[saved])
 useEffect(()=>{const resize=()=>{active.current=null;setDrag(null);setViewport({w:innerWidth,h:innerHeight})};addEventListener('resize',resize);return()=>removeEventListener('resize',resize)},[])
 useEffect(()=>{active.current=null;setDrag(null)},[wallpaper])
 const bounded=(p:Point)=>({x:Math.max(12,Math.min(12+travel.x,p.x)),y:Math.max(top,Math.min(top+travel.y,p.y))})
 const save=(p:Point)=>{const next={x:travel.x?unit((p.x-12)/travel.x):0,y:travel.y?unit((p.y-top)/travel.y):0};setRatio(next);void useApp.getState().setSettings({musicLibraryPosition:next})}
 const down=(e:PointerEvent<HTMLDivElement>)=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();active.current={id:e.pointerId,x:e.clientX,y:e.clientY,start:position,last:position};e.currentTarget.setPointerCapture(e.pointerId)}
 const move=(e:PointerEvent<HTMLDivElement>)=>{const a=active.current;if(!a||a.id!==e.pointerId)return;if(!drag&&Math.hypot(e.clientX-a.x,e.clientY-a.y)<5)return;a.last=bounded({x:a.start.x+e.clientX-a.x,y:a.start.y+e.clientY-a.y});setDrag(a.last)}
 const up=(e:PointerEvent<HTMLDivElement>)=>{const a=active.current;if(!a||a.id!==e.pointerId)return;active.current=null;if(drag)save(a.last);setDrag(null);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}
 const cancel=()=>{active.current=null;setDrag(null)}
 const keyboard=(e:KeyboardEvent<HTMLDivElement>)=>{const delta=({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]} as Record<string,number[]>)[e.key];if(!delta)return;e.preventDefault();const step=e.shiftKey?40:10;save(bounded({x:position.x+delta[0]*step,y:position.y+delta[1]*step}))}
 const reset=()=>{cancel();setRatio(null);void useApp.getState().setSettings({musicLibraryPosition:null})}
 return {style:{left:position.x,top:position.y,width,height},dragging:!!drag,reset,handle:{onPointerDown:down,onPointerMove:move,onPointerUp:up,onPointerCancel:cancel,onLostPointerCapture:cancel,onKeyDown:keyboard}}
}
