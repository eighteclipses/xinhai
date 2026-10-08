import { useEffect, useState } from 'react'

export default function MinimalClock({scale=1}:{scale?:number}){
  const [now,setNow]=useState(()=>new Date())
  useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(timer)},[])
  const time=now.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})
  const date=now.toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})
  return <div style={{width:320*scale,height:132*scale}}><div className="minimal-clock" style={{transform:`scale(${scale})`}} aria-label={date+' '+time}><span>MAKE ROOM FOR TODAY</span><strong>{time}</strong><small>{date}</small></div></div>
}
