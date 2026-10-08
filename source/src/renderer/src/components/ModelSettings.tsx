import {useEffect,useRef,useState} from 'react'
import {chatEndpoint} from '../../../shared/llmEndpoint'
import type {ModelStatus} from '../../../shared/modelConfig'
import {useApp} from '../store/app'
import {COMMERCIAL_EDITION} from '../../../shared/edition'

export default function ModelSettings(){
 const [status,setStatus]=useState<ModelStatus|null>(null),[endpoint,setEndpoint]=useState(''),[model,setModel]=useState('deepseek-chat'),[key,setKey]=useState('')
 const [busy,setBusy]=useState(''),[message,setMessage]=useState(''),lock=useRef(false)
 const apply=(next:ModelStatus)=>{setStatus(next);setEndpoint(next.endpoint);setModel(next.model);setKey('')}
 useEffect(()=>{let live=true;void window.api.modelStatus().then(next=>{if(live)apply(next)}).catch(()=>{if(live)setMessage('模型配置暂时无法读取，可以重试；离线学习功能仍可使用。')});return()=>{live=false}},[])
 async function run(action:string,work:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(action);setMessage('');try{await work()}catch(error){setMessage(error instanceof Error?error.message.replace(/^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/,''):'模型配置操作未完成，请重试。')}finally{lock.current=false;setBusy('')}}
 let resolved='',addressError=''
 try{resolved=chatEndpoint(endpoint)}catch(error){addressError=error instanceof Error?error.message:'地址无效'}
 const dirty=!!key||!!status&&(endpoint!==status.endpoint||model!==status.model)
 if(COMMERCIAL_EDITION)return <section className="glass model-settings" style={{padding:'22px 26px'}} aria-labelledby="model-settings-heading">
  <h2 id="model-settings-heading" style={{fontSize:14,letterSpacing:'.12em',fontWeight:500,margin:'0 0 14px'}}>日记 · 本地分析</h2>
  <p className="scene-hint">无需账号或 API Key。日记回响由本机规则整理，分析时不会把正文发送到云模型；结果可以按实际经历调整。</p>
  <details>
   <summary>旧测试版模型配置</summary>
   <p className="scene-hint">本版本已关闭云模型接入。旧密钥保留在本机保护存储中，不会用于请求；移除配置不会删除日记或改变历史 AI 来源标记。</p>
   <p role="status">{status?(status.configured?'检测到旧模型配置，可在下方移除。':'未检测到可用的旧模型密钥。'):'正在检查旧配置…'}</p>
   {status?.message&&/无法|失败|重试|损坏|不可用/.test(status.message)&&<p role="status">{status.message}</p>}
   <div style={{display:'flex',flexWrap:'wrap',gap:10}}>
    <button className="btn" disabled={!!busy||!status} onClick={()=>void run('clear',async()=>{apply(await window.api.modelClear());await useApp.getState().refresh();setMessage('已移除本机旧模型配置，学习记录已保留。')})}>{busy==='clear'?'正在移除…':'移除旧模型配置'}</button>
    <button className="btn" disabled={!!busy} onClick={()=>void run('reload',async()=>{apply(await window.api.modelStatus())})}>重新检查旧配置</button>
   </div>
  </details>
  {message&&<p className="api-test-result" role="status">{message}</p>}
 </section>
 return <section className="glass model-settings" style={{padding:'22px 26px'}} aria-labelledby="model-settings-heading">
  <h2 id="model-settings-heading" style={{fontSize:14,letterSpacing:'.12em',fontWeight:500,margin:'0 0 14px'}}>自选模型 · 可选日记分析</h2>
  <p className="scene-hint">无需配置也能离线使用。日记页可分别选择本地分析或使用模型分析；只有选择模型分析时，正文才会发送到保存的服务地址，费用由你的服务账户承担。</p>
  <div style={{display:'flex',flexDirection:'column',gap:12}}>
   <label style={{display:'flex',flexDirection:'column',gap:6}}>API 地址<input aria-label="模型 API 地址" value={endpoint} placeholder="https://api.deepseek.com" disabled={!!busy} onChange={e=>setEndpoint(e.target.value)} autoComplete="off" spellCheck={false}/></label>
   <label style={{display:'flex',flexDirection:'column',gap:6}}>API Key<input aria-label="新的 API Key" type="password" value={key} placeholder={status?.configured?'已保存密钥；留空保留，不回显原值':'输入新密钥后点击保存'} disabled={!!busy} onChange={e=>setKey(e.target.value)} autoComplete="new-password" spellCheck={false}/></label>
   <small role="status">{status?(status.configured?'已有密钥 · 由本机保护服务保存':'未配置密钥 · 使用离线评分'):'正在读取配置…'}</small>
   <label style={{display:'flex',flexDirection:'column',gap:6}}>模型名称<input aria-label="模型名称" value={model} placeholder="deepseek-chat" disabled={!!busy} onChange={e=>setModel(e.target.value)} autoComplete="off"/></label>
   <div className="api-resolved-endpoint"><span>保存后请求地址</span><code>{addressError||resolved}</code></div>
   <small>测试配置只发送固定测试内容，不发送日记，也可能产生服务费用。外部服务使用 HTTPS；本机 HTTP 仅允许回环地址。更换服务地址时，需要重新输入密钥。</small>
   <div style={{display:'flex',flexWrap:'wrap',gap:10}}>
    <button className="btn primary" disabled={!!busy||!!addressError||!status} onClick={()=>void run('save',async()=>{const next=await window.api.modelSave({endpoint,model,...(key?{key}:{})});apply(next);await useApp.getState().refresh();setMessage(next.message||'模型配置已保存，密钥输入框已清空。')})}>{busy==='save'?'保存中…':'保存模型配置'}</button>
    <button className="btn" disabled={!!busy||!status?.configured||!status.available||dirty} onClick={()=>void run('test',async()=>{const result=await window.api.testLLM();setMessage(result.message+` · ${(result.elapsedMs/1000).toFixed(1)} 秒`)})}>{busy==='test'?'正在测试…':'测试已保存配置'}</button>
    <button className="btn" disabled={!!busy||!status} onClick={()=>void run('clear',async()=>{const next=await window.api.modelClear();apply(next);await useApp.getState().refresh();setMessage('已移除保存的密钥，日记评分继续使用离线规则。')})}>移除已保存密钥</button>
    <button className="btn" disabled={!!busy} onClick={()=>void run('reload',async()=>{apply(await window.api.modelStatus())})}>重新读取配置</button>
   </div>
   {dirty&&<small>有尚未保存的修改。测试只会使用已保存的配置。</small>}
   {status?.message&&<p className="api-test-result" role="status">{status.message}</p>}
   {message&&<p className="api-test-result" role="status">{message}</p>}
   <p className="scene-hint">密钥不随完整备份或局域网同步迁移，换设备需要重新配置。未配置或服务不可用时使用离线规则评分；评分不做心理诊断。</p>
  </div>
 </section>
}
