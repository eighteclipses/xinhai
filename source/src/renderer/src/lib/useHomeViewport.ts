import {useLayoutEffect,useState} from 'react'
import {homeViewport} from '../../../shared/homeViewport'

/** Measure the unscaled page area, never the already enlarged child or physical screen pixels. */
export function useHomeViewport(active:boolean){
 const [viewport,setViewport]=useState(()=>homeViewport(innerWidth,Math.max(1,innerHeight-134)))
 useLayoutEffect(()=>{
  if(!active)return
  const stage=document.querySelector<HTMLElement>('.page-stage-home')
  if(!stage)return
  const measure=()=>{const next=homeViewport(stage.clientWidth,stage.clientHeight);setViewport(old=>old.width===next.width&&old.height===next.height?old:next)}
  measure();const observer=new ResizeObserver(measure);observer.observe(stage)
  window.addEventListener('resize',measure)
  return()=>{observer.disconnect();window.removeEventListener('resize',measure)}
 },[active])
 return viewport
}
