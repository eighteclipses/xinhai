import {useEffect,useRef,useState} from 'react'
import {AnimatePresence,motion} from 'framer-motion'
import GrowthNotes from '../components/GrowthNotes'
import {growthPhrase} from '../lib/growthPresentation'
import {useApp} from '../store/app'
import {useJournal,editJournal,returnToJournal,adjustJournal,analyzeJournal,saveJournal} from '../store/journal'
import {DIMENSIONS,DIMENSION_COLORS,DIMENSION_NAMES} from '../../../shared/types'
import {COMMERCIAL_EDITION} from '../../../shared/edition'
import {retainGeneratedCopy} from '../lib/generatedCopy'
import '../styles/journal.css'

const GUIDES=['今天完成了什么？','今天遇到了什么困难？','今天帮助了谁？','今天学到了什么？','明天最想继续什么？']
export default function Journal(){
 const journals=useApp(s=>s.journals)
 const {stage,content,result,adjusted,error,storageError,dupWarning,saving,message}=useJournal()
 const [expanded,setExpanded]=useState<number|null>(null)
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
  <aside className="journal-history"><div className="journal-section-heading"><h3>RECENT · 最近日记</h3><span>{journals.length} 篇</span></div>
   {journals.length===0&&<p>还没有日记。写下第一篇，留下今天的足迹。</p>}
   {journals.map(j=><article key={j.id} className="glass journal-history-item"><button className="journal-history-toggle" onClick={()=>setExpanded(expanded===j.id?null:j.id)} aria-expanded={expanded===j.id}><time>{new Date(j.ts).toLocaleDateString('zh-CN')}</time><span>{j.engine==='llm'?(COMMERCIAL_EDITION?'AI 生成 · 日记回响':'AI 回响'):'本地回响'} · {expanded===j.id?'收起':'展开'}</span></button><p className={expanded===j.id?'':'journal-snippet'}>{j.content}</p>{expanded===j.id&&<blockquote data-ai-generated={COMMERCIAL_EDITION&&j.engine==='llm'||undefined}>{j.summary}</blockquote>}<div className="journal-history-growth">{DIMENSIONS.filter(d=>j.scores[d]>0).map(d=><span key={d} style={{color:DIMENSION_COLORS[d]}}>{DIMENSION_NAMES[d]} <GrowthNotes points={j.scores[d]}/></span>)}</div></article>)}
  </aside>
 </div>
}
