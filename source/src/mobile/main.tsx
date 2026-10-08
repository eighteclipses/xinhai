import { installMobileApi } from './api'
import { native } from './native'
try{
  installMobileApi()
  void import('../renderer/src/main').then(async module=>{
    await module.bootComplete
    const {useApp}=await import('../renderer/src/store/app')
    useApp.subscribe((state,previous)=>{if(state.focusClock?.paused!==previous.focusClock?.paused||!!state.focusClock!==!!previous.focusClock)native('keepAwake',{enabled:!!state.focusClock&&!state.focusClock.paused})})
  }).catch(()=>{/* Renderer bootstrap displays recovery-safe retry controls. */})
}catch(error){
  const root=document.getElementById('root')!
  const title=document.createElement('h2');title.textContent='暂时无法打开学习库'
  const description=document.createElement('p');description.textContent=String(error)
  const retry=document.createElement('button');retry.textContent='重新打开';retry.onclick=()=>location.reload()
  root.style.cssText='padding:48px;color:white;background:#101010;font:18px sans-serif';root.append(title,description,retry)
}
