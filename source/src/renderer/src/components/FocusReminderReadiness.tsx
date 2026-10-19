import { useEffect, useState } from 'react'
import { useApp } from '../store/app'
import type { FocusReminderCapability } from '../../../shared/focusReminderCapability'

/** Capability information only; starting a timer never opens a settings screen. */
export default function FocusReminderReadiness({ active = true }: { active?: boolean }) {
  const [status, setStatus] = useState<FocusReminderCapability | null>(null)
  useEffect(() => {
    if (!active || !window.api.focusReminderStatus) return
    let live = true
    const refresh = () => { void window.api.focusReminderStatus().then(value => { if (live) setStatus(value) }).catch(() => {}) }
    refresh(); window.addEventListener('focus', refresh); window.addEventListener('xinhai-resume', refresh)
    return () => { live = false; window.removeEventListener('focus', refresh); window.removeEventListener('xinhai-resume', refresh) }
  }, [active])
  if (!active || status?.platform !== 'android' || (status.notificationsGranted && status.exactAlarmsGranted)) return null
  return <p className="scene-hint focus-reminder-readiness" role="status">
    后台准时提醒尚未就绪，系统可能延后通知。
    <button type="button" className="btn" style={{ marginLeft: 9, padding: '5px 9px', fontSize: 11 }} onClick={() => {
      useApp.getState().go('settings')
      requestAnimationFrame(() => document.getElementById('focus-settings-title')?.scrollIntoView({ block: 'center' }))
    }}>检查提醒权限</button>
  </p>
}
