import {saveMusicResume} from './musicResume'
import { ONLINE_MUSIC_ENABLED } from '../../../shared/edition'
// One streaming element; switching cancels pending loads and errors discard the element.
export type PlaybackState = 'loading' | 'playing' | 'paused' | 'error'
let current: { audio: HTMLAudioElement; file: string; loading?:boolean; wantsPlay?:boolean; controller?:AbortController; blob?:string; restoreAt?:number } | null = null
let volume = 0.6
let ducking = 1
let generation = 0
let errorMessage = ''
let onTime: ((current:number,duration:number)=>void)|null=null
let lastCheckpoint=0
function checkpoint(force=false){
  if(!current||(!force&&Date.now()-lastCheckpoint<1000))return
  lastCheckpoint=Date.now()
  saveMusicResume({file:current.file,seconds:current.restoreAt??current.audio.currentTime,playing:!!current.wantsPlay})
}
for(const event of ['pagehide','xinhai-pause'])window.addEventListener(event,()=>checkpoint(true))
document.addEventListener('visibilitychange',()=>{if(document.hidden)checkpoint(true)})
function reportTime(){checkpoint();if(current)onTime?.(current.audio.currentTime,Number.isFinite(current.audio.duration)?current.audio.duration:0);else onTime?.(0,0)}
let onEnd: (() => void) | null = null
let onFail: (() => void) | null = null
let onState: ((state: PlaybackState) => void) | null = null
function release(): void {
  generation++
  if (!current) return
  checkpoint(true)
  const { audio,controller,blob } = current
  current = null
  controller?.abort()
  audio.onended = audio.onerror = audio.onwaiting = audio.onplaying = null
  audio.ontimeupdate=audio.onloadedmetadata=audio.ondurationchange=null
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
  if(blob)URL.revokeObjectURL(blob)
  reportTime()
}
function fail(audio: HTMLAudioElement): void {
  if (current?.audio !== audio) return
  release()
  onState?.('error')
  onFail?.()
}
function start(audio: HTMLAudioElement): void {
  const request = ++generation
  onState?.('loading')
  void audio.play().catch(() => {
    // Old play promises can reject after pause or a track switch.
    if (request === generation) fail(audio)
  })
}
export const bgm = {
  get errorMessage(){return errorMessage},
  play(file: string, restoreAt=0, wantsPlay=true): void {
    if(!ONLINE_MUSIC_ENABLED&&file.startsWith('netease:')){release();errorMessage='本版本提供本地音乐，未提供在线音乐接入。';onState?.('error');onFail?.();return}
    if (current?.file === file) {
      current.wantsPlay=true
      checkpoint(true)
      if(current.loading)return
      if (current.audio.paused) start(current.audio)
      return
    }
    release()
    errorMessage=''
    const audio = new Audio()
    current = { audio, file, wantsPlay, restoreAt:Math.max(0,restoreAt) }
    audio.preload = 'metadata'
    audio.volume = volume * ducking
    audio.onended = () => { if (current?.audio === audio) onEnd?.() }
    audio.onerror = () => fail(audio)
    audio.onwaiting = () => {
      if (current?.audio === audio && !audio.paused) onState?.('loading')
    }
    audio.onplaying = () => {
      if (current?.audio !== audio) return
      onState?.('playing')
      // Media playback must not depend on animation frames: they stop in hidden windows.
      audio.volume = volume * ducking
    }
    audio.ontimeupdate=audio.ondurationchange=reportTime
    audio.onloadedmetadata=()=>{
      if(current?.audio!==audio)return
      if(current.restoreAt!==undefined&&Number.isFinite(audio.duration)){
        const offset=Math.min(current.restoreAt,Math.max(0,audio.duration-.1))
        audio.currentTime=offset;delete current.restoreAt
      }
      if(!current.wantsPlay)onState?.('paused')
      reportTime()
    }
    checkpoint(true)
    const src = /^(file:|https:\/\/app\.xinhai\.local\/local\/music\/)/.test(file) ? file : new URL('music/' + encodeURIComponent(file), document.baseURI).href
    // Some Android WebViews stall while probing Ogg ranges from intercepted assets.
    // Bundled tracks are small: a bounded local buffer gives the decoder a seekable source.
    // Imported files keep streaming so large user libraries do not fill memory.
    if(/^netease:[1-9]\d{0,18}$/.test(file)){
      const entry=current;entry.loading=true;onState?.('loading')
      void window.api.neteaseResolve(file.slice(8)).then(url=>{
        if(current!==entry)return
        entry.loading=false;audio.src=url
        if(entry.wantsPlay)start(audio)
      }).catch(e=>{if(current===entry){errorMessage=e instanceof Error?e.message:'网易云连接失败，请重试。';fail(audio)}})
    }else if(location.hostname==='app.xinhai.local'&&!file.includes('/')&&/\.ogg$/i.test(file)){
      const entry=current,controller=new AbortController()
      entry.loading=true;entry.controller=controller;onState?.('loading')
      void (async()=>{
        const response=await fetch(src,{signal:controller.signal})
        if(!response.ok)throw Error('Music asset unavailable')
        // Android may expose an identical Content-Length twice for intercepted assets.
        const lengths=(response.headers.get('content-length')||'').split(',').map(s=>Number(s.trim()))
        const length=lengths[0]
        if(lengths.some(n=>n!==length))throw Error('Inconsistent music length')
        if(!length||length>24*1024*1024)throw Error('Music asset exceeds buffered playback limit')
        const bytes=await response.arrayBuffer()
        if(bytes.byteLength!==length)throw Error('Incomplete music asset')
        if(current!==entry)return
        entry.loading=false;entry.blob=URL.createObjectURL(new Blob([bytes],{type:'audio/ogg'}));audio.src=entry.blob
        if(entry.wantsPlay)start(audio)
      })().catch(()=>{if(current===entry&&!controller.signal.aborted)fail(audio)})
    }else{audio.src=src;if(wantsPlay)start(audio)}
  },
  seek(seconds:number):void {if(current&&Number.isFinite(current.audio.duration)){current.audio.currentTime=Math.max(0,Math.min(current.audio.duration,seconds));delete current.restoreAt;checkpoint(true);reportTime()}},
  setOnTime(cb:((current:number,duration:number)=>void)|null):void {onTime=cb;reportTime()},
  restart(): void {
    if (!current) return
    current.audio.currentTime = 0
    delete current.restoreAt
    current.wantsPlay=true
    checkpoint(true)
    start(current.audio)
  },
  pause(): void {
    generation++
    if(!current)return
    current.wantsPlay=false
    current.audio.pause()
    checkpoint(true)
    onState?.('paused')
  },
  setVolume(value: number): void {
    volume = Math.max(0, Math.min(1, value))
    if (current) current.audio.volume = volume * ducking
  },
  setDucking(value: number): void {
    ducking = Math.max(0,Math.min(1,value))
    if(current) current.audio.volume=volume*ducking
  },
  setOnEnd(cb: (() => void) | null): void { onEnd = cb },
  setOnFail(cb: (() => void) | null): void { onFail = cb },
  setOnState(cb: ((state: PlaybackState) => void) | null): void { onState = cb },
  dispose: release
}
