import {BrowserWindow,session} from 'electron'
import {cloudPath,cloudResolve,cloudId,playlistShare} from '../shared/netease'
const ORIGIN='https://music.163.com'
const cloudSession=()=>session.fromPartition('persist:xinhai-netease')
let login:BrowserWindow|null=null
export async function neteaseRequest(path:string){
  if(!cloudPath(path))throw Error('不支持的网易云请求')
  const poll=path.startsWith('/api/login/qrcode/client/login?')
  const response=await cloudSession().fetch(ORIGIN+(poll?path.split('?')[0]:path),{method:poll?'POST':'GET',body:poll?path.split('?')[1]:undefined,headers:{Referer:ORIGIN+'/',...(poll?{'Content-Type':'application/x-www-form-urlencoded'}:{})},credentials:'include',redirect:'error',signal:AbortSignal.timeout(20000)})
  if(!response.ok)throw Error('网易云连接失败，请稍后重试。')
  const body=await response.text();if(body.length>12*1024*1024)throw Error('网易云响应过大。')
  return JSON.parse(body)
}
export function neteaseLogin(){
  if(login&&!login.isDestroyed()){login.show();login.focus();return}
  const s=cloudSession();s.setPermissionRequestHandler((_w,_p,done)=>done(false))
  login=new BrowserWindow({width:1060,height:780,title:'网易云音乐 · 登录后关闭窗口并读取歌单',autoHideMenuBar:true,webPreferences:{session:s,sandbox:true,contextIsolation:true,nodeIntegration:false}})
  const allowed=(value:string)=>{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='music.163.com'||u.hostname.endsWith('.163.com'))}catch{return false}}
  login.webContents.on('will-navigate',(e,url)=>{if(!allowed(url))e.preventDefault()})
  login.webContents.on('will-redirect',(e,url)=>{if(!allowed(url))e.preventDefault()})
  login.webContents.setWindowOpenHandler(()=>({action:'deny'}))
  login.on('closed',()=>{login=null})
  void login.loadURL(ORIGIN+'/#/my/')
}
export async function neteaseLogout(){login?.close();await cloudSession().clearStorageData();await cloudSession().clearCache()}
export const neteaseResolve=(id:string)=>cloudResolve(neteaseRequest,cloudId(id))
export async function neteaseShareResolve(input:string):Promise<string>{
  let current=playlistShare(input)
  for(let n=0;n<5;n++){
    if(current.id)return current.id
    const response=await fetch(current.url!,{redirect:'manual',signal:AbortSignal.timeout(12000)})
    void response.body?.cancel()
    const redirect=response.headers.get('location')
    if(![301,302,303,307,308].includes(response.status)||!redirect)throw Error('短链接未能解析，请在网易云中复制完整歌单链接。')
    current=playlistShare(new URL(redirect,current.url).href)
  }
  if(current.id)return current.id
  throw Error('分享链接跳转过多，请复制完整歌单链接。')
}
