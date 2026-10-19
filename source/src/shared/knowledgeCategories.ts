import type { KnowledgeNoteTarget } from './types'

/** A note is local to an exact vault root and relative path, never a LAN identity. */
export interface KnowledgeCategoryInput extends KnowledgeNoteTarget {
  categoryId:string|null
  expectedCategoryId:string|null
}

export function validateKnowledgeCategoryTarget(root:unknown,path:unknown):asserts root is string {
  if(typeof root!=='string'||!root||root.length>6000||/[\u0000-\u001f]/.test(root))throw Error('知识库标识无效')
  if(typeof path!=='string'||!path||path.length>2000||path.includes('\\')||path.includes(':')||path.startsWith('/')||/[\u0000-\u001f]/.test(path)||!path.toLowerCase().endsWith('.md')||path.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('笔记分类路径无效')
}
