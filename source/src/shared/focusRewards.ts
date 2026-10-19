import type Database from 'better-sqlite3'
import {DIMENSIONS,levelOf,type FocusRewardPresentation,type FocusRewardState,type GrowthApplyResult} from './types'

export const FOCUS_NOTE_SECONDS=25*60
export const focusRewardCause=(id:string)=>'focus:reward-v1:'+id
export function initFocusRewards(db:Database.Database):void {
 db.exec(`CREATE TABLE IF NOT EXISTS focus_reward_sessions(token TEXT PRIMARY KEY,seconds INTEGER NOT NULL,ended_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS focus_reward_blocks(id TEXT PRIMARY KEY,ts INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS focus_reward_presentations(token TEXT PRIMARY KEY,block_ids TEXT NOT NULL,session_tokens TEXT NOT NULL,ts INTEGER NOT NULL,acknowledged INTEGER NOT NULL DEFAULT 0);`)
}
const stats=(db:Database.Database)=>JSON.parse((db.prepare('SELECT points_json FROM stats WHERE id=1').get() as {points_json:string}).points_json)
/** Immutable unique contributions and monotonically numbered blocks survive resets.
 * A block already accounted for is never regenerated when its growth was cleared. */
export function reconcileFocusRewards(db:Database.Database,now=Date.now()):GrowthApplyResult {
 const before=stats(db),next={...before},events:GrowthApplyResult['events']=[]
 const total=Number((db.prepare('SELECT COALESCE(SUM(seconds),0) AS n FROM focus_reward_sessions').get() as {n:number}).n)
 const count=Math.floor(total/FOCUS_NOTE_SECONDS)
 if(!Number.isSafeInteger(total)||total<0||count>1_000_000)throw Error('专注音符账本超出有效范围')
 const known=new Set((db.prepare('SELECT id FROM focus_reward_blocks').all() as {id:string}[]).map(row=>row.id))
 if([...known].some(id=>!/^[1-9]\d{0,6}$/.test(id)||Number(id)>count))throw Error('专注音符区块与贡献总量不符')
 for(let i=1;i<=count;i++){
  const id=String(i);if(known.has(id))continue
  db.prepare('INSERT INTO focus_reward_blocks(id,ts) VALUES (?,?)').run(id,now)
  known.add(id)
  const cause=focusRewardCause(id)
  // A restored/imported canonical event also reserves its block identity.
  if(db.prepare('SELECT 1 FROM growth_events WHERE sync_cause=?').get(cause))continue
  const result=db.prepare('INSERT INTO growth_events(ts,dimension,points,source,reason,sync_cause) VALUES (?,?,?,?,?,?)').run(now,'knowledge',1,'focus','累计有效专注满 25 分钟',cause)
  next.knowledge+=1
  events.push({id:Number(result.lastInsertRowid),ts:now,dimension:'knowledge',points:1,source:'focus',reason:'累计有效专注满 25 分钟'})
 }
 const causes=new Set<string>()
 for(const row of db.prepare('SELECT dimension,points,source,sync_cause FROM growth_events').all() as {dimension:string;points:number;source:string;sync_cause:string|null}[]){
  if(!row.sync_cause?.startsWith('focus:reward-v1:'))continue
  const id=row.sync_cause.slice('focus:reward-v1:'.length)
  if(!known.has(id)||causes.has(row.sync_cause)||row.dimension!=='knowledge'||row.points!==1||row.source!=='focus')throw Error('专注音符事件身份无效')
  causes.add(row.sync_cause)
 }
 if(events.length)db.prepare('UPDATE stats SET points_json=? WHERE id=1').run(JSON.stringify(next))
 const epoch=Number((db.prepare('SELECT epoch FROM growth_meta WHERE id=1').get() as {epoch:number}).epoch)
 return {before,stats:next,events,levelUps:DIMENSIONS.filter(d=>levelOf(next[d])>levelOf(before[d])),growthEpoch:epoch}
}
function pendingBlocks(db:Database.Database):string[]{
 const blocks=(db.prepare('SELECT id FROM focus_reward_blocks').all() as {id:string}[]).map(row=>row.id).sort((a,b)=>Number(a)-Number(b))
 const blockSet=new Set(blocks)
 const sessions=new Map((db.prepare('SELECT token,seconds FROM focus_reward_sessions').all() as {token:string;seconds:number}[]).map(row=>[row.token,row.seconds]))
 const claims=new Map<string,number>(),covered=new Set<string>()
 for(const row of db.prepare('SELECT block_ids,session_tokens,acknowledged FROM focus_reward_presentations').all() as {block_ids:string;session_tokens:string;acknowledged:number}[]){
  const ids=JSON.parse(row.block_ids) as string[],tokens=JSON.parse(row.session_tokens) as string[]
  if(ids.some(id=>!blockSet.has(id))||tokens.some(token=>!sessions.has(token)))throw Error('音符演出回执引用缺失')
  const coverage=Math.floor(tokens.reduce((n,token)=>n+(sessions.get(token)??0),0)/FOCUS_NOTE_SECONDS)
  if(ids.some(id=>Number(id)>coverage))throw Error('音符演出回执超出已知贡献范围')
  if(row.acknowledged<=0)continue
  for(const id of ids)claims.set(id,(claims.get(id)??0)+1)
  for(const token of tokens)covered.add(token)
 }
 const consumed=new Set(claims.keys()),extra=[...claims.values()].reduce((n,count)=>n+Math.max(0,count-1),0)
 // Two offline peers can each see their local block1 for different sessions.
 // Their distinct receipts consume two notes after union. Replayed/restored
 // receipts retain their UUID, and coverage prevents duplicate views of the
 // same session from swallowing a genuinely future reward.
 const ceiling=Math.floor([...covered].reduce((n,token)=>n+(sessions.get(token)??0),0)/FOCUS_NOTE_SECONDS)
 let left=extra
 for(const id of blocks)if(left>0&&!consumed.has(id)&&Number(id)<=ceiling){consumed.add(id);left--}
 const events=new Set((db.prepare('SELECT sync_cause FROM growth_events').all() as {sync_cause:string|null}[]).map(row=>row.sync_cause))
 return blocks.filter(id=>!consumed.has(id)&&events.has(focusRewardCause(id)))
}
export function readFocusRewardState(db:Database.Database):FocusRewardState {
 const total=Number((db.prepare('SELECT COALESCE(SUM(seconds),0) AS n FROM focus_reward_sessions').get() as {n:number}).n)
 return {earnedNotes:Math.floor(total/FOCUS_NOTE_SECONDS),pendingNotes:pendingBlocks(db).length,remainderSeconds:total%FOCUS_NOTE_SECONDS}
}
export function readFocusRewardPresentation(db:Database.Database):FocusRewardPresentation {
 return db.transaction(()=>{
 const blockIds=pendingBlocks(db),serialized=JSON.stringify(blockIds)
 const prepared=db.prepare('SELECT token FROM focus_reward_presentations WHERE block_ids=? AND acknowledged=?').get(serialized,0) as {token:string}|undefined
 const token=blockIds.length?(prepared?.token??crypto.randomUUID()):''
 if(blockIds.length&&!prepared){
  const tokens=(db.prepare('SELECT token FROM focus_reward_sessions').all() as {token:string}[]).map(row=>row.token).sort()
  db.prepare('INSERT INTO focus_reward_presentations(token,block_ids,session_tokens,ts,acknowledged) VALUES (?,?,?,?,0)').run(token,serialized,JSON.stringify(tokens),Date.now())
 }
 const after=stats(db),before={...after,knowledge:Math.max(0,after.knowledge-blockIds.length)}
 return {token,blockIds,notes:blockIds.length,before,after}
 })()
}
export function acknowledgeFocusRewards(db:Database.Database,token:string,ids:string[]):void {
 if(typeof token!=='string'||!token||token.length>160||!Array.isArray(ids)||ids.length>1_000_000||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[1-9]\d{0,6}$/.test(id)))throw Error('音符结算标识无效')
 db.transaction(()=>{
  const prepared=db.prepare('SELECT block_ids FROM focus_reward_presentations WHERE token=?').get(token) as {block_ids:string}|undefined
  if(!prepared||prepared.block_ids!==JSON.stringify(ids))throw Error('音符结算回执已变化，请重新读取')
  db.prepare('UPDATE focus_reward_presentations SET acknowledged=1 WHERE token=? AND acknowledged=?').run(token,0)
 })()
}
