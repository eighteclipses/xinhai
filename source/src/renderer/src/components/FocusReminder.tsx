import { useId, useSyncExternalStore } from 'react'
import { useApp } from '../store/app'
import '../styles/focus-reminder.css'

type Reminder = { id: number; title: string }
// Keep unacknowledged messages across component unmounts and hidden-window renders.
// This deliberately stays separate from the timer and settlement state.
let pending: Reminder[] = []
let sequence = 0
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const getSnapshot = () => pending
const publish = () => { listeners.forEach(listener => listener()) }

function enqueue(title: string) {
  pending = [...pending, { id: ++sequence, title: title.trim() || '这一段计时已结束' }]
  publish()
}
// Retain the event entry point used by native callbacks and existing UI checks.
// The listener lives with the queue so remounting the strip cannot lose a message.
window.addEventListener('xinhai-focus-finished', event => {
  const title = (event as CustomEvent<unknown>).detail
  if (typeof title === 'string') enqueue(title)
})

export function showFocusReminder(title: string) {
  window.dispatchEvent(new CustomEvent('xinhai-focus-finished', { detail: title }))
}

function dismissReminders() {
  pending = []
  publish()
}

export default function FocusReminder({ onOpenFocus }: { onOpenFocus: () => void }) {
  const messages = useSyncExternalStore(subscribe, getSnapshot)
  const presenting = useApp(state => state.popups.length > 0 || !!state.focusFinish || !!state.focusRewardPresentation)
  const titleId = useId()
  const current = messages[messages.length - 1]
  // Let notes, growth and the completion film finish before displaying the full strip.
  // The queue remains intact, including messages that arrived in the background.
  if (!current || presenting) return null
  // Acknowledge this batch once; background phase changes must not create a
  // stack of obsolete messages that each require a separate close action.
  const dismiss = dismissReminders
  return <aside className="focus-reminder" aria-labelledby={titleId} onKeyDown={event => {
    // Escape applies only while interacting with this strip; learning keeps its keys.
    if (event.key === 'Escape') { event.stopPropagation(); dismiss() }
  }}>
    <span className="focus-reminder-symbol" aria-hidden="true">✓</span>
    <div className="focus-reminder-content">
      <div role="status" aria-live="polite" aria-atomic="true">
        <p className="focus-reminder-kicker">TIME / 到时了{messages.length > 1 && <span> · 另有 {messages.length - 1} 条</span>}</p>
        <h2 id={titleId}>{current.title}</h2>
        <p className="focus-reminder-hint">计时已结束，继续按自己的节奏来。</p>
      </div>
      <button type="button" className="focus-reminder-open" onClick={() => { dismiss(); onOpenFocus() }}>查看专注 <span aria-hidden="true">↗</span></button>
    </div>
    <button type="button" className="focus-reminder-close" aria-label="关闭到时提醒" title="关闭到时提醒（Esc）" onClick={dismiss}><span aria-hidden="true">×</span></button>
  </aside>
}
