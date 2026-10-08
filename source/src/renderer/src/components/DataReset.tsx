import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store/app'
import type { DataResetScope, GrowthResetInfo } from '../../../shared/types'

export default function DataReset(){
  const [info,setInfo]=useState<GrowthResetInfo|null>(null),[scope,setScope]=useState<DataResetScope>('growth')
  const [opened,setOpened]=useState(false),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
  const lock=useRef(false)
  const blocked=useApp(s=>!!s.focusClock||s.focusSaving||s.focusPending||!!s.focusFinish||s.popups.length>0)
  const phrase=scope==='growth'?'清除成长':'清除练习记录'
  useEffect(()=>{void window.api.growthResetInfo().then(setInfo).catch(()=>setMessage('暂时无法读取清除范围，请重新进入设置。'))},[])
  async function act(undo=false){
    const s=useApp.getState()
    if(lock.current||s.focusClock||s.focusSaving||s.focusPending||s.focusFinish||s.popups.length)return
    lock.current=true;setBusy(true);setMessage('')
    try{
      const state=undo?await window.api.undoGrowthReset():await window.api.resetGrowth(confirmation,scope)
      useApp.setState({...state,popups:[],focusFinish:null,dataResetVersion:s.dataResetVersion+1})
      setOpened(false);setConfirmation('')
      await useApp.getState().refresh()
      setInfo(await window.api.growthResetInfo())
      setMessage(undo?'已恢复清除前的记录。':scope==='growth'?'五维已回到初始等级，成长记录已清空。学习内容与历史记录保留。':'练习记录已清除，笔记、复习卡内容、待办清单、习惯和设置保留。')
    }catch(e){setMessage(String(e).replace(/^Error:.*?: /,''))}finally{lock.current=false;setBusy(false)}
  }
  return <section className="data-reset" aria-label="清理测试数据">
    <h3>重新开始成长</h3><p>清除测试留下的五维成长，回到初始等级。</p>
    {info&&<p>当前有 {info.eventCount} 条成长记录。</p>}
    <button className="btn" disabled={busy||blocked||!info} onClick={()=>{setOpened(!opened);setConfirmation('');setScope('growth');setMessage('')}}>{opened?'取消清除':'清除成长数据'}</button>
    {blocked&&<p>请先结束专注并完成结算，再清理记录。</p>}
    {opened&&<div className="data-reset-confirm" role="group" aria-label="确认清除范围">
      <label><input type="checkbox" checked={scope==='practice'} disabled={busy} onChange={e=>{setScope(e.target.checked?'practice':'growth');setConfirmation('')}}/>同时清除全部练习记录</label>
      {scope==='growth'?<p>只清除五维积累与成长原因。保留日记、笔记、待办、专注历史、习惯打卡、复习进度和设置；旧记录不会自动重新加分。</p>:<p>还会删除专注历史、日记正文和习惯打卡，重置待办完成状态与投入时间、复习进度。保留笔记、复习卡内容、待办清单、习惯项目、日程和设置。</p>}
      <p>清除前会在本机保留快照。默认清除可在产生新成长前撤销；清除全部练习记录后，继续学习或修改相关记录会关闭撤销入口。</p>
      <label className="data-reset-phrase">输入“{phrase}”确认<input aria-label="清除确认文字" value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)} autoComplete="off"/></label>
      <button className="btn danger" disabled={busy||blocked||confirmation!==phrase} onClick={()=>void act()}>{busy?'正在处理…':'确认'+phrase}</button>
    </div>}
    {info?.canUndo&&!opened&&<button className="btn" disabled={busy||blocked} onClick={()=>void act(true)}>撤销上次清除</button>}
    {message&&<p role="status">{message}</p>}
  </section>
}
