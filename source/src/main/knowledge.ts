import { PERSONAL_EDITION, COMMERCIAL_EDITION } from '../shared/edition'
import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, realpathSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { join, relative, resolve, sep, dirname, basename } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { getState, updateSettings } from './db'
import type { KnowledgeNote, KnowledgeVault } from '../shared/types'

const hash=(text:string)=>createHash('sha256').update(text).digest('hex')
export function knowledgeRoot():string {
  const configured=getState().settings.knowledgePath
  const root=configured || join(app.getPath('documents'),'心海学习库-源码版')
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
  return {path:relative(root,path).split(sep).join('/'),title:basename(path,'.md'),content,revision:hash(content),modifiedAt:statSync(path).mtimeMs}
}
export function listKnowledge():KnowledgeVault {
  const root=knowledgeRoot(),notes:KnowledgeNote[]=[];let skipped=0
  function scan(dir:string,depth:number){
    if(depth>12){skipped++;return}
    for(const entry of readdirSync(dir,{withFileTypes:true})){
      if(entry.name.startsWith('.')||entry.name==='node_modules'||entry.isSymbolicLink())continue
      const path=join(dir,entry.name)
      if(entry.isDirectory())scan(path,depth+1)
      else if(entry.isFile()&&/\.md$/i.test(entry.name)){
        if(notes.length>=2000||statSync(path).size>2*1024*1024){skipped++;continue}
        notes.push(note(path,root))
      }
    }
  }
  scan(root,0);notes.sort((a,b)=>b.modifiedAt-a.modifiedAt)
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
