import type {RefObject} from 'react'
import {useApp} from '../store/app'
import {useMusic} from '../store/music'
import DraggableWidget from './DraggableWidget'
import type {PlaybackState} from '../lib/bgm'

export default function PortablePlayer({state,position,duration,open,onOpen,toggleRef,wallpaper}:{state:PlaybackState;position:number;duration:number;open:boolean;onOpen:()=>void;toggleRef:RefObject<HTMLButtonElement>;wallpaper:boolean}){
 const {tracks,index,playing,mode}=useMusic(),scale=useApp(s=>s.settings.playerScale)
 const st=useMusic.getState,track=tracks[index]
 const title=state==='error'?'播放失败 · 打开歌单重试':state==='loading'?'正在加载…':track?.title??'选择喜欢的音乐'
 return <DraggableWidget kind="player" width={400} height={98} scale={scale} unrestricted={wallpaper}>{zoom=><div className={'portable-player'+(playing?' is-playing':'')} style={{transform:`scale(${zoom*2/3})`}}>
  <img className="portable-body" src="design/player-demo.svg" draggable={false} alt=""/>
  <div className="portable-display">
   <button ref={toggleRef} className="portable-album" aria-label="打开音乐列表" aria-expanded={open} onClick={onOpen} title="歌单、进度与音量"><span>{String(index+1).padStart(2,'0')}</span><i aria-hidden="true">♫</i></button>
   <div className="portable-lcd"><div className="portable-title" title={title}><span>{title}</span></div><div className="portable-controls">
    <button aria-label="上一首" disabled={!tracks.length} onClick={()=>st().prev()} title="上一首"><span aria-hidden="true">‹</span></button>
    <button aria-label={playing?'暂停音乐':'播放音乐'} disabled={!tracks.length} onClick={()=>st().toggle()} title={playing?'暂停':'播放'}><span aria-hidden="true">{playing?'Ⅱ':'▶'}</span></button>
    <button aria-label="下一首" disabled={!tracks.length} onClick={()=>st().next()} title="下一首"><span aria-hidden="true">›</span></button>
    <button aria-label={'播放模式：'+({seq:'顺序',loop:'单曲',random:'随机'}[mode])} onClick={()=>st().setMode(mode==='seq'?'loop':mode==='loop'?'random':'seq')} title={'播放模式：'+({seq:'顺序',loop:'单曲',random:'随机'}[mode])}><span aria-hidden="true">{mode==='random'?'⤨':mode==='loop'?'↻':'↺'}</span></button>
   </div></div>
   <div className="portable-progress" aria-hidden="true"><i style={{width:Math.min(100,duration?position/duration*100:0)+'%'}}/></div>
  </div>
 </div>}</DraggableWidget>
}
