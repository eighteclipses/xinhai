import type Database from 'better-sqlite3'
import { parseCategoryId } from '../shared/learningCategories'
import { validateKnowledgeCategoryTarget } from '../shared/knowledgeCategories'

let db:Database.Database
let resolveCategory:(value:unknown,current:string|null)=>string|null

export function initKnowledgeCategories(connection:Database.Database,resolve:(value:unknown,current:string|null)=>string|null):void {
  db=connection;resolveCategory=resolve
  db.exec('CREATE TABLE IF NOT EXISTS local_knowledge_categories (root TEXT NOT NULL,path TEXT NOT NULL,category_id TEXT NOT NULL,PRIMARY KEY(root,path))')
}
export function readKnowledgeCategory(root:string,path:string):string|null {
  validateKnowledgeCategoryTarget(root,path)
  return (db.prepare('SELECT category_id FROM local_knowledge_categories WHERE root=? AND path=?').get(root,path) as {category_id:string}|undefined)?.category_id??null
}
export function setLocalKnowledgeCategory(root:string,path:string,categoryId:unknown,expectedCategoryId:unknown):string|null {
  validateKnowledgeCategoryTarget(root,path);parseCategoryId(expectedCategoryId)
  return db.transaction(()=>{
    const current=readKnowledgeCategory(root,path)
    if(current!==expectedCategoryId)throw Error('笔记分类已更新，请刷新后重新选择')
    const next=resolveCategory(categoryId,current)
    if(next===null)removeKnowledgeCategory(root,path)
    else db.prepare('INSERT OR REPLACE INTO local_knowledge_categories(root,path,category_id) VALUES (?,?,?)').run(root,path,next)
    return next
  })()
}
export function assertKnowledgeCategoryDestination(root:string,path:string):void {
  if(readKnowledgeCategory(root,path)!==null)throw Error('这个标题的路径仍有本机分类记录，未改名。请换一个标题，避免混用旧笔记的分类。')
}
/** Copy before unlinking the original file, so a database failure preserves the original. */
export function copyKnowledgeCategory(root:string,source:string,target:string):void {
  db.transaction(()=>{
    assertKnowledgeCategoryDestination(root,target)
    const category=readKnowledgeCategory(root,source)
    if(category!==null)db.prepare('INSERT INTO local_knowledge_categories(root,path,category_id) VALUES (?,?,?)').run(root,target,category)
  })()
}
export function removeKnowledgeCategory(root:string,path:string):void {
  validateKnowledgeCategoryTarget(root,path)
  db.prepare('DELETE FROM local_knowledge_categories WHERE root=? AND path=?').run(root,path)
}
