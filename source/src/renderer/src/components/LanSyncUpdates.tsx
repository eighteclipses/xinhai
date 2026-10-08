import {useEffect} from 'react'
import {useApp} from '../store/app'

/** Refresh saved data without remounting a running timer or replacing an editor draft. */
export default function LanSyncUpdates(){
 useEffect(()=>{
  let pending=false,refreshing=false,disposed=false
  const update=async()=>{
   const s=useApp.getState()
   if(!pending||refreshing||s.focusSaving||s.popups.length||s.focusFinish)return
   pending=false;refreshing=true
   try{await s.refresh();if(!disposed)useApp.setState(x=>({dataSyncVersion:x.dataSyncVersion+1}))}
   catch{pending=true}finally{refreshing=false}
  }
  const off=window.api.onSyncChanged(()=>{pending=true;void update()})
  const timer=setInterval(()=>void update(),500)
  return()=>{disposed=true;off();clearInterval(timer)}
 },[])
 return null
}
