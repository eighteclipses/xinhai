import type {CloudLibrary,CloudTrack,CloudPlaylist} from '../../../shared/netease'
import { ONLINE_MUSIC_ENABLED } from '../../../shared/edition'
const KEY='xinhai-netease-library-v1'
export function readCloudLibrary():CloudLibrary|null {try{const data=JSON.parse(localStorage.getItem(KEY)||'null');return data&&data.account&&Array.isArray(data.playlists)&&data.playlists.every((p:any)=>Array.isArray(p.tracks))?data:null}catch{return null}}
export function cloudLibraryTracks():CloudTrack[]{if(!ONLINE_MUSIC_ENABLED)return [];const unique=new Map<string,CloudTrack>();for(const p of [...readShares(),...readCloudLibrary()?.playlists??[]])for(const t of p.tracks)if(/^netease:[1-9]\d{0,18}$/.test(t.file)&&typeof t.title==='string')unique.set(t.file,t);return [...unique.values()]}
export function writeCloudLibrary(library:CloudLibrary|null){if(library)localStorage.setItem(KEY,JSON.stringify(library));else localStorage.removeItem(KEY)}
export type SharedPlaylist=CloudPlaylist & {tracks:CloudTrack[];updatedAt:number}
const SHARES='xinhai-netease-shares-v1'
export function readShares():SharedPlaylist[]{try{const data=JSON.parse(localStorage.getItem(SHARES)||'[]');return Array.isArray(data)?data.filter(p=>p&&Array.isArray(p.tracks)&&typeof p.id==='string'&&typeof p.name==='string'):[]}catch{return []}}
export function writeShares(playlists:SharedPlaylist[]){localStorage.setItem(SHARES,JSON.stringify(playlists))}
export function clearLegacyCloudCache(){
  localStorage.removeItem(KEY);localStorage.removeItem(SHARES)
  try{const resume=JSON.parse(localStorage.getItem('xinhai-music-resume')||'null');if(resume?.file?.startsWith('netease:'))localStorage.removeItem('xinhai-music-resume')}catch{}
  try{const prefs=JSON.parse(localStorage.getItem('xinhai-music-prefs')||'null');if(typeof prefs?.file==='string'&&prefs.file.startsWith('netease:')){delete prefs.file;localStorage.setItem('xinhai-music-prefs',JSON.stringify(prefs))}}catch{}
}
