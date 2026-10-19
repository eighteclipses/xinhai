import {useEffect} from 'react'
import {useApp} from '../store/app'
import {localDateKey} from '../../../shared/date'

/** Refresh saved data without remounting a running timer or replacing an editor draft. */
export default function LanSyncUpdates(){
 useEffect(()=>{
  let pending=false,syncPending=false,refreshing=false,disposed=false
  const checkDay=()=>{
   const day=localDateKey()
   if(day!==useApp.getState().localDay){useApp.setState({localDay:day});pending=true}
  }
  const update=async()=>{
   const s=useApp.getState()
   if(!pending||refreshing||s.focusSaving||s.popups.length||s.focusFinish)return
   pending=false;refreshing=true
   const wasSync=syncPending;syncPending=false
   try{await s.refresh();if(!disposed&&wasSync)useApp.setState(x=>({dataSyncVersion:x.dataSyncVersion+1}))}
   catch{pending=true;if(wasSync)syncPending=true}finally{refreshing=false}
  }
  const wake=()=>{if(document.hidden)return;checkDay();pending=true;void update()}
  const off=window.api.onSyncChanged(()=>{pending=true;syncPending=true;void update()})
  const timer=setInterval(()=>{checkDay();void update()},500)
  window.addEventListener('focus',wake);window.addEventListener('xinhai-resume',wake);document.addEventListener('visibilitychange',wake)
  return()=>{disposed=true;off();clearInterval(timer);window.removeEventListener('focus',wake);window.removeEventListener('xinhai-resume',wake);document.removeEventListener('visibilitychange',wake)}
 },[])
 return null
}
