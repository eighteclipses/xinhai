import {useEffect,useState} from 'react'
import {useApp} from '../store/app'
import {backgroundScenes} from '../lib/scenes'
import {rotationScenes} from '../../../shared/sceneRotation'
import type {BackgroundId} from '../../../shared/types'
import Toggle from './Toggle'
import { COMMERCIAL_EDITION } from '../../../shared/edition'

export default function SceneRotationSettings(){
 const settings=useApp(s=>s.settings),save=useApp(s=>s.setSettings)
 const [unit,setUnit]=useState(settings.autoSceneIntervalSeconds%60===0?'minutes':'seconds')
 const [value,setValue]=useState(String(settings.autoSceneIntervalSeconds/(unit==='minutes'?60:1)))
 const [message,setMessage]=useState('')
 useEffect(()=>{setValue(String(settings.autoSceneIntervalSeconds/(unit==='minutes'?60:1)))},[settings.autoSceneIntervalSeconds])
 const selected=rotationScenes(settings.autoSceneIds,!!settings.customBackground)
 const choices=[...backgroundScenes.map(s=>({id:s.id as BackgroundId,label:s.label})),...(settings.customBackground?[{id:'custom' as const,label:'我的背景 · '+settings.customBackground.name}]:[])]
 async function interval(){const seconds=Number(value)*(unit==='minutes'?60:1);if(!Number.isFinite(seconds)||seconds<10||seconds>86400){setMessage('请输入 10 秒至 24 小时之间的间隔。');return}try{await save({autoSceneIntervalSeconds:Math.round(seconds)});setMessage('间隔已保存，下次切换从现在重新计时。')}catch{setMessage('保存失败，请重试。')}}
 return <section className="glass scene-rotation-settings"><h2>自动切换场景</h2>
  <Toggle on={settings.autoSceneEnabled} onChange={v=>save({autoSceneEnabled:v})} label="开启自动切换" desc="使用当前选定的切换效果；不会暂停或重置专注计时。"/>
  <form className="rotation-interval" onSubmit={e=>{e.preventDefault();void interval()}}><label>每隔<input type="number" aria-label="自动切换间隔" value={value} min={unit==='minutes'?1/6:10} max={unit==='minutes'?1440:86400} step="any" onChange={e=>setValue(e.target.value)}/></label><select aria-label="自动切换时间单位" value={unit} onChange={e=>{const next=e.target.value;setValue(String(Number(value)*(unit==='minutes'?60:1)/(next==='minutes'?60:1)));setUnit(next)}}><option value="seconds">秒</option><option value="minutes">分钟</option></select><button className="btn" type="submit">保存间隔</button></form>
  <label className="rotation-order">切换方式<select aria-label="自动切换方式" value={settings.autoSceneMode} onChange={e=>save({autoSceneMode:e.target.value as 'random'|'sequence'})}><option value="random">随机 · 不连续重复</option><option value="sequence">按下方顺序</option></select></label>
  <h3>在哪里自动切换</h3><Toggle on={settings.autoSceneFocus} onChange={v=>save({autoSceneFocus:v})} label="专注页面" desc="设置、计时和暂停时均可切换"/><Toggle on={settings.autoSceneWallpaper} onChange={v=>save({autoSceneWallpaper:v})} label="欣赏壁纸时" desc="专注计时保留在画面上"/><Toggle on={settings.autoSceneOther} onChange={v=>save({autoSceneOther:v})} label="其他学习页面" desc="共学桌面、待办、日历、习惯、知识库和轨迹"/>
  <details className="rotation-scene-picker"><summary>参与切换的场景 · 已选 {selected.length} 个</summary><div className="rotation-batch"><button type="button" onClick={()=>save({autoSceneIds:choices.map(s=>s.id)})}>全选</button><button type="button" onClick={()=>save({autoSceneIds:backgroundScenes.filter(s=>COMMERCIAL_EDITION?s.collection==='originals':s.hasCharacter).map(s=>s.id as BackgroundId)})}>{COMMERCIAL_EDITION?'只选内置主题':'只选人物场景'}</button>{!COMMERCIAL_EDITION&&<button type="button" onClick={()=>save({autoSceneIds:backgroundScenes.filter(s=>s.collection==='originals').map(s=>s.id as BackgroundId)})}>只选原创主题</button>}<button type="button" onClick={()=>save({autoSceneIds:[]})}>清空</button></div><div>{choices.map(s=><label key={s.id}><input type="checkbox" aria-label={'自动切换场景 '+s.label} checked={selected.includes(s.id)} onChange={e=>save({autoSceneIds:e.target.checked?choices.filter(x=>selected.includes(x.id)||x.id===s.id).map(x=>x.id):selected.filter(id=>id!==s.id)})}/><span>{s.label}</span></label>)}</div></details>
  {selected.length<2&&<p role="status">至少选两个场景后才会自动切换。</p>}
  <p>手动换景会重新计时。后台时间也计入间隔；系统挂起应用后，返回时立即补换一次。设置场景和成长演出期间暂缓显示切换，不会重新等待完整间隔。关闭动态效果时直接换景。</p>{message&&<p role="status">{message}</p>}
 </section>
}
