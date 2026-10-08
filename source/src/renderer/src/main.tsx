import React from 'react'
import ReactDOM from 'react-dom/client'
import { replayBackupClientState, exportPendingDraftsAndContinue } from './lib/backupClientState'
import { installDurableClientStorage } from '../../mobile/durableClientStorage'
import './styles/global.css'
import './styles/p3r-refresh.css'
import './styles/mobile.css'
import './styles/theme-studio.css'
import { COMMERCIAL_EDITION } from '../../shared/edition'

async function boot(){
if(COMMERCIAL_EDITION)document.documentElement.classList.add('commercial-edition')
// Android installs its adapter before dynamically importing this entry.
// Desktop installs only when commercial preload exposes its sync bridge.
const clientStateSync=window.api.clientStateSync
if(COMMERCIAL_EDITION&&clientStateSync){
  installDurableClientStorage(localStorage,{
    initialize:state=>{
      const value=clientStateSync({op:'initialize',state})
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error('本机客户端状态初始化响应无效')
      return value
    },
    set:(key,value)=>{clientStateSync({op:'set',key,value})},
    remove:key=>{clientStateSync({op:'remove',key})},
    clear:()=>{clientStateSync({op:'clear'})}
  })
}
await replayBackupClientState()
const [{default:App},{useApp}]=await Promise.all([import('./App'),import('./store/app')])
await useApp.getState().refresh()
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
}
export const bootComplete=boot()
void bootComplete.catch((error)=>{
 const root=document.getElementById('root')!;root.textContent='学习库暂时未能载入。当前资料与待处理草稿队列仍保留，可重试。'
 const details=document.createElement('p');details.textContent=String(error);root.append(details)
 const retry=document.createElement('button');retry.textContent='重试';retry.onclick=()=>location.reload();root.append(retry)
 const exportDraft=document.createElement('button');exportDraft.textContent='另存待恢复草稿';exportDraft.onclick=()=>{void window.api.backupClientRestore().then(pending=>pending?window.api.saveFile('xinhai-pending-drafts.json',JSON.stringify(pending.state,null,2)):null).catch(e=>{details.textContent=String(e)})};root.append(exportDraft)
 const explain=document.createElement('p');explain.textContent='若草稿超过本设备存储容量，可以先另存完整草稿文件，再使用已恢复的学习资料。继续后编辑框不载入这些草稿，需要时可从另存文件中取回正文。取消另存不会清除待恢复草稿。';root.append(explain)
 const continueButton=document.createElement('button');continueButton.textContent='另存草稿并继续使用';continueButton.onclick=()=>{continueButton.disabled=true;retry.disabled=true;exportDraft.disabled=true;void exportPendingDraftsAndContinue().then(done=>{if(done)location.reload();else details.textContent='已取消另存，待恢复草稿继续保留。'}).catch(e=>{details.textContent=String(e)}).finally(()=>{continueButton.disabled=false;retry.disabled=false;exportDraft.disabled=false})};root.append(continueButton)
 root.style.cssText='padding:40px;color:white;background:#101a22;font:16px sans-serif;overflow:auto;height:100%'
})
import './styles/scene-polish.css'
import './styles/planner.css'

import './styles/music-focus.css'
import './styles/theme-sweep.css'
import './styles/theme-palette.css'
import './styles/pv-upgrade.css'
import './styles/scene-rotation.css'
import './styles/focus-finish.css'
import './styles/music-panel.css'

import './styles/theme-settings.css'
import './styles/interface-refinements.css'
import './styles/lan-sync.css'
