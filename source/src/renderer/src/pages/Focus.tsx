import {LearningCategorySelect} from '../components/LearningCategoryControl'
import GrowthNotes from '../components/GrowthNotes'
import FocusWidget from '../components/FocusWidget'
import FocusReminderReadiness from '../components/FocusReminderReadiness'
import { showFocusReminder } from '../components/FocusReminder'
import { goToSetting } from '../lib/settingNavigation'
import { elapsedNow } from '../lib/elapsedClock'
import { FOCUS_NOTE_SECONDS } from '../../../shared/focusRewards'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp } from '../store/app'
import {useFocusTasks,rememberFocusTask,deleteFocusTask} from '../store/focusTasks'
import '../styles/focus-tasks.css'
import { playDive, playClick, playSurface } from '../lib/audio'
import { playVoiceCat } from '../lib/voice'
import { formatDuration, type FocusCommitInput, type FocusCommitResult,type FocusRewardState } from '../../../shared/types'
import { applyRecoveryChoice, assessFocusRecovery, checkpointFocusRecovery, type FocusRecoveryAssessment, type FocusRecoveryRecord, type RecoveryChoice, type RecoveryRunState } from '../../../shared/focusRecovery'

type Mode = 'focus' | 'short' | 'long'
type Phase = 'setup' | 'recovering' | 'running' | 'paused' | 'saving' | 'settle' | 'waiting'
const MAX_CATCHUP_PHASES=48

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
  const rewardPresentation=useApp(s=>s.focusRewardPresentation)
  const [rewardState,setRewardState]=useState<FocusRewardState>({earnedNotes:0,pendingNotes:0,remainderSeconds:0})
  const [foreground,setForeground]=useState(!document.hidden),foregroundRef=useRef(!document.hidden)
  const nativePaused=useRef(false),awayMarker=useRef<number|null>(null),deadlineWasBackground=useRef(false)
  const phaseDebt=useRef(0),catchupPhases=useRef(0),saveBusy=useRef(false),presenting=useRef(false)
  const logicalDeadline=useRef(0)
  const deferredBreak=useRef<{rounds:number;context:FocusRecoveryRecord}|null>(null)
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
  const [categoryId,setCategoryId]=useState<string|null>(null)
  const [todoId, setTodoId] = useState<number | null>(null)
  useEffect(() => {
    if (!active || phase !== 'setup') return
    const noteTitle=sessionStorage.getItem('focusNoteTitle')
    if(noteTitle){setTask(noteTitle);setTodoId(null);setCategoryId(sessionStorage.getItem('focusNoteCategory')||null);sessionStorage.removeItem('focusNoteTitle');sessionStorage.removeItem('focusNoteCategory');return}
    const id = sessionStorage.getItem('focusTodoId')
    const title = sessionStorage.getItem('focusTodoTitle')
    if (id && title !== null) {
      setTask(title)
      setTodoId(Number(id))
      setCategoryId(useApp.getState().todos.find(t=>t.id===Number(id))?.categoryId??null)
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
  const remindedToken = useRef('')
  const reminderUnavailable = useRef(false)
  useEffect(()=>{
    const sync=()=>{const visible=!nativePaused.current&&!document.hidden;if(!visible&&foregroundRef.current)awayMarker.current=elapsedNow();foregroundRef.current=visible;setForeground(visible)}
    const pause=()=>{nativePaused.current=true;sync()},resume=()=>{nativePaused.current=false;sync()}
    document.addEventListener('visibilitychange',sync);window.addEventListener('xinhai-pause',pause);window.addEventListener('xinhai-resume',resume)
    return()=>{document.removeEventListener('visibilitychange',sync);window.removeEventListener('xinhai-pause',pause);window.removeEventListener('xinhai-resume',resume)}
  },[])
  useEffect(()=>{if(active)void window.api.focusRewardState().then(setRewardState).catch(()=>undefined)},[active,phase,rewardPresentation])
  async function presentRewards():Promise<boolean>{
    if(!foregroundRef.current||presenting.current||useApp.getState().focusRewardPresentation)return false
    presenting.current=true
    try{const reward=await window.api.focusRewardPresentation();if(!reward.notes||!foregroundRef.current)return false;useApp.setState({focusRewardPresentation:reward});return true}
    catch{setSaveError('音符已可靠入账，演出暂未能读取；可稍后点击集中收下重试。');return false}
    finally{presenting.current=false}
  }
  useEffect(()=>{
    if(!foreground)return
    if(phase==='waiting'&&!deferredBreak.current&&!saveBusy.current){if(mode==='focus')void saveSession();else void startNextRound();return}
    if(deferredBreak.current&&!rewardPresentation){const next=deferredBreak.current;deferredBreak.current=null;void enterBreak(next.rounds,next.context)}
  },[foreground,phase,rewardPresentation])
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
    phaseDebt.current=record.phaseDebtSeconds??0
    deadlineWasBackground.current=false
    setMode(record.mode)
    setCountUp(record.countUp)
    setFocusMin(record.focusMin)
    setShortMin(record.shortMin)
    setLongMin(record.longMin)
    setCycles(record.cycles)
    setDoneRounds(record.doneRounds)
    setTask(record.taskLabel)
    setTodoId(record.todoId)
    setCategoryId(record.categoryId??null)
    setElapsed(record.phaseElapsedSeconds)
    settled.current = false
  }

  async function persistRecovery(record: FocusRecoveryRecord, checkpointToken?:string): Promise<boolean> {
    try {
      await window.api.saveFocusRecovery(record)
      // A checkpoint reply from a completed phase must not replace the newer
      // phase's in-memory envelope after an asynchronous bridge response.
      if(checkpointToken!==undefined&&(sessionToken.current!==checkpointToken||recoveryRecord.current?.mode!==record.mode||recoveryRecord.current?.runState!=='running'))return false
      recoveryRecord.current = record
      return true
    } catch {
      if(checkpointToken!==undefined&&(sessionToken.current!==checkpointToken||recoveryRecord.current?.mode!==record.mode))return false
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
      todoId,categoryId,
      startedAt: startedAt.current || now,
      phaseElapsedSeconds: 0,
      focusSeconds: 0,
      phaseStartedAt: runState === 'running' ? now : null,
      checkpointAt: now,
      pendingCommit: null
    }
    return checkpointFocusRecovery({ ...base, mode: modeOverride, countUp, focusMin, shortMin, longMin, cycles, doneRounds, taskLabel: task, todoId,categoryId,phaseDebtSeconds:phaseDebt.current }, { runState, phaseElapsedSeconds, focusSeconds, now, pendingCommit })
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
      if(value.record.runState==='waiting'){
        setPhase('waiting')
      } else if (value.record.runState === 'saving') {
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
    if (phase !== 'running' || !recoveryRecord.current) return
    const token=sessionToken.current
    let live=true
    const checkpoint = () => {
      if (!live||starting.current||recoveryBusy.current||!token||token!==sessionToken.current||recoveryRecord.current?.token!==token||recoveryRecord.current.mode!==mode||recoveryRecord.current.runState!=='running') return
      syncClock.current()
      recoveryBusy.current = true
      void persistRecovery(recordFromCurrent('running'),token).finally(() => { recoveryBusy.current = false })
    }
    const timer = setInterval(checkpoint, 30000)
    const onPageHide = () => checkpoint()
    const onPause = () => checkpoint()
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('xinhai-pause', onPause)
    return () => { live=false;clearInterval(timer); window.removeEventListener('pagehide', onPageHide); window.removeEventListener('xinhai-pause', onPause) }
  }, [phase, mode, countUp, focusMin, shortMin, longMin, cycles, task, todoId,categoryId, doneRounds])

  // Monotonic elapsed time survives page changes and delayed interval callbacks.
  useEffect(() => {
    if (!running) return
    const began = elapsedNow()
    const baseElapsed = elapsed
    const baseFocus = focusSecondsRef.current
    const token=sessionToken.current
    let live=true
    const limit = mode === 'focus' ? focusMin * 60 : mode === 'short' ? shortMin * 60 : longMin * 60
    logicalDeadline.current=Math.round(Date.now()+Math.max(0,limit-baseElapsed)*1000-phaseDebt.current*1000)
    const tick = () => {
      // State updates are batched: a queued old interval/resume callback can
      // run after the next token is installed but before React cleans up this
      // effect. Never let that callback write the new phase's elapsed value.
      if(!live||starting.current||token!==sessionToken.current||recoveryRecord.current?.token!==token||recoveryRecord.current.mode!==mode||recoveryRecord.current.runState!=='running')return
      const total = baseElapsed + (elapsedNow() - began) / 1000
      const next = countUp && mode === 'focus' ? total : Math.min(limit, total)
      if(!(countUp&&mode==='focus')){
        if(total>=limit){
          if(!foregroundRef.current||awayMarker.current!==null)deadlineWasBackground.current=true
          phaseDebt.current=useApp.getState().settings.focusBackgroundBehavior==='continue'?Math.min(604800,Math.max(phaseDebt.current,total-limit)):0
        }
        awayMarker.current=null
      }
      elapsedRef.current = next
      setElapsed(next)
      if (mode === 'focus') focusSecondsRef.current = baseFocus + next - baseElapsed
    }
    syncClock.current = tick
    const timer = setInterval(tick, 250)
    window.addEventListener('xinhai-resume',tick)
    return () => { live=false;clearInterval(timer);window.removeEventListener('xinhai-resume',tick); if(syncClock.current===tick)syncClock.current = () => {} }
  }, [running, mode, countUp, focusMin, shortMin, longMin])

  // Schedule outside the WebView timer so background throttling cannot silently
  // consume the end of a countdown. Pauses, manual finishes and reset cancel it.
  useEffect(() => {
    if (!running || (countUp && mode === 'focus')||phaseDebt.current>0) return
    const limit = (mode === 'focus' ? focusMin : mode === 'short' ? shortMin : longMin) * 60
    const title = mode === 'focus' ? '专注时间到，辛苦了！' : '休息结束，准备开始下一轮'
    const token=sessionToken.current
    let live=true
    reminderUnavailable.current = false
    void window.api.focusReminder({ token, deadline: Date.now() + Math.max(0, limit - elapsedRef.current) * 1000, title })
      .catch(() => { if(!live||token!==sessionToken.current)return;reminderUnavailable.current = true; setRecoveryMessage('系统提醒暂不可用；应用内到时仍会提示。请保持应用打开。') })
    return () => { live=false;void window.api.focusReminder(null).catch(() => undefined) }
  }, [running, mode, countUp, focusMin, shortMin, longMin])

  // 倒计时自动切换阶段
  useEffect(() => {
    if (!running || starting.current || (countUp && mode === 'focus') || recoveryRecord.current?.token!==sessionToken.current || recoveryRecord.current.mode!==mode || recoveryRecord.current.runState!=='running') return
    const limit = mode === 'focus' ? focusMin * 60 : mode === 'short' ? shortMin * 60 : longMin * 60
    if (elapsed >= limit) {
      if (remindedToken.current !== sessionToken.current) {
        remindedToken.current = sessionToken.current
        const title = mode === 'focus' ? '专注时间到，辛苦了！' : '休息结束，准备开始下一轮'
        const historical=phaseDebt.current>0&&useApp.getState().settings.focusBackgroundBehavior==='continue'
        if(!historical){showFocusReminder(title)
        void window.api.focusReminder({ token: sessionToken.current, deadline: Date.now(), title }).catch(() => { if (!reminderUnavailable.current) playSurface() })
        // Normally the platform scheduler supplies the audible alert, even with
        // music/animation disabled. Keep an in-app fallback for bridge failures.
        if (reminderUnavailable.current) playSurface()}
      }
      if (mode === 'focus') finishFocus(false)
      else if(useApp.getState().settings.focusBackgroundBehavior==='wait'&&!foregroundRef.current){
        if(!starting.current){starting.current=true;phaseDebt.current=0;void persistRecovery(recordFromCurrent('waiting',limit,0)).then(saved=>{if(saved)setPhase('waiting')}).finally(()=>{starting.current=false})}
      }else startNextRound()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, running, countUp, mode, focusMin, shortMin, longMin])

  // 主角状态联动（专注中的战斗服由 start/继续 的序列控制，这里不覆盖；无 cleanup 避免清掉序列 mood）
  useEffect(() => {
    if (!active) return
    if (phase === 'running' && mode === 'focus') setMood(summonTimer.current ? 'levelup' : 'focus')
    else if (phase === 'running' && mode !== 'focus') setMood('rest')
    else if (phase === 'paused') setMood('idle')
    else if (phase === 'setup' || phase === 'recovering' || phase === 'saving' || phase === 'settle'||phase==='waiting') setMood('idle')
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
    phaseDebt.current=0;catchupPhases.current=0;deadlineWasBackground.current=false;deferredBreak.current=null
    focusSecondsRef.current = 0
    elapsedRef.current = 0
    setElapsed(0)
    setMode('focus')
    const record: FocusRecoveryRecord = {
      version: 1, token: sessionToken.current, mode: 'focus', runState: 'running', countUp,
      focusMin, shortMin, longMin, cycles, doneRounds, taskLabel: task, todoId,categoryId,
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
    if (!pending.current||saveBusy.current) return
    saveBusy.current=true
    const input=pending.current
    const savedContext=recoveryRecord.current
    useApp.setState({focusSaving:true,focusPending:true})
    setSaveError('')
    setPhase('saving')
    try {
      const saved = await window.api.commitFocus(input)
      setResult(saved)
      useApp.setState({ stats: saved.growth.stats, focusClock: null, focusPending:false })
      if(saved.rewardState)setRewardState(saved.rewardState)
      setRecovery(null)
      const completedRounds = (savedContext?.doneRounds ?? doneRounds) + 1
      setDoneRounds(completedRounds)
      // Only a completed countdown continues into rest. A manual finish
      // must remain stopped, including when a failed save is retried.
      clearTimeout(autoBreakTimer.current)
      autoBreakTimer.current = undefined
      const currentSettings=useApp.getState().settings,full=saved.session.mode==='完整番茄'
      const waitForReturn=full&&currentSettings.focusBackgroundBehavior==='wait'&&!foregroundRef.current
      const waitingRecord=savedContext?{...savedContext,runState:'waiting' as const,phaseStartedAt:null,pendingCommit:input,phaseDebtSeconds:0}:null
      if(waitForReturn&&waitingRecord){
        phaseDebt.current=0
        if(!await persistRecovery(waitingRecord))throw Error('waiting checkpoint failed')
        setPhase('waiting')
      }else{
        const shouldPresent=!full||currentSettings.focusRewardPresentation==='round'||savedContext?.runState==='waiting'||(deadlineWasBackground.current&&currentSettings.focusBackgroundBehavior==='wait')
        const shown=shouldPresent?await presentRewards():false
        if(full&&(shown||!foregroundRef.current)&&waitingRecord&&currentSettings.focusBackgroundBehavior==='wait'){
          phaseDebt.current=0
          if(!await persistRecovery(waitingRecord))throw Error('presentation checkpoint failed')
          deferredBreak.current=shown?{rounds:completedRounds,context:waitingRecord}:null;setPhase('waiting')
        }else{
          recoveryRecord.current=null
          setPhase('settle')
          if(full){
            if(!foregroundRef.current||phaseDebt.current>0)void enterBreak(completedRounds,savedContext??undefined)
            else autoBreakTimer.current=setTimeout(()=>void enterBreak(completedRounds,savedContext??undefined),1200)
          }
        }
      }
      // Refresh failure must never turn a successful commit into a failed save.
      void useApp.getState().refresh().catch(() => undefined)
    } catch {
      setSaveError('保存失败，本次时间仍保留。请重试。')
    } finally {
      saveBusy.current=false
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
      token: sessionToken.current, startedAt: startedAt.current, endedAt: early?Date.now():Math.max(startedAt.current,logicalDeadline.current||Date.now()),
      seconds: Math.floor(focusSecondsRef.current), mode: early ? '提前结束' : '完整番茄', taskLabel: task, todoId,categoryId
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
    if (starting.current || recoveryBusy.current || (phase !== 'running' && phase !== 'paused')) return
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
    if(starting.current)return
    starting.current=true
    try{
    clearTimeout(autoBreakTimer.current)
    autoBreakTimer.current = undefined
    const nextMode: Mode = completedRounds % (context?.cycles ?? cycles) === 0 ? 'long' : 'short'
    const now = Date.now()
    const debt=phaseDebt.current,limit=(nextMode==='long'?(context?.longMin??longMin):(context?.shortMin??shortMin))*60
    const bounded=debt>0&&++catchupPhases.current>=MAX_CATCHUP_PHASES
    if(debt<=0)catchupPhases.current=0
    const next:FocusRecoveryRecord = { ...(context ?? recordFromCurrent('running', 0, 0, null, nextMode)),token:crypto.randomUUID(),mode:nextMode,runState:bounded?'paused':'running',doneRounds:completedRounds,startedAt:Math.max(1,Math.round(now-debt*1000)),phaseStartedAt:bounded?null:now,checkpointAt:now,phaseElapsedSeconds:bounded?0:Math.min(limit,Math.floor(debt)),phaseDebtSeconds:bounded?0:Math.max(0,debt-limit),focusSeconds:0,pendingCommit:null }
    const saved = await persistRecovery(next)
    if (!saved) { setPhase('settle'); setSaveError('休息阶段未能保存恢复状态，请重试。'); return }
    hydrateRecovery(next)
    setPhase(bounded?'paused':'running')
    if(bounded)setRecoveryMessage('长时间离开，自动衔接已达到 48 个阶段并暂停。后续离开时间未记入，请确认后继续。')
    playClick()
    }finally{starting.current=false}
  }

  function nextRound() {
    void enterBreak(doneRounds)
  }

  async function startNextRound() {
    if(starting.current||mode==='focus'||recoveryRecord.current?.token!==sessionToken.current||recoveryRecord.current.mode!==mode)return
    starting.current=true
    try{
    const now = Date.now(), token = crypto.randomUUID()
    const debt=phaseDebt.current,bounded=debt>0&&++catchupPhases.current>=MAX_CATCHUP_PHASES
    if(debt<=0)catchupPhases.current=0
    const initial=bounded?0:Math.min(focusMin*60,Math.floor(debt))
    const next: FocusRecoveryRecord = {
      version: 1, token, mode: 'focus', runState: bounded?'paused':'running', countUp,
      focusMin, shortMin, longMin, cycles, doneRounds, taskLabel: task, todoId,categoryId,
      startedAt: Math.max(1,Math.round(now-debt*1000)), phaseElapsedSeconds: initial, focusSeconds: initial, phaseStartedAt: bounded?null:now,phaseDebtSeconds:bounded?0:Math.max(0,debt-focusMin*60),
      checkpointAt: now, pendingCommit: null
    }
    if (!await persistRecovery(next)) { setPhase('paused'); setSaveError('下一轮恢复状态未能保存，请重试。'); return }
    hydrateRecovery(next)
    setPhase(bounded?'paused':'running'); playDive()
    if(bounded)setRecoveryMessage('长时间离开，自动衔接已达到 48 个阶段并暂停。后续离开时间未记入，请确认后继续。')
    }finally{starting.current=false}
  }

  async function prepareNextRound(): Promise<boolean> {
    if(starting.current)return false
    starting.current=true
    try{
    clearTimeout(summonTimer.current)
    clearTimeout(autoBreakTimer.current)
    summonTimer.current = undefined
    autoBreakTimer.current = undefined
    deferredBreak.current=null;phaseDebt.current=0;catchupPhases.current=0
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
    }finally{starting.current=false}
  }

  async function skipBreak() {
    if (await prepareNextRound()) playClick()
  }

  async function reset() {
    if (await prepareNextRound()){setDoneRounds(0);await presentRewards()}
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
        {phase==='waiting'&&<section key="waiting" className="glass focus-summary" role="status"><span className="en-label">TIME SAVED</span><h2>这一段已结束{mode==='focus'?'，时间已保存':''}。</h2><p>{mode==='focus'?'回来后收下音符，再进入休息。':'休息已结束，回来后再开始下一轮。'}后台等待期间不继续累计。</p>{saveError&&<p role="alert">{saveError}</p>}</section>}
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

            <LearningCategorySelect label="本段专注学习分类" value={categoryId} onChange={setCategoryId}/>
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
                    setCategoryId(t.categoryId??null)
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
            <div className="focus-reward-guide">
              <p>专注每满 25 分钟，获得 1 个学习音符。</p>
              <p className="focus-reward-help">不足 25 分钟的时间会累计到下次。</p>
              <div className="focus-reward-progress" role="status">
                <span>距下一个音符 <b>{formatDuration(FOCUS_NOTE_SECONDS - rewardState.remainderSeconds)}</b></span>
                {rewardState.pendingNotes > 0 && <button type="button" className="focus-reward-collect" aria-label="集中收下学习音符" onClick={() => void presentRewards()}>领取 {rewardState.pendingNotes} 个音符 ↗</button>}
              </div>
              <button type="button" className="focus-preferences-link" onClick={() => goToSetting('settings', 'settings-focus')}>后台计时与音符设置 ↗</button>
            </div>

            {doneRounds > 0 && <p role="status">休息已跳过，准备好后再开始下一轮。</p>}
            {recoveryMessage && <p role="alert" className="journal-error">{recoveryMessage}</p>}

            {!recoveryReady && recoveryMessage && <button className="btn" onClick={()=>setRecoveryLoadAttempt(value=>value+1)}>重试读取专注</button>}
            <FocusReminderReadiness active={active}/>
            <button className="btn primary" disabled={!recoveryReady} style={{ width: '100%' }} onClick={start}>
              <span>{!recoveryReady?'正在读取专注状态…':doneRounds > 0 ? '开始下一轮' : '开始专注'}</span>
            </button>
          </motion.div>
        )}

        {(phase === 'running' || phase === 'paused') && (
          <FocusWidget key="run"><motion.div className="focus-hud pv-frame" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45 }} style={{ textAlign: 'center' }}>
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
            {rewardState.pendingNotes>0&&<button className="btn" aria-label="集中收下学习音符" onClick={()=>void presentRewards()}>领取 {rewardState.pendingNotes} 个音符</button>}
            {recoveryMessage && <p role="alert" className="journal-error">{recoveryMessage}</p>}
            <div style={{ marginTop: 20, fontFamily: 'var(--font-num)', fontSize: 14, letterSpacing: '0.3em', color: 'var(--ink-dim)' }}>
              ROUND {doneRounds + (mode === 'focus' ? 1 : 0)} / {cycles}
            </div>
          </motion.div></FocusWidget>
        )}

        {phase === 'settle' && result && !focusFinish && (
          <motion.section key="summary" className="glass focus-summary" initial={{opacity:0}} animate={{opacity:1}}>
            <span className="en-label">TIME WELL SPENT / 已保存</span>
            <h2>这一段，完成了。</h2>
            <div className="summary-time" data-final-time>{formatDuration(result.session.seconds ?? result.session.minutes * 60)}</div>
            <p>本次有效专注 · 分:秒</p>
            <div className="summary-award"><span>有效时间已累计</span><GrowthNotes points={result.growth.events.reduce((n,e)=>n+e.points,0)} exact/><small>专注每满 25 分钟获得 1 个学习音符，不足部分会累计到下次。</small></div>
            <p className="summary-task">{result.session.taskLabel || '自由专注'}</p>
            <p>今日累计 <b>{formatDuration(todaySeconds)}</b></p>
            <p className="focus-auto-rest-note" role="status">{result.session.mode === '完整番茄' ? '保存成功，休息会自动开始。' : '本次专注已结束，时间已保存。'}</p>
            {recoveryMessage && <p role="alert" className="journal-error">{recoveryMessage}</p>}
            {rewardState.pendingNotes>0&&<button className="btn primary" aria-label="集中收下学习音符" onClick={()=>void presentRewards()}>领取 {rewardState.pendingNotes} 个音符</button>}
            <div className="summary-actions">{result.session.mode === '完整番茄' && <button className="btn primary" onClick={nextRound}>进入{doneRounds % cycles === 0 ? '长' : '短'}休息</button>}<button className="btn" onClick={() => void reset()}>新一段专注</button><button className="btn" onClick={() => { void reset().then(() => useApp.getState().go('home')) }}>返回桌面</button></div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  )
}
