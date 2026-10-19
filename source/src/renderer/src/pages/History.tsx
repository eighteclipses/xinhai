import LearningCategoryStats from '../components/LearningCategoryStats'
import {LearningCategoryFilter,LearningRecordCategoryEditor} from '../components/LearningCategoryControl'
import GrowthNotes from '../components/GrowthNotes'
import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useApp } from '../store/app'
import { DIMENSION_COLORS, DIMENSION_NAMES, GROWTH_SOURCE_NAMES, formatDuration, type FocusTaskSummary } from '../../../shared/types'
import { normalizeFocusTaskLabel } from '../../../shared/focusTaskSummary'
import '../styles/history-focus-summary.css'

function cumulativeDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds)), hours = Math.floor(total / 3600), minutes = Math.floor(total / 60) % 60
  return `${hours ? `${hours} 小时 ` : ''}${minutes} 分 ${total % 60} 秒`
}

// 成长轨迹：体现自我成长的时间线，按周汇总
export default function History() {
  const events = useApp((s) => s.growthEvents)
  const sessions = useApp((s) => s.focusSessions)
  const dataSyncVersion = useApp((s) => s.dataSyncVersion)
  const dataResetVersion = useApp((s) => s.dataResetVersion)
  const [summary, setSummary] = useState<FocusTaskSummary | null>(null)
  const [summaryError, setSummaryError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [categoryFilter,setCategoryFilter]=useState<string|undefined>()
  const [query, setQuery] = useState('')
  useEffect(() => {
    let cancelled = false
    setSummary(null); setSummaryError('')
    void window.api.focusTaskSummary().then(value => { if (!cancelled) setSummary(value) })
      .catch(() => { if (!cancelled) setSummaryError('暂时无法读取累计专注时间，请重试。已有记录未改动。') })
    return () => { cancelled = true }
  }, [sessions, dataSyncVersion, dataResetVersion, attempt])
  const filteredTasks = useMemo(() => {
    const term = query.trim().replace(/\s+/gu, ' ')
    return summary?.tasks.filter(task => !term || task.taskLabel.includes(term)) ?? []
  }, [summary, query])

  const groups = useMemo(() => {
    const map = new Map<string, typeof events>()
    for (const e of events) {
      const d = new Date(e.ts)
      const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay()+6)%7)
      const key = `${day.getFullYear()}.${String(day.getMonth() + 1).padStart(2, '0')}.${String(day.getDate()).padStart(2, '0')} 周`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    return [...map.entries()]
  }, [events])

  return (
    <div className="history-page">
      <div className="page-title" style={{ marginBottom: 18 }}>
        <span className="en">RECORD</span>
        <span className="zh">成长轨迹</span>
        <button className="btn" onClick={()=>document.querySelector('[aria-label="管理学习分类"]')?.scrollIntoView({block:'start'})}>管理学习分类</button>
      </div>

      <div className="history-scroll">
      <div className="history-total-grid" aria-label="全部累计专注统计" aria-busy={!summary && !summaryError}>
        <div className="history-total-card history-total-time"><span>全部专注时长</span><strong data-focus-total-seconds={summary?.totalSeconds}>{summary ? cumulativeDuration(summary.totalSeconds) : '—'}</strong></div>
        <div className="history-total-card"><span>全部专注次数</span><strong data-focus-session-count={summary?.sessionCount}>{summary?.sessionCount.toLocaleString('zh-CN') ?? '—'}<small> 次</small></strong></div>
        <div className="history-total-card"><span>累计任务</span><strong>{summary?.tasks.length.toLocaleString('zh-CN') ?? '—'}<small> 项</small></strong></div>
        <div className="history-total-card"><span>已载入成长记录</span><strong>{events.length.toLocaleString('zh-CN')}<small> 条</small></strong></div>
      </div>

      <section className="glass history-task-summary" aria-labelledby="history-task-summary-title">
        <div className="history-task-summary-heading"><div><span className="en-label">TIME BY TASK</span><h2 id="history-task-summary-title">按任务累计专注</h2></div>
          <label className="history-task-search">查找任务<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="例如：背单词" /></label>
        </div>
        <p className="history-summary-scope">统计全部已保存专注，不受最近记录条数或日期限制。有效秒数不含暂停；旧记录按分钟 × 60 回退{summary && summary.legacySessionCount > 0 ? `（共 ${summary.legacySessionCount} 段旧记录）` : ''}。</p>
        <p className="history-summary-rules">任务名只合并首尾及连续空白；空名计为自由专注，不同名称和大小写分别统计。检索只筛选下表，不改变全量总数。</p>
        {summaryError ? <div className="history-summary-error" role="alert">{summaryError}<button className="btn" onClick={() => setAttempt(value => value + 1)}>重试读取</button></div>
          : !summary ? <p role="status">正在汇总全部专注记录…</p>
          : <>
            <div className="history-task-result-count" role="status">显示 {filteredTasks.length} / {summary.tasks.length} 项任务 · 按累计时长排列</div>
            <div className="history-task-table-wrap"><table className="history-task-table" aria-label="按任务累计专注时间"><thead><tr><th scope="col">任务</th><th scope="col">累计有效时间</th><th scope="col">次数</th><th scope="col">最近专注</th></tr></thead><tbody>
              {filteredTasks.map(task => <tr key={task.taskLabel} data-task-label={task.taskLabel} data-task-seconds={task.seconds} data-task-count={task.sessionCount}><th scope="row">{task.taskLabel}{task.legacySessionCount > 0 && <small>{task.legacySessionCount} 段旧记录按分钟计</small>}</th><td className="history-task-duration">{cumulativeDuration(task.seconds)}</td><td>{task.sessionCount.toLocaleString('zh-CN')}</td><td><time dateTime={new Date(task.lastEndedAt).toISOString()}>{new Date(task.lastEndedAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></td></tr>)}
            </tbody></table></div>
            {!filteredTasks.length && <p className="history-summary-empty">{summary.sessionCount ? '没有匹配的任务，试试其他名称。' : '还没有专注记录。完成并保存后，每项任务的时间会累计在这里。'}</p>}
          </>}
      </section>

      <LearningCategoryStats/>
      <section className="glass focus-history"><h2>最近专注</h2><p>这里展示最近 20 段；上方累计使用全部已保存记录。有效时间不含暂停，旧记录保留分钟精度。</p>
        <LearningCategoryFilter label="筛选最近专注的学习分类" value={categoryFilter} onChange={setCategoryFilter}/>
        {sessions.filter(session=>categoryFilter===undefined||(session.categoryId??'')===categoryFilter).slice(0,20).map(session=><div key={session.id}><div className="focus-history-row"><time>{new Date(session.endedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</time><span title={session.taskLabel}>{normalizeFocusTaskLabel(session.taskLabel)}<small>{session.mode}{session.seconds === undefined ? ' · 旧记录' : ''}</small></span><strong>{formatDuration(session.seconds ?? session.minutes*60)}</strong><span className="history-notes"><small>学识</small><GrowthNotes points={session.minutes}/></span></div><LearningRecordCategoryEditor kind="focus" id={session.id} categoryId={session.categoryId}/></div>)}
        {!sessions.length && <p>完成第一段专注后，时间会保留在这里。</p>}
      </section>
      <div className="hairline" />

      <div className="history-growth-timeline" aria-label="成长时间线">
        {groups.map(([week, list], gi) => {

          return (
            <motion.div key={week} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: gi * 0.06 }} style={{ marginBottom: 26 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 10 }}>
                <span style={{ fontFamily: 'var(--font-num)', fontSize: 15, color: 'var(--cyan)', letterSpacing: '0.2em' }}>{week}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-dim)' }}>{list.length} 段成长足迹</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 14, borderLeft: '1px solid var(--theme-line)' }}>
                {list.map((e) => (
                  <div className="growth-history-row" key={e.id} style={{ display: 'flex', gap: 12, fontSize: 14, color: 'white', alignItems: 'baseline' }}>
                    <span style={{ fontFamily: 'var(--font-num)', fontSize: 12, color: 'var(--theme-light)', opacity: 0.7, width: 74 }}>
                      {new Date(e.ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span style={{ color: 'white', width: 116, letterSpacing: '0.1em', display:'inline-flex', gap:8 }}>
                      {DIMENSION_NAMES[e.dimension]} <span style={{color:DIMENSION_COLORS[e.dimension]}}><GrowthNotes points={e.points}/></span>
                    </span>
                    <span style={{ flex: 1 }}>{e.reason.startsWith('文中提到') ? '日记反思' : e.reason}</span>
                    <span style={{ fontSize: 12, opacity: 0.6 }}>{GROWTH_SOURCE_NAMES[e.source]??e.source}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )
        })}
        {events.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-dim)' }}>还没有成长记录。每一次专注与反思，都会在这里留下光点。</div>}
      </div>
      </div>
    </div>
  )
}
