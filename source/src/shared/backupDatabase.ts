import { DEFAULT_SETTINGS, DIMENSIONS } from './types'
import { parseFocusRecovery } from './focusRecovery'
import { ORIGINAL_IDS, parseThemeAppearance, themeName } from './themeLibrary'

// This is the validated database member of the complete file archive.
// SQL identifiers always come from this local schema, never from imported JSON.
const I = 'integer', S = 'string', J = 'json', N = 'nullableInteger', T = 'nullableString'
export const BACKUP_SCHEMA = {
  stats: { id:I, points_json:J },
  growth_events: { id:I, ts:I, dimension:S, points:I, source:S, reason:S, sync_cause:T },
  focus_sessions: { id:I, started_at:I, ended_at:I, minutes:I, mode:S, task_label:S, seconds:N, sync_token:T },
  journals: { id:I, ts:I, content:S, scores_json:J, summary:S, engine:S },
  settings: { id:I, json:J },
  todos: { id:I, title:S, priority:I, date:S, est_pomos:I, done:I, focus_minutes:I, created_at:I, completed_at:N },
  habits: { id:I, name:S, dimension:S, weekly_target:I, sort_order:I, deleted_at:N },
  habit_logs: { id:I, habit_id:I, date:S, ts:I },
  events: { id:I, title:S, date:S, kind:S },
  focus_commits: { token:S, result_json:J },
  journal_commits: { token:S, result_json:J },
  growth_meta: { id:I, epoch:I },
  growth_resets: { id:I, ts:I, stats_json:J, events_json:J, undone:I, practice_json:T },
  review_cards: { id:S, question:S, answer:S, topic:S, sourceRoot:S, sourcePath:S, dueDate:S, intervalDays:I, reviews:I, archived:I, version:I, createdAt:I, updatedAt:I },
  review_logs: { token:S, cardId:S, rating:S, ts:I, previousDue:S, nextDue:S, intervalDays:I },
  music_imports: { id:S, path:S, title:S, createdAt:I },
  focus_recovery: { id:I, token:S, body:J, updated_at:I }
} as const
export type BackupTable = keyof typeof BACKUP_SCHEMA
export const BACKUP_TABLES = Object.keys(BACKUP_SCHEMA) as BackupTable[]
export const BACKUP_SEQUENCES = ['growth_events','focus_sessions','journals','todos','habits','habit_logs','events','growth_resets'] as const
export type BackupRow = Record<string, string | number | null>
export interface DatabaseSnapshot {
  format:'xinhai-database-snapshot'; version:1; createdAt:number
  tables:Record<BackupTable, BackupRow[]>
  sequences:Record<string, number>
  clientState:Record<string, string>
}
export const SNAPSHOT_LIMIT = 64 * 1024 * 1024
const PRACTICE_TABLES:BackupTable[] = ['focus_sessions','journals','habit_logs','todos','review_cards','review_logs']
const CLIENT_KEYS = ['xinhai-journal-draft-v1','xinhai-review-draft-v1','xinhai-focus-tasks-v1','xinhai-music-prefs','xinhai-music-resume','xinhai-netease-library-v1','xinhai-netease-shares-v1','wallpaper-gesture-learned']
export function isBackupClientKey(key:string):boolean { return CLIENT_KEYS.includes(key) || key.startsWith('xinhai-note:') }
export function validateBackupClientState(value:unknown):Record<string,string> {
  const client=object(value);let size=0
  const text=(v:unknown):v is string=>typeof v==='string'
  const finite=(v:unknown,min=0,max=Number.MAX_VALUE)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max
  for(const [key,v] of Object.entries(client)){
    if(!isBackupClientKey(key)||key.length>6000||typeof v!=='string'||v.length>8*1024*1024)fail('本机草稿字段无效')
    size+=key.length+v.length
    if(key==='wallpaper-gesture-learned'){if(v!=='1')fail('手势提示状态无效');continue}
    const parsed=json(v)
    if(key==='xinhai-focus-tasks-v1'){
      if(!Array.isArray(parsed)||parsed.some(t=>!t||!text(t.id)||!text(t.title)||!finite(t.usedAt)))fail('专注任务草稿损坏')
      continue
    }
    if(key==='xinhai-netease-library-v1'||key==='xinhai-netease-shares-v1'){
      const playlists=key==='xinhai-netease-shares-v1'?parsed:object(parsed).playlists
      if(!Array.isArray(playlists)||playlists.some(p=>!p||!text(p.id)||!text(p.name)||!Array.isArray(p.tracks)||p.tracks.some((t:unknown)=>!t||typeof t!=='object'||!text((t as Record<string,unknown>).file)||!text((t as Record<string,unknown>).title))))fail('收藏歌单损坏')
      continue
    }
    const d=object(parsed)
    if(key==='xinhai-journal-draft-v1'){
      if(!text(d.token)||!d.token||!text(d.content))fail('日记草稿损坏')
    }else if(key==='xinhai-review-draft-v1'){
      if(!['id','question','answer','topic','sourceRoot','sourcePath'].every(k=>text(d[k]))||!integer(d.version))fail('复习卡草稿损坏')
    }else if(key.startsWith('xinhai-note:')){
      if(!text(d.content)||!text(d.revision))fail('笔记草稿损坏')
    }else if(key==='xinhai-music-prefs'){
      if(d.mode!==undefined&&!['seq','loop','random'].includes(d.mode as string)||d.volume!==undefined&&!finite(d.volume,0,1)||d.file!==undefined&&!text(d.file))fail('音乐偏好损坏')
    }else if(key==='xinhai-music-resume'){
      if(!text(d.file)||!finite(d.seconds)||typeof d.playing!=='boolean')fail('音乐进度损坏')
    }
  }
  if(size>10*1024*1024)fail('本机草稿超过 10 MiB 字符限制')
  return client as Record<string,string>
}
function fail(detail:string):never { throw Error('备份数据无效：'+detail) }
function object(value:unknown):Record<string,unknown> {
  if(!value || typeof value!=='object' || Array.isArray(value))return fail('需要对象')
  return value as Record<string,unknown>
}
function exact(value:Record<string,unknown>,keys:readonly string[]):void {
  if(Object.keys(value).length!==keys.length || keys.some(key=>!Object.hasOwn(value,key)))fail('字段不匹配')
}
function integer(value:unknown,min=0):value is number { return typeof value==='number' && Number.isSafeInteger(value) && value>=min }
function json(value:unknown):unknown {
  if(typeof value!=='string' || value.length>SNAPSHOT_LIMIT) return fail('JSON 字段过大或类型错误')
  try{return JSON.parse(value)}catch{return fail('JSON 字段损坏')}
}
function points(value:unknown):void {
  const row=object(value);exact(row,DIMENSIONS)
  if(DIMENSIONS.some(d=>!integer(row[d])))fail('成长数值无效')
}
function rows(table:BackupTable,value:unknown,embedded=false):BackupRow[] {
  if(!Array.isArray(value) || value.length>1_000_000) return fail('记录数量无效')
  const schema=BACKUP_SCHEMA[table],keys=Object.keys(schema),primary=keys[0],seen=new Set<unknown>()
  for(const item of value){
    const row=object(item);exact(row,keys)
    for(const [key,kind] of Object.entries(schema)){
      const v=row[key]
      if((kind===N || kind===T) && v===null)continue
      if(kind===I || kind===N){if(!integer(v))fail(table+'.'+key+' 不是非负整数')}
      else {if(typeof v!=='string'||v.length>SNAPSHOT_LIMIT||v.includes('\u0000'))fail(table+'.'+key+' 文本无效');if(kind===J)json(v)}
    }
    const id=row[primary]
    if((typeof id==='number'&&id<1)||(typeof id==='string'&&!id)||seen.has(id))fail(table+' 主键为空或重复')
    seen.add(id)
    if(table==='stats')points(json(row.points_json))
    if(table==='journals')points(json(row.scores_json))
    if(table==='growth_events'||table==='habits'){if(!DIMENSIONS.includes(row.dimension as never))fail('成长维度无效')}
    for(const key of ['done','archived','undone'])if(Object.hasOwn(row,key)&&![0,1].includes(row[key] as number))fail('布尔数值无效')
    if(table==='focus_sessions' && (Number(row.ended_at)<Number(row.started_at) || (row.seconds!==null&&Number(row.seconds)>604800)))fail('专注时长无效')
    if(table==='focus_recovery'){
      const recovery=parseFocusRecovery(json(row.body))
      if(!recovery || recovery.token!==row.token)fail('进行中专注状态损坏')
    }
    if(table==='growth_resets'&&!embedded){
      points(json(row.stats_json));rows('growth_events',json(row.events_json),true)
      if(row.practice_json!==null){
        const practice=object(json(row.practice_json));exact(practice,['before','after'])
        for(const part of [object(practice.before),object(json(practice.after))]){
          exact(part,PRACTICE_TABLES)
          for(const name of PRACTICE_TABLES)rows(name,part[name],true)
        }
      }
    }
    if(table==='focus_commits'||table==='journal_commits'){
      const result=object(json(row.result_json)),growth=object(result.growth)
      points(growth.stats);if(growth.before!==undefined)points(growth.before)
      if(!Array.isArray(growth.events)||!Array.isArray(growth.levelUps)||growth.levelUps.some(d=>!DIMENSIONS.includes(d as never)))fail('提交回执无效')
      for(const event of growth.events){const e=object(event);if(!integer(e.id,1)||!integer(e.ts)||!integer(e.points)||!DIMENSIONS.includes(e.dimension as never)||typeof e.reason!=='string')fail('成长回执损坏')}
      const entry=object(table==='focus_commits'?result.session:result.journal)
      if(!integer(entry.id,1))fail('提交回执主键无效')
      if(table==='focus_commits'){
        if(!integer(entry.startedAt)||!integer(entry.endedAt)||!integer(entry.minutes)||Number(entry.endedAt)<Number(entry.startedAt)||typeof entry.mode!=='string'||typeof entry.taskLabel!=='string')fail('专注回执损坏')
        if(entry.seconds!==undefined&&!integer(entry.seconds))fail('专注回执秒数无效')
        points(result.before)
      }else {if(typeof entry.content!=='string'||typeof entry.summary!=='string'||!integer(entry.ts)||!['local','llm'].includes(entry.engine as string))fail('日记回执损坏');points(entry.scores)}
    }
  }
  return value as BackupRow[]
}

export function validateDatabaseSnapshot(value:unknown):DatabaseSnapshot {
  const data=object(value);exact(data,['format','version','createdAt','tables','sequences','clientState'])
  if(data.format!=='xinhai-database-snapshot'||data.version!==1||!integer(data.createdAt))fail('格式或版本不支持')
  const tables=object(data.tables);exact(tables,BACKUP_TABLES)
  for(const table of BACKUP_TABLES)rows(table,tables[table])
  for(const table of ['stats','settings','growth_meta'] as const){const list=tables[table] as BackupRow[];if(list.length!==1||list[0].id!==1)fail(table+' 必须有唯一记录')}
  const recovery=tables.focus_recovery as BackupRow[];if(recovery.length>1||(recovery.length===1&&recovery[0].id!==1))fail('专注恢复记录重复')
  const settings=object(json((tables.settings as BackupRow[])[0].json));exact(settings,Object.keys(DEFAULT_SETTINGS))
  for(const [key,defaultValue] of Object.entries(DEFAULT_SETTINGS)){
    const v=settings[key]
    if(defaultValue!==null && !Array.isArray(defaultValue) && typeof v!==typeof defaultValue)fail('设置字段类型错误：'+key)
    if(typeof v==='number'&&!Number.isFinite(v))fail('设置数值无效')
    if(Array.isArray(defaultValue)&&!Array.isArray(v))fail('设置集合无效')
  }
  if(settings.llmKey!==''||settings.llmEndpoint!==''||settings.llmModel!=='')fail('备份不得携带模型凭据或连接配置')
  const library=settings.wallpaperLibrary as unknown[],themes=settings.savedThemes as unknown[]
  if(library.length>100||themes.length>100)fail('主题收藏超出限制')
  const ids=new Set<string>(),themeIds=new Set<string>()
  const wallpaperValue=(value:unknown,collection:boolean)=>{
    const w=object(value)
    if(typeof w.src!=='string'||!w.src||typeof w.name!=='string'||!w.name||typeof w.poster!=='string'||!['image','video'].includes(w.kind as string))fail('壁纸收藏损坏')
    if(w.themeColor!==undefined&&(typeof w.themeColor!=='string'||!/^#[a-f0-9]{6}$/i.test(w.themeColor)))fail('壁纸配色无效')
    if(collection){if(typeof w.id!=='string'||!w.id||ids.has(w.id)||!integer(w.addedAt))fail('壁纸编号无效');ids.add(w.id as string)}
  }
  for(const value of library)wallpaperValue(value,true)
  if(settings.customBackground!==null)wallpaperValue(settings.customBackground,false)
  for(const value of themes){
    const theme=object(value),wallpaper=object(theme.wallpaper)
    exact(theme,['id','name','createdAt','appearance','wallpaper'])
    if(typeof theme.id!=='string'||!theme.id||themeIds.has(theme.id)||!integer(theme.createdAt))fail('个人主题损坏')
    themeIds.add(theme.id);themeName(theme.name);parseThemeAppearance(theme.appearance)
    exact(wallpaper,['type','id'])
    if(wallpaper.type==='library'){if(!ids.has(wallpaper.id as string))fail('个人主题引用的壁纸缺失')}
    else if(wallpaper.type!=='builtin'||!ORIGINAL_IDS.includes(wallpaper.id as never))fail('内置主题引用无效')
  }
  const habitIds=new Set((tables.habits as BackupRow[]).map(row=>row.id))
  if((tables.habit_logs as BackupRow[]).some(row=>!habitIds.has(row.habit_id)))fail('习惯打卡引用缺失')
  const cardIds=new Set((tables.review_cards as BackupRow[]).map(row=>row.id))
  if((tables.review_logs as BackupRow[]).some(row=>!cardIds.has(row.cardId)))fail('复习记录引用缺失')
  const sequences=object(data.sequences)
  if(Object.keys(sequences).some(key=>!BACKUP_SEQUENCES.includes(key as never)))fail('序列含未知数据表')
  for(const table of BACKUP_SEQUENCES){const n=sequences[table]??0;if(!integer(n)||(tables[table] as BackupRow[]).some(row=>Number(row.id)>n))fail('自增序列小于已用编号')}
  validateBackupClientState(data.clientState)
  return value as DatabaseSnapshot
}

export function parseDatabaseSnapshot(text:string):DatabaseSnapshot {
  if(new TextEncoder().encode(text).length>SNAPSHOT_LIMIT)fail('数据库快照超过 64 MiB')
  return validateDatabaseSnapshot(json(text))
}
