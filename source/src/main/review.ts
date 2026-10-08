import type Database from 'better-sqlite3'
import type { ReviewCard, ReviewDraft, ReviewRating } from '../shared/types'
import { localDateKey } from '../shared/date'
import { nextReviewDate, reviewInterval } from '../shared/review'
let db:Database.Database
export function initReview(connection:Database.Database):void {
 db=connection
 db.exec(`CREATE TABLE IF NOT EXISTS review_cards (
 id TEXT PRIMARY KEY, question TEXT NOT NULL, answer TEXT NOT NULL, topic TEXT NOT NULL,
 sourceRoot TEXT NOT NULL, sourcePath TEXT NOT NULL, dueDate TEXT NOT NULL,
 intervalDays INTEGER NOT NULL DEFAULT 0, reviews INTEGER NOT NULL DEFAULT 0,
 archived INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
 createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS review_due ON review_cards(archived,dueDate);
 CREATE TABLE IF NOT EXISTS review_logs (
 token TEXT PRIMARY KEY, cardId TEXT NOT NULL, rating TEXT NOT NULL, ts INTEGER NOT NULL,
 previousDue TEXT NOT NULL, nextDue TEXT NOT NULL, intervalDays INTEGER NOT NULL);`)
}
function card(id:string):ReviewCard {
 const r=db.prepare('SELECT * FROM review_cards WHERE id = ?').get(id) as ReviewCard|undefined
 if(!r)throw Error('复习卡不存在，请刷新列表。')
 return {...r,archived:!!r.archived}
}
function version(c:ReviewCard,v:number){if(c.version!==v)throw Error('这张卡片已更新，请收起草稿并刷新后再操作。')}
function string(value:unknown,max:number,required=false):string {
 if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw Error('请检查卡片内容：问题和答案不能为空，且不能超过长度限制。')
 return value.trim()
}
export function listReviews():ReviewCard[]{return (db.prepare('SELECT * FROM review_cards ORDER BY dueDate,createdAt,id').all() as ReviewCard[]).map(c=>({...c,archived:!!c.archived}))}
export function saveReview(input:ReviewDraft):ReviewCard {
 const d={id:string(input.id,80,true),question:string(input.question,500,true),answer:string(input.answer,20000,true),topic:string(input.topic,80),sourceRoot:string(input.sourceRoot,2000),sourcePath:string(input.sourcePath,2000)}
 if(!Number.isSafeInteger(input.version)||input.version<0)throw Error('卡片版本无效。')
 return db.transaction(()=>{
  const exists=db.prepare('SELECT id FROM review_cards WHERE id = ?').get(d.id)
  const now=Date.now()
  if(exists){
   const current=card(d.id)
   // A retried create request is safe, but must match the originally saved card.
   if(input.version===0&&current.version===1&&Object.entries(d).every(([k,v])=>current[k as keyof ReviewCard]===v))return current
   version(current,input.version)
   db.prepare('UPDATE review_cards SET question=@question,answer=@answer,topic=@topic,sourceRoot=@sourceRoot,sourcePath=@sourcePath,version=version+1,updatedAt=@now WHERE id=@id').run({...d,now})
  }else{
   if(input.version!==0)throw Error('卡片不存在，草稿已保留。')
   db.prepare('INSERT INTO review_cards (id,question,answer,topic,sourceRoot,sourcePath,dueDate,createdAt,updatedAt) VALUES (@id,@question,@answer,@topic,@sourceRoot,@sourcePath,@dueDate,@now,@now)').run({...d,dueDate:localDateKey(),now})
  }
  return card(d.id)
 })()
}
export function rateReview(input:{id:string;version:number;rating:ReviewRating;token:string}):ReviewCard {
 string(input.token,80,true)
 if(!['again','familiar','remembered'].includes(input.rating))throw Error('请选择有效的回忆结果。')
 return db.transaction(()=>{
  const previous=db.prepare('SELECT cardId,rating FROM review_logs WHERE token=?').get(input.token) as {cardId:string;rating:string}|undefined
  if(previous){if(previous.cardId!==input.id||previous.rating!==input.rating)throw Error('重复请求不一致。');return card(input.id)}
  const current=card(input.id);version(current,input.version)
  if(current.archived||current.dueDate>localDateKey())throw Error('这张卡片尚未到复习时间，请刷新列表。')
  const intervalDays=reviewInterval(current.intervalDays,input.rating),dueDate=nextReviewDate(intervalDays),now=Date.now()
  db.prepare('UPDATE review_cards SET dueDate=?,intervalDays=?,reviews=reviews+1,version=version+1,updatedAt=? WHERE id=?').run(dueDate,intervalDays,now,current.id)
  db.prepare('INSERT INTO review_logs VALUES (?,?,?,?,?,?,?)').run(input.token,current.id,input.rating,now,current.dueDate,dueDate,intervalDays)
  return card(current.id)
 })()
}
export function archiveReview(input:{id:string;version:number;archived:boolean}):ReviewCard {
 if(typeof input.archived!=='boolean')throw Error('归档状态无效。')
 return db.transaction(()=>{const current=card(input.id);version(current,input.version)
 db.prepare('UPDATE review_cards SET archived=?,version=version+1,updatedAt=? WHERE id=?').run(input.archived?1:0,Date.now(),input.id);return card(input.id)})()
}
export function reviewExport(){return {cards:listReviews(),logs:db.prepare('SELECT * FROM review_logs ORDER BY ts,token').all()}}
