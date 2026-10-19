import {useEffect,useState} from 'react'
import type {LearningCategorySummary} from '../../../shared/learningCategories'
import {useApp} from '../store/app'
import {useLearningCategories} from '../store/learningCategories'
import {LearningCategoryFilter,LearningCategoryBadge} from './LearningCategoryControl'
import LearningCategoryManager from './LearningCategoryManager'
export default function LearningCategoryStats(){
 const dataRevision=useApp(s=>s.dataRevision),sync=useApp(s=>s.dataSyncVersion),reset=useApp(s=>s.dataResetVersion),{revision}=useLearningCategories()
 const [rows,setRows]=useState<LearningCategorySummary[]>([]),[filter,setFilter]=useState<string|undefined>(),[error,setError]=useState(''),[retry,setRetry]=useState(0)
 useEffect(()=>{let live=true;setError('');void window.api.learningCategorySummary().then(result=>{if(live)setRows(result)}).catch(e=>{if(live)setError(e instanceof Error?e.message:'分类统计读取失败')});return()=>{live=false}},[dataRevision,sync,reset,revision,retry])
 return <div className="learning-category-overview"><LearningCategoryManager/><section className="glass learning-category-statistics" aria-label="全库学习分类统计"><h2>按分类回看积累</h2><p>覆盖全部已保存记录。旧记录保持未分类，可在历史明细中逐条指定。专注时长不含暂停，旧记录保留分钟精度。打卡与复习次数按发生时的分类累计。</p><LearningCategoryFilter value={filter} onChange={setFilter}/>{error?<p role="alert">{error}<button className="btn" onClick={()=>setRetry(n=>n+1)}>重试</button></p>:<div className="learning-category-table-scroll"><table><thead><tr><th>学习分类</th><th>专注</th><th>待办完成 / 总数</th><th>习惯 / 打卡</th><th>日记</th><th>复习卡 / 复习</th><th>日历安排</th></tr></thead><tbody>{rows.filter(r=>filter===undefined||(r.categoryId??'')===filter).map(r=><tr key={r.categoryId??'unclassified'}><th><LearningCategoryBadge id={r.categoryId}/></th><td>{Math.floor(r.focusSeconds/3600)} 时 {Math.floor(r.focusSeconds/60)%60} 分 {r.focusSeconds%60} 秒<small>{r.focusSessions} 段{r.legacyFocusSessions?` · ${r.legacyFocusSessions} 段旧记录`:''}</small></td><td>{r.completedTodos} / {r.todos}</td><td>{r.habits} / {r.habitLogs}</td><td>{r.journals}</td><td>{r.reviewCards} / {r.reviewLogs}</td><td>{r.events}</td></tr>)}</tbody></table></div>}</section></div>
}
