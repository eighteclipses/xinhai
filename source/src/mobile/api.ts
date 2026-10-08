import {createLanSyncClient} from './lanSyncClient'
import {cloudResolve,cloudId,playlistShare} from '../shared/netease'
import * as db from '../main/db'
import * as review from '../main/review'
import * as themes from '../main/themeLibrary'
import { loadFocusRecovery, saveFocusRecovery, clearFocusRecovery } from '../main/focusRecovery'
import type { ThemeImportResult } from '../shared/themeLibrary'
import { createBackupController } from '../shared/backupController'
import type { PreparedBackup } from '../shared/backupArchiveTypes'
import type { ModelClient, ModelStatus, ModelReply } from '../shared/modelConfig'
import { scoreJournal, testLLMConnection } from '../main/scoring'
import { listImportedMusic, importMusicFiles, removeImportedMusic } from './music'
import { native, request } from './native'
import type { XinhaiApi } from '../preload'
import type { KnowledgeNote, KnowledgeVault, Settings } from '../shared/types'
import { COMMERCIAL_EDITION } from '../shared/edition'
import { requireModelAnalysis } from '../shared/modelScope'
import { requireOnlineMusic } from '../shared/onlineMusic'
import { installDurableClientStorage } from './durableClientStorage'

export function installMobileApi(){
  // Cloud analysis is available only in the separate personal build.
  const browserFetch=window.fetch.bind(window)
  if(!COMMERCIAL_EDITION)window.fetch=async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url
    if(new URL(url,location.href).origin===location.origin)return browserFetch(input,init)
    if(init?.signal?.aborted)throw new DOMException('请求已取消','AbortError')
    const result=await request<{status:number;body:string}>('http',{url,method:init?.method||'GET',headers:Object.fromEntries(new Headers(init?.headers).entries()),body:init?.body??null})
    return new Response(result.body,{status:result.status,headers:{'Content-Type':'application/json'}})
  }
  if(COMMERCIAL_EDITION)installDurableClientStorage(localStorage,{
    initialize:state=>native<Record<string,string>>('clientStateInit',{state}),
    set:(key,value)=>{native<void>('clientStateSet',{key,value})},
    remove:key=>{native<void>('clientStateRemove',{key})},
    clear:()=>{native<void>('clientStateClear')}
  })
  db.initDb()
  const model:ModelClient={status:async()=>native<ModelStatus>('modelStatus'),save:async input=>{requireModelAnalysis();return native<ModelStatus>('modelSave',input)},clear:async()=>native<ModelStatus>('modelClear'),request:async input=>{requireModelAnalysis();return request<ModelReply>('modelRequest',input)}}
  void model.status().catch(()=>{}) // Attempt legacy migration at boot; settings can retry failures.
  const changed=()=>window.dispatchEvent(new Event('xinhai-sync-changed'))
  let lanSync=createLanSyncClient(db.syncEngine,changed)
  const backup=createBackupController({
    capture:db.captureBackupState,context:async()=>native<{knowledgeRoot:string}>('backupContext'),
    export:async(portable,_root,safety)=>request<string|null>('backupExport',{...portable,safety}),
    prepare:()=>request<PreparedBackup|null>('backupPrepare'),
    verify:ticket=>request<void>('backupVerify',{ticket}),
    finish:async(ticket,keep)=>{native<void>('backupFinish',{ticket,keep})},
    hasActiveFocus:()=>!!loadFocusRecovery().record,
    pauseSync:async()=>{const enabled=lanSync.status().enabled;lanSync.stop();return async()=>{await lanSync.enable(enabled)}},
    replace:(snapshot,prepared)=>db.restoreBackupState(snapshot,prepared.resources),
    resetSync:()=>{lanSync.stop();lanSync=createLanSyncClient(db.syncEngine,changed)}
  })
  window.addEventListener('pagehide',()=>lanSync.stop(),{once:true})
  const neteaseRequest=(path:string)=>{requireOnlineMusic();return request<any>('neteaseRequest',{path})}
  let activeOperations=0
  const api:XinhaiApi={
    clearOnlineMusicData:()=>request<void>('clearOnlineMusicData'),
    privacyPrepare:async()=>{if(backup.isBusy)throw Error('请先完成当前备份操作');return native<import('../shared/privacyErasure').ErasurePreview>('privacyPrepare')},
    privacyCancel:async()=>native<void>('privacyCancel'),
    privacyErase:async(ticket,confirmation)=>{if(backup.isBusy||activeOperations)throw Error('请先完成当前文件或网络操作，再清理资料');return request<{accepted:boolean}>('privacyErase',{ticket,confirmation})},
    modelStatus:()=>model.status(),modelSave:input=>model.save(input),modelClear:()=>model.clear(),
    backupExport:client=>backup.export(client),backupPrepare:()=>backup.prepare(),backupCancel:ticket=>backup.cancel(ticket),backupRestore:(ticket,confirmation,client)=>backup.restore(ticket,confirmation,client),
    backupClientRestore:async()=>db.readBackupClientRestore(),backupAcknowledgeRestore:async token=>db.ackBackupClientRestore(token),
    loadFocusRecovery:async()=>loadFocusRecovery(),saveFocusRecovery:async record=>saveFocusRecovery(record),clearFocusRecovery:async token=>clearFocusRecovery(token),
    syncStatus:async()=>lanSync.status(),syncEnable:value=>lanSync.enable(value),
    syncPairCode:async()=>{throw Error('请在电脑上生成配对码。')},syncPair:code=>lanSync.pair(code),
    syncNow:()=>lanSync.now(),syncUnpair:id=>lanSync.unpair(id),
    syncResolve:async(id,useOther)=>{db.syncEngine.resolve(id,useOther);changed();return lanSync.status()},
    syncBackup:async()=>db.syncEngine.exportBackup(),
    onSyncChanged:cb=>{window.addEventListener('xinhai-sync-changed',cb);return()=>window.removeEventListener('xinhai-sync-changed',cb)},
    neteaseShareResolve:async(input)=>{requireOnlineMusic();let next=playlistShare(input);for(let n=0;n<5;n++){if(next.id)return next.id;next=playlistShare(await request<string>('neteaseShareRedirect',{url:next.url}))}if(next.id)return next.id;throw Error('分享链接跳转过多，请复制完整歌单链接。')},
    neteaseLogin:async()=>{requireOnlineMusic();return request<void>('neteaseLogin')},neteaseLogout:async()=>{requireOnlineMusic();return request<void>('neteaseLogout')},neteaseRequest,neteaseResolve:async id=>{requireOnlineMusic();return cloudResolve(neteaseRequest,cloudId(id))},neteaseOpen:async id=>{requireOnlineMusic();return request<void>('neteaseOpen',{id:cloudId(id)})},
    growthResetInfo:async()=>db.growthResetInfo(),resetGrowth:async(c,scope)=>db.resetGrowth(c,scope),undoGrowthReset:async()=>db.undoGrowthReset(),
    getState:async()=>db.getState(),applyGrowth:async(items)=>db.applyGrowth(items as Parameters<typeof db.applyGrowth>[0]),
    commitFocus:async(s)=>db.commitFocus(s),todayFocusSeconds:async()=>db.todayFocusSeconds(),
    addFocusSession:async(s)=>db.addFocusSession(s as Parameters<typeof db.addFocusSession>[0]),
    addJournal:async(j)=>db.addJournal(j as Parameters<typeof db.addJournal>[0]),
    commitJournal:async(j)=>db.commitJournal(j),
    scoreJournal:async(text,mode)=>scoreJournal(text,model,{mode}),testLLM:async()=>testLLMConnection(model),
    listGrowth:async()=>db.listGrowth(),listJournals:async()=>db.listJournals(),listFocus:async()=>db.listFocusSessions(),
    updateSettings:async(patch)=>db.updateSettings(patch as Partial<Settings>),
    todosList:async()=>db.listTodos(),todosAdd:async(t)=>db.addTodo(t as Parameters<typeof db.addTodo>[0]),
    todosToggle:async(id)=>db.toggleTodo(id),todosDelete:async(id)=>db.deleteTodo(id),todosAddFocus:async(id,m)=>db.addTodoFocus(id,m),
    habitsList:async()=>db.listHabits(),habitsAdd:async(h)=>db.addHabit(h as Parameters<typeof db.addHabit>[0]),habitsLogs:async()=>db.listHabitLogs(),habitsPunch:async(id)=>db.punchHabit(id),
    habitsReorder:async(ids)=>db.reorderHabits(ids),habitsDelete:async(id)=>db.deleteHabit(id),habitsRestore:async(id)=>db.restoreHabit(id),
    eventsList:async()=>db.listEvents(),eventsAdd:async(e)=>db.addEvent(e as Parameters<typeof db.addEvent>[0]),eventsDelete:async(id)=>db.deleteEvent(id),calendarMonth:async(m)=>db.calendarMonth(m),
    exportJson:async()=>db.exportAll(),exportCsv:async()=>db.growthCsv(),saveFile:async(defaultName,content)=>request('saveFile',{defaultName,content}),
    reviewList:async()=>review.listReviews(),reviewSave:async(d)=>review.saveReview(d),reviewRate:async(d)=>review.rateReview(d),reviewArchive:async(d)=>review.archiveReview(d),
    knowledgeList:async()=>native<KnowledgeVault>('knowledgeList'),knowledgeSave:async(note)=>native<KnowledgeNote>('knowledgeSave',note),knowledgeCreate:async(title,initialContent,expectedRoot)=>native<KnowledgeNote>('knowledgeCreate',{title,initialContent,expectedRoot}),
    knowledgeChoose:async()=>request<KnowledgeVault|null>('knowledgeChoose'),knowledgeFolder:async()=>native<string>('knowledgeFolder'),knowledgeObsidian:async()=>native<void>('knowledgeObsidian'),
    musicList:async()=>listImportedMusic(),musicImport:async()=>importMusicFiles(),musicRemove:async(id)=>removeImportedMusic(id),
    backgroundImport:async()=>{if(db.getState().settings.wallpaperLibrary.length>=100)throw Error('壁纸收藏已达到 100 张，请先移除不需要的收藏');const custom=await request<Settings['customBackground']>('backgroundImport');return custom?themes.addWallpaper(custom):null},
    backgroundSelect:async id=>themes.selectWallpaper(id),backgroundRename:async(id,name)=>themes.renameWallpaper(id,name),backgroundRemove:async id=>themes.removeWallpaper(id),
    themeSave:async name=>themes.saveTheme(name),themeApply:async id=>themes.applyTheme(id),themeRename:async(id,name)=>themes.renameTheme(id,name),themeRemove:async id=>themes.removeTheme(id),
    themeExport:async id=>{const value=themes.exportTheme(id);return request<string|null>('themeExport',{manifest:value.manifest,wallpaperSrc:value.wallpaper?.src??null})},
    themeImport:async()=>{
      const result=await request<ThemeImportResult|null>('themeImport');if(!result)return null
      let keep=false
      try{const settings=themes.importTheme(result.manifest,result.wallpaper);keep=true;return settings}
      finally{if(result.receipt)native<void>('themeImportFinish',{receipt:result.receipt,keep})}
    },
    onRemoteGrowth:()=>()=>{},winMinimize:()=>{},winMaximize:()=>{},winClose:()=>native<void>('close')
  }
  window.api=new Proxy(api,{get(target,property,receiver){
    const value=Reflect.get(target,property,receiver)
    if(typeof value!=='function')return value
    return (...args:unknown[])=>{
      if(backup.isRestoring&&!String(property).startsWith('backup'))return Promise.reject(Error('正在恢复资料，请等待完成后再操作'))
      const result=value(...args)
      if(result&&typeof result.then==='function'){activeOperations++;return Promise.resolve(result).finally(()=>{activeOperations--})}
      return result
    }
  }})
  document.documentElement.classList.add('android-app')
}
