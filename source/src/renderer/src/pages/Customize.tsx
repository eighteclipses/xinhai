import {useState} from 'react'
import {createPortal} from 'react-dom'
import {useApp} from '../store/app'
import {playClick} from '../lib/audio'
import {backgroundScenes} from '../lib/scenes'
import {PERSONAL_EDITION} from '../../../shared/edition'
import type {BackgroundId} from '../../../shared/types'
import Toggle from '../components/Toggle'
import AlloutFinish from '../components/AlloutFinish'
import ThemeSweep from '../components/ThemeSweep'
import ThemeSettings from '../components/ThemeSettings'
import { effectiveThemeColor } from '../../../shared/theme'
import {useRef} from 'react'
import P3RClock from '../components/P3RClock'
import MinimalClock from '../components/MinimalClock'
import SceneRotationSettings from '../components/SceneRotationSettings'
import SceneGallery from '../components/SceneGallery'
import OriginalThemeCards from '../components/OriginalThemeCards'
export default function Customize(){
 const previewReveal=useRef<HTMLDivElement>(null)
 const settings=useApp(s=>s.settings),setSettings=useApp(s=>s.setSettings)
 const [collection,setCollection]=useState('all')
 const [previewSweep,setPreviewSweep]=useState(false)
 const [previewAllout,setPreviewAllout]=useState(false)
  const [backgroundBusy,setBackgroundBusy]=useState(false),[backgroundMessage,setBackgroundMessage]=useState('')
  async function uploadBackground(){if(backgroundBusy)return;setBackgroundBusy(true);setBackgroundMessage('');try{const next=await window.api.backgroundImport();if(next){useApp.setState({settings:next});setBackgroundMessage('已应用：'+next.customBackground?.name)}}catch(e){setBackgroundMessage('导入失败：'+String(e).replace(/^Error:.*?: /,''))}finally{setBackgroundBusy(false)}}

 return <div className="customize-page">
  <header className="customize-heading"><div><div className="page-title"><span className="en">YOUR BLUE</span><span className="zh">自定义</span></div><p>把喜欢的场景、时间与音乐，留在同一张桌面。</p></div><button className="btn" onClick={()=>setSettings({background:'original-deep-sea',themeMode:'wallpaper',clockStyle:'minimal',playerStyle:'card',pageBackgrounds:false,showCharacter:false,characterStyle:'hidden',ambientEffect:'none',wallpaperMotion:false,sceneTransition:'arc'})}>应用示例主题组合 ↗</button></header>
  <OriginalThemeCards/>
  <ThemeSettings/>
  <div className="customize-layout"><section className="glass customize-scenes"><h2>01 / 场景收藏</h2>
            <div style={{ fontSize: 14, color: 'var(--ink-dim)', marginBottom: 8 }}>选择背景 · 内置三张 SVG 示例，也可导入自己的背景</div>
            <div className="scene-collections" role="group" aria-label="场景分类">{[['all','全部'],['originals','SVG 示例']].map(([id,label])=><button key={id} aria-pressed={collection===id} onClick={()=>setCollection(id)}>{label}</button>)}</div>
            <SceneGallery scenes={backgroundScenes.filter(s=>collection==='all'||s.collection===collection)} selected={settings.background} onSelect={(id)=>{playClick();void setSettings({background:id})}} />
            <div className="custom-background-controls"><button className="btn" disabled={backgroundBusy} onClick={()=>void uploadBackground()}>{backgroundBusy?'正在导入…':'上传自定义背景'}</button>{settings.customBackground&&<button className="btn" aria-pressed={settings.background==='custom'} onClick={()=>setSettings({background:'custom'})}>使用我的背景</button>}<p>支持 PNG / JPG / WebP（30MB 内）、MP4 / WebM（300MB 内）。保存在本机，自定义背景应用于所有页面。视频静音循环；关闭动态或解码失败时显示默认静帧。</p>{backgroundMessage&&<p role="status">{backgroundMessage}</p>}{settings.customBackground&&<small>{settings.customBackground.name}</small>}</div>
            <p className="scene-hint">所选场景也会显示在首页。导入图片或视频时，请自行确认使用权限。人物立绘为可选本地资源，源码不附带角色图片。</p>
            <div className="appearance-controls"><label><span>背景显示方式</span><select aria-label="背景显示方式" value={settings.backgroundFit} onChange={e=>setSettings({backgroundFit:e.target.value as typeof settings.backgroundFit})}><option value="cover">铺满屏幕 · 边缘适当裁切</option><option value="contain">完整显示 · 保留画面边缘</option></select></label>
              <h3>画面与阅读</h3>
              {([{key:'panelOpacity',label:'面板不透明度',min:0,max:.9,step:.05,unit:'%'},{key:'wallpaperDim',label:'壁纸暗化',min:0,max:.6,step:.05,unit:'%'},{key:'panelBlur',label:'面板模糊',min:0,max:20,step:1,unit:'px'},{key:'characterOpacity',label:'立绘不透明度',min:.2,max:1,step:.05,unit:'%'},{key:'characterScale',label:'立绘大小',min:.65,max:1.2,step:.05,unit:'%'}] as const).map(item=><label key={item.key}><span>{item.label}<output>{Math.round(settings[item.key]*(item.unit==='%'?100:1))}{item.unit}</output></span><input aria-label={item.label} type="range" min={item.min} max={item.max} step={item.step} value={settings[item.key]} onChange={e=>setSettings({[item.key]:Number(e.target.value)})}/></label>)}
              <label><span>人物表现</span><select aria-label="人物表现" value={settings.characterStyle} onChange={e=>setSettings({characterStyle:e.target.value as typeof settings.characterStyle})}><option value="auto">自动 · 避开背景人物</option><option value="seated">坐姿陪伴</option><option value="uniform">常服立绘</option><option value="battle">战斗服立绘</option><option value="hidden">隐藏额外立绘</option></select></label>
              <label><span>专注计时位置</span><select aria-label="专注计时位置" value={settings.timerPosition} onChange={e=>setSettings({timerPosition:e.target.value as typeof settings.timerPosition})}><option value="center">正中间 · 推荐</option><option value="left">左侧</option><option value="right">右侧</option><option value="bottom">左下角 · 紧凑</option></select></label>
              <Toggle on={settings.wallpaperClock} onChange={v=>setSettings({wallpaperClock:v})} label="壁纸欣赏时保留计时" />
              <button className="btn" onClick={()=>setSettings({panelOpacity:.46,wallpaperDim:.08,panelBlur:4,characterStyle:'hidden',characterOpacity:1,characterScale:1,timerPosition:'center'})}>恢复推荐画面</button>
            </div>
            <Toggle on={settings.pageBackgrounds} onChange={(v) => setSettings({ pageBackgrounds: v })} label="页面专属背景" desc="使用对应页面场景；未提供独立素材时沿用当前背景" />

 </section><aside className="customize-options"><SceneRotationSettings/><section className="glass"><h2>02 / 日期与时间</h2>
 <div className="clock-preview">{settings.clockStyle==='minimal'?<MinimalClock scale={.8}/>:settings.clockStyle==='p3r'?<P3RClock scale={.66}/>:<span className="clock-preview-label">{settings.clockStyle==='hidden'?'日期已隐藏':'简洁数字 · 显示在页面内'}</span>}</div>
 <div className="style-choices" role="group" aria-label="日期样式">{([{id:'classic',label:'简洁数字'},{id:'minimal',label:'极简时钟'},{id:'p3r',label:'P3R 月相'},{id:'hidden',label:'隐藏日期'}] as const).map(x=><button key={x.id} aria-pressed={settings.clockStyle===x.id} onClick={()=>setSettings({clockStyle:x.id})}>{x.label}</button>)}</div>
 <label className="customize-slider">时钟大小 <output>{Math.round(settings.clockScale*100)}%</output><input aria-label="时钟大小" type="range" min={.5} max={1} step={.05} value={settings.clockScale} onChange={e=>setSettings({clockScale:Number(e.target.value)})}/></label>
 <p>显示在共学桌面和壁纸欣赏中。拖动时钟即可调整位置，日期跟随本机时间，月相为近似计算。</p>
 </section><section className="glass"><h2>03 / 播放器外观</h2>{settings.playerStyle==='mp3'?<img className="player-skin-preview" src="design/player-demo.svg" alt="源码示例随身听"/>:<div className={'personal-player-preview preview-'+settings.playerStyle} role="img" aria-label={settings.playerStyle==='card'?'简洁卡片外观预览':'底栏播放器外观预览'}><span aria-hidden="true">♫</span><div><small>YOUR SOUNDTRACK</small><strong>你的音乐</strong><span aria-hidden="true">‹　▶　›</span></div></div>}
 <div className="style-choices" role="group" aria-label="播放器样式">{([{id:'bar',label:'底栏播放器'},{id:'card',label:'简洁卡片'},{id:'mp3',label:'示例随身听'}] as const).map(x=><button key={x.id} aria-pressed={settings.playerStyle===x.id} onClick={()=>setSettings({playerStyle:x.id})}>{x.label}</button>)}</div><p>卡片和随身听都可拖动摆放；点击音乐图标或左侧小屏打开歌单、进度与音量。隐藏界面后也能直接控制音乐。</p><label className="customize-slider">播放器大小 <output>{Math.round(settings.playerScale*100)}%</output><input aria-label="播放器大小" type="range" min={.65} max={1.2} step={.05} value={settings.playerScale} onChange={e=>setSettings({playerScale:Number(e.target.value)})}/></label><button className="btn widget-reset" onClick={()=>setSettings({clockPosition:null,playerPosition:null,clockScale:.8,playerScale:1})}>恢复时钟与播放器位置</button><p>双击空白背景返回界面，电脑也可按 Esc。桌面和横屏平板分别记住自己的位置。</p></section>
 <section className="glass"><h2>04 / 动态与演出</h2><div className="appearance-controls"><label><span>切换效果</span><select aria-label="切换效果" value={settings.sceneTransition} onChange={e=>setSettings({sceneTransition:e.target.value as typeof settings.sceneTransition})}><option value="fade">柔和淡入</option><option value="arc">主题圆弧</option><option value="none">直接切换</option></select></label><label><span>氛围光点</span><select aria-label="氛围光点" value={settings.ambientEffect} onChange={e=>setSettings({ambientEffect:e.target.value as typeof settings.ambientEffect})}><option value="none">关闭</option><option value="motes">漂浮微光</option><option value="stars">静谧星点</option></select></label></div><Toggle on={settings.wallpaperMotion} onChange={v=>setSettings({wallpaperMotion:v})} label="壁纸缓慢移动" desc="为静态壁纸增加轻微动态；关闭动态效果时暂停"/><p>主题圆弧会随当前配色扫过画面；淡入和直接切换可通过选择另一张壁纸查看。</p><button className="btn" disabled={settings.reduceMotion||previewSweep} onClick={()=>setPreviewSweep(true)}>预览圆弧转场</button>{previewSweep&&createPortal(<ThemeSweep color={effectiveThemeColor(settings)} reveal={previewReveal} onDone={()=>setPreviewSweep(false)}/>,document.body)}
            <Toggle on={!settings.reduceMotion} onChange={(v) => setSettings({ reduceMotion: !v })} label="动态效果" desc="水波、光柱与转场演出；开启减少动态时视频背景回退静态图" />
            <Toggle on={settings.focusAlloutEnabled} onChange={v=>setSettings({focusAlloutEnabled:v})} label="专注结束展示完成画面" desc="默认关闭，直接进入成长结算。源码示例使用静态背景，不附游戏视频。" />
            {PERSONAL_EDITION&&<div className="presentation-previews">
            <button className="btn" onClick={() => {const before={knowledge:58,will:26,expression:14,care:40,craft:12};useApp.getState().pushPopups([{dimension:'knowledge',points:5,levelUp:true,before,after:{knowledge:63,will:28,expression:14,care:41,craft:12},preview:true}])}}><span>预览成长演出</span></button>
            <button className="btn" onClick={()=>setPreviewAllout(true)}>预览完成画面</button>
            {previewAllout && createPortal(<AlloutFinish seconds={1500} task="演出预览 · 不计入记录" preview onDone={()=>setPreviewAllout(false)} />,document.body)}
            <button className="btn" onClick={()=>{const before={knowledge:25,will:12,expression:6,care:8,craft:16};useApp.getState().pushPopups([{dimension:'will',points:1,levelUp:false,before,after:{...before,will:13},preview:true}])}}>预览轻微成长</button>
            <button className="btn" onClick={()=>{const before={knowledge:58,will:59,expression:178,care:359,craft:598};useApp.getState().pushPopups([{dimension:'knowledge',points:5,levelUp:true,before,after:{knowledge:63,will:60,expression:180,care:362,craft:602},preview:true}])}}>预览五维共鸣</button>
            <p className="scene-hint">音符表示收获的强弱，等级与称号呈现长期成长。预览不会改变学习记录；减少动态时直接显示静态能力图。</p>
            </div>}
            <Toggle on={settings.particles} onChange={(v) => setSettings({ particles: v })} label="气泡与漂浮粒子" />
            <Toggle on={settings.showCharacter} onChange={(v) => setSettings({ showCharacter: v })} label="主角立绘" />
</section></aside></div></div>
}
