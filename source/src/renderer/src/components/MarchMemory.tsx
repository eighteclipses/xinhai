import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp } from '../store/app'
import { useReducedEffects } from '../lib/motion'
import { isMarchFifth, marchMemoryKey } from '../../../shared/anniversary'
import '../styles/march-memory.css'

const chapters = [
  { name: '赴约', overline: 'THE SPRING RETURNS', lines: ['又到', '三月五日。'], note: '一年里的这一天，', after: '留给一个没有忘记的约定。', action: '走进春天' },
  { name: '回声', overline: 'キミの記憶 / MEMORIES OF YOU', lines: ['樱花的花语是', '勿忘我'], note: '花会再次盛开，', after: '而那个约定，一直都在。', action: '继续向前' },
  { name: '明日', overline: 'UNTIL THE NEXT SPRING', lines: ['把约定', '带去明天。'], note: '好好生活，继续向前。', after: '等春天回来，我们再见。', action: '收好这一刻' }
] as const

const flowers = [
  [847, 124, 1.05, 18], [808, 199, .72, -13], [854, 249, .8, 31],
  [753, 267, 1.12, 8], [695, 327, .78, -28], [626, 358, .94, 13],
  [578, 417, .65, 35], [735, 166, .73, -20], [678, 221, .58, 15],
  [908, 179, .64, -3], [896, 329, .67, 17], [789, 353, .48, -13]
]

function SakuraBranch() {
  const flowerId = 'march-flower-' + useId().replaceAll(':', '')
  return <svg className="march-memory-branch" viewBox="0 0 1000 800" fill="none" aria-hidden="true">
    <defs><g id={flowerId}>
      {[0, 72, 144, 216, 288].map(angle => <path key={angle} transform={`rotate(${angle})`} d="M0 1C-13-6-18-23-7-27L0-23L7-27C18-23 13-6 0 1Z" fill="currentColor" />)}
      <circle r="3" fill="#fff5e8" />
      {[0, 72, 144, 216, 288].map(angle => <path key={angle} transform={`rotate(${angle})`} d="M0 0L0-13M-1-13H1" stroke="#fff5e8" strokeWidth="1.1" />)}
    </g></defs>
    <g className="march-memory-twigs" strokeLinecap="round">
      <path d="M1012-30C912 38 874 98 837 163C800 234 730 304 634 365C603 388 577 410 548 442" strokeWidth="6" />
      <path d="M841 158C809 174 773 175 735 166M790 242C746 248 710 238 678 221M726 300C753 326 772 339 789 353M876 103C887 135 900 158 908 179M852 141C841 132 846 121 847 124M805 219L808 199M788 243C812 239 837 242 854 249M665 346C651 347 637 352 626 358M601 390L578 417M909 64C894 168 877 248 896 329" strokeWidth="2.1" />
      <path d="M807 217C791 202 785 186 780 172M747 285L753 267M682 336L695 327M861 141L886 129M622 373L617 399" strokeWidth="1" />
    </g>
    <g className="march-memory-blossoms">{flowers.map(([x, y, scale, angle], index) => <use key={index} href={'#' + flowerId} transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`} style={{ '--bloom-delay': `${index * .065}s` } as CSSProperties} />)}</g>
    <g className="march-memory-distant-blossoms" fill="currentColor">
      <path d="M918 413C901 404 899 387 914 389C925 377 933 399 918 413Z" />
      <path d="M510 476C497 469 501 456 510 460C522 451 523 468 510 476Z" />
      <path d="M727 468C716 462 719 451 727 454C737 446 738 461 727 468Z" />
    </g>
  </svg>
}

function MemoryExperience({ preview, year, reduce, onRemember, onClose }: { preview: boolean; year: number; reduce: boolean; onRemember: () => void; onClose: () => void }) {
  const [chapter, setChapter] = useState(0)
  const [closing, setClosing] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const action = useRef<HTMLButtonElement>(null)
  const closingRef = useRef(false)
  const exitTimer = useRef<ReturnType<typeof setTimeout>>()
  const closeCallback = useRef(onClose)
  closeCallback.current = onClose
  const titleId = useId(), descriptionId = useId()
  const current = chapters[chapter]

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.showModal()
    action.current?.focus({ preventScroll: true })
    return () => {
      clearTimeout(exitTimer.current)
      if (element.open) element.close()
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  function dismiss(remember = false) {
    if (closingRef.current) return
    closingRef.current = true
    // An explicit collection must survive an immediate background/unmount.
    // Persistence belongs to this click, independently of the exit animation.
    if (remember) onRemember()
    setClosing(true)
    // Keep the native modal and its focus ownership until the curtain has left.
    exitTimer.current = setTimeout(() => closeCallback.current(), reduce ? 0 : 320)
  }

  return createPortal(<dialog ref={dialog} className={'march-memory' + (reduce ? ' march-memory-still' : '')}
    aria-labelledby={titleId} aria-describedby={descriptionId} data-chapter={chapter + 1} data-preview={preview || undefined} data-closing={closing || undefined}
    onCancel={event => { event.preventDefault(); dismiss() }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const first = buttons[0], last = buttons[buttons.length - 1]
      if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first)?.focus({ preventScroll: true })
      }
    }}>
    <div className="march-memory-world" aria-hidden="true">
      <div className="march-memory-halo" /><div className="march-memory-horizon" />
      <div className="march-memory-date"><span>03</span><i /><span>05</span></div>
      <SakuraBranch />
      <div className="march-memory-petals">{Array.from({ length: 7 }, (_, index) => <i key={index} style={{ '--petal-x': `${52 + index * 7}%`, '--petal-y': `${14 + index % 4 * 11}%`, '--petal-delay': `${-index * 1.9}s`, '--petal-time': `${15 + index % 3 * 3}s`, '--petal-size': `${7 + index % 3 * 2}px` } as CSSProperties} />)}</div>
      <span className="march-memory-watermark">MEMENTO</span>
    </div>

    <header className="march-memory-header">
      <div className="march-memory-edition"><span className="march-memory-mark" aria-hidden="true">✦</span><span>STUDY IN THE BLUE<small>A PROMISE / {year}</small></span></div>
      <button type="button" className="march-memory-leave" disabled={closing} onClick={() => dismiss()} aria-label="暂时离开三月五日的约定">暂时离开 <span aria-hidden="true">×</span></button>
    </header>

    <div className="march-memory-main">
      <div className="march-memory-dateline"><span>三月五日的约定</span><i /><span>03 / 05</span></div>
      <div className="march-memory-story" aria-live="polite" aria-atomic="true">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={chapter} className="march-memory-chapter" initial={reduce ? false : { opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduce ? 0 : -10 }} transition={{ duration: reduce ? 0 : .32, ease: [.22, 1, .36, 1] }}>
            <p className="march-memory-overline">{current.overline}</p>
            <h1 id={titleId}>{current.lines.map((line, index) => <span key={line} className={index === 1 ? 'march-memory-emphasis' : undefined}>{line}</span>)}</h1>
            <p id={descriptionId} className="march-memory-note">{current.note}<br />{current.after}</p>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="march-memory-actions">
        <button ref={action} type="button" className="march-memory-continue" disabled={closing} onClick={() => chapter === chapters.length - 1 ? dismiss(true) : setChapter(chapter + 1)}>
          <span>{current.action}</span><svg width="46" height="18" viewBox="0 0 46 18" fill="none" aria-hidden="true"><path d="M0 9H43M35 1L43 9L35 17" stroke="currentColor" /></svg>
        </button>
        {chapter > 0 && <button type="button" className="march-memory-back" disabled={closing} onClick={() => setChapter(chapter - 1)} aria-label="回到上一幕">上一幕</button>}
      </div>
    </div>

    <footer className="march-memory-footer">
      <ol className="march-memory-progress" aria-label="纪念演出章节进度">{chapters.map((item, index) => <li key={item.name} aria-current={chapter === index ? 'step' : undefined} data-past={index < chapter || undefined}><span>0{index + 1}</span><i /><span>{item.name}</span></li>)}</ol>
      <p>{preview ? '演出预览 · 这一刻不会记入年度记录' : '有些约定，会随着春天回来。'}</p>
    </footer>
  </dialog>, document.body)
}

export default function MarchMemory() {
  const [now, setNow] = useState(() => new Date())
  const [dismissed, setDismissed] = useState('')
  const [preview, setPreview] = useState(false)
  const [unavailable, setUnavailable] = useState(true)
  const page = useApp(state => state.page)
  const focusFinish = useApp(state => state.focusFinish)
  const focusClock = useApp(state => state.focusClock)
  const popupCount = useApp(state => state.popups.length)
  const reduce = useReducedEffects()

  useEffect(() => {
    const sync = () => setNow(new Date())
    const timer = setInterval(sync, 30000)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    const showPreview = () => { sync(); setPreview(true) }
    window.addEventListener('xinhai-preview-march-memory', showPreview)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('xinhai-preview-march-memory', showPreview)
    }
  }, [])

  useEffect(() => {
    // Native dialogs already own focus; wait until the announcement or any other
    // modal has finished. Wallpaper viewing is also a deliberately quiet space.
    const sync = () => setUnavailable(document.hidden || !!document.querySelector('.study-shell.ui-hidden, dialog[open]:not(.march-memory), [aria-modal="true"]:not(.march-memory)'))
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'class', 'aria-modal'] })
    document.addEventListener('visibilitychange', sync)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', sync) }
  }, [])

  const key = marchMemoryKey(now)
  let seen = false
  try { seen = localStorage.getItem(key) === 'seen' } catch { /* Session dismissal still works without storage. */ }
  const available = page === 'home' && !focusFinish && !focusClock && !popupCount && !unavailable
  const visible = available && (preview || (isMarchFifth(now) && !seen && dismissed !== key))
  function close() {
    setDismissed(key)
    setPreview(false)
  }
  function remember() {
    if (!preview) {
      try { localStorage.setItem(key, 'seen') } catch { /* Do not block returning to study if storage is unavailable. */ }
    }
  }
  return visible ? <MemoryExperience preview={preview} year={now.getFullYear()} reduce={reduce} onRemember={remember} onClose={close} /> : null
}
