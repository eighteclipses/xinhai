export interface CloudAccount { id:string; name:string }
export interface CloudPlaylist { id:string; name:string; count:number; owned:boolean }
export interface CloudTrack { id:string; file:string; title:string; tag:'netease' }
export interface CloudLibrary { account:CloudAccount; playlists:Array<CloudPlaylist & {tracks:CloudTrack[]}>; syncedAt:number }
export type CloudRequest=(path:string)=>Promise<any>
export function playlistShare(input:string):{id?:string;url?:string}{
  if(typeof input!=='string'||input.length>4096)throw Error('请粘贴网易云歌单分享链接。')
  const trimmed=input.trim();if(/^[1-9]\d{0,18}$/.test(trimmed))return {id:cloudId(trimmed)}
  const match=trimmed.match(/https?:\/\/[^\s<>"“”]+/i)
  if(!match)throw Error('没有找到歌单链接，请复制网易云歌单的分享内容。')
  let url:URL;try{url=new URL(match[0].replace(/[，。；！、）)]+$/,''))}catch{throw Error('分享链接格式不正确。')}
  if(url.username||url.password||url.port||!['music.163.com','y.music.163.com','163cn.tv','163cn.com'].includes(url.hostname))throw Error('请使用网易云音乐的歌单分享链接。')
  url.protocol='https:'
  if(['163cn.tv','163cn.com'].includes(url.hostname))return {url:url.href}
  const route=url.hash.startsWith('#/')?new URL(url.hash.slice(1),url.origin):url
  if(!/(?:^|\/)playlist\/?$/.test(route.pathname))throw Error('这是歌曲或其他页面，请复制歌单的分享链接。')
  return {id:cloudId(route.searchParams.get('id'))}
}
export function cloudId(value:unknown):string {const id=String(value);if(!/^[1-9]\d{0,18}$/.test(id))throw Error('网易云编号无效');return id}
export function cloudPath(path:string):boolean {
  return typeof path==='string'&&/^\/api\/(nuser\/account\/get|user\/playlist|(?:v6\/)?playlist\/detail|song\/detail\/?|song\/enhance\/player\/url|login\/qrcode\/unikey|login\/qrcode\/client\/login)(\?[^#\r\n]*)?$/.test(path)
}
export function cloudAudioUrl(value:unknown):string {
  if(typeof value!=='string')throw Error('这首歌暂时无法播放，请在网易云中查看。')
  const url=new URL(value)
  if(!['https:','http:'].includes(url.protocol)||!/(^|\.)music\.(126\.net|163\.com)$/.test(url.hostname)||url.username||url.password||url.port)throw Error('网易云返回了无法使用的播放地址。')
  url.protocol='https:';return url.href
}
export async function cloudAccount(request:CloudRequest):Promise<CloudAccount|null>{
  const data=await request('/api/nuser/account/get')
  if(data.code!==200)throw Error('无法读取网易云登录状态，请重新登录后重试。')
  return data.profile?{id:cloudId(data.profile.userId),name:String(data.profile.nickname||'网易云用户')}:null
}
export async function cloudPlaylists(request:CloudRequest):Promise<{account:CloudAccount;playlists:CloudPlaylist[]}>{
  const account=await cloudAccount(request);if(!account)throw Error('请先在网易云官方窗口登录，关闭窗口后点击“读取我的歌单”。')
  const playlists:CloudPlaylist[]=[]
  for(let offset=0;offset<10000;offset+=100){
    const data=await request(`/api/user/playlist?uid=${account.id}&limit=100&offset=${offset}`)
    if(data.code!==200||!Array.isArray(data.playlist))throw Error('歌单读取失败，请稍后重试。')
    for(const p of data.playlist)if(!playlists.some(x=>x.id===String(p.id)))playlists.push({id:cloudId(p.id),name:String(p.name),count:Number(p.trackCount)||0,owned:String(p.creator?.userId)===account.id})
    if(!data.more)return {account,playlists}
    if(!data.playlist.length)break
  }
  throw Error('歌单数量超出本次读取范围，未覆盖本机歌单。')
}
export async function cloudPlaylist(request:CloudRequest,id:string):Promise<CloudPlaylist & {tracks:CloudTrack[]}>{
  const data=await request(`/api/v6/playlist/detail?id=${cloudId(id)}&n=100000`),p=data.result??data.playlist
  if(data.code!==200||!p||!Array.isArray(p.tracks))throw Error('这份歌单暂时无法读取，可能已设为私密或被删除。')
  const songs=new Map<string,any>(p.tracks.map((t:any)=>[cloudId(t.id),t]))
  const ids:string[]=Array.isArray(p.trackIds)?p.trackIds.map((t:any)=>cloudId(t.id)):Array.from(songs.keys())
  if(ids.length>10000)throw Error('歌单超过 10000 首，请拆分后同步。')
  const missing=ids.filter(id=>!songs.has(id))
  for(let i=0;i<missing.length;i+=100){
    const result=await request('/api/song/detail?ids='+encodeURIComponent(JSON.stringify(missing.slice(i,i+100).map(Number))))
    if(result.code!==200||!Array.isArray(result.songs))throw Error('部分歌曲未读取成功，本次同步未保存，请重试。')
    for(const t of result.songs)songs.set(cloudId(t.id),t)
  }
  if(ids.length<(Number(p.trackCount)||0)||ids.some(id=>!songs.has(id)))throw Error('网易云未返回完整歌单，本次同步未保存。')
  const tracks:CloudTrack[]=ids.map(id=>{const t=songs.get(id);return {id,file:'netease:'+id,title:String(t.name)+' · '+(t.artists??t.ar??[]).map((a:any)=>a.name).join(' / '),tag:'netease'}})
  return {id:cloudId(id),name:String(p.name||'网易云歌单'),count:tracks.length,owned:false,tracks}
}
export async function cloudTracks(request:CloudRequest,id:string):Promise<CloudTrack[]>{return (await cloudPlaylist(request,id)).tracks}
export async function cloudResolve(request:CloudRequest,id:string):Promise<string>{
  const result=await request('/api/song/enhance/player/url?ids='+encodeURIComponent('['+cloudId(id)+']')+'&br=128000')
  const t=result.data?.find((t:any)=>String(t.id)===id)
  if(result.code!==200||!t||t.code!==200||!t.url)throw Error('这首歌当前无法在这里播放，请在网易云中查看账号权限或歌曲状态。')
  if(t.freeTrialInfo)throw Error('这首歌仅提供试听片段，请在网易云中播放完整歌曲。')
  return cloudAudioUrl(t.url)
}
