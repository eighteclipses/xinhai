import { localDateKey } from './date'
import type { ReviewRating } from './types'
// Small, deterministic spacing rule. Calendar days remain local across DST changes.
export function reviewInterval(previous:number,rating:ReviewRating):number {
  if(rating==='again')return 1
  if(rating==='familiar')return Math.min(90,Math.max(3,Math.ceil(previous*1.5)))
  return Math.min(90,Math.max(7,previous*2))
}
export function nextReviewDate(days:number,now=new Date()):string {
  const next=new Date(now);next.setHours(12,0,0,0);next.setDate(next.getDate()+days)
  return localDateKey(next)
}
