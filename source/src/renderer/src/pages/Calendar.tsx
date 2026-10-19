import {LearningCategorySelect,LearningCategoryFilter,LearningCategoryBadge,LearningRecordCategoryEditor} from '../components/LearningCategoryControl'
import {useApp} from '../store/app'
import { useEffect, useMemo, useRef, useState } from 'react'
import { localDateKey } from '../../../shared/date'
import { CALENDAR_LABELS, calendarEntrySeconds, formatCalendarDuration, groupCalendarDays } from '../../../shared/calendarGroups'
import {EVENT_COLORS,type CalendarEntry,type CalEvent} from '../../../shared/types'
import '../styles/calendar-groups.css'
import '../styles/planner-editors.css'

type EventDraft=Omit<CalEvent,'id'>&{id?:number}
function OriginalRecord({entry,onEdit,onDelete,busy=false}:{entry:CalendarEntry;onEdit?:(entry:CalendarEntry)=>void;onDelete?:(entry:CalendarEntry)=>void;busy?:boolean}){
 const timestamp=entry.ts===undefined?null:new Date(entry.ts)
 return <article className={'calendar-raw-entry record-'+entry.kind} data-entry-id={entry.id}>
  <header><span>{entry.date}{entry.state?' · '+entry.state:''}</span>{timestamp&&<time dateTime={timestamp.toISOString()}>{timestamp.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}</time>}</header>
  <h4>{entry.title||'（未命名任务）'}</h4>
  {entry.kind==='focus'&&<small>{calendarEntrySeconds(entry)===null?'时长未记录':formatCalendarDuration(calendarEntrySeconds(entry)!)}</small>}
  <LearningCategoryBadge id={entry.categoryId}/><p>{entry.detail}</p>{(entry.kind==='focus'||entry.kind==='journal')&&/^\w+-[1-9]\d*$/.test(entry.id)&&<LearningRecordCategoryEditor kind={entry.kind} id={Number(entry.id.split('-')[1])} categoryId={entry.categoryId}/>}
  {entry.kind==='event'&&onEdit&&onDelete&&<div className="calendar-event-actions"><button className="btn" disabled={busy} onClick={()=>onEdit(entry)} aria-label={'编辑安排：'+entry.title}>编辑安排</button><button className="btn" disabled={busy} onClick={()=>onDelete(entry)} aria-label={'删除安排：'+entry.title}>删除安排</button></div>}
 </article>
}
export default function Calendar(){
 const syncVersion=useApp(s=>s.dataSyncVersion)
 const revision=useApp(s=>s.dataRevision),today=useApp(s=>s.localDay),events=useApp(s=>s.events)
 const [cursor,setCursor]=useState(()=>new Date()),[selected,setSelected]=useState(today)
 const [entries,setEntries]=useState<CalendarEntry[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0)
 const [eventForm,setEventForm]=useState<EventDraft|null>(null),[deletingEvent,setDeletingEvent]=useState<CalEvent|null>(null),[eventMessage,setEventMessage]=useState(''),[busy,setBusy]=useState(false)
 const eventLock=useRef(false)
 const [categoryFilter,setCategoryFilter]=useState<string|undefined>()
 const detailScroll=useRef<HTMLDivElement>(null)
 const month=localDateKey(new Date(cursor.getFullYear(),cursor.getMonth(),1)).slice(0,7)
 useEffect(()=>{detailScroll.current?.scrollTo({top:0})},[selected,month])
 useEffect(()=>{let live=true;setLoading(true);setError('');setEntries([]);window.api.calendarMonth(month).then(e=>{if(!Array.isArray(e))throw Error('invalid calendar response');if(live)setEntries(e)}).catch(()=>{if(live)setError('读取日历失败，当前月份的记录暂未显示。请重试。')}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[month,retry,syncVersion,revision])
 const daysByDate=useMemo(()=>groupCalendarDays(entries.filter(e=>categoryFilter===undefined||(e.categoryId??'')===categoryFilter)),[entries,categoryFilter])
 const day=daysByDate.get(selected),groups=day?.groups??[],focus=groups.find(group=>group.kind==='focus')?.focus
 const first=new Date(cursor.getFullYear(),cursor.getMonth(),1),offset=(first.getDay()+6)%7,days=new Date(cursor.getFullYear(),cursor.getMonth()+1,0).getDate()
 function move(n:number){const d=new Date(cursor.getFullYear(),cursor.getMonth()+n,1);setCursor(d);setSelected(localDateKey(d))}
 function existingEvent(entry:CalendarEntry):CalEvent|null{
  const match=/^event-(\d+)$/.exec(entry.id),event=match?events.find(event=>event.id===Number(match[1])):undefined
  if(!event){setEventMessage('这条安排已变化，请刷新后重试。');setRetry(value=>value+1);return null}
  return event
 }
 function editEvent(entry:CalendarEntry){const event=existingEvent(entry);if(event){setDeletingEvent(null);setEventForm({...event});setEventMessage('');detailScroll.current?.scrollTo({top:0})}}
 function confirmEventDelete(entry:CalendarEntry){const event=existingEvent(entry);if(event){setEventForm(null);setDeletingEvent(event);setEventMessage('');detailScroll.current?.scrollTo({top:0})}}
 async function saveEvent(){
  if(!eventForm||eventLock.current)return
  const submitted={...eventForm};eventLock.current=true;setBusy(true);setEventMessage('')
  try{
   if(submitted.id===undefined)await window.api.eventsAdd(submitted)
   else await window.api.eventsUpdate({...submitted,id:submitted.id})
   await useApp.getState().refresh()
   const [year,month]=submitted.date.split('-').map(Number);setCursor(new Date(year,month-1,1));setSelected(submitted.date)
   setEventForm(null);setEventMessage('安排已保存。')
  }catch(error){setEventMessage(error instanceof Error?error.message:'保存未完成，请重试。')}finally{eventLock.current=false;setBusy(false)}
 }
 async function removeEvent(){
  if(!deletingEvent||eventLock.current)return
  eventLock.current=true;setBusy(true);setEventMessage('')
  try{await window.api.eventsDelete(deletingEvent.id,'删除安排');await useApp.getState().refresh();setDeletingEvent(null);setEventMessage('安排已删除；待办、学习历史和已导出的备份保留。')}catch(error){setEventMessage(error instanceof Error?error.message:'删除未完成，请重试。')}finally{eventLock.current=false;setBusy(false)}
 }
 return <div className="calendar-page calendar-grouped">
  <header className="planner-heading"><div className="page-title"><span className="en">CALENDAR</span><span className="zh">日历</span></div><p>同一天的记录，按类别一起回看。</p></header>
  <LearningCategoryFilter value={categoryFilter} onChange={setCategoryFilter}/>
  <div className="calendar-layout">
   <section className="month-board glass" aria-label="月历" aria-busy={loading} tabIndex={0}>
    <header><div><small>{cursor.getFullYear()}</small><h2>{String(cursor.getMonth()+1).padStart(2,'0')}<span>月</span></h2></div><div className="month-actions"><button aria-label="上个月" disabled={busy} onClick={()=>move(-1)}>‹</button><button disabled={busy} onClick={()=>{setCursor(new Date());setSelected(localDateKey())}}>今天</button><button aria-label="下个月" disabled={busy} onClick={()=>move(1)}>›</button></div></header>
    <div className="calendar-week">{['一','二','三','四','五','六','日'].map(d=><span key={d}>{d}</span>)}</div>
    <div className="calendar-grid">{Array.from({length:Math.ceil((offset+days)/7)*7},(_,i)=>{
     const number=i-offset+1;if(number<1||number>days)return <div className="calendar-blank" key={i}/>
     const date=month+'-'+String(number).padStart(2,'0'),record=daysByDate.get(date),kinds=record?.groups??[],focus=kinds.find(group=>group.kind==='focus')?.focus
     const summary=record?kinds.length+' 类 / '+record.entryCount+' 条明细':'暂无记录'
     const focusSummary=focus?(focus.unknownDurationCount?'已知专注':'专注')+' '+formatCalendarDuration(focus.seconds,true):''
     return <button key={date} data-calendar-date={date} className={'calendar-day'+(date===today?' is-today':'')} aria-label={date+'，'+(loading?'正在读取':error?'记录暂不可用':summary+(focusSummary?'，'+focusSummary+'，'+focus!.sessionCount+' 段':''))} disabled={busy||loading||Boolean(error)} aria-pressed={date===selected} onClick={()=>setSelected(date)}>
      <strong>{number}</strong>{date===today&&<small>今天</small>}
      <div className="day-marks">{kinds.map(group=><i key={group.kind} className={'mark-'+group.kind} title={CALENDAR_LABELS[group.kind]}/>)}</div>
      {focus&&!loading&&!error&&<span className="calendar-cell-focus">{focusSummary}</span>}
      <span className="calendar-cell-count">{!loading&&!error&&record?kinds.length+' 类 / '+record.entryCount+' 条':''}</span>
     </button>
    })}</div>
    <footer className="calendar-legend">{Object.entries(CALENDAR_LABELS).map(([kind,label])=><span key={kind}><i className={'mark-'+kind}/>{label}</span>)}</footer>
   </section>
   <section className="day-board glass" aria-label="当天记录" aria-busy={loading}>
    <header><small>DAY IN REVIEW</small><h2>{selected}</h2><p>{loading?'正在读取…':error?'记录暂不可用':groups.length+' 类 / '+(day?.entryCount??0)+' 条明细'}</p>{focus&&!loading&&!error&&<p className="calendar-day-focus">{focus.unknownDurationCount?'已知专注时长':'专注总时长'} <strong>{formatCalendarDuration(focus.seconds)}</strong><span> · {focus.sessionCount} 段</span></p>}</header>
    <div className="calendar-day-scroll" ref={detailScroll} role="region" aria-label={selected+' 的当天记录明细'} tabIndex={0}>
    <div className="calendar-event-actions"><button className="btn" disabled={busy} onClick={()=>{setDeletingEvent(null);setEventForm({title:'',date:selected,kind:'学习'});setEventMessage('')}}>新增安排</button></div>
    {eventMessage&&<p className="calendar-event-message" role="status">{eventMessage}</p>}
    {eventForm&&<form className="planner-record-editor" aria-label={eventForm.id===undefined?'新增日历安排':'编辑日历安排'} onSubmit={e=>{e.preventDefault();void saveEvent()}}><fieldset disabled={busy}>
     <LearningCategorySelect label="安排学习分类" value={eventForm.categoryId} onChange={categoryId=>setEventForm({...eventForm,categoryId})}/>
     <label>标题<input aria-label="安排标题" required maxLength={300} value={eventForm.title} onChange={e=>setEventForm({...eventForm,title:e.target.value})}/></label>
     <label>日期<input aria-label="安排日期" required type="date" value={eventForm.date} onChange={e=>setEventForm({...eventForm,date:e.target.value})}/></label>
     <label>安排类型<select aria-label="安排分类" value={eventForm.kind} onChange={e=>setEventForm({...eventForm,kind:e.target.value as CalEvent['kind']})}>{Object.keys(EVENT_COLORS).map(kind=><option key={kind} value={kind}>{kind}</option>)}</select></label>
     <div><button className="btn primary" disabled={!eventForm.title.trim()}>{busy?'正在保存…':'保存安排'}</button><button className="btn" type="button" onClick={()=>setEventForm(null)}>取消</button></div>
    </fieldset></form>}
    {deletingEvent&&<section className="calendar-event-delete" role="group" aria-label="确认删除日历安排"><p>删除“{deletingEvent.title}”？仅移除这条安排，待办、专注、习惯和日记保留；已有备份不变。</p><div><button className="btn danger" disabled={busy} onClick={()=>void removeEvent()}>确认删除安排</button><button className="btn" disabled={busy} onClick={()=>setDeletingEvent(null)}>取消</button></div></section>}
    {error?<p className="calendar-load-message" role="alert">{error}<button className="btn" onClick={()=>setRetry(retry+1)}>重试</button></p>:loading?<p className="calendar-load-message" role="status">正在读取本月记录…</p>:!day?<div className="planner-empty"><span>DAY {selected.slice(-2)}</span><h3>这一天，还留着空白。</h3><p>完成待办、打卡习惯、写下日记或结束专注后，记录会自动出现在对应日期。</p></div>:<div className="calendar-kind-groups">
     {groups.map(group=>group.focus?<section key={group.kind} className="calendar-kind-group calendar-focus-group record-focus" data-calendar-kind="focus" aria-label="当日专注汇总">
      <header className="calendar-group-heading"><h3>专注</h3><span>{group.focus.sessionCount} 段明细</span></header>
      <p className="calendar-focus-total"><strong>{formatCalendarDuration(group.focus.seconds)}</strong><span>{group.focus.unknownDurationCount?'已知时长':'当天累计'}</span></p>
      {group.focus.unknownDurationCount>0&&<p className="calendar-duration-notice">另有 {group.focus.unknownDurationCount} 段未记录时长，原始明细仍保留。</p>}
      <div className="calendar-focus-tasks">{group.focus.tasks.map(task=><section className="calendar-focus-task" key={task.taskLabel} data-task-label={task.taskLabel}>
       <header><h4>{task.taskLabel}</h4><span>{task.unknownDurationCount?'已知 ':''}{formatCalendarDuration(task.seconds)} · {task.sessionCount} 次</span></header>
       <details className="calendar-task-details"><summary>查看 {task.sessionCount} 段原始时间明细</summary><div>{task.entries.map((entry,index)=><OriginalRecord key={entry.id+':'+index} entry={entry}/>)}</div></details>
      </section>)}</div>
     </section>:<details key={group.kind} className={'calendar-kind-group record-'+group.kind} data-calendar-kind={group.kind}>
      <summary className="calendar-group-summary"><span>{CALENDAR_LABELS[group.kind]??'其他'}</span><strong>{group.entries.length} 条明细</strong></summary>
      <div className="calendar-original-records">{group.entries.map((entry,index)=><OriginalRecord key={entry.id+':'+index} entry={entry} onEdit={editEvent} onDelete={confirmEventDelete} busy={busy}/>)}</div>
     </details>)}
    </div>}
    <footer>分类与任务合并只用于显示，展开可查看原始标题、内容、状态与时间。待办的计划日与完成日分别保留；跨日专注按结束日期记录。</footer>
    </div>
   </section>
  </div>
 </div>
}
