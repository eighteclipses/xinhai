import {useEffect,useRef} from 'react'
import {useApp} from '../store/app'
import {nextRotationScene,rotationScenes,rotationSeconds,rotationDue} from '../../../shared/sceneRotation'
import {elapsedNow} from '../lib/elapsedClock'

/** Only changes the background setting. Focus and music keep their existing owners. */
export default function AutoSceneRotation({wallpaper}:{wallpaper:boolean}){
 const enabled=useApp(s=>s.settings.autoSceneEnabled),seconds=useApp(s=>s.settings.autoSceneIntervalSeconds)
 const mode=useApp(s=>s.settings.autoSceneMode),ids=useApp(s=>s.settings.autoSceneIds)
 const focus=useApp(s=>s.settings.autoSceneFocus),hidden=useApp(s=>s.settings.autoSceneWallpaper),other=useApp(s=>s.settings.autoSceneOther)
 const background=useApp(s=>s.settings.background),custom=useApp(s=>!!s.settings.customBackground),page=useApp(s=>s.page)
 const busy=useApp(s=>s.popups.length>0||!!s.focusFinish||s.focusSaving)
 const deadline=useRef(0),ownScene=useRef<string|null>(null),inFlight=useRef(false)
 const pool=rotationScenes(ids,custom),poolKey=pool.join('|')
 const eligible=wallpaper?hidden:page==='focus'?focus:other&&page!=='customize'&&page!=='settings'&&page!=='journal'&&page!=='stats'
 const policy=useRef({eligible,busy});policy.current={eligible,busy}
 const interval=rotationSeconds(seconds)*1000
 useEffect(()=>{deadline.current=elapsedNow()+interval},[enabled,interval,poolKey,mode])
 useEffect(()=>{
  if(ownScene.current===background)ownScene.current=null
  else deadline.current=elapsedNow()+interval
 },[background])
 useEffect(()=>{
  if(!enabled||pool.length<2)return
  const tick=async()=>{
   if(inFlight.current||!policy.current.eligible||policy.current.busy)return
   const due=rotationDue(elapsedNow(),deadline.current,interval)
   if(!due)return
   const current=useApp.getState()
   const next=nextRotationScene(rotationScenes(current.settings.autoSceneIds,!!current.settings.customBackground),current.settings.background,current.settings.autoSceneMode)
   if(!next)return
   inFlight.current=true;ownScene.current=next
   try{
    await current.setSettings({background:next})
    // Collapse missed intervals to one change while preserving the cadence.
    deadline.current=due
   }catch{ownScene.current=null;deadline.current=elapsedNow()+Math.min(interval,5000)}
   finally{inFlight.current=false}
  }
  void tick()
  const timer=setInterval(()=>void tick(),500),resume=()=>void tick()
  window.addEventListener('xinhai-resume',resume)
  document.addEventListener('visibilitychange',resume)
  return()=>{clearInterval(timer);window.removeEventListener('xinhai-resume',resume);document.removeEventListener('visibilitychange',resume)}
 },[enabled,eligible,busy,interval,mode,poolKey])
 return null
}
