import GrowthNotes from '../components/GrowthNotes'
import { elapsedNow } from '../lib/elapsedClock'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp } from '../store/app'
import {useFocusTasks,rememberFocusTask,deleteFocusTask} from '../store/focusTasks'
import '../styles/focus-tasks.css'
import { playDive, playClick } from '../lib/audio'
import { playVoiceCat } from '../lib/voice'
import { formatDuration, type FocusCommitInput, type FocusCommitResult } from '../../../shared/types'
import { applyRecoveryChoice, assessFocusRecovery, checkpointFocusRecovery, type FocusRecoveryAssessment, type FocusRecoveryRecord, type RecoveryChoice, type RecoveryRunState } from '../../../shared/focusRecovery'

type Mode = 'focus' | 'short' | 'long'
type Phase = 'setup' | 'recovering' | 'running' | 'paused' | 'saving' | 'settle'

const PRESETS = [
  { label: '25 / 5', focus: 25, short: 5 },
  { label: '45 / 10', focus: 45, short: 10 },
  { label: '50 / 10', focus: 50, short: 10 },
  { label: '60 / 15', focus: 60, short: 15 }
]

const MODE_NAMES: Record<Mode, string> = { focus: '专注', short: '短休息', long: '长休息' }

export default function Focus({ active = true }: { active?: boolean }) {
  const settings = useApp(s => s.settings)
  const todaySeconds = useApp(s => s.todaySeconds)
  const focusFinish = useApp(s => s.focusFinish)
  const [saveError, setSaveError] = useState('')
  const [recovery, setRecovery] = useState<FocusRecoveryAssessment | null>(null)
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [recoveryReady,setRecoveryReady] = useState(false)
  const [recoveryLoadAttempt,setRecoveryLoadAttempt] = useState(0)
  const [result, setResult] = useState<FocusCommitResult | null>(null)
  const pending = useRef<FocusCommitInput | null>(null)
  const sessionToken = useRef('')
  const setMood = useApp((s) => s.setMood)

  const [phase, setPhase] = useState<Phase>('setup')
  const [mode, setMode] = useState<Mode>('focus')
  const [countUp, setCountUp] = useState(false)
  const [focusMin, setFocusMin] = useState(25)
  const [shortMin, setShortMin] = useState(5)
  const [longMin, setLongMin] = useState(15)
  const [cycles, setCycles] = useState(4)
  const [task, setTask] = useState('')
  const savedTasks=useFocusTasks(s=>s.tasks),taskError=useFocusTasks(s=>s.error)
  const [todoId, setTodoId] = useState<number | null>(null)
  useEffect(() => {
    if (!active || phase !== 'setup') return
    const noteTitle=sessionStorage.getItem('focusNoteTitle')
    if(noteTitle){setTask(noteTitle);setTodoId(null);sessionStorage.removeItem('focusNoteTitle');return}
    const id = sessionStorage.getItem('focusTodoId')
    const title = sessionStorage.getItem('focusTodoTitle')
    if (id && title !== null) {
      setTask(title)
      setTodoId(Number(id))
      sessionStorage.removeItem('focusTodoId')
      sessionStorage.removeItem('focusTodoTitle')
    }
  }, [active, phase])
  const todos = useApp((s) => s.todos)

  const [elapsed, setElapsed] = useState(0) // 当前阶段已进行秒数
  const focusSecondsRef = useRef(0) // 本轮累计有效专注秒（暂停不计）
  const elapsedRef = useRef(0)
  const [doneRounds, setDoneRounds] = useState(0)

  const running = phase === 'running'
  const syncClock = useRef<() => void>(() => {})
  const settled = useRef(false)
  const startedAt = useRef(0)
  const summonTimer = useRef<ReturnType<typeof setTimeout>>()
  const autoBreakTimer = useRef<ReturnType<typeof setTimeout>>()
  const recoveryRecord = useRef<FocusRecoveryRecord | null>(null)
  const recoveryLoaded = useRef(false)
  const recoveryLoadPromise = useRef<Promise<{ record: FocusRecoveryRecord | null; clearedCorrupt: boolean }> | null>(null)
  const recoveryBusy = useRef(false)
  const starting = useRef(false)
  useEffect(() => () => {
    clearTimeout(summonTimer.current)
    clearTimeout(autoBreakTimer.current)
  }, [])

  function hydrateRecovery(record: FocusRecoveryRecord) {
    recoveryRecord.current = record
    sessionToken.current = record.token
    startedAt.current = record.startedAt
    focusSecondsRef.current = record.focusSeconds
    elapsedRef.current = record.phaseElapsedSeconds
    pending.current = record.pendingCommit
    setMode(record.mode)
    setCountUp(record.countUp)
    setFocusMin(record.focusMin)
    setShortMin(record.shortMin)
    setLongMin(record.longMin)
    setCycles(record.cycles)
    setDoneRounds(record.doneRounds)
    setTask(record.taskLabel)
    setTodoId(record.todoId)
    setElapsed(record.phaseElapsedSeconds)
    settled.current = false
  }

  async function persistRecovery(record: FocusRecoveryRecord): Promise<boolean> {
    try {
      await window.api.saveFocusRecovery(record)
      recoveryRecord.current = record
      return true
    } catch {
      setRecoveryMessage('专注恢复检查点未能写入，最近的计时尚未可靠保存。请检查本机存储后重试。')
      return false
    }
  }

  async function clearRecovery(token?: string): Promise<boolean> {
    try {
      await window.api.clearFocusRecovery(token)
      if (!token || recoveryRecord.current?.token === token) recoveryRecord.current = null
      return true
    } catch {
      setRecoveryMessage('无法清理专注恢复状态，请重试。')
      return false
    }
  }

  function recordFromCurrent(runState: RecoveryRunState, phaseElapsedSeconds = elapsedRef.current, focusSeconds = focusSecondsRef.current, pendingCommit: FocusCommitInput | null = null, modeOverride = mode): FocusRecoveryRecord {
    const previous = recoveryRecord.current
    const now = Date.now()
    const base: FocusRecoveryRecord = previous ?? {
      version: 1,
      token: sessionToken.current,
      mode: modeOverride,
      runState,
      countUp,
      focusMin,
      shortMin,
      longMin,
      cycles,
      doneRounds,
      taskLabel: task,
      todoId,
      startedAt: startedAt.current || now,
      phaseElapsedSeconds: 0,
      focusSeconds: 0,
      phaseStartedAt: runState === 'running' ? now : null,
      checkpointAt: now,
      pendingCommit: null
    }
    return checkpointFocusRecovery({ ...base, mode: modeOverride, countUp, focusMin, shortMin, longMin, cycles, doneRounds, taskLabel: task, todoId }, { runState, phaseElapsedSeconds, focusSeconds, now, pendingCommit })
  }

  useEffect(() => {
    if (!active || recoveryLoaded.current) return
    let cancelled = false
    const load = recoveryLoadPromise.current ?? (recoveryLoadPromise.current = window.api.loadFocusRecovery())
    void load.then(value => {
      if (cancelled) return
      recoveryLoaded.current = true
      setRecoveryReady(true)
      recoveryLoadPromise.current = null
      if (!value.record) {
        if (value.clearedCorrupt) setRecoveryMessage('上一段专注的恢复状态已损坏，已安全清理；已有学习记录未受影响。')
        return
      }
      hydrateRecovery(value.record)
      if (value.record.runState === 'saving') {
        setPhase('saving')
        void saveSession()
      } else if (value.record.runState === 'paused') {
        setPhase('paused')
      } else {
        const assessment = assessFocusRecovery(value.record)
        setRecovery(assessment)
        setPhase('recovering')
      }
    }).catch(() => {
      if (!cancelled) { recoveryLoadPromise.current = null; setRecoveryReady(false); setRecoveryMessage('暂时无法读取上一段专注。请重试读取，确认恢复状态后再开始，避免覆盖原来的计时。') }
    })
    return () => { cancelled = true }
  }, [active,recoveryLoadAttempt])

  // Keep a recent durable checkpoint without turning the timer into a database job.
  useEffect(() => {
    if (phase !== 'running' || !recoveryRecord.current || recoveryBusy.current) return
    const checkpoint = () => {
      if (!recoveryRecord.current || recoveryBusy.current || !sessionToken.current) return
      syncClock.current()
      recoveryBusy.current = true
      void persistRecovery(recordFromCurrent('running')).finally(() => { recoveryBusy.current = false })
    }
    const timer = setInterval(checkpoint, 30000)
    const onPageHide = () => checkpoint()
    const onPause = () => checkpoint()
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('xinhai-pause', onPause)
    return () => { clearInterval(timer); window.removeEventListener('pagehide', onPageHide); window.removeEventListener('xinhai-pause', onPause) }
  }, [phase, mode, countUp, focusMin, shortMin, longMin, cycles, task, todoId, doneRounds])

  // Monotonic elapsed time survives page changes and delayed interval callbacks.
  useEffect(() => {
    if (!running) return
    const began = elapsedNow()
    const baseElapsed = elapsed
    const baseFocus = focusSecondsRef.current
    const limit = mode === 'focus' ? focusMin * 60 : mode === 'short' ? shortMin * 60 : longMin * 60
    const tick = () => {
      const total = baseElapsed + (elapsedNow() - began) / 1000
      const next = countUp && mode === 'focus' ? total : Math.min(limit, total)
      elapsedRef.current = next
      setElapsed(next)
      if (mode === 'focus') focusSecondsRef.current = baseFocus + next - baseElapsed
    }
    syncClock.current = tick
    const timer = setInterval(tick, 250)
    window.addEventListener('xinhai-resume',tick)
    return () => { clearInterval(timer);window.removeEventListener('xinhai-resume',tick); syncClock.current = () => {} }
  }, [running, mode, countUp, focusMin, shortMin, longMin])

  // 倒计时自动切换阶段
  useEffect(() => {
    if (!running || (countUp && mode === 'focus')) return
    const limit = mode === 'focus' ? focusMin * 60 : mode === 'short' ? shortMin * 60 : longMin * 60
    if (elapsed >= limit) {
      if (mode === 'focus') finishFocus(false)
      else startNextRound()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, running, countUp, mode, focusMin, shortMin, longMin])

  // 主角状态联动（专注中的战斗服由 start/继续 的序列控制，这里不覆盖；无 cleanup 避免清掉序列 mood）
  useEffect(() => {
    if (!active) return
    if (phase === 'running' && mode === 'focus') setMood(summonTimer.current ? 'levelup' : 'focus')
    else if (phase === 'running' && mode !== 'focus') setMood('rest')
    else if (phase === 'paused') setMood('idle')
    else if (phase === 'setup' || phase === 'recovering' || phase === 'saving' || phase === 'settle') setMood('idle')
  }, [phase, mode, active, setMood])

  async function start() {
    if (!recoveryReady || starting.current || !rememberFocusTask(task)) return
    starting.current = true
    clearTimeout(autoBreakTimer.current)
    autoBreakTimer.current = undefined
    settled.current = false
    const now = Date.now()
    startedAt.current = now
    sessionToken.current = crypto.randomUUID()
    focusSecondsRef.current = 0
    elapsedRef.current = 0
    setElapsed(0)
    setMode('focus')
    const record: FocusRecoveryRecord = {
      version: 1, token: sessionToken.current, mode: 'focus', runState: 'running', countUp,
      focusMin, shortMin, longMin, cycles, doneRounds, taskLabel: task, todoId,
      startedAt: now, phaseElapsedSeconds: 0, focusSeconds: 0, phaseStartedAt: now,
      checkpointAt: now, pendingCommit: null
    }
    const saved = await persistRecovery(record)
    if (saved) {
      setRecoveryMessage('')
      playDive()
      const s = useApp.getState().settings
      if (s.voiceEnabled) void playVoiceCat(Math.random() < 0.5 ? 'summon' : 'skill', s.volume)
      setMood('levelup')
      clearTimeout(summonTimer.current)
      summonTimer.current = setTimeout(() => {
        summonTimer.current = undefined
        if (useApp.getState().page === 'focus' && !settled.current) setMood('focus')
      }, 2500)
      setPhase('running')
    } else {
      settled.current = true
      sessionToken.current = ''
      setPhase('setup')
    }
    starting.current = false
  }

  async function saveSession() {
    if (!pending.current) return
    const savedContext=recoveryRecord.current
    useApp.setState({focusSaving:true,focusPending:true})
    setSaveError('')
    setPhase('saving')
    try {
      const saved = await window.api.commitFocus(pending.current)
      setResult(saved)
      useApp.setState({ stats: saved.growth.stats, focusFinish: saved, focusClock: null, focusPending:false })
      const committedToken = pending.current.token
      recoveryRecord.current = null
      setRecovery(null)
      void clearRecovery(committedToken)
      const completedRounds = (savedContext?.doneRounds ?? doneRounds) + 1
      setDoneRounds(completedRounds)
      setPhase('settle')
      // Only a completed countdown continues into rest. A manual finish
      // must remain stopped, including when a failed save is retried.
      clearTimeout(autoBreakTimer.current)
      autoBreakTimer.current = undefined
      if (saved.session.mode === '完整番茄') {
        autoBreakTimer.current = setTimeout(() => enterBreak(completedRounds,savedContext ?? undefined), 1200)
      }
      // Refresh failure must never turn a successful commit into a failed save.
      void useApp.getState().refresh().catch(() => undefined)
    } catch {
      setSaveError('保存失败，本次时间仍保留。请重试。')
    } finally {
      useApp.setState({focusSaving:false})
    }
  }

  async function finishFocus(early: boolean) {
    if (settled.current) return
    const previousPhase=phase
    syncClock.current()
    settled.current = true
    clearTimeout(summonTimer.current)
    summonTimer.current = undefined
    const input: FocusCommitInput = {
      token: sessionToken.current, startedAt: startedAt.current, endedAt: Date.now(),
      seconds: Math.floor(focusSecondsRef.current), mode: early ? '提前结束' : '完整番茄', taskLabel: task, todoId
    }
    pending.current = input
    const saved = await persistRecovery(recordFromCurrent('saving', elapsedRef.current, focusSecondsRef.current, input))
    if (!saved) {
      settled.current = false
      setSaveError('恢复状态未能保存，本次专注仍在继续；请稍后重试。')
      setPhase(previousPhase==='paused'?'paused':'running')
      return
    }
    useApp.setState({focusClock:null})
    void saveSession()
  }

  async function togglePause() {
    if (recoveryBusy.current || (phase !== 'running' && phase !== 'paused')) return
    if (phase === 'running') {
      syncClock.current()
      recoveryBusy.current = true
      const saved = await persistRecovery(recordFromCurrent('paused', elapsedRef.current, focusSecondsRef.current))
      recoveryBusy.current = false
      if (!saved) return
      clearTimeout(summonTimer.current)
      summonTimer.current = undefined
      setPhase('paused')
      setMood('idle')
    } else {
      recoveryBusy.current = true
      const saved = await persistRecovery(recordFromCurrent('running', elapsedRef.current, focusSecondsRef.current))
      recoveryBusy.current = false
      if (!saved) return
      setPhase('running')
      setMood(mode === 'focus' ? 'focus' : 'rest')
    }
    const s = useApp.getState().settings
    if (s.voiceEnabled) void playVoiceCat(phase === 'running' ? 'question' : 'action', s.volume)
  }

  async function enterBreak(completedRounds: number, context?:FocusRecoveryRecord) {
    clearTimeout(autoBreakTimer.current)
    autoBreakTimer.current = undefined
    const nextMode: Mode = completedRounds % (context?.cycles ?? cycles) === 0 ? 'long' : 'short'
    const now = Date.now()
    const next:FocusRecoveryRecord = { ...(context ?? recordFromCurrent('running', 0, 0, null, nextMode)),token:crypto.randomUUID(),mode:nextMode,runState:'running',doneRounds:completedRounds,startedAt:now,phaseStartedAt:now,checkpointAt:now,phaseElapsedSeconds:0,focusSeconds:0,pendingCommit:null }
    const saved = await persistRecovery(next)
    if (!saved) { setPhase('settle'); setSaveError('休息阶段未能保存恢复状态，请重试。'); return }
    hydrateRecovery(next)
    setPhase('running')
    playClick()
  }

  function nextRound() {
    void enterBreak(doneRounds)
  }

  async function startNextRound() {
    settled.current = false
    const now = Date.now(), token = crypto.randomUUID()
    const next: FocusRecoveryRecord = {
      version: 1, token, mode: 'focus', runState: 'running', countUp,
      focusMin, shortMin, longMin, cycles, doneRounds, taskLabel: task, todoId,
      startedAt: now, phaseElapsedSeconds: 0, focusSeconds: 0, phaseStartedAt: now,
      checkpointAt: now, pendingCommit: null
    }
    if (!await persistRecovery(next)) { setPhase('paused'); setSaveError('下一轮恢复状态未能保存，请重试。'); return }
    startedAt.current = now
    sessionToken.current = token
    focusSecondsRef.current = 0
    elapsedRef.current = 0
    setMode('focus'); setElapsed(0); setPhase('running'); playDive()
  }

  async function prepareNextRound(): Promise<boolean> {
    clearTimeout(summonTimer.current)
    clearTimeout(autoBreakTimer.current)
    summonTimer.current = undefined
    autoBreakTimer.current = undefined
    if (!(await clearRecovery(sessionToken.current || undefined))) return false
    useApp.setState({focusClock:null})
    settled.current = true
    pending.current = null
    setResult(null)
    setSaveError('')
    setPhase('setup')
    setElapsed(0)
    elapsedRef.current = 0
    setMode('focus')
    focusSecondsRef.current = 0
    return true
  }

  async function skipBreak() {
    if (await prepareNextRound()) playClick()
  }

  async function reset() {
    if (await prepareNextRound()) setDoneRounds(0)
  }

  async function chooseRecovery(choice: RecoveryChoice) {
    const current = recoveryRecord.current
    if (!current || recoveryBusy.current) return
    recoveryBusy.current = true
    const next = applyRecoveryChoice(current, choice)
    if (next === null) {
      const cleared = await clearRecovery(current.token)
      recoveryBusy.current = false
      if (!cleared) return
      recoveryRecord.current = null
      pending.current = null
      setRecovery(null); setRecoveryMessage('这段未保存的专注已放弃，已有学习记录未受影响。')
      setPhase('setup'); setElapsed(0); elapsedRef.current = 0; focusSecondsRef.current = 0; setMode('focus')
      return
    }
    const saved = await persistRecovery(next)
    recoveryBusy.current = false
    if (!saved) return
    hydrateRecovery(next)
    setRecovery(null)
    setPhase('running')
    setRecoveryMessage('')
  }

  const limit = mode === 'focus' ? focusMin * 60 : mode === 'short' ? shortMin * 60 : longMin * 60
  const remain = countUp && mode === 'focus' ? Math.floor(elapsed) : Math.max(0, limit - Math.floor(elapsed))
  const mm = String(Math.floor(remain / 60)).padStart(2, '0')
  const ss = String(remain % 60).padStart(2, '0')
  const progress = mode === 'focus' && !countUp ? Math.min(1, elapsed / limit) : mode === 'focus' ? 0 : Math.min(1, elapsed / limit)

  useEffect(() => {
    useApp.setState({ focusClock: running || phase === 'paused' ? {
      label: `${MODE_NAMES[mode]}${countUp && mode === 'focus' ? '已用' : '剩余'}`,
      time: formatDuration(remain), paused: phase === 'paused'
    } : null })
  }, [remain, running, phase, mode, countUp])

  return (
    <div className={"focus-layout timer-" + settings.timerPosition} style={{ position: 'relative', zIndex: 2, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 40px 90px' }}>
      <AnimatePresence mode="wait">
        {phase === 'recovering' && recovery && <motion.section key="recovering" className="glass focus-summary focus-recovery" role="dialog" aria-labelledby="focus-recovery-title" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <span className="en-label">RECOVER YOUR TIME / 专注恢复</span>
          <h2 id="focus-recovery-title">检测到上一段未结束的{MODE_NAMES[recovery.record.mode]}。</h2>
          <p>应用上次保存于 {new Date(recovery.record.checkpointAt).toLocaleTimeString('zh-CN', { hour12: false })}。离开期间约 {formatDuration(recovery.awaySeconds)}。</p>
          <p className="focus-recovery-warning">离开期间默认不计入本次专注；请选择如何处理，应用不会默默奖励后台或异常退出期间的时间。</p>
          <div className="summary-time">{formatDuration(recovery.record.phaseElapsedSeconds)}</div>
          <p>上次检查点已计入本阶段{recovery.reachedLimit ? ' · 若计入离开时间，将达到设定时长' : ''}</p>
          <div className="summary-actions focus-recovery-actions">
            <button className="btn primary" disabled={recoveryBusy.current} onClick={() => void chooseRecovery('discard-away')}>不计离开时间，继续</button>
            <button className="btn" disabled={recoveryBusy.current} onClick={() => void chooseRecovery('include-away')}>计入离开时间</button>
            <button className="btn danger" disabled={recoveryBusy.current} onClick={() => void chooseRecovery('abandon')}>放弃这段专注</button>
          </div>
          {recoveryMessage && <p role="alert" className="journal-error">{recoveryMessage}</p>}
        </motion.section>}
        {phase === 'saving' && <div key="saving" className="glass focus-summary" role="status">
          <span className="en-label">SAVING YOUR TIME</span><h2>{formatDuration(pending.current?.seconds ?? 0)}</h2>
          <p>{saveError || '正在保存这段专注…'}</p>
          {saveError && <button className="btn primary" onClick={() => void saveSession()}>重试保存</button>}
        </div>}
        {phase === 'setup' && (
          <motion.div key="setup" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -24 }} transition={{ duration: 0.4 }} className="glass focus-setup" style={{ padding: '40px 48px', width: 620 }}>
            <div className="page-title" style={{ marginBottom: 28 }}>
              <span className="en">FOCUS</span>
              <span className="zh">专注计时</span>
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  className="btn"
                  style={focusMin === p.focus ? { borderColor: 'var(--cyan)', background: 'color-mix(in srgb,var(--theme-color) 12%,transparent)' } : undefined}
                  onClick={() => {
                    setFocusMin(p.focus)
                    setShortMin(p.short)
                    playClick()
                  }}
                >
                  <span>{p.label}</span>
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 22 }}>
              <label style={{ fontSize: 14, color: 'var(--ink-dim)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                专注（分钟）
                <input type="number" min={1} max={180} value={focusMin} onChange={(e) => setFocusMin(Math.min(180, Math.max(1, Number(e.target.value) || 1)))} />
              </label>
              <label style={{ fontSize: 14, color: 'var(--ink-dim)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                短休息
                <input type="number" min={1} max={60} value={shortMin} onChange={(e) => setShortMin(Math.min(60, Math.max(1, Number(e.target.value) || 1)))} />
              </label>
              <label style={{ fontSize: 14, color: 'var(--ink-dim)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                长休息
                <input type="number" min={1} max={60} value={longMin} onChange={(e) => setLongMin(Math.min(60, Math.max(1, Number(e.target.value) || 1)))} />
              </label>
              <label style={{ fontSize: 14, color: 'var(--ink-dim)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                循环次数
                <input type="number" min={2} max={12} value={cycles} onChange={(e) => setCycles(Math.min(12, Math.max(2, Number(e.target.value) || 2)))} />
              </label>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--ink-dim)', marginBottom: 22, cursor: 'pointer' }}>
              <input type="checkbox" checked={countUp} onChange={(e) => setCountUp(e.target.checked)} style={{ width: 'auto' }} />
              正计时模式（不显示倒计时，手动结束）
            </label>

            <div className="focus-task-input" style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <select
                value={todoId ?? ''}
                onChange={(e) => {
                  const id = e.target.value
                  if (id === '') {
                    setTodoId(null)
                    return
                  }
                  const t = todos.find((x) => x.id === Number(id))
                  if (t) {
                    setTask(t.title)
                    setTodoId(t.id)
                  }
                }}
                style={{ width: 220, background: 'color-mix(in srgb,var(--theme-panel) 80%,transparent)', color: 'var(--ice)', border: '1px solid var(--glass-line)', fontSize: 14 }}
              >
                <option value="">自由任务</option>
                {todos.filter((t) => !t.done).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              <input placeholder="或输入当前任务（可选）" value={task} onChange={(e) => { setTask(e.target.value); setTodoId(null) }} style={{ flex: 1 }} />
            </div>

            <details className="focus-task-library">
              <summary>常用任务 · {savedTasks.length} 项<span>复用 / 删除</span></summary>
              <p>开始专注时自动收录输入的任务，也可以先保存备用。</p>
              <button className="btn" disabled={!task.trim()} onClick={()=>rememberFocusTask(task)}>保存当前任务</button>
              {savedTasks.length===0?<p>还没有常用任务，输入任务后即可保存。</p>:<div className="focus-task-table"><table><thead><tr><th>任务名称</th><th>操作</th></tr></thead><tbody>{savedTasks.map(t=><tr key={t.id}><td>{t.title}</td><td><button onClick={()=>{setTask(t.title);setTodoId(null)}} aria-label={'复用任务 '+t.title}>复用</button><button onClick={()=>deleteFocusTask(t.id)} aria-label={'删除任务 '+t.title}>删除</button></td></tr>)}</tbody></table></div>}
            </details>
            {taskError&&<p role="alert" className="journal-error">{taskError}</p>}

            {doneRounds > 0 && <p role="status">休息已跳过，准备好后再开始下一轮。</p>}
            {recoveryMessage && <p role="alert" className="journal-error">{recoveryMessage}</p>}

            {!recoveryReady && recoveryMessage && <button className="btn" onClick={()=>setRecoveryLoadAttempt(value=>value+1)}>重试读取专注</button>}
            <button className="btn primary" disabled={!recoveryReady} style={{ width: '100%' }} onClick={start}>
              <span>{!recoveryReady?'正在读取专注状态…':doneRounds > 0 ? '开始下一轮' : '开始专注'}</span>
            </button>
          </motion.div>
        )}

        {(phase === 'running' || phase === 'paused') && (
          <motion.div key="run" className="focus-hud pv-frame" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45 }} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, letterSpacing: '0.5em', color: 'var(--cyan)', marginBottom: 6 }}>{MODE_NAMES[mode]} · {countUp && mode === 'focus' ? '已用时间' : '剩余时间'}{phase === 'paused' ? ' · 已暂停' : ''}</div>
            {task && mode === 'focus' && <div className="focus-task" style={{ fontSize: 14, color: 'var(--ink-dim)', marginBottom: 18, letterSpacing: '0.15em' }}>{task}</div>}
            <div className="focus-digits"
              style={{
                fontFamily: 'var(--font-num)',
                fontSize: 'clamp(86px, 10vw, 150px)',
                fontWeight: 700,
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums'
              }}
            >
              {mm}
              <span>:</span>
              {ss}
            </div>
            <div className={'theurgy' + (progress >= 0.999 ? ' full' : '')} style={{ width: '100%', margin: '24px auto' }}>
              <div style={{ width: `${progress * 100}%`, transition: 'width 1s linear' }} />
            </div>
            <div style={{ display: 'flex', gap: 14, justifyContent: 'center' }}>
              <button
                className="btn"
                disabled={recoveryBusy.current}
                onClick={() => void togglePause()}
              >
                <span>{phase === 'paused' ? '继续' : '暂停'}</span>
              </button>
              {mode === 'focus' ? (
                <button className="btn danger" onClick={() => finishFocus(true)}>
                  <span>提前结束</span>
                </button>
              ) : (
                <><button className="btn" onClick={skipBreak}>
                  <span>跳过休息</span>
                </button><button className="btn danger" onClick={reset}>
                  <span>结束本次专注</span>
                </button></>
              )}

            </div>
            <div className="focus-ledger"><span>本次有效专注 <b>{formatDuration(focusSecondsRef.current)}</b></span><span>今日已保存 <b>{formatDuration(todaySeconds)}</b></span></div>
            {recoveryMessage && <p role="alert" className="journal-error">{recoveryMessage}</p>}
            <div style={{ marginTop: 20, fontFamily: 'var(--font-num)', fontSize: 14, letterSpacing: '0.3em', color: 'var(--ink-dim)' }}>
              ROUND {doneRounds + (mode === 'focus' ? 1 : 0)} / {cycles}
            </div>
          </motion.div>
        )}

        {phase === 'settle' && result && !focusFinish && (
          <motion.section key="summary" className="glass focus-summary" initial={{opacity:0}} animate={{opacity:1}}>
            <span className="en-label">TIME WELL SPENT / 已保存</span>
            <h2>这一段，完成了。</h2>
            <div className="summary-time" data-final-time>{formatDuration(result.session.seconds ?? result.session.minutes * 60)}</div>
            <p>本次有效专注 · 分:秒</p>
            <div className="summary-award"><span>{result.session.minutes>0?'学识有所成长':'这一刻，已记录'}</span><GrowthNotes points={result.session.minutes}/><small>{result.session.minutes === 0 ? '时间已经保存，稍作准备再出发。' : '专注留下的收获，已经汇入心海。'}</small></div>
            <p className="summary-task">{result.session.taskLabel || '自由专注'}</p>
            <p>今日累计 <b>{formatDuration(todaySeconds)}</b></p>
            <p className="focus-auto-rest-note" role="status">{result.session.mode === '完整番茄' ? '保存成功，休息会自动开始。' : '本次专注已结束，时间已保存。'}</p>
            {recoveryMessage && <p role="alert" className="journal-error">{recoveryMessage}</p>}
            <div className="summary-actions">{result.session.mode === '完整番茄' && <button className="btn primary" onClick={nextRound}>进入{doneRounds % cycles === 0 ? '长' : '短'}休息</button>}<button className="btn" onClick={() => void reset()}>新一段专注</button><button className="btn" onClick={() => { void reset().then(() => useApp.getState().go('home')) }}>返回桌面</button></div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  )
}
