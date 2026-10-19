import type {SyncStatus} from '../shared/lanSyncTypes'
import { contextBridge, ipcRenderer } from 'electron'
import { COMMERCIAL_EDITION, PERSONAL_EDITION } from '../shared/edition'
import type { ClientStateSyncRequest, ClientStateSyncResult } from '../shared/clientState'

import type { ReviewCard, ReviewDraft, ReviewRating } from '../shared/types'
const api = {
  learningCategoriesList:():Promise<import('../shared/learningCategories').LearningCategory[]>=>ipcRenderer.invoke('categories:list'),
  learningCategorySave:(input:import('../shared/learningCategories').LearningCategoryInput):Promise<import('../shared/learningCategories').LearningCategory>=>ipcRenderer.invoke('categories:save',input),
  learningCategoriesReorder:(ids:string[]):Promise<void>=>ipcRenderer.invoke('categories:reorder',ids),
  learningCategoryArchive:(input:{id:string;archived:boolean}):Promise<void>=>ipcRenderer.invoke('categories:archive',input),
  learningCategorySummary:():Promise<import('../shared/learningCategories').LearningCategorySummary[]>=>ipcRenderer.invoke('categories:summary'),
  learningRecordCategorySet:(input:import('../shared/learningCategories').LearningRecordCategoryInput):Promise<void>=>ipcRenderer.invoke('categories:set-record',input),
  knowledgeSetCategory:(input:import('../shared/knowledgeCategories').KnowledgeCategoryInput):Promise<import('../shared/types').KnowledgeNote>=>ipcRenderer.invoke('knowledge:set-category',input),
  ...(COMMERCIAL_EDITION ? {readRuntimeNotice:(id:string):Promise<string>=>ipcRenderer.invoke('notices:read-runtime',id)} : {}),
  ...(COMMERCIAL_EDITION||PERSONAL_EDITION ? {clientStateSync:(request:ClientStateSyncRequest):Record<string,string>|null=>{
    const reply=ipcRenderer.sendSync('client-state:sync',request) as unknown
    if(!reply||typeof reply!=='object'||Array.isArray(reply))throw Error('本机客户端状态服务没有返回结果')
    const result=reply as ClientStateSyncResult
    if(!result.ok)throw Error(typeof result.error==='string'&&result.error?result.error:'本机客户端状态提交失败')
    if(!Object.hasOwn(result,'value'))throw Error('本机客户端状态响应无效')
    return result.value
  }} : {}),
  clearOnlineMusicData:():Promise<void>=>ipcRenderer.invoke('music:clear-online-data'),
  privacyPrepare:():Promise<import('../shared/privacyErasure').ErasurePreview>=>ipcRenderer.invoke('privacy:prepare'),
  privacyCancel:():Promise<void>=>ipcRenderer.invoke('privacy:cancel'),
  privacyErase:(ticket:string,confirmation:string):Promise<{accepted:boolean}>=>ipcRenderer.invoke('privacy:erase',ticket,confirmation),
  modelStatus:():Promise<import('../shared/modelConfig').ModelStatus>=>ipcRenderer.invoke('model:status'),
  modelSave:(input:import('../shared/modelConfig').ModelSaveInput):Promise<import('../shared/modelConfig').ModelStatus>=>ipcRenderer.invoke('model:save',input),
  modelClear:():Promise<import('../shared/modelConfig').ModelStatus>=>ipcRenderer.invoke('model:clear'),
  backupExport:(client:Record<string,string>):Promise<string|null>=>ipcRenderer.invoke('backup:export',client),
  backupPrepare:():Promise<import('../shared/backupArchiveTypes').BackupPreview|null>=>ipcRenderer.invoke('backup:prepare'),
  backupCancel:(ticket:string):Promise<void>=>ipcRenderer.invoke('backup:cancel',ticket),
  backupRestore:(ticket:string,confirmation:string,client:Record<string,string>):Promise<import('../shared/backupArchiveTypes').BackupRestoreResult|null>=>ipcRenderer.invoke('backup:restore',ticket,confirmation,client),
  backupClientRestore:():Promise<{token:string;state:Record<string,string>}|null>=>ipcRenderer.invoke('backup:client-state'),
  backupAcknowledgeRestore:(token:string):Promise<void>=>ipcRenderer.invoke('backup:acknowledge',token),
  loadFocusRecovery:():Promise<import('../shared/focusRecovery').FocusRecoveryLoad>=>ipcRenderer.invoke('focus:recovery:load'),
  focusReminder:(input:import('../shared/focusReminder').FocusReminderInput|null):Promise<void>=>ipcRenderer.invoke('focus:reminder',input),
  focusReminderStatus:():Promise<import('../shared/focusReminderCapability').FocusReminderCapability>=>ipcRenderer.invoke('focus:reminder:status'),
  focusReminderRequestAccess:(access:import('../shared/focusReminderCapability').FocusReminderAccess):Promise<void>=>ipcRenderer.invoke('focus:reminder:access',access),
  saveFocusRecovery:(record:import('../shared/focusRecovery').FocusRecoveryRecord):Promise<void>=>ipcRenderer.invoke('focus:recovery:save',record),
  clearFocusRecovery:(token?:string):Promise<void>=>ipcRenderer.invoke('focus:recovery:clear',token),
  syncStatus:():Promise<SyncStatus>=>ipcRenderer.invoke('sync:status'),
  syncEnable:(enabled:boolean):Promise<SyncStatus>=>ipcRenderer.invoke('sync:enable',enabled),
  syncPairCode:():Promise<{code:string;expiresAt:number}>=>ipcRenderer.invoke('sync:pairCode'),
  syncPair:(code:string):Promise<SyncStatus>=>ipcRenderer.invoke('sync:pair',code),
  syncNow:():Promise<SyncStatus>=>ipcRenderer.invoke('sync:now'),
  syncUnpair:(id:string):Promise<SyncStatus>=>ipcRenderer.invoke('sync:unpair',id),
  syncResolve:(id:string,useOther:boolean):Promise<SyncStatus>=>ipcRenderer.invoke('sync:resolve',id,useOther),
  syncBackup:():Promise<string>=>ipcRenderer.invoke('sync:backup'),
  onSyncChanged:(cb:()=>void)=>{const listener=()=>cb();ipcRenderer.on('sync:changed',listener);return()=>{ipcRenderer.removeListener('sync:changed',listener)}},
  neteaseShareResolve:(input:string):Promise<string>=>ipcRenderer.invoke('netease:share',input),
  neteaseLogin:():Promise<void>=>ipcRenderer.invoke('netease:login'),
  neteaseLogout:():Promise<void>=>ipcRenderer.invoke('netease:logout'),
  neteaseRequest:(path:string):Promise<any>=>ipcRenderer.invoke('netease:request',path),
  neteaseResolve:(id:string):Promise<string>=>ipcRenderer.invoke('netease:resolve',id),
  neteaseOpen:(id:string):Promise<void>=>ipcRenderer.invoke('netease:open',id),
  growthResetInfo: ():Promise<import('../shared/types').GrowthResetInfo> => ipcRenderer.invoke('growth:resetInfo'),
  resetGrowth: (confirmation:string,scope:import('../shared/types').DataResetScope='growth'):Promise<import('../shared/types').AppState> => ipcRenderer.invoke('growth:reset',confirmation,scope),
  undoGrowthReset: ():Promise<import('../shared/types').AppState> => ipcRenderer.invoke('growth:undoReset'),
  habitsReorder:(ids:number[]):Promise<void>=>ipcRenderer.invoke('habits:reorder',ids),
  habitsDelete:(id:number):Promise<void>=>ipcRenderer.invoke('habits:delete',id),
  habitsRestore:(id:number):Promise<void>=>ipcRenderer.invoke('habits:restore',id),
  backgroundImport: ():Promise<import('../shared/types').Settings|null> => ipcRenderer.invoke('background:import'),
  backgroundSelect: (id:string):Promise<import('../shared/types').Settings> => ipcRenderer.invoke('background:select',id),
  backgroundRename: (id:string,name:string):Promise<import('../shared/types').Settings> => ipcRenderer.invoke('background:rename',id,name),
  backgroundRemove: (id:string):Promise<import('../shared/types').Settings> => ipcRenderer.invoke('background:remove',id),
  themeSave: (name:string):Promise<import('../shared/types').Settings> => ipcRenderer.invoke('theme:save',name),
  themeApply: (id:string):Promise<import('../shared/types').Settings> => ipcRenderer.invoke('theme:apply',id),
  themeRename: (id:string,name:string):Promise<import('../shared/types').Settings> => ipcRenderer.invoke('theme:rename',id,name),
  themeRemove: (id:string):Promise<import('../shared/types').Settings> => ipcRenderer.invoke('theme:remove',id),
  themeImport: ():Promise<import('../shared/types').Settings|null> => ipcRenderer.invoke('theme:import'),
  themeExport: (id:string):Promise<string|null> => ipcRenderer.invoke('theme:export',id),
  calendarMonth: (month:string):Promise<import('../shared/types').CalendarEntry[]> => ipcRenderer.invoke('calendar:month',month),
  testLLM: ():Promise<{ok:boolean;message:string;model?:string;elapsedMs:number}> => ipcRenderer.invoke('llm:test'),
  musicList: ():Promise<import('../main/music').ImportedTrack[]> => ipcRenderer.invoke('music:list'),
  musicImport: ():Promise<{added:number;skipped:number;tracks:import('../main/music').ImportedTrack[]}> => ipcRenderer.invoke('music:import'),
  musicRemove: (id:string):Promise<import('../main/music').ImportedTrack[]> => ipcRenderer.invoke('music:remove',id),
  reviewList: ():Promise<ReviewCard[]> => ipcRenderer.invoke('review:list'),
  reviewSave: (input:ReviewDraft):Promise<ReviewCard> => ipcRenderer.invoke('review:save',input),
  reviewRate: (input:{id:string;version:number;rating:ReviewRating;token:string}):Promise<ReviewCard> => ipcRenderer.invoke('review:rate',input),
  reviewArchive: (input:{id:string;version:number;archived:boolean}):Promise<ReviewCard> => ipcRenderer.invoke('review:archive',input),
  knowledgeList: ():Promise<import('../shared/types').KnowledgeVault> => ipcRenderer.invoke('knowledge:list'),
  knowledgeSave: (note:{path:string;content:string;revision:string|null}):Promise<import('../shared/types').KnowledgeNote> => ipcRenderer.invoke('knowledge:save',note),
  knowledgeCreate: (title:string,initialContent?:string,expectedRoot?:string):Promise<import('../shared/types').KnowledgeNote> => ipcRenderer.invoke('knowledge:create',title,initialContent,expectedRoot),
  knowledgeRename: (input:import('../shared/types').KnowledgeNoteTarget&{title:string}):Promise<import('../shared/types').KnowledgeNote> => ipcRenderer.invoke('knowledge:rename',input),
  knowledgeDelete: (input:import('../shared/types').KnowledgeNoteTarget&{confirmation:string}):Promise<void> => ipcRenderer.invoke('knowledge:delete',input),
  knowledgeChoose: ():Promise<import('../shared/types').KnowledgeVault|null> => ipcRenderer.invoke('knowledge:choose'),
  knowledgeFolder: ():Promise<string> => ipcRenderer.invoke('knowledge:folder'),
  knowledgeObsidian: ():Promise<void> => ipcRenderer.invoke('knowledge:obsidian'),
  getState: () => ipcRenderer.invoke('state:get'),
  applyGrowth: (items: unknown) => ipcRenderer.invoke('growth:apply', items),
  commitFocus: (s: import('../shared/types').FocusCommitInput): Promise<import('../shared/types').FocusCommitResult> => ipcRenderer.invoke('focus:commit', s),
  focusRewardState: ():Promise<import('../shared/types').FocusRewardState> => ipcRenderer.invoke('focus:rewards:state'),
  focusRewardPresentation: ():Promise<import('../shared/types').FocusRewardPresentation> => ipcRenderer.invoke('focus:rewards:presentation'),
  ackFocusRewards: (token:string,blockIds:string[]):Promise<void> => ipcRenderer.invoke('focus:rewards:ack',token,blockIds),
  todayFocusSeconds: (): Promise<number> => ipcRenderer.invoke('focus:today'),
  addFocusSession: (s: unknown) => ipcRenderer.invoke('focus:add', s),
  addJournal: (j: unknown) => ipcRenderer.invoke('journal:add', j),
  commitJournal: (j: import('../shared/types').JournalCommitInput): Promise<import('../shared/types').JournalCommitResult> => ipcRenderer.invoke('journal:commit', j),
  deleteJournal: (id:number,expectedTs:number,confirmation:string):Promise<boolean> => ipcRenderer.invoke('journal:delete',id,expectedTs,confirmation),
  scoreJournal: (text: string, mode?:import('../shared/modelConfig').JournalAnalysisMode) => ipcRenderer.invoke('journal:score', text, mode),
  listGrowth: () => ipcRenderer.invoke('growth:list'),
  growthSummary: ():Promise<import('../shared/types').GrowthSummary> => ipcRenderer.invoke('growth:summary'),
  listJournals: () => ipcRenderer.invoke('journals:list'),
  listJournalPage: (input?:import('../shared/types').JournalPageQuery):Promise<import('../shared/types').JournalPage> => ipcRenderer.invoke('journals:page', input),
  listFocus: () => ipcRenderer.invoke('focus:list'),
  focusTaskSummary: ():Promise<import('../shared/types').FocusTaskSummary> => ipcRenderer.invoke('focus:task-summary'),
  updateSettings: (patch: unknown) => ipcRenderer.invoke('settings:update', patch),
  todosList: () => ipcRenderer.invoke('todos:list'),
  todosAdd: (t: unknown) => ipcRenderer.invoke('todos:add', t),
  todosUpdate: (input:import('../shared/types').TodoUpdateInput):Promise<void> => ipcRenderer.invoke('todos:update', input),
  todosToggle: (id: number) => ipcRenderer.invoke('todos:toggle', id),
  todosDelete: (id: number) => ipcRenderer.invoke('todos:delete', id),
  todosAddFocus: (id: number, minutes: number) => ipcRenderer.invoke('todos:addFocus', id, minutes),
  habitsList: () => ipcRenderer.invoke('habits:list'),
  habitsAdd: (h: unknown) => ipcRenderer.invoke('habits:add', h),
  habitsUpdate: (input:import('../shared/types').HabitUpdateInput):Promise<void> => ipcRenderer.invoke('habits:update', input),
  habitsLogs: () => ipcRenderer.invoke('habits:logs'),
  habitsPunch: (id: number) => ipcRenderer.invoke('habits:punch', id),
  eventsList: () => ipcRenderer.invoke('events:list'),
  eventsAdd: (e: unknown) => ipcRenderer.invoke('events:add', e),
  eventsUpdate: (input:import('../shared/types').CalendarEventUpdateInput):Promise<void> => ipcRenderer.invoke('events:update', input),
  eventsDelete: (id: number, confirmation?:string):Promise<void> => ipcRenderer.invoke('events:delete', id, confirmation),
  exportJson: () => ipcRenderer.invoke('export:json'),
  exportCsv: () => ipcRenderer.invoke('export:csv'),
  saveFile: (defaultName: string, content: string) => ipcRenderer.invoke('dialog:save', defaultName, content),
  onRemoteGrowth: (cb: (items: unknown) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, items: unknown) => cb(items)
    ipcRenderer.on('remote-growth', listener)
    return () => { ipcRenderer.removeListener('remote-growth', listener) }
  },
  winMinimize: () => ipcRenderer.send('win:minimize'),
  winMaximize: () => ipcRenderer.send('win:maximize'),
  winClose: () => ipcRenderer.send('win:close')
}

contextBridge.exposeInMainWorld('api', api)

export type XinhaiApi = Omit<typeof api, 'clientStateSync'> & {
  clientStateSync?: (request:ClientStateSyncRequest)=>Record<string,string>|null
}

declare global {
  interface Window {
    api: XinhaiApi
  }
}
