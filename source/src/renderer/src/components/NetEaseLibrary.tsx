import {useEffect,useRef,useState} from 'react'
import SharedPlaylists from './SharedPlaylists'
import QRCode from 'qrcode'
import {cloudAccount,cloudPlaylists,cloudTracks,type CloudAccount,type CloudPlaylist} from '../../../shared/netease'
import {readCloudLibrary,writeCloudLibrary} from '../lib/cloudLibrary'
import {useMusic} from '../store/music'

export default function NetEaseLibrary(){
 const cached=readCloudLibrary()
 const [account,setAccount]=useState<CloudAccount|null>(cached?.account??null),[playlists,setPlaylists]=useState<CloudPlaylist[]>(cached?.playlists??[])
 const [selected,setSelected]=useState<string[]>(cached?.playlists.map(p=>p.id)??[]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[last,setLast]=useState(cached?.syncedAt??0)
 const [qr,setQr]=useState<{key:string;image:string;expires:number}|null>(null),qrEpoch=useRef(0),[qrBusy,setQrBusy]=useState(false)
 useEffect(()=>()=>{qrEpoch.current++},[])
 async function scan(){
   const epoch=++qrEpoch.current;setQr(null);setQrBusy(true);setMessage('正在生成登录二维码…')
   try{
     const data=await window.api.neteaseRequest('/api/login/qrcode/unikey?type=1&t='+Date.now())
     if(data.code!==200||typeof data.unikey!=='string'||!data.unikey)throw Error('二维码生成失败，请重试。')
     const image=await QRCode.toDataURL('https://music.163.com/login?codekey='+encodeURIComponent(data.unikey),{width:240,margin:2,errorCorrectionLevel:'M'})
     if(epoch!==qrEpoch.current)return
     setQr({key:data.unikey,image,expires:Date.now()+180000});setMessage('请使用手机网易云音乐 App 扫码，并在手机上确认登录。')
   }catch(e){if(epoch===qrEpoch.current)setMessage(e instanceof Error?e.message:'二维码生成失败。')}finally{if(epoch===qrEpoch.current)setQrBusy(false)}
 }
 useEffect(()=>{
   if(!qr)return
   let cancelled=false;let timer:ReturnType<typeof setTimeout>
   const poll=async()=>{
     try{
       if(Date.now()>qr.expires){setQr(null);setMessage('二维码已过期，请重新生成。');return}
       const result=await window.api.neteaseRequest('/api/login/qrcode/client/login?key='+encodeURIComponent(qr.key)+'&type=1')
       if(cancelled)return
       if(result.code===803){setQr(null);await refresh();return}
       if(result.code===800){setQr(null);setMessage('二维码已过期，请重新生成。');return}
       if(result.code!==801&&result.code!==802)throw Error('登录状态读取失败，请重新扫码。')
       setMessage(result.code===802?'扫码成功，请在手机上确认登录。':'请使用手机网易云音乐 App 扫码，并在手机上确认登录。')
       timer=setTimeout(()=>void poll(),3000)
     }catch(e){if(!cancelled){setQr(null);setMessage(e instanceof Error?e.message:'登录状态读取失败。')}}
   }
   timer=setTimeout(()=>void poll(),1800)
   return()=>{cancelled=true;clearTimeout(timer)}
 },[qr])
 async function action(work:()=>Promise<void>){if(busy)return;setBusy(true);setMessage('');try{await work()}catch(e){setMessage(e instanceof Error?e.message:'连接失败，请重试。')}finally{setBusy(false)}}
 const login=()=>action(async()=>{await window.api.neteaseLogin();setMessage('在网易云官方窗口完成登录，关闭窗口后点击“读取我的歌单”。')})
 const refresh=()=>action(async()=>{const result=await cloudPlaylists(window.api.neteaseRequest);if(account?.id!==result.account.id){writeCloudLibrary(null);useMusic.getState().pause();await useMusic.getState().load(true);setSelected([]);setLast(0)}setAccount(result.account);setPlaylists(result.playlists);setMessage(`已读取 ${result.playlists.length} 份歌单，请选择要同步的歌单。`)})
 const sync=()=>action(async()=>{
   if(!account)return
   // Validate the active account before applying an all-or-nothing library snapshot.
   const current=await cloudPlaylists(window.api.neteaseRequest)
   if(current.account.id!==account.id)throw Error('登录账号已变更，请重新读取歌单。')
   const result=[]
   for(const id of selected){const p=current.playlists.find(p=>p.id===id);if(!p)throw Error('歌单已变化，请重新读取后选择。');setMessage(`正在同步「${p.name}」…`);result.push({...p,tracks:await cloudTracks(window.api.neteaseRequest,p.id)})}
   if((await cloudAccount(window.api.neteaseRequest))?.id!==account.id)throw Error('登录状态已变化，本次同步未保存，请重新登录。')
   const syncedAt=Date.now();writeCloudLibrary({account,playlists:result,syncedAt});setLast(syncedAt);await useMusic.getState().load(true)
   setMessage(`已同步 ${result.length} 份歌单，共 ${new Set(result.flatMap(p=>p.tracks.map(t=>t.id))).size} 首歌曲。下次点击同步可更新收藏。`)
 })
 const logout=()=>action(async()=>{qrEpoch.current++;setQr(null);await window.api.neteaseLogout();writeCloudLibrary(null);useMusic.getState().pause();await useMusic.getState().load(true);setAccount(null);setPlaylists([]);setSelected([]);setLast(0);setMessage('已退出网易云，并移除本机同步歌单。')})
 return <><SharedPlaylists/><details className="netease-library" onToggle={e=>{if(!e.currentTarget.open){qrEpoch.current++;setQr(null);setQrBusy(false)}}}><summary>网易云音乐 <span>{account?account.name:'账号登录 · 可选'}</span></summary><div className="netease-actions"><button className="btn primary" disabled={busy||qrBusy} onClick={()=>void scan()}>{qrBusy?'正在生成…':'扫码登录'}</button><button className="btn" disabled={busy||!!qr} onClick={()=>void login()}>官方网页登录</button><button className="btn" disabled={busy||!!qr} onClick={()=>void refresh()}>读取我的歌单</button>{account&&<button className="btn" disabled={busy||!!qr} onClick={()=>void logout()}>退出账号</button>}</div>
 {qr&&<div className="netease-qr"><img src={qr.image} alt="使用手机网易云音乐 App 扫码登录"/><div><strong>网易云音乐 App 扫码</strong><p>在手机上确认后，会自动读取你的歌单。</p><button className="btn" onClick={()=>{qrEpoch.current++;setQr(null);setMessage('已停止等待扫码。')}}>关闭二维码</button></div></div>}
 <p>在官方页面登录后，选择创建或收藏的歌单同步。歌曲在线播放，能否完整播放取决于账号权限和网易云当前返回的音源。</p>
 {!!playlists.length&&<><div className="netease-playlists">{playlists.map(p=><label key={p.id}><input type="checkbox" disabled={busy} checked={selected.includes(p.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/><span>{p.name}<small>{p.owned?'我创建的':'我收藏的'} · {p.count} 首</small></span></label>)}</div><button className="btn primary" disabled={busy||!selected.length} onClick={()=>void sync()}>{busy?'处理中…':`同步选中歌单（${selected.length}）`}</button></>}
 {last>0&&<small>上次同步：{new Date(last).toLocaleString()}</small>}{message&&<p role="status">{message}</p>}</details></>
}
