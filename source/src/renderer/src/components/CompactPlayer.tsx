import type { RefObject } from 'react'
import { useApp } from '../store/app'
import { useMusic } from '../store/music'
import DraggableWidget from './DraggableWidget'

export default function CompactPlayer({open,onOpen,toggleRef,wallpaper}:{open:boolean;onOpen:()=>void;toggleRef:RefObject<HTMLButtonElement>;wallpaper:boolean}){
  const {tracks,index,playing}=useMusic(),scale=useApp(s=>s.settings.playerScale)
  const music=useMusic.getState
  return <DraggableWidget kind="player" width={350} height={104} scale={scale} unrestricted={wallpaper}>{zoom=><section className={'compact-player'+(playing?' is-playing':'')} style={{transform:`scale(${zoom})`}} aria-label="悬浮音乐播放器">
    <button ref={toggleRef} className="compact-player-library" aria-label="打开音乐列表" aria-expanded={open} onClick={onOpen}><span aria-hidden="true">♫</span></button>
    <div className="compact-player-track"><small>{playing?'NOW PLAYING':'YOUR SOUNDTRACK'}</small><strong title={tracks[index]?.title}>{tracks[index]?.title??'导入音乐，进入自己的节奏'}</strong><div className="compact-player-controls"><button aria-label="上一首" disabled={!tracks.length} onClick={()=>music().prev()}>‹</button><button aria-label={playing?'暂停音乐':'播放音乐'} disabled={!tracks.length} onClick={()=>music().toggle()}>{playing?'Ⅱ':'▶'}</button><button aria-label="下一首" disabled={!tracks.length} onClick={()=>music().next()}>›</button></div></div>
  </section>}</DraggableWidget>
}
