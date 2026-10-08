const {buildSync}=require('esbuild'),assert=require('node:assert/strict'),Module=require('module')
const built=buildSync({entryPoints:['src/shared/sceneMotion.ts'],bundle:true,platform:'node',format:'cjs',write:false})
const mod=new Module(__filename,module);mod._compile(built.outputFiles[0].text,__filename)
const {sampleCardPose,sampleSceneReveal,sampleSpring,CARD_WAVE_SECONDS}=mod.exports
const normal={width:1440,height:900,reducedMotion:false,compact:false},compact={...normal,width:1180,compact:true}
assert.deepEqual(sampleCardPose(.5,{row:0,column:0},[],normal),{y:0,rotate:0,scale:1})
assert.deepEqual(sampleCardPose(.5,{row:0,column:0},[{at:0,origin:{row:0,column:0},strength:1}],{...normal,reducedMotion:true}),{y:0,rotate:0,scale:1})
const origin=sampleCardPose(.15,{row:0,column:0},[{at:0,origin:{row:0,column:0},strength:1}],normal)
const neighbor=sampleCardPose(.15,{row:0,column:1},[{at:0,origin:{row:0,column:0},strength:1}],normal)
assert.ok(origin.y!==0||neighbor.y!==0,'wave should affect a selected cell and propagate to a neighbor')
for(const t of [0,.1,.3,.6,.95,1.2]){const pose=sampleCardPose(t,{row:12,column:2},[{at:0,origin:{row:12,column:2},strength:99}],normal);assert.ok(Math.abs(pose.y)<=6.001&&Math.abs(pose.rotate)<=1.201)}
const interrupted=sampleSpring({value:.7,velocity:-2},1,.1);const resumed=sampleSpring(interrupted,0,.1);assert.ok(Number.isFinite(resumed.value)&&Number.isFinite(resumed.velocity))
const desktop=sampleSceneReveal(.2,normal),small=sampleSceneReveal(.2,compact)
assert.match(desktop.clipPath,/^circle\(/);assert.ok(desktop.bandPath.length>20&&desktop.crestPath.length>20&&desktop.trailPath.length>20);assert.ok(small.progress>desktop.progress)
assert.equal(sampleSceneReveal(1.3,normal).done,true);assert.equal(sampleSceneReveal(.2,{...normal,reducedMotion:true}).done,true)
console.log('PASS deterministic card lift/neighbor propagation, bounded pose, interrupted spring, desktop/compact curved reveal and reduced-motion final state')
