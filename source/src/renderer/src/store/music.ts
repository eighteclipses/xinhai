import {cloudLibraryTracks} from '../lib/cloudLibrary'
import { create } from 'zustand'
export interface Track {file:string;title:string;tag:'calm'|'battle'|'ambient'|'local'|'netease';id?:string}
export type PlayMode='seq'|'loop'|'random'
interface MusicStore {
 tracks:Track[];index:number;playing:boolean;mode:PlayMode;musicVolume:number;loadError:string
 load:(force?:boolean)=>Promise<void>;play:(i?:number)=>void;pause:()=>void;toggle:()=>void;next:()=>void;prev:()=>void;setMode:(m:PlayMode)=>void;setMusicVolume:(v:number)=>void
}
let loading:Promise<void>|null=null
let prefs:{mode?:PlayMode;volume?:number;file?:string}={}
try{prefs=JSON.parse(localStorage.getItem('xinhai-music-prefs')||'{}')}catch{}
export const useMusic=create<MusicStore>((set,get)=>({
 tracks:[],index:0,playing:false,mode:['seq','loop','random'].includes(prefs.mode||'')?prefs.mode!:'seq',musicVolume:typeof prefs.volume==='number'?Math.max(0,Math.min(1,prefs.volume)):.6,loadError:'',
 load:(force=false)=>{
  if(loading)return loading
  if(get().tracks.length&&!force)return Promise.resolve()
  loading=(async()=>{
   const [builtin,imported]=await Promise.allSettled([
    fetch('music/manifest.json').then(async r=>{if(!r.ok)throw Error('manifest');const data=await r.json();if(!Array.isArray(data))throw Error('manifest');return data.filter((t):t is Track=>t&&typeof t.file==='string'&&typeof t.title==='string'&&['calm','battle','ambient'].includes(t.tag))}),
    window.api.musicList?window.api.musicList():Promise.resolve([])
   ])
   const tracks=[...(builtin.status==='fulfilled'?builtin.value:[]),...(imported.status==='fulfilled'?imported.value:[]),...cloudLibraryTracks()]
   const previous=get().tracks[get().index]?.file??prefs.file
   const index=tracks.findIndex(t=>t.file===previous),first=tracks.findIndex(t=>t.tag==='calm')
   set({tracks,index:index>=0?index:Math.max(0,first),playing:!!tracks.length&&get().playing,loadError:builtin.status==='rejected'||imported.status==='rejected'?'部分歌单未能读取，可以重试或导入本地音乐。':''})
  })().finally(()=>{loading=null});return loading
 },
 play:i=>{if(get().tracks[i??get().index])set({index:i??get().index,playing:true})},pause:()=>set({playing:false}),toggle:()=>{if(get().tracks.length)set(s=>({playing:!s.playing}))},
 next:()=>{const s=get(),count=s.tracks.length;if(!count)return;const step=s.mode==='random'&&count>1?1+Math.floor(Math.random()*(count-1)):1;set({index:(s.index+step)%count,playing:true})},
 prev:()=>{const s=get();if(s.tracks.length)set({index:(s.index-1+s.tracks.length)%s.tracks.length,playing:true})},
 setMode:mode=>set({mode}),setMusicVolume:musicVolume=>set({musicVolume})
}))
useMusic.subscribe(s=>{try{localStorage.setItem('xinhai-music-prefs',JSON.stringify({mode:s.mode,volume:s.musicVolume,file:s.tracks[s.index]?.file}))}catch{}})
