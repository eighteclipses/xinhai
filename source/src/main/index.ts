import {createLanSyncServer} from './lanSyncServer'
import { createFocusReminder } from './focusReminder'
import {neteaseLogin,neteaseLogout,neteaseRequest,neteaseResolve,neteaseShareResolve} from './netease'
import {cloudId} from '../shared/netease'
import { PERSONAL_EDITION, COMMERCIAL_EDITION, ONLINE_MUSIC_ENABLED } from '../shared/edition'
import { requireOnlineMusic } from '../shared/onlineMusic'
import { protectMainWindow, trustedIpc } from './windowSecurity'
import { createRuntimeNoticeReader } from './runtimeNotices'
import { importBackground } from './background'
import * as themes from './themeLibrary'
import { exportThemeFile, importThemeFile, finishThemeImport } from './themeFiles'
import { loadFocusRecovery, saveFocusRecovery, clearFocusRecovery } from './focusRecovery'
import { createBackupController } from '../shared/backupController'
import { createModelService } from './modelService'
import { createPersonalClientStateStore } from './personalClientState'
import { createErasureRequest, finishPendingErasure } from './privacyErasure'
import { exportArchive, prepareArchive, finishArchive, verifyArchive } from './backupFiles'
import { listImportedMusic, importMusicFiles, removeImportedMusic, importMusicFolder, musicFolder, musicStorageInfo, undoMusicRemoval, clearMusicUndo } from './music'
import { listReviews, saveReview, rateReview, archiveReview } from './review'
import { knowledgeRoot, selectKnowledgeRoot, listKnowledge, saveKnowledge, createKnowledge, renameKnowledge, deleteKnowledge, setKnowledgeCategory } from './knowledge'
import * as learningCategories from './learningCategories'
import { app, shell, BrowserWindow, dialog, Notification } from 'electron'
import { join, isAbsolute, parse } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import {
  initDb, syncEngine,
  createAppDurableClientStateStore,
  captureBackupState, restoreBackupState, readBackupClientRestore, ackBackupClientRestore,
  readLegacyModelSettings, clearLegacyModelKey, savePublicModelSettings,
  growthResetInfo, resetGrowth, undoGrowthReset,
  reorderHabits, deleteHabit, restoreHabit,
  calendarMonth,
  getState,
  applyGrowth,
  addFocusSession,
  commitFocus,
  todayFocusSeconds,
  focusRewardState,
  focusRewardPresentation,
  ackFocusRewards,
  addJournal,
  commitJournal,
  deleteJournal,
  listGrowth,
  growthSummary,
  listJournals,
  listJournalPage,
  listFocusSessions,
  focusTaskSummary,
  updateSettings,
  exportAll,
  growthCsv,
  listTodos,
  addTodo,
  updateTodo,
  toggleTodo,
  deleteTodo,
  addTodoFocus,
  listHabits,
  addHabit,
  updateHabit,
  listHabitLogs,
  punchHabit,
  listEvents,
  addEvent,
  updateEvent,
  deleteEvent
} from './db'
import { scoreJournal, testLLMConnection } from './scoring'
import { startSnapshotServer } from './snapshot'
import type { DimensionId, GrowthSource, Settings } from '../shared/types'

let mainWindow: BrowserWindow | null = null
const rendererFile = join(__dirname, '../renderer/index.html')
const rendererDevUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const rendererUrl = rendererDevUrl || pathToFileURL(rendererFile).href
let backup:ReturnType<typeof createBackupController>|undefined
let erasureScheduled=false
let activeOperations=0
const baseIpc = trustedIpc(() => mainWindow, COMMERCIAL_EDITION, rendererUrl)
const applicationIpc:typeof baseIpc={...baseIpc,handle(channel,listener){baseIpc.handle(channel,(event,...args)=>{
  if(erasureScheduled)throw Error('已确认清理，正在关闭应用；清理将在重新启动时完成')
  if(backup?.isRestoring&&!channel.startsWith('backup:'))throw Error('正在恢复资料，请等待完成后再操作')
  const result=listener(event,...args)
  if(result&&typeof result.then==='function'){activeOperations++;return Promise.resolve(result).finally(()=>{activeOperations--})}
  return result
})}}
const profileRoot = app.commandLine.getSwitchValue('xinhai-profile-root')
if (profileRoot) {
  if (!isAbsolute(profileRoot) || parse(profileRoot).root === profileRoot) throw new Error('独立资料目录必须是绝对路径下的文件夹')
  mkdirSync(join(profileRoot, 'documents'), { recursive: true })
  mkdirSync(join(profileRoot, 'crash-dumps'), { recursive: true })
  app.setPath('appData', profileRoot)
  app.setPath('documents', join(profileRoot, 'documents'))
  app.setPath('crashDumps', join(profileRoot, 'crash-dumps'))
}

// The public source build never discovers an existing personal profile.
app.setName('xinhai-source')
const sourceProfile = join(app.getPath('appData'), 'xinhai-source')
mkdirSync(sourceProfile, { recursive: true })
app.setPath('userData', sourceProfile)
app.setPath('sessionData', sourceProfile)

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    frame: false,
    title: '心海共学 · 源码版',
    icon: join(__dirname, '../renderer/design/app-icon.png'),
    backgroundColor: '#101010',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: COMMERCIAL_EDITION,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => { if (!(profileRoot && app.commandLine.hasSwitch('xinhai-start-hidden'))) mainWindow?.show() })

  if (COMMERCIAL_EDITION) protectMainWindow(mainWindow, rendererUrl)
  else mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (rendererDevUrl) {
    mainWindow.loadURL(rendererDevUrl)
  } else {
    mainWindow.loadFile(rendererFile)
  }
}

const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) app.quit()
else app.whenReady().then(async () => {
  app.on('second-instance', () => {
    if(mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.show();mainWindow?.focus()
  })
  electronApp.setAppUserModelId('com.xinhai.source')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  initDb()
  const focusReminder=createFocusReminder(()=>{if(mainWindow?.isMinimized())mainWindow.restore();mainWindow?.show();mainWindow?.focus()})
  applicationIpc.handle('focus:reminder',(_event,input)=>focusReminder(input))
  applicationIpc.handle('focus:reminder:status',()=>({platform:'desktop',notificationsGranted:Notification.isSupported(),exactAlarmsGranted:true,canRequestExactAlarms:false}))
  applicationIpc.handle('focus:reminder:access',()=>{throw Error('电脑端提醒由系统通知设置管理。')})
  const personalClientState=PERSONAL_EDITION?createPersonalClientStateStore(app.getPath('userData')):undefined
  const clientState=COMMERCIAL_EDITION?createAppDurableClientStateStore():personalClientState
  if(personalClientState)app.once('will-quit',()=>personalClientState.close())
  const model=createModelService({directory:app.getPath('userData'),readLegacy:readLegacyModelSettings,clearLegacy:clearLegacyModelKey,savePublic:savePublicModelSettings})
  await model.status() // Migration errors become status messages; offline UI still starts.
  if(COMMERCIAL_EDITION) {
    const readRuntimeNotice=createRuntimeNoticeReader(join(__dirname,'../renderer/runtime-notices'))
    applicationIpc.handle('notices:read-runtime',(_event,id:unknown)=>readRuntimeNotice(id))
  }
  applicationIpc.handle('model:status',()=>model.status())
  applicationIpc.handle('model:save',(_e,input)=>model.save(input))
  applicationIpc.handle('model:clear',()=>model.clear())
  const changed=()=>mainWindow?.webContents.send('sync:changed')
  let lanSync=createLanSyncServer(syncEngine,changed)
  const erasure=createErasureRequest(app.getPath('userData'),()=>getState().settings.knowledgePath||join(app.getPath('documents'),'心海学习库-源码版'))
  applicationIpc.handle('privacy:prepare',()=>{if(!COMMERCIAL_EDITION)throw Error('此操作仅用于独立商业版');if(backup?.isBusy)throw Error('请先完成当前备份操作');return erasure.prepare()})
  applicationIpc.handle('privacy:cancel',()=>erasure.cancel())
  applicationIpc.handle('privacy:erase',(_e,ticket:string,confirmation:string)=>{
    if(!COMMERCIAL_EDITION)throw Error('此操作仅用于独立商业版')
    if(backup?.isBusy||activeOperations)throw Error('请先完成当前文件或网络操作，再清理资料')
    erasure.schedule(ticket,confirmation);erasureScheduled=true;lanSync.stop()
    try{app.relaunch()}finally{setTimeout(()=>app.exit(0),150)}
    return {accepted:true}
  })
  backup=createBackupController({
    capture:captureBackupState,
    context:async()=>({knowledgeRoot:knowledgeRoot()}),
    export:async(portable,root,safety)=>{
      if(!mainWindow)return null
      const chosen=await dialog.showSaveDialog(mainWindow,{title:safety?'先保存当前资料的安全副本':'导出完整备份',defaultPath:`心海-${safety?'恢复前安全副本':'完整备份'}-${new Date().toISOString().slice(0,10)}.xinhai-backup`,filters:[{name:'心海完整备份',extensions:['xinhai-backup']}]})
      if(chosen.canceled||!chosen.filePath)return null
      return exportArchive(chosen.filePath,portable,root)
    },
    prepare:async()=>{
      if(!mainWindow)return null
      const chosen=await dialog.showOpenDialog(mainWindow,{title:'选择完整备份并预览',properties:['openFile'],filters:[{name:'心海完整备份',extensions:['xinhai-backup','zip']}]})
      return chosen.canceled||!chosen.filePaths[0]?null:prepareArchive(chosen.filePaths[0])
    },
    finish:finishArchive,verify:verifyArchive,
    hasActiveFocus:()=>!!loadFocusRecovery().record,
    pauseSync:async()=>{const enabled=lanSync.status().enabled;lanSync.stop();return async()=>{await lanSync.enable(enabled)}},
    replace:(snapshot,prepared)=>{restoreBackupState(snapshot,prepared.resources);clearMusicUndo()},
    resetSync:()=>{lanSync.stop();lanSync=createLanSyncServer(syncEngine,changed)}
  })
  if(clientState){
    // The new personal mirror is also restricted to the application's main document.
    trustedIpc(()=>mainWindow,true,rendererUrl).syncHandler('client-state:sync',(_event,request:unknown)=>{
      if(erasureScheduled)throw Error('已确认清理，正在关闭应用；清理将在重新启动时完成')
      if(backup?.isRestoring)throw Error('正在恢复资料，请等待完成后再操作')
      return clientState.handle(request)
    })
  }
  applicationIpc.handle('backup:export',(_e,client:Record<string,string>)=>backup!.export(client))
  applicationIpc.handle('backup:prepare',()=>backup!.prepare())
  applicationIpc.handle('backup:cancel',(_e,ticket:string)=>backup!.cancel(ticket))
  applicationIpc.handle('backup:restore',(_e,ticket:string,confirmation:string,client:Record<string,string>)=>backup!.restore(ticket,confirmation,client))
  applicationIpc.handle('backup:client-state',()=>readBackupClientRestore())
  applicationIpc.handle('backup:acknowledge',(_e,token:string)=>ackBackupClientRestore(token))
  app.on('before-quit',()=>lanSync.stop())
  applicationIpc.handle('sync:status',()=>lanSync.status())
  applicationIpc.handle('sync:enable',(_e,value:boolean)=>lanSync.enable(value))
  applicationIpc.handle('sync:pairCode',()=>lanSync.pairCode())
  applicationIpc.handle('sync:pair',()=>{throw Error('请在平板输入电脑生成的配对码。')})
  applicationIpc.handle('sync:now',()=>lanSync.now())
  applicationIpc.handle('sync:unpair',(_e,id:string)=>lanSync.unpair(id))
  applicationIpc.handle('sync:resolve',(_e,id:string,useOther:boolean)=>{syncEngine.resolve(id,useOther);changed();return lanSync.status()})
  applicationIpc.handle('sync:backup',()=>syncEngine.exportBackup())

  applicationIpc.handle('knowledge:list', () => listKnowledge())
  applicationIpc.handle('knowledge:save', (_e, note) => saveKnowledge(note))
  applicationIpc.handle('knowledge:create', (_e, title:string, initialContent?:string, expectedRoot?:string) => createKnowledge(title,initialContent,expectedRoot))
  applicationIpc.handle('knowledge:rename', (_e, input) => renameKnowledge(input))
  applicationIpc.handle('knowledge:delete', (_e, input) => deleteKnowledge(input))
  applicationIpc.handle('knowledge:set-category', (_e, input) => setKnowledgeCategory(input))
  applicationIpc.handle('categories:list', () => learningCategories.listLearningCategories())
  applicationIpc.handle('categories:save', (_e, input) => learningCategories.saveLearningCategory(input))
  applicationIpc.handle('categories:reorder', (_e, ids) => learningCategories.reorderLearningCategories(ids))
  applicationIpc.handle('categories:archive', (_e, input) => learningCategories.archiveLearningCategory(input))
  applicationIpc.handle('categories:summary', () => learningCategories.learningCategorySummary())
  applicationIpc.handle('categories:set-record', (_e, input) => learningCategories.setLearningRecordCategory(input))
  applicationIpc.handle('knowledge:folder', () => shell.openPath(knowledgeRoot()))
  applicationIpc.handle('knowledge:obsidian', () => shell.openExternal('obsidian://open?path='+encodeURIComponent(knowledgeRoot())))
  applicationIpc.handle('knowledge:choose', async () => {
    if(!mainWindow)return null
    const result=await dialog.showOpenDialog(mainWindow,{title:'选择个人学习库 / Obsidian 仓库',properties:['openDirectory','createDirectory']})
    if(result.canceled)return null
    selectKnowledgeRoot(result.filePaths[0]);return listKnowledge()
  })
  applicationIpc.handle('background:import',async()=>{
    if(!mainWindow)return null
    if(getState().settings.wallpaperLibrary.length>=100)throw Error('壁纸收藏已达到 100 张，请先移除不需要的收藏')
    const result=await dialog.showOpenDialog(mainWindow,{title:'选择自定义背景',properties:['openFile'],filters:[{name:'背景图片或视频',extensions:['png','jpg','jpeg','webp','mp4','webm']}]})
    return result.canceled?null:importBackground(result.filePaths[0])
  })
  applicationIpc.handle('background:select',(_event,id:string)=>themes.selectWallpaper(id))
  applicationIpc.handle('background:rename',(_event,id:string,name:string)=>themes.renameWallpaper(id,name))
  applicationIpc.handle('background:remove',(_event,id:string)=>themes.removeWallpaper(id))
  applicationIpc.handle('theme:save',(_event,name:string)=>themes.saveTheme(name))
  applicationIpc.handle('theme:apply',(_event,id:string)=>themes.applyTheme(id))
  applicationIpc.handle('theme:rename',(_event,id:string,name:string)=>themes.renameTheme(id,name))
  applicationIpc.handle('theme:remove',(_event,id:string)=>themes.removeTheme(id))
  applicationIpc.handle('theme:export',async(_event,id:string)=>{
    if(!mainWindow)return null
    const value=themes.exportTheme(id)
    let name=value.manifest.name.replace(/[\\/:*?"<>|]/g,'-').replace(/[. ]+$/g,'')||'我的主题'
    if(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name))name='_'+name
    const chosen=await dialog.showSaveDialog(mainWindow,{title:'导出个人主题',defaultPath:name+'.xinhai-theme',filters:[{name:'心海主题包',extensions:['xinhai-theme']}]})
    if(chosen.canceled||!chosen.filePath)return null
    await exportThemeFile(chosen.filePath,value.manifest,value.wallpaper)
    return chosen.filePath
  })
  applicationIpc.handle('theme:import',async()=>{
    if(!mainWindow)return null
    const chosen=await dialog.showOpenDialog(mainWindow,{title:'导入个人主题',properties:['openFile'],filters:[{name:'心海主题包',extensions:['xinhai-theme','zip']}]})
    if(chosen.canceled||!chosen.filePaths[0])return null
    const imported=await importThemeFile(chosen.filePaths[0]);let keep=false
    try{const settings=themes.importTheme(imported.manifest,imported.wallpaper);keep=true;return settings}
    finally{if(imported.receipt)await finishThemeImport(imported.receipt,keep)}
  })
  if(ONLINE_MUSIC_ENABLED){
    applicationIpc.handle('netease:share',(_e,input:string)=>neteaseShareResolve(input))
    applicationIpc.handle('netease:login',()=>neteaseLogin())
    applicationIpc.handle('netease:logout',()=>neteaseLogout())
    applicationIpc.handle('netease:request',(_e,path:string)=>neteaseRequest(path))
    applicationIpc.handle('netease:resolve',(_e,id:string)=>neteaseResolve(id))
    applicationIpc.handle('netease:open',(_e,id:string)=>shell.openExternal('https://music.163.com/#/song?id='+cloudId(id)))
  }else for(const method of ['share','login','logout','request','resolve','open'])applicationIpc.handle('netease:'+method,()=>requireOnlineMusic())
  applicationIpc.handle('music:clear-online-data',()=>neteaseLogout())
  applicationIpc.handle('music:list' ,()=>listImportedMusic())
  applicationIpc.handle('music:remove',(_e,id:string)=>removeImportedMusic(id))
  applicationIpc.handle('music:undo-remove',(_e,id:string)=>undoMusicRemoval(id))
  applicationIpc.handle('music:storage-info',()=>musicStorageInfo())
  applicationIpc.handle('music:open-folder',async()=>{
    const folder=musicFolder();mkdirSync(folder,{recursive:true})
    const error=await shell.openPath(folder)
    if(error)throw Error('无法打开音乐文件夹，请稍后重试。')
  })
  applicationIpc.handle('music:import-folder',async()=>{
    if(!mainWindow)return {added:0,skipped:0,tracks:listImportedMusic(),cancelled:true}
    const result=await dialog.showOpenDialog(mainWindow,{title:'选择音乐文件夹（仅添加这一层的音频）',properties:['openDirectory']})
    return result.canceled?{added:0,skipped:0,tracks:listImportedMusic(),cancelled:true}:importMusicFolder(result.filePaths[0])
  })
  applicationIpc.handle('music:import',async()=>{
    if(!mainWindow)return {added:0,skipped:0,tracks:listImportedMusic(),cancelled:true}
    const result=await dialog.showOpenDialog(mainWindow,{title:'导入本地音乐',properties:['openFile','multiSelections'],filters:[{name:'音频文件',extensions:['mp3','ogg','wav','flac','m4a','aac','opus']}]})
    return result.canceled?{added:0,skipped:0,tracks:listImportedMusic(),cancelled:true}:importMusicFiles(result.filePaths)
  })
  applicationIpc.handle('review:list', () => listReviews())
  applicationIpc.handle('review:save', (_e, input) => saveReview(input))
  applicationIpc.handle('review:rate', (_e, input) => rateReview(input))
  applicationIpc.handle('review:archive', (_e, input) => archiveReview(input))
  applicationIpc.handle('state:get' , () => getState())
  applicationIpc.handle('growth:resetInfo', () => growthResetInfo())
  applicationIpc.handle('growth:reset', (_e, confirmation:string,scope:import('../shared/types').DataResetScope) => resetGrowth(confirmation,scope))
  applicationIpc.handle('growth:undoReset', () => undoGrowthReset())
  applicationIpc.handle('growth:apply', (_e, items: Array<{ dimension: DimensionId; points: number; source: GrowthSource; reason: string }>) =>
    applyGrowth(items)
  )
  applicationIpc.handle('focus:commit', (_e, s) => commitFocus(s))
  applicationIpc.handle('focus:rewards:state',()=>focusRewardState())
  applicationIpc.handle('focus:rewards:presentation',()=>focusRewardPresentation())
  applicationIpc.handle('focus:rewards:ack',(_e,token,blockIds)=>ackFocusRewards(token,blockIds))
  applicationIpc.handle('focus:recovery:load', () => loadFocusRecovery())
  applicationIpc.handle('focus:recovery:save', (_e, value) => saveFocusRecovery(value))
  applicationIpc.handle('focus:recovery:clear', (_e, token?:string) => clearFocusRecovery(token))
  applicationIpc.handle('focus:today', () => todayFocusSeconds())
  applicationIpc.handle('focus:add', (_e, s) => addFocusSession(s))
  applicationIpc.handle('journal:add', (_e, j) => addJournal(j))
  applicationIpc.handle('journal:commit', (_e, j) => commitJournal(j))
  applicationIpc.handle('journal:delete', (_e, id:number, expectedTs:number, confirmation:string) => deleteJournal(id,expectedTs,confirmation))
  applicationIpc.handle('llm:test',()=>testLLMConnection(model))
  applicationIpc.handle('journal:score', (_e, text: string, mode?:import('../shared/modelConfig').JournalAnalysisMode) => scoreJournal(text, model, {mode}))
  applicationIpc.handle('growth:list', () => listGrowth())
  applicationIpc.handle('growth:summary', () => growthSummary())
  applicationIpc.handle('journals:list', () => listJournals())
  applicationIpc.handle('journals:page', (_e, input) => listJournalPage(input))
  applicationIpc.handle('focus:list', () => listFocusSessions())
  applicationIpc.handle('focus:task-summary', () => focusTaskSummary())
  applicationIpc.handle('settings:update', (_e, patch: Partial<Settings>) => updateSettings(patch))
  applicationIpc.handle('todos:list', () => listTodos())
  applicationIpc.handle('todos:add', (_e, t) => addTodo(t))
  applicationIpc.handle('todos:update', (_e, input) => { updateTodo(input); changed() })
  applicationIpc.handle('todos:toggle', (_e, id: number) => toggleTodo(id))
  applicationIpc.handle('todos:delete', (_e, id: number) => deleteTodo(id))
  applicationIpc.handle('todos:addFocus', (_e, id: number, minutes: number) => addTodoFocus(id, minutes))
  applicationIpc.handle('habits:reorder',(_e,ids:number[])=>reorderHabits(ids))
  applicationIpc.handle('habits:delete',(_e,id:number)=>deleteHabit(id))
  applicationIpc.handle('habits:restore',(_e,id:number)=>restoreHabit(id))
  applicationIpc.handle('habits:list', () => listHabits())
  applicationIpc.handle('habits:add', (_e, h) => addHabit(h))
  applicationIpc.handle('habits:update', (_e, input) => { updateHabit(input); changed() })
  applicationIpc.handle('habits:logs', () => listHabitLogs())
  applicationIpc.handle('habits:punch', (_e, id: number) => punchHabit(id))
  applicationIpc.handle('calendar:month', (_e, month:string) => calendarMonth(month))
  applicationIpc.handle('events:list', () => listEvents())
  applicationIpc.handle('events:add', (_e, e) => addEvent(e))
  applicationIpc.handle('events:update', (_e, input) => { updateEvent(input); changed() })
  applicationIpc.handle('events:delete', (_e, id: number, confirmation?:string) => { deleteEvent(id, confirmation); changed() })
  applicationIpc.handle('export:json', () => exportAll())
  applicationIpc.handle('export:csv', () => growthCsv())
  applicationIpc.handle('dialog:save', async (_e, defaultName: string, content: string) => {
    if (!mainWindow) return null
    const res = await dialog.showSaveDialog(mainWindow, { defaultPath: defaultName })
    if (res.canceled || !res.filePath) return null
    const { writeFile } = await import('node:fs/promises')
    await writeFile(res.filePath, content, 'utf-8')
    return res.filePath
  })

  applicationIpc.on('win:minimize', () => mainWindow?.minimize())
  applicationIpc.on('win:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  applicationIpc.on('win:close', () => mainWindow?.close())

  createWindow()
  if(PERSONAL_EDITION)startSnapshotServer(() => mainWindow,model)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
