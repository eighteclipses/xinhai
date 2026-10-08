import { normalizeThemeColor, DEFAULT_THEME_COLOR } from './theme'

type Rgb = [number, number, number]
export const TEXT_SURFACE_ALPHA = .84
const TARGET_CONTRAST = 4.7 // Small margin above 4.5 for rounded sRGB channels.
const rgb = (hex:string):Rgb => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)) as Rgb
const mix = (a:Rgb,b:Rgb,t:number):Rgb => a.map((v,i)=>Math.round(v+(b[i]-v)*t)) as Rgb
const hex = (c:Rgb) => '#'+c.map(v=>v.toString(16).padStart(2,'0')).join('')
const white:Rgb = [255,255,255]

function luminance(color:Rgb):number {
  const linear=color.map(v=>{const s=v/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4})
  return linear[0]*.2126+linear[1]*.7152+linear[2]*.0722
}
export function colorContrast(foreground:string,background:string):number {
  const a=luminance(rgb(foreground)),b=luminance(rgb(background))
  return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)
}
function readable(base:Rgb,background:Rgb):string {
  const backdrop=hex(background)
  if(colorContrast(hex(base),backdrop)>=TARGET_CONTRAST)return hex(base)
  let low=0,high=1
  for(let i=0;i<16;i++){
    const middle=(low+high)/2
    if(colorContrast(hex(mix(base,white,middle)),backdrop)>=TARGET_CONTRAST)high=middle
    else low=middle
  }
  return hex(mix(base,white,high))
}

/** Display-only text roles. Never changes the user's saved accent or theme. */
export function themeTextPalette(value:string):{accent:string;muted:string;backdrop:string;controlFill:string;controlInk:string} {
  const accent=rgb(normalizeThemeColor(value)??DEFAULT_THEME_COLOR)
  const panel=mix([16,16,16],accent,.09)
  // A white wallpaper is the brightest possible backdrop through the protected
  // text surfaces. Decorative/glass surfaces remain independently adjustable.
  const backdrop=mix(white,panel,TEXT_SURFACE_ALPHA)
  return {
    accent:readable(mix(accent,white,.6),backdrop),
    muted:readable(mix(accent,[181,181,181],.78),backdrop),
    backdrop:hex(backdrop),
    controlFill:readable(mix(accent,white,.6),panel),
    controlInk:hex(panel)
  }
}
