import {useEffect,useMemo,useRef,useState,type RefObject,type PointerEvent,type KeyboardEvent} from 'react'
import {useApp} from '../store/app'
import {createPortal} from 'react-dom'
import {HOME_MODULE_IDS,HOME_MODULE_LABELS,homeLayoutProfile,normalizeHomeLayouts,freeHomeItem,changeFreeHomeItem,type HomeModuleId,type FreeHomeItem,type FreeHomeLayouts,type HomeLayoutProfile} from '../../../shared/homeLayout'
import '../styles/home-layout.css'

const selectors:Record<HomeModuleId,string>={
 welcome:'.desk-clock,.desk-content>h1,.desk-subtitle',date:'.desk-date',focus:'.next-focus',shortcuts:'.desk-links',
 recent:'.home-last-session',agenda:'.desk-details>section:first-child',today:'.desk-today',growth:'.desk-growth-strip'
}
type Box={id:HomeModuleId;x:number;y:number;w:number;h:number;dx:number;dy:number;scale:number}
type Gesture={pointer:number;id:HomeModuleId;kind:'move'|'resize';x:number;y:number;scroll:number;before:FreeHomeLayouts;item:FreeHomeItem;box:Box;profile:HomeLayoutProfile;autoScale:number}
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n))

/** Enhances the original DOM in place. No wrappers, grid, packing or normal-mode surfaces. */
export default function HomeLayout({page,autoScale=1}:{page:RefObject<HTMLDivElement>;autoScale?:number}){
 const raw=useApp(s=>s.settings.homeLayouts),saved=useMemo(()=>normalizeHomeLayouts(raw),[raw])
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState<FreeHomeLayouts>({version:2})
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('')
 const [viewport,setViewport]=useState({w:innerWidth,h:innerHeight}),[boxes,setBoxes]=useState<Box[]>([])
 const profile=homeLayoutProfile(viewport.w),current=editing?draft:saved
 const gesture=useRef<Gesture|null>(null),changed=useRef(new Set<HomeLayoutProfile>()),editButton=useRef<HTMLButtonElement>(null)
 const original=useRef(new Map<HTMLElement,{translate:string;scale:string;position:string;zIndex:string;inert:boolean}>())
 const originals=()=>{for(const [node,style] of original.current){node.style.translate=style.translate;node.style.scale=style.scale;node.style.position=style.position;node.style.zIndex=style.zIndex;node.inert=style.inert}}
 const cancelGesture=()=>{if(gesture.current){setDraft(gesture.current.before);gesture.current=null}}
 useEffect(()=>{cancelGesture()},[autoScale])
 useEffect(()=>{
  const resize=()=>{cancelGesture();setViewport({w:innerWidth,h:innerHeight})}
  window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize)
 },[])
 useEffect(()=>{
  const root=page.current;if(!root)return
  let frame=0,disposed=false
  const measure=()=>{
   if(disposed)return
   originals()
   const rootRect=root.getBoundingClientRect(),areaWidth=root.clientWidth,areaHeight=Math.max(root.clientHeight,(root.closest('.page-stage')?.clientHeight??0)/autoScale)
   const next:Box[]=[]
   for(const id of HOME_MODULE_IDS){
    const nodes=[...root.querySelectorAll<HTMLElement>(selectors[id])].filter(node=>getComputedStyle(node).display!=='none'&&node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0)
    if(!nodes.length)continue
    const rects=nodes.map(node=>{const r=node.getBoundingClientRect();return {left:r.left/autoScale,top:r.top/autoScale,right:r.right/autoScale,bottom:r.bottom/autoScale,width:r.width/autoScale,height:r.height/autoScale}})
    const left=Math.min(...rects.map(r=>r.left)),top=Math.min(...rects.map(r=>r.top))
    const w=Math.max(...rects.map(r=>r.right))-left,h=Math.max(...rects.map(r=>r.bottom))-top
    const x=left-rootRect.left/autoScale,y=top-rootRect.top/autoScale,item=freeHomeItem(current,profile,id)
    const adjusted=item.dx!==0||item.dy!==0||item.scale!==1
    const scale=adjusted?Math.max(.65,Math.min(item.scale,areaWidth/w,areaHeight/h)):1
    const dx=adjusted?clamp(item.dx,-x,Math.max(-x,areaWidth-x-w*scale)):0
    const dy=adjusted?clamp(item.dy,-y,Math.max(-y,areaHeight-y-h*scale)):0
    nodes.forEach((node,i)=>{
     if(!original.current.has(node))original.current.set(node,{translate:node.style.translate,scale:node.style.scale,position:node.style.position,zIndex:node.style.zIndex,inert:node.inert})
     node.dataset.homeModule=id
     if(adjusted){
      const r=rects[i]
      node.style.translate=(dx+(scale-1)*(r.left+r.width/2-left))+'px '+(dy+(scale-1)*(r.top+r.height/2-top))+'px'
      node.style.scale=String(scale)
      if(getComputedStyle(node).position==='static')node.style.position='relative'
      node.style.zIndex='6'
     }
     if(editing)node.inert=true
    })
    next.push({id,x,y,w,h,dx,dy,scale})
   }
   setBoxes(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next)
  }
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure)}
  measure()
  const observer=new ResizeObserver(schedule);observer.observe(root)
  const mutation=new MutationObserver(schedule);mutation.observe(root,{childList:true,subtree:true})
  root.addEventListener('animationend',schedule)
  void document.fonts.ready.then(schedule)
  return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();mutation.disconnect();root.removeEventListener('animationend',schedule);originals()}
 },[current,editing,profile,viewport.w,viewport.h,autoScale])
 useEffect(()=>()=>{originals();gesture.current=null},[])
 const put=(item:FreeHomeItem,target=profile)=>{changed.current.add(target);setDraft(value=>changeFreeHomeItem(value,target,item));setError('')}
 const begin=()=>{setDraft(saved);changed.current.clear();setEditing(true);setError('');setStatus('编辑中：自由拖动把手，右下角等比例缩放。完成后保存。')}
 const cancel=()=>{gesture.current=null;setEditing(false);setError('');setStatus('已取消布局调整。');requestAnimationFrame(()=>editButton.current?.focus())}
 useEffect(()=>{
  if(!editing)return
  const key=(event:globalThis.KeyboardEvent)=>{
   if(event.key==='Escape'&&!busy&&!document.querySelector('.study-shell.ui-hidden')&&!document.querySelector('dialog[open]')){event.preventDefault();if(gesture.current)cancelGesture();else cancel()}
  }
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)
 },[editing,busy])
 const finish=async()=>{
  if(busy)return
  setBusy(true);setError('')
  try{
   const next=normalizeHomeLayouts(useApp.getState().settings.homeLayouts)
   for(const p of changed.current)next[p]=draft[p]??[]
   await useApp.getState().setSettings({homeLayouts:next})
   setEditing(false);setStatus('布局已保存。');requestAnimationFrame(()=>editButton.current?.focus())
  }catch(cause){setError('未能保存，调整仍保留。'+String(cause))}
  finally{setBusy(false)}
 }
 const reset=async()=>{
  if(busy)return
  gesture.current=null;setBusy(true);setError('')
  try{
   const next=normalizeHomeLayouts(useApp.getState().settings.homeLayouts);delete next[profile]
   await useApp.getState().setSettings({homeLayouts:next,clockPosition:null})
   setDraft(next);changed.current.clear();setStatus('已恢复原版默认位置与大小。')
  }catch(cause){setError('恢复默认未能保存。'+String(cause))}
  finally{setBusy(false)}
 }
 const down=(event:PointerEvent<HTMLButtonElement>,box:Box,kind:Gesture['kind'])=>{
  if(event.button!==0||busy)return
  event.preventDefault();event.currentTarget.focus({preventScroll:true})
  gesture.current={pointer:event.pointerId,id:box.id,kind,x:event.clientX,y:event.clientY,scroll:page.current?.closest('.page-stage')?.scrollTop??0,before:draft,item:{id:box.id,dx:box.dx,dy:box.dy,scale:box.scale},box,profile,autoScale}
  event.currentTarget.setPointerCapture(event.pointerId)
 }
 const move=(event:{pointerId:number;clientX:number;clientY:number})=>{
  const a=gesture.current;if(!a||a.pointer!==event.pointerId)return
  const dx=(event.clientX-a.x)/a.autoScale,dy=(event.clientY-a.y+(page.current?.closest('.page-stage')?.scrollTop??0)-a.scroll)/a.autoScale
  if(a.kind==='move')put({...a.item,dx:Math.round((a.item.dx+dx)*1000)/1000,dy:Math.round((a.item.dy+dy)*1000)/1000},a.profile)
  else{
   const delta=Math.abs(dx/a.box.w)>Math.abs(dy/a.box.h)?dx/a.box.w:dy/a.box.h
   put({...a.item,scale:Math.round(clamp(a.item.scale+delta,.65,2)*1000)/1000},a.profile)
  }
 }
 const up=(event:{pointerId:number;clientX:number;clientY:number})=>{
  if(!gesture.current||gesture.current.pointer!==event.pointerId)return
  move(event);gesture.current=null
 }
 useEffect(()=>{
  // The scaled resize handle moves while dragging. Keep tracking even when a
  // WebView releases element capture or the pointer moves outside that handle.
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)
  window.addEventListener('pointercancel',cancelGesture);window.addEventListener('blur',cancelGesture)
  return()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancelGesture);window.removeEventListener('blur',cancelGesture)}
 },[])
 const keyboard=(event:KeyboardEvent<HTMLButtonElement>,box:Box,kind:Gesture['kind'])=>{
  const delta=({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]} as Record<string,number[]>)[event.key]
  if(!delta||busy)return
  event.preventDefault();const item={id:box.id,dx:box.dx,dy:box.dy,scale:box.scale},step=event.shiftKey?20:1
  put(kind==='move'?{...item,dx:item.dx+delta[0]*step/autoScale,dy:item.dy+delta[1]*step/autoScale}:{...item,scale:Math.round(clamp(item.scale+(delta[0]+delta[1])*(event.shiftKey?.1:.01),.65,2)*1000)/1000})
  setStatus(HOME_MODULE_LABELS[box.id]+'已调整，完成后保存。')
 }
 const handlers=(box:Box,kind:Gesture['kind'])=>({
  onPointerDown:(e:PointerEvent<HTMLButtonElement>)=>down(e,box,kind),onKeyDown:(e:KeyboardEvent<HTMLButtonElement>)=>keyboard(e,box,kind)
 })
 const toolbarTarget=page.current?.querySelector('.desk-kicker')
 return <>
  {toolbarTarget&&createPortal(<div className="home-layout-toolbar" data-editing={editing} role="group" aria-label="桌面布局">
   {!editing&&<button ref={editButton} id="home-layout-edit" className="home-layout-edit" disabled={busy} onClick={begin} aria-label="编辑布局" title="编辑桌面布局"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 5 5M4 20l4-1L21 6a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/></svg></button>}
   {editing&&<><button className="home-layout-reset" disabled={busy} onClick={()=>void reset()}>恢复默认</button><button disabled={busy} onClick={cancel}>取消</button><button className="home-layout-done" disabled={busy} onClick={()=>void finish()}>{busy?'保存中…':'完成'}</button></>}
   {editing&&!error&&<div className="home-layout-help">拖动把手自由移动，其他模块保持原位。右下角等比例缩放。方向键微调，Shift 加快，Esc 取消。</div>}
   {error&&<div className="home-layout-error" role="alert">{error}</div>}
  </div>,toolbarTarget)}
  <span className="sr-only" role="status">{status}</span>
  {editing&&<div className="home-free-overlay" data-profile={profile}>{boxes.map(box=><div key={box.id} className="home-free-outline" data-home-outline={box.id} style={{left:box.x+box.dx,top:box.y+box.dy,width:box.w*box.scale,height:box.h*box.scale}}>
   <button className="home-free-move" data-home-handle={box.id} disabled={busy} aria-label={'移动'+HOME_MODULE_LABELS[box.id]} {...handlers(box,'move')}>⠿ {HOME_MODULE_LABELS[box.id]}</button>
   <button className="home-free-resize" data-home-resize={box.id} disabled={busy} aria-label={'缩放'+HOME_MODULE_LABELS[box.id]} {...handlers(box,'resize')}>↘</button>
  </div>)}</div>}
 </>
}
