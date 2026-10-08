import { useRef,useState } from 'react'
import { useApp } from '../store/app'
import { localDateKey } from '../../../shared/date'
const COLORS=['#93cc96','#faba80','#ff5268'],PRIORITIES=['低','中','高']
export default function Todos(){
 const {todos,refresh,go}=useApp(),today=localDateKey()
 const [title,setTitle]=useState(''),[priority,setPriority]=useState(1),[date,setDate]=useState(today),[filter,setFilter]=useState('active'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[deleting,setDeleting]=useState<number|null>(null)
 const locked=useRef(false),input=useRef<HTMLInputElement>(null)
 const active=todos.filter(t=>!t.done),done=todos.filter(t=>t.done),overdue=active.filter(t=>t.date&&t.date<today)
 const list=todos.filter(t=>filter==='all'||(filter==='done'?t.done:filter==='today'?!t.done&&t.date===today:!t.done))
 async function act(fn:()=>Promise<unknown>){if(locked.current)return;locked.current=true;setBusy(true);setError('');try{await fn();await refresh()}catch{setError('操作未完成，请重试。')}finally{locked.current=false;setBusy(false)}}
 return <div className="todo-page">
  <header className="planner-heading"><div className="page-title"><span className="en">TASKS</span><span className="zh">待办事项</span></div><p>把想做的事，变成今天的一小步。</p></header>
  <div className="task-metrics"><div><strong>{active.length}</strong><span>待完成</span></div><div><strong>{active.filter(t=>t.date===today).length}</strong><span>今日计划</span></div><div><strong>{done.length}</strong><span>已完成</span></div><div><strong>{overdue.length}</strong><span>待重新安排</span></div></div>
  <div className="todo-layout"><section className="task-board glass">
   <form className="task-compose" onSubmit={e=>{e.preventDefault();if(title.trim())void act(async()=>{await window.api.todosAdd({title:title.trim(),priority,date,estPomos:1});setTitle('')})}}>
    <label className="task-title">下一件想完成的事<input ref={input} aria-label="待办标题" placeholder="例如：复习线性代数第三章" maxLength={300} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label>优先级<select aria-label="待办优先级" value={priority} onChange={e=>setPriority(Number(e.target.value))}>{PRIORITIES.map((p,i)=><option key={p} value={i}>{p}</option>)}</select></label>
    <label>计划日期<input aria-label="待办日期" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
    <button className="btn primary" disabled={busy||!title.trim()}>添加待办</button>
   </form>
   {error&&<p role="alert">{error}</p>}
   <div className="task-filters" aria-label="筛选待办">{[['active','待完成'],['today','今天'],['done','已完成'],['all','全部']].map(([id,label])=><button key={id} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}</div>
   <div className="task-list">{list.map(t=><article key={t.id} className={'task-row'+(t.done?' is-done':'')} style={{borderLeftColor:COLORS[t.priority]}}>
    <button className="task-check" disabled={busy} aria-label={(t.done?'恢复待办：':'完成待办：')+t.title} aria-pressed={t.done} onClick={()=>void act(()=>window.api.todosToggle(t.id))}>{t.done?'✓':''}</button>
    <div className="task-copy"><h3>{t.title}</h3><p><span style={{color:COLORS[t.priority]}}>{PRIORITIES[t.priority]}优先</span> · {t.date||'未设日期'} · 已专注 {t.focusMinutes} 分钟{!t.done&&t.date&&t.date<today?' · 已过计划日期':''}</p></div>
    {!t.done&&<button className="btn" onClick={()=>{sessionStorage.setItem('focusTodoId',String(t.id));sessionStorage.setItem('focusTodoTitle',t.title);go('focus')}}>专注</button>}
    <button className="task-remove" aria-label={'删除待办：'+t.title} disabled={busy} onClick={()=>setDeleting(t.id)}>×</button>
    {deleting===t.id&&<div className="task-delete-confirm"><span>删除这条待办？</span><button disabled={busy} onClick={()=>void act(async()=>{await window.api.todosDelete(t.id);setDeleting(null)})}>确认删除</button><button onClick={()=>setDeleting(null)}>取消</button></div>}
   </article>)}</div>
   {!list.length&&<div className="planner-empty"><span>ONE STEP AT A TIME</span><h3>{todos.length?'这一栏，已经清空了。':'今天，从一件小事开始。'}</h3><p>{todos.length?'切换筛选可以查看其他待办。':'写下具体的小目标，再用一段专注把它完成。'}</p>{!todos.length&&<button className="btn" onClick={()=>input.current?.focus()}>写下第一个目标</button>}</div>}
  </section><aside className="task-side glass"><small>START SMALL</small><h2>让计划<br/>有一个起点。</h2><p>不必一次安排一整天。先挑一件你愿意开始的事。</p>{['读完一节，记下三个要点','复习五道错题','整理今天的学习笔记'].map(t=><button key={t} onClick={()=>{setTitle(t);input.current?.focus()}}><span>＋</span>{t}</button>)}<footer>点击建议填入标题，由你决定是否添加。完成记录会自动进入日历。</footer></aside></div>
 </div>
}
