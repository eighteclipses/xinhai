import {initKnowledgeCategories} from './knowledgeCategories'
import type Database from 'better-sqlite3'
import {CATEGORY_TABLES,parseCategoryId,validateCategoryInput,type LearningCategory,type LearningCategoryInput,type LearningCategorySummary,type LearningRecordCategoryInput} from '../shared/learningCategories'
let db:Database.Database
type CategoryRow={id:string;name:string;color:string;sort_order:number;archived_at:number|null;created_at:number;updated_at:number}
const fromRow=(r:CategoryRow):LearningCategory=>({id:r.id,name:r.name,color:r.color,sortOrder:r.sort_order,archivedAt:r.archived_at,createdAt:r.created_at,updatedAt:r.updated_at})
export function initLearningCategories(connection:Database.Database):void {
 db=connection
 db.exec('CREATE TABLE IF NOT EXISTS learning_categories (id TEXT PRIMARY KEY,name TEXT NOT NULL,color TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,archived_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)')
 for(const table of CATEGORY_TABLES){
  if(!(db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>).some(c=>c.name==='category_id'))db.exec(`ALTER TABLE ${table} ADD COLUMN category_id TEXT`)
  db.exec(`CREATE INDEX IF NOT EXISTS ${table}_category ON ${table}(category_id)`)
 }
 initKnowledgeCategories(connection,resolveCategoryId)
}
export function listLearningCategories():LearningCategory[]{return (db.prepare('SELECT * FROM learning_categories ORDER BY sort_order,created_at,id').all() as CategoryRow[]).map(fromRow)}
export function resolveCategoryId(value:unknown,current:string|null=null,allowArchived=false):string|null {
 if(value===undefined)return current
 const id=parseCategoryId(value);if(id===null)return null
 const row=db.prepare('SELECT * FROM learning_categories WHERE id=?').get(id) as CategoryRow|undefined
 if(!row)throw Error('学习分类已不存在，请重新选择')
 if(row.archived_at!==null&&!allowArchived&&id!==current)throw Error('该分类已停用，请选择其他分类或恢复它')
 return id
}
export function saveLearningCategory(input:LearningCategoryInput):LearningCategory {
 const value=validateCategoryInput(input)
 return db.transaction(()=>{
  const existing=db.prepare('SELECT * FROM learning_categories WHERE id=?').get(value.id) as CategoryRow|undefined,now=Date.now()
  if(existing)db.prepare('UPDATE learning_categories SET name=?,color=?,updated_at=? WHERE id=?').run(value.name,value.color,now,value.id)
  else{
   if(listLearningCategories().length>=300)throw Error('分类最多保留 300 个，请复用已有分类')
   db.prepare('INSERT INTO learning_categories(id,name,color,sort_order,archived_at,created_at,updated_at) VALUES (?,?,?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM learning_categories),NULL,?,?)').run(value.id,value.name,value.color,now,now)
  }
  return fromRow(db.prepare('SELECT * FROM learning_categories WHERE id=?').get(value.id) as CategoryRow)
 })()
}
export function reorderLearningCategories(ids:string[]):void {db.transaction(()=>{
 const all=listLearningCategories().map(c=>c.id)
 if(!Array.isArray(ids)||ids.length!==all.length||new Set(ids).size!==ids.length||ids.some(id=>!all.includes(id)))throw Error('分类列表已变化，请刷新后再排序')
 const update=db.prepare('UPDATE learning_categories SET sort_order=?,updated_at=? WHERE id=?'),now=Date.now()
 ids.forEach((id,i)=>update.run(i,now,id))
})()}
export function archiveLearningCategory(input:{id:string;archived:boolean}):void {
 if(!input||typeof input.archived!=='boolean'||!parseCategoryId(input.id))throw Error('分类停用状态无效')
 if(db.prepare('UPDATE learning_categories SET archived_at=?,updated_at=? WHERE id=?').run(input.archived?Date.now():null,Date.now(),input.id).changes!==1)throw Error('分类已不存在，请刷新')
}
export function setLearningRecordCategory(input:LearningRecordCategoryInput):void {
 const tables={focus:'focus_sessions',journal:'journals',todo:'todos',habit:'habits',review:'review_cards',event:'events'} as const
 if(!input||input.categoryId===undefined||input.expectedCategoryId===undefined||!Object.hasOwn(tables,input.kind)||(input.kind==='review'?typeof input.id!=='string'||!input.id||input.id.length>80:!Number.isSafeInteger(input.id)||Number(input.id)<1))throw Error('学习记录标识无效')
 parseCategoryId(input.expectedCategoryId)
 db.transaction(()=>{
  const table=tables[input.kind],row=db.prepare(`SELECT category_id FROM ${table} WHERE id=?`).get(input.id) as {category_id:string|null}|undefined
  if(!row)throw Error('记录已不存在，请刷新')
  if(row.category_id!==input.expectedCategoryId)throw Error('记录分类已更新，请刷新后重新选择')
  const next=resolveCategoryId(input.categoryId,row.category_id)
  if(table==='review_cards')db.prepare('UPDATE review_cards SET category_id=?,version=version+1,updatedAt=? WHERE id=?').run(next,Date.now(),input.id)
  else db.prepare(`UPDATE ${table} SET category_id=? WHERE id=?`).run(next,input.id)
 })()
}
export function learningCategorySummary():LearningCategorySummary[] {
 return db.transaction(()=>{
  const map=new Map<string|null,LearningCategorySummary>()
  for(const categoryId of [null,...listLearningCategories().map(c=>c.id)])map.set(categoryId,{categoryId,focusSeconds:0,focusSessions:0,legacyFocusSessions:0,todos:0,completedTodos:0,habits:0,habitLogs:0,journals:0,reviewCards:0,reviewLogs:0,events:0})
  const count=(table:string,field:keyof LearningCategorySummary,where='')=>{for(const row of db.prepare(`SELECT category_id,COUNT(*) AS n FROM ${table}${where} GROUP BY category_id`).all() as Array<{category_id:string|null;n:number}>){const entry=map.get(row.category_id);if(entry)(entry[field] as number)=row.n}}
  count('todos','todos');count('todos','completedTodos',' WHERE done=1');count('habits','habits',' WHERE deleted_at IS NULL');count('habit_logs','habitLogs');count('journals','journals');count('review_cards','reviewCards');count('review_logs','reviewLogs');count('events','events')
  for(const row of db.prepare('SELECT category_id,COUNT(*) AS n,SUM(COALESCE(seconds,minutes*60)) AS seconds,SUM(CASE WHEN seconds IS NULL THEN 1 ELSE 0 END) AS legacy FROM focus_sessions GROUP BY category_id').all() as Array<{category_id:string|null;n:number;seconds:number;legacy:number}>){const entry=map.get(row.category_id);if(entry){entry.focusSessions=row.n;entry.focusSeconds=row.seconds;entry.legacyFocusSessions=row.legacy}}
  return [...map.values()]
 })()
}
