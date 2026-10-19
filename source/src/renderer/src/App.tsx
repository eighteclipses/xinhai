import LanSyncUpdates from './components/LanSyncUpdates'
import StartupAnnouncement from './components/StartupAnnouncement'
import FocusReminder from './components/FocusReminder'
import { COMMERCIAL_EDITION, PERSONAL_EDITION } from '../../shared/edition'
import ThemeStudio from './pages/ThemeStudio'
import MinimalClock from './components/MinimalClock'
import Atmosphere from './components/Atmosphere'
import MarchMemory from './components/MarchMemory'
import Knowledge from './pages/Knowledge'
import type { CSSProperties } from 'react'
import FocusOutcome from './components/FocusOutcome'
import { MOTION, useReducedEffects } from './lib/motion'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion, MotionConfig } from 'framer-motion'
import { useApp, PAGE_NUMBERS, PAGE_DEPTH } from './store/app'
import UnderwaterBackground from './components/UnderwaterBackground'
import BackgroundMedia from './components/BackgroundMedia'
import AutoSceneRotation from './components/AutoSceneRotation'
import ThemePalette from './components/ThemePalette'
import CharacterLayer from './components/CharacterLayer'
import GiantNumber from './components/GiantNumber'
import TitleBar from './components/TitleBar'
import Nav from './components/Nav'
import MusicPlayer from './components/MusicPlayer'
import GrowthOverlay from './components/GrowthOverlay'
import Home from './pages/Home'
import Focus from './pages/Focus'
import Todos from './pages/Todos'
import Calendar from './pages/Calendar'
import Habits from './pages/Habits'
import Journal from './pages/Journal'
import Stats from './pages/Stats'
import History from './pages/History'
import Settings from './pages/Settings'
import Customize from './pages/Customize'
import P3RClock from './components/P3RClock'
import DraggableWidget from './components/DraggableWidget'
import './styles/customize.css'
import { resolveScene } from './lib/scenes'
import { setVolume } from './lib/audio'
import { effectiveThemeColor } from '../../shared/theme'
import { themeTextPalette, TEXT_SURFACE_ALPHA } from '../../shared/themeContrast'
import { extractWallpaperColors } from './lib/wallpaperColors'
import './styles/commercial-contrast.css'
import {useHomeViewport} from './lib/useHomeViewport'

const PAGES = {
  knowledge: Knowledge,
  home: Home,
  focus: Focus,
  todos: Todos,
  calendar: Calendar,
  habits: Habits,
  journal: Journal,
  stats: Stats,
  history: History,
  settings: Settings,
  customize: COMMERCIAL_EDITION ? ThemeStudio : Customize
} as const

export default function App() {
  const [uiHidden, setUiHidden] = useState(false)
  const [gestureHint,setGestureHint]=useState(false)
  const [focusVisited, setFocusVisited] = useState(false)
  const uiRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<HTMLDivElement>(null)
  const touchTap = useRef({time:0,x:0,y:0,startX:0,startY:0})
  const previousFocus = useRef<HTMLElement | null>(null)
  const hideUI = () => {
    previousFocus.current = document.activeElement as HTMLElement | null
    if(!localStorage.getItem('wallpaper-gesture-learned')){setGestureHint(true);localStorage.setItem('wallpaper-gesture-learned','1')}
    setUiHidden(true)
  }
  useEffect(()=>{if(!gestureHint)return;const timer=setTimeout(()=>setGestureHint(false),4000);return()=>clearTimeout(timer)},[gestureHint])
  useEffect(() => {
    if (uiRef.current) uiRef.current.inert = uiHidden
    document.body.classList.toggle('wallpaper-view', uiHidden)
    if (uiHidden) gestureRef.current?.focus({preventScroll:true})
    else previousFocus.current?.focus()
    return () => document.body.classList.remove('wallpaper-view')
  }, [uiHidden])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && uiHidden) {
        event.preventDefault()
        setUiHidden(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [uiHidden])
  const settings = useApp(s => s.settings)
  const clock = useApp(s => s.focusClock)
  const dataResetVersion = useApp(s => s.dataResetVersion)
  const page = useApp((s) => s.page)
  const homeViewport=useHomeViewport(page==='home'&&!uiHidden)
  useEffect(() => { if (page === 'focus') setFocusVisited(true) }, [page])
  const reduce = useReducedEffects()
  const volume = useApp((s) => s.settings.volume)

  useEffect(() => {
    // 即时拍：远程入账触发现场演出
    return window.api.onRemoteGrowth((items) => {
      void useApp.getState().applyGrowth(items as never)
    })
  }, [])

  useEffect(() => {
    setVolume(volume)
  }, [volume])

  const Page = PAGES[page]
  const depth = PAGE_DEPTH[page]
  const background = useApp((s) => s.settings.background)
  const pageBackgrounds = useApp((s) => s.settings.pageBackgrounds)
  const seaMode = resolveScene(background, page, pageBackgrounds&&!uiHidden,settings.customBackground).kind === 'procedural'
  const themeColor = effectiveThemeColor(settings)
  const textPalette = COMMERCIAL_EDITION ? themeTextPalette(themeColor) : null
  useEffect(()=>{
    const custom=settings.customBackground
    if(settings.themeMode!=='wallpaper'||settings.background!=='custom'||!custom||custom.themeColor)return
    let cancelled=false
    const controller=new AbortController()
    void extractWallpaperColors(resolveScene('custom','home',false,custom),{displayedVideoOnly:COMMERCIAL_EDITION,signal:controller.signal}).then(colors=>{
      const current=useApp.getState().settings
      if(!cancelled&&colors[0]&&current.customBackground?.src===custom.src)
        return useApp.getState().setSettings({customBackground:{...current.customBackground,themeColor:colors[0]}})
    }).catch(()=>{/* Keep the previous accent when the media cannot be sampled. */})
    return()=>{cancelled=true;controller.abort()}
  },[settings.themeMode,settings.background,settings.customBackground?.src,settings.customBackground?.themeColor])
  useLayoutEffect(() => {
    // Body portals (growth/preview dialogs) inherit the same palette as pages.
    document.documentElement.style.setProperty('--theme-color', themeColor)
    if(textPalette){
      document.documentElement.style.setProperty('--readable-accent', textPalette.accent)
      document.documentElement.style.setProperty('--readable-muted', textPalette.muted)
      document.documentElement.style.setProperty('--control-fill', textPalette.controlFill)
      document.documentElement.style.setProperty('--control-ink', textPalette.controlInk)
      document.documentElement.style.setProperty('--text-surface-alpha', String(TEXT_SURFACE_ALPHA))
    }
  }, [themeColor])

  return (
    <MotionConfig reducedMotion={reduce ? 'always' : 'user'}><div className={'study-shell' + (reduce ? ' reduce-motion' : '') + (uiHidden ? ' ui-hidden' : '')} data-page={page} data-clock={settings.clockStyle} data-player={settings.playerStyle} data-scene={resolveScene(background,page,pageBackgrounds&&!uiHidden,settings.customBackground).id} style={{ height: '100%', position: 'relative', '--theme-color':themeColor,'--cyan':`color-mix(in srgb, ${themeColor} 70%, white)`,'--cyan-bright':themeColor,'--cyan-dim':`color-mix(in srgb, ${themeColor} 35%, transparent)`,'--background-fit':settings.backgroundFit, '--panel-alpha':settings.panelOpacity, '--panel-blur':settings.panelBlur+'px', '--wallpaper-dim':settings.wallpaperDim, '--character-opacity':settings.characterOpacity, '--character-scale':settings.characterScale } as CSSProperties}>
      <ThemePalette color={themeColor}/>
      <AutoSceneRotation wallpaper={uiHidden}/>
      <LanSyncUpdates/>
      <BackgroundMedia wallpaper={uiHidden}/>
      {!COMMERCIAL_EDITION && (!uiHidden || seaMode) && <UnderwaterBackground depth={depth} seaMode={seaMode} />}
      <Atmosphere/>
      <div ref={uiRef} className="interface-layer" aria-hidden={uiHidden || undefined}>
      <div className="reading-shade" aria-hidden="true" /><CharacterLayer />
      <GiantNumber value={PAGE_NUMBERS[page]} />
      <TitleBar onHideUI={hideUI} />

      {(focusVisited || page === 'focus') && <div className="page-stage page-stage-focus" style={{ position: 'absolute', display: page === 'focus' ? undefined : 'none' }} aria-hidden={page !== 'focus'}>
        <Focus key={dataResetVersion} active={page === 'focus'} />
      </div>}
      {/* Unmount the outgoing page with navigation: the shell's scene and layout
          selectors already describe the new page. Retain only its entrance animation. */}
        {page !== 'focus' && <motion.div
          key={page}
          className={'page-stage page-stage-' + page}
          style={{ position: 'absolute', inset: 0 }}
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0 : MOTION.page, ease: [0.22, 1, 0.36, 1] }}
        >
          {page==='home'?<Home viewport={homeViewport}/>:<Page />}
        </motion.div>}


      <Nav />
      </div>
      {clock && (page !== 'focus' || uiHidden) && (!uiHidden || settings.wallpaperClock) && <button className={'floating-clock timer-'+settings.timerPosition} onClick={() => {setUiHidden(false);useApp.getState().go('focus')}}><small>{clock.label}{clock.paused ? ' · 已暂停' : ''}</small><strong>{clock.time}</strong><span>返回专注 →</span></button>}
      <MusicPlayer wallpaper={uiHidden}/>
      {(page==='home'||uiHidden)&&settings.clockStyle==='minimal'&&<DraggableWidget kind="clock" width={320} height={132} scale={settings.clockScale*(page==='home'&&!uiHidden?homeViewport.scale:1)} unrestricted={uiHidden}>{scale=><MinimalClock scale={scale}/>}</DraggableWidget>}
      {(page==='home'||uiHidden)&&settings.clockStyle==='p3r'&&<DraggableWidget kind="clock" width={500} height={140} scale={settings.clockScale*(page==='home'&&!uiHidden?homeViewport.scale:1)} unrestricted={uiHidden}>{scale=><P3RClock scale={scale}/>}</DraggableWidget>}
      <FocusOutcome />
      <GrowthOverlay />
      {PERSONAL_EDITION && <MarchMemory />}
      {!COMMERCIAL_EDITION && <StartupAnnouncement />}
      <FocusReminder onOpenFocus={() => { setUiHidden(false); useApp.getState().go('focus') }} />
      {uiHidden&&<><div ref={gestureRef} className="wallpaper-gesture-surface" tabIndex={0} aria-label="壁纸欣赏。双击背景、按 Esc 或 Enter 返回学习界面。" onDoubleClick={()=>setUiHidden(false)} onKeyDown={e=>{if(e.key==='Enter')setUiHidden(false)}} onPointerDown={e=>{touchTap.current.startX=e.clientX;touchTap.current.startY=e.clientY}} onPointerUp={e=>{
        if(e.pointerType!=='touch')return
        const t=touchTap.current,now=Date.now()
        if(Math.hypot(e.clientX-t.startX,e.clientY-t.startY)>12){t.time=0;return}
        if(now-t.time<350&&Math.hypot(e.clientX-t.x,e.clientY-t.y)<36){t.time=0;setUiHidden(false)}else{t.time=now;t.x=e.clientX;t.y=e.clientY}
      }}/>{gestureHint&&<div className="wallpaper-gesture-hint" role="status">双击背景返回 · 电脑也可按 Esc</div>}</>}
    </div></MotionConfig>
  )
}
