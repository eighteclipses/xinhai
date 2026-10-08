const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{buildSync}=require('esbuild')
const run=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'xinhai-video-first-frame-'))
const code=buildSync({entryPoints:[path.resolve('src/renderer/src/lib/videoFrameWait.ts')],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text
let now=0,nextId=0;const timers=new Map(),moduleValue={exports:{}}
vm.runInNewContext(code,{module:moduleValue,exports:moduleValue.exports,performance:{now:()=>now},setTimeout:(fn,ms)=>{const id=++nextId;timers.set(id,{fn,at:now+ms});return id},clearTimeout:id=>timers.delete(id)})
const {firstVideoFrameDeadline,VIDEO_FIRST_FRAME_WAIT_MS}=moduleValue.exports
const advance=ms=>{const target=now+ms;for(;;){const next=[...timers].filter(([,v])=>v.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn()}now=target}
const video=()=>{const handlers=new Map();return{readyState:0,videoWidth:640,addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:(name,fn)=>{if(handlers.get(name)===fn)handlers.delete(name)},emit:name=>handlers.get(name)?.()}}
const checks=[]
{
 let failures=0;const v=video();v.readyState=2;v.videoWidth=0
 const deadline=firstVideoFrameDeadline(v,()=>failures++);deadline.resume();v.emit('loadeddata');advance(VIDEO_FIRST_FRAME_WAIT_MS);assert.equal(failures,1);deadline.dispose()
 checks.push('a data event without video dimensions does not count as a visible first frame')
}
{
 let failures=0;const v=video(),deadline=firstVideoFrameDeadline(v,()=>failures++)
 deadline.resume();advance(8000);assert.equal(failures,0);v.readyState=1;advance(4000);assert.equal(failures,0)
 v.readyState=2;v.emit('loadeddata');advance(60000);assert.equal(failures,0);deadline.dispose()
 checks.push('valid first frame at 12 seconds survives the former 8-second cutoff')
}
{
 let failures=0;const v=video(),deadline=firstVideoFrameDeadline(v,()=>failures++)
 deadline.resume();advance(6000);deadline.pause();advance(60000);assert.equal(failures,0)
 deadline.resume();advance(VIDEO_FIRST_FRAME_WAIT_MS-6001);assert.equal(failures,0);advance(1);assert.equal(failures,1)
 advance(60000);assert.equal(failures,1);deadline.dispose()
 checks.push('background suspension spends no first-frame budget; unreadable media times out once after 20 foreground seconds')
}
{
 let failures=0;const v=video();v.readyState=2;const deadline=firstVideoFrameDeadline(v,()=>failures++)
 deadline.resume();v.readyState=1;advance(60000);deadline.resume();advance(60000);assert.equal(failures,0);deadline.dispose()
 checks.push('a later buffering dip cannot reclassify an already readable video as a failed startup')
}
{
 let failures=0;const v=video(),deadline=firstVideoFrameDeadline(v,()=>failures++)
 deadline.resume();advance(1000);deadline.dispose();advance(60000);assert.equal(failures,0);assert.equal(timers.size,0)
 checks.push('scene disposal cancels pending callbacks')
}
fs.writeFileSync(path.join(run,'result.json'),JSON.stringify({ok:true,run,checks,scope:'deterministic timer and media-event contract; actual APK acceptance separate'},null,2)+'\n')
console.log(JSON.stringify({ok:true,result:path.join(run,'result.json'),checks:checks.length}))
