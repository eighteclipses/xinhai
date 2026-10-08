import Review from './Review'
import { readReviewDraft, writeReviewDraft, newReviewDraft } from '../lib/reviewDraft'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store/app'
import type { KnowledgeNote, KnowledgeVault } from '../../../shared/types'
import { COMMERCIAL_EDITION } from '../../../shared/edition'
import { acknowledgeNoteRecovery, acknowledgeNoteSave, forgetNoteDraft, knowledgeError, listRecoverableNoteDrafts, NOTE_RECOVERED_EVENT, NOTE_SAVED_EVENT, noteDraftIsVolatile, readNoteDraft, writeNoteDraft, type NoteDraft, type NoteRecovered, type NoteSaved } from '../lib/knowledgeDraft'
import '../styles/knowledge-recovery.css'
const recoveredTitle=(path:string)=>path.split(/[\\/]/).pop()!.replace(/\.md$/i,'')
function Notebook(){
  const commercialAndroid=COMMERCIAL_EDITION&&Boolean(window.XinhaiNative)
  const [vault,setVault]=useState<KnowledgeVault|null>(null)
  const [selected,setSelected]=useState<KnowledgeNote|null>(null)
  const [recoveryPath,setRecoveryPath]=useState<string|null>(null)
  const [content,setContent]=useState(''),[query,setQuery]=useState(''),[title,setTitle]=useState('')
  const [discard,setDiscard]=useState(false)
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(true)
  const loadGeneration=useRef(0)
  const selectedRef=useRef(selected);selectedRef.current=selected
  const currentRef=useRef({vault,selected,content,recoveryPath});currentRef.current={vault,selected,content,recoveryPath}
  const operation=useRef(false)
  const mounted=useRef(true)
  useEffect(()=>{
    mounted.current=true
    const acknowledge=(event:Event)=>{
      const {root,submitted,note,draftStorageFailed}=(event as CustomEvent<NoteSaved>).detail
      const current=currentRef.current
      if(current.vault?.root!==root)return
      setVault(v=>v?.root===root?{...v,notes:[note,...v.notes.filter(n=>n.path!==note.path)]}:v)
      if(current.selected?.path!==note.path||current.selected.revision!==submitted.revision)return
      const newer=current.content!==submitted.content
      selectedRef.current=note;currentRef.current={...current,selected:note}
      setSelected(note);setSaved(!newer);setDiscard(false)
      setMessage(draftStorageFailed?(newer?'提交的内容已保存；较新的草稿尚未写入本机存储，请保持应用打开并再次保存。':'文件已保存，但本机草稿清理失败；再次打开时可能恢复同一内容。'):newer?'已保存提交的内容；较新的输入仍是本机草稿，请再次保存。':'已保存到 Markdown · '+new Date().toLocaleTimeString())
    }
    window.addEventListener(NOTE_SAVED_EVENT,acknowledge)
    const recovered=(event:Event)=>{
      const {root,sourcePath,submitted,note,sourceCleared,cleanupFailed}=(event as CustomEvent<NoteRecovered>).detail
      const current=currentRef.current
      if(current.vault?.root!==root)return
      setVault(v=>v?.root===root?{...v,notes:[note,...v.notes.filter(n=>n.path!==note.path)]}:v)
      if(current.recoveryPath!==sourcePath)return
      if(sourceCleared&&current.content===submitted.content&&current.selected?.revision===submitted.revision){
        open(note,root);setTitle('');setMessage('草稿已完整恢复为新笔记，原草稿已清理。')
      }else setMessage(cleanupFailed?'新笔记已保存；原草稿清理失败，仍可从待恢复列表取回。':'提交的内容已另存；较新的输入仍在待恢复草稿中，请继续保存。')
    }
    window.addEventListener(NOTE_RECOVERED_EVENT,recovered)
    return()=>{mounted.current=false;window.removeEventListener(NOTE_SAVED_EVENT,acknowledge);window.removeEventListener(NOTE_RECOVERED_EVENT,recovered)}
  },[])
  function open(note:KnowledgeNote,root=vault?.root){
    setRecoveryPath(null)
    let draft:NoteDraft|null=null
    try{draft=readNoteDraft(root!,note.path)}catch{}
    setSelected(draft?{...note,revision:draft.revision}:note);setContent(draft?.content??note.content);setSaved(!draft)
    setDiscard(false)
    setMessage(draft?(noteDraftIsVolatile(root!,note.path)?'已恢复本次会话中的草稿，尚未写入本机存储；请保持应用打开并保存。':'已恢复本机草稿，保存后写入 Markdown。'):'')
  }
  function openRecovery(path:string,root=vault?.root){
    if(!root)return
    try{
      const draft=readNoteDraft(root,path)
      if(!draft){setMessage('这份草稿暂时无法读取，原始存储未改动。');return}
      setSelected({path,title:recoveredTitle(path),content:draft.content,revision:draft.revision,modifiedAt:0})
      setRecoveryPath(path);setContent(draft.content);setSaved(false);setDiscard(false);setTitle((recoveredTitle(path)+'-恢复').slice(0,100))
      setMessage(noteDraftIsVolatile(root,path)?'已载入会话内草稿，请保持应用打开并另存为新笔记。':'')
    }catch(e){setMessage(knowledgeError(e))}
  }
  async function refresh(){
    const generation=++loadGeneration.current
    try{const v=await window.api.knowledgeList();if(generation!==loadGeneration.current)return;setVault(v);const current=selectedRef.current;let target:{root:string;path:string}|null=null;try{target=JSON.parse(sessionStorage.getItem('knowledgeOpenNote')||'null')}catch{}
    const requested=target?.root===v.root?v.notes.find(n=>n.path===target?.path):undefined
    const missing=listRecoverableNoteDrafts(v.root,v.notes).paths
    const sameRoot=currentRef.current.vault?.root===v.root
    const recoverCurrent=sameRoot&&current&&missing.includes(current.path)?current.path:null
    const n=requested??v.notes.find(n=>sameRoot&&n.path===current?.path)??v.notes[0]
    if(!requested&&recoverCurrent)openRecovery(recoverCurrent,v.root)
    else if(n)open(n,v.root)
    else if(missing[0])openRecovery(missing[0],v.root)
    else{setSelected(null);setRecoveryPath(null);setContent('')}
    if(target){sessionStorage.removeItem('knowledgeOpenNote');if(!requested)setMessage('来源笔记不在当前知识库中，请选择原来的库或搜索笔记；复习卡的答案仍然保留。')}}catch(e){setMessage(knowledgeError(e))}
  }
  useEffect(()=>{void refresh()},[])
  function edit(value:string){setContent(value);setSaved(false);if(vault&&selected&&!writeNoteDraft(vault.root,selected.path,{content:value,revision:selected.revision}))setMessage('草稿尚未写入本机存储，仅保留在本次会话中；请保持应用打开并点击保存。')}
  function discardDraft(){
    if(!selected||!vault||busy)return
    if(!discard){setDiscard(true);return}
    try{forgetNoteDraft(vault.root,selected.path);void refresh()}catch(e){setMessage(knowledgeError(e))}
  }
  async function save(){
    if(recoveryPath){await create(true);return}
    if(!selected||!vault||operation.current)return
    operation.current=true;setBusy(true)
    try{
      const note=await window.api.knowledgeSave({path:selected.path,content,revision:selected.revision})
      acknowledgeNoteSave(vault.root,{content,revision:selected.revision},note)
    }catch(e){if(mounted.current)setMessage(knowledgeError(e))}finally{operation.current=false;if(mounted.current)setBusy(false)}
  }
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void save()}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[selected,content,vault,busy,recoveryPath,title])
  async function create(copy=false){
    if(!title.trim()||!vault||operation.current)return;operation.current=true;setBusy(true)
    try{
      const note=await window.api.knowledgeCreate(title,copy?content:undefined,vault.root)
      const v=await window.api.knowledgeList()
      if(copy&&recoveryPath&&selected){
        const readback=v.notes.find(n=>n.path===note.path)
        if(v.root!==vault.root||note.content!==content||readback?.content!==content)throw Error('新笔记已创建，但尚未确认内容完整。原草稿继续保留，请检查新文件后再处理。')
        acknowledgeNoteRecovery(vault.root,recoveryPath,{content,revision:selected.revision},note)
        return
      }
      if(!mounted.current)return
      setVault(v);setTitle('')
      if(copy&&currentRef.current.content!==content)setMessage('提交的内容已另存为新笔记；较新的输入仍保留在当前笔记中。')
      else{open(note,v.root);setMessage(copy?'当前内容已另存为新笔记。':'已新建笔记。')}
    }catch(e){if(mounted.current)setMessage(knowledgeError(e))}finally{operation.current=false;if(mounted.current)setBusy(false)}
  }
  async function choose(){try{const v=await window.api.knowledgeChoose();if(v){++loadGeneration.current;setVault(v);const missing=listRecoverableNoteDrafts(v.root,v.notes).paths;if(v.notes[0])open(v.notes[0],v.root);else if(missing[0])openRecovery(missing[0],v.root);else{setSelected(null);setRecoveryPath(null);setContent('')}setMessage('已连接个人知识库')}}catch(e){setMessage(knowledgeError(e))}}
  function makeReview(){
    if(!selected||!vault||recoveryPath)return
    try{
      if(readReviewDraft()){setMessage('复习页还有未完成的草稿，请先保存或放弃，再制作新的卡片。');return}
      const area=document.querySelector<HTMLTextAreaElement>('[aria-label="笔记正文"]')
      const excerpt=area&&area.selectionEnd>area.selectionStart?content.slice(area.selectionStart,area.selectionEnd):content
      writeReviewDraft({...newReviewDraft(),question:`${selected.title}：需要记住的关键问题是什么？`.slice(0,500),answer:excerpt.slice(0,20000),sourceRoot:vault.root,sourcePath:selected.path})
      useApp.setState({knowledgeSection:'review'})
    }catch{setMessage('复习草稿写入失败，请到复习页手动创建卡片。')}
  }
  const notes=vault?.notes??[],needle=query.trim().toLowerCase()
  const recoveryScan=useMemo(()=>vault?listRecoverableNoteDrafts(vault.root,vault.notes):{paths:[],unreadable:0},[vault])
  const filtered=notes.filter(n=>(n.title+'\n'+n.content).toLowerCase().includes(needle))
  const links=[...new Set(Array.from(content.matchAll(/\[\[([^\]]+)\]\]/g),m=>m[1].split('|')[0].split('#')[0]))].filter(Boolean)
  const resolveLink=(link:string)=>{const key=link.replace(/\.md$/i,'');const direct=notes.find(n=>n.path.replace(/\.md$/i,'')===key);if(direct)return direct;const matches=notes.filter(n=>n.title===key);return matches.length===1?matches[0]:undefined}
  const backlinks=selected?notes.filter(n=>n.path!==selected.path&&Array.from(n.content.matchAll(/\[\[([^\]]+)\]\]/g),m=>m[1].split('|')[0].split('#')[0].replace(/\.md$/i,'')).some(link=>link===selected.title||link===selected.path.replace(/\.md$/i,''))):[]
  return <div className="knowledge-page">
    <div className="page-title"><span className="en">MY LIBRARY</span><span className="zh">个人知识库</span></div>
    <div className="knowledge-toolbar"><span title={vault?.root}>{vault?.root||'正在打开学习库…'}</span><button className="btn" onClick={()=>void choose()} disabled={busy}>选择已有库</button><button className="btn" onClick={()=>void window.api.knowledgeFolder().then(error=>{if(error)setMessage(error)}).catch(e=>setMessage(String(e)))}>{commercialAndroid?'文件夹说明':'打开文件夹'}</button><button className="btn" onClick={()=>void window.api.knowledgeObsidian().catch(error=>setMessage(commercialAndroid?(error instanceof Error?error.message:String(error)):'请先安装 Obsidian，也可以在其中打开上面的文件夹。'))}>{commercialAndroid?'打开 Obsidian':'在 Obsidian 打开'}</button></div>
    {COMMERCIAL_EDITION&&message&&<div className="knowledge-message" role="status">{message}</div>}
    <div className="knowledge-columns">
      <aside className="glass knowledge-sidebar"><input aria-label="搜索笔记" placeholder="搜索标题或全文…" value={query} onChange={e=>setQuery(e.target.value)}/><div className="knowledge-new"><input aria-label="新笔记标题" placeholder="新笔记标题" value={title} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void create(Boolean(recoveryPath))}}/><button className="btn" disabled={busy||!title.trim()} onClick={()=>void create(Boolean(recoveryPath))}>{recoveryPath?'恢复':'新建'}</button></div>
        {(recoveryScan.paths.length>0||recoveryScan.unreadable>0)&&<section className="knowledge-recovery" aria-label="待恢复草稿">
          <header><strong>待恢复草稿</strong><span>{recoveryScan.paths.length}</span></header>
          <p>原路径未出现在当前列表中，可找回正文并另存。</p>
          <div className="knowledge-recovery-list">{recoveryScan.paths.filter(path=>path.toLowerCase().includes(needle)).map(path=><button key={path} disabled={busy} className={recoveryPath===path?'selected':''} onClick={()=>openRecovery(path)} title={path}><strong>{recoveredTitle(path)}</strong><small>{path}</small></button>)}</div>
          {recoveryScan.unreadable>0&&<small role="status">有 {recoveryScan.unreadable} 项草稿暂时无法读取，原始存储已保留。</small>}
        </section>}
        <small>{filtered.length} 篇笔记{vault?.skipped?` · ${vault.skipped} 项超出读取范围`:''}</small>
        <div className="knowledge-list">{filtered.map(note=><button key={note.path} disabled={busy} className={note.path===selected?.path?'selected':''} onClick={()=>open(note)}><strong>{note.title}</strong><small>{note.path}</small><p>{note.content.replace(/^#.*\n/,'').trim().slice(0,65)||'开始记录你的理解…'}</p></button>)}</div>
      </aside>
      <section className="glass knowledge-editor">{selected?<>
        <header><div><h2>{selected.title}</h2><small>{saved?'已写入文件':vault&&noteDraftIsVolatile(vault.root,selected.path)?'草稿仅在本次会话中，请保存':'草稿已保留在本机'} · Ctrl+S {recoveryPath?'另存恢复':'保存'}</small></div><button className="btn primary" disabled={busy||saved||Boolean(recoveryPath&&!title.trim())} onClick={()=>void save()}>{busy?'保存中…':recoveryPath?'另存恢复':'保存笔记'}</button></header>
        {recoveryPath&&<div className="knowledge-recovery-hint"><strong>正在找回草稿</strong><span>原路径：{recoveryPath}</span><small>用左侧标题另存到当前库的顶层，确认正文完整后清理这份旧草稿。</small></div>}
        <textarea aria-label="笔记正文" spellCheck={false} value={content} onChange={e=>edit(e.target.value)} placeholder="记下知识点、错题和自己的理解。使用 [[笔记标题]] 关联另一篇笔记。" />
        <div className="knowledge-relations"><span>关联笔记</span>{links.map(link=>{const note=resolveLink(link);return <button disabled={busy||!note} key={link} onClick={()=>note&&open(note)}>{link}{!note?'（未找到或重名）':''}</button>})}{!links.length&&<small>用 [[笔记标题]] 建立关联</small>}</div>
        <div className="knowledge-relations"><span>链接到这里</span>{backlinks.map(note=><button key={note.path} disabled={busy} onClick={()=>open(note)}>{note.title}</button>)}{!backlinks.length&&<small>暂时没有反向链接</small>}</div>
        <footer><button className="btn primary" disabled={busy||!content.trim()||Boolean(recoveryPath)} onClick={makeReview}>制作复习卡</button>{!saved&&<button className="btn" disabled={busy} onClick={discardDraft}>{discard?(recoveryPath?'确认丢弃这份草稿':'确认丢弃草稿并载入文件'):(recoveryPath?'放弃此草稿':'放弃本机草稿')}</button>}<button className="btn" onClick={()=>void refresh()} disabled={busy}>刷新外部修改</button><button className="btn" onClick={()=>void create(true)} disabled={busy||!title.trim()}>以左侧标题另存</button><button className="btn" onClick={()=>{sessionStorage.setItem('focusNoteTitle',selected.title);useApp.getState().go('focus')}}>围绕此笔记专注</button></footer>
      </>:<div className="knowledge-empty"><span>YOUR OWN WORDS</span><h2>把学到的，变成自己的。</h2><p>在左侧新建知识点、错题或阅读笔记。也可以选择已有 Obsidian 仓库，直接使用其中的 Markdown 文件。</p><p>笔记不会因创建或编辑自动获得成长点数。</p></div>}</section>
    </div>
    {!COMMERCIAL_EDITION&&message&&<div className="knowledge-message" role="status">{message}</div>}
  </div>
}

export default function Knowledge(){
 const section=useApp(s=>s.knowledgeSection)
 return <div className="knowledge-hub"><div className="knowledge-subnav" role="tablist" aria-label="知识库功能"><span>MY LIBRARY</span><button role="tab" aria-selected={section==='notes'} aria-controls="library-notes" onClick={()=>useApp.setState({knowledgeSection:'notes'})}>笔记</button><button role="tab" aria-selected={section==='review'} aria-controls="library-review" onClick={()=>useApp.setState({knowledgeSection:'review'})}>复习卡</button></div><div id={'library-'+(section==='notes'?'notes':'review')} role="tabpanel">{section==='notes'?<Notebook/>:<Review/>}</div></div>
}
