import {useApp} from '../store/app'
import { useEffect, useState } from 'react'
import { localDateKey } from '../../../shared/date'
import type { CalendarEntry } from '../../../shared/types'
const LABELS={todo:'待办',habit:'习惯',journal:'日记',focus:'专注',event:'安排'}
export default function Calendar(){
 const syncVersion=useApp(s=>s.dataSyncVersion)
 const today=localDateKey(),[cursor,setCursor]=useState(()=>new Date()),[selected,setSelected]=useState(today)
 const [entries,setEntries]=useState<CalendarEntry[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0)
 const month=localDateKey(new Date(cursor.getFullYear(),cursor.getMonth(),1)).slice(0,7)
 useEffect(()=>{let live=true;setLoading(true);setError('');setEntries([]);window.api.calendarMonth(month).then(e=>{if(live)setEntries(e)}).catch(()=>{if(live)setError('读取日历失败，请重试。')}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[month,retry,syncVersion])
 const first=new Date(cursor.getFullYear(),cursor.getMonth(),1),offset=(first.getDay()+6)%7,days=new Date(cursor.getFullYear(),cursor.getMonth()+1,0).getDate()
 const dayEntries=entries.filter(e=>e.date===selected)
 function move(n:number){const d=new Date(cursor.getFullYear(),cursor.getMonth()+n,1);setCursor(d);setSelected(localDateKey(d))}
 return <div className="calendar-page">
  <header className="planner-heading"><div className="page-title"><span className="en">CALENDAR</span><span className="zh">日历</span></div><p>每一天做过的事，都在这里。</p></header>
  <div className="calendar-layout">
   <section className="month-board glass" aria-label="月历">
    <header><div><small>{cursor.getFullYear()}</small><h2>{String(cursor.getMonth()+1).padStart(2,'0')}<span>月</span></h2></div><div className="month-actions"><button aria-label="上个月" onClick={()=>move(-1)}>‹</button><button onClick={()=>{setCursor(new Date());setSelected(today)}}>今天</button><button aria-label="下个月" onClick={()=>move(1)}>›</button></div></header>
    <div className="calendar-week">{['一','二','三','四','五','六','日'].map(d=><span key={d}>{d}</span>)}</div>
    <div className="calendar-grid">{Array.from({length:Math.ceil((offset+days)/7)*7},(_,i)=>{
     const day=i-offset+1;if(day<1||day>days)return <div className="calendar-blank" key={i}/>
     const date=month+'-'+String(day).padStart(2,'0'),rows=entries.filter(e=>e.date===date),kinds=[...new Set(rows.map(e=>e.kind))]
     return <button key={date} className={'calendar-day'+(date===today?' is-today':'')} aria-label={`${date}，${rows.length} 条记录`} aria-pressed={date===selected} onClick={()=>setSelected(date)}><strong>{day}</strong>{date===today&&<small>今天</small>}<div className="day-marks">{kinds.map(k=><i key={k} className={'mark-'+k} title={LABELS[k]}/>)}</div><span>{rows.length?rows.length+' 条记录':''}</span></button>
    })}</div>
    <footer className="calendar-legend">{Object.entries(LABELS).map(([k,v])=><span key={k}><i className={'mark-'+k}/>{v}</span>)}</footer>
   </section>
   <section className="day-board glass" aria-label="当天记录" aria-busy={loading}>
    <header><small>DAY IN REVIEW</small><h2>{selected}</h2><p>{loading?'正在读取…':`${dayEntries.length} 条记录`}</p></header>
    {error?<p role="alert">{error}<button onClick={()=>setRetry(retry+1)}>重试</button></p>:!loading&&dayEntries.length===0?<div className="planner-empty"><span>DAY {selected.slice(-2)}</span><h3>这一天，还留着空白。</h3><p>完成待办、打卡习惯、写下日记或结束专注后，记录会自动出现在对应日期。</p></div>:<div className="day-records">{dayEntries.map(e=><article key={e.id} className={'day-record record-'+e.kind}><header><span>{LABELS[e.kind]}{e.state?' · '+e.state:''}</span>{e.ts&&<time>{new Date(e.ts).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time>}</header><h3>{e.title}</h3>{e.kind==='journal'?<details><summary>展开日记</summary><p>{e.detail}</p></details>:<p>{e.detail}</p>}</article>)}</div>}
    <footer>待办按计划日与实际完成日分别呈现。旧版未保存完成日期的待办不计入某天的完成记录；跨日专注按结束日期记录。</footer>
   </section>
  </div>
 </div>
}
