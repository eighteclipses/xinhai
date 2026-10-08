interface NativeBridge { call(method:string,args:string):string; request(id:string,method:string,args:string):void }
declare global {interface Window { XinhaiNative?:NativeBridge; __xinhaiResult?:(id:string,result:string)=>void }}
function unpack<T>(raw:string):T {const result=JSON.parse(raw);if(!result.ok)throw Error(result.error||'操作未完成');return result.value as T}
export function native<T=unknown>(method:string,args:unknown={}):T {
  if(!window.XinhaiNative)throw Error('请在心海共学 Android 应用内打开。')
  return unpack<T>(window.XinhaiNative.call(method,JSON.stringify(args)))
}
const requests=new Map<string,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;timer?:ReturnType<typeof setTimeout>}>()
export function request<T>(method:string,args:unknown={}):Promise<T> {
  return new Promise((resolve,reject)=>{
    if(!window.XinhaiNative){reject(Error('Android 文件服务不可用。'));return}
    const id=crypto.randomUUID()
    const timeout=method==='syncHttp'?20000:method==='http'||method==='modelRequest'?65000:0
    const timer=timeout?setTimeout(()=>{requests.delete(id);reject(Error(method==='syncHttp'?'局域网同步连接超时，将自动重试。':'网络请求超时，请稍后重试。'))},timeout):undefined
    requests.set(id,{resolve:resolve as (v:unknown)=>void,reject,timer})
    try{window.XinhaiNative.request(id,method,JSON.stringify(args))}catch(e){clearTimeout(timer);requests.delete(id);reject(e)}
  })
}
window.__xinhaiResult=(id,raw)=>{const r=requests.get(id);if(!r)return;clearTimeout(r.timer);requests.delete(id);try{r.resolve(unpack(raw))}catch(e){r.reject(e as Error)}}
