import GrowthNotes from '../components/GrowthNotes'
import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useApp } from '../store/app'
import { DIMENSION_COLORS, DIMENSION_NAMES, formatDuration } from '../../../shared/types'

// 成长轨迹：体现自我成长的时间线，按周汇总
export default function History() {
  const events = useApp((s) => s.growthEvents)
  const sessions = useApp((s) => s.focusSessions)

  const totalFocus = sessions.reduce((s, x) => s + (x.seconds ?? x.minutes * 60), 0)


  const groups = useMemo(() => {
    const map = new Map<string, typeof events>()
    for (const e of events) {
      const d = new Date(e.ts)
      const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay() + 1)
      const key = `${day.getFullYear()}.${String(day.getMonth() + 1).padStart(2, '0')}.${String(day.getDate()).padStart(2, '0')} 周`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    return [...map.entries()]
  }, [events])

  return (
    <div style={{ position: 'relative', zIndex: 2, height: '100%', padding: '64px 56px 90px', display: 'flex', flexDirection: 'column' }}>
      <div className="page-title" style={{ marginBottom: 18 }}>
        <span className="en">RECORD</span>
        <span className="zh">成长轨迹</span>
      </div>

      <div style={{ display: 'flex', gap: 40, marginBottom: 24 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-num)', fontSize: 40, color: '#fff' }}>{Math.floor(totalFocus / 3600)}<span style={{ fontSize: 14, color: 'var(--ink-dim)' }}> 小时</span></div>
          <div style={{ fontSize: 12, letterSpacing: '0.25em', color: 'var(--ink-dim)' }}>最近 100 段专注</div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-num)', fontSize: 40, color: 'white' }}>{Math.floor(totalFocus / 60) % 60}<span style={{ fontSize: 14, color: 'var(--ink-dim)' }}> 分</span></div>
          <div style={{ fontSize: 12, letterSpacing: '0.25em', color: 'var(--ink-dim)' }}>&nbsp;</div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-num)', fontSize: 40, color: '#fff' }}>{events.length}</div>
          <div style={{ fontSize: 12, letterSpacing: '0.25em', color: 'var(--ink-dim)' }}>已载入的成长记录</div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-num)', fontSize: 40, color: '#fff' }}>{sessions.length}</div>
          <div style={{ fontSize: 12, letterSpacing: '0.25em', color: 'var(--ink-dim)' }}>专注次数</div>
        </div>
      </div>

      <section className="glass focus-history"><h2>最近专注</h2><p>有效时间不含暂停；旧记录仅保留分钟精度。</p>
        {sessions.slice(0,20).map(session=><div className="focus-history-row" key={session.id}><time>{new Date(session.endedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</time><span>{session.taskLabel || '自由专注'}<small>{session.mode}{session.seconds === undefined ? ' · 旧记录' : ''}</small></span><strong>{formatDuration(session.seconds ?? session.minutes*60)}</strong><span className="history-notes"><small>学识</small><GrowthNotes points={session.minutes}/></span></div>)}
        {!sessions.length && <p>完成第一段专注后，时间会保留在这里。</p>}
      </section>
      <div className="hairline" />

      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 18, paddingRight: 10 }}>
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
                    <span style={{ fontSize: 12, opacity: 0.6 }}>{e.source === 'focus' ? '专注' : e.source === 'journal' ? '日记' : '即时拍'}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )
        })}
        {events.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-dim)' }}>还没有成长记录。每一次专注与反思，都会在这里留下光点。</div>}
      </div>
    </div>
  )
}
