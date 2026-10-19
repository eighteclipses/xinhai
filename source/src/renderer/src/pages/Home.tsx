import GrowthNotes from '../components/GrowthNotes'
import HomeLayout from '../components/HomeLayout'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type {HomeViewport} from '../../../shared/homeViewport'
import '../styles/home-scale.css'
import { useApp } from '../store/app'
import { DIMENSIONS, DIMENSION_NAMES, EVENT_COLORS, idiomOf, levelOf, formatDuration } from '../../../shared/types'

function dayKey(d: Date): string {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}
function greeting(h: number): string {
  if (h >= 5 && h < 12) return '今天，也从这里开始。'
  if (h >= 12 && h < 18) return '还来得及，完成重要的事。'
  if (h >= 18 && h < 23) return '今晚，要一起学习吗？'
  return '慢一点，也是在向前。'
}
export default function Home({viewport}:{viewport?:HomeViewport}) {
  const page = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(new Date())
  const [selectedTask, setSelectedTask] = useState('')
  const { stats, growthSummary, todos, focusSessions, events, go, todaySeconds, focusClock,localDay } = useApp()
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  const today = dayKey(now)
  const dailyReady=growthSummary?.date===today&&localDay===today
  const pending = todos.filter(t => !t.done && (!t.date || t.date <= today))
    .sort((a, b) => b.priority - a.priority)
  const nextTask = pending.find(t => String(t.id) === selectedTask) ?? pending[0]
  const upcoming = events.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 2)
  const startFocus = () => {
    if (nextTask) {
      sessionStorage.setItem('focusTodoId', String(nextTask.id))
      sessionStorage.setItem('focusTodoTitle', nextTask.title)
    }
    go('focus')
  }
  return (
    <div className="desk-page" ref={page} data-auto-scaled={viewport&&viewport.scale>1?'true':undefined} style={viewport?{zoom:viewport.scale,width:viewport.logicalWidth,minHeight:viewport.logicalHeight,'--home-logical-width':viewport.logicalWidth+'px'} as CSSProperties:undefined}>
      <div className="desk-date">
        <span className="date-month">{String(now.getMonth() + 1).padStart(2, '0')}</span>
        <span className="date-slash">/</span>
        <strong>{String(now.getDate()).padStart(2, '0')}</strong>
        <div><span>{['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][now.getDay()]}</span><small>{now.getFullYear()}</small></div>
      </div>
      <div className="desk-content">
        <div className="desk-kicker"><span className="section-index">00</span><span className="pv-label">DAILY LIFE / 共学桌面</span></div>
        <div className="desk-clock" aria-label={now.toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'})}>
          {String(now.getHours()).padStart(2, '0')}<span>:</span>{String(now.getMinutes()).padStart(2, '0')}
          <small>{now.getHours() < 12 ? 'AM' : 'PM'}</small>
        </div>
        <h1>{greeting(now.getHours())}</h1>
        <p className="desk-subtitle">把世界调小一点，把注意力留给自己。</p>
        <section className="next-focus pv-frame">
          <div className="next-focus-top"><span>YOUR NEXT MOVE</span><small>下一段专注</small></div>
          {pending.length > 0 ? <label className="desk-task-picker"><span className="sr-only">选择专注任务</span><select value={String(nextTask?.id ?? '')} onChange={e => setSelectedTask(e.target.value)}>{pending.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label> : <h2>从一件小事开始。</h2>}
          <div className="next-focus-bottom">
            <span>{nextTask ? '预计 ' + nextTask.estPomos + ' 个番茄 · 投入整分累计 ' + nextTask.focusMinutes + ' 分（每段取整）' : '选择节奏，进入你的专注时间。'}</span>
            <button className="desk-start" onClick={startFocus}><span>{focusClock ? '回到专注' : '开始专注'}</span><span aria-hidden="true">↗</span></button>
          </div>
        </section>
        <div className="desk-links"><button onClick={() => go('todos')}><span>＋</span>安排今天<small>PLAN</small></button><button onClick={() => go('journal')}><span>✎</span>写下此刻<small>JOURNAL</small></button></div>
        {focusSessions[0] && <button className="home-last-session" onClick={()=>go('history')}><span>上一段专注 · {focusSessions[0].taskLabel || '自由专注'}</span><strong>{formatDuration(focusSessions[0].seconds ?? focusSessions[0].minutes * 60)}</strong><small>{focusSessions[0].seconds === undefined ? '旧记录 · 分钟精度' : '有效时间 · 分:秒'} ↗</small></button>}
        <div className="desk-details">
          <section>
            <div className="desk-section-title"><h2>接下来的安排</h2><button onClick={() => go('calendar')} aria-label="查看日历">↗</button></div>
            {upcoming.length ? upcoming.map(e => <button className="desk-agenda" key={e.id} onClick={() => go('calendar')}><time>{e.date.slice(5).replace('-', '/')}</time><span><small style={{color: EVENT_COLORS[e.kind]}}>{e.kind}</small>{e.title}</span></button>) : <p className="desk-empty">今天还有留白。<button onClick={() => go('calendar')}>添加日程 ↗</button></p>}
          </section>
          <section className="desk-today">
            <div className="desk-section-title"><h2>今日足迹</h2><span className="tiny-label">TODAY</span></div>
            <div><button onClick={() => go('history')}><strong>{dailyReady?formatDuration(todaySeconds):'更新中…'}</strong><span>专注 · 分:秒</span></button><button onClick={() => go('stats')}><strong className="today-resonance">{dailyReady?<GrowthNotes points={growthSummary!.todayMaxPoints}/>:<span>更新中…</span>}</strong><span>今日回响</span></button></div>
          </section>
        </div>
      </div>

      <div className="desk-growth-strip">
        <div className="growth-strip-label"><span>INNER STATUS</span><strong>心之成长</strong></div>
        {DIMENSIONS.map(d => {
          const level = levelOf(stats[d])
          return <button key={d} onClick={() => go('stats')}><span className="growth-strip-name">{DIMENSION_NAMES[d]}<small>Lv.{level}</small></span><strong>{idiomOf(d,level)}</strong><span className="growth-strip-bar"><i style={{width: (level/5*100)+'%'}} /></span></button>
        })}
      </div>
      <HomeLayout page={page} autoScale={viewport?.scale??1} />
    </div>
  )
}
