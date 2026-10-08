import { useState } from 'react'
import { useApp } from '../store/app'
import { DIMENSION_COLORS,DIMENSION_NAMES,idiomOf,levelOf,type DimensionId } from '../../../shared/types'
import PersonaRadar from '../components/PersonaRadar'
import GrowthNotes from '../components/GrowthNotes'
export default function Stats(){
 const stats=useApp(s=>s.stats),events=useApp(s=>s.growthEvents)
 const [selected,setSelected]=useState<DimensionId>('knowledge')
 const recent=events.filter(e=>e.dimension===selected).slice(0,5)
 const active=[...new Set(events.filter(e=>e.ts>=Date.now()-7*86400000).map(e=>e.dimension))]
 return <div className="personal-status-page">
   <div className="page-title"><span className="en">SOCIAL STATUS</span><span className="zh">五维成长</span></div>
   <div className="personal-status-layout"><div className="personal-status-chart"><PersonaRadar values={stats} selected={selected} onSelect={setSelected}/><p>选择一个维度，回看自己的成长。</p></div>
   <aside className="personal-status-details glass"><small>YOUR INNER SELF</small><h2 style={{color:DIMENSION_COLORS[selected]}}>{idiomOf(selected,levelOf(stats[selected]))}</h2><p>{DIMENSION_NAMES[selected]} · 等级 {levelOf(stats[selected])}</p><div className="rank-seals" aria-label={`等级 ${levelOf(stats[selected])}`}>{Array.from({length:5},(_,i)=><i key={i} className={i<levelOf(stats[selected])?'lit':''}/>)}</div>
   <p className="status-encouragement">{levelOf(stats[selected])===5?'这一份积累，已经成为你的力量。':active.includes(selected)?'最近，你在这一面留下了新的回响。':'下一份收获，会从一件小事开始。'}</p>
   <h3>最近的回响</h3><div className="status-memories">{recent.map(e=><div key={e.id}><GrowthNotes points={e.points}/><p>{e.reason.startsWith('文中提到')?'日记反思':e.reason}</p><time>{new Date(e.ts).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'})}</time></div>)}{!recent.length&&<p>这一面，还等待你写下故事。</p>}</div></aside></div>
 </div>
}
