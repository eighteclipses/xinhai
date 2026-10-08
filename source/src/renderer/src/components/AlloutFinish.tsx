import { usePresentationFocus } from '../lib/presentation'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useReducedEffects } from '../lib/motion'
import { formatDuration } from '../../../shared/types'
import { useApp } from '../store/app'
import { effectiveThemeColor } from '../../../shared/theme'

// This source variant uses its own neutral background, without game footage.
export default function AlloutFinish({ seconds, task, onDone, preview = false }: { seconds:number; task:string; onDone:()=>void; preview?:boolean }) {
  const reduce = useReducedEffects()
  const settings = useApp(s=>s.settings)
  const accent = effectiveThemeColor(settings)
  const button = usePresentationFocus()
  const video = useRef<HTMLVideoElement>(null)
  const done = useRef(false)
  const [failed,setFailed] = useState(true)
  const [receipt,setReceipt] = useState(true)
  const finish = () => {if(!done.current){done.current=true;onDone()}}
  useEffect(()=>{
    let disposed=false
    const element=video.current
    if(element && !reduce){element.muted=true;void element.play().catch(()=>{if(!disposed)setFailed(true)})}
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopImmediatePropagation();finish()}}
    const onEnded=()=>{clearTimeout(fallback);setReceipt(true)}
    // A failed/stalled decoder falls back to the chosen still; dismissal is always manual.
    const fallback=setTimeout(()=>{if(!disposed){setReceipt(true);setFailed(true)}},8000)
    element?.addEventListener('ended',onEnded);window.addEventListener('keydown',onKey,true)
    return()=>{disposed=true;clearTimeout(fallback);element?.pause();element?.removeEventListener('ended',onEnded);window.removeEventListener('keydown',onKey,true)}
  },[])
  useEffect(()=>{if(failed)setReceipt(true)},[failed])
  return <section className="allout-stage allout-film allout-refined" style={{'--finish-accent':accent} as CSSProperties} role="dialog" aria-modal="true" aria-label="专注完成演出" data-allout>
    <img className="allout-film-still" src="backgrounds/originals/deep-sea.svg" alt="源码版专注完成背景" />

    <footer className="allout-footer">
      {receipt&&<div className="allout-film-receipt"><span>{preview?'演出预览':'专注已保存'}</span><strong>{formatDuration(seconds)}</strong><small>{task||'这一段，完成了。'}</small></div>}
      <button ref={button} className="allout-skip" onClick={finish}>{preview?'返回自定义':receipt?'查看成长':'跳过演出'}{window.XinhaiNative?' →':' · Esc →'}</button>
    </footer>
  </section>
}
