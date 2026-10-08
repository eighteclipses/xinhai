export interface MusicResume {file:string;seconds:number;playing:boolean}
const key='xinhai-music-resume'
export function readMusicResume():MusicResume|null {
  try {const v=JSON.parse(localStorage.getItem(key)||'null');return v&&typeof v.file==='string'&&Number.isFinite(v.seconds)&&v.seconds>=0&&typeof v.playing==='boolean'?v:null}catch{return null}
}
export function saveMusicResume(value:MusicResume):void {
  try{localStorage.setItem(key,JSON.stringify(value))}catch{/* Playback remains usable if storage is unavailable. */}
}
