import { PERSONAL_EDITION, COMMERCIAL_EDITION } from '../shared/edition'
import { app } from 'electron'
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, realpathSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { join, relative, resolve, sep, dirname, basename } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { getState, updateSettings } from './db'
import type { KnowledgeNote, KnowledgeVault, KnowledgeNoteTarget } from '../shared/types'
import type { KnowledgeCategoryInput } from '../shared/knowledgeCategories'
import { assertKnowledgeCategoryDestination, copyKnowledgeCategory, readKnowledgeCategory, removeKnowledgeCategory, setLocalKnowledgeCategory } from './knowledgeCategories'

const hash=(text:string)=>createHash('sha256').update(text).digest('hex')
export function knowledgeRoot():string {
  const configured=getState().settings.knowledgePath
  const root=configured || join(app.getPath('documents'),COMMERCIAL_EDITION?'心海学习库-源码版':PERSONAL_EDITION?'心海学习库-源码版':'心海学习库-体验版')
  if(!configured) mkdirSync(root,{recursive:true})
  if(!existsSync(root)) throw new Error('知识库文件夹不存在，请重新选择。')
  return realpathSync(root)
}
export function selectKnowledgeRoot(root:string):void {
  if(!statSync(root).isDirectory())throw new Error('请选择文件夹')
  updateSettings({knowledgePath:realpathSync(root)})
}
function safePath(name:string):string {
  const root=knowledgeRoot(),path=resolve(root,name),rel=relative(root,path)
  if(!rel||rel==='..'||rel.startsWith('..'+sep)||resolve(name)===name||!name.toLowerCase().endsWith('.md'))throw new Error('笔记路径无效')
  const parent=realpathSync(dirname(path));const parentRel=relative(root,parent)
  if(parentRel==='..'||parentRel.startsWith('..'+sep))throw new Error('笔记必须位于知识库内')
  if(existsSync(path)&&realpathSync(path)!==path)throw new Error('不编辑符号链接笔记')
  return path
}
function note(path:string,root:string):KnowledgeNote {
  if(statSync(path).size>2*1024*1024)throw new Error('笔记超过 2MB，请在 Obsidian 中编辑')
  const content=readFileSync(path,'utf8')
  const relativePath=relative(root,path).split(sep).join('/')
  return {path:relativePath,title:basename(path,'.md'),content,revision:hash(content),modifiedAt:statSync(path).mtimeMs,categoryId:readKnowledgeCategory(root,relativePath)}
}
export function listKnowledge():KnowledgeVault {
  const root=knowledgeRoot(),notes:KnowledgeNote[]=[],candidates:Array<{path:string;modifiedAt:number}>=[];let skipped=0
  function scan(dir:string,depth:number){
    if(depth>12){skipped++;return}
    for(const entry of readdirSync(dir,{withFileTypes:true})){
      if(entry.name.startsWith('.')||entry.name==='node_modules'||entry.isSymbolicLink())continue
      const path=join(dir,entry.name)
      if(entry.isDirectory())scan(path,depth+1)
      else if(entry.isFile()&&/\.md$/i.test(entry.name)){
        const metadata=statSync(path)
        if(metadata.size>2*1024*1024){skipped++;continue}
        candidates.push({path,modifiedAt:metadata.mtimeMs})
      }
    }
  }
  scan(root,0)
  candidates.sort((a,b)=>b.modifiedAt-a.modifiedAt||a.path.localeCompare(b.path))
  skipped+=Math.max(0,candidates.length-2000)
  for(const candidate of candidates.slice(0,2000))notes.push(note(candidate.path,root))
  return {root,notes,skipped}
}
export function saveKnowledge(input:{path:string;content:string;revision:string|null}):KnowledgeNote {
  if(typeof input.content!=='string'||Buffer.byteLength(input.content)>2*1024*1024)throw new Error('笔记内容超过 2MB')
  const path=safePath(input.path),present=existsSync(path)
  if(input.revision===null&&present)throw new Error('同名笔记已存在，请换一个名称')
  if(input.revision!==null&&(!present||hash(readFileSync(path,'utf8'))!==input.revision))throw new Error('文件已在外部修改。请先另存当前内容，再重新载入，避免覆盖 Obsidian 中的修改。')
  if(!present)writeFileSync(path,input.content,{encoding:'utf8',flag:'wx'})
  else {
    const temporary=path+'.'+randomUUID()+'.tmp'
    try{writeFileSync(temporary,input.content,{encoding:'utf8',flag:'wx'});renameSync(temporary,path)}
    finally{if(existsSync(temporary))unlinkSync(temporary)}
  }
  return note(path,knowledgeRoot())
}
export function createKnowledge(title:string,initialContent?:string,expectedRoot?:string):KnowledgeNote {
  if(expectedRoot!==undefined&&expectedRoot!==knowledgeRoot())throw new Error('知识库已切换，未创建笔记。请回到原库确认草稿后重试。')
  const name=title.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/,'').slice(0,100)
  if(!name||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name))throw new Error('请使用有效的笔记名称')
  return saveKnowledge({path:name+'.md',content:initialContent??'# '+title.trim()+'\n\n',revision:null})
}

function checkedTarget(input:KnowledgeNoteTarget):{root:string;path:string} {
  const root=knowledgeRoot()
  if(!input||input.expectedRoot!==root)throw Error('知识库已切换，未修改笔记。请回到原库后重试。')
  if(typeof input.path!=='string'||typeof input.revision!=='string')throw Error('笔记信息无效')
  const path=safePath(input.path)
  if(!existsSync(path)||!statSync(path).isFile()||hash(readFileSync(path,'utf8'))!==input.revision)throw Error('笔记已在外部修改、移动或删除。请保留当前草稿，刷新后重试。')
  return {root,path}
}
export function renameKnowledge(input:KnowledgeNoteTarget&{title:string}):KnowledgeNote {
  const {root,path}=checkedTarget(input)
  const name=typeof input.title==='string'?input.title.trim().replace(/\.md$/i,''):''
  if(!name||name.length>100||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name))throw Error('请使用有效的笔记标题（最多 100 字，不含路径或特殊符号）')
  const filename=name+'.md',sourceName=basename(path)
  const caseOnly=sourceName!==filename&&sourceName.toLowerCase()===filename.toLowerCase()
  // The checked source establishes the directory boundary. A differently cased
  // Windows alias is validated by file identity below, before the real rename.
  const target=caseOnly?join(dirname(path),filename):safePath(relative(root,join(dirname(path),filename)))
  if(target===path)return note(path,root)
  if(readdirSync(dirname(path)).some(entry=>entry.toLowerCase()===filename.toLowerCase()&&(!caseOnly||entry!==sourceName)))throw Error('同名笔记或文件夹已存在，请换一个标题。')
  const sourceRelative=relative(root,path).split(sep).join('/'),targetRelative=relative(root,target).split(sep).join('/')
  assertKnowledgeCategoryDestination(root,targetRelative)
  if(caseOnly){
    if(existsSync(target)){
      const sourceIdentity=statSync(path,{bigint:true}),targetIdentity=statSync(target,{bigint:true})
      if(sourceIdentity.dev!==targetIdentity.dev||sourceIdentity.ino!==targetIdentity.ino)throw Error('同名笔记或文件夹已存在，请换一个标题。')
    }
    // Stage the new mapping first. A database failure must leave the original
    // filename and classification intact; a filesystem failure keeps the old row.
    copyKnowledgeCategory(root,sourceRelative,targetRelative)
    try{renameSync(path,target)}catch(error){
      try{removeKnowledgeCategory(root,targetRelative)}catch{}
      throw error
    }
    if(!readdirSync(dirname(path)).includes(filename)||hash(readFileSync(target,'utf8'))!==input.revision)throw Error('大小写修改结果尚未确认；文件与原分类记录均已保留，请刷新后核对。')
    try{removeKnowledgeCategory(root,sourceRelative)}catch{throw Error('笔记已改名且新路径分类已保存；旧路径分类未能清理，请刷新后核对。')}
    return note(target,root)
  }
  // Exclusive creation works on ordinary removable disks too; renameSync would
  // silently replace a destination on some platforms.
  copyFileSync(path,target,constants.COPYFILE_EXCL)
  if(hash(readFileSync(target,'utf8'))!==input.revision||hash(readFileSync(path,'utf8'))!==input.revision)throw Error('改名期间文件发生变化；原文件和新副本均已保留，请刷新后核对。')
  try{copyKnowledgeCategory(root,sourceRelative,targetRelative)}catch{throw Error('新标题的副本已保存，但分类记录未能迁移。原文件与原分类均保留，请刷新后核对。')}
  try{unlinkSync(path)}catch{throw Error('新标题的副本已保存，但原文件未能移除。两份文件均保留，请刷新后处理。')}
  try{removeKnowledgeCategory(root,sourceRelative)}catch{throw Error('笔记已改名且新路径分类已保存；旧路径分类未能清理，请刷新后核对。')}
  return note(target,root)
}
export function deleteKnowledge(input:KnowledgeNoteTarget&{confirmation:string}):void {
  if(input?.confirmation!=='删除笔记')throw Error('请明确确认删除这篇笔记。')
  const {root,path}=checkedTarget(input)
  unlinkSync(path)
  removeKnowledgeCategory(root,relative(root,path).split(sep).join('/'))
}
export function setKnowledgeCategory(input:KnowledgeCategoryInput):KnowledgeNote {
  const {root,path}=checkedTarget(input)
  setLocalKnowledgeCategory(root,relative(root,path).split(sep).join('/'),input.categoryId,input.expectedCategoryId)
  return note(path,root)
}
