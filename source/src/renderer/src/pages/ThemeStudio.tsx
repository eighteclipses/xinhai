import { useRef, useState, type FormEvent } from 'react'
import { useApp } from '../store/app'
import type { Settings } from '../../../shared/types'
import type { WallpaperItem, SavedTheme } from '../../../shared/themeLibrary'
import { originalThemes } from '../../../shared/originalThemes'
import OriginalThemeCards from '../components/OriginalThemeCards'
import ThemeSettings from '../components/ThemeSettings'
import SceneRotationSettings from '../components/SceneRotationSettings'
import Toggle from '../components/Toggle'
import '../styles/theme-studio.css'

type StudioSettings = Settings
type RunAction = (key: string, action: () => Promise<void>, onError?: (message: string) => void) => Promise<boolean>

const studioApi = () => window.api
const studioSettings = (value: Settings) => value
const errorText = (error: unknown) => error instanceof Error
  ? error.message.replace(/^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/, '').replace(/^Error:\s*/, '')
  : '操作未完成，请重试。'

function activeLibraryId(settings: StudioSettings): string | null {
  if (settings.background !== 'custom' || !settings.customBackground) return null
  if (settings.customBackground.id) return settings.customBackground.id
  return settings.wallpaperLibrary?.find(item => item.src === settings.customBackground?.src)?.id ?? null
}

function WallpaperThumb({ item }: { item: WallpaperItem }) {
  return <div className="wallpaper-library-thumb">
    {item.kind === 'video'
      ? <video src={item.src} poster={item.poster || undefined} muted loop playsInline preload="metadata" aria-label={item.name} />
      : <img src={item.poster || item.src} alt="" loading="lazy" />}
    <span className="wallpaper-library-kind">{item.kind === 'video' ? 'VIDEO' : 'IMAGE'}</span>
  </div>
}

function WallpaperLibraryPanel({ settings, busy, run, save }: { settings: StudioSettings; busy: string; run: RunAction; save: (patch: Partial<Settings>) => void }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const library = settings.wallpaperLibrary ?? []
  const selected = activeLibraryId(settings)

  async function importBackground() {
    await run('wallpaper:import', async () => {
      const result = await window.api.backgroundImport()
      if (result) {
        useApp.setState({ settings: result })
        setMessage('已收藏并应用：' + studioSettings(result).customBackground?.name)
      }
    }, setMessage)
  }
  async function apply(id: string) {
    await run(`wallpaper:apply:${id}`, async () => {
      const result = await studioApi().backgroundSelect(id)
      useApp.setState({ settings: result })
      setMessage('已应用这张壁纸。')
    }, setMessage)
  }
  async function rename(id: string) {
    const name = draft.trim()
    if (!name) { setMessage('请输入壁纸名称。'); return }
    await run(`wallpaper:rename:${id}`, async () => {
      const result = await studioApi().backgroundRename(id, name)
      useApp.setState({ settings: result }); setEditing(null); setDraft(''); setMessage('壁纸名称已保存。')
    }, setMessage)
  }
  async function remove(id: string) {
    await run(`wallpaper:remove:${id}`, async () => {
      const result = await studioApi().backgroundRemove(id)
      useApp.setState({ settings: result }); setPendingRemove(null); setMessage('已从收藏中移除，原文件仍保留。')
    }, setMessage)
  }
  function useMyWallpaper() {
    const id = selected
    if (id) { void apply(id); return }
    save({ background: 'custom' })
  }

  return <section className="glass studio-panel wallpaper-library-panel" aria-labelledby="wallpaper-library-heading">
    <span className="studio-eyebrow">01 / WALLPAPER</span>
    <h2 id="wallpaper-library-heading">带上你的风景</h2>
    <p>导入的图片和视频会收藏在本机，随时可以应用到桌面。</p>
    <div className="studio-import-actions">
      <button className="btn primary" disabled={!!busy || library.length>=100} onClick={() => void importBackground()}>{busy === 'wallpaper:import' ? '正在导入…' : '导入本地壁纸'}</button>
      {settings.customBackground && <button className="btn" aria-pressed={settings.background === 'custom'} disabled={!!busy} onClick={useMyWallpaper}>使用我的壁纸</button>}
    </div>
    <small className="studio-help">已收藏 {library.length} / 100 张{library.length>=100?'，移除不需要的收藏后可继续导入。':'。'}</small>
    {library.length > 0
      ? <div className="wallpaper-library-list" role="list" aria-label="我的壁纸">
        {library.map(item => {
          const isSelected = selected === item.id
          const isEditing = editing === item.id
          const isRemoving = pendingRemove === item.id
          return <article className={'wallpaper-library-item' + (isSelected ? ' is-selected' : '')} key={item.id} role="listitem">
            <button type="button" className="wallpaper-library-select" aria-pressed={isSelected} aria-label={`应用壁纸 ${item.name}`} disabled={!!busy} onClick={() => void apply(item.id)}>
              <WallpaperThumb item={item} />
              <span className="wallpaper-library-copy"><strong title={item.name}>{item.name}</strong><small>{isSelected ? '当前使用中' : item.kind === 'video' ? '动态壁纸' : '静态壁纸'}</small></span>
            </button>
            <div className="wallpaper-library-actions">
              <button type="button" className="btn" disabled={!!busy || isSelected} onClick={() => void apply(item.id)}>应用</button>
              <button type="button" className="btn" disabled={!!busy} onClick={() => { setEditing(item.id); setDraft(item.name); setPendingRemove(null); setMessage('') }}>重命名</button>
              <button type="button" className="btn danger" disabled={!!busy} onClick={() => { setPendingRemove(isRemoving ? null : item.id); setEditing(null); setMessage('') }}>移除</button>
            </div>
            {isEditing && <form className="library-inline-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void rename(item.id) }}>
              <input aria-label={`重命名壁纸 ${item.name}`} value={draft} maxLength={40} autoFocus onChange={event => setDraft(event.target.value)} />
              <button type="submit" className="btn" disabled={!!busy || !draft.trim()}>保存</button>
              <button type="button" className="btn" disabled={!!busy} onClick={() => { setEditing(null); setDraft('') }}>取消</button>
            </form>}
            {isRemoving && <div className="library-inline-confirm" role="alert">
              <span>移除「{item.name}」的收藏？原文件不会删除。</span>
              <button type="button" className="btn danger" disabled={!!busy} onClick={() => void remove(item.id)}>确认移除</button>
              <button type="button" className="btn" disabled={!!busy} onClick={() => setPendingRemove(null)}>取消</button>
            </div>}
          </article>
        })}
      </div>
      : <div className="library-empty"><strong>还没有收藏壁纸</strong><span>导入本地图片或视频后，会出现在这里。</span></div>}
    {settings.customBackground && <div className="studio-imported"><span>当前本地壁纸</span><strong title={settings.customBackground.name}>{settings.customBackground.name}</strong></div>}
    <small className="studio-help">PNG / JPG / WebP ≤ 30 MB；MP4 / WebM ≤ 300 MB。视频静音循环。移除只取消收藏，原文件和应用副本都会保留。</small>
    {message && <p className="library-message" role="status">{message}</p>}
    <label className="studio-select"><span>画面适配</span><select aria-label="背景显示方式" value={settings.backgroundFit} onChange={e => save({ backgroundFit: e.target.value as Settings['backgroundFit'] })}><option value="cover">铺满屏幕</option><option value="contain">完整显示</option></select></label>
    {([{ key: 'wallpaperDim', label: '壁纸暗化', max: .6, step: .02 }, { key: 'panelOpacity', label: '面板不透明度', max: .9, step: .02 }, { key: 'panelBlur', label: '面板模糊', max: 20, step: 1 }] as const).map(item => <label className="studio-slider" key={item.key}><span>{item.label}<output>{item.key === 'panelBlur' ? settings[item.key] + ' px' : Math.round(settings[item.key] * 100) + '%'}</output></span><input aria-label={item.label} type="range" min={0} max={item.max} step={item.step} value={settings[item.key]} onChange={e => save({ [item.key]: Number(e.target.value) })} /></label>)}
  </section>
}

function themeWallpaperLabel(theme: SavedTheme, wallpapers: WallpaperItem[]) {
  if (theme.wallpaper.type === 'library') return wallpapers.find(item => item.id === theme.wallpaper.id)?.name ?? '已移除的本地壁纸'
  return originalThemes.find(item=>item.id===theme.wallpaper.id)?.label ?? '原创壁纸'
}

function ThemeLibraryPanel({ settings, busy, run }: { settings: StudioSettings; busy: string; run: RunAction }) {
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const themes = settings.savedThemes ?? []
  const wallpapers = settings.wallpaperLibrary ?? []

  async function saveTheme(event?: FormEvent) {
    event?.preventDefault()
    const value = name.trim()
    if (!value) { setMessage('请输入主题名称。'); return }
    await run('theme:save', async () => {
      const result = await studioApi().themeSave(value)
      useApp.setState({ settings: result }); setName(''); setMessage('已保存当前搭配。')
    }, setMessage)
  }
  async function apply(id: string) {
    await run(`theme:apply:${id}`, async () => {
      const result = await studioApi().themeApply(id)
      useApp.setState({ settings: result }); setMessage('主题已应用，学习记录与减少动态偏好保持不变。')
    }, setMessage)
  }
  async function rename(id: string) {
    const value = draft.trim()
    if (!value) { setMessage('请输入主题名称。'); return }
    await run(`theme:rename:${id}`, async () => {
      const result = await studioApi().themeRename(id, value)
      useApp.setState({ settings: result }); setEditing(null); setDraft(''); setMessage('主题名称已保存。')
    }, setMessage)
  }
  async function remove(id: string) {
    await run(`theme:remove:${id}`, async () => {
      const result = await studioApi().themeRemove(id)
      useApp.setState({ settings: result }); setPendingRemove(null); setMessage('主题已删除。')
    }, setMessage)
  }
  async function importTheme() {
    await run('theme:import', async () => {
      const result = await Promise.resolve(studioApi().themeImport())
      if (result) { useApp.setState({ settings: result }); setMessage('主题包已导入并应用。') }
    }, setMessage)
  }
  async function exportTheme(id: string) {
    await run(`theme:export:${id}`, async () => {
      const destination = await studioApi().themeExport(id)
      if (destination) setMessage('主题包已导出：' + destination)
    }, setMessage)
  }

  return <section className="glass studio-panel theme-library-panel" aria-labelledby="theme-library-heading">
    <span className="studio-eyebrow">02 / MY THEMES</span>
    <h2 id="theme-library-heading">我的主题</h2>
    <p>保存当前的外观搭配和所用壁纸，主题包不包含学习记录或 API Key。</p>
    <form className="theme-save-form" onSubmit={event => void saveTheme(event)}>
      <input aria-label="主题名称" value={name} maxLength={40} placeholder="给这套搭配起个名字" onChange={event => setName(event.target.value)} />
      <button type="submit" className="btn primary" disabled={!!busy || !name.trim()}>{busy === 'theme:save' ? '正在保存…' : '保存当前搭配'}</button>
    </form>
    <div className="theme-import-row"><button type="button" className="btn" disabled={!!busy} onClick={() => void importTheme()}>{busy === 'theme:import' ? '正在导入…' : '导入主题包'}</button><small>主题包只带外观与所用壁纸</small></div>
    {themes.length > 0
      ? <div className="saved-theme-list" role="list" aria-label="我的主题列表">
        {themes.map(theme => {
          const isEditing = editing === theme.id
          const isRemoving = pendingRemove === theme.id
          return <article className="saved-theme-item" key={theme.id} role="listitem">
            <div className="saved-theme-main"><span className="saved-theme-swatch" style={{ background: String(theme.appearance.wallpaperThemeColor ?? theme.appearance.themeColor ?? settings.themeColor) }} /><div><strong title={theme.name}>{theme.name}</strong><small>{themeWallpaperLabel(theme, wallpapers)} · {new Date(theme.createdAt).toLocaleDateString('zh-CN')}</small></div></div>
            <div className="saved-theme-actions"><button type="button" className="btn primary" disabled={!!busy} onClick={() => void apply(theme.id)}>应用</button><button type="button" className="btn" disabled={!!busy} onClick={() => { setEditing(theme.id); setDraft(theme.name); setPendingRemove(null); setMessage('') }}>重命名</button><button type="button" className="btn" disabled={!!busy} onClick={() => { setPendingRemove(isRemoving ? null : theme.id); setEditing(null); setMessage('') }}>删除</button><button type="button" className="btn" disabled={!!busy} onClick={() => void exportTheme(theme.id)}>导出</button></div>
            {isEditing && <form className="library-inline-form" onSubmit={event => { event.preventDefault(); void rename(theme.id) }}><input aria-label={`重命名主题 ${theme.name}`} value={draft} maxLength={40} autoFocus onChange={event => setDraft(event.target.value)} /><button type="submit" className="btn" disabled={!!busy || !draft.trim()}>保存</button><button type="button" className="btn" disabled={!!busy} onClick={() => { setEditing(null); setDraft('') }}>取消</button></form>}
            {isRemoving && <div className="library-inline-confirm" role="alert"><span>删除「{theme.name}」？已收藏的壁纸不会受影响。</span><button type="button" className="btn danger" disabled={!!busy} onClick={() => void remove(theme.id)}>确认删除</button><button type="button" className="btn" disabled={!!busy} onClick={() => setPendingRemove(null)}>取消</button></div>}
          </article>
        })}
      </div>
      : <div className="library-empty"><strong>还没有保存的主题</strong><span>调好颜色、动效和布局后，在这里保存一套搭配。</span></div>}
    {message && <p className="library-message" role="status">{message}</p>}
  </section>
}

export default function ThemeStudio() {
  const settings = studioSettings(useApp(s => s.settings))
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const busyRef = useRef('')
  const save = (patch: Partial<Settings>) => { void useApp.getState().setSettings(patch).catch(() => setMessage('设置保存失败，请重试。')) }
  const run: RunAction = async (key, action, onError) => {
    if (busyRef.current) return false
    busyRef.current = key; setBusy(key); setMessage('')
    try { await action(); return true }
    catch (error) { const text = errorText(error); setMessage(text); onError?.(text); return false }
    finally { busyRef.current = ''; setBusy('') }
  }
  return <div className="theme-studio">
    <header className="studio-heading"><span>YOUR SPACE / 自定义工作室</span><h1>把桌面，调成你的样子。</h1><p>从一张喜欢的壁纸开始，让颜色、光线和时间跟随你的节奏。</p></header>
    <OriginalThemeCards />
    <ThemeSettings />
    <div className="studio-library-grid">
      <WallpaperLibraryPanel settings={settings} busy={busy} run={run} save={save} />
      <ThemeLibraryPanel settings={settings} busy={busy} run={run} />
    </div>
    <div className="studio-settings-grid">
      <section className="glass studio-panel"><span className="studio-eyebrow">03 / MOTION</span><h2>让画面轻轻呼吸</h2><p>切换、漂浮和光点可以分别调整，也可以让一切保持静止。</p>
        <label className="studio-select"><span>主题切换效果</span><select aria-label="主题切换效果" value={settings.sceneTransition} onChange={e => save({ sceneTransition: e.target.value as Settings['sceneTransition'] })}><option value="fade">柔和淡入</option><option value="arc">色彩圆弧</option><option value="none">立即切换</option></select></label>
        <label className="studio-select"><span>环境光点</span><select aria-label="环境光点" value={settings.ambientEffect} onChange={e => save({ ambientEffect: e.target.value as Settings['ambientEffect'] })}><option value="none">关闭</option><option value="motes">缓慢浮光</option><option value="stars">星点闪烁</option></select></label>
        <Toggle on={settings.wallpaperMotion} onChange={v => save({ wallpaperMotion: v })} label="静态壁纸缓慢移动" desc="为图片增加轻微推近；完整显示模式保持原画面边界。" />
        <Toggle on={settings.reduceMotion} onChange={v => save({ reduceMotion: v })} label="减少动态" desc="停止壁纸移动和环境光点，跳过切换演出；同时尊重系统的减少动态设置。" />
        <Toggle on={settings.particles} onChange={v => save({ particles: v })} label="成长反馈粒子" desc="单独控制完成任务后的成长演出粒子。" />
        <div className="studio-motion-note">浮光和星点由应用实时绘制，主题壁纸为静态图，不是循环视频。</div>
      </section>
      <section className="glass studio-panel"><span className="studio-eyebrow">04 / LAYOUT</span><h2>安排你的桌面</h2>
        <label className="studio-select"><span>日期与时钟</span><select aria-label="日期样式" value={settings.clockStyle} onChange={e => save({ clockStyle: e.target.value as Settings['clockStyle'] })}><option value="minimal">悬浮时钟</option><option value="classic">首页简洁数字</option><option value="hidden">隐藏日期</option></select></label>
        <label className="studio-select"><span>音乐播放器</span><select aria-label="播放器样式" value={settings.playerStyle} onChange={e => save({ playerStyle: e.target.value as Settings['playerStyle'] })}><option value="card">悬浮卡片</option><option value="bar">底栏播放器</option></select></label>
        <label className="studio-select"><span>专注计时位置</span><select aria-label="专注计时位置" value={settings.timerPosition} onChange={e => save({ timerPosition: e.target.value as Settings['timerPosition'] })}><option value="center">居中</option><option value="left">左侧</option><option value="right">右侧</option><option value="bottom">左下角</option></select></label>
        {([{ key: 'clockScale', label: '时钟大小', min: .5, max: 1 }, { key: 'playerScale', label: '播放器大小', min: .65, max: 1.2 }] as const).map(item => <label className="studio-slider" key={item.key}><span>{item.label}<output>{Math.round(settings[item.key] * 100)}%</output></span><input aria-label={item.label} type="range" min={item.min} max={item.max} step={.05} value={settings[item.key]} onChange={e => save({ [item.key]: Number(e.target.value) })} /></label>)}
        <Toggle on={settings.wallpaperClock} onChange={v => save({ wallpaperClock: v })} label="欣赏壁纸时保留专注计时" />
        <button className="btn" onClick={() => save({ clockPosition: null, playerPosition: null, clockScale: .8, playerScale: 1 })}>重置悬浮控件位置</button><p>拖动悬浮时钟与播放器调整位置。点击「欣赏壁纸」查看完整效果，按 Esc 或双击背景返回。</p>
      </section>
      <div className="studio-rotation"><SceneRotationSettings /></div>
    </div>
    <p className="studio-feedback" role="status">{message}</p>
  </div>
}
