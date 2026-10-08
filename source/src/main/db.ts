import {LanSyncEngine} from '../shared/lanSyncEngine'
import {COMMERCIAL_EDITION} from '../shared/edition'
import { initMusic } from './music'
import { initReview, reviewExport } from './review'
import { createDurableClientStateStore } from './durableClientState'
import { initFocusRecovery, clearFocusRecovery } from './focusRecovery'
import { initBackupDatabase, captureDatabaseSnapshot, replaceDatabaseFromSnapshot, pendingClientRestore, acknowledgeClientRestore, type RestoreResources } from './backupDatabase'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import { localDateKey } from '../shared/date'
import {normalizeSceneSettings,rotationSeconds} from '../shared/sceneRotation'
import {migratedThemeColor,normalizeThemeColor} from '../shared/theme'
import {
  DIMENSIONS,
  DEFAULT_SETTINGS,
  levelOf,
  type DimensionId,
  type Settings,
  type AppState,
  type GrowthEvent,
  type GrowthSource,
  type FocusSession,
  type FocusCommitInput,
  type FocusCommitResult,
  type Journal,
  type GrowthApplyResult,
  type Todo,
  type CalendarEntry,
  type Habit,
  type HabitLog,
  type CalEvent
} from '../shared/types'

let db: Database.Database
export let syncEngine:LanSyncEngine

export const captureBackupState=(client:Record<string,string>)=>captureDatabaseSnapshot(db,client)
export const readBackupClientRestore=()=>pendingClientRestore(db)
export const ackBackupClientRestore=(token:string)=>acknowledgeClientRestore(db,token)
export function createAppDurableClientStateStore() {
  if(!db)throw Error('学习库尚未初始化')
  return createDurableClientStateStore(db)
}
export function restoreBackupState(snapshot:unknown,resources:RestoreResources):void {
  if(readLegacyModelSettings().key)throw Error('旧模型密钥尚未安全迁移，请先在设置中重试或明确移除密钥，再恢复资料')
  const nextEngine=db.transaction(()=>{replaceDatabaseFromSnapshot(db,snapshot,resources);return new LanSyncEngine(db)})()
  syncEngine=nextEngine
}

export function initDb(): void {
  const file = join(app.getPath('userData'), 'xinhai.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  initFocusRecovery(db)
  initBackupDatabase(db)
  db.exec('CREATE TABLE IF NOT EXISTS app_migrations (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  db.exec('CREATE TABLE IF NOT EXISTS journal_commits (token TEXT PRIMARY KEY, result_json TEXT NOT NULL)')
  initReview(db)
  initMusic(db)
  db.exec(`
    CREATE TABLE IF NOT EXISTS stats (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      points_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS growth_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      dimension TEXT NOT NULL,
      points INTEGER NOT NULL,
      source TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS focus_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      minutes INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT '',
      task_label TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS journals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      content TEXT NOT NULL,
      scores_json TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      engine TEXT NOT NULL DEFAULT 'local'
    );
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 1,
      date TEXT NOT NULL DEFAULT '',
      est_pomos INTEGER NOT NULL DEFAULT 1,
      done INTEGER NOT NULL DEFAULT 0,
      focus_minutes INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS habits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      dimension TEXT NOT NULL,
      weekly_target INTEGER NOT NULL DEFAULT 7
    );
    CREATE TABLE IF NOT EXISTS habit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      habit_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT '学习'
    );
  `)
  const habitColumns=db.prepare('PRAGMA table_info(habits)').all() as Array<{name:string}>
  if(!habitColumns.some(c=>c.name==='sort_order')){db.exec('ALTER TABLE habits ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');db.exec('UPDATE habits SET sort_order=id')}
  if(!habitColumns.some(c=>c.name==='deleted_at'))db.exec('ALTER TABLE habits ADD COLUMN deleted_at INTEGER')
  const todoColumns = db.prepare('PRAGMA table_info(todos)').all() as Array<{name:string}>
  if (!todoColumns.some(c=>c.name==='completed_at')) db.exec('ALTER TABLE todos ADD COLUMN completed_at INTEGER')
  const columns = db.prepare('PRAGMA table_info(focus_sessions)').all() as Array<{name: string}>
  if (!columns.some(c => c.name === 'seconds')) db.exec('ALTER TABLE focus_sessions ADD COLUMN seconds INTEGER')
  if (!columns.some(c => c.name === 'sync_token')) db.exec('ALTER TABLE focus_sessions ADD COLUMN sync_token TEXT')
  if (!(db.prepare('PRAGMA table_info(growth_events)').all() as Array<{name:string}>).some(c=>c.name==='sync_cause')) db.exec('ALTER TABLE growth_events ADD COLUMN sync_cause TEXT')
  db.exec('CREATE TABLE IF NOT EXISTS focus_commits (token TEXT PRIMARY KEY, result_json TEXT NOT NULL)')
  db.exec(`CREATE TABLE IF NOT EXISTS growth_meta (id INTEGER PRIMARY KEY CHECK(id=1), epoch INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO growth_meta(id,epoch) VALUES (1,0);
    CREATE TABLE IF NOT EXISTS growth_resets (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, stats_json TEXT NOT NULL, events_json TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0);`)
  if(!(db.prepare('PRAGMA table_info(growth_resets)').all() as Array<{name:string}>).some(c=>c.name==='practice_json'))db.exec('ALTER TABLE growth_resets ADD COLUMN practice_json TEXT')
  const hasHabits = db.prepare('SELECT 1 FROM habits LIMIT 1').get()
  const habitsInitialized=db.prepare('SELECT value FROM app_migrations WHERE key=?').get('habits-initialized-v1')
  if (!hasHabits && !habitsInitialized) {
    const defaults: Array<[string, DimensionId]> = [
      ['阅读30分钟', 'knowledge'],
      ['当日复盘', 'will'],
      ['背单词', 'knowledge'],
      ['运动', 'craft'],
      ['喝水', 'will'],
      ['早睡', 'will'],
      ['整理书桌', 'craft']
    ]
    const ins = db.prepare('INSERT INTO habits (name, dimension, weekly_target) VALUES (?, ?, 7)')
    for (const [name, dim] of defaults) ins.run(name, dim)
  }
  db.prepare('INSERT OR IGNORE INTO app_migrations(key,value) VALUES (?,?)').run('habits-initialized-v1','1')
  db.exec('CREATE TABLE IF NOT EXISTS app_migrations (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const layoutUpgrade=db.prepare('SELECT value FROM app_migrations WHERE key=?').get('focus-center-v1')
  if(!layoutUpgrade){
    const row=db.prepare('SELECT json FROM settings WHERE id=1').get() as {json:string}|undefined
    if(row){const settings=JSON.parse(row.json);settings.timerPosition='center';db.prepare('UPDATE settings SET json=? WHERE id=1').run(JSON.stringify(settings))}
    db.prepare('INSERT OR REPLACE INTO app_migrations(key,value) VALUES (?,?)').run('focus-center-v1','1')
  }
  const hasStats = db.prepare('SELECT 1 FROM stats WHERE id = 1').get()
  if (!hasStats) {
    const zero = Object.fromEntries(DIMENSIONS.map((d) => [d, 0]))
    db.prepare('INSERT INTO stats (id, points_json) VALUES (1, ?)').run(JSON.stringify(zero))
  }
  const hasSettings = db.prepare('SELECT 1 FROM settings WHERE id = 1').get()
  if (!hasSettings) {
    db.prepare('INSERT INTO settings (id, json) VALUES (1, ?)').run(JSON.stringify(DEFAULT_SETTINGS))
  }
  const saved = JSON.parse((db.prepare('SELECT json FROM settings WHERE id=1').get() as {json:string}).json)
  const themeColor = migratedThemeColor(saved)
  const migratedSettings=normalizeSceneSettings({...DEFAULT_SETTINGS,...saved,themeColor})
  if (JSON.stringify(saved) !== JSON.stringify(migratedSettings)) {
    db.prepare('UPDATE settings SET json=? WHERE id=1').run(JSON.stringify(migratedSettings))
  }
  // Seed the existing session identity from the idempotent commit receipt.
  for(const receipt of db.prepare('SELECT token,result_json FROM focus_commits').all() as Array<{token:string;result_json:string}>){
    try{const result=JSON.parse(receipt.result_json);db.prepare('UPDATE focus_sessions SET sync_token=? WHERE id=? AND sync_token IS NULL').run(receipt.token,result.session.id);for(const e of result.growth.events)db.prepare('UPDATE growth_events SET sync_cause=? WHERE id=? AND sync_cause IS NULL').run('focus:'+receipt.token,e.id)}catch{/* Keep legacy rows with their own durable ID. */}
  }
  syncEngine=new LanSyncEngine(db)
}

export function getState(): AppState {
  const stats = JSON.parse(
    (db.prepare('SELECT points_json FROM stats WHERE id = 1').get() as { points_json: string }).points_json
  ) as Record<DimensionId, number>
  const settings = normalizeSceneSettings({
    ...DEFAULT_SETTINGS,
    ...JSON.parse((db.prepare('SELECT json FROM settings WHERE id = 1').get() as { json: string }).json)
  } as Settings)
  settings.llmKey=''
  const growthEpoch = (db.prepare('SELECT epoch FROM growth_meta WHERE id=1').get() as {epoch:number}).epoch
  return { stats, settings, growthEpoch }
}

export function growthResetInfo(): import('../shared/types').GrowthResetInfo {
  const eventCount=(db.prepare('SELECT COUNT(*) AS n FROM growth_events').get() as {n:number}).n
  const last=db.prepare('SELECT ts,undone,practice_json FROM growth_resets ORDER BY id DESC LIMIT 1').get() as {ts:number;undone:number;practice_json:string|null}|undefined
  const practiceCount=['focus_sessions','journals','habit_logs','review_logs'].reduce((n,t)=>n+(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as {n:number}).n,0)+(db.prepare('SELECT COUNT(*) AS n FROM todos WHERE done=1 OR focus_minutes>0').get() as {n:number}).n
  const practiceUnchanged=!last?.practice_json||JSON.parse(last.practice_json).after===JSON.stringify(practiceRows())
  return {eventCount,practiceCount,lastResetAt:last?.ts??null,canUndo:!!last&&!last.undone&&!eventCount&&DIMENSIONS.every(d=>getState().stats[d]===0)&&practiceUnchanged}
}

const PRACTICE_TABLES=['focus_sessions','journals','habit_logs','todos','review_cards','review_logs'] as const
function practiceRows():Record<string,unknown[]> {return Object.fromEntries(PRACTICE_TABLES.map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY ${t==='review_logs'?'token':'id'}`).all()]))}

// Archive and clear in one transaction. Learning content and idempotency tokens stay intact.
export function resetGrowth(confirmation:string,scope:import('../shared/types').DataResetScope='growth'): AppState {
  if(!['growth','practice'].includes(scope))throw Error('清除范围无效。')
  if(confirmation!==(scope==='practice'?'清除练习记录':'清除成长'))throw Error('请输入页面要求的确认文字。')
  return db.transaction(()=>{
    const state=getState(),events=db.prepare('SELECT * FROM growth_events ORDER BY id').all()
    if(!events.length&&DIMENSIONS.every(d=>state.stats[d]===0)&&(scope==='growth'||!growthResetInfo().practiceCount))throw Error('目前没有需要清除的数据。')
    let practice:string|null=null
    if(scope==='practice'){
      const before=practiceRows()
      db.exec('DELETE FROM focus_sessions; DELETE FROM journals; DELETE FROM habit_logs; DELETE FROM review_logs; UPDATE todos SET done=0,completed_at=NULL,focus_minutes=0')
      db.prepare('UPDATE review_cards SET dueDate=?,intervalDays=0,reviews=0,version=version+1,updatedAt=?').run(localDateKey(),Date.now())
      practice=JSON.stringify({before,after:JSON.stringify(practiceRows())})
    }
    db.prepare('INSERT INTO growth_resets(ts,stats_json,events_json,practice_json) VALUES (?,?,?,?)').run(Date.now(),JSON.stringify(state.stats),JSON.stringify(events),practice)
    db.prepare('UPDATE stats SET points_json=? WHERE id=1').run(JSON.stringify(Object.fromEntries(DIMENSIONS.map(d=>[d,0]))))
    db.exec('DELETE FROM growth_events; UPDATE growth_meta SET epoch=epoch+1 WHERE id=1')
    return getState()
  })()
}

export function undoGrowthReset(): AppState {
  return db.transaction(()=>{
    if(!growthResetInfo().canUndo)throw Error('已有新的成长或没有可撤销的清除，无法恢复旧快照。')
    const last=db.prepare('SELECT * FROM growth_resets ORDER BY id DESC LIMIT 1').get() as {id:number;stats_json:string;events_json:string;practice_json:string|null}
    if(last.practice_json){
      const {before}=JSON.parse(last.practice_json) as {before:Record<string,Record<string,unknown>[]>}
      for(const table of PRACTICE_TABLES){
        db.exec(`DELETE FROM ${table}`)
        for(const row of before[table]){
          const cols=Object.keys(row)
          db.prepare(`INSERT INTO ${table} (${cols.map(c=>'"'+c+'"').join(',')}) VALUES (${cols.map(c=>'@'+c).join(',')})`).run(row)
        }
      }
    }
    const insert=db.prepare('INSERT INTO growth_events(id,ts,dimension,points,source,reason) VALUES (@id,@ts,@dimension,@points,@source,@reason)')
    for(const row of JSON.parse(last.events_json))insert.run(row)
    db.prepare('UPDATE stats SET points_json=? WHERE id=1').run(last.stats_json)
    db.prepare('UPDATE growth_resets SET undone=1 WHERE id=?').run(last.id)
    db.exec('UPDATE growth_meta SET epoch=epoch+1 WHERE id=1')
    return getState()
  })()
}

export function applyGrowth(
  items: Array<{ dimension: DimensionId; points: number; source: GrowthSource; reason: string;syncCause?:string }>
): GrowthApplyResult {
  const before = getState().stats
  const events: GrowthEvent[] = []
  const now = Date.now()
  const next = { ...before }
  const insert = db.prepare(
    'INSERT INTO growth_events (ts, dimension, points, source, reason, sync_cause) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const tx = db.transaction(() => {
    for (const item of items) {
      if (item.points <= 0) continue
      const info = insert.run(now, item.dimension, item.points, item.source, item.reason,item.syncCause??null)
      events.push({ id: Number(info.lastInsertRowid), ts: now, ...item })
      next[item.dimension] += item.points
    }
    db.prepare('UPDATE stats SET points_json = ? WHERE id = 1').run(JSON.stringify(next))
  })
  tx()
  const levelUps = DIMENSIONS.filter((d) => levelOf(next[d]) > levelOf(before[d]))
  return { events, stats: next, levelUps, before, growthEpoch:getState().growthEpoch }
}

export function addFocusSession(s: {
  startedAt: number
  endedAt: number
  minutes: number
  mode: string
  taskLabel: string
}): FocusSession {
  const info = db
    .prepare('INSERT INTO focus_sessions (started_at, ended_at, minutes, mode, task_label) VALUES (?, ?, ?, ?, ?)')
    .run(s.startedAt, s.endedAt, s.minutes, s.mode, s.taskLabel)
  return { id: Number(info.lastInsertRowid), startedAt:s.startedAt, endedAt:s.endedAt, minutes:s.minutes, mode:s.mode, taskLabel:s.taskLabel }
}

// Session, points and linked task commit together; retrying a token is safe.
export function commitFocus(s: FocusCommitInput): FocusCommitResult {
  if (!s.token || !Number.isFinite(s.seconds) || s.seconds < 0 || s.seconds > 604800 ||
      !Number.isFinite(s.startedAt) || !Number.isFinite(s.endedAt) || s.endedAt < s.startedAt) throw new Error('专注记录无效')
  return db.transaction(() => {
    const saved = db.prepare('SELECT result_json FROM focus_commits WHERE token = ?').get(s.token) as {result_json: string} | undefined
    if (saved) {
      clearFocusRecovery(s.token)
      const result=JSON.parse(saved.result_json) as FocusCommitResult,state=getState()
      if((result.growth.growthEpoch??0)===state.growthEpoch)return result
      return {...result,before:state.stats,growth:{before:state.stats,events:[],stats:state.stats,levelUps:[],growthEpoch:state.growthEpoch}}
    }
    const seconds = Math.floor(s.seconds), minutes = Math.floor(seconds / 60)
    const before = getState().stats
    const session = addFocusSession({...s, minutes})
    db.prepare('UPDATE focus_sessions SET seconds = ?,sync_token=? WHERE id = ?').run(seconds,s.token, session.id)
    session.seconds = seconds
    const growth = applyGrowth(minutes > 0 ? [{dimension:'knowledge', points:minutes, source:'focus',syncCause:'focus:'+s.token, reason:`专注 ${minutes} 分钟${s.taskLabel ? ' · ' + s.taskLabel : ''}`}] : [])
    if (s.todoId !== null && minutes > 0) addTodoFocus(s.todoId, minutes)
    const result = {session, growth, before}
    db.prepare('INSERT INTO focus_commits (token, result_json) VALUES (?, ?)').run(s.token, JSON.stringify(result))
    clearFocusRecovery(s.token)
    return result
  })()
}

export function todayFocusSeconds(): number {
  const start = new Date(); start.setHours(0,0,0,0)
  const end = new Date(start); end.setDate(end.getDate()+1)
  return (db.prepare('SELECT COALESCE(SUM(COALESCE(seconds, minutes * 60)), 0) AS total FROM focus_sessions WHERE ended_at >= ? AND ended_at < ?').get(start.getTime(), end.getTime()) as {total:number}).total
}

export function addJournal(j: {
  content: string
  scores: Record<DimensionId, number>
  summary: string
  engine: 'llm' | 'local'
}): Journal {
  const ts = Date.now()
  const info = db
    .prepare('INSERT INTO journals (ts, content, scores_json, summary, engine) VALUES (?, ?, ?, ?, ?)')
    .run(ts, j.content, JSON.stringify(j.scores), j.summary, j.engine)
  return { id: Number(info.lastInsertRowid), ts, ...j }
}

// Saving the diary and its growth is atomic, including retries after a lost reply.
export function commitJournal(j: import('../shared/types').JournalCommitInput): import('../shared/types').JournalCommitResult {
  if (!j.token || typeof j.content !== 'string' || !j.content.trim() || j.content.trim().length > 800 ||
      !['llm','local'].includes(j.engine) || !DIMENSIONS.every(d=>Number.isInteger(j.scores?.[d]) && j.scores[d]>=0 && j.scores[d]<=5)) throw Error('日记记录无效')
  return db.transaction(()=>{
    const saved=db.prepare('SELECT result_json FROM journal_commits WHERE token = ?').get(j.token) as {result_json:string}|undefined
    if(saved){
      const result=JSON.parse(saved.result_json) as import('../shared/types').JournalCommitResult
      const state=getState()
      return {...result,growth:{before:state.stats,stats:state.stats,events:[],levelUps:[],growthEpoch:state.growthEpoch}}
    }
    const {token,...entry}=j
    const journal=addJournal(entry),text=j.content.trim(),snippet=text.slice(0,24)+(text.length>24?'…':'')
    const growth=applyGrowth(DIMENSIONS.filter(d=>j.scores[d]>0).map(d=>({dimension:d,points:j.scores[d],source:'journal' as const,reason:snippet,syncCause:'journal:'+token})))
    const result={journal,growth}
    db.prepare('INSERT INTO journal_commits (token, result_json) VALUES (?, ?)').run(token,JSON.stringify(result))
    return result
  })()
}

export function listGrowth(limit = 200): GrowthEvent[] {
  return db
    .prepare('SELECT * FROM growth_events ORDER BY ts DESC, id DESC LIMIT ?')
    .all(limit)
    .map((r) => rowToGrowth(r))
}

export function listJournals(limit = 100): Journal[] {
  return db
    .prepare('SELECT * FROM journals ORDER BY ts DESC, id DESC LIMIT ?')
    .all(limit)
    .map((r) => {
      const row = r as { id: number; ts: number; content: string; scores_json: string; summary: string; engine: string }
      return {
        id: row.id,
        ts: row.ts,
        content: row.content,
        scores: JSON.parse(row.scores_json),
        summary: row.summary,
        engine: row.engine as 'llm' | 'local'
      }
    })
}

export function listFocusSessions(limit = 100): FocusSession[] {
  return db
    .prepare('SELECT * FROM focus_sessions ORDER BY ended_at DESC, id DESC LIMIT ?')
    .all(limit)
    .map((r) => {
      const row = r as { id: number; started_at: number; ended_at: number; minutes: number; seconds: number | null; mode: string; task_label: string }
      return {
        id: row.id,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        minutes: row.minutes,
        seconds: row.seconds ?? undefined,
        mode: row.mode,
        taskLabel: row.task_label
      }
    })
}

export function updateSettings(patch: Partial<Settings>): Settings {
  if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('设置内容无效')
  const saved=JSON.parse((db.prepare('SELECT json FROM settings WHERE id=1').get() as {json:string}).json)
  const current = normalizeSceneSettings({...DEFAULT_SETTINGS,...saved})
  if(patch.llmKey!==undefined&&patch.llmKey!=='')throw Error('请通过模型配置入口保存密钥')
  if(patch.llmEndpoint!==undefined&&patch.llmEndpoint!==current.llmEndpoint||patch.llmModel!==undefined&&patch.llmModel!==current.llmModel)throw Error('请通过模型配置入口修改模型地址和名称')
  const next = normalizeSceneSettings({ ...current, ...patch })
  // Unrelated appearance writes must never discard the only legacy credential
  // when the OS secret store is temporarily unavailable during migration.
  next.llmKey=current.llmKey
  next.themeColor=normalizeThemeColor(patch.themeColor)??current.themeColor
  next.themeMode=patch.themeMode==='wallpaper'||patch.themeMode==='fixed'?patch.themeMode:normalizeThemeColor(patch.themeColor)?'fixed':current.themeMode
  next.autoSceneIntervalSeconds=rotationSeconds(next.autoSceneIntervalSeconds)
  next.autoSceneMode=next.autoSceneMode==='sequence'?'sequence':'random'
  db.prepare('UPDATE settings SET json = ? WHERE id = 1').run(JSON.stringify(next))
  return {...next,llmKey:''}
}

// Main-process-only adapter for the OS-protected model service. Never expose this
// through IPC, the mobile API, exports or renderer state.
export function readLegacyModelSettings():{endpoint:string;model:string;key:string} {
  const row=JSON.parse((db.prepare('SELECT json FROM settings WHERE id=1').get() as {json:string}).json)
  return {endpoint:typeof row.llmEndpoint==='string'?row.llmEndpoint:'',model:typeof row.llmModel==='string'?row.llmModel:'deepseek-chat',key:typeof row.llmKey==='string'?row.llmKey:''}
}
export function clearLegacyModelKey():void {
  db.pragma('secure_delete = ON')
  const row=JSON.parse((db.prepare('SELECT json FROM settings WHERE id=1').get() as {json:string}).json)
  if(row.llmKey){row.llmKey='';db.prepare('UPDATE settings SET json=? WHERE id=1').run(JSON.stringify(row))}
  db.pragma('wal_checkpoint(TRUNCATE)')
}
export function savePublicModelSettings(endpoint:string,model:string):void {
  const row=JSON.parse((db.prepare('SELECT json FROM settings WHERE id=1').get() as {json:string}).json)
  row.llmEndpoint=endpoint;row.llmModel=model
  db.prepare('UPDATE settings SET json=? WHERE id=1').run(JSON.stringify(row))
}

export function exportAll(): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      stats: getState().stats,
      growthEvents: listGrowth(100000),
      focusSessions: listFocusSessions(100000),
      journals: listJournals(100000).map(journal=>COMMERCIAL_EDITION&&journal.engine==='llm'?{...journal,generatedContentNotice:'本条回响总结由 AI 生成，可能有误；正文由用户输入，收获分数可能经过用户调整。'}:journal),
      review: reviewExport()
    },
    null,
    2
  )
}

export function growthCsv(): string {
  const rows = listGrowth(100000)
  const head = 'time,dimension,points,source,reason'
  const lines = rows.map((r) =>
    [new Date(r.ts).toISOString(), r.dimension, r.points, r.source, `"${r.reason.replace(/"/g, '""')}"`].join(',')
  )
  return [head, ...lines].join('\n')
}

// ---- 待办 ----
export function listTodos(): Todo[] {
  return db
    .prepare('SELECT * FROM todos ORDER BY done ASC, priority DESC, id DESC')
    .all()
    .map((r) => {
      const row = r as { id: number; title: string; priority: number; date: string; est_pomos: number; done: number; focus_minutes: number; created_at: number; completed_at: number|null }
      return {
        id: row.id,
        title: row.title,
        priority: row.priority,
        date: row.date,
        estPomos: row.est_pomos,
        done: row.done === 1,
        focusMinutes: row.focus_minutes,
        createdAt: row.created_at,
        completedAt: row.completed_at
      }
    })
}

export function addTodo(t: { title: string; priority: number; date: string; estPomos: number }): void {
  db.prepare('INSERT INTO todos (title, priority, date, est_pomos, done, focus_minutes, created_at) VALUES (?, ?, ?, ?, 0, 0, ?)').run(
    t.title,
    t.priority,
    t.date,
    t.estPomos,
    Date.now()
  )
}

export function toggleTodo(id: number): void {
  db.prepare('UPDATE todos SET completed_at = CASE WHEN done = 0 THEN ? ELSE NULL END, done = 1 - done WHERE id = ?').run(Date.now(), id)
}

export function deleteTodo(id: number): void {
  db.prepare('DELETE FROM todos WHERE id = ?').run(id)
}

export function addTodoFocus(id: number, minutes: number): void {
  db.prepare('UPDATE todos SET focus_minutes = focus_minutes + ? WHERE id = ?').run(minutes, id)
}

// ---- 习惯 ----
export function listHabits(): Habit[] {
  return db.prepare('SELECT * FROM habits WHERE deleted_at IS NULL ORDER BY sort_order ASC, id ASC').all().map((r) => {
    const row = r as { id: number; name: string; dimension: string; weekly_target: number }
    return { id: row.id, name: row.name, dimension: row.dimension as DimensionId, weeklyTarget: row.weekly_target }
  })
}

export function addHabit(h: { name: string; dimension: DimensionId; weeklyTarget: number }): void {
  if(!h.name.trim()||!DIMENSIONS.includes(h.dimension))throw new Error('习惯信息无效')
  db.prepare('INSERT INTO habits (name, dimension, weekly_target, sort_order) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM habits))').run(h.name.trim(), h.dimension, h.weeklyTarget)
}

export function listHabitLogs(): HabitLog[] {
  return db.prepare('SELECT * FROM habit_logs ORDER BY ts DESC').all().map((r) => {
    const row = r as { id: number; habit_id: number; date: string; ts: number }
    return { id: row.id, habitId: row.habit_id, date: row.date, ts: row.ts }
  })
}

export function checkHabit(habitId: number, date: string): boolean {
  return !!db.prepare('SELECT 1 FROM habit_logs WHERE habit_id = ? AND date = ?').get(habitId, date)
}

export function punchHabit(habitId: number): GrowthApplyResult | null {
  return db.transaction(() => {
    const habit = db.prepare('SELECT name, dimension FROM habits WHERE id = ? AND deleted_at IS NULL').get(habitId) as
      { name: string; dimension: DimensionId } | undefined
    if (!habit) throw new Error('习惯不存在')
    const date = localDateKey()
    if (checkHabit(habitId, date)) return null
    db.prepare('INSERT INTO habit_logs (habit_id, date, ts) VALUES (?, ?, ?)').run(habitId, date, Date.now())
    // Log and points commit together. A repeated request returns no new growth.
    return applyGrowth([{ dimension: habit.dimension, points: 1, source: 'habit',syncCause:'habit:'+habitId+':'+date, reason: `习惯打卡 · ${habit.name}` }])
  })()
}

// ---- 日历 ----
export function listEvents(): CalEvent[] {
  return db.prepare('SELECT * FROM events ORDER BY date ASC').all().map((r) => {
    const row = r as { id: number; title: string; date: string; kind: string }
    return { id: row.id, title: row.title, date: row.date, kind: row.kind as CalEvent['kind'] }
  })
}

export function addEvent(e: { title: string; date: string; kind: CalEvent['kind'] }): void {
  db.prepare('INSERT INTO events (title, date, kind) VALUES (?, ?, ?)').run(e.title, e.date, e.kind)
}

export function deleteEvent(id: number): void {
  db.prepare('DELETE FROM events WHERE id = ?').run(id)
}

function rowToGrowth(r: unknown): GrowthEvent {
  const row = r as { id: number; ts: number; dimension: string; points: number; source: string; reason: string }
  return {
    id: row.id,
    ts: row.ts,
    dimension: row.dimension as DimensionId,
    points: row.points,
    source: row.source as GrowthSource,
    reason: row.reason
  }
}

// Month reads use the database directly, independent of the recent-100 lists.
export function calendarMonth(month:string): CalendarEntry[] {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('月份无效')
  const [y,m]=month.split('-').map(Number),start=new Date(y,m-1,1).getTime(),end=new Date(y,m,1).getTime()
  const entries:CalendarEntry[]=[]
  for(const t of listTodos()){
    if(t.date.startsWith(month)&&(!t.completedAt||localDateKey(new Date(t.completedAt))!==t.date))entries.push({id:'todo-plan-'+t.id,date:t.date,kind:'todo',title:t.title,detail:t.done?'此待办已完成':'计划在这一天完成',state:t.done?'计划 · 已完成':'待办计划'})
    if(t.completedAt&&t.completedAt>=start&&t.completedAt<end)entries.push({id:'todo-done-'+t.id,date:localDateKey(new Date(t.completedAt)),kind:'todo',title:t.title,detail:'完成待办',state:'已完成',ts:t.completedAt})
  }
  const punches=db.prepare('SELECT l.*, h.name FROM habit_logs l LEFT JOIN habits h ON l.habit_id=h.id WHERE l.date LIKE ? ORDER BY l.ts').all(month+'-%') as Array<{id:number;date:string;ts:number;name:string}>
  for(const h of punches)entries.push({id:'habit-'+h.id,date:h.date,kind:'habit',title:h.name??'习惯打卡',detail:'已打卡',ts:h.ts})
  const journals=db.prepare('SELECT * FROM journals WHERE ts >= ? AND ts < ?').all(start,end) as Array<{id:number;ts:number;content:string;summary:string}>
  for(const j of journals)entries.push({id:'journal-'+j.id,date:localDateKey(new Date(j.ts)),kind:'journal',title:'当天日记',detail:j.content,ts:j.ts})
  const sessions=db.prepare('SELECT * FROM focus_sessions WHERE ended_at >= ? AND ended_at < ?').all(start,end) as Array<{id:number;ended_at:number;seconds:number|null;minutes:number;task_label:string}>
  for(const f of sessions)entries.push({id:'focus-'+f.id,date:localDateKey(new Date(f.ended_at)),kind:'focus',title:f.task_label||'自由专注',detail:`专注 ${Math.floor((f.seconds??f.minutes*60)/60)} 分 ${(f.seconds??f.minutes*60)%60} 秒`,ts:f.ended_at})
  for(const e of listEvents().filter(e=>e.date.startsWith(month)))entries.push({id:'event-'+e.id,date:e.date,kind:'event',title:e.title,detail:e.kind})
  return entries.sort((a,b)=>a.date.localeCompare(b.date)||(a.ts??0)-(b.ts??0))
}

export function reorderHabits(ids:number[]):void {
 db.transaction(()=>{
  const active=listHabits().map(h=>h.id)
  if(!Array.isArray(ids)||ids.length!==active.length||new Set(ids).size!==ids.length||ids.some(id=>!Number.isSafeInteger(id)||!active.includes(id)))throw new Error('习惯列表已改变，请刷新后再排序')
  const update=db.prepare('UPDATE habits SET sort_order=? WHERE id=?')
  ids.forEach((id,i)=>update.run(i,id))
 })()
}
export function deleteHabit(id:number):void {db.prepare('UPDATE habits SET deleted_at=? WHERE id=? AND deleted_at IS NULL').run(Date.now(),id)}
export function restoreHabit(id:number):void {db.prepare('UPDATE habits SET deleted_at=NULL,sort_order=(SELECT COALESCE(MAX(sort_order),0)+1 FROM habits) WHERE id=? AND deleted_at IS NOT NULL').run(id)}
