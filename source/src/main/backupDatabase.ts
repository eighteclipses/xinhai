import type Database from 'better-sqlite3'
import { BACKUP_SCHEMA, BACKUP_TABLES, BACKUP_SEQUENCES, parseDatabaseSnapshot, validateDatabaseSnapshot, type BackupRow, type DatabaseSnapshot } from '../shared/backupDatabase'
import { DEFAULT_SETTINGS } from '../shared/types'

export function initBackupDatabase(db:Database.Database):void {
  db.exec('CREATE TABLE IF NOT EXISTS pending_client_restore (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS device_resources (key TEXT PRIMARY KEY,value TEXT NOT NULL)')
  if(!(db.prepare('PRAGMA table_info(pending_client_restore)').all() as Array<{name:string}>).some(c=>c.name==='token'))db.exec("ALTER TABLE pending_client_restore ADD COLUMN token TEXT NOT NULL DEFAULT ''")
}
export function pendingClientRestore(db:Database.Database):{token:string;state:Record<string,string>}|null {
  return db.transaction(()=>{
    const row=db.prepare('SELECT body,token FROM pending_client_restore WHERE id=1').get() as {body:string;token:string}|undefined
    if(!row)return null
    if(!row.token){row.token=crypto.randomUUID();db.prepare('UPDATE pending_client_restore SET token=? WHERE id=1').run(row.token)}
    return {token:row.token,state:JSON.parse(row.body)}
  })()
}
export function acknowledgeClientRestore(db:Database.Database,token:string):void {
  if(typeof token!=='string'||!token)throw Error('恢复队列标识无效')
  db.prepare('DELETE FROM pending_client_restore WHERE id=1 AND token=?').run(token)
}
function checkSchema(db:Database.Database):void {
  for(const table of BACKUP_TABLES){
    const actual=(db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>).map(c=>c.name).sort()
    const expected=Object.keys(BACKUP_SCHEMA[table]).sort()
    if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('数据库结构已改变，当前备份格式不支持：'+table)
  }
}

/** Internal snapshot only. The archive coordinator must still include and remap all files. */
export function captureDatabaseSnapshot(db:Database.Database,clientState:Record<string,string>):DatabaseSnapshot {
  checkSchema(db)
  return db.transaction(()=>{
    const tables=Object.fromEntries(BACKUP_TABLES.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY ${Object.keys(BACKUP_SCHEMA[table])[0]}`).all()])) as DatabaseSnapshot['tables']
    const original=JSON.parse(String(tables.settings[0].json))
    const settings=Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(key=>[key,original[key]??DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS]]))
    // Do not export credentials, embedded endpoint credentials, or provider-specific configuration.
    settings.llmKey='';settings.llmEndpoint='';settings.llmModel=''
    tables.settings[0].json=JSON.stringify(settings)
    const sequences=Object.fromEntries((db.prepare('SELECT name,seq FROM sqlite_sequence').all() as Array<{name:string;seq:number}>).filter(r=>BACKUP_SEQUENCES.includes(r.name as never)).map(r=>[r.name,r.seq]))
    return parseDatabaseSnapshot(JSON.stringify({format:'xinhai-database-snapshot',version:3,createdAt:Date.now(),tables,sequences,clientState}))
  })()
}

export interface RestoreResources { knowledgeRoot:string; androidKnowledgeRoot?:string }
/**
 * Low-level transaction, invoked only through the full-archive coordinator. The
 * coordinator must validate/materialize media, keep a safety backup, stop LAN sync,
 * and supply a snapshot whose file URLs already point at the new private files.
 * No existing files are modified by this function. The caller restarts the renderer
 * after success so pending client drafts replay before stores are initialized.
 */
export function replaceDatabaseFromSnapshot(db:Database.Database,value:unknown,resources:RestoreResources):void {
  const snapshot=validateDatabaseSnapshot(value);checkSchema(db)
  if(typeof resources.knowledgeRoot!=='string'||!resources.knowledgeRoot)throw Error('缺少已验证的恢复知识库目录')
  const tables=JSON.parse(JSON.stringify(snapshot.tables)) as DatabaseSnapshot['tables']
  const current=JSON.parse(String((db.prepare('SELECT json FROM settings WHERE id=1').get() as BackupRow).json))
  const settings=JSON.parse(String(tables.settings[0].json))
  for(const key of ['llmKey','llmEndpoint','llmModel'])settings[key]=current[key]??DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS]
  const oldKnowledgeRoot=settings.knowledgePath
  for(const row of tables.local_knowledge_categories)if(row.root===oldKnowledgeRoot)row.root=resources.knowledgeRoot
  settings.knowledgePath=resources.knowledgeRoot;tables.settings[0].json=JSON.stringify(settings)
  db.transaction(()=>{
    for(const table of BACKUP_TABLES)db.prepare(`DELETE FROM ${table}`).run()
    for(const table of BACKUP_TABLES){
      const cols=Object.keys(BACKUP_SCHEMA[table]),insert=db.prepare(`INSERT INTO ${table} (${cols.map(c=>'"'+c+'"').join(',')}) VALUES (${cols.map(()=>'?').join(',')})`)
      for(const row of tables[table])insert.run(...cols.map(c=>row[c]))
    }
    for(const name of BACKUP_SEQUENCES){db.prepare('DELETE FROM sqlite_sequence WHERE name=?').run(name);if(snapshot.sequences[name]!==undefined)db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)').run(name,snapshot.sequences[name])}
    db.prepare('INSERT OR REPLACE INTO pending_client_restore(id,body,token) VALUES (1,?,?)').run(JSON.stringify(snapshot.clientState),crypto.randomUUID())
    if(resources.androidKnowledgeRoot){
      db.prepare('INSERT OR REPLACE INTO device_resources(key,value) VALUES (?,?)').run('knowledgeLocalRoot',resources.androidKnowledgeRoot)
      db.prepare('INSERT OR REPLACE INTO device_resources(key,value) VALUES (?,?)').run('knowledgeTree','')
    }
    // Restored records must never be sent using the old device's pairing or cached CRDT history.
    for(const table of ['sync_meta','sync_rows','sync_conflicts','sync_backups'])db.prepare(`DELETE FROM ${table}`).run()
    db.prepare('INSERT OR REPLACE INTO app_migrations(key,value) VALUES (?,?)').run('habits-initialized-v1','1')
  })()
}
