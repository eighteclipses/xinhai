import { noteCount,growthPhrase } from '../lib/growthPresentation'
export function NoteGlyph({className=''}:{className?:string}) {
  return <svg className={'note-glyph '+className} viewBox="0 0 40 52" fill="none" aria-hidden="true"><path d="M25 6v30.5c0 6-6.3 11-12.2 11C7.8 47.5 5 45 5 41.8c0-5 5.6-9.8 11.5-9.8 1.7 0 3.2.2 4.5.8V4l14 6.5v9L25 15" fill="currentColor" stroke="var(--theme-dark)" strokeWidth="1.7" strokeLinejoin="round"/></svg>
}
export default function GrowthNotes({points,className=''}:{points:number;className?:string}){
 const count=noteCount(points)
 return <span className={'growth-notes '+className} role="img" aria-label={growthPhrase(points)}>{count?Array.from({length:count},(_,i)=><NoteGlyph key={i}/>):<span aria-hidden="true">—</span>}</span>
}
