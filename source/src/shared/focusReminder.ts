export interface FocusReminderInput { token: string; deadline: number; title: string }

export function validateFocusReminder(input: FocusReminderInput): FocusReminderInput {
  if (!input || typeof input.token !== 'string' || !input.token || input.token.length > 160 ||
    !Number.isFinite(input.deadline) || input.deadline > Date.now() + 7 * 86400000 ||
    typeof input.title !== 'string' || input.title.length > 100) throw Error('专注提醒参数无效')
  return { token: input.token, deadline: input.deadline, title: input.title }
}
