import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useApp } from '../store/app'
import { useReducedEffects } from '../lib/motion'
import { readReviewDraft, writeReviewDraft, newReviewDraft } from '../lib/reviewDraft'
import { localDateKey } from '../../../shared/date'
import { reviewInterval } from '../../../shared/review'
import type { ReviewCard, ReviewDraft, ReviewRating } from '../../../shared/types'

type Mode='today'|'library'|'archive'
export default function Review(){
 const syncVersion=useApp(s=>s.dataSyncVersion)
 const reduce=useReducedEffects()
 const [cards,setCards]=useState<ReviewCard[]>([]),[loaded,setLoaded]=useState(false)
 const [mode,setMode]=useState<Mode>('today'),[query,setQuery]=useState(''),[selected,setSelected]=useState<string|null>(null)
 const [draft,setDraft]=useState<ReviewDraft|null>(readReviewDraft),[editing,setEditing]=useState(()=>!!readReviewDraft())
 const [revealed,setRevealed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('')
 const [today,setToday]=useState(localDateKey),[discard,setDiscard]=useState(false)
 const lock=useRef(false),answerButton=useRef<HTMLButtonElement>(null),retry=useRef<{id:string;version:number;rating:ReviewRating;token:string}|null>(null)
 const active=cards.filter(c=>!c.archived),due=active.filter(c=>c.dueDate<=today)
 const list=(mode==='today'?due:mode==='library'?active:cards.filter(c=>c.archived)).filter(c=>(c.question+' '+c.answer+' '+c.topic).toLowerCase().includes(query.toLowerCase()))
 const current=list.find(c=>c.id===selected)??list[0]
 useEffect(()=>{setRevealed(false);retry.current=null},[current?.id,current?.version])
 useEffect(()=>{void refresh()},[syncVersion])
 async function refresh(){if(lock.current)return;setError('');try{setCards(await window.api.reviewList());setLoaded(true)}catch(e){setError(String(e))}}
 useEffect(()=>{void refresh();const update=()=>setToday(localDateKey());const timer=setInterval(update,30000);window.addEventListener('focus',update);return()=>{clearInterval(timer);window.removeEventListener('focus',update)}},[])
 function changeDraft(d:ReviewDraft|null){setDraft(d);setDiscard(false);try{writeReviewDraft(d)}catch{setError('本机草稿保存失败，请保留此页面并保存卡片。')}}
 function startEdit(c?:ReviewCard){if(draft){setEditing(true);setMessage('先完成或放弃当前草稿，再编辑另一张卡片。');return}changeDraft(c?{id:c.id,question:c.question,answer:c.answer,topic:c.topic,sourceRoot:c.sourceRoot,sourcePath:c.sourcePath,version:c.version}:newReviewDraft());setEditing(true);setError('')}
 async function mutate(action:()=>Promise<ReviewCard>,success:(c:ReviewCard)=>void){
  if(lock.current)return;lock.current=true;setBusy(true);setError('')
  try{const c=await action();setCards(old=>[c,...old.filter(x=>x.id!==c.id)]);success(c)}catch(e){setError(String(e))}finally{lock.current=false;setBusy(false)}
 }
 async function save(){if(!draft)return;await mutate(()=>window.api.reviewSave(draft),c=>{changeDraft(null);setEditing(false);setMode('library');setQuery('');setSelected(c.id);setMessage('卡片已保存。'+(c.reviews?'原有复习计划已保留。':'今天就可以开始回忆。'))})}
 async function rate(rating:ReviewRating){
  if(!current||!revealed||current.dueDate>today||current.archived)return
  const input=retry.current?.id===current.id&&retry.current.version===current.version&&retry.current.rating===rating?retry.current:{id:current.id,version:current.version,rating,token:crypto.randomUUID()}
  retry.current=input
  await mutate(()=>window.api.reviewRate(input),c=>{retry.current=null;setSelected(null);setRevealed(false);setMessage('已安排下次复习 · '+c.dueDate);requestAnimationFrame(()=>answerButton.current?.focus())})
 }
 function source(){if(!current)return;sessionStorage.setItem('knowledgeOpenNote',JSON.stringify({root:current.sourceRoot,path:current.sourcePath}));useApp.setState({knowledgeSection:'notes'});useApp.getState().go('knowledge')}
 const upcoming=active.filter(c=>c.dueDate>today).sort((a,b)=>a.dueDate.localeCompare(b.dueDate))[0]
 return <div className="review-page">
  <header className="review-heading"><div className="page-title"><span className="en">RECALL</span><span className="zh">让知识，再次浮现。</span></div><button className="btn primary" disabled={busy} onClick={()=>draft?setEditing(true):startEdit()}>{draft?'继续编辑草稿':'新建复习卡'}</button></header>
  <div className="review-metrics"><span><b>{due.length}</b> 今日待复习</span><span><b>{active.length}</b> 张学习卡</span><p>先凭记忆回答，再翻开答案。</p></div>
  {error&&<div className="review-notice error" role="alert">{error}<button className="btn" disabled={busy} onClick={()=>void refresh()}>重新加载</button></div>}
  {message&&<div className="review-notice" role="status">{message}</div>}
  <div className="review-columns">
   <aside className="glass review-sidebar">
    <div className="review-tabs" aria-label="复习卡范围">{([['today','今日'],['library','全部'],['archive','归档']] as const).map(([id,label])=><button aria-pressed={mode===id} key={id} disabled={busy} onClick={()=>{setMode(id);setSelected(null);setRevealed(false)}}>{label}</button>)}</div>
    <input aria-label="搜索复习卡" placeholder="搜索问题、答案或科目…" value={query} onChange={e=>{setQuery(e.target.value);setRevealed(false)}}/>
    <div className="review-list">{list.map(c=><button key={c.id} disabled={busy||editing} className={current?.id===c.id?'selected':''} onClick={()=>{setSelected(c.id);setRevealed(false)}}><small>{c.topic||'未分类'} · {c.archived?'已归档':c.dueDate<=today?'待复习':c.dueDate}</small><strong>{c.question}</strong></button>)}{loaded&&!list.length&&<p>{query?'没有匹配的卡片。':mode==='archive'?'归档卡片会保留在这里。':mode==='today'?(active.length?'今天的队列已清空。':'新卡片会加入今日队列。'):'还没有卡片，从一个问题开始。'}</p>}{!loaded&&<p>{error?'暂时无法读取卡片。':'正在读取复习卡…'}</p>}</div>
    <button className="review-library-link" onClick={()=>{useApp.setState({knowledgeSection:'notes'});useApp.getState().go('knowledge')}}>去知识库选取内容 ↗</button>
   </aside>
   {editing&&draft?<section className="glass review-editor">
    <header><small>{draft.version?'EDIT CARD':'NEW CARD'}</small><h2>{draft.version?'把问题问得更清楚。':'一次只记住一个知识点。'}</h2></header>
    <label>问题 <small>先问自己一个能够独立回答的问题</small><textarea disabled={busy} aria-label="复习问题" maxLength={500} value={draft.question} onChange={e=>changeDraft({...draft,question:e.target.value})} placeholder="例如：矩阵的秩，表示什么？"/></label>
    <label>答案<textarea className="review-answer-input" disabled={busy} aria-label="复习答案" maxLength={20000} value={draft.answer} onChange={e=>changeDraft({...draft,answer:e.target.value})} placeholder="写下关键结论，再补一个自己的例子。"/></label>
    <label>科目 / 标签<input disabled={busy} aria-label="复习科目" maxLength={80} value={draft.topic} onChange={e=>changeDraft({...draft,topic:e.target.value})} placeholder="例如：线性代数"/></label>
    {draft.sourcePath&&<small className="review-source">来源：{draft.sourcePath} · 保存为独立卡片</small>}
    <footer><button className="btn primary" disabled={busy||!draft.question.trim()||!draft.answer.trim()} onClick={()=>void save()}>{busy?'保存中…':'保存卡片'}</button><button className="btn" disabled={busy} onClick={()=>setEditing(false)}>收起，保留草稿</button><button className="btn" disabled={busy} onClick={()=>{if(!discard){setDiscard(true);return}changeDraft(null);setEditing(false)}}>{discard?'确认放弃草稿':'放弃草稿'}</button></footer>
    <small>编辑时自动保留本机草稿；保存后加入卡片库。</small>
   </section>:<section className="review-study">
    {current?<motion.article key={current.id} className="glass review-card" initial={reduce?false:{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{duration:.2}}>
     <header><span>{current.topic||'KNOWLEDGE CARD'}</span><small>{current.archived?'已归档':current.dueDate<=today?'现在，试着回忆':`下次复习 ${current.dueDate}`}</small></header>
     <div className="review-question"><small>QUESTION</small><h2>{current.question}</h2></div>
     {revealed?<div className="review-answer" data-review-answer><small>ANSWER</small><p>{current.answer}</p></div>:<div className="review-recall-prompt"><span aria-hidden="true">?</span><p>在心里说一遍，或试着写下来。<br/>暂时想不起来，也没关系。</p></div>}
     {!revealed?<button ref={answerButton} className="btn primary review-reveal" onClick={()=>setRevealed(true)}>翻开答案</button>:current.dueDate<=today&&!current.archived?<div className="review-rating" aria-label="回忆结果">{([['again','没记住'],['familiar','有印象'],['remembered','记住了']] as const).map(([rating,label])=><button key={rating} disabled={busy} onClick={()=>void rate(rating)}><strong>{label}</strong><small>{reviewInterval(current.intervalDays,rating)} 天后复习</small></button>)}</div>:<p className="review-readonly">{current.archived?'恢复卡片后可按原计划继续复习。':'提前查看不会改变复习计划。'}</p>}
     <footer><button className="btn" disabled={busy} onClick={()=>startEdit(current)}>编辑卡片</button><button className="btn" disabled={busy} onClick={()=>void mutate(()=>window.api.reviewArchive({id:current.id,version:current.version,archived:!current.archived}),c=>{setSelected(null);setMessage(c.archived?'卡片已归档，可在归档页恢复。':'卡片已恢复。')})}>{current.archived?'恢复卡片':'归档卡片'}</button>{current.sourcePath&&<button className="btn" onClick={source}>回看来源笔记 ↗</button>}</footer>
    </motion.article>:<div className="glass review-empty"><div className="review-orbit" aria-hidden="true"><i/><span>?</span></div><small>MAKE IT YOURS</small><h2>{query?'换一个关键词试试。':active.length?'今天，给记忆一点时间。':'学过之后，再问自己一次。'}</h2><p>{query?'可以搜索问题、答案和科目。':upcoming?`下一张卡片将在 ${upcoming.dueDate} 回来。你也可以在“全部”中查看或整理卡片。`:'把知识点、错题或阅读笔记变成一问一答，留给未来的自己。'}</p><button className="btn primary" onClick={()=>startEdit()}>制作一张卡片</button></div>}
   </section>}
  </div>
 </div>
}
