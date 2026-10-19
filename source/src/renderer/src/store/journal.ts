import {create} from 'zustand'
import {DIMENSIONS,type DimensionId,type ScoreResult} from '../../../shared/types'
import {useApp} from './app'
import type {JournalAnalysisMode} from '../../../shared/modelConfig'
import {COMMERCIAL_EDITION} from '../../../shared/edition'

const key='xinhai-journal-draft-v1'
type Draft={categoryId:string|null;token:string;content:string;result:ScoreResult|null;adjusted:Record<DimensionId,number>|null;dupWarning:string}
type State=Draft&{stage:'write'|'analyzing'|'review';analysisMode:JournalAnalysisMode|null;saving:boolean;error:string;storageError:string;message:string}
const fresh=():Draft=>({categoryId:null,token:crypto.randomUUID(),content:'',result:null,adjusted:null,dupWarning:''})
function read():Draft {
 try{
  const d=JSON.parse(localStorage.getItem(key)||'null')
  if(!d||typeof d.content!=='string'||typeof d.token!=='string')return fresh()
  const valid=d.result&&['llm','local'].includes(d.result.engine)&&typeof d.result.summary==='string'&&DIMENSIONS.every(k=>Number.isFinite(d.result.scores?.[k])&&typeof d.result.reasons?.[k]==='string'&&Number.isInteger(d.adjusted?.[k])&&d.adjusted[k]>=0&&d.adjusted[k]<=5)
  return {categoryId:typeof d.categoryId==='string'?d.categoryId:null,token:d.token,content:d.content,result:valid?d.result:null,adjusted:valid?d.adjusted:null,dupWarning:typeof d.dupWarning==='string'?d.dupWarning:''}
 }catch{return fresh()}
}
const initial=read()
export const useJournal=create<State>(()=>({...initial,stage:initial.result?'review':'write',analysisMode:null,saving:false,error:'',storageError:'',message:''}))
function update(patch:Partial<State>):boolean {
 const next={...useJournal.getState(),...patch}
 try{
  const {token,content,result,adjusted,dupWarning,categoryId}=next
  localStorage.setItem(key,JSON.stringify({token,content,result,adjusted,dupWarning,categoryId}))
  useJournal.setState({...patch,storageError:''});return true
 }catch{
  useJournal.setState({...patch,storageError:'本机草稿保存失败，请先复制正文备份，避免关闭应用后丢失。'});return false
 }
}
export function editJournalCategory(categoryId:string|null){if(!useJournal.getState().saving)update({categoryId})}
export function editJournal(content:string){
 if(useJournal.getState().saving||useJournal.getState().stage==='analyzing')return
 update({content,result:null,adjusted:null,stage:'write',error:'',message:'',dupWarning:''})
}
export function returnToJournal(){if(!useJournal.getState().saving)update({stage:'write',result:null,adjusted:null,error:''})}
export function adjustJournal(d:DimensionId,value:number){const s=useJournal.getState();if(s.adjusted&&!s.saving)update({adjusted:{...s.adjusted,[d]:value}})}
function similarity(a:string,b:string):number{
 const grams=(s:string)=>{const t=s.replace(/\s/g,'');return new Set(Array.from({length:Math.max(0,t.length-2)},(_,i)=>t.slice(i,i+3)))}
 const x=grams(a),y=grams(b),common=[...x].filter(g=>y.has(g)).length
 return common/Math.max(1,x.size+y.size-common)
}
export async function analyzeJournal(mode?:JournalAnalysisMode){
 const s=useJournal.getState(),chars=s.content.trim().length
 if(s.stage==='analyzing'||s.saving)return
 if(chars<20||chars>800){update({error:chars<20?'请写 20 字以上，让回响有具体经历可参考。':'请将日记控制在 800 字以内。'});return}
 update({stage:'analyzing',analysisMode:mode??(COMMERCIAL_EDITION?'local':null),error:'',message:''})
 try{
  const result=await window.api.scoreJournal(s.content,mode) as ScoreResult
  if(!result||!DIMENSIONS.every(d=>Number.isFinite(result.scores?.[d])&&typeof result.reasons?.[d]==='string'))throw Error('invalid analysis')
  const dup=useApp.getState().journals.slice(0,10).some(j=>similarity(j.content,s.content)>0.5)
  update({result,adjusted:dup?Object.fromEntries(DIMENSIONS.map(d=>[d,0])) as Record<DimensionId,number>:{...result.scores},dupWarning:dup?'与最近的日记较相似，本次成长默认不重复记录；你仍可按实际经历调整。':'',stage:'review'})
 }catch{update({stage:'write',error:'暂时未能完成分析，草稿已保留，可以重试。'})}
}
export async function saveJournal(){
 const s=useJournal.getState()
 if(s.saving||!s.result||!s.adjusted)return
 // Ensure the retry token survives a process restart before committing anything.
 if(!update({saving:true,error:''})){useJournal.setState({saving:false});return}
 try{
  const saved=await window.api.commitJournal({categoryId:s.categoryId,token:s.token,content:s.content,scores:s.adjusted,summary:s.result.summary,engine:s.result.engine})
  update({...fresh(),stage:'write',saving:false,message:'日记已保存。'})
  useApp.setState(a=>({journals:[saved.journal,...a.journals.filter(j=>j.id!==saved.journal.id)]}))
  void useApp.getState().receiveGrowth(saved.growth).catch(()=>undefined)
 }catch{update({saving:false,error:'保存未完成，正文和回响仍保留。请重试保存，不会重复记入成长。'})}
}
