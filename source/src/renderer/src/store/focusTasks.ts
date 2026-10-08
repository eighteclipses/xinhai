import {create} from 'zustand'
type Task={id:string;title:string;usedAt:number}
const key='xinhai-focus-tasks-v1'
function read():Task[]{
 try{const list=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(list)?list.filter(t=>typeof t.id==='string'&&typeof t.title==='string'&&Number.isFinite(t.usedAt)):[]}catch{return []}
}
export const useFocusTasks=create<{tasks:Task[];error:string}>(()=>({tasks:read(),error:''}))
function save(tasks:Task[]):boolean{
 try{localStorage.setItem(key,JSON.stringify(tasks));useFocusTasks.setState({tasks,error:''});return true}
 catch{useFocusTasks.setState({error:'任务列表保存失败，请重试。'});return false}
}
export function rememberFocusTask(value:string):boolean{
 const title=value.trim()
 if(!title)return true
 const tasks=useFocusTasks.getState().tasks,previous=tasks.find(t=>t.title===title)
 return save([{id:previous?.id??crypto.randomUUID(),title,usedAt:Date.now()},...tasks.filter(t=>t.title!==title)])
}
export function deleteFocusTask(id:string){save(useFocusTasks.getState().tasks.filter(t=>t.id!==id))}
