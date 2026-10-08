import {useState} from 'react'
import {cloudPlaylist} from '../../../shared/netease'
import {readShares,writeShares} from '../lib/cloudLibrary'
import {useMusic} from '../store/music'

export default function SharedPlaylists(){
 const [input,setInput]=useState(''),[shares,setShares]=useState(readShares),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 async function importShare(value:string){
  if(busy)return;setBusy(true);setMessage('正在读取歌单…')
  try{const id=await window.api.neteaseShareResolve(value);const p=await cloudPlaylist(window.api.neteaseRequest,id);const next=[...readShares().filter(s=>s.id!==id),{...p,updatedAt:Date.now()}];writeShares(next);setShares(next);await useMusic.getState().load(true);setInput('');setMessage(`已导入「${p.name}」· ${p.tracks.length} 首。重复歌曲已合并。`)}catch(e){setMessage(e instanceof Error?e.message:'歌单导入失败，请重试。')}finally{setBusy(false)}
 }
 async function remove(id:string){const next=readShares().filter(s=>s.id!==id);try{writeShares(next);setShares(next);await useMusic.getState().load(true);setMessage('已移除本机导入的歌单。')}catch{setMessage('移除未完成，请重试。')}}
 return <section className="shared-playlists" aria-label="导入网易云分享歌单"><div className="share-heading"><strong>歌单分享链接</strong><small>公开歌单无需登录</small></div><form onSubmit={e=>{e.preventDefault();void importShare(input)}}><input aria-label="网易云歌单分享链接" value={input} onChange={e=>setInput(e.target.value)} placeholder="粘贴歌单链接或整段分享文字…" maxLength={4096} disabled={busy}/><button className="btn primary" disabled={busy||!input.trim()}>{busy?'读取中…':'导入歌单'}</button></form><p>支持完整链接、网易云短链接和歌单编号。歌曲在线播放，完整播放仍取决于音源与账号权限。</p>
 {shares.length>0&&<div className="shared-playlist-list">{shares.map(p=><div key={p.id}><span><strong>{p.name}</strong><small>{p.tracks.length} 首 · {new Date(p.updatedAt).toLocaleDateString()} 更新</small></span><button disabled={busy} onClick={()=>void importShare(p.id)} aria-label={'更新歌单 '+p.name}>更新</button><button disabled={busy} onClick={()=>void remove(p.id)} aria-label={'移除歌单 '+p.name}>移除</button></div>)}</div>}{message&&<p role="status">{message}</p>}</section>
}
