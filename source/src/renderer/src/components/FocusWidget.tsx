import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { useApp } from '../store/app'
import { useReducedEffects } from '../lib/motion'
import '../styles/focus-widget.css'

type Layout = { x: number; y: number; scale: number }
type Viewport = { width: number; height: number; top: number; bottom: number }
const BASE_WIDTH = 440, SCALE_MIN = .65, SCALE_MAX = 1.6
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
function normalized(value: Layout | null | undefined): Layout | null {
  if (!value || ![value.x, value.y, value.scale].every(Number.isFinite)) return null
  return { x: clamp(value.x, 0, 1), y: clamp(value.y, 0, 1), scale: clamp(value.scale, SCALE_MIN, SCALE_MAX) }
}
function viewport(): Viewport {
  const shell = document.querySelector('.study-shell') ?? document.documentElement, style = getComputedStyle(shell)
  return { width: innerWidth, height: innerHeight, top: 12 + (parseFloat(style.getPropertyValue('--title-height')) || 44), bottom: 12 + (parseFloat(style.getPropertyValue('--nav-height')) || 42) + (parseFloat(style.getPropertyValue('--music-height')) || 48) }
}

/** A layout-only wrapper: timer state and all learning actions remain in Focus. */
export default function FocusWidget({ children }: { children: ReactNode }) {
  const saved = useApp(state => state.settings.focusPanelLayout)
  const anchor = useApp(state => state.settings.timerPosition)
  const page = useApp(state => state.page)
  const setSettings = useApp(state => state.setSettings)
  const reduce = useReducedEffects()
  const [area, setArea] = useState(viewport)
  const [baseHeight, setBaseHeight] = useState(390)
  const [editorHeight, setEditorHeight] = useState(90)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Layout | null>(() => normalized(saved))
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const busyRef = useRef(false)
  const content = useRef<HTMLDivElement>(null), pencil = useRef<HTMLButtonElement>(null), mover = useRef<HTMLButtonElement>(null)
  const editor = useRef<HTMLElement>(null)
  const gesture = useRef<{ id: number; x: number; y: number; left: number; top: number; scale: number; width: number; height: number; kind: 'move' | 'resize' } | null>(null)
  const fallback = { x: anchor === 'center' ? .5 : anchor === 'right' ? .92 : .08, y: anchor === 'bottom' ? 1 : .5, scale: 1 }
  const layout = (editing ? draft : normalized(saved)) ?? fallback
  const availableWidth = Math.max(1, area.width - 24), availableHeight = Math.max(1, area.height - area.top - area.bottom - (editing ? editorHeight + 12 : 0))
  const effectiveScale = Math.max(.1, Math.min(layout.scale, availableWidth / BASE_WIDTH, availableHeight / baseHeight))
  const width = BASE_WIDTH * effectiveScale, height = baseHeight * effectiveScale
  const maxX = Math.max(0, availableWidth - width), maxY = Math.max(0, availableHeight - height)
  const left = 12 + maxX * layout.x, top = area.top + maxY * layout.y

  useLayoutEffect(() => {
    const element = content.current
    if (!element) return
    const measure = () => setBaseHeight(Math.max(1, element.offsetHeight))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const resize = () => { gesture.current = null; setArea(viewport()) }
    addEventListener('resize', resize)
    window.visualViewport?.addEventListener('resize', resize)
    const observer = new ResizeObserver(resize)
    observer.observe(document.documentElement)
    return () => { removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize); observer.disconnect() }
  }, [])
  useEffect(() => {
    if (content.current) content.current.inert = editing
    if (editing) mover.current?.focus({ preventScroll: true })
  }, [editing])
  useLayoutEffect(() => {
    if (!editing || !editor.current) return
    const element = editor.current, measure = () => setEditorHeight(element.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [editing])
  useEffect(() => {
    if (!editing) return
    // Pointer capture is not reliable in every embedded WebView; retain the
    // gesture across the viewport even when capture could not be obtained.
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end) }
  })
  useEffect(() => {
    if (page !== 'focus' && !busyRef.current) { setEditing(false); gesture.current = null }
  }, [page])
  useEffect(() => {
    const hidden = () => { if (document.hidden && !busyRef.current) { setEditing(false); gesture.current = null } }
    const blur = () => { gesture.current = null }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('blur', blur)
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('blur', blur) }
  }, [])

  function beginEdit() { setDraft(normalized(saved)); setError(''); setEditing(true) }
  function cancel() {
    if (busyRef.current) return
    gesture.current = null; setEditing(false); setError('')
    requestAnimationFrame(() => pencil.current?.focus({ preventScroll: true }))
  }
  function positionAt(x: number, y: number, scale = layout.scale, panelWidth = width, panelHeight = height): Layout {
    const dx = Math.max(0, availableWidth - panelWidth), dy = Math.max(0, availableHeight - panelHeight)
    return { x: dx ? clamp((x - 12) / dx, 0, 1) : layout.x, y: dy ? clamp((y - area.top) / dy, 0, 1) : layout.y, scale }
  }
  function start(event: PointerEvent<HTMLButtonElement>, kind: 'move' | 'resize') {
    if (busyRef.current || event.button !== 0 || gesture.current) return
    event.preventDefault(); event.stopPropagation()
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left, top, scale: layout.scale, width, height, kind }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Window pointer listeners cover capture loss. */ }
  }
  function move(event: Pick<globalThis.PointerEvent, 'pointerId' | 'clientX' | 'clientY' | 'preventDefault'>) {
    const active = gesture.current
    if (!active || active.id !== event.pointerId || busyRef.current) return
    event.preventDefault()
    const dx = event.clientX - active.x, dy = event.clientY - active.y
    if (active.kind === 'move') setDraft(positionAt(active.left + dx, active.top + dy))
    else {
      const delta = Math.abs(dx / BASE_WIDTH) > Math.abs(dy / baseHeight) ? dx / BASE_WIDTH : dy / baseHeight
      const scale = clamp(active.scale + delta, SCALE_MIN, SCALE_MAX)
      const effective = Math.max(.1, Math.min(scale, availableWidth / BASE_WIDTH, availableHeight / baseHeight))
      setDraft(positionAt(active.left, active.top, scale, BASE_WIDTH * effective, baseHeight * effective))
    }
  }
  function end(event: Pick<globalThis.PointerEvent, 'pointerId'>) { if (gesture.current?.id === event.pointerId) gesture.current = null }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, resize = false) {
    if (busyRef.current) return
    const offsets: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    if (['+', '=', '-'].includes(event.key) || (resize && offsets[event.key])) {
      event.preventDefault(); event.stopPropagation()
      const negative = event.key === '-' || event.key === 'ArrowLeft' || event.key === 'ArrowUp'
      setDraft({ ...layout, scale: clamp(layout.scale + (negative ? -.05 : .05), SCALE_MIN, SCALE_MAX) })
    } else if (offsets[event.key]) {
      event.preventDefault(); event.stopPropagation()
      const [x, y] = offsets[event.key], step = event.shiftKey ? 24 : 8
      setDraft(positionAt(left + x * step, top + y * step))
    }
  }
  async function save() {
    if (busyRef.current) return
    busyRef.current = true; gesture.current = null; setBusy(true); setError('')
    // The editor reserves room for its toolbar. Persist against the normal
    // travel area so a manually placed panel does not jump when that bar leaves.
    const normalHeight = Math.max(1, area.height - area.top - area.bottom)
    const normalScale = Math.max(.1, Math.min(layout.scale, availableWidth / BASE_WIDTH, normalHeight / baseHeight))
    const normalX = Math.max(0, availableWidth - BASE_WIDTH * normalScale), normalY = Math.max(0, normalHeight - baseHeight * normalScale)
    const value = draft && {
      x: Math.round((normalX ? clamp((left - 12) / normalX, 0, 1) : draft.x) * 10000) / 10000,
      y: Math.round((normalY ? clamp((top - area.top) / normalY, 0, 1) : draft.y) * 10000) / 10000,
      scale: Math.round(draft.scale * 1000) / 1000
    }
    try { await setSettings({ focusPanelLayout: value }); setEditing(false); requestAnimationFrame(() => pencil.current?.focus({ preventScroll: true })) }
    catch { setError('位置未能保存，请重试；取消可保留原来的布局。') }
    finally { busyRef.current = false; setBusy(false) }
  }

  return <div className={'focus-widget-layer' + (reduce ? ' focus-widget-still' : '')} onKeyDown={event => { if (editing && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() } }}>
    <section className={'focus-widget' + (editing ? ' is-editing' : '')} data-layout-anchor={anchor} aria-label="专注计时面板" style={{ left, top, width, height, '--focus-widget-scale': effectiveScale } as CSSProperties}>
      <div ref={content} className="focus-widget-content">{children}</div>
      {!editing && <button ref={pencil} type="button" className="focus-widget-pencil" onClick={beginEdit} aria-label="调整专注面板位置和大小" title="调整位置和大小"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M12.5 3.5L16.5 7.5M3.5 16.5L4.5 12.5L13.5 3.5C14.6 2.4 15.6 2.6 16.5 3.5C17.4 4.4 17.6 5.4 16.5 6.5L7.5 15.5L3.5 16.5Z" stroke="currentColor" strokeWidth="1.2" /></svg></button>}
      {editing && <><button ref={mover} type="button" className="focus-widget-move" disabled={busy} aria-label="拖动专注面板，方向键移动，加减键缩放" onPointerDown={event => start(event, 'move')} onLostPointerCapture={end} onKeyDown={event => keyboard(event)}><span aria-hidden="true">⠿ <small>拖动调整</small></span></button><button type="button" className="focus-widget-resize" disabled={busy} aria-label="缩放专注面板，方向键或加减键调整" onPointerDown={event => start(event, 'resize')} onLostPointerCapture={end} onKeyDown={event => keyboard(event, true)}><svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 16L16 5M10 16H16V10" stroke="currentColor" strokeWidth="1.4" /></svg></button></>}
    </section>
    {editing && <section ref={editor} className="focus-widget-editor" role="group" aria-label="编辑专注面板布局" style={{ bottom: area.bottom }}>
      <div className="focus-widget-editor-copy"><strong>留一处，刚好的位置。</strong><span>拖动面板 · 右下角缩放 · 方向键微调</span></div>
      <label className="focus-widget-scale">大小 <output>{Math.round(layout.scale * 100)}%</output><input aria-label="专注面板大小" type="range" min={SCALE_MIN} max={SCALE_MAX} step={.01} value={layout.scale} disabled={busy} onChange={event => setDraft({ ...layout, scale: Number(event.target.value) })} /></label>
      <div className="focus-widget-editor-actions"><button type="button" disabled={busy} onClick={() => { gesture.current = null; setDraft(null); setError('') }}>恢复默认</button><button type="button" disabled={busy} onClick={cancel}>取消</button><button type="button" className="focus-widget-save" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存'}</button></div>
      {(error || effectiveScale < layout.scale - .01) && <p className={error ? 'focus-widget-error' : 'focus-widget-fit'} role={error ? 'alert' : undefined}>{error || '面板已临时适配当前窗口，保存的大小不会随窗口变化。'}</p>}
    </section>}
  </div>
}
