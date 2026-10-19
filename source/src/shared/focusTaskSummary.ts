import type { FocusTaskSummary } from './types'

/** Only whitespace is normalized; task spelling and letter case stay distinct. */
export function normalizeFocusTaskLabel(value: string): string {
  return value.trim().replace(/\s+/gu, ' ') || '自由专注'
}

export type RawFocusTaskSummary = {
  taskLabel: string; seconds: number; sessionCount: number; lastEndedAt: number; legacySessionCount: number
}

export function mergeFocusTaskSummary(rows: RawFocusTaskSummary[]): FocusTaskSummary {
  const tasks = new Map<string, FocusTaskSummary['tasks'][number]>()
  let totalSeconds = 0, sessionCount = 0, legacySessionCount = 0
  for (const row of rows) {
    const taskLabel = normalizeFocusTaskLabel(row.taskLabel)
    const task = tasks.get(taskLabel) ?? { taskLabel, seconds: 0, sessionCount: 0, lastEndedAt: 0, legacySessionCount: 0 }
    task.seconds += row.seconds
    task.sessionCount += row.sessionCount
    task.legacySessionCount += row.legacySessionCount
    task.lastEndedAt = Math.max(task.lastEndedAt, row.lastEndedAt)
    tasks.set(taskLabel, task)
    totalSeconds += row.seconds; sessionCount += row.sessionCount; legacySessionCount += row.legacySessionCount
  }
  return { totalSeconds, sessionCount, legacySessionCount, tasks: [...tasks.values()].sort((a, b) =>
    b.seconds - a.seconds || b.lastEndedAt - a.lastEndedAt || a.taskLabel.localeCompare(b.taskLabel, 'zh-CN')) }
}
