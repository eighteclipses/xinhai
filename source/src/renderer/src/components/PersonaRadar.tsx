import { useEffect,useState } from 'react'
import { motion } from 'framer-motion'
import { DIMENSIONS,DIMENSION_COLORS,DIMENSION_NAMES,idiomOf,levelOf,type DimensionId } from '../../../shared/types'
import { radarPoint,rankRadius,rankPolygon,type GrowthValues } from '../lib/growthPresentation'
import { useReducedEffects } from '../lib/motion'

// Five status medallions replace the reference's triangle. Geometry expresses ranks only.
export default function PersonaRadar({values,before=values,active=[],selected,onSelect,animateGrowth=false}:{values:GrowthValues;before?:GrowthValues;active?:DimensionId[];selected?:DimensionId;onSelect?:(dim:DimensionId)=>void;animateGrowth?:boolean}){
 const reduce=useReducedEffects()
 const [expansion,setExpansion]=useState(reduce||!animateGrowth?1:0)
 useEffect(()=>{
   if(reduce||!animateGrowth){setExpansion(1);return}
   setExpansion(0)
   const start=performance.now()+220
   let frame:number
   const tick=(now:number)=>{const t=Math.max(0,Math.min(1,(now-start)/850));setExpansion(1-Math.pow(1-t,3));if(t<1)frame=requestAnimationFrame(tick)}
   frame=requestAnimationFrame(tick)
   return()=>cancelAnimationFrame(frame)
 },[reduce,animateGrowth])
 const visiblePolygon=DIMENSIONS.map((d,i)=>radarPoint(i,145*(rankRadius(before[d])+(rankRadius(values[d])-rankRadius(before[d]))*expansion)).join(',')).join(' ')
 const grid=(r:number)=>DIMENSIONS.map((_,i)=>radarPoint(i,r).join(',')).join(' ')
 return <svg className="persona-radar" viewBox="0 0 640 560" aria-label="五维能力图，显示等级和称号；发光方向代表本次成长">
   <defs><linearGradient id="persona-fill" x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--theme-pale)" stopOpacity=".8"/><stop offset="1" stopColor="var(--theme-color)" stopOpacity=".23"/></linearGradient></defs>
   {[.3,.44,.58,.72,.86].map(r=><polygon key={r} points={grid(145*r)} fill="none" stroke="var(--theme-line)" strokeWidth="1"/>)}
   {DIMENSIONS.map((d,i)=>{
     const edge=radarPoint(i,145),left=radarPoint(i-.36,145),right=radarPoint(i+.36,145),lit=active.includes(d)||selected===d
     return <g key={d}>
       {lit&&<path data-growth-sector={d} d={`M320 280 L${left.join(' ')} L${edge.join(' ')} L${right.join(' ')} Z`} fill={DIMENSION_COLORS[d]} opacity=".12"/>}
       <line x1="320" y1="280" x2={edge[0]} y2={edge[1]} stroke={lit?DIMENSION_COLORS[d]:'var(--theme-line)'} strokeWidth={lit?2:1}/>
       {animateGrowth&&lit&&!reduce&&<motion.circle r="5" fill="var(--theme-pale)" initial={{cx:320,cy:280,opacity:0}} animate={{cx:edge[0],cy:edge[1],opacity:[0,1,0]}} transition={{duration:.65,delay:i*.08}}/>}
     </g>
   })}
   {animateGrowth&&<polygon points={rankPolygon(before)} fill="none" stroke="var(--theme-line)" strokeDasharray="5 5"/>}
   <polygon points={visiblePolygon} fill="url(#persona-fill)" stroke="var(--theme-light)" strokeWidth="3" className={animateGrowth&&!reduce?'rank-shape-arrive':''}/>
   <circle cx="320" cy="280" r="4" fill="var(--theme-pale)"/>
   {DIMENSIONS.map((d,i)=>{
     const [x,y]=radarPoint(i,191),up=levelOf(values[d])>levelOf(before[d]),lit=active.includes(d),focus=selected===d
     return <g key={d} className={'persona-node'+(lit?' is-gaining':'')+(up&&animateGrowth?' is-ranking':'')+(focus?' is-selected':'')} transform={`translate(${x} ${y})`} data-status-node={d}
       role={onSelect?'button':undefined} tabIndex={onSelect?0:undefined} aria-label={`${DIMENSION_NAMES[d]}，等级 ${levelOf(values[d])}，${idiomOf(d,levelOf(values[d]))}${lit?'，正在成长':''}`}
       onClick={()=>onSelect?.(d)} onKeyDown={e=>{if(onSelect&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onSelect(d)}}}>
       {lit&&<circle className={reduce?'node-ring-static':'node-ring'} r="55" fill="none" stroke={DIMENSION_COLORS[d]} strokeWidth="2"/>}
       {up&&animateGrowth&&<circle className={reduce?'node-rank-static':'node-rank-ring'} r="63" fill="none" stroke="var(--theme-pale)" strokeWidth="3"/>}
       <circle r="43" fill={lit||focus?DIMENSION_COLORS[d]:'var(--theme-dark)'} stroke={focus?'#fff':'var(--theme-line)'} strokeWidth="2"/>
       <text x="-7" y="14" textAnchor="middle" fill="#fff" fontSize="45" fontWeight="700" fontFamily="var(--font-num)">{levelOf(values[d])}</text>
       <text x="19" y="-10" fill="#fff" fontSize="18" fontWeight="700" transform="rotate(-9)">{DIMENSION_NAMES[d]}</text>
       <path d="M-64 34 H70 L60 57 H-74Z" fill="var(--theme-panel)"/>
       <text x="-1" y="50" textAnchor="middle" fill="var(--theme-pale)" fontSize="13" letterSpacing="1">{idiomOf(d,levelOf(values[d]))}</text>
       {up&&animateGrowth&&<text x="0" y="-63" textAnchor="middle" fill="var(--theme-pale)" fontSize="13" fontWeight="800">RANK UP!</text>}
     </g>
   })}
 </svg>
}
