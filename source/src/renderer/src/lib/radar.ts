import { useEffect, useRef, useState } from 'react'
import { DIMENSIONS, type DimensionId } from '../../../shared/types'
import { useReducedEffects } from './motion'
type Values = Record<DimensionId, number>
// Numeric interpolation avoids transient undefined SVG point attributes.
export function useRadarValues(target:Values, initial?:Values):Values {
  const reduce = useReducedEffects()
  const [display,setDisplay] = useState<Values>(initial ?? target)
  const current = useRef(display)
  const key = DIMENSIONS.map(d=>target[d]).join(',')
  useEffect(() => {
    if (reduce) {current.current=target;setDisplay(target);return}
    const from={...current.current}, started=performance.now()
    let frame:number
    const tick=(now:number)=>{
      const t=Math.min(1,(now-started)/1100), eased=1-Math.pow(1-t,3)
      const value=Object.fromEntries(DIMENSIONS.map(d=>[d,from[d]+(target[d]-from[d])*eased])) as Values
      current.current=value;setDisplay(value)
      if(t<1)frame=requestAnimationFrame(tick)
    }
    frame=requestAnimationFrame(tick)
    return()=>cancelAnimationFrame(frame)
  },[key,reduce])
  return reduce ? target : display
}
