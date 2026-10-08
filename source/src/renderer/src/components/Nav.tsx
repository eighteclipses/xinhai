import { useApp, PAGE_NUMBERS, type PageId } from '../store/app'
import { playClick } from '../lib/audio'
const ITEMS: Array<{id:PageId;label:string;en:string}> = [
  {id:'home',label:'共学桌面',en:'DESK'},
  {id:'focus',label:'专注',en:'FOCUS'},
  {id:'knowledge',label:'知识库',en:'LIBRARY'},
  {id:'todos',label:'待办',en:'TASKS'},
  {id:'calendar',label:'日历',en:'CALENDAR'},
  {id:'habits',label:'习惯',en:'HABITS'},
  {id:'journal',label:'日记',en:'JOURNAL'},
  {id:'stats',label:'五维',en:'GROWTH'},
  {id:'history',label:'轨迹',en:'RECORDS'},
  {id:'settings',label:'设置',en:'SYSTEM'},
  {id:'customize',label:'自定义',en:'CUSTOM'}
]
export default function Nav(){
 const page=useApp(s=>s.page),go=useApp(s=>s.go)
 return <nav className="command-nav" aria-label="学习工具">{ITEMS.map(item=><button key={item.id} className={'command-item'+(page===item.id?' is-active':'')} aria-current={page===item.id?'page':undefined} onClick={()=>{playClick();go(item.id)}}><span className="command-num" aria-hidden="true">{PAGE_NUMBERS[item.id]}</span><span className="command-text"><strong>{item.label}</strong><small>{item.en}</small></span><span className="command-arrow" aria-hidden="true">↗</span></button>)}</nav>
}
