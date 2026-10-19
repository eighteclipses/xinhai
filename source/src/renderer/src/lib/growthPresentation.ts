import { DIMENSIONS, levelOf, type DimensionId } from '../../../shared/types'
export type GrowthValues = Record<DimensionId,number>
// Presentation tiers deliberately collapse many point values into the same symbol.
// This is not a replacement for scoring, database values or level thresholds.
export function noteCount(points:number):number {
  if(!Number.isFinite(points)||points<=0)return 0
  return points===1?1:points<=3?2:3
}
export function exactNoteCount(points:number):number {return Number.isFinite(points)?Math.max(0,Math.floor(points)):0}
export function growthPhrase(points:number):string {
  return ['尚未体现','略有收获','有所收获','收获充实'][noteCount(points)]
}
export function rankRadius(points:number):number {return .16+levelOf(points)*.14}
export const radarPoint=(index:number,radius:number):[number,number]=>[
  320+Math.cos(-Math.PI/2+index*Math.PI*2/5)*radius,
  280+Math.sin(-Math.PI/2+index*Math.PI*2/5)*radius
]
export const rankPolygon=(values:GrowthValues):string=>DIMENSIONS.map((d,i)=>radarPoint(i,145*rankRadius(values[d])).join(',')).join(' ')
export function changedDimensions(before:GrowthValues,after:GrowthValues):DimensionId[]{return DIMENSIONS.filter(d=>after[d]>before[d])}
