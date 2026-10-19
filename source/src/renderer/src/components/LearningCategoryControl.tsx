import {useState} from 'react'
import {useLearningCategories,refreshLearningCategories} from '../store/learningCategories'
import {useApp} from '../store/app'
import type {LearningRecordKind} from '../../../shared/learningCategories'
import '../styles/learning-categories.css'
export function LearningCategorySelect({value,onChange,disabled=false,label='学习分类'}:{value:string|null|undefined;onChange:(id:string|null)=>void;disabled?:boolean;label?:string}){
 const {categories,error,loaded}=useLearningCategories()
 return <label className="learning-category-select">{label}<select aria-label={label} value={value??''} disabled={disabled||!loaded} onChange={e=>onChange(e.target.value||null)}><option value="">未分类</option>{categories.filter(c=>c.archivedAt===null||c.id===value).map(c=><option key={c.id} value={c.id}>{c.name}{c.archivedAt!==null?'（已停用）':''}</option>)}{value&&!categories.some(c=>c.id===value)&&<option value={value}>原分类暂不可用</option>}</select>{loaded&&!categories.length&&<small>可在“轨迹”的“学习分类”中新增。</small>}{error&&<small role="alert">{error}<button type="button" onClick={()=>void refreshLearningCategories().catch(()=>undefined)}>重试</button></small>}</label>
}
export function LearningCategoryFilter({value,onChange,label='按学习分类筛选'}:{value:string|undefined;onChange:(id:string|undefined)=>void;label?:string}){
 const {categories}=useLearningCategories()
 return <label className="learning-category-select">{label}<select aria-label={label} value={value===undefined?'all':value} onChange={e=>onChange(e.target.value==='all'?undefined:e.target.value)}><option value="all">全部学习分类</option><option value="">未分类</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}{c.archivedAt!==null?'（已停用）':''}</option>)}</select></label>
}
export function LearningCategoryBadge({id}:{id:string|null|undefined}){
 const {categories}=useLearningCategories(),category=categories.find(c=>c.id===id)
 return <span className="learning-category-badge"><i style={{backgroundColor:category?.color??'#94A3B8'}}/>{category?.name??(id?'分类暂不可用':'未分类')}{category?.archivedAt!==null&&category?.archivedAt!==undefined?' · 已停用':''}</span>
}
export function LearningRecordCategoryEditor({kind,id,categoryId,onSaved}:{kind:LearningRecordKind;id:string|number;categoryId:string|null|undefined;onSaved?:()=>void}){
 const [editing,setEditing]=useState(false),[value,setValue]=useState<string|null>(categoryId??null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 async function save(){setBusy(true);setError('');try{await window.api.learningRecordCategorySet({kind,id,categoryId:value,expectedCategoryId:categoryId??null});await useApp.getState().refresh();setEditing(false);onSaved?.()}catch(e){setError(e instanceof Error?e.message:'分类未保存')}finally{setBusy(false)}}
 return <div className="learning-record-category"><LearningCategoryBadge id={categoryId}/>{editing?<><LearningCategorySelect value={value} onChange={setValue} disabled={busy} label="修改记录学习分类"/><button type="button" className="btn" disabled={busy} onClick={()=>void save()}>保存分类</button><button type="button" className="btn" disabled={busy} onClick={()=>setEditing(false)}>取消</button></>:<button type="button" className="btn" onClick={()=>{setValue(categoryId??null);setEditing(true)}}>修改分类</button>}{error&&<small role="alert">{error}</small>}</div>
}
