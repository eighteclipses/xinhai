import type { CalendarEntry } from './types'
import { normalizeFocusTaskLabel } from './focusTaskSummary'

export const CALENDAR_LABELS: Record<CalendarEntry['kind'],string> = {
  todo:'待办',habit:'习惯',journal:'日记',focus:'专注',event:'安排'
}
const KIND_ORDER: CalendarEntry['kind'][] = ['focus','todo','habit','journal','event']

export interface CalendarFocusTask {
  taskLabel:string
  seconds:number
  sessionCount:number
  unknownDurationCount:number
  entries:CalendarEntry[]
}
export interface CalendarKindGroup {
  kind:CalendarEntry['kind']
  entries:CalendarEntry[]
  focus?:{seconds:number;sessionCount:number;unknownDurationCount:number;tasks:CalendarFocusTask[]}
}
export interface CalendarDayGroup { date:string;entryCount:number;groups:CalendarKindGroup[] }

/** The API adapts seconds and legacy minutes into durationSeconds; never infer time from display copy. */
export function calendarEntrySeconds(entry:CalendarEntry):number|null {
  const seconds=entry.durationSeconds
  return typeof seconds==='number'&&Number.isSafeInteger(seconds)&&seconds>=0?seconds:null
}

/** Display only: original date, label, state and detail remain on every entry. */
export function groupCalendarDays(entries:readonly CalendarEntry[]):Map<string,CalendarDayGroup> {
  const days=new Map<string,CalendarDayGroup>()
  for(const entry of entries){
    let day=days.get(entry.date)
    if(!day){day={date:entry.date,entryCount:0,groups:[]};days.set(entry.date,day)}
    let group=day.groups.find(group=>group.kind===entry.kind)
    if(!group){group={kind:entry.kind,entries:[]};day.groups.push(group)}
    group.entries.push(entry);day.entryCount++
  }
  for(const day of days.values()){
    day.groups.sort((a,b)=>KIND_ORDER.indexOf(a.kind)-KIND_ORDER.indexOf(b.kind))
    const focus=day.groups.find(group=>group.kind==='focus')
    if(!focus)continue
    const tasks=new Map<string,CalendarFocusTask>()
    let seconds=0,unknownDurationCount=0
    for(const entry of focus.entries){
      const taskLabel=normalizeFocusTaskLabel(entry.title)
      let task=tasks.get(taskLabel)
      if(!task){task={taskLabel,seconds:0,sessionCount:0,unknownDurationCount:0,entries:[]};tasks.set(taskLabel,task)}
      const duration=calendarEntrySeconds(entry)
      if(duration===null){unknownDurationCount++;task.unknownDurationCount++}
      else{seconds+=duration;task.seconds+=duration}
      task.sessionCount++;task.entries.push(entry)
    }
    focus.focus={seconds,sessionCount:focus.entries.length,unknownDurationCount,tasks:[...tasks.values()].sort((a,b)=>
      b.seconds-a.seconds||b.sessionCount-a.sessionCount||a.taskLabel.localeCompare(b.taskLabel,'zh-CN'))}
  }
  return days
}

export function formatCalendarDuration(seconds:number,compact=false):string {
  if(!Number.isSafeInteger(seconds)||seconds<0)return '时长未知'
  const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60
  const parts:string[]=[]
  if(hours)parts.push(hours+(compact?'时':' 小时'))
  if(minutes)parts.push(minutes+(compact?'分':' 分'))
  if(rest||!parts.length)parts.push(rest+(compact?'秒':' 秒'))
  return parts.join(compact?'':' ')
}
