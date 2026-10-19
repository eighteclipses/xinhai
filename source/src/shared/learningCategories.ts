export interface LearningCategory { id:string; name:string; color:string; sortOrder:number; archivedAt:number|null; createdAt:number; updatedAt:number }
export interface LearningCategoryInput { id:string; name:string; color:string }
export interface LearningCategorySummary { categoryId:string|null; focusSeconds:number; focusSessions:number; legacyFocusSessions:number; todos:number; completedTodos:number; habits:number; habitLogs:number; journals:number; reviewCards:number; reviewLogs:number; events:number }
export type LearningRecordKind='focus'|'journal'|'todo'|'habit'|'review'|'event'
export interface LearningRecordCategoryInput { kind:LearningRecordKind; id:number|string; categoryId:string|null; expectedCategoryId:string|null }
export const CATEGORY_TABLES=['focus_sessions','journals','todos','habits','habit_logs','events','review_cards','review_logs'] as const
export const CATEGORY_COLORS=['#67DDD1','#7CB8FF','#C9A7FF','#F4B86A','#F58AA8','#93CC96'] as const
export function isCategoryId(value:unknown):value is string {return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)}
export function parseCategoryId(value:unknown):string|null {if(value===null||value===undefined)return null;if(!isCategoryId(value))throw Error('学习分类标识无效');return value}
export function validateCategoryInput(input:LearningCategoryInput):LearningCategoryInput {
 if(!input||!isCategoryId(input.id)||typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>40||/[\u0000-\u001f\u007f]/.test(input.name)||typeof input.color!=='string'||!/^#[0-9a-f]{6}$/i.test(input.color))throw Error('分类名称须为 1–40 字，颜色须有效')
 return {id:input.id,name:input.name.trim(),color:input.color.toUpperCase()}
}
/** Missing additive columns in historical reset snapshots mean unclassified only. */
export function normalizeCategoryPractice(value:Record<string,Record<string,unknown>[]>):Record<string,Record<string,unknown>[]> {
 return Object.fromEntries(Object.entries(value).map(([table,rows])=>[table,rows.map(row=>CATEGORY_TABLES.includes(table as never)?{...row,category_id:row.category_id??null}:row)]))
}
