/** Time-based 2D motion adapted from RhineLabUI's wave / damped-selection ideas.
 * LBEILC/RhineLabUI @ 3274778cbb8bb05ca2472d706c5879fa002ecd93.
 * Attribution and MIT text: resources/licenses/RhineLabUI-MIT.txt.
 */
export type MotionContext={width:number;height:number;reducedMotion:boolean;compact:boolean}
export type WaveCell={row:number;column:number}
export type WaveEvent={at:number;origin:WaveCell;strength:number}
export type CardPose={y:number;rotate:number;scale:number}
export type SpringState={value:number;velocity:number}
export const CARD_WAVE_SECONDS=.96
const clamp=(value:number,low=0,high=1)=>Math.min(high,Math.max(low,value))
const smooth=(value:number)=>{const t=clamp(value);return t*t*(3-2*t)}

// Closed-form damping supports seeking and retargeting from current velocity.
export function sampleSpring(from:SpringState,target:number,elapsed:number,rate=15):SpringState{
 const t=Math.max(0,elapsed),delta=from.value-target,impulse=from.velocity+rate*delta,decay=Math.exp(-rate*t)
 return {value:target+(delta+impulse*t)*decay,velocity:(from.velocity-rate*impulse*t)*decay}
}
export function sampleCardPose(time:number,cell:WaveCell,events:readonly WaveEvent[],context:MotionContext):CardPose{
 if(context.reducedMotion)return {y:0,rotate:0,scale:1}
 let height=0,tilt=0
 for(const event of events.slice(-3)){
  const dx=cell.column-event.origin.column,dy=cell.row-event.origin.row
  const delay=Math.abs(dx)*.065+Math.abs(dy)*.09,age=time-event.at-delay
  if(age<=0||age>=CARD_WAVE_SECONDS)continue
  const envelope=smooth(age/.12)*(1-smooth((age-.66)/.3))*Math.exp(-age*3.4)
  const pulse=Math.sin(age*10.5)*envelope*clamp(event.strength,0,1)
  height+=pulse;tilt+=pulse*Math.sign(dx||dy)*.9
 }
  const factor=context.compact?.75:1
  const y=-6*Math.tanh(height)*factor
  return {y:Math.abs(y)<1e-9?0:y,rotate:clamp(tilt,-1.2,1.2)*factor,scale:1}
}
 type Point={x:number;y:number}
 const point=(p:Point)=>`${p.x.toFixed(2)} ${p.y.toFixed(2)}`
 const path=(points:Point[])=>points.map((p,i)=>(i?'L':'M')+point(p)).join(' ')
 // The reference transition is an eccentric circular wipe: a thick coloured
 // arc leads, two lighter arcs trail it, and the new scene uses the same circle
 // as its reveal mask. Sampling the geometry keeps the animation seek-safe.
 const polar=(cx:number,cy:number,r:number,angle:number):Point=>({x:cx+Math.cos(angle)*r,y:cy+Math.sin(angle)*r})
 const arc=(cx:number,cy:number,r:number,start:number,sweep:number)=>{
  const steps=Math.max(8,Math.ceil(Math.abs(sweep)/(Math.PI/12))),points:Point[]=[]
  for(let i=0;i<=steps;i++)points.push(polar(cx,cy,r,start+sweep*i/steps))
  return path(points)
 }
 const arcBand=(cx:number,cy:number,outer:number,inner:number,start:number,sweep:number)=>{
  const steps=Math.max(8,Math.ceil(Math.abs(sweep)/(Math.PI/12))),outerPoints:Point[]=[],innerPoints:Point[]=[]
  for(let i=0;i<=steps;i++){
   const a=start+sweep*i/steps
   outerPoints.push(polar(cx,cy,outer,a));innerPoints.push(polar(cx,cy,inner,a))
  }
  return path(outerPoints)+' '+path([...innerPoints].reverse()).replace(/^M/,'L')+' Z'
 }
 export function sampleSceneReveal(elapsed:number,context:MotionContext){
  const width=Math.max(1,context.width),height=Math.max(1,context.height)
  const duration=context.compact?.28:.34,progress=clamp(elapsed/duration)
  if(context.reducedMotion||progress>=1)return {clipPath:'none',bandPath:'',crestPath:'',trailPath:'',ringPaths:[],centerX:0,centerY:0,discRadius:0,discHoleRadius:0,discOpacity:0,cardX:0,cardY:0,cardSize:0,cardScale:1,cardOpacity:0,flashOpacity:0,opacity:0,progress:1,done:true}
  const cx=width*(context.compact?.16:.18),cy=height*.5
  const maxRadius=Math.hypot(width-cx,height-cy)+Math.min(width,height)*.14
  const radius=Math.max(1,maxRadius*smooth(progress/.72))
  const band=Math.min(width,height)*(context.compact?.10:.13)
  const start=-Math.PI*.86+smooth(progress/.62)*Math.PI*.24
  const sweep=Math.PI*(1.56+smooth(progress/.52)*.62)
  const outer=radius+band*.5,inner=Math.max(0,radius-band*.5)
  // The PV keeps the card/record motif on the outgoing field first. The new
  // full-bleed scene arrives only in the last beat instead of becoming a huge
  // coloured circle behind the record.
  const clipRadius=Math.min(maxRadius+band,maxRadius*smooth((progress-.72)/.28))
  const arcOpacity=smooth(progress/.06)*(1-smooth((progress-.68)/.32))
  const discRadius=Math.min(width,height)*.22*smooth(progress/.28)
  const discOpacity=smooth(progress/.06)*(1-smooth((progress-.9)/.1))
  const cardSize=Math.min(width,height)*.18
  const cardScale=.82+.18*smooth((progress-.12)/.55)
  const cardX=cx+Math.min(width,height)*.035-cardSize*.08,cardY=cy-cardSize*.5
  const cardOpacity=smooth((progress-.08)/.08)*(1-smooth((progress-.9)/.1))
  const ringPaths=Array.from({length:10},(_,i)=>{
   const ringRadius=Math.max(1,discRadius*(.52+i*.055))
   return arc(cx,cy,ringRadius,-Math.PI*.15+i*.018,Math.PI*2)
  })
  return {
   clipPath:`circle(${clipRadius.toFixed(2)}px at ${cx.toFixed(2)}px ${cy.toFixed(2)}px)`,
   bandPath:arc(cx,cy,Math.max(1,discRadius*1.2),start,sweep),
   crestPath:arc(cx,cy,Math.max(1,discRadius*1.34),start+.05,sweep*.92),
   trailPath:arc(cx,cy,Math.max(1,discRadius*1.05),start-.08,sweep*.82),
   ringPaths,
   centerX:cx,centerY:cy,discRadius,discHoleRadius:discRadius*.19,discOpacity,
   cardX,cardY,cardSize,cardScale,cardOpacity,flashOpacity:smooth((progress-.82)/.18),
   opacity:Math.max(arcOpacity,discOpacity,cardOpacity),progress,done:false}
 }
