export interface CharacterPosition {x:number;y:number}
export interface CharacterViewport {width:number;height:number;top?:number;bottom?:number}
export interface CharacterRect {left:number;top:number;width:number;height:number;baseHeight:number;area:{left:number;top:number;width:number;height:number}}
export const CHARACTER_SCALE_MIN=.65
export const CHARACTER_SCALE_MAX=2
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n))
export function parseCharacterPosition(value:unknown):CharacterPosition|null {
 if(value===null)return null
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||!Object.hasOwn(value,'x')||!Object.hasOwn(value,'y'))throw Error('立绘位置无效')
 const p=value as CharacterPosition
 if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1)throw Error('立绘位置须在屏幕范围内')
 return {x:p.x,y:p.y}
}
export function normalizeCharacterPosition(value:unknown):CharacterPosition|null {try{return parseCharacterPosition(value)}catch{return null}}
export function parseCharacterScale(value:unknown):number {if(typeof value!=='number'||!Number.isFinite(value)||value<CHARACTER_SCALE_MIN||value>CHARACTER_SCALE_MAX)throw Error('立绘大小须为 65%–200%');return value}
export function normalizeCharacterScale(value:unknown):number {return typeof value==='number'&&Number.isFinite(value)?clamp(value,CHARACTER_SCALE_MIN,CHARACTER_SCALE_MAX):1}
/** Normalized travel, rather than pixels, preserves placement across sizes. */
export function fitCharacterPlacement(viewport:CharacterViewport,aspect:number,position:unknown,scale:unknown):CharacterRect {
 const width=Math.max(1,viewport.width),height=Math.max(1,viewport.height),margin=Math.min(12,width/8,height/8)
 const top=clamp(viewport.top??44,margin,Math.max(margin,height-margin-1)),bottom=clamp(viewport.bottom??90,margin,Math.max(margin,height-top-margin-1))
 const area={left:margin,top,width:Math.max(1,width-margin*2),height:Math.max(1,height-top-bottom)}
 const ratio=Number.isFinite(aspect)&&aspect>0?aspect:.7,baseHeight=Math.max(1,height*.69)
 const portraitHeight=Math.min(baseHeight*normalizeCharacterScale(scale),area.height,area.width/ratio),portraitWidth=portraitHeight*ratio
 const p=normalizeCharacterPosition(position)??{x:1,y:1}
 return {left:area.left+(area.width-portraitWidth)*p.x,top:area.top+(area.height-portraitHeight)*p.y,width:portraitWidth,height:portraitHeight,baseHeight,area}
}
export function characterPositionAt(rect:CharacterRect,left:number,top:number):CharacterPosition {
 return {x:rect.area.width-rect.width<.001?0:clamp((left-rect.area.left)/(rect.area.width-rect.width),0,1),y:rect.area.height-rect.height<.001?0:clamp((top-rect.area.top)/(rect.area.height-rect.height),0,1)}
}
