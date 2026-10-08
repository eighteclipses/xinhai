import { localDateKey } from '../../../shared/date'
import { useEffect,useRef, useState,type ReactNode } from 'react'
import { AnimatePresence,Reorder,useDragControls } from 'framer-motion'
import { useApp } from '../store/app'
import { DIMENSIONS, DIMENSION_COLORS, DIMENSION_NAMES, type Habit,type DimensionId } from '../../../shared/types'
import { playClick } from '../lib/audio'
import { playVoiceCat } from '../lib/voice'

function dayStr(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() - offset)
  return localDateKey(d)
}

function SortableHabit({habit,children,history,busy,onStart,onEnd,move}:{habit:Habit;children:ReactNode;history:ReactNode;busy:boolean;onStart:()=>void;onEnd:()=>void;move:(offset:number)=>void}){
 const controls=useDragControls()
 return <Reorder.Item layout="position" as="div" value={habit} dragListener={false} dragControls={controls} onDragStart={onStart} onDragEnd={onEnd} className="glass habit-row" data-habit-id={habit.id} style={{padding:'12px 18px'}}>
 <div className="habit-row-main"><button className="habit-drag" disabled={busy} aria-label={'拖动排序：'+habit.name} title="按住拖动排序，也可用上下方向键" onPointerDown={e=>{if(!busy)controls.start(e)}} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();if(!busy)move(e.key==='ArrowUp'?-1:1)}}}>⠿</button>{children}</div>{history}</Reorder.Item>
}

export default function Habits() {
  const habits = useApp((s) => s.habits)
  const [ordered,setOrdered]=useState(habits),[dragging,setDragging]=useState(false),[deleting,setDeleting]=useState<Habit|null>(null),[removed,setRemoved]=useState<Habit|null>(null)
  const orderRef=useRef(habits)
  useEffect(()=>{if(!dragging){setOrdered(habits);orderRef.current=habits}},[habits,dragging])
  const logs = useApp((s) => s.habitLogs)
  const receiveGrowth = useApp((s) => s.receiveGrowth)
  const locked = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = useApp((s) => s.refresh)
  const [expanded,setExpanded]=useState<number|null>(null)
  const [name, setName] = useState('')
  const [dim, setDim] = useState<DimensionId>('will')

  async function saveOrder(next:Habit[]){if(locked.current)return;locked.current=true;setBusy(true);setError('');try{await window.api.habitsReorder(next.map(h=>h.id));await refresh()}catch{setError('排序未保存，请重试。');setOrdered(useApp.getState().habits)}finally{locked.current=false;setBusy(false);setDragging(false)}}
  function move(id:number,offset:number){const list=[...ordered],i=list.findIndex(h=>h.id===id),j=i+offset;if(j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]];setOrdered(list);orderRef.current=list;void saveOrder(list)}
  async function remove(){if(!deleting||locked.current)return;locked.current=true;setBusy(true);setError('');try{await window.api.habitsDelete(deleting.id);setRemoved(deleting);setDeleting(null);await refresh()}catch{setError('删除未完成，请重试。')}finally{locked.current=false;setBusy(false)}}
  async function undo(){if(!removed||locked.current)return;locked.current=true;setBusy(true);try{await window.api.habitsRestore(removed.id);setRemoved(null);await refresh()}catch{setError('恢复失败，请重试。')}finally{locked.current=false;setBusy(false)}}
  const today = dayStr(0)
  const week = [6, 5, 4, 3, 2, 1, 0].map((o) => dayStr(o))

  function streak(habitId: number): number {
    let n = 0
    for (let o = 0; ; o++) {
      const d = dayStr(o)
      if (logs.some((l) => l.habitId === habitId && l.date === d)) n++
      else if (o === 0) continue // 今天没打不算断
      else break
      if (o > 3650) break
    }
    return n
  }

  async function punch(id: number) {
    if (locked.current || logs.some((l) => l.habitId === id && l.date === today)) return
    locked.current = true
    setBusy(true)
    setError('')
    try {
      const result = await window.api.habitsPunch(id)
      if (result) {
        playClick()
        const s = useApp.getState().settings
        if (s.voiceEnabled) void playVoiceCat('entrust', s.volume)
        await receiveGrowth(result)
      } else await refresh()
    } catch {
      setError('未能更新打卡，请重试。重复请求不会重复加分。')
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'relative', zIndex: 2, height: '100%', padding: '64px 56px 90px', display: 'flex', flexDirection: 'column', maxWidth: 980 }}>
      <div className="page-title" style={{ marginBottom: 8 }}>
        <span className="en">HABIT</span>
        <span className="zh">习惯记录</span>
      </div>
      <p style={{ fontSize: 14, color: 'var(--ink-dim)', letterSpacing: '0.2em', marginBottom: 20 }}>连续不是目的，重新回来才是。</p>

      {error && <p role="alert">{error}</p>}
      <p className="habit-sort-hint">按住左侧 ⠿ 上下拖动排序；也可聚焦手柄后按 ↑ / ↓。</p>
      {removed&&<div className="habit-notice" role="status">已删除“{removed.name}”，历史打卡和成长记录保留。<button disabled={busy} onClick={()=>void undo()}>撤销删除</button></div>}
      {deleting&&<div className="habit-notice" role="alert"><span>删除“{deleting.name}”？它会从习惯列表移除，过去的打卡和成长记录仍保留。</span><button disabled={busy} onClick={()=>void remove()}>确认删除习惯</button><button disabled={busy} onClick={()=>setDeleting(null)}>取消</button></div>}
      <div className="glass" style={{ padding: '12px 18px', display: 'flex', gap: 10, marginBottom: 20 }}>
        <input placeholder="新习惯，例如：晨间拉伸" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
        <select value={dim} onChange={(e) => setDim(e.target.value as DimensionId)} style={{ background: 'color-mix(in srgb,var(--theme-panel) 80%,transparent)', color: 'var(--ice)', border: '1px solid var(--glass-line)', fontSize: 14 }}>
          {DIMENSIONS.map((d) => (
            <option key={d} value={d}>
              {DIMENSION_NAMES[d]}
            </option>
          ))}
        </select>
        <button
          className="btn primary"
          onClick={async () => {
            if (!name.trim()||locked.current) return
            locked.current=true;setBusy(true);setError('')
            try{await window.api.habitsAdd({ name: name.trim(), dimension: dim, weeklyTarget: 7 });setName('');await refresh()}catch{setError('添加习惯失败，请重试。')}finally{locked.current=false;setBusy(false)}
          }}
        >
          <span>种下光点</span>
        </button>
      </div>

      <Reorder.Group as="div" axis="y" values={ordered} onReorder={next=>{if(!busy){setOrdered(next);orderRef.current=next}}} className="habit-list">
        <AnimatePresence initial={false}>
        {ordered.map((h) => {
          const done = logs.some((l) => l.habitId === h.id && l.date === today)
          const sk = streak(h.id)
          return (
            <SortableHabit key={h.id} habit={h} busy={busy} onStart={()=>setDragging(true)} onEnd={()=>void saveOrder(orderRef.current)} move={offset=>move(h.id,offset)} history={<div className="habit-history-reveal" data-open={expanded===h.id} aria-hidden={expanded!==h.id}><div className="habit-history-clip"><section id={'habit-history-'+h.id} className="habit-history" aria-label={h.name+'的打卡记录'}><header><strong>最近 30 天</strong><span>{logs.filter(l=>l.habitId===h.id&&l.date>=dayStr(29)).length} 次打卡 · 每周目标 {h.weeklyTarget} 天</span></header><div>{Array.from({length:30},(_,i)=>dayStr(29-i)).map(d=>{const hit=logs.some(l=>l.habitId===h.id&&l.date===d);return <span key={d} className={hit?'hit':''} title={d+(hit?' 已打卡':' 未打卡')}><small>{d.slice(5)}</small><b>{hit?'✓':'—'}</b></span>})}</div><p>当天通过右侧按钮打卡。历史格子用于查看记录。</p></section></div></div>}>
              <button className="habit-history-toggle" aria-label={'查看打卡记录：'+h.name} aria-expanded={expanded===h.id} aria-controls={'habit-history-'+h.id} onClick={()=>setExpanded(expanded===h.id?null:h.id)}><strong>{sk}</strong><small>连续天</small><span>{expanded===h.id?'收起':'记录 ›'}</span></button>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14 }}>{h.name}</div>
                <div style={{ fontSize: 12, color: 'white', letterSpacing: '0.2em', marginTop: 2 }}>
                  {DIMENSION_NAMES[h.dimension]} · 连续 {sk} 天
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {week.map((d) => {
                  const hit = logs.some((l) => l.habitId === h.id && l.date === d)
                  return (
                    <div key={d} title={d+(hit?' · 已打卡':' · 未打卡')} aria-label={d+(hit?' 已打卡':' 未打卡')} style={{ width: 14, height: 14, transform: 'skewX(-10deg)', background: hit ? DIMENSION_COLORS[h.dimension] : 'color-mix(in srgb,var(--theme-pale) 8%,transparent)', boxShadow: hit ? `0 0 8px color-mix(in srgb,${DIMENSION_COLORS[h.dimension]} 53%,transparent)` : 'none' }} />
                  )
                })}
              </div>
              <button className={done ? 'btn' : 'btn primary'} disabled={done || busy} style={{ padding: '6px 16px', fontSize: 14 }} onClick={() => punch(h.id)}>
                <span>{done ? '已点亮' : '打卡'}</span>
              </button>
              <button className="habit-delete" disabled={busy||dragging} aria-label={'删除习惯：'+h.name} onClick={()=>setDeleting(h)}>删除</button>

            </SortableHabit>
          )
        })}
        </AnimatePresence>
      </Reorder.Group>
      {!ordered.length&&<p className="habit-sort-hint">还没有习惯，添加一件你想坚持的小事。</p>}
    </div>
  )
}
