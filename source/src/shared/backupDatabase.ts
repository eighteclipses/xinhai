import {parseWallpaperThemeColors} from './theme'
import {parseCharacterPosition,parseCharacterScale} from './characterPlacement'
import {validateKnowledgeCategoryTarget} from './knowledgeCategories'
import {CATEGORY_TABLES,isCategoryId,validateCategoryInput} from './learningCategories'
import {parseHomeLayouts} from './homeLayout'
import {validateFocusPreferences} from './focusPreferences'
import {LEGACY_APPEARANCE_OMISSIONS} from './personalAppearance'
import { DEFAULT_SETTINGS, DIMENSIONS } from './types'
import { parseFocusRecovery } from './focusRecovery'
import { ORIGINAL_IDS, parseThemeAppearance, themeName } from './themeLibrary'

// This is the validated database member of the complete file archive.
// SQL identifiers always come from this local schema, never from imported JSON.
const I = 'integer', S = 'string', J = 'json', N = 'nullableInteger', T = 'nullableString'
export const BACKUP_SCHEMA = {
  learning_categories: {id:S,name:S,color:S,sort_order:I,archived_at:N,created_at:I,updated_at:I},
  local_knowledge_categories: {root:S,path:S,category_id:S},
  stats: { id:I, points_json:J },
  growth_events: { id:I, ts:I, dimension:S, points:I, source:S, reason:S, sync_cause:T },
  focus_sessions: { id:I, started_at:I, ended_at:I, minutes:I, mode:S, task_label:S, seconds:N, sync_token:T, category_id:T },
  journals: { id:I, ts:I, content:S, scores_json:J, summary:S, engine:S, category_id:T },
  settings: { id:I, json:J },
  todos: { id:I, title:S, priority:I, date:S, est_pomos:I, done:I, focus_minutes:I, created_at:I, completed_at:N, category_id:T },
  habits: { id:I, name:S, dimension:S, weekly_target:I, sort_order:I, deleted_at:N, category_id:T },
  habit_logs: { id:I, habit_id:I, date:S, ts:I, category_id:T },
  events: { id:I, title:S, date:S, kind:S, category_id:T },
  focus_commits: { token:S, result_json:J },
  focus_reward_sessions: {token:S,seconds:I,ended_at:I},
  focus_reward_blocks: {id:S,ts:I},
  focus_reward_presentations:{token:S,block_ids:J,session_tokens:J,ts:I,acknowledged:I},
  journal_commits: { token:S, result_json:J },
  growth_meta: { id:I, epoch:I },
  growth_resets: { id:I, ts:I, stats_json:J, events_json:J, undone:I, practice_json:T },
  review_cards: { id:S, question:S, answer:S, topic:S, sourceRoot:S, sourcePath:S, dueDate:S, intervalDays:I, reviews:I, archived:I, version:I, createdAt:I, updatedAt:I, category_id:T },
  review_logs: { token:S, cardId:S, rating:S, ts:I, previousDue:S, nextDue:S, intervalDays:I, category_id:T },
  music_imports: { id:S, path:S, title:S, createdAt:I },
  focus_recovery: { id:I, token:S, body:J, updated_at:I }
} as const
export type BackupTable = keyof typeof BACKUP_SCHEMA
export const BACKUP_TABLES = Object.keys(BACKUP_SCHEMA) as BackupTable[]
export const BACKUP_SEQUENCES = ['growth_events','focus_sessions','journals','todos','habits','habit_logs','events','growth_resets'] as const
export type BackupRow = Record<string, string | number | null>
export interface DatabaseSnapshot {
  format:'xinhai-database-snapshot'; version:3; createdAt:number
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
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)){const categoryId=(parsed as Record<string,unknown>).categoryId;if(categoryId!==undefined&&categoryId!==null&&!isCategoryId(categoryId))fail('草稿分类无效')}
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
      if(d.hiddenBuiltinFiles!==undefined&&(!Array.isArray(d.hiddenBuiltinFiles)||d.hiddenBuiltinFiles.length>1000||d.hiddenBuiltinFiles.some(file=>typeof file!=='string'||!file||file.length>1024||/[\u0000-\u001f]/.test(file))))fail('隐藏音乐偏好损坏')
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
    const row=object(item)
    const legacyCategory=embedded&&CATEGORY_TABLES.includes(table as never)&&!Object.hasOwn(row,'category_id')
    exact(row,legacyCategory?keys.filter(key=>key!=='category_id'):keys)
    for(const [key,kind] of Object.entries(schema)){
      const v=legacyCategory&&key==='category_id'?null:row[key]
      if((kind===N || kind===T) && v===null)continue
      if(kind===I || kind===N){if(!integer(v))fail(table+'.'+key+' 不是非负整数')}
      else {if(typeof v!=='string'||v.length>SNAPSHOT_LIMIT||v.includes('\u0000'))fail(table+'.'+key+' 文本无效');if(kind===J)json(v)}
    }
    const id=table==='local_knowledge_categories'?JSON.stringify([row.root,row.path]):row[primary]
    if((typeof id==='number'&&id<1)||(typeof id==='string'&&!id)||seen.has(id))fail(table+' 主键为空或重复')
    seen.add(id)
    if(Object.hasOwn(row,'category_id')&&row.category_id!==null&&!isCategoryId(row.category_id))fail('分类引用标识无效')
    if(table==='learning_categories'){validateCategoryInput({id:row.id as string,name:row.name as string,color:row.color as string});if(Number(row.sort_order)>1000000)fail('分类排序越界')}
    if(table==='local_knowledge_categories')validateKnowledgeCategoryTarget(row.root,row.path)
    if(table==='stats')points(json(row.points_json))
    if(table==='journals')points(json(row.scores_json))
    if(table==='growth_events'||table==='habits'){if(!DIMENSIONS.includes(row.dimension as never))fail('成长维度无效')}
    for(const key of ['done','archived','undone'])if(Object.hasOwn(row,key)&&![0,1].includes(row[key] as number))fail('布尔数值无效')
    if(table==='focus_sessions' && (Number(row.ended_at)<Number(row.started_at) || (row.seconds!==null&&Number(row.seconds)>604800)))fail('专注时长无效')
    if(table==='focus_reward_sessions'&&(String(row.token).length>160||Number(row.seconds)>604800))fail('专注音符贡献无效')
    if(table==='focus_reward_blocks'&&!/^[1-9]\d{0,6}$/.test(String(row.id)))fail('专注音符区块无效')
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
  let data=object(value);exact(data,['format','version','createdAt','tables','sequences','clientState'])
  if(data.format!=='xinhai-database-snapshot'||![1,2,3].includes(data.version as number)||!integer(data.createdAt))fail('格式或版本不支持')
  if(data.version===1){
    // Validate the complete legacy shape before adding only known nullable columns.
    const legacyTables=object(data.tables);exact(legacyTables,BACKUP_TABLES.filter(t=>!['learning_categories','local_knowledge_categories','focus_reward_sessions','focus_reward_blocks','focus_reward_presentations'].includes(t)))
    for(const table of CATEGORY_TABLES){if(!Array.isArray(legacyTables[table]))fail('旧版记录集合无效');for(const value of legacyTables[table] as unknown[])exact(object(value),Object.keys(BACKUP_SCHEMA[table]).filter(k=>k!=='category_id'))}
    data=JSON.parse(JSON.stringify(data));data.version=2
    const migrated=object(data.tables);migrated.learning_categories=[];migrated.local_knowledge_categories=[]
    for(const table of CATEGORY_TABLES)migrated[table]=(migrated[table] as Record<string,unknown>[]).map(row=>({...row,category_id:null}))
    const legacySettings=object(json((migrated.settings as BackupRow[])[0]?.json))
    for(const [key,value]of Object.entries(LEGACY_APPEARANCE_OMISSIONS))if(!Object.hasOwn(legacySettings,key))legacySettings[key]=JSON.parse(JSON.stringify(value))
    for(const key of ['focusPanelLayout','focusBackgroundBehavior','focusRewardPresentation'] as const)if(!Object.hasOwn(legacySettings,key))legacySettings[key]=DEFAULT_SETTINGS[key]
    ;(migrated.settings as BackupRow[])[0].json=JSON.stringify(legacySettings)
  }
  if(data.version===2){
    exact(object(data.tables),BACKUP_TABLES.filter(t=>!['focus_reward_sessions','focus_reward_blocks','focus_reward_presentations'].includes(t)))
    data=JSON.parse(JSON.stringify(data));data.version=3
    Object.assign(object(data.tables),{focus_reward_sessions:[],focus_reward_blocks:[],focus_reward_presentations:[]})
  }
  const tables=object(data.tables);exact(tables,BACKUP_TABLES)
  for(const table of BACKUP_TABLES)rows(table,tables[table])
  const contributions=tables.focus_reward_sessions as BackupRow[],blocks=tables.focus_reward_blocks as BackupRow[]
  const blockCount=Math.floor(contributions.reduce((n,row)=>n+Number(row.seconds),0)/1500)
  if(blockCount>1_000_000||blocks.length!==blockCount||blocks.some(row=>Number(row.id)>blockCount))fail('专注音符区块与累计秒数不符')
  const blockIds=new Set(blocks.map(row=>row.id)),tokens=new Set(contributions.map(row=>row.token)),secondsByToken=new Map(contributions.map(row=>[row.token,Number(row.seconds)]))
  for(const row of tables.focus_reward_presentations as BackupRow[]){
    const ids=json(row.block_ids),covered=json(row.session_tokens)
    if(String(row.token).length>160||!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!blockIds.has(id))||!Array.isArray(covered)||new Set(covered).size!==covered.length||covered.some(token=>typeof token!=='string'||!tokens.has(token)))fail('音符演出回执无效')
    if((ids as string[]).some(id=>Number(id)>Math.floor((covered as string[]).reduce((n,token)=>n+(secondsByToken.get(token)??0),0)/1500)))fail('音符演出回执超出贡献范围')
  }
  const rewardCauses=new Set<string>()
  for(const row of tables.growth_events as BackupRow[]){if(typeof row.sync_cause==='string'&&row.sync_cause.startsWith('focus:reward-v1:')){
    const id=row.sync_cause.slice('focus:reward-v1:'.length)
    if(!blockIds.has(id)||rewardCauses.has(row.sync_cause)||row.points!==1||row.dimension!=='knowledge'||row.source!=='focus')fail('专注音符事件身份无效')
    rewardCauses.add(row.sync_cause)
  }}
  const categoryIds=new Set((tables.learning_categories as BackupRow[]).map(row=>row.id))
  const categoryReferences=(records:BackupRow[])=>{for(const row of records)if(row.category_id!==undefined&&row.category_id!==null&&!categoryIds.has(row.category_id))fail('学习分类引用缺失')}
  for(const table of [...CATEGORY_TABLES,'local_knowledge_categories'] as const)categoryReferences(tables[table] as BackupRow[])
  for(const row of tables.growth_resets as BackupRow[]){if(row.practice_json){const p=object(json(row.practice_json));for(const part of [object(p.before),object(json(p.after))])for(const table of PRACTICE_TABLES)categoryReferences(part[table] as BackupRow[])}}
  const categoryObjectReference=(value:unknown)=>{const record=object(value);if(record.categoryId!==undefined&&record.categoryId!==null&&(!isCategoryId(record.categoryId)||!categoryIds.has(record.categoryId)))fail('草稿或提交回执的学习分类引用缺失')}
  for(const table of ['focus_commits','journal_commits'] as const)for(const row of tables[table] as BackupRow[]){const receipt=object(json(row.result_json));categoryObjectReference(table==='focus_commits'?receipt.session:receipt.journal)}
  for(const row of tables.focus_recovery as BackupRow[]){const recovery=object(json(row.body));categoryObjectReference(recovery);if(recovery.pendingCommit)categoryObjectReference(recovery.pendingCommit)}
  for(const [key,value] of Object.entries(object(data.clientState)))if(key==='xinhai-journal-draft-v1'||key==='xinhai-review-draft-v1')categoryObjectReference(json(value))
  for(const table of ['stats','settings','growth_meta'] as const){const list=tables[table] as BackupRow[];if(list.length!==1||list[0].id!==1)fail(table+' 必须有唯一记录')}
  const recovery=tables.focus_recovery as BackupRow[];if(recovery.length>1||(recovery.length===1&&recovery[0].id!==1))fail('专注恢复记录重复')
  const settings=object(json((tables.settings as BackupRow[])[0].json))
  // Older v2 snapshots predate portrait placement. Only this known omission is migrated.
  if(!Object.hasOwn(settings,'characterPosition')||!Object.hasOwn(settings,'wallpaperThemeColors')||!Object.hasOwn(settings,'focusPanelLayout')||!Object.hasOwn(settings,'focusBackgroundBehavior')||!Object.hasOwn(settings,'focusRewardPresentation')){
    data=JSON.parse(JSON.stringify(data));const migrated=object(data.tables),rows=migrated.settings as BackupRow[]
    rows[0].json=JSON.stringify({...settings,...(!Object.hasOwn(settings,'characterPosition')?{characterPosition:null}:{}),...(!Object.hasOwn(settings,'wallpaperThemeColors')?{wallpaperThemeColors:{}}:{}),...(!Object.hasOwn(settings,'focusPanelLayout')?{focusPanelLayout:null}:{}),...(!Object.hasOwn(settings,'focusBackgroundBehavior')?{focusBackgroundBehavior:'wait'}:{}),...(!Object.hasOwn(settings,'focusRewardPresentation')?{focusRewardPresentation:'batch'}:{})})
    return validateDatabaseSnapshot(data)
  }
  parseCharacterPosition(settings.characterPosition);parseCharacterScale(settings.characterScale);parseWallpaperThemeColors(settings.wallpaperThemeColors)
  validateFocusPreferences(settings as unknown as import('./types').Settings)
  // Genuine v1 omissions were migrated above. Current snapshots remain exact.
  const settingKeys=Object.keys(DEFAULT_SETTINGS)
  exact(settings,settingKeys)
  parseHomeLayouts(settings.homeLayouts)
  for(const [key,defaultValue] of Object.entries(DEFAULT_SETTINGS)){
    const v=key==='characterArtId'&&!Object.hasOwn(settings,key)?DEFAULT_SETTINGS.characterArtId:settings[key]
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
  return data as unknown as DatabaseSnapshot
}

export function parseDatabaseSnapshot(text:string):DatabaseSnapshot {
  if(new TextEncoder().encode(text).length>SNAPSHOT_LIMIT)fail('数据库快照超过 64 MiB')
  return validateDatabaseSnapshot(json(text))
}
