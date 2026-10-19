import {LearningCategorySelect,LearningCategoryFilter,LearningRecordCategoryEditor,LearningCategoryBadge} from '../components/LearningCategoryControl'
import {useEffect,useRef,useState} from 'react'
import {AnimatePresence,motion} from 'framer-motion'
import GrowthNotes from '../components/GrowthNotes'
import {growthPhrase} from '../lib/growthPresentation'
import {useApp} from '../store/app'
import {useJournal,editJournal,editJournalCategory,returnToJournal,adjustJournal,analyzeJournal,saveJournal} from '../store/journal'
import {DIMENSIONS,DIMENSION_COLORS,DIMENSION_NAMES,type Journal as JournalEntry,type JournalCursor} from '../../../shared/types'
import {COMMERCIAL_EDITION} from '../../../shared/edition'
import {retainGeneratedCopy} from '../lib/generatedCopy'
import '../styles/journal.css'

const GUIDES=['今天完成了什么？','今天遇到了什么困难？','今天帮助了谁？','今天学到了什么？','明天最想继续什么？']
export default function Journal(){
 const latestJournalId=useApp(s=>s.journals[0]?.id),syncVersion=useApp(s=>s.dataSyncVersion)
 const [journals,setJournals]=useState<JournalEntry[]>([]),[query,setQuery]=useState(''),[total,setTotal]=useState<number|null>(null),[matchedTotal,setMatchedTotal]=useState<number|null>(null)
 const [nextCursor,setNextCursor]=useState<JournalCursor|null>(null),[historyLoading,setHistoryLoading]=useState(true),[historyError,setHistoryError]=useState(''),[historyRetry,setHistoryRetry]=useState(0)
 const [categoryFilter,setCategoryFilter]=useState<string|undefined>()
 const historyGeneration=useRef(0),historyLock=useRef(false)
 const {stage,categoryId,content,result,adjusted,error,storageError,dupWarning,saving,message}=useJournal()
 const [expanded,setExpanded]=useState<number|null>(null)
 const [pendingDelete,setPendingDelete]=useState<number|null>(null),[deleting,setDeleting]=useState<number|null>(null),[deleteMessage,setDeleteMessage]=useState('')
 async function loadHistory(cursor:JournalCursor|null,reset:boolean,generation=historyGeneration.current){
  if(!reset&&historyLock.current)return
  historyLock.current=true;setHistoryLoading(true);setHistoryError('')
  try{
   const page=await window.api.listJournalPage({query,cursor,limit:30,...(categoryFilter===undefined?{}:{categoryId:categoryFilter||null})})
   if(generation!==historyGeneration.current)return
   setJournals(old=>reset?page.items:[...old,...page.items.filter(item=>!old.some(existing=>existing.id===item.id))])
   setTotal(page.total);setMatchedTotal(page.matchedTotal);setNextCursor(page.nextCursor)
  }catch(error){if(generation===historyGeneration.current)setHistoryError(error instanceof Error?error.message:String(error))}
  finally{if(generation===historyGeneration.current){historyLock.current=false;setHistoryLoading(false)}}
 }
 useEffect(()=>{
  const generation=++historyGeneration.current
  historyLock.current=true;setHistoryLoading(true);setHistoryError('');setJournals([]);setTotal(null);setMatchedTotal(null);setNextCursor(null);setExpanded(null);setPendingDelete(null)
  const timer=setTimeout(()=>void loadHistory(null,true,generation),180)
  return()=>{clearTimeout(timer);++historyGeneration.current}
 },[query,categoryFilter,latestJournalId,syncVersion,historyRetry])
 async function removeJournal(id:number,ts:number){
  if(deleting!==null)return
  setDeleting(id);setDeleteMessage('')
  try{
   const removed=await window.api.deleteJournal(id,ts,'删除日记')
   setJournals(items=>items.filter(j=>j.id!==id));setTotal(value=>value===null?null:Math.max(0,value-1));setMatchedTotal(value=>value===null?null:Math.max(0,value-1))
   useApp.setState(state=>({journals:state.journals.filter(j=>j.id!==id)}))
   setPendingDelete(null);setExpanded(value=>value===id?null:value)
   setDeleteMessage(removed?'已从日记列表删除。成长分数与成长记录保留。':'这篇日记已经删除，列表已更新。')
  }catch(error){setDeleteMessage(error instanceof Error?error.message:String(error))}finally{setDeleting(null)}
 }
 const journalRoot=useRef<HTMLDivElement>(null)
 useEffect(()=>{
  if(!COMMERCIAL_EDITION)return
  const copy=(event:ClipboardEvent)=>{if(journalRoot.current)retainGeneratedCopy(event,journalRoot.current)}
  document.addEventListener('copy',copy)
  return()=>document.removeEventListener('copy',copy)
 },[])
 const chars=content.trim().length
 return <div className="journal-layout" ref={journalRoot} data-copy-enabled={COMMERCIAL_EDITION||undefined}>
  <main className="journal-main">
   <div className="page-title"><span className="en">JOURNAL</span><span className="zh">{stage==='review'?'日记回响':'简短日记'}</span></div>
   <div className="journal-save-status" role="status">{storageError||message||(content?'草稿已自动保存在本机，可随时离开后继续。':'写下今天值得记住的一刻。')}</div>
   <LearningCategorySelect label="日记学习分类" value={categoryId} onChange={editJournalCategory} disabled={saving||stage==='analyzing'}/>
   <AnimatePresence mode="wait">
    {stage==='write'&&<motion.div key="write" className="journal-editor" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
     <div className="journal-guides">{GUIDES.map(g=><button key={g} className="tag" onClick={()=>editJournal((content?content+'\n':'')+g.replace('？','：'))}><span>{g}</span></button>)}</div>
     <label className="journal-text-label" htmlFor="journal-content">今天的行动与感受</label>
     <textarea id="journal-content" value={content} onChange={e=>editJournal(e.target.value)} placeholder="写下今天的行动与感受，20—800 字。比如：原本不想复习英语，但还是完成了两篇阅读，后来给同学讲了一道数学题……"/>
     {COMMERCIAL_EDITION&&<div className="journal-analysis-info">
      <p>回响在本机整理，无需账号或 API Key。分析时不会将正文发送到云模型，结果可按实际经历调整。</p>
     </div>}
     <div className="journal-actions"><span className={chars>800?'journal-warning':''}>{chars} / 800</span><div className="journal-analysis-buttons">
      <button className="btn primary" onClick={()=>void analyzeJournal(COMMERCIAL_EDITION?'local':undefined)}>{COMMERCIAL_EDITION?'本地分析':'下沉分析'}</button>
     </div></div>
    </motion.div>}
    {stage==='analyzing'&&<motion.div key="analyzing" className="journal-analyzing glass" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} role="status">
     <span className="en-label">LISTENING TO YOUR DAY</span><h2>{COMMERCIAL_EDITION?'正在本地整理回响…':'正在整理今天的回响…'}</h2><p>{content.slice(0,90)}{content.length>90?'…':''}</p><small>通常需要一点时间。可以先去其他页面，回响会留在这里。</small>
    </motion.div>}
    {stage==='review'&&result&&adjusted&&<motion.div key="review" className="journal-review" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
     <section className="glass journal-echo-summary"><span className="en-label">ECHO OF YOUR DAY</span><div className="journal-engine">{result.engine==='llm'?(COMMERCIAL_EDITION?'AI 生成 · 日记回响':'AI 回响'):'本地回响'}</div><h2 data-ai-generated={COMMERCIAL_EDITION&&result.engine==='llm'||undefined}>{result.summary}</h2><p>{result.engine==='llm'&&COMMERCIAL_EDITION?'模型生成的回响可能有错漏，请对照原文核实后再保存；不作心理或医学判断。':'回响依据这篇记录中的行动，供你回看和调整。未提及的经历，不代表没有发生。'}</p></section>
     {result.engine==='local'&&<p className="journal-notice">{result.fallbackReason==='unavailable'?(COMMERCIAL_EDITION?'模型分析暂时不可用，已在本机整理初步结果。若请求已经发出，回退不会撤回已发送的正文。':'模型分析暂时不可用，已在本机整理初步结果。'):'当前使用本地规则整理回响。'}本地规则可能漏判或误判，请对照原文确认，也可在下方按实际经历调整。</p>}
     {result.insufficient&&<p className="journal-notice">记录中的信息还不够充分，可以补充具体经历后重新分析。</p>}
     {dupWarning&&<p className="journal-notice">{dupWarning}</p>}
     <div className="journal-section-heading"><h3>从行动里看见收获</h3><span>{COMMERCIAL_EDITION&&result.engine==='llm'?'AI 辅助分析 · 分数可调整':'可按实际感受调整'}</span></div>
     <div className="journal-dimensions">{DIMENSIONS.map(d=><section key={d} className="journal-dimension glass">
      <div className="journal-dimension-title"><strong style={{color:d==='knowledge'?'color-mix(in srgb, var(--theme-color) 45%, var(--ink))':DIMENSION_COLORS[d]}}>{DIMENSION_NAMES[d]}</strong><GrowthNotes points={adjusted[d]}/><span>{growthPhrase(adjusted[d])}</span></div>
      <p data-ai-generated={COMMERCIAL_EDITION&&result.engine==='llm'||undefined}>{result.reasons[d]||'这篇记录中暂未找到明确依据。'}</p>
      <label>我的收获<select disabled={saving} aria-label={DIMENSION_NAMES[d]+'收获感受'} value={adjusted[d]} onChange={e=>adjustJournal(d,Number(e.target.value))} className="journal-growth-choice">
       {[0,1,2,3,4,5].map(value=><option key={value} value={value}>{['尚未体现','略有收获','有所收获 · 起步','有所收获 · 扎实','收获充实','收获充实 · 突出'][value]}</option>)}
      </select></label>
     </section>)}</div>
     <details className="journal-original glass"><summary>对照日记原文 · {chars} 字</summary><p>{content}</p></details>
     <div className="journal-review-actions"><button className="btn primary" disabled={saving} onClick={()=>void saveJournal()}>{saving?'正在保存…':'留下这份成长'}</button><button className="btn" disabled={saving} onClick={returnToJournal}>继续修改</button>{!COMMERCIAL_EDITION&&result.fallbackReason==='unavailable'&&<button className="btn" disabled={saving} onClick={()=>void analyzeJournal()}>重试 AI 分析</button>}</div>
    </motion.div>}
   </AnimatePresence>
   {error&&<p className="journal-error" role="alert">{error}</p>}
  </main>
  <aside className="journal-history"><div className="journal-section-heading"><h3>ARCHIVE · 全部日记</h3><span>{total===null?'正在读取…':query.trim()?`找到 ${matchedTotal} / 共 ${total} 篇`:`共 ${total} 篇`}</span></div>
   <LearningCategoryFilter value={categoryFilter} onChange={setCategoryFilter}/>
   <label className="journal-history-search">搜索全部日记<input aria-label="搜索全部日记" maxLength={800} value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索正文或回响…"/></label>
   {deleteMessage&&<p className="journal-notice" role="status">{deleteMessage}</p>}
   {historyError&&<p className="journal-notice" role="alert">读取日记失败：{historyError}<button className="btn" disabled={historyLoading} onClick={()=>setHistoryRetry(value=>value+1)}>重新加载日记</button></p>}
   {!historyLoading&&!historyError&&journals.length===0&&<p>{query.trim()?'没有匹配的日记，可以换一个关键词。':'还没有日记。写下第一篇，留下今天的足迹。'}</p>}
   {journals.map(j=><article key={j.id} data-journal-id={j.id} className="glass journal-history-item"><button className="journal-history-toggle" onClick={()=>setExpanded(expanded===j.id?null:j.id)} aria-expanded={expanded===j.id}><time>{new Date(j.ts).toLocaleDateString('zh-CN')}</time><span>{j.engine==='llm'?(COMMERCIAL_EDITION?'AI 生成 · 日记回响':'AI 回响'):'本地回响'} · {expanded===j.id?'收起':'展开'}</span></button><LearningCategoryBadge id={j.categoryId}/>{expanded===j.id&&<LearningRecordCategoryEditor kind="journal" id={j.id} categoryId={j.categoryId} onSaved={()=>setHistoryRetry(n=>n+1)}/>}<p className={expanded===j.id?'':'journal-snippet'}>{j.content}</p>{expanded===j.id&&<blockquote data-ai-generated={COMMERCIAL_EDITION&&j.engine==='llm'||undefined}>{j.summary}</blockquote>}<div className="journal-history-growth">{DIMENSIONS.filter(d=>j.scores[d]>0).map(d=><span key={d} style={{color:DIMENSION_COLORS[d]}}>{DIMENSION_NAMES[d]} <GrowthNotes points={j.scores[d]}/></span>)}</div>{expanded===j.id&&<button className="btn" disabled={deleting!==null||historyLoading} onClick={()=>setPendingDelete(j.id)}>删除这篇日记</button>}{pendingDelete===j.id&&<section className="journal-notice" role="dialog" aria-label="确认删除日记"><strong>确认删除这篇已保存日记？</strong><p>日记列表中的正文与回响将移除。已获得的成长分数与成长记录保留，当前写作草稿不受影响。为防止重复记账，提交历史及同步记录仍可能保留完整正文与回响，并进入之后的新完整备份；已有备份也不会被改写。这不是从所有本机记录中彻底擦除正文。删除会随已启用的局域网同步传播。</p><button className="btn primary" disabled={deleting!==null||historyLoading} onClick={()=>void removeJournal(j.id,j.ts)}>{deleting===j.id?'正在删除…':'确认删除日记'}</button><button className="btn" disabled={deleting!==null} onClick={()=>setPendingDelete(null)}>取消</button></section>}</article>)}
   <div className="journal-history-pagination" role="status"><span>{total===null?'':`已显示 ${journals.length} / ${matchedTotal} 篇`}</span>{historyLoading?<span>正在读取…</span>:nextCursor&&<button className="btn" disabled={deleting!==null} onClick={()=>void loadHistory(nextCursor,false)}>加载更早日记</button>}</div>
  </aside>
 </div>
}
