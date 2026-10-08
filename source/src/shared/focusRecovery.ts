import type { FocusCommitInput } from './types'

export const FOCUS_RECOVERY_VERSION = 1 as const
export const MAX_RECOVERY_SECONDS = 604800

export type RecoveryMode = 'focus' | 'short' | 'long'
export type RecoveryRunState = 'running' | 'paused' | 'saving'
export type RecoveryChoice = 'include-away' | 'discard-away' | 'abandon'

export interface FocusRecoveryRecord {
  version: typeof FOCUS_RECOVERY_VERSION
  token: string
  mode: RecoveryMode
  runState: RecoveryRunState
  countUp: boolean
  focusMin: number
  shortMin: number
  longMin: number
  cycles: number
  doneRounds: number
  taskLabel: string
  todoId: number | null
  startedAt: number
  phaseElapsedSeconds: number
  focusSeconds: number
  phaseStartedAt: number | null
  checkpointAt: number
  pendingCommit: FocusCommitInput | null
}

export interface FocusRecoveryLoad {
  record: FocusRecoveryRecord | null
  clearedCorrupt: boolean
}

export interface FocusRecoveryAssessment {
  record: FocusRecoveryRecord
  awaySeconds: number
  projectedPhaseSeconds: number
  phaseLimitSeconds: number | null
  reachedLimit: boolean
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)

function validCommit(value: unknown): value is FocusCommitInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return text(row.token, 160) && !!row.token && finite(row.startedAt) && finite(row.endedAt) && row.endedAt >= row.startedAt && integer(row.seconds, 0, MAX_RECOVERY_SECONDS) && text(row.mode, 40) && text(row.taskLabel, 800) && (row.todoId === null || integer(row.todoId, 0, Number.MAX_SAFE_INTEGER))
}

/** Strictly validate the persisted envelope before any renderer recovery UI uses it. */
export function parseFocusRecovery(value: unknown): FocusRecoveryRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (row.version !== FOCUS_RECOVERY_VERSION || !text(row.token, 160) || !row.token) return null
  if (row.mode !== 'focus' && row.mode !== 'short' && row.mode !== 'long') return null
  if (row.runState !== 'running' && row.runState !== 'paused' && row.runState !== 'saving') return null
  if (typeof row.countUp !== 'boolean' || !integer(row.focusMin, 1, 180) || !integer(row.shortMin, 1, 60) || !integer(row.longMin, 1, 60) || !integer(row.cycles, 2, 12) || !integer(row.doneRounds, 0, 100000)) return null
  if (!text(row.taskLabel, 800) || (row.todoId !== null && !integer(row.todoId, 0, Number.MAX_SAFE_INTEGER))) return null
  if (!finite(row.startedAt) || row.startedAt <= 0 || !integer(row.phaseElapsedSeconds, 0, MAX_RECOVERY_SECONDS) || !integer(row.focusSeconds, 0, MAX_RECOVERY_SECONDS) || !integer(row.checkpointAt, 1, Number.MAX_SAFE_INTEGER)) return null
  if (row.phaseStartedAt !== null && (!finite(row.phaseStartedAt) || row.phaseStartedAt <= 0)) return null
  if (row.runState === 'running' && row.phaseStartedAt === null) return null
  if (row.runState !== 'running' && row.phaseStartedAt !== null) return null
  if (row.runState === 'saving' ? !validCommit(row.pendingCommit) : row.pendingCommit !== null) return null
  if (row.pendingCommit) {
    const commit = row.pendingCommit as FocusCommitInput
    if (commit.token !== row.token || commit.startedAt !== row.startedAt || commit.taskLabel !== row.taskLabel || commit.todoId !== row.todoId) return null
  }
  return {
    version: FOCUS_RECOVERY_VERSION,
    token: row.token,
    mode: row.mode,
    runState: row.runState,
    countUp: row.countUp,
    focusMin: row.focusMin,
    shortMin: row.shortMin,
    longMin: row.longMin,
    cycles: row.cycles,
    doneRounds: row.doneRounds,
    taskLabel: row.taskLabel,
    todoId: row.todoId,
    startedAt: row.startedAt,
    phaseElapsedSeconds: row.phaseElapsedSeconds,
    focusSeconds: row.focusSeconds,
    phaseStartedAt: row.phaseStartedAt,
    checkpointAt: row.checkpointAt,
    pendingCommit: row.pendingCommit as FocusCommitInput | null
  }
}

function phaseLimit(record: FocusRecoveryRecord): number | null {
  if (record.mode === 'focus' && record.countUp) return MAX_RECOVERY_SECONDS
  return (record.mode === 'focus' ? record.focusMin : record.mode === 'short' ? record.shortMin : record.longMin) * 60
}

/**
 * Calculate the uncheckpointed interval without mutating the stored record.
 * Paused and saving records deliberately contribute zero away time.
 */
export function assessFocusRecovery(record: FocusRecoveryRecord, now = Date.now()): FocusRecoveryAssessment {
  const safeNow = Math.max(record.checkpointAt, Number.isFinite(now) ? now : record.checkpointAt)
  const awaySeconds = record.runState === 'running' ? Math.max(0, Math.floor((safeNow - record.checkpointAt) / 1000)) : 0
  const limit = phaseLimit(record)
  const projected = Math.min(limit ?? MAX_RECOVERY_SECONDS, record.phaseElapsedSeconds + awaySeconds)
  return { record, awaySeconds, projectedPhaseSeconds: projected, phaseLimitSeconds: limit, reachedLimit: limit !== null && projected >= limit }
}

/** Apply an explicit recovery choice and start a fresh checkpoint interval. */
export function applyRecoveryChoice(record: FocusRecoveryRecord, choice: RecoveryChoice, now = Date.now()): FocusRecoveryRecord | null {
  if (choice === 'abandon') return null
  const assessment = assessFocusRecovery(record, now)
  const phaseElapsedSeconds = choice === 'include-away' ? assessment.projectedPhaseSeconds : record.phaseElapsedSeconds
  const addedFocusSeconds = record.mode === 'focus' && choice === 'include-away'
    ? Math.max(0, phaseElapsedSeconds - record.phaseElapsedSeconds)
    : 0
  return {
    ...record,
    runState: 'running',
    phaseElapsedSeconds,
    focusSeconds: Math.min(MAX_RECOVERY_SECONDS, record.focusSeconds + addedFocusSeconds),
    phaseStartedAt: now,
    checkpointAt: now,
    pendingCommit: null
  }
}

/** Create a durable checkpoint from the current in-memory counters. */
export function checkpointFocusRecovery(record: FocusRecoveryRecord, input: { runState: RecoveryRunState; phaseElapsedSeconds: number; focusSeconds: number; now?: number; pendingCommit?: FocusCommitInput | null }): FocusRecoveryRecord {
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now()
  return {
    ...record,
    runState: input.runState,
    phaseElapsedSeconds: Math.max(0, Math.min(MAX_RECOVERY_SECONDS, Math.floor(input.phaseElapsedSeconds))),
    focusSeconds: Math.max(0, Math.min(MAX_RECOVERY_SECONDS, Math.floor(input.focusSeconds))),
    phaseStartedAt: input.runState === 'running' ? now : null,
    checkpointAt: Math.max(1, Math.floor(now)),
    pendingCommit: input.runState === 'saving' ? input.pendingCommit ?? null : null
  }
}

export function recoveryMode(value: string): RecoveryMode {
  return value === 'short' || value === 'long' ? value : 'focus'
}
