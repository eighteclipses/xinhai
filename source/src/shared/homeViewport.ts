export const HOME_REFERENCE_WIDTH=1440
export const HOME_REFERENCE_HEIGHT=766 // 900px window minus the desktop title, player and navigation bars.
export function homeViewport(width:number,height:number){
 const w=Number.isFinite(width)?Math.max(1,width):HOME_REFERENCE_WIDTH
 const h=Number.isFinite(height)?Math.max(1,height):HOME_REFERENCE_HEIGHT
 const scale=Math.max(1,Math.min(w/HOME_REFERENCE_WIDTH,h/HOME_REFERENCE_HEIGHT))
 return {width:w,height:h,scale,logicalWidth:w/scale,logicalHeight:h/scale}
}
export type HomeViewport=ReturnType<typeof homeViewport>
