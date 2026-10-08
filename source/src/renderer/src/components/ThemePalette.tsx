/** Recolour only blue UI artwork. Equal RGB inputs (white/grey) stay unchanged. */
export default function ThemePalette({color}:{color:string}){
 const [r,g,b]=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255)
 const matrix=[1-r,0,r,0,0,1-g,0,g,0,0,1-b,0,b,0,0,0,0,0,1,0].join(' ')
 return <svg width="0" height="0" className="theme-palette-defs" aria-hidden="true"><defs><filter id="character-accent" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={matrix}/></filter></defs></svg>
}
