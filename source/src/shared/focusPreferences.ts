import type { Settings } from './types'

export const FOCUS_PANEL_MIN_SCALE = .65
export const FOCUS_PANEL_MAX_SCALE = 1.6
export function parseFocusPanelLayout(value: unknown): Settings['focusPanelLayout'] {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('专注面板位置无效')
  const row = value as Record<string, unknown>
  if (Object.keys(row).length !== 3 || !['x', 'y', 'scale'].every(key => Object.hasOwn(row,key) && typeof row[key] === 'number' && Number.isFinite(row[key]))) throw Error('专注面板位置无效')
  const x = row.x as number, y = row.y as number, scale = row.scale as number
  if (x < 0 || x > 1 || y < 0 || y > 1 || scale < FOCUS_PANEL_MIN_SCALE || scale > FOCUS_PANEL_MAX_SCALE) throw Error('专注面板位置或比例超出范围')
  return { x, y, scale }
}
export function validateFocusPreferences(patch: Partial<Settings>): Partial<Settings> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('设置内容无效')
  if (patch.focusPanelLayout !== undefined) patch = { ...patch, focusPanelLayout: parseFocusPanelLayout(patch.focusPanelLayout) }
  if (patch.focusBackgroundBehavior !== undefined && !['wait', 'continue'].includes(patch.focusBackgroundBehavior)) throw Error('后台计时方式无效')
  if (patch.focusRewardPresentation !== undefined && !['round', 'batch'].includes(patch.focusRewardPresentation)) throw Error('音符结算方式无效')
  return patch
}
