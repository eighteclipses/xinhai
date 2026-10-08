const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{buildSync}=require('esbuild')
const run=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'xinhai-video-colors-')),compiled=path.join(run,'colors.cjs')
buildSync({entryPoints:[path.resolve('src/renderer/src/lib/wallpaperColors.ts')],bundle:true,platform:'node',format:'cjs',outfile:compiled})
const {extractWallpaperColors}=require(compiled),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const scene={id:'custom',kind:'video',src:'https://app.xinhai.local/local/backgrounds/new.mp4',poster:'poster.png'}
let videos=[],drawn=[],extraDecoders=0
const docEvents=new EventTarget();global.window=new EventTarget()
global.document={baseURI:'https://app.xinhai.local/',querySelectorAll:()=>videos,createElement:tag=>{
 if(tag==='video'){extraDecoders++;throw Error('A second video decoder must not be created')}
 assert.equal(tag,'canvas');return{getContext:()=>({drawImage:source=>drawn.push(source),getImageData:()=>({data:new Uint8ClampedArray([180,30,60,255])})})}
},hidden:false,addEventListener:docEvents.addEventListener.bind(docEvents),removeEventListener:docEvents.removeEventListener.bind(docEvents)}
const video=(src,ready=1)=>({src,currentSrc:src,readyState:ready,videoWidth:ready>=1?640:0,closest:()=>({dataset:{scene:'custom'}}),error:null})
const checks=[]
;(async()=>{
 const loading=video(scene.src);videos=[loading]
 let settled=false;const first=extractWallpaperColors(scene,{displayedVideoOnly:true}).then(value=>{settled=true;return value})
 await wait(50);assert.equal(settled,false,'Metadata must not count as a readable frame');assert.equal(drawn.length,0)
 loading.readyState=2;assert.deepEqual(await first,['#b41e3c']);assert.equal(drawn[0],loading);assert.equal(extraDecoders,0)
 checks.push('metadata-only visible video is awaited and reused without a second decoder')
 drawn=[];const old=video('https://app.xinhai.local/local/backgrounds/old.mp4',4);videos=[old]
 const incoming=extractWallpaperColors(scene,{displayedVideoOnly:true});await wait(50);assert.equal(drawn.length,0)
 const next=video(scene.src,2);videos.push(next);await incoming;assert.deepEqual(drawn,[next]);assert.equal(extraDecoders,0)
 checks.push('same custom scene ID with an old source is not sampled during a transition')
 videos=[];drawn=[];const controller=new AbortController(),cancelled=extractWallpaperColors(scene,{displayedVideoOnly:true,signal:controller.signal})
 controller.abort();await assert.rejects(cancelled,error=>error.name==='AbortError');assert.equal(drawn.length,0);assert.equal(extraDecoders,0)
 checks.push('scene cancellation stops the wait without sampling or opening media')
 const realNow=performance.now.bind(performance),realDate=Date.now;let offset=0
 global.performance={now:()=>realNow()+offset};Date.now=()=>realDate()+offset
 const delayed=video(scene.src);videos=[delayed]
 const afterBackground=extractWallpaperColors(scene,{displayedVideoOnly:true}).catch(error=>({error}))
 await wait(30);window.dispatchEvent(new Event('xinhai-pause'));offset=30000;await wait(120)
 window.dispatchEvent(new Event('xinhai-resume'));delayed.readyState=2
 assert.deepEqual(await afterBackground,['#b41e3c']);assert.equal(extraDecoders,0)
 Date.now=realDate;offset=0
 checks.push('30 seconds in the background does not exhaust the visible-video color wait')
 const broken=video(scene.src);broken.error={code:3};videos=[broken]
 await assert.rejects(extractWallpaperColors(scene,{displayedVideoOnly:true}),/无法读取/);assert.equal(extraDecoders,0)
 checks.push('visible decoder failure is reported without opening another decoder')
 fs.writeFileSync(path.join(run,'result.json'),JSON.stringify({ok:true,run,checks,scope:'DOM contract tests; actual APK playback is verified separately'},null,2)+'\n')
 console.log(JSON.stringify({ok:true,result:path.join(run,'result.json'),checks:checks.length}))
})().catch(error=>{console.error(error);process.exitCode=1})
