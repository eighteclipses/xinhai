import {DIMENSIONS,DIMENSION_NAMES,type DimensionId,type EvidenceItem,type ScoreResult} from './types'

// A conservative, editable reflection aid, not a measurement of ability.
// Families prevent synonyms/repetition from manufacturing extra points.
type Rule={id:string;dimension:DimensionId;pattern:RegExp}
const RULES:Rule[]=[
 {id:'study',dimension:'knowledge',pattern:/复习|预习|背(?:了|完)?单词|写(?:了|完)?作业|(?:认真|专心)听(?:了)?(?:课|网课)|学习|学了/g},
 {id:'practice',dimension:'knowledge',pattern:/做(?:了|完)?(?:题|练习|真题|试卷|模拟卷)|刷(?:了|完)?题|订正(?:了)?错题|完成(?:了)?[^，。；\n]{0,8}(?:阅读|练习|题目|错题)/g},
 {id:'understand',dimension:'knowledge',pattern:/搞懂|弄懂|理解了|学会|掌握了|学到/g},
 {id:'writing',dimension:'expression',pattern:/写成|写了(?:一)?篇|写完(?:了)?(?:文章|报告|总结)|总结(?:了|出)|梳理出|整理出|写(?:了|出)(?:一份)?(?:总结|复盘|计划)/g},
 {id:'speaking',dimension:'expression',pattern:/讲解|讲题|讲给|给[^，。；\n]{1,8}讲(?:了|清楚)|发言|演讲|汇报|分享(?:了)?(?:心得|方法|经验|笔记)/g},
 {id:'code',dimension:'craft',pattern:/编程|写(?:了|完|出)?代码|调(?:了)?代码|调试|修(?:好|复)(?:了)?[^，。；\n]{0,10}(?:程序|代码|电脑|问题|故障|bug)|部署(?:了)?(?:应用|网站|服务)|配置(?:了|好)(?:环境|电脑|服务)|调(?:用|通)(?:了)?\s*api/gi},
 {id:'art',dimension:'craft',pattern:/画画|绘画|画(?:了|完)(?:一幅)?[^，。；\n]{0,6}画|练琴|练(?:了)?(?:吉他|钢琴|小提琴)|手工|制作(?:了)?[^，。；\n]{0,8}(?:模型|作品)/g},
 {id:'exercise',dimension:'craft',pattern:/健身|锻炼|跑(?:了)?步|跑了[^，。；\n]{0,8}(?:公里|千米|米)|练(?:了)?(?:力量|投篮)|推胸/g},
 {id:'experiment',dimension:'craft',pattern:/做(?:了|完)?实验|完成(?:了)?实验|搭建(?:了)?(?:电路|模型)|修好(?:了)?(?:自行车|家具)/g},
 {id:'mechanics',dimension:'craft',pattern:/研究(?:了)?(?:游戏)?机制|做(?:了|完)(?:一份)?攻略/g},
 {id:'help',dimension:'care',pattern:/帮(?:助)?|辅导|照顾(?:了)?(?:家人|同学|朋友|父母|妈妈|爸爸|孩子)|安慰|体谅/g},
 {id:'company',dimension:'care',pattern:/陪伴|陪(?:了)?(?:家人|同学|朋友|父母|妈妈|爸爸|孩子|室友)/g},
 {id:'gratitude',dimension:'care',pattern:/感谢|道歉|谢谢/g},
 {id:'selfcare',dimension:'care',pattern:/休息|养病|早睡|放松|照顾自己|对自己好|调节(?:了)?状态|调整(?:了)?作息/g},
]
const FUTURE=/明天|明日|后天|下周|下次|以后|将来|打算|计划(?!表)|准备(?:去|要|在|开始)?|想(?!到|起|通|明白|出)|希望|但愿|决定(?:要|去)|争取|如果|假如|等到|目标是|愿望|应该|需要|记得要|提醒自己|要(?:复习|预习|做题|背|学|写|练|帮|陪|休息)/
const NEGATION=/(?:没有|没能|没法|无法|不能|未能|尚未|并未|未曾|不曾|不想|不愿|不敢|不打算|没|未|别|不要|不)/
const NON_ACTION=/不知道|不清楚|如何|怎么(?:去|做|学|写|练)|只是(?:想|说)|光(?:想|说)|仅仅(?:想|说)|想象|梦见|梦到|喜欢|擅长|能够|可以|有机会|有能力/
const STRUGGLE=/很累|疲惫|疲劳|难受|生病|不舒服|心情不好|低落|困难|遇到阻力|克服|拖延|不想|不愿|害怕|畏难/
const PERSISTENCE=/坚持|克服|没(?:有)?放弃|终于开始|还是|仍然|依然|逼自己/
const ACTUAL=/今天|今日|刚才|上午|下午|晚上|早上|中午|后来|随后|之后|最终|实际|已经|我(?:却|还是|仍然)|我完成/
const PROGRESS=/了|完|好|出|会|懂|掌握|写成|[0-9一二三四五六七八九十两半]+(?:分钟|小时|页|道|篇|章|公里|千米|次|组|遍)|认真|专心|亲手|主动|正在|一直在/
const OTHER_SUBJECT=/^(?:(?:今天|今日|上午|下午|晚上|早上|中午|昨天|后来)\s*)?(?:是)?(?:同学|老师|朋友|室友|他|她|他们|她们|爸爸|妈妈|父母|家人|孩子)(?!给我(?:的|写的))/
const TURN=/^(?:但(?:是)?|不过|可是|然而|后来|随后|之后|最终|实际(?:上)?|结果|接着|而是|却)/
const LEARNING_DISTRACTION=/上课玩|课上玩|上课睡|走神|没听|刷视频|睡着|翻了?两页就放下/

interface Clause {text:string;visible:string;sentenceId:number;future:boolean;negative:boolean;other:boolean;question:boolean;context:string}

function maskQuotes(text:string):string {
 const closes:Record<string,string>={'“':'”','「':'」','『':'』','"':'"','《':'》'}
 let close='',out=''
 for(const c of text){if(close){out+=/\n/.test(c)?c:' '.repeat(c.length);if(c===close)close=''}else if(closes[c]){close=closes[c];out+=' '}else out+=c}
 return out
}

function clauses(text:string):Clause[]{
 const masked=maskQuotes(text),result:Clause[]=[]
 let sentenceId=0
 for(const sentence of masked.matchAll(/[^。！？!?；;\n]+[。！？!?；;\n]?/g)){
  const start=sentence.index!,body=sentence[0],question=/[？?]\s*$/.test(body)
  let future=false,negative=false,other=false
  // A change of time or a contrast starts a new scope; comma lists inherit
  // future/other-person context until an explicit performed action takes over.
  for(const part of body.matchAll(/[^，,、。！？!?；;\n]+/g)){
   const offset=start+part.index!,segments=part[0].split(/(?=但是|但|不过|可是|然而|后来|随后|之后|最终|而是|反而|晚上|下午|上午)/)
   let cursor=offset
   for(const raw of segments){
    const visible=raw.trim(),own=/(?:^|\s)我|(?:但|是|后来|今天)我/.test(visible)
    if(TURN.test(visible)||ACTUAL.test(visible)&&PROGRESS.test(visible)){future=false;negative=false;if(own)other=false}
    if(/^我(?:(?:已经|刚刚|刚才|后来|确实|终于|认真|亲手)地?)?(?:复习了|预习了|做了|做完|写了|写完|背了|背完|完成了|练了|跑了|帮助了|陪了|学会了)/.test(visible))future=false
    // An explicitly performed verb ends an inherited negative list, whereas
    // bare coordinated items ("没有复习、做题、背单词") keep that scope.
    if(own&&PROGRESS.test(visible)||/^(?:我)?(?:做了|做完|写了|写完|背了|背完|完成了|复习了|练了|跑了|帮助了|陪了)/.test(visible))negative=false
    if(OTHER_SUBJECT.test(visible))other=true
    else if(own)other=false
    const firstAction=Math.min(visible.length,...RULES.map(rule=>visible.search(rule.pattern)).filter(index=>index>=0))
    const intentIndex=visible.search(FUTURE)
    if(intentIndex>=0&&intentIndex<=firstAction)future=true
    const prefix=visible.slice(0,firstAction).replace(/没想到|不但|不仅|没(?:有)?放弃|不再拖延/g,'')
    if(NEGATION.test(prefix)&&(firstAction<visible.length||/什么都没|没有做任何|一项都没/.test(prefix)))negative=true
    const leading=raw.length-raw.trimStart().length
    if(visible)result.push({text:text.slice(cursor+leading,cursor+leading+visible.length),visible,sentenceId,future,negative,other,question,context:body})
    if(intentIndex>=0)future=true
    cursor+=raw.length
   }
  }
  sentenceId++
 }
 return result
}

function positive(clause:Clause,index:number,word:string):boolean {
 if(clause.future||clause.negative||clause.other||clause.question)return false
 const before=clause.visible.slice(0,index).replace(/没想到|不但|不仅|没(?:有)?放弃|不再拖延/g,''),after=clause.visible.slice(index+word.length)
 if(NEGATION.test(before)||NON_ACTION.test(before)||FUTURE.test(before))return false
 if(/^(?:任务|作业|这件事)?(?:也|还|却|并|其实|完全|都|根本|一直|仍然|仍)*\s*(?:没|未|不|失败|取消|放弃)/.test(after))return false
 if(/^(?:不上|不了|不动|不下去|不进去|不成)/.test(after))return false
 // Mere topic mentions (e.g. an API advertisement or a programming article)
 // do not demonstrate doing the activity.
 if(/看(?:了|到)?|听说|听(?:了)?|视频|广告|文章|教程|关于|讨论|说到/.test(before)&&!/(?:亲手|动手|跟着|实际|我(?:也|又|开始))/.test(before))return false
 return PROGRESS.test(clause.visible)||/^(?:今天|今日)?(?:我)?(?:还|并|也|又|主动|顺便|接着|而且)?(?:认真|专心)?(?:帮|陪|辅导|感谢|道歉|复习|预习|做题|刷题|编程|写代码|调试|练琴|锻炼|健身)/.test(clause.visible)
}

export function scoreLocal(text:string,minText=20):ScoreResult {
 if(typeof text!=='string'||text.length>30000)throw Error('日记内容无效或过长')
 const minimum=Number.isSafeInteger(minText)&&minText>=0&&minText<=30000?minText:20
 const trimmed=text.trim(),insufficient=trimmed.length<minimum
 const scores=Object.fromEntries(DIMENSIONS.map(d=>[d,0])) as Record<DimensionId,number>
 const reasons=Object.fromEntries(DIMENSIONS.map(d=>[d,insufficient?`文字不足 ${minimum} 字，暂不计分。`:'未识别到明确的已发生行动，可按实际经历调整。'])) as Record<DimensionId,string>
 const evidence:EvidenceItem[]=[],seen=new Set<string>(),seenClauses=new Set<string>(),sentenceDimensions=new Set<string>()
 if(!insufficient)for(const clause of clauses(trimmed)){
  const clauseKey=clause.visible.replace(/\s/g,'')
  if(seenClauses.has(clauseKey))continue
  seenClauses.add(clauseKey)
  const counted=new Set<DimensionId>()
  for(const rule of RULES){
   if(counted.has(rule.dimension)||seen.has(rule.dimension+'.'+rule.id)||sentenceDimensions.has(clause.sentenceId+':'+rule.dimension))continue
   if(rule.dimension==='knowledge'&&LEARNING_DISTRACTION.test(clause.visible))continue
   if(rule.dimension==='knowledge'&&/(?:陪|辅导|教)[^，。]{0,10}(?:同学|室友|朋友|他|她)|给[^，。]{1,8}讲/.test(clause.visible))continue
   for(const match of clause.visible.matchAll(rule.pattern)){
    if(!positive(clause,match.index!,match[0]))continue
    const id=rule.dimension+'.'+rule.id
    const snippet=clause.text.slice(Math.max(0,match.index!-20),Math.max(0,match.index!-20)+100)
    evidence.push({sentenceId:clause.sentenceId,indicatorId:id,evidence:snippet,polarity:'positive',strength:1})
    scores[rule.dimension]=Math.min(3,scores[rule.dimension]+1);counted.add(rule.dimension);seen.add(id);sentenceDimensions.add(clause.sentenceId+':'+rule.dimension);break
   }
  }
  const actualAction=counted.size>0||/(?:完成了|做完了|开始了)[^，。]{1,20}/.test(clause.visible)&&!clause.future&&!clause.other&&!clause.question&&!NEGATION.test(clause.visible.split(/完成了|做完了|开始了/)[0])
  if(!seen.has('will.persistence')&&actualAction&&PERSISTENCE.test(clause.visible)&&STRUGGLE.test(clause.context)){
   evidence.push({sentenceId:clause.sentenceId,indicatorId:'will.persistence',evidence:clause.text.slice(0,100),polarity:'positive',strength:1});scores.will=1;seen.add('will.persistence')
  }
 }
 for(const dimension of DIMENSIONS){
  const found=evidence.filter(item=>item.indicatorId.startsWith(dimension+'.'))
  if(found.length)reasons[dimension]=`依据「${found[0].evidence.slice(0,48)}」${found.length>1?`等 ${found.length} 类行动`:''}；离线初判，可调整。`
 }
 const ranked=DIMENSIONS.filter(d=>scores[d]>0).sort((a,b)=>scores[b]-scores[a])
 return {engine:'local',insufficient,scores,reasons,evidence,summary:insufficient?'文字较少，暂不计分；可以补充具体经历。':ranked.length?`记录中识别到了${ranked.slice(0,2).map(d=>DIMENSION_NAMES[d]).join('与')}相关行动。`:'这篇记录中暂未识别出明确的已发生行动，可按实际经历调整。'}
}
