import type Database from 'better-sqlite3'
import {DIMENSIONS} from './types'
import type {SyncPacket,SyncRecord,SyncRegister,SyncVector,SyncConflict} from './lanSyncTypes'

type Row=Record<string,any>
type Stored={table_name:string;uid:string;local_id:string|null;doc_json:string;snapshot_json:string}
type Spec={key:string;columns:string[];counters?:string[];text?:string[]}
const specs:Record<string,Spec>={
 habits:{key:'id',columns:['name','dimension','weekly_target','sort_order','deleted_at'],text:['name']},
 todos:{key:'id',columns:['title','priority','date','est_pomos','done','focus_minutes','created_at','completed_at'],counters:['focus_minutes'],text:['title']},
 focus_sessions:{key:'id',columns:['started_at','ended_at','minutes','seconds','mode','task_label','sync_token']},
 journals:{key:'id',columns:['ts','content','scores_json','summary','engine'],text:['content','summary']},
 events:{key:'id',columns:['title','date','kind'],text:['title']},
 review_cards:{key:'id',columns:['question','answer','topic','sourcePath','dueDate','intervalDays','reviews','archived','createdAt','updatedAt'],counters:['reviews'],text:['question','answer','topic']},
 habit_logs:{key:'id',columns:['habit_id','date','ts']},
 review_logs:{key:'token',columns:['cardId','rating','ts','previousDue','nextDue','intervalDays']},
 growth_events:{key:'id',columns:['ts','dimension','points','source','reason']},
 balances:{key:'id',columns:[...DIMENSIONS]}
}
const tables=Object.keys(specs).filter(t=>t!=='balances')
const defaultHabits=[['阅读30分钟','knowledge'],['当日复盘','will'],['背单词','knowledge'],['运动','craft'],['喝水','will'],['早睡','will'],['整理书桌','craft']]
const stable=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)
const same=(a:unknown,b:unknown)=>stable(a)===stable(b)
const stampKey=(r:SyncRegister)=>r.clock+':'+r.device
const compare=(a:SyncRegister,b:SyncRegister)=>a.clock-b.clock||a.device.localeCompare(b.device,'en')
const dominates=(a:SyncRegister,b:SyncRegister)=>a.device===b.device?a.clock>=b.clock:(a.seen[b.device]??0)>=b.clock
const publicValue=(v:unknown)=>typeof v==='string'?v:JSON.stringify(v)

/** Local numeric IDs never cross the network. The sidecar keeps durable global IDs,
 * field revisions, delete markers and counter contributions alongside existing data. */
export class LanSyncEngine {
 readonly deviceId:string
 private vector:SyncVector={}
 private clock=0
 constructor(private db:Database.Database){
  db.exec(`CREATE TABLE IF NOT EXISTS sync_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS sync_rows(table_name TEXT NOT NULL,uid TEXT NOT NULL,local_id TEXT,doc_json TEXT NOT NULL,snapshot_json TEXT NOT NULL,PRIMARY KEY(table_name,uid),UNIQUE(table_name,local_id));
   CREATE TABLE IF NOT EXISTS sync_conflicts(id TEXT PRIMARY KEY,detail TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS sync_backups(id INTEGER PRIMARY KEY AUTOINCREMENT,ts INTEGER NOT NULL,body TEXT NOT NULL);`)
  this.deviceId=this.getMeta('deviceId','')||crypto.randomUUID();this.setMeta('deviceId',this.deviceId)
  this.reloadClock()
 }
 getMeta<T>(key:string,fallback:T):T {const r=this.db.prepare('SELECT value FROM sync_meta WHERE key=?').get(key) as {value:string}|undefined;return r?JSON.parse(r.value):fallback}
 setMeta(key:string,value:unknown){this.db.prepare('INSERT OR REPLACE INTO sync_meta(key,value) VALUES (?,?)').run(key,JSON.stringify(value))}
 private reloadClock(){this.vector=this.getMeta<SyncVector>('vector',{});this.clock=this.getMeta<number>('clock',0)}
 private saveClock(){this.setMeta('vector',this.vector);this.setMeta('clock',this.clock)}
 private stamp(value:unknown):SyncRegister {const seen={...this.vector};this.clock=Math.max(this.clock,...Object.values(this.vector),0)+1;this.vector[this.deviceId]=this.clock;return {value,clock:this.clock,device:this.deviceId,seen}}
 private rows():Stored[]{return this.db.prepare('SELECT * FROM sync_rows').all() as Stored[]}
 private put(r:Stored){this.db.prepare('INSERT OR REPLACE INTO sync_rows(table_name,uid,local_id,doc_json,snapshot_json) VALUES (?,?,?,?,?)').run(r.table_name,r.uid,r.local_id,r.doc_json,r.snapshot_json)}
 private findLocal(table:string,id:unknown):Stored|undefined{return this.db.prepare('SELECT * FROM sync_rows WHERE table_name=? AND local_id=?').get(table,String(id)) as Stored|undefined}
 private findUid(table:string,uid:string):Stored|undefined{return this.db.prepare('SELECT * FROM sync_rows WHERE table_name=? AND uid=?').get(table,uid) as Stored|undefined}
 private ref(table:string,id:unknown):string {const r=this.findLocal(table,id);if(!r)throw Error('同步引用缺失，请重试。');return r.uid}
 private uid(table:string,row:Row):string {
  if(table==='habits') {const i=Number(row.id)-1;if(defaultHabits[i]?.[0]===row.name&&defaultHabits[i]?.[1]===row.dimension&&row.weekly_target===7)return 'default-habit-'+(i+1)}
  if(table==='review_cards')return 'card:'+encodeURIComponent(row.id)
  if(table==='review_logs')return 'review:'+encodeURIComponent(row.token)
  if(table==='habit_logs')return 'punch:'+this.ref('habits',row.habit_id)+':'+row.date
  if(table==='focus_sessions'&&row.sync_token)return 'focus:'+encodeURIComponent(row.sync_token)
  if(table==='growth_events'){
   if(typeof row.sync_cause==='string'&&row.sync_cause.startsWith('focus:'))return 'growth:'+encodeURIComponent(row.sync_cause)+':'+row.dimension
   if(typeof row.sync_cause==='string'&&row.sync_cause.startsWith('habit:')){const [,id,date]=row.sync_cause.split(':');return 'growth:punch:'+this.ref('habits',id)+':'+date+':'+row.dimension}
   // Upgrade old same-day punches to the same identity on both installations.
   if(row.source==='habit'){
    const hit=this.db.prepare('SELECT l.habit_id,l.date FROM habit_logs l JOIN habits h ON h.id=l.habit_id WHERE h.dimension=? AND ? = ? || h.name AND ABS(l.ts-?)<2000 ORDER BY ABS(l.ts-?) LIMIT 1').get(row.dimension,row.reason,'习惯打卡 · ',row.ts,row.ts) as Row|undefined
    if(hit)return 'growth:punch:'+this.ref('habits',hit.habit_id)+':'+hit.date+':'+row.dimension
   }
  }
  return crypto.randomUUID()
 }
 private canonical(table:string,row:Row):Row {
  const value:Row=Object.fromEntries(specs[table].columns.map(k=>[k,row[k]??null]))
  if(table==='habit_logs')value.habit_id=this.ref('habits',row.habit_id)
  if(table==='review_logs')value.cardId=this.ref('review_cards',row.cardId)
  if(table==='review_cards'){value.schedule={dueDate:row.dueDate,intervalDays:row.intervalDays,updatedAt:row.updatedAt};delete value.dueDate;delete value.intervalDays;delete value.updatedAt}
  return value
 }
 capture(){this.db.transaction(()=>{
  this.reloadClock()
  for(const table of tables){
   const spec=specs[table],present=new Set<string>()
   for(const row of this.db.prepare(`SELECT * FROM ${table}`).all() as Row[]){
    const local=String(row[spec.key]);present.add(local)
    const old=this.findLocal(table,local),canonical=this.canonical(table,row)
    const previous:Row|null=old?JSON.parse(old.snapshot_json):null
    const uid=old?.uid??this.uid(table,row),existing=old??this.findUid(table,uid)
    if(existing&&existing.local_id!==null&&existing.local_id!==local)throw Error('本机存在重复记录，请先导出记录再检查。')
    const initialSeed=!existing&&table==='habits'&&uid.startsWith('default-habit-')
    const defaultOrder=initialSeed?(this.db.prepare('SELECT id FROM habits WHERE id BETWEEN 1 AND 7 ORDER BY sort_order,id').all() as Row[]).every((r,i)=>Number(r.id)===i+1):false
    const initial=(v:unknown)=>initialSeed?{value:v,clock:0,device:'seed',seen:{}}:this.stamp(v)
    const doc:SyncRecord=existing?JSON.parse(existing.doc_json):{table,uid,fields:{},deleted:initial(false)}
    let changed=!existing
    for(const [field,value] of Object.entries(canonical)){
     if(previous&&same(value,previous[field]))continue
     if(spec.counters?.includes(field)){
      const key=field+'@'+this.deviceId,part=doc.fields[key]?.value??0,delta=Number(value)-Number(previous?.[field]??0)
      doc.fields[key]=initial(Number(part)+delta)
     }else if(initialSeed&&field==='sort_order'&&defaultOrder)doc.fields[field]=initial(Number(row.id)-1)
     else doc.fields[field]=initialSeed&&(['name','dimension','weekly_target'].includes(field)||(field==='deleted_at'&&value===null))?initial(value):this.stamp(value)
     changed=true
    }
    if(doc.deleted.value===true){doc.deleted=this.stamp(false);changed=true}
    if(changed||!old)this.put({table_name:table,uid,local_id:local,doc_json:JSON.stringify(doc),snapshot_json:JSON.stringify(canonical)})
   }
   for(const r of this.db.prepare('SELECT * FROM sync_rows WHERE table_name=?').all(table) as Stored[]){
    if(r.local_id===null||present.has(r.local_id))continue
    const doc=JSON.parse(r.doc_json) as SyncRecord
    if(doc.deleted.value!==true){doc.deleted=this.stamp(true);r.doc_json=JSON.stringify(doc);r.snapshot_json='null';this.put(r)}
   }
  }
  // Carry any pre-existing score balance not represented by event rows, without copying totals twice.
  const stats=JSON.parse((this.db.prepare('SELECT points_json FROM stats WHERE id=1').get() as Row).points_json)
  const events=Object.fromEntries(DIMENSIONS.map(d=>[d,0])) as Record<string,number>
  for(const r of this.db.prepare('SELECT dimension,SUM(points) n FROM growth_events GROUP BY dimension').all() as Row[])events[r.dimension]=r.n
  const balances=this.rows().filter(r=>r.table_name==='balances').map(r=>JSON.parse(r.doc_json) as SyncRecord)
  const uid=this.deviceId,existing=this.findUid('balances',uid)
  const own:SyncRecord=existing?JSON.parse(existing.doc_json):{table:'balances',uid,fields:{},deleted:this.stamp(false)}
  let changed=false
  for(const d of DIMENSIONS){const total=balances.filter(r=>!r.deleted.value).reduce((n,r)=>n+Number(r.fields[d]?.value??0),0);const delta=Number(stats[d]??0)-events[d]-total
   if(delta!==0){own.fields[d]=this.stamp(Number(own.fields[d]?.value??0)+delta);changed=true}}
  if(changed){for(const d of DIMENSIONS)own.fields[d]??=this.stamp(0);this.put({table_name:'balances',uid,local_id:null,doc_json:JSON.stringify(own),snapshot_json:'null'})}
  this.saveClock()
 })()}
 packet(known:SyncVector={}):SyncPacket {
  this.capture()
  return {version:1,device:this.deviceId,vector:{...this.vector},records:this.rows().map(r=>JSON.parse(r.doc_json) as SyncRecord).filter(r=>[r.deleted,...Object.values(r.fields)].some(s=>s.device==='seed'||s.clock>(known[s.device]??0)))}
 }
 private validate(input:unknown):SyncPacket {
  if(!input||typeof input!=='object')throw Error('同步数据格式无效。')
  const p=input as SyncPacket
  const id=(v:unknown,max=512)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v)
  const vector=(v:unknown):v is SyncVector=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.entries(v).length<=100&&Object.entries(v).every(([k,n])=>id(k,80)&&Number.isSafeInteger(n)&&n>=0&&n<1e12)
  if(p.version!==1||!id(p.device,80)||!vector(p.vector)||!Array.isArray(p.records)||p.records.length>50000)throw Error('同步版本或数据范围无效。')
  const seen=new Set<string>()
  for(const r of p.records){
   const spec=Object.hasOwn(specs,r?.table)?specs[r.table]:undefined;if(!spec||!id(r.uid)||!r.fields||typeof r.fields!=='object'||Array.isArray(r.fields)||Object.keys(r.fields).length>150)throw Error('同步记录无效。')
   const key=r.table+'|'+r.uid;if(seen.has(key))throw Error('同步记录重复。');seen.add(key)
   const expected=spec.columns.filter(k=>!(r.table==='review_cards'&&['dueDate','intervalDays','updatedAt'].includes(k)))
   if(r.table==='review_cards')expected.push('schedule')
   for(const name of expected)if(spec.counters?.includes(name)?!Object.keys(r.fields).some(k=>k.startsWith(name+'@')):!r.fields[name])throw Error('同步记录缺少字段。')
   for(const [name,reg] of [...Object.entries(r.fields),['$deleted',r.deleted] as [string,SyncRegister]]){
    if(!reg||typeof reg!=='object'||!id(reg.device,80)||!Number.isSafeInteger(reg.clock)||reg.clock<0||reg.clock>(p.vector[reg.device]??0)||!vector(reg.seen))throw Error('同步修订无效。')
    const counter=spec.counters?.find(c=>name.startsWith(c+'@'))
    if(name!=='$deleted'&&!expected.includes(name)&&!counter)throw Error('同步字段无效。')
    if(counter&&!id(name.slice(counter.length+1),80))throw Error('计数字段无效。')
    if(name==='$deleted'){if(typeof reg.value!=='boolean')throw Error('删除标记无效。');continue}
    const value=reg.value
    if(!counter&&name!=='schedule'){
     const numeric=new Set(['weekly_target','sort_order','deleted_at','priority','est_pomos','done','created_at','completed_at','started_at','ended_at','minutes','seconds','ts','archived','createdAt','intervalDays','points',...DIMENSIONS])
     const nullable=['deleted_at','completed_at','seconds','sync_token'].includes(name)
     if(value===null&&!nullable)throw Error('同步字段不能为空。')
     if(value!==null&&(numeric.has(name)?typeof value!=='number':typeof value!=='string'))throw Error('同步字段类型不符。')
    }
    if(counter){if(!Number.isSafeInteger(value)||Math.abs(Number(value))>1e9)throw Error('同步计数无效。');continue}
    if(name==='schedule'){const v=value as Row;if(!v||typeof v.dueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.dueDate)||!Number.isInteger(v.intervalDays)||v.intervalDays<0||v.intervalDays>3650||!Number.isFinite(v.updatedAt))throw Error('复习安排无效。');continue}
    if(value!==null&&typeof value!=='string'&&typeof value!=='number')throw Error('同步字段类型无效。')
    if(typeof value==='number'&&(!Number.isFinite(value)||Math.abs(value)>1e15))throw Error('同步数字无效。')
    if(typeof value==='string'&&value.length>200000)throw Error('同步文字过长。')
    if(name==='dimension'&&!DIMENSIONS.includes(value as any))throw Error('成长维度无效。')
    if(name==='points'&&(!Number.isFinite(value)||Number(value)<0||Number(value)>1000000))throw Error('成长分值无效。')
    if(name==='scores_json'){try{const scores=JSON.parse(String(value));if(!scores||DIMENSIONS.some(d=>!Number.isFinite(scores[d])||scores[d]<0))throw Error()}catch{throw Error('日记评分无效。')}}
   }
  }
  return p
 }
 private conflict(table:string,uid:string,field:string,a:SyncRegister,b:SyncRegister){
  if(!specs[table].text?.includes(field)||a.device==='seed'||b.device==='seed'||same(a.value,b.value)||dominates(a,b)||dominates(b,a))return
  const [winner,other]=compare(a,b)>=0?[a,b]:[b,a],id=table+'|'+uid+'|'+field+'|'+[stampKey(a),stampKey(b)].sort().join('|')
  this.db.prepare('INSERT OR IGNORE INTO sync_conflicts(id,detail) VALUES (?,?)').run(id,JSON.stringify({id,table,uid,field,winner,other}))
 }
 merge(input:unknown):number {
  const p=this.validate(input)
  return this.db.transaction(()=>{
   this.capture()
   for(const incoming of p.records){
    const stored=this.findUid(incoming.table,incoming.uid)
    if(!stored){this.put({table_name:incoming.table,uid:incoming.uid,local_id:null,doc_json:JSON.stringify(incoming),snapshot_json:'null'});continue}
    const doc=JSON.parse(stored.doc_json) as SyncRecord
    for(const [name,value] of Object.entries(incoming.fields)){
     const previous=doc.fields[name];if(previous)this.conflict(doc.table,doc.uid,name,previous,value)
     if(!previous||compare(value,previous)>0)doc.fields[name]=value
    }
    if(compare(incoming.deleted,doc.deleted)>0)doc.deleted=incoming.deleted
    stored.doc_json=JSON.stringify(doc);this.put(stored)
   }
   for(const [d,n] of Object.entries(p.vector))this.vector[d]=Math.max(this.vector[d]??0,n)
   const changed=this.materialize();this.saveClock();return changed
  })()
 }
 private materialize():number {
  let changes=0
  for(const table of tables){
   const spec=specs[table]
   for(const stored of this.db.prepare('SELECT * FROM sync_rows WHERE table_name=?').all(table) as Stored[]){
    const doc=JSON.parse(stored.doc_json) as SyncRecord
    const before=stored.local_id===null?undefined:this.db.prepare(`SELECT * FROM ${table} WHERE ${spec.key}=?`).get(stored.local_id) as Row|undefined
    if(doc.deleted.value){if(before){this.db.prepare(`DELETE FROM ${table} WHERE ${spec.key}=?`).run(stored.local_id);changes++}stored.snapshot_json='null';this.put(stored);continue}
    const row:Row={}
    for(const [field,reg] of Object.entries(doc.fields))if(!field.includes('@'))row[field]=reg.value
    for(const counter of spec.counters??[])row[counter]=Math.max(0,Object.entries(doc.fields).filter(([k])=>k.startsWith(counter+'@')).reduce((n,[,r])=>n+Number(r.value),0))
    if(table==='review_cards'){Object.assign(row,row.schedule);delete row.schedule}
    if(table==='habit_logs'){const parent=this.findUid('habits',String(row.habit_id));if(parent?.local_id==null)throw Error('打卡缺少所属习惯，同步已回滚。');row.habit_id=Number(parent.local_id)}
    if(table==='review_logs'){const parent=this.findUid('review_cards',String(row.cardId));if(parent?.local_id==null)throw Error('复习记录缺少卡片，同步已回滚。');row.cardId=parent.local_id}
    if(table==='review_cards')row.sourceRoot=before?.sourceRoot??''
    const different=!before||Object.entries(row).some(([k,v])=>!same(v,before[k]))
    if(different){
     if(table==='review_cards')row.version=Number(before?.version??0)+1
     if(before){const cols=Object.keys(row);this.db.prepare(`UPDATE ${table} SET ${cols.map(k=>'"'+k+'"=?').join(',')} WHERE ${spec.key}=?`).run(...cols.map(k=>row[k]),stored.local_id)}
     else{
      if(stored.local_id!==null)row[spec.key]=spec.key==='token'||table==='review_cards'?stored.local_id:Number(stored.local_id)
      else if(table==='review_cards')row.id=decodeURIComponent(doc.uid.slice(5))
      else if(table==='review_logs')row.token=decodeURIComponent(doc.uid.slice(7))
      const cols=Object.keys(row),result=this.db.prepare(`INSERT INTO ${table} (${cols.map(k=>'"'+k+'"').join(',')}) VALUES (${cols.map(()=>'?').join(',')})`).run(...cols.map(k=>row[k]))
      stored.local_id=String(row[spec.key]??result.lastInsertRowid)
     }
     changes++
    }
    stored.snapshot_json=JSON.stringify(this.canonical(table,row));this.put(stored)
   }
  }
  const points=Object.fromEntries(DIMENSIONS.map(d=>[d,0])) as Record<string,number>
  for(const r of this.db.prepare('SELECT dimension,SUM(points) n FROM growth_events GROUP BY dimension').all() as Row[])points[r.dimension]=r.n
  for(const r of this.db.prepare("SELECT doc_json FROM sync_rows WHERE table_name='balances'").all() as Row[]){const doc=JSON.parse(r.doc_json) as SyncRecord;if(!doc.deleted.value)for(const d of DIMENSIONS)points[d]+=Number(doc.fields[d]?.value??0)}
  for(const d of DIMENSIONS)points[d]=Math.max(0,points[d])
  const old=JSON.parse((this.db.prepare('SELECT points_json FROM stats WHERE id=1').get() as Row).points_json)
  if(!same(points,old)){this.db.prepare('UPDATE stats SET points_json=? WHERE id=1').run(JSON.stringify(points));changes++}
  if(changes)this.db.exec('UPDATE growth_meta SET epoch=epoch+1 WHERE id=1')
  return changes
 }
 conflicts():SyncConflict[]{return (this.db.prepare('SELECT detail FROM sync_conflicts ORDER BY id').all() as Row[]).flatMap(r=>{
  const d=JSON.parse(r.detail),stored=this.findUid(d.table,d.uid)
  if(!stored)return []
  const doc=JSON.parse(stored.doc_json) as SyncRecord,current=doc.fields[d.field]
  // A later causal revision (including an explicit choice on the other device)
  // settles this pair of versions. Keep the archived alternatives in the database.
  if(doc.deleted.value||current&&stampKey(current)!==stampKey(d.winner)&&dominates(current,d.winner)&&dominates(current,d.other))return []
  return [{id:d.id,table:d.table,field:d.field,winner:publicValue(d.winner.value),other:publicValue(d.other.value)}]
 })}
 resolve(id:string,useOther:boolean){this.db.transaction(()=>{
  this.capture();const raw=this.db.prepare('SELECT detail FROM sync_conflicts WHERE id=?').get(id) as Row|undefined;if(!raw)return
  const c=JSON.parse(raw.detail),stored=this.findUid(c.table,c.uid);if(!stored)throw Error('记录已不存在。')
  const doc=JSON.parse(stored.doc_json) as SyncRecord
  if(useOther&&stampKey(doc.fields[c.field])!==stampKey(c.winner))throw Error('这条记录已有新修改，请保留新版并检查内容。')
  // Keeping the current text is also a new decision and must reach every peer.
  doc.fields[c.field]=this.stamp(useOther?c.other.value:doc.fields[c.field].value)
  stored.doc_json=JSON.stringify(doc);this.put(stored);this.materialize();this.saveClock()
  this.db.prepare('DELETE FROM sync_conflicts WHERE id=?').run(id)
 })()}
 hasBackup():boolean{return !!this.db.prepare('SELECT id FROM sync_backups LIMIT 1').get()}
 backup(){if(this.hasBackup())return;const body=JSON.stringify({version:1,createdAt:new Date().toISOString(),stats:JSON.parse((this.db.prepare('SELECT points_json FROM stats WHERE id=1').get() as Row).points_json),tables:Object.fromEntries(tables.map(t=>[t,this.db.prepare(`SELECT * FROM ${t}`).all()]))});this.db.prepare('INSERT INTO sync_backups(ts,body) VALUES (?,?)').run(Date.now(),body)}
 exportBackup():string{const r=this.db.prepare('SELECT body FROM sync_backups ORDER BY id DESC LIMIT 1').get() as Row|undefined;if(!r)throw Error('尚未进行首次同步，没有配对前备份。');return r.body}
}
