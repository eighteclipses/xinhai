const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'..'),dir=path.join(root,'design-review/offline-scoring-0.2.23')
fs.mkdirSync(dir,{recursive:true})
function source(file){const built=require('esbuild').buildSync({entryPoints:[path.join(root,file)],bundle:true,platform:'node',format:'cjs',write:false});const filename=path.join(dir,'fixture.cjs'),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;mod._compile(built.outputFiles[0].text,filename);return mod.exports}
const candidate=source('src/shared/localScoring.ts')
const baselineFile=path.join(dir,'baseline-0.2.22.json')
const baseline=fs.existsSync(baselineFile)?JSON.parse(fs.readFileSync(baselineFile,'utf8')):{cases:[]}
const cases=[
 {id:'plan',text:'今天只是列了明天的计划：明天打算复习数学、做题、背单词，今天一项都没有开始。',zero:['knowledge','will','expression','care','craft']},
 {id:'mixed',text:'今天上午上课走神。晚上认真复习数学两小时，完成了错题订正并能独立说明解法。',positive:['knowledge']},
 {id:'completed',text:'今天晚上认真复习数学两小时，完成了错题订正并能独立说明解法。',positive:['knowledge']},
 {id:'negation',text:'今天没有认真复习数学，也没能开始做题，背单词这件事也完全没有进行。',zero:['knowledge','will']},
 {id:'negation_then_success',text:'今天上午没复习，后来我认真复习了数学并弄懂一道错题，终于有了收获。',positive:['knowledge']},
 {id:'partial',text:'今天复习了两章，只做完一半练习，虽然还没有全部完成，但已经弄懂之前卡住的概念。',positive:['knowledge']},
 {id:'other',text:'今天同学复习了数学，做完了真题，还给室友讲解了解法，我只在旁边听着。',zero:['knowledge','expression','care']},
 {id:'quotation',text:'今天看到一句话：“坚持复习，写代码，帮助同学”，我只是抄下这句话，还没有行动。',zero:['knowledge','will','expression','care','craft']},
 {id:'rest',text:'今天身体不舒服，我主动休息了半天，调整了作息，没有继续熬夜消耗自己。',positive:['care'],zero:['knowledge','craft']},
 {id:'game',text:'今天玩游戏看到角色力量变强，广告说这个API可以自动解决问题，我并没有亲手制作任何东西。',zero:['craft','knowledge','will']},
 {id:'effort',text:'今天很累，本来不想动，但我还是认真复习了两小时，完成了数学练习。',positive:['knowledge','will']},
 {id:'help',text:'今天我帮助同学整理资料，还给他讲解了两道题，他后来能独立完成练习了。',positive:['care','expression']},
 {id:'code',text:'今天我亲手写完代码，调试了程序并修好了故障，之后已经完成了项目的部署。',positive:['craft']},
 {id:'post_failure',text:'今天复习任务没有开始，健身也没有进行，只是在日记里记录一下这些未完成事项。',zero:['knowledge','craft','will']},
 {id:'short',text:'我复习了。',zero:['knowledge','will','expression','care','craft']},
 {id:'negative-list',text:'今天没有复习、做题、背单词，也没有写作业，这些事情一项都没开始。',zero:['knowledge','will','expression','care','craft']},
 {id:'negative-list-completed',text:'今天没有复习，做了题并完成两道练习，之后又认真整理了书桌。',positive:['knowledge']},
 {id:'quote-emoji-offset',text:'“🙂复习只是一个愿望”，后来我复习了两小时，还弄懂之前没学会的概念。',positive:['knowledge']},
 {id:'bare-contrast',text:'今天我没做题但复习了数学两小时，这部分内容终于比之前更清楚了。',positive:['knowledge']},
 {id:'past-before-plan',text:'今天我复习了两小时并打算明天去练琴，不过这些未来的事情还没有做。',positive:['knowledge'],zero:['craft']},
 {id:'performed-after-intention',text:'我准备复习数学，我复习了英语并记下了错题，晚上整理了书桌。',positive:['knowledge']},
 {id:'code-after-intention',text:'我打算写代码，我写了代码并修好了程序，晚上记录了结果。',positive:['craft']},
 {id:'thought-is-not-persistence',text:'今天我很累，心情低落，认真地想坚持复习，但最后没有行动。',zero:['knowledge','will','expression','care','craft']},
 {id:'thought-is-not-action',text:'今天我很累，心情很低落，认真地想复习数学，最后没有采取任何行动。',zero:['knowledge','will','expression','care','craft']},
 {id:'ui-completed-multiple',text:'上午上课走神。晚上我很累，但还是认真复习了数学两小时。后来我给同学讲解了错题，还帮助他整理资料。今天我亲手调试了程序并修好了代码。',positive:['knowledge','will','expression','care','craft']},
]
// This public regression set uses only the synthetic examples in this file.
fs.mkdirSync(dir,{recursive:true})
const results=cases.map(c=>{const actual=candidate.scoreLocal(c.text),old=baseline.cases.find(b=>b.id===c.id&&b.text===c.text)?.scores,failures=[];for(const d of c.zero||[])if(actual.scores[d]!==0)failures.push(`${d} expected zero`);for(const d of c.positive||[])if(actual.scores[d]<=0)failures.push(`${d} expected positive`);for(const d of c.maxOne||[])if(actual.scores[d]>1)failures.push(`${d} repeated one event`);return {...c,old,actual,failures}})
const mixed=results.find(x=>x.id==='mixed').actual.scores.knowledge,completed=results.find(x=>x.id==='completed').actual.scores.knowledge
assert.equal(mixed,completed,'irrelevant negative sentence must not reduce later completed learning')
const once=candidate.scoreLocal('今天我认真复习了数学两小时，学习过程中记下了关键步骤。'),repeat=candidate.scoreLocal('今天我认真复习了数学两小时，今天我认真复习了数学两小时，今天我认真复习了数学两小时。')
assert.equal(once.scores.knowledge,repeat.scores.knowledge,'repeating one activity must not multiply points')
for(const r of results){for(const score of Object.values(r.actual.scores))assert.ok(Number.isInteger(score)&&score>=0&&score<=3);for(const e of r.actual.evidence)assert.ok(r.text.includes(e.evidence),'evidence must come from input')}
const report={ok:results.every(r=>!r.failures.length),scope:'synthetic behavior regression; not human gold accuracy',sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'src/shared/localScoring.ts'))).digest('hex'),results}
for(const r of results)console.log(r.failures.length?'FAIL':'PASS',r.id,JSON.stringify(r.actual.scores),r.failures.join('; '))
async function entryChecks(){
 const {scoreJournal}=source('src/main/scoring.ts'),text='今天上午上课走神。晚上认真复习数学两小时，完成了错题订正并能独立说明解法。'
 let requests=0
 const client={status:async()=>({endpoint:'https://fixture.invalid',model:'fixture',available:true,configured:false,message:''}),request:async()=>{requests++;throw Error('fixture network failure')}}
 const offline=await scoreJournal(text,client);assert.equal(offline.fallbackReason,'not-configured');assert.equal(requests,0);assert.deepEqual(offline.scores,candidate.scoreLocal(text).scores)
 client.status=async()=>({endpoint:'https://fixture.invalid',model:'fixture',available:true,configured:true,message:''})
 const failure=await scoreJournal(text,client);assert.equal(failure.fallbackReason,'unavailable');assert.equal(requests,1);assert.deepEqual(failure.scores,offline.scores)
 assert.equal(JSON.stringify(failure).includes('fixture network failure'),false)
 await assert.rejects(scoreJournal('x'.repeat(30001),client));assert.equal(requests,1)
 report.entryChecks={unconfiguredMadeNoRequest:true,unavailableModelUsedSameLocalRules:true,inputLimitRejectedBeforeRequest:true}
}
entryChecks().catch(error=>{report.ok=false;report.error=String(error.stack||error);console.error(error)}).finally(()=>{fs.writeFileSync(path.join(dir,'local-results.json'),JSON.stringify(report,null,2)+'\n');if(!report.ok)process.exitCode=1})
