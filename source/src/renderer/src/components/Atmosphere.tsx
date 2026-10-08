import { useEffect, useState, type CSSProperties } from 'react'
import { useApp } from '../store/app'
import { useReducedEffects } from '../lib/motion'

export default function Atmosphere(){
  const effect=useApp(s=>s.settings.ambientEffect),reduce=useReducedEffects()
  const [hidden,setHidden]=useState(document.hidden)
  useEffect(()=>{const update=()=>setHidden(document.hidden);document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update)},[])
  if(reduce||effect==='none')return null
  return <div className={'studio-atmosphere effect-'+effect+(hidden?' is-paused':'')} aria-hidden="true">{Array.from({length:18},(_,i)=><i key={i} style={{left:((i*37+7)%100)+'%',top:((i*23+9)%100)+'%','--particle-size':(i%3+2)+'px','--particle-duration':(12+i%7*3)+'s','--particle-delay':(-i*2.7)+'s'} as CSSProperties}/>)}</div>
}
