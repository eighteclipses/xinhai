import {useEffect,useRef,useState,type CSSProperties} from 'react'
import {useApp} from '../store/app'
import {effectiveThemeColor,normalizeThemeColor} from '../../../shared/theme'
import {resolveScene} from '../lib/scenes'
import {extractWallpaperColors} from '../lib/wallpaperColors'
import { COMMERCIAL_EDITION } from '../../../shared/edition'

const PRESETS=COMMERCIAL_EDITION
  ? [['深海青','#67ddd1'],['晨光金','#e7bc76'],['轨道紫','#b6abef'],['雾蓝','#82b6e8'],['珊瑚','#df938a'],['柔绿','#79b99b'],['月白','#d5dfe5']] as const
  : [['心海蓝','#21bce7'],['结城理','#167fe4'],['埃癸斯 · 金','#e6b751'],['埃癸斯 · 红','#ed153b'],['岳羽由加莉','#d580a2'],['深海青','#67ddd1'],['晨光金','#e7bc76'],['轨道紫','#b6abef'],['柔绿','#79b99b'],['淡紫','#ad91d4']] as const

export default function ThemeSettings(){
  const settings=useApp(s=>s.settings),setSettings=useApp(s=>s.setSettings)
  const activeColor=effectiveThemeColor(settings)
  const [draft,setDraft]=useState(activeColor),[colors,setColors]=useState<string[]>([])
  const [busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState('')
  const request=useRef(0)
  const extraction=useRef<AbortController|null>(null)
  useEffect(()=>setDraft(activeColor),[activeColor])
  useEffect(()=>{request.current++;extraction.current?.abort();setColors([]);setMessage('');setBusy(false);return()=>{request.current++;extraction.current?.abort()}},[settings.background,settings.customBackground?.src])
  const valid=normalizeThemeColor(draft)
  async function apply(value:string){
    const color=normalizeThemeColor(value);if(!color||saving)return
    setSaving(true)
    try{await setSettings({themeColor:color,themeMode:'fixed'});setMessage('已固定这个主题色，换壁纸时保持不变。')}
    catch{setMessage('保存主题色失败，请重试。')}
    finally{setSaving(false)}
  }
  async function extract(){
    const id=++request.current;setBusy(true);setMessage('');setColors([])
    extraction.current?.abort();const controller=new AbortController();extraction.current=controller
    try{
      const scene=resolveScene(settings.background,'customize',false,settings.customBackground)
      const next=await extractWallpaperColors(scene,{displayedVideoOnly:COMMERCIAL_EDITION,signal:controller.signal})
      if(id===request.current){setColors(next);setMessage('已提取候选色，点选一个应用。')}
    }catch(error){if(id===request.current)setMessage(error instanceof Error?error.message:'提取失败，请手动选色。')}
    finally{if(id===request.current)setBusy(false)}
  }
  return <section className="theme-settings glass" aria-label="界面主题色">
    <header><div><h2>界面主题色</h2><p>随壁纸自动搭配，也可以固定喜欢的颜色。白色正文和数字保持白色。</p></div><span className="theme-current"><i style={{background:activeColor}}/>{activeColor.toUpperCase()}</span></header>
    <div className="theme-mode" role="group" aria-label="主题配色模式"><button aria-pressed={settings.themeMode==='wallpaper'} onClick={()=>void setSettings({themeMode:'wallpaper'}).catch(()=>setMessage('模式保存失败，请重试。'))}>随壁纸配色</button><button aria-pressed={settings.themeMode==='fixed'} onClick={()=>void setSettings({themeMode:'fixed',themeColor:activeColor}).catch(()=>setMessage('模式保存失败，请重试。'))}>固定主题色</button><small>{settings.themeMode==='wallpaper'?'换壁纸时自动配色；自定义壁纸会提取主色。':'换壁纸不换色。手动选色会进入此模式。'}</small></div>
    <div className="theme-presets" role="group" aria-label="主题色预设">{PRESETS.map(([label,color])=><button key={color} aria-pressed={activeColor===color} disabled={saving} onClick={()=>void apply(color)}><i style={{background:color}}/><span>{label}</span>{activeColor===color&&<b>✓</b>}</button>)}</div>
    <div className="theme-custom-row"><label className="theme-picker"><span>自选颜色</span><input type="color" aria-label="选择主题颜色" value={valid??activeColor} onChange={e=>setDraft(e.target.value)}/></label><label className="theme-hex"><span>颜色代码</span><input aria-label="主题色代码" value={draft} maxLength={7} spellCheck={false} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&valid)void apply(valid)}} aria-invalid={!valid}/></label><button className="btn" disabled={!valid||saving} onClick={()=>void apply(draft)}>应用颜色</button><button className="btn" disabled={busy} onClick={()=>void extract()}>{busy?'正在提取…':'从当前壁纸提取颜色'}</button><div className="theme-digit-preview" style={{'--preview-color':valid??activeColor} as CSSProperties}><strong>25:00</strong><small>白色数字 · 主题光晕</small></div></div>
    {colors.length>0&&<div className="theme-candidates" role="group" aria-label="壁纸候选色">{colors.map(color=><button key={color} disabled={saving} aria-label={'应用候选色 '+color} onClick={()=>void apply(color)}><i style={{background:color}}/>{color.toUpperCase()}</button>)}</div>}
    {message&&<p className="theme-message" role="status">{message}</p>}
  </section>
}
