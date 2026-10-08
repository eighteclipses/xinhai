import {useEffect,useRef} from 'react'

/** A broad leading colour arc reveals the scene; two translucent arcs follow it. */
export default function ThemeSweep({color,reveal,onDone}:{color:string;reveal:React.RefObject<HTMLDivElement>;onDone:()=>void}){
 const svg=useRef<SVGSVGElement>(null),leading=useRef<SVGCircleElement>(null),outer=useRef<SVGCircleElement>(null),inner=useRef<SVGCircleElement>(null)
 const done=useRef(onDone);done.current=onDone
 useEffect(()=>{
   const width=innerWidth,height=innerHeight,cx=-width*.12,cy=height*.53
   const far=Math.hypot(width-cx,Math.max(cy,height-cy)),band=Math.min(width,height)*.24,max=far+band*2
   const canvas=svg.current!;canvas.setAttribute('viewBox',`0 0 ${width} ${height}`)
   for(const circle of [leading.current,outer.current,inner.current]){circle!.setAttribute('cx',String(cx));circle!.setAttribute('cy',String(cy))}
   leading.current!.setAttribute('stroke-width',String(band))
   outer.current!.setAttribute('stroke-width',String(Math.max(7,band*.10)))
   inner.current!.setAttribute('stroke-width',String(Math.max(14,band*.23)))
   let frame=0,finished=false;const start=performance.now()
   const finish=()=>{if(finished)return;finished=true;cancelAnimationFrame(frame);if(reveal.current)reveal.current.style.clipPath='none';done.current()}
   // Smooth accelerating entry, then a long, gentle departure; no full-white flash.
   const ease=(t:number)=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t)}
   const tick=(now:number)=>{
     const elapsed=now-start,r=ease(elapsed/920)*max
     leading.current?.setAttribute('r',String(Math.max(0,r)))
     outer.current?.setAttribute('r',String(Math.max(0,ease((elapsed-105)/1010)*max-band*.38)))
     inner.current?.setAttribute('r',String(Math.max(0,ease((elapsed-170)/1040)*max-band*.73)))
     if(reveal.current)reveal.current.style.clipPath=`circle(${Math.max(0,r-band*.45)}px at ${cx}px ${cy}px)`
     canvas.dataset.elapsed=String(Math.round(elapsed))
     if(elapsed>=1240)finish();else frame=requestAnimationFrame(tick)
   }
   tick(start)
   const fallback=setTimeout(finish,1450)
   const visibility=()=>{if(document.hidden)finish()}
   addEventListener('resize',finish);document.addEventListener('visibilitychange',visibility)
   return()=>{finished=true;cancelAnimationFrame(frame);clearTimeout(fallback);removeEventListener('resize',finish);document.removeEventListener('visibilitychange',visibility)}
 },[reveal])
 return <svg ref={svg} className="theme-sweep" aria-hidden="true" data-color={color} preserveAspectRatio="none"><circle ref={leading} r="0" fill="none" stroke={color}/><circle ref={outer} r="0" fill="none" stroke="white" opacity=".48"/><circle ref={inner} r="0" fill="none" stroke="white" opacity=".24"/></svg>
}
