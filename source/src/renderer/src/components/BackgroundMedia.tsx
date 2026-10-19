import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store/app'
import { resolveScene } from '../lib/scenes'
import { useReducedEffects } from '../lib/motion'
import ThemeSweep from './ThemeSweep'
import { effectiveThemeColor } from '../../../shared/theme'
import { FALLBACK_POSTER } from '../../../shared/sceneCatalog'
import { watchWallpaperPlayback } from '../lib/wallpaperPlayback'
import '../styles/moon-scene-readability.css'

// Every video has a matching still for loading, decoder errors and reduced motion.
function Scene({ scene }: { scene: ReturnType<typeof resolveScene> }) {
  const reduce = useReducedEffects()
  const drift=useApp(s=>s.settings.wallpaperMotion&&s.settings.backgroundFit==='cover')
  const video = useRef<HTMLVideoElement>(null)
  const activity = useRef({ paused: false })
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
    return watchWallpaperPlayback(element, {
      intro,
      startTime: intro && scene.id === 'journal' ? 0.7 : undefined,
      activity: activity.current,
      onIntroEnded: () => { setReady(false); setIntro(false) },
      onPlaying: () => setReady(true),
      onFailure: () => setFailed(true)
    })
  }, [src, animated, intro, scene.id])

  if (scene.kind === 'procedural') return null
  return <div className={'scene-media'+(scene.kind==='image'&&drift&&!reduce?' is-drifting':'')} aria-hidden="true" data-scene={scene.id} data-fallback={failed || reduce ? 'true' : 'false'}>
    <img src={scene.poster} alt="" onError={e=>{if(!e.currentTarget.src.endsWith(FALLBACK_POSTER))e.currentTarget.src=FALLBACK_POSTER}} />
    {animated && <video ref={video} key={src} src={src} poster={scene.poster} muted loop={!intro} playsInline preload="auto" disablePictureInPicture
      style={{ opacity: ready ? 1 : 0 }} />}
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
