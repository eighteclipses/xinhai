import {useEffect,useState,type CSSProperties} from 'react'

// Mean synodic month from a known new moon. Decorative phase, not an ephemeris.
export function moonPhase(date:Date){
 const days=(date.getTime()-Date.UTC(2000,0,6,18,14))/86400000
 return ((days/29.530588853)%1+1)%1
}
export default function P3RClock({scale=1}:{scale?:number}){
 const [now,setNow]=useState(()=>new Date())
 useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(timer)},[])
 const date=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][now.getMonth()]+' '+String(now.getDate()).padStart(2,'0')
 const time=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')
 const phase=moonPhase(now),degree=360-phase*360,h=now.getHours()
 const period=h<5?'深夜':h<9?'清晨':h<12?'上午':h<14?'中午':h<18?'下午':h<20?'傍晚':'夜晚'
 const name=['NEW','CRESCENT','QUARTER','GIBBOUS','FULL','GIBBOUS','QUARTER','CRESCENT'][Math.round(phase*8)%8]
 return <div className="p3r-clock-frame" style={{width:500*scale,height:140*scale}}><div className="p3r-clock" style={{'--clock-scale':scale} as CSSProperties} role="img" aria-label={`${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 星期${'日一二三四五六'[now.getDay()]} ${time} ${period}，近似月相 ${name}`}>
  <span className="p3r-date">{date}</span>
  <div className="p3r-wave-cloud" aria-hidden="true">{[1,2,3,4].map(n=><div key={n} style={{backgroundImage:'radial-gradient(ellipse, #9ce9ff55, transparent 70%)',animationDelay:`-${n*2}s`}}/>)}</div>
  {[8,7,6,5].map(n=><span key={n} className="p3r-date p3r-date-wave" aria-hidden="true">{date}</span>)}
  <span className="p3r-weekday">{'日一二三四五六'[now.getDay()]}</span><span className="p3r-time">{time}</span>
  <span className="p3r-phase-name">{name}</span><span className="p3r-period">{period}</span>
  <div className="p3r-moon" aria-hidden="true"><div className={'p3r-hemisphere '+(degree<180?'light':'dark')}/><div className={'p3r-hemisphere '+(degree<180?'dark':'light')}/><div className="p3r-divider" style={{transform:`rotateY(${degree}deg)`}}/></div>
 </div></div>
}
