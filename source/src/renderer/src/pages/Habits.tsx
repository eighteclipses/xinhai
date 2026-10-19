import {LearningCategorySelect,LearningCategoryFilter,LearningCategoryBadge} from '../components/LearningCategoryControl'
import { localDateKey } from '../../../shared/date'
import { useEffect,useRef, useState,type ReactNode } from 'react'
import { AnimatePresence,Reorder,useDragControls } from 'framer-motion'
import { useApp } from '../store/app'
import { DIMENSIONS, DIMENSION_COLORS, DIMENSION_NAMES, type Habit,type DimensionId,type HabitUpdateInput } from '../../../shared/types'
import { playClick } from '../lib/audio'
import { playVoiceCat } from '../lib/voice'
import '../styles/planner-editors.css'

function dayStr(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() - offset)
  return localDateKey(d)
}

function SortableHabit({habit,children,history,editor,busy,onStart,onEnd,move}:{habit:Habit;children:ReactNode;history:ReactNode;editor?:ReactNode;busy:boolean;onStart:()=>void;onEnd:()=>void;move:(offset:number)=>void}){
 const controls=useDragControls()
 return <Reorder.Item layout="position" as="div" value={habit} dragListener={false} dragControls={controls} onDragStart={onStart} onDragEnd={onEnd} className="glass habit-row" data-habit-id={habit.id} style={{padding:'12px 18px'}}>
 <div className="habit-row-main"><button className="habit-drag" disabled={busy} aria-label={'拖动排序：'+habit.name} title="按住拖动排序，也可用上下方向键" onPointerDown={e=>{if(!busy)controls.start(e)}} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();if(!busy)move(e.key==='ArrowUp'?-1:1)}}}>⠿</button>{children}</div>{editor}{history}</Reorder.Item>
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
  const [weeklyTarget,setWeeklyTarget]=useState(7),[editing,setEditing]=useState<HabitUpdateInput|null>(null)
  const [categoryId,setCategoryId]=useState<string|null>(null),[categoryFilter,setCategoryFilter]=useState<string|undefined>()
  const localDay=useApp(s=>s.localDay)

  async function saveOrder(next:Habit[]){if(locked.current)return;locked.current=true;setBusy(true);setError('');try{await window.api.habitsReorder(next.map(h=>h.id));await refresh()}catch{setError('排序未保存，请重试。');setOrdered(useApp.getState().habits)}finally{locked.current=false;setBusy(false);setDragging(false)}}
  function move(id:number,offset:number){const list=[...ordered],i=list.findIndex(h=>h.id===id),j=i+offset;if(j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]];setOrdered(list);orderRef.current=list;void saveOrder(list)}
  async function remove(){if(!deleting||locked.current)return;locked.current=true;setBusy(true);setError('');try{await window.api.habitsDelete(deleting.id);setRemoved(deleting);setDeleting(null);await refresh()}catch{setError('删除未完成，请重试。')}finally{locked.current=false;setBusy(false)}}
  async function undo(){if(!removed||locked.current)return;locked.current=true;setBusy(true);try{await window.api.habitsRestore(removed.id);setRemoved(null);await refresh()}catch{setError('恢复失败，请重试。')}finally{locked.current=false;setBusy(false)}}
  const today = localDay
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
      <div className="glass habit-compose">
        <label>习惯名称<input aria-label="新习惯名称" maxLength={300} disabled={busy} placeholder="新习惯，例如：晨间拉伸" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>成长维度<select aria-label="新习惯维度" disabled={busy} value={dim} onChange={(e) => setDim(e.target.value as DimensionId)} style={{ background: 'color-mix(in srgb,var(--theme-panel) 80%,transparent)', color: 'var(--ice)', border: '1px solid var(--glass-line)', fontSize: 14 }}>
          {DIMENSIONS.map((d) => (
            <option key={d} value={d}>
              {DIMENSION_NAMES[d]}
            </option>
          ))}
        </select></label>
        <LearningCategorySelect value={categoryId} onChange={setCategoryId} disabled={busy}/>
        <label>每周目标天数<input aria-label="新习惯每周目标" type="number" min={1} max={7} step={1} disabled={busy} value={weeklyTarget} onChange={e=>setWeeklyTarget(Number(e.target.value))}/></label>
        <button
          className="btn primary"
          disabled={busy||!name.trim()||!Number.isInteger(weeklyTarget)||weeklyTarget<1||weeklyTarget>7}
          onClick={async () => {
            if (!name.trim()||locked.current) return
            locked.current=true;setBusy(true);setError('')
            try{await window.api.habitsAdd({ name: name.trim(), dimension: dim, weeklyTarget,categoryId });setName('');await refresh()}catch{setError('添加习惯失败，请重试。')}finally{locked.current=false;setBusy(false)}
          }}
        >
          <span>种下光点</span>
        </button>
      </div>

      <LearningCategoryFilter value={categoryFilter} onChange={setCategoryFilter}/>
      {categoryFilter!==undefined&&<p className="habit-sort-hint">筛选时可编辑与打卡；切回全部学习分类后可调整习惯顺序。</p>}
      <Reorder.Group as="div" axis="y" values={ordered} onReorder={next=>{if(!busy&&categoryFilter===undefined){setOrdered(next);orderRef.current=next}}} className="habit-list">
        <AnimatePresence initial={false}>
        {ordered.filter(h=>categoryFilter===undefined||(h.categoryId??'')===categoryFilter).map((h) => {
          const done = logs.some((l) => l.habitId === h.id && l.date === today)
          const sk = streak(h.id)
          return (
            <SortableHabit key={h.id} habit={h} busy={busy||categoryFilter!==undefined} onStart={()=>setDragging(true)} onEnd={()=>void saveOrder(orderRef.current)} move={offset=>move(h.id,offset)}
             editor={editing?.id===h.id&&<form className="planner-record-editor" aria-label="编辑习惯" onSubmit={e=>{e.preventDefault();if(locked.current)return;locked.current=true;setBusy(true);setError('');void window.api.habitsUpdate(editing).then(async()=>{setEditing(null);await refresh()}).catch(error=>setError(error instanceof Error?error.message:'修改未完成，请重试。')).finally(()=>{locked.current=false;setBusy(false)})}}><fieldset disabled={busy}>
              <LearningCategorySelect label="编辑习惯学习分类" value={editing.categoryId} onChange={categoryId=>setEditing({...editing,categoryId})}/>
              <label>名称<input aria-label="编辑习惯名称" required maxLength={300} value={editing.name} onChange={e=>setEditing({...editing,name:e.target.value})}/></label>
              <label>成长维度<select aria-label="编辑习惯维度" value={editing.dimension} onChange={e=>setEditing({...editing,dimension:e.target.value as DimensionId})}>{DIMENSIONS.map(d=><option key={d} value={d}>{DIMENSION_NAMES[d]}</option>)}</select></label>
              <LearningCategorySelect value={categoryId} onChange={setCategoryId} disabled={busy}/>
        <label>每周目标天数<input aria-label="编辑习惯每周目标" type="number" min={1} max={7} step={1} required value={editing.weeklyTarget} onChange={e=>setEditing({...editing,weeklyTarget:Number(e.target.value)})}/></label>
              <p>保留历史打卡与已获得成长；调整维度只影响之后的打卡。历史日历中的习惯名称会随当前名称显示。</p>
              <div><button className="btn primary" disabled={!editing.name.trim()||editing.weeklyTarget<1||editing.weeklyTarget>7}>保存习惯修改</button><button type="button" className="btn" onClick={()=>setEditing(null)}>取消</button></div>
             </fieldset></form>}
             history={<div className="habit-history-reveal" data-open={expanded===h.id} aria-hidden={expanded!==h.id}><div className="habit-history-clip"><section id={'habit-history-'+h.id} className="habit-history" aria-label={h.name+'的打卡记录'}><header><strong>最近 30 天</strong><span>{logs.filter(l=>l.habitId===h.id&&l.date>=dayStr(29)&&l.date<=today).length} 次打卡 · 每周目标 {h.weeklyTarget} 天</span></header><div>{Array.from({length:30},(_,i)=>dayStr(29-i)).map(d=>{const hit=logs.some(l=>l.habitId===h.id&&l.date===d);return <span key={d} className={hit?'hit':''} title={d+(hit?' 已打卡':' 未打卡')}><small>{d.slice(5)}</small><b>{hit?'✓':'—'}</b></span>})}</div><p>当天通过右侧按钮打卡。历史格子用于查看记录。</p></section></div></div>}>
              <button className="habit-history-toggle" aria-label={'查看打卡记录：'+h.name} aria-expanded={expanded===h.id} aria-controls={'habit-history-'+h.id} onClick={()=>setExpanded(expanded===h.id?null:h.id)}><LearningCategoryBadge id={h.categoryId}/><strong>{sk}</strong><small>连续天</small><span>{expanded===h.id?'收起':'记录 ›'}</span></button>
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
              <button className="btn" disabled={busy||dragging} aria-label={'编辑习惯：'+h.name} onClick={()=>{setDeleting(null);setEditing({id:h.id,name:h.name,dimension:h.dimension,weeklyTarget:h.weeklyTarget,categoryId:h.categoryId??null})}}>编辑</button>
              <button className="habit-delete" disabled={busy||dragging} aria-label={'删除习惯：'+h.name} onClick={()=>{setEditing(null);setDeleting(h)}}>删除</button>

            </SortableHabit>
          )
        })}
        </AnimatePresence>
      </Reorder.Group>
      {!ordered.length&&<p className="habit-sort-hint">还没有习惯，添加一件你想坚持的小事。</p>}
    </div>
  )
}
