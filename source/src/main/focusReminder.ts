import { app, Notification, shell } from 'electron'
import { validateFocusReminder, type FocusReminderInput } from '../shared/focusReminder'

export function createFocusReminder(onOpen: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let current: FocusReminderInput | null = null
  let notification: Notification | null = null
  const fired = new Set<string>()
  const cancel = () => { clearTimeout(timer); timer = undefined; current = null }
  app.once('before-quit', cancel)
  return (input: FocusReminderInput | null) => {
    if (input === null) { cancel(); return }
    const reminder = validateFocusReminder(input)
    if (fired.has(reminder.token)) return
    if (current?.token === reminder.token && current.deadline === reminder.deadline) return
    cancel()
    current = reminder
    const deliver = () => {
      if (current !== reminder || fired.has(reminder.token)) return
      fired.add(reminder.token)
      if (fired.size > 100) fired.delete(fired.values().next().value!)
      timer = undefined
      // OS notification works even when the renderer is background-throttled.
      try { shell.beep() } catch { /* The persistent in-app alert still appears. */ }
      try {
        if (Notification.isSupported()) {
          notification?.close()
          notification = new Notification({ title: reminder.title, body: '计时已结束。打开心海查看本轮记录。', silent: true, timeoutType: 'never' })
          notification.on('click', onOpen)
          notification.show()
        }
      } catch { /* An unavailable OS notification must not interrupt the study app. */ }
    }
    if (reminder.deadline <= Date.now()) deliver()
    else timer = setTimeout(deliver, reminder.deadline - Date.now())
  }
}
