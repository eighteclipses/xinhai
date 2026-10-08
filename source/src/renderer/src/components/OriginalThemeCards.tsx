import { useState } from 'react'
import { originalThemes, originalThemePatch } from '../../../shared/originalThemes'
import { useApp } from '../store/app'
import type { BackgroundId } from '../../../shared/types'
import { COMMERCIAL_EDITION } from '../../../shared/edition'

export default function OriginalThemeCards() {
  const background=useApp(s=>s.settings.background)
  const [busy,setBusy]=useState<BackgroundId|null>(null)
  const [message,setMessage]=useState('')
  async function apply(id:BackgroundId){
    if(busy)return
    setBusy(id);setMessage('')
    try{await useApp.getState().setSettings(originalThemePatch(id));setMessage('主题已应用。壁纸、配色与氛围已搭配好，下面仍可单独调整。')}
    catch{setMessage('主题保存失败，请重试。')}
    finally{setBusy(null)}
  }
  return <section className="original-themes" aria-label={COMMERCIAL_EDITION?'内置主题组合':'原创主题组合'}>
    <div className="studio-section-heading"><div><span>START WITH A MOOD</span><h2>从一种氛围开始</h2></div><p>{COMMERCIAL_EDITION?'三套内置主题 · AI 生成壁纸':'三套原创主题 · 一键搭配，也可以自由修改'}</p></div>
    <div className="original-theme-grid">{originalThemes.map(theme=><button key={theme.id} className="original-theme-card" disabled={!!busy} aria-pressed={background===theme.id} onClick={()=>void apply(theme.id)} style={{'--preset-color':theme.themeColor} as React.CSSProperties}>
      <img src={theme.poster} alt={theme.description}/><span className="original-theme-shade"/>
      <span className="original-theme-top"><i/> {COMMERCIAL_EDITION?(background===theme.id?'当前壁纸 · AI 生成':'AI 生成壁纸'):(background===theme.id?'当前壁纸':'原创主题')}</span>
      <span className="original-theme-copy"><strong>{theme.label}</strong><small>{theme.description}</small><span>{busy===theme.id?'正在应用…':'应用整套主题'} <b aria-hidden="true">↗</b></span></span>
    </button>)}</div>
    {COMMERCIAL_EDITION&&<details className="original-theme-origin"><summary>壁纸来源说明</summary><p>上方三张内置壁纸使用 OpenAI 图像工具生成。主题配色、动效和布局由心海共学搭配，你仍可自由调整。</p><p>来源说明仅对应这三张内置壁纸。你导入的图片与视频由你自行选择，本应用不判断其是否由 AI 生成。</p></details>}
    <p className="studio-feedback" role="status">{message||'应用主题保留你的学习记录、已导入文件和减少动态偏好。'}</p>
  </section>
}
