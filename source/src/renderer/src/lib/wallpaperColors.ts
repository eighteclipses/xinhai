import type { resolveScene } from './scenes'
import { activeFrameDeadline, VIDEO_COLOR_FRAME_WAIT_MS } from './videoFrameWait'

type RGB = [number,number,number]
const hex = (rgb:RGB) => '#' + rgb.map(c=>Math.round(c).toString(16).padStart(2,'0')).join('')

/** Pick representative chromatic clusters; never apply a colour automatically. */
export function paletteFromPixels(pixels:Uint8ClampedArray):string[] {
  const bins = new Map<string,{sum:RGB;count:number}>()
  for(let i=0;i<pixels.length;i+=4){
    const rgb:RGB=[pixels[i],pixels[i+1],pixels[i+2]]
    const high=Math.max(...rgb),low=Math.min(...rgb)
    if(pixels[i+3]<180||high<35||low>235||high-low<18)continue
    const key=rgb.map(c=>Math.floor(c/24)).join(',')
    const bin=bins.get(key)??{sum:[0,0,0] as RGB,count:0}
    rgb.forEach((c,j)=>bin.sum[j]+=c);bin.count++;bins.set(key,bin)
  }
  const ranked=[...bins.values()].map(bin=>{
    const rgb=bin.sum.map(c=>c/bin.count) as RGB
    return {rgb,score:bin.count*(.65+(Math.max(...rgb)-Math.min(...rgb))/255)}
  }).sort((a,b)=>b.score-a.score)
  const chosen:RGB[]=[]
  for(const {rgb} of ranked){
    if(chosen.every(previous=>Math.hypot(...rgb.map((c,i)=>c-previous[i]))>65))chosen.push(rgb)
    if(chosen.length===6)break
  }
  return chosen.map(hex)
}

interface ExtractionOptions { displayedVideoOnly?:boolean; signal?:AbortSignal }

function displayedVideo(scene:ReturnType<typeof resolveScene>):HTMLVideoElement|undefined {
  const sources=[scene.src,scene.intro].filter(Boolean).map(src=>new URL(src!,document.baseURI).href)
  return [...document.querySelectorAll<HTMLVideoElement>('.scene-media video')].find(video=>
    video.closest<HTMLElement>('[data-scene]')?.dataset.scene===scene.id&&sources.includes(video.currentSrc||video.src))
}

// Wait for the visible decoder instead of opening a second one during startup.
// Polling also covers the incoming video being mounted after a scene transition.
function displayedFrame(scene:ReturnType<typeof resolveScene>,signal?:AbortSignal):Promise<HTMLVideoElement> {
  return new Promise((resolve,reject)=>{
    let timer:ReturnType<typeof setTimeout>|undefined
    let finished=false,appPaused=false
    const finish=(error?:Error,video?:HTMLVideoElement)=>{
      if(finished)return
      finished=true;deadline.dispose()
      clearTimeout(timer);signal?.removeEventListener('abort',abort)
      document.removeEventListener('visibilitychange',visibility)
      window.removeEventListener('xinhai-pause',pause)
      window.removeEventListener('xinhai-resume',resume)
      error?reject(error):resolve(video!)
    }
    const deadline=activeFrameDeadline(()=>{
      const video=displayedVideo(scene);return !!video&&video.readyState>=2&&video.videoWidth>0
    },()=>finish(Error('视频画面暂时无法读取，请稍后重试或手动选色。')),VIDEO_COLOR_FRAME_WAIT_MS)
    const abort=()=>finish(new DOMException('取色已取消','AbortError'))
    const check=()=>{
      clearTimeout(timer);timer=undefined
      if(finished)return
      if(signal?.aborted){abort();return}
      if(appPaused||document.hidden){deadline.pause();return}
      const video=displayedVideo(scene)
      if(video?.error){finish(Error('无法读取这段视频的颜色，请手动选色。'));return}
      if(video&&video.readyState>=2&&video.videoWidth>0){finish(undefined,video);return}
      deadline.resume()
      timer=setTimeout(check,100)
    }
    const pause=()=>{appPaused=true;deadline.pause();clearTimeout(timer);timer=undefined}
    const resume=()=>{appPaused=false;check()}
    const visibility=()=>{if(document.hidden)deadline.pause();check()}
    document.addEventListener('visibilitychange',visibility)
    window.addEventListener('xinhai-pause',pause)
    window.addEventListener('xinhai-resume',resume)
    signal?.addEventListener('abort',abort,{once:true});check()
  })
}

export async function extractWallpaperColors(scene:ReturnType<typeof resolveScene>,options:ExtractionOptions={}):Promise<string[]> {
  if(options.signal?.aborted)throw new DOMException('取色已取消','AbortError')
  if(scene.kind==='procedural')throw Error('这个场景没有壁纸图片，请直接选择主题色。')
  const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90
  const ctx=canvas.getContext('2d',{willReadFrequently:true})!
  let dispose=()=>{}
  try{
    let source:CanvasImageSource
    const current=scene.kind==='video'?displayedVideo(scene):undefined
    if(scene.kind==='video'&&(current||options.displayedVideoOnly))source=await displayedFrame(scene,options.signal)
    else if(scene.kind==='video'){
      const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto'
      dispose=()=>{video.pause();video.removeAttribute('src');video.load()}
      await new Promise<void>((resolve,reject)=>{
        const finish=(error?:Error)=>{clearTimeout(timer);video.onloadeddata=null;video.onerror=null;error?reject(error):resolve()}
        const timer=setTimeout(()=>finish(Error('视频画面暂时无法读取，请稍后重试或手动选色。')),10000)
        video.onloadeddata=()=>finish();video.onerror=()=>finish(Error('无法读取这段视频的颜色，请手动选色。'));video.src=scene.src
      })
      source=video
    }else{
      const image=new Image()
      await new Promise<void>((resolve,reject)=>{
        const finish=(error?:Error)=>{clearTimeout(timer);image.onload=null;image.onerror=null;error?reject(error):resolve()}
        const timer=setTimeout(()=>finish(Error('壁纸读取超时，请稍后重试。')),10000)
        image.onload=()=>finish();image.onerror=()=>finish(Error('无法读取壁纸，请重新选择图片。'));image.src=scene.src||scene.poster
      })
      source=image
    }
    if(options.signal?.aborted)throw new DOMException('取色已取消','AbortError')
    ctx.drawImage(source,0,0,canvas.width,canvas.height)
    const colors=paletteFromPixels(ctx.getImageData(0,0,canvas.width,canvas.height).data)
    if(!colors.length)throw Error('这张壁纸以黑白灰为主，可以直接选择喜欢的主题色。')
    return colors
  }catch(error){
    if(error instanceof DOMException&&error.name!=='AbortError')throw Error('这张壁纸暂时无法提取颜色，可以使用取色器手动选择。')
    throw error
  }finally{dispose()}
}
