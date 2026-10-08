import { useEffect,useState,type CSSProperties } from 'react'
import { AnimatePresence,motion } from 'framer-motion'
import { useApp } from '../store/app'
import { useReducedEffects } from '../lib/motion'
import { isMarchFifth,marchMemoryKey } from '../../../shared/anniversary'
export default function MarchMemory(){
 const [now,setNow]=useState(()=>new Date()),[dismissed,setDismissed]=useState('')
 const {page,focusFinish,popups,focusClock}=useApp(),reduce=useReducedEffects()
 useEffect(()=>{const sync=()=>setNow(new Date()),timer=setInterval(sync,30000);window.addEventListener('focus',sync);document.addEventListener('visibilitychange',sync);return()=>{clearInterval(timer);window.removeEventListener('focus',sync);document.removeEventListener('visibilitychange',sync)}},[])
 const key=marchMemoryKey(now)
 let seen=false;try{seen=localStorage.getItem(key)==='seen'}catch{}
 const visible=isMarchFifth(now)&&page==='home'&&!focusFinish&&!focusClock&&!popups.length&&!seen&&dismissed!==key
 function close(){setDismissed(key);try{localStorage.setItem(key,'seen')}catch{}}
 return <AnimatePresence>{visible&&<motion.aside className={'march-memory'+(reduce?' still':'')} aria-label="三月五日的约定" initial={reduce?false:{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} transition={{duration:.8}}>
  {!reduce&&<div className="march-petals" aria-hidden="true">{Array.from({length:9},(_,i)=><i key={i} style={{'--petal-x':(5+i*11)+'%','--petal-delay':(-i*.9)+'s','--petal-time':(7+i%3)+'s'} as CSSProperties}/>)}</div>}
  <small>03 / 05</small><p>樱花的花语是<br/><strong>勿忘我</strong></p><span>有些约定，会随着春天回来。</span><button onClick={close} aria-label="收好三月五日的约定">我会记得</button>
 </motion.aside>}</AnimatePresence>
}
