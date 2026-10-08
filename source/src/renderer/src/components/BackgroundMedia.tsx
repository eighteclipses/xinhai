import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store/app'
import { resolveScene } from '../lib/scenes'
import { useReducedEffects } from '../lib/motion'
import ThemeSweep from './ThemeSweep'
import { effectiveThemeColor } from '../../../shared/theme'
import { FALLBACK_POSTER } from '../../../shared/sceneCatalog'
import { firstVideoFrameDeadline } from '../lib/videoFrameWait'

// Every video has a matching still for loading, decoder errors and reduced motion.
function Scene({ scene }: { scene: ReturnType<typeof resolveScene> }) {
  const reduce = useReducedEffects()
  const drift=useApp(s=>s.settings.wallpaperMotion&&s.settings.backgroundFit==='cover')
  const video = useRef<HTMLVideoElement>(null)
  const [intro, setIntro] = useState(Boolean(scene.intro))
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const src = intro ? scene.intro : scene.src
  const animated = scene.kind === 'video' && !reduce && !failed

  useEffect(() => {
    if (!animated) return
    const element = video.current
    if (!element) return
    setReady(false)
    let disposed = false
    let suspended = false
    const frameDeadline=firstVideoFrameDeadline(element,()=>setFailed(true))
    let retry: ReturnType<typeof setTimeout> | undefined
    const clearRetry = () => { if (retry) { clearTimeout(retry); retry = undefined } }
    const play = () => {
      if (disposed || suspended || document.hidden || element.ended) return
      if (!element.paused) return
      void element.play().catch(() => {
        // Android WebView can reject the first play() while its surface is
        // being restored. A transient rejection is not a broken wallpaper.
        if (!disposed && !suspended && !document.hidden && !retry) {
          retry = setTimeout(() => { retry = undefined; play() }, 700)
        }
      })
    }
    const scheduleRecovery = () => {
      if (disposed || suspended || document.hidden || retry || element.ended) return
      retry = setTimeout(() => { retry = undefined; play() }, 350)
    }
    const resume = () => { suspended = false; clearRetry(); if(!document.hidden)frameDeadline.resume(); play() }
    const pause = () => { suspended = true; clearRetry(); frameDeadline.pause(); element.pause() }
    const syncVisibility = () => { if (document.hidden) pause(); else resume() }
    resume()
    document.addEventListener('visibilitychange', syncVisibility)
    window.addEventListener('xinhai-resume', resume)
    window.addEventListener('xinhai-pause', pause)
    // A WebView may report a decoder stall as a pause without changing
    // document.hidden. Retry only while the user is still viewing the scene.
    element.addEventListener('pause', scheduleRecovery)
    element.addEventListener('waiting', scheduleRecovery)
    element.addEventListener('stalled', scheduleRecovery)
    return () => {
      disposed = true
      clearRetry()
      frameDeadline.dispose()
      document.removeEventListener('visibilitychange', syncVisibility)
      window.removeEventListener('xinhai-resume', resume)
      window.removeEventListener('xinhai-pause', pause)
      element.removeEventListener('pause', scheduleRecovery)
      element.removeEventListener('waiting', scheduleRecovery)
      element.removeEventListener('stalled', scheduleRecovery)
      element.pause()
    }
  }, [src, animated])

  if (scene.kind === 'procedural') return null
  return <div className={'scene-media'+(scene.kind==='image'&&drift&&!reduce?' is-drifting':'')} aria-hidden="true" data-scene={scene.id} data-fallback={failed || reduce ? 'true' : 'false'}>
    <img src={scene.poster} alt="" onError={e=>{if(!e.currentTarget.src.endsWith(FALLBACK_POSTER))e.currentTarget.src=FALLBACK_POSTER}} />
    {animated && <video ref={video} key={src} src={src} poster={scene.poster} muted loop={!intro} playsInline preload="auto" disablePictureInPicture
      onLoadedMetadata={(e) => { if (intro && scene.id === 'journal') e.currentTarget.currentTime = 0.7 }}
      style={{ opacity: ready ? 1 : 0 }} onPlaying={() => setReady(true)} onError={() => setFailed(true)}
      onEnded={(e) => {
        if (intro) { setReady(false); setIntro(false) }
        else { e.currentTarget.currentTime = 0; void e.currentTarget.play().catch(() => undefined) }
      }} />}
  </div>
}

export default function BackgroundMedia({wallpaper=false}:{wallpaper?:boolean}) {
  const settings=useApp(s=>s.settings)
  const { background, pageBackgrounds, customBackground } = settings
  const themeColor=effectiveThemeColor(settings)
  const page = useApp((s) => s.page)
  const scene = resolveScene(background, page, pageBackgrounds&&!wallpaper,customBackground)
  const reduce=useReducedEffects(),keyOf=(s:typeof scene)=>s.id+s.src
  const wanted=useRef(scene);wanted.current=scene
  const [shown,setShown]=useState(scene),[incoming,setIncoming]=useState<typeof scene|null>(null)
  const reveal=useRef<HTMLDivElement>(null),wantedKey=keyOf(scene),shownKey=keyOf(shown)
  useEffect(()=>{
    if(reduce||settings.sceneTransition==='none'||document.hidden){setShown(wanted.current);setIncoming(null);return}
    if(incoming||wantedKey===shownKey)return
    let cancelled=false,settled=false
    const next=wanted.current,image=new Image()
    const ready=()=>{if(cancelled||settled)return;settled=true;clearTimeout(timeout);setIncoming(next)}
    // Keep the previous scene visible until the next still is decoded, even on slow disks.
    const timeout=setTimeout(ready,1800)
    image.onload=()=>{void image.decode().catch(()=>{}).then(ready)};image.onerror=ready;image.src=next.poster
    if(image.complete&&image.naturalWidth)ready()
    return()=>{cancelled=true;clearTimeout(timeout);image.onload=image.onerror=null}
  },[wantedKey,shownKey,incoming,reduce,settings.sceneTransition])
  const finish=()=>{if(incoming){setShown(incoming);setIncoming(null)}}
  useEffect(()=>{
    if(!incoming||reduce||settings.sceneTransition!=='fade')return
    const timer=setTimeout(()=>{setShown(incoming);setIncoming(null)},740)
    return()=>clearTimeout(timer)
  },[incoming,reduce,settings.sceneTransition])
  const layers=incoming?[shown,incoming]:[shown]
  return <><div className="background-stack">{layers.map((s,i)=><div key={keyOf(s)} ref={i===1?reveal:undefined} className={'background-plane'+(i===1?' is-incoming':'')+(i===1&&settings.sceneTransition==='fade'?' scene-fade':'')} style={{zIndex:i}}><Scene scene={s}/></div>)}</div>{incoming&&!reduce&&settings.sceneTransition==='arc'&&<ThemeSweep color={themeColor} reveal={reveal} onDone={finish}/>}</>
}
