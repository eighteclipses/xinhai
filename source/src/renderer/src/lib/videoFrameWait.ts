export const VIDEO_FIRST_FRAME_WAIT_MS = 20_000
// Scene transitions can mount the incoming video shortly after extraction starts.
export const VIDEO_COLOR_FRAME_WAIT_MS = VIDEO_FIRST_FRAME_WAIT_MS + 2_000

/** A bounded first-frame wait that spends time only while the scene is active. */
export function activeFrameDeadline(isReadable:()=>boolean,onTimeout:()=>void,budget=VIDEO_FIRST_FRAME_WAIT_MS){
  let remaining=budget,started=0
  let timer:ReturnType<typeof setTimeout>|undefined
  let finished=false,disposed=false
  const pause=()=>{
    if(timer===undefined)return
    clearTimeout(timer);timer=undefined
    remaining=Math.max(0,remaining-(performance.now()-started))
  }
  const readable=()=>{
    if(!isReadable())return false
    pause();finished=true;return true
  }
  const resume=()=>{
    if(disposed||finished||readable()||timer!==undefined)return
    started=performance.now()
    timer=setTimeout(()=>{
      timer=undefined;remaining=0
      if(disposed||finished||readable())return
      finished=true;onTimeout()
    },remaining)
  }
  return{resume,pause,dispose:()=>{disposed=true;pause()}}
}

export function firstVideoFrameDeadline(video:HTMLVideoElement,onTimeout:()=>void){
  const deadline=activeFrameDeadline(()=>video.readyState>=2&&video.videoWidth>0,onTimeout)
  const readable=()=>{if(video.readyState>=2&&video.videoWidth>0)deadline.resume()}
  video.addEventListener('loadeddata',readable)
  return{resume:deadline.resume,pause:deadline.pause,dispose:()=>{deadline.dispose();video.removeEventListener('loadeddata',readable)}}
}
