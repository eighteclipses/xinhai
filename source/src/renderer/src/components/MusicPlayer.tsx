import {readMusicResume} from '../lib/musicResume'
import NetEaseLibrary from './NetEaseLibrary'
import { ONLINE_MUSIC_ENABLED, PERSONAL_EDITION } from '../../../shared/edition'
import { createMarchMusicCue } from '../lib/anniversaryMusic'
import PortablePlayer from './PortablePlayer'
import CompactPlayer from './CompactPlayer'
import { useEffect, useRef, useState } from 'react'
import { useMusic,type PlayMode,type Track } from '../store/music'
import type { MusicImportResult, MusicStorageInfo } from '../../../shared/musicLibrary'
import { useApp } from '../store/app'
import { bgm,type PlaybackState } from '../lib/bgm'
import {useMusicPanelPosition} from '../lib/useMusicPanelPosition'
const MODES:Record<PlayMode,string>={seq:'顺序',loop:'单曲',random:'随机'}
const claimMarchMusic = createMarchMusicCue(PERSONAL_EDITION)
const clock=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`
export default function MusicPlayer({wallpaper=false}:{wallpaper?:boolean}){
 const playerStyle=useApp(s=>s.settings.playerStyle)
 const {tracks,index,playing,mode,musicVolume,loadError,hiddenBuiltinTracks}=useMusic()
 const [state,setState]=useState<PlaybackState>('paused'),[position,setPosition]=useState(0),[duration,setDuration]=useState(0)
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 const [tab,setTab]=useState<'tracks'|'sources'>('tracks')
 const [storage,setStorage]=useState<MusicStorageInfo|null>(null),[storageError,setStorageError]=useState('')
 const [showStorage,setShowStorage]=useState(false),[showHidden,setShowHidden]=useState(false)
 const [removeTarget,setRemoveTarget]=useState<Track|null>(null),[undo,setUndo]=useState<{id:string;title:string}|null>(null)
 const busyRef=useRef(false)
 const floating=useMusicPanelPosition(wallpaper)
 const handle=useRef<HTMLDivElement>(null)
 const panel=useRef<HTMLElement>(null),toggle=useRef<HTMLButtonElement>(null),search=useRef<HTMLInputElement>(null)
 const st=useMusic.getState,track=tracks[index]
 useEffect(()=>{
  const show=()=>{setTab('tracks');setQuery('');setRemoveTarget(null);setShowStorage(false);setShowHidden(false);panel.current?.scrollTo(0,0);setOpen(true)}
  window.addEventListener('xinhai-open-music-library',show)
  return()=>window.removeEventListener('xinhai-open-music-library',show)
 },[])
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
  let live=true
  setStorageError('')
  void window.api.musicStorageInfo().then(value=>{if(live)setStorage(value)}).catch(()=>{if(live)setStorageError('暂时未能读取存放位置，可以关闭后重新打开音乐列表。')})
  handle.current?.focus()
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false);toggle.current?.focus()}}
  document.addEventListener('keydown',key)
  return()=>{live=false;document.removeEventListener('keydown',key)}
 },[open])
 async function manage(work:()=>Promise<void>|void,failure:string){
  if(busyRef.current)return
  busyRef.current=true;setBusy(true);setMessage('')
  try{await work()}catch{setMessage(failure)}finally{busyRef.current=false;setBusy(false)}
 }
 function importMessage(result:MusicImportResult){
  const parts=[result.added?`已添加 ${result.added} 首音乐。`:'没有添加新音乐。']
  if(result.duplicates!==undefined||result.failed!==undefined){
   if(result.duplicates)parts.push(`${result.duplicates} 首已在歌单中，未重复添加。`)
   if(result.failed)parts.push(`${result.failed} 项未能添加，请检查文件是否可读取、格式是否支持。`)
  }else if(result.skipped)parts.push(`${result.skipped} 项未添加，可能已存在或文件无法读取。`)
  return parts.join(' ')
 }
 const importFiles=(folder=false)=>manage(async()=>{
  const result=await (folder?window.api.musicImportFolder():window.api.musicImport())
  if(result.cancelled){setMessage('已取消添加，歌单未更改。');return}
  st().replaceImportedTracks(result.tracks)
  if(result.added>0)setUndo(null)
  await st().load(true)
  setQuery('');setTab('tracks');setRemoveTarget(null)
  setMessage(folder&&!result.added&&!result.skipped?'这个文件夹这一层没有可添加的音频，可选择专辑子文件夹，或直接多选音乐文件。':importMessage(result))
 },'添加未完成，已有歌单和音乐文件仍保留，请重试。')
 const hide=(file:string)=>manage(()=>{
  st().setBuiltinHidden(file,true)
  setMessage('已隐藏这首内置音乐，可在“已隐藏”中恢复。音乐文件未删除。')
 },'隐藏设置未能保存，这首音乐仍在列表中，请重试。')
 const restore=(file?:string)=>manage(()=>{
  if(file)st().setBuiltinHidden(file,false);else st().restoreAllBuiltins()
  if(!st().hiddenBuiltinTracks.length)setShowHidden(false)
  setMessage(file?'已恢复这首内置音乐。':'已恢复全部内置音乐。')
 },'恢复设置未能保存，请重试。')
 const remove=(target:Track)=>manage(async()=>{
  if(!target.id)return
  if(st().tracks[st().index]?.file===target.file){st().pause();bgm.dispose();setState('paused')}
  const remaining=await window.api.musicRemove(target.id)
  st().replaceImportedTracks(remaining)
  setRemoveTarget(null);setUndo({id:target.id,title:target.title})
  await st().load(true)
  setMessage(`已从歌单移除“${target.title}”。原文件和软件内副本都保留，可撤销本次移除。`)
 },'移除未完成，音乐文件仍保留，请重试。')
 const undoRemove=()=>manage(async()=>{
  if(!undo)return
  st().replaceImportedTracks(await window.api.musicUndoRemove(undo.id))
  await st().load(true)
  setMessage(`已将“${undo.title}”放回歌单。`);setUndo(null)
 },'暂时无法撤销；音乐文件仍保留，也可重新添加原文件。')
 const list=tracks.map((t,i)=>({...t,index:i})).filter(t=>t.title.toLowerCase().includes(query.toLowerCase()))
 return <>
  {open&&<section ref={panel} className={'music-library p3r-music-panel'+(floating.dragging?' is-dragging':'')+(showStorage||showHidden?' has-management-detail':'' )} style={floating.style} aria-label="音乐列表">
   <header className="music-panel-header"><div ref={handle} className="music-panel-handle" tabIndex={0} role="group" aria-label="拖动音乐列表，方向键移动" {...floating.handle}><small>PERSONAL SOUNDTRACK <span>⠿ 拖动</span></small><h2>音乐列表 <span>{String(tracks.length).padStart(2,'0')}</span></h2></div><button className="music-panel-reset" aria-label="恢复音乐列表位置" title="恢复位置" onClick={floating.reset}>↺</button><button className="music-close" aria-label="关闭音乐列表" onClick={()=>{setOpen(false);toggle.current?.focus()}}>×</button></header>
   <div className="music-library-actions" aria-label="音乐管理">
    <button type="button" className="music-add" aria-label="添加音乐" disabled={busy} onClick={()=>void importFiles()}><span aria-hidden="true">＋</span> 添加音乐</button>
    {storage?.canImportFolder&&<button type="button" disabled={busy} onClick={()=>void importFiles(true)}>添加文件夹</button>}
    <button type="button" disabled={busy} aria-expanded={showStorage} aria-controls="music-storage-info" onClick={()=>setShowStorage(!showStorage)}>音乐存放位置</button>
    <button type="button" disabled={busy||!hiddenBuiltinTracks.length} aria-expanded={showHidden} aria-controls="music-hidden-list" onClick={()=>setShowHidden(!showHidden)}>已隐藏 {hiddenBuiltinTracks.length} 首</button>
   </div>
   <p className="music-library-help">添加音乐可多选文件。移除只改歌单，原文件和软件内副本都保留。</p>
   {showStorage&&<section id="music-storage-info" className="music-storage-info" aria-label="音乐存放位置说明">
    <strong>音乐存放位置</strong>
    <p>{storageError||storage?.message||'正在读取存放位置…'}</p>
    {storage?.platform==='desktop'&&storage.folderPath&&<code>{storage.folderPath}</code>}
    <p>用“添加音乐”选择文件即可，不必手动寻找或移动音乐文件。</p>
    {storage?.platform==='desktop'&&storage.canOpenFolder&&<button type="button" disabled={busy} onClick={()=>void manage(()=>window.api.musicOpenFolder(),'未能打开导入音乐文件夹，请稍后重试。')}>打开导入音乐文件夹</button>}
   </section>}
   {showHidden&&<section id="music-hidden-list" className="music-hidden-list" aria-label="已隐藏的内置音乐">
    <div><strong>已隐藏的内置音乐</strong><button type="button" disabled={busy||!hiddenBuiltinTracks.length} onClick={()=>void restore()}>全部恢复</button></div>
    <ul>{hiddenBuiltinTracks.map(item=><li key={item.file}><span title={item.title}>{item.title}</span><button type="button" disabled={busy} aria-label={'恢复 '+item.title} onClick={()=>void restore(item.file)}>恢复</button></li>)}</ul>
    {!hiddenBuiltinTracks.length&&<p>没有隐藏的内置音乐。</p>}
   </section>}
   <div className="music-now"><div className="music-now-art" aria-hidden="true"><span>♪</span><small>{String(index+1).padStart(2,'0')}</small></div><div className="music-now-copy"><small>{state==='loading'?'LOADING / 正在加载':state==='error'?'RETRY / 播放失败':playing?'NOW PLAYING / 正在播放':'STAND BY / 已暂停'}</small><strong title={track?.title}>{track?.title??'选择一首，进入状态'}</strong><div className="music-panel-transport"><button aria-label="列表上一首" disabled={!tracks.length} onClick={()=>st().prev()}>◀</button><button className="music-panel-play" aria-label={playing?'列表暂停音乐':'列表播放音乐'} disabled={!tracks.length} onClick={()=>st().toggle()}>{playing?'Ⅱ':'▶'}</button><button aria-label="列表下一首" disabled={!tracks.length} onClick={()=>st().next()}>▶</button><button className="music-panel-mode" aria-label={'列表播放模式：'+MODES[mode]} onClick={()=>st().setMode(mode==='seq'?'loop':mode==='loop'?'random':'seq')}>{MODES[mode]} ↻</button></div></div></div>
   <div className="portable-library-controls"><div className="music-timeline"><input aria-label="音乐进度" type="range" min={0} max={duration||1} step={.1} value={Math.min(position,duration||1)} disabled={!duration} onChange={e=>bgm.seek(Number(e.target.value))}/><span>{clock(position)} / {clock(duration)}</span></div><label className="music-volume"><span>音量</span><input aria-label="音乐音量" type="range" min={0} max={1} step={.05} value={musicVolume} onChange={e=>st().setMusicVolume(Number(e.target.value))}/></label></div>
   <div className="music-panel-tabs" role="group" aria-label="音乐列表内容"><button aria-pressed={tab==='tracks'} onClick={()=>setTab('tracks')}>01 / 歌曲</button><button aria-pressed={tab==='sources'} onClick={()=>setTab('sources')}>{ONLINE_MUSIC_ENABLED?'02 / 在线歌单':'02 / 音乐说明'}</button></div>
   <div className="music-sources" hidden={tab!=='sources'}><p className="music-source-help">本地音乐用上方“添加音乐”选择文件，添加后可离线播放。</p>{ONLINE_MUSIC_ENABLED?<fieldset className="music-online-group" disabled={busy}><NetEaseLibrary/></fieldset>:<p className="music-source-help">本版本提供本地音乐，可用的导入方式与存放位置见上方音乐管理区。</p>}</div>
   {ONLINE_MUSIC_ENABLED&&state==='error'&&track?.tag==='netease'&&<p className="music-message" role="status">{bgm.errorMessage||'这首歌当前无法播放。'}<button className="btn" onClick={()=>void window.api.neteaseOpen(track.id!)}>在网易云中打开</button></p>}
   <label className="music-search" hidden={tab!=='tracks'}><span aria-hidden="true">⌕</span><input ref={search} aria-label="搜索音乐" placeholder="搜索歌曲名称…" value={query} onChange={e=>setQuery(e.target.value)}/><small>{list.length} 首</small></label>
   {message&&<div className="music-message" role="status">{message}</div>}
   {undo&&<div className="music-undo"><span>最近移除：{undo.title}</span><button type="button" disabled={busy} onClick={()=>void undoRemove()}>撤销移除</button></div>}
   {loadError&&<div className="music-message" role="status">{loadError}<button disabled={busy} onClick={()=>void manage(()=>st().load(true),'暂时未能重新读取音乐，请重试。')}>重试读取</button></div>}
   <div className="music-library-list" hidden={tab!=='tracks'}>{list.map(t=><div className="music-library-item" key={t.file}><div className={'music-library-row'+(t.index===index?' selected':'')}><button onClick={()=>st().play(t.index)} aria-current={t.index===index?'true':undefined} aria-label={'播放 '+t.title}><span>{t.index===index&&playing?'♫':String(t.index+1).padStart(2,'0')}</span><strong>{t.title}</strong><small>{t.tag==='netease'?'网易云':t.tag==='local'?'已导入':t.tag==='ambient'?'内置·环境音':t.tag==='calm'?'内置·舒缓':'内置·原声'}</small></button>{t.tag==='local'&&t.id?<button type="button" className="music-remove" disabled={busy} aria-label={'移除 '+t.title} onClick={()=>setRemoveTarget(t)}>移除</button>:t.tag!=='netease'&&<button type="button" className="music-remove" disabled={busy} aria-label={'隐藏 '+t.title} onClick={()=>void hide(t.file)}>隐藏</button>}</div>{removeTarget?.file===t.file&&<div className="music-remove-confirm" role="group" aria-label="确认移除音乐"><p>将“{t.title}”从歌单移除？原文件和软件内副本都保留。</p><div><button type="button" disabled={busy} aria-label={'确认移除 '+t.title} onClick={()=>void remove(t)}>确认移除</button><button type="button" disabled={busy} onClick={()=>setRemoveTarget(null)}>取消</button></div></div>}</div>)}{!list.length&&<p className="music-empty">{query?'没有找到这首歌，试试清空搜索。':hiddenBuiltinTracks.length?'当前歌单为空。可添加音乐，或在上方“已隐藏”中恢复内置音乐。':'还没有音乐，点击上方“添加音乐”选择本地文件。'}</p>}</div>
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
