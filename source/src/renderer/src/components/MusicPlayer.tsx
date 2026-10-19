import {readMusicResume} from '../lib/musicResume'
import NetEaseLibrary from './NetEaseLibrary'
import { ONLINE_MUSIC_ENABLED, PERSONAL_EDITION } from '../../../shared/edition'
import { createMarchMusicCue } from '../lib/anniversaryMusic'
import PortablePlayer from './PortablePlayer'
import CompactPlayer from './CompactPlayer'
import { useEffect, useRef, useState } from 'react'
import { useMusic,type PlayMode } from '../store/music'
import { useApp } from '../store/app'
import { bgm,type PlaybackState } from '../lib/bgm'
import {useMusicPanelPosition} from '../lib/useMusicPanelPosition'
const MODES:Record<PlayMode,string>={seq:'顺序',loop:'单曲',random:'随机'}
const claimMarchMusic = createMarchMusicCue(PERSONAL_EDITION)
const clock=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`
export default function MusicPlayer({wallpaper=false}:{wallpaper?:boolean}){
 const playerStyle=useApp(s=>s.settings.playerStyle)
 const {tracks,index,playing,mode,musicVolume,loadError}=useMusic()
 const [state,setState]=useState<PlaybackState>('paused'),[position,setPosition]=useState(0),[duration,setDuration]=useState(0)
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 const [tab,setTab]=useState<'tracks'|'sources'>('tracks')
 const floating=useMusicPanelPosition(wallpaper)
 const handle=useRef<HTMLDivElement>(null)
 const panel=useRef<HTMLElement>(null),toggle=useRef<HTMLButtonElement>(null),search=useRef<HTMLInputElement>(null)
 const st=useMusic.getState,track=tracks[index]
 useEffect(()=>{
  let cancelled=false
  bgm.setOnState(setState);bgm.setOnTime((p,d)=>{setPosition(p);setDuration(d)})
  bgm.setOnEnd(()=>{if(st().mode==='loop'||st().tracks.length===1)bgm.restart();else st().next()})
  bgm.setOnFail(()=>useMusic.setState({playing:false}))
  // Zustand notifies synchronously even when React rendering is suspended in the background.
  const sync=()=>{const s=st(),t=s.tracks[s.index];bgm.setVolume(s.musicVolume);if(!t)bgm.dispose();else if(s.playing)bgm.play(t.file);else bgm.pause()}
  const unsubscribe=useMusic.subscribe((s,previous)=>{if(s.playing!==previous.playing||s.tracks[s.index]?.file!==previous.tracks[previous.index]?.file||s.musicVolume!==previous.musicVolume)sync()})
  sync()
  const resume=readMusicResume()
  const playAnniversary=()=>{
   const index=claimMarchMusic(st().tracks)
   if(index<0)return false
   st().play(index)
   bgm.seek(0)
   return true
  }
  const foreground=()=>{if(!cancelled&&!document.hidden)void st().load().then(()=>{if(!cancelled)playAnniversary()})}
  window.addEventListener('focus',foreground)
  document.addEventListener('visibilitychange',foreground)
  void st().load().then(()=>{
   if(cancelled)return
   // March 5 intentionally starts the requested song before the usual resume
   // policy. Once claimed, manual pause/selection stays in the listener's hands.
   if(playAnniversary())return
   const track=st().tracks[st().index];if(!track)return
   if(resume?.file===track.file){
    bgm.play(track.file,resume.seconds,resume.playing)
    useMusic.setState({playing:resume.playing})
   }else if(useApp.getState().settings.autoPlayMusic)st().play()
  })
  return()=>{cancelled=true;window.removeEventListener('focus',foreground);document.removeEventListener('visibilitychange',foreground);unsubscribe();bgm.setOnEnd(null);bgm.setOnFail(null);bgm.setOnState(null);bgm.setOnTime(null);bgm.dispose()}
 },[])
 useEffect(()=>{
  if(!open)return
  handle.current?.focus()
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false);toggle.current?.focus()}}
  document.addEventListener('keydown',key)
  return()=>document.removeEventListener('keydown',key)
 },[open])
 async function importFiles(){if(busy)return;setBusy(true);setMessage('');try{const result=await window.api.musicImport();await st().load(true);setMessage(result.added?`已导入 ${result.added} 首${result.skipped?`，${result.skipped} 项重复或无法导入`:''}`:result.skipped?'所选文件已存在、格式不支持或无法读取。':'未添加新音乐。')}catch{setMessage('导入未完成，请重试。')}finally{setBusy(false)}}
 async function remove(id:string,file:string){setBusy(true);try{await window.api.musicRemove(id);if(st().tracks[st().index]?.file===file){st().pause();bgm.dispose()}await st().load(true);setMessage('已从歌单移除，原始音乐文件仍保留。')}catch{setMessage('移除失败，请重试。')}finally{setBusy(false)}}
 const list=tracks.map((t,i)=>({...t,index:i})).filter(t=>t.title.toLowerCase().includes(query.toLowerCase()))
 return <>
  {open&&<section ref={panel} className={'music-library p3r-music-panel'+(floating.dragging?' is-dragging':'')} style={floating.style} aria-label="音乐列表">
   <header className="music-panel-header"><div ref={handle} className="music-panel-handle" tabIndex={0} role="group" aria-label="拖动音乐列表，方向键移动" {...floating.handle}><small>PERSONAL SOUNDTRACK <span>⠿ 拖动</span></small><h2>音乐列表 <span>{String(tracks.length).padStart(2,'0')}</span></h2></div><button className="music-panel-reset" aria-label="恢复音乐列表位置" title="恢复位置" onClick={floating.reset}>↺</button><button className="music-close" aria-label="关闭音乐列表" onClick={()=>{setOpen(false);toggle.current?.focus()}}>×</button></header>
   <div className="music-now"><div className="music-now-art" aria-hidden="true"><span>♪</span><small>{String(index+1).padStart(2,'0')}</small></div><div className="music-now-copy"><small>{state==='loading'?'LOADING / 正在加载':state==='error'?'RETRY / 播放失败':playing?'NOW PLAYING / 正在播放':'STAND BY / 已暂停'}</small><strong title={track?.title}>{track?.title??'选择一首，进入状态'}</strong><div className="music-panel-transport"><button aria-label="列表上一首" disabled={!tracks.length} onClick={()=>st().prev()}>◀</button><button className="music-panel-play" aria-label={playing?'列表暂停音乐':'列表播放音乐'} disabled={!tracks.length} onClick={()=>st().toggle()}>{playing?'Ⅱ':'▶'}</button><button aria-label="列表下一首" disabled={!tracks.length} onClick={()=>st().next()}>▶</button><button className="music-panel-mode" aria-label={'列表播放模式：'+MODES[mode]} onClick={()=>st().setMode(mode==='seq'?'loop':mode==='loop'?'random':'seq')}>{MODES[mode]} ↻</button></div></div></div>
   <div className="portable-library-controls"><div className="music-timeline"><input aria-label="音乐进度" type="range" min={0} max={duration||1} step={.1} value={Math.min(position,duration||1)} disabled={!duration} onChange={e=>bgm.seek(Number(e.target.value))}/><span>{clock(position)} / {clock(duration)}</span></div><label className="music-volume"><span>音量</span><input aria-label="音乐音量" type="range" min={0} max={1} step={.05} value={musicVolume} onChange={e=>st().setMusicVolume(Number(e.target.value))}/></label></div>
   <div className="music-panel-tabs" role="group" aria-label="音乐列表内容"><button aria-pressed={tab==='tracks'} onClick={()=>setTab('tracks')}>01 / 歌曲</button><button aria-pressed={tab==='sources'} onClick={()=>setTab('sources')}>{ONLINE_MUSIC_ENABLED?'02 / 导入与歌单':'02 / 导入音乐'}</button></div>
   <div className="music-sources" hidden={tab!=='sources'}><div className="music-local-import"><div><strong>本地音乐</strong><p>导入你有权使用的音乐文件，离线也能听。</p></div><button className="btn primary" disabled={busy} onClick={()=>void importFiles()}>{busy?'处理中…':'导入音乐'}</button></div>{ONLINE_MUSIC_ENABLED&&<NetEaseLibrary/>}</div>
   {ONLINE_MUSIC_ENABLED&&state==='error'&&track?.tag==='netease'&&<p className="music-message" role="status">{bgm.errorMessage||'这首歌当前无法播放。'}<button className="btn" onClick={()=>void window.api.neteaseOpen(track.id!)}>在网易云中打开</button></p>}
   <label className="music-search" hidden={tab!=='tracks'}><span aria-hidden="true">⌕</span><input ref={search} aria-label="搜索音乐" placeholder="搜索歌曲名称…" value={query} onChange={e=>setQuery(e.target.value)}/><small>{list.length} 首</small></label>
   {(loadError||message)&&<div className="music-message" role="status">{message||loadError}{loadError&&<button onClick={()=>void st().load(true)}>重试读取</button>}</div>}
   <div className="music-library-list" hidden={tab!=='tracks'}>{list.map(t=><div key={t.file} className={'music-library-row'+(t.index===index?' selected':'')}><button onClick={()=>st().play(t.index)} aria-current={t.index===index?'true':undefined} aria-label={'播放 '+t.title}><span>{t.index===index&&playing?'♫':String(t.index+1).padStart(2,'0')}</span><strong>{t.title}</strong><small>{t.tag==='netease'?'网易云':t.tag==='local'?'已导入':t.tag==='ambient'?'环境音':t.tag==='calm'?'舒缓':'原声'}</small></button>{t.tag==='local'&&t.id&&<button className="music-remove" disabled={busy} aria-label={'移除 '+t.title} onClick={()=>void remove(t.id!,t.file)}>×</button>}</div>)}{!list.length&&<p className="music-empty">{query?'没有找到这首歌。':ONLINE_MUSIC_ENABLED?'还没有音乐，前往「导入与歌单」添加吧。':'还没有音乐，前往「导入音乐」添加本地文件。'}</p>}</div>
   <footer><span>STAY IN YOUR RHYTHM</span><span>{tab==='tracks'?'点选歌曲播放 · 拖动标题移动窗口':ONLINE_MUSIC_ENABLED?'本地音乐可离线播放 · 网易云需要联网':'本地音乐可离线播放'}</span></footer>
  </section>}
  {playerStyle==='mp3'&&<PortablePlayer state={state} position={position} duration={duration} open={open} onOpen={()=>setOpen(!open)} toggleRef={toggle} wallpaper={wallpaper}/>}
  {playerStyle==='card'&&<CompactPlayer open={open} onOpen={()=>setOpen(!open)} toggleRef={toggle} wallpaper={wallpaper}/>}
  {playerStyle==='bar'&&<section className="music-shell" aria-label="音乐">
   <button ref={toggle} className="music-list-toggle" aria-label="打开音乐列表" aria-expanded={open} onClick={()=>setOpen(!open)}>☷ <span>{tracks.length}</span></button>
   <div className="music-track"><span className="music-overline" role="status">{state==='loading'?'正在加载…':state==='error'?'播放失败 · 重试或换一首':playing?'NOW PLAYING':'PAUSED'}</span><strong title={track?.title}>{track?.title??'导入音乐，陪你进入状态'}</strong></div>
   <div className="music-transport"><button aria-label="上一首" disabled={!tracks.length} onClick={()=>st().prev()}>‹</button><button className="music-play" aria-label={playing?'暂停音乐':'播放音乐'} disabled={!tracks.length} onClick={()=>st().toggle()}>{playing?'Ⅱ':'▶'}</button><button aria-label="下一首" disabled={!tracks.length} onClick={()=>st().next()}>›</button></div>
   <div className="music-timeline"><input aria-label="音乐进度" type="range" min={0} max={duration||1} step={.1} value={Math.min(position,duration||1)} disabled={!duration} onChange={e=>bgm.seek(Number(e.target.value))}/><span>{clock(position)} / {clock(duration)}</span></div>
   <button className="music-mode" aria-label={'播放模式：'+MODES[mode]} onClick={()=>st().setMode(mode==='seq'?'loop':mode==='loop'?'random':'seq')}>{MODES[mode]} ↻</button>
   <label className="music-volume"><span>音量</span><input aria-label="音乐音量" type="range" min={0} max={1} step={.05} value={musicVolume} onChange={e=>st().setMusicVolume(Number(e.target.value))}/></label>
  </section>}
 </>
}
