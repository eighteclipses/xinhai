import { create } from 'zustand'
import {
  DIMENSIONS,
  DEFAULT_SETTINGS,
  levelOf,
  type AppState,
  type DimensionId,
  type GrowthEvent,
  type GrowthApplyResult,
  type GrowthSummary,
  type Journal,
  type FocusSession,
  type Settings,
  type Todo,
  type Habit,
  type HabitLog,
  type FocusCommitResult,
  type FocusRewardPresentation,
  type CalEvent
} from '../../../shared/types'
import { playVoiceCat } from '../lib/voice'
import {localDateKey} from '../../../shared/date'

export type PageId = 'home' | 'focus' | 'todos' | 'calendar' | 'habits' | 'journal' | 'stats' | 'history' | 'settings' | 'knowledge' | 'customize'

// 模块编号（设计文档第三章）
export const PAGE_NUMBERS: Record<PageId, string> = {
  knowledge: '02',
  home: '00',
  focus: '01',
  todos: '03',
  calendar: '04',
  habits: '05',
  journal: '06',
  stats: '07',
  history: '08',
  settings: '09',
  customize: '10'
}

// 心海深度：0 水面 → 1 深层
export const PAGE_DEPTH: Record<PageId, number> = {
  knowledge: 0.4,
  home: 0,
  focus: 0.35,
  todos: 0.35,
  calendar: 0.5,
  habits: 0.5,
  stats: 0.7,
  history: 0.7,
  journal: 0.9,
  settings: 0.5,
  customize: 0.2
}

export interface GrowthPopup {
  dimension: DimensionId
  points: number
  levelUp: boolean
  before?: Record<DimensionId, number>
  after?: Record<DimensionId, number>
  preview?: boolean
  noteCount?:number
}

let lastSwitchVoiceAt = 0
let refreshGeneration=0

interface AppStore extends AppState {
  dataSyncVersion:number
  dataRevision:number
  localDay:string
  growthSummary:GrowthSummary|null
  dataResetVersion: number
  focusSaving: boolean
  focusPending: boolean
  knowledgeSection: 'notes' | 'review'
  focusClock: { label: string; time: string; paused: boolean } | null
  focusFinish: FocusCommitResult | null
  focusRewardPresentation:FocusRewardPresentation|null
  todaySeconds: number
  page: PageId
  prevPage: PageId
  growthEvents: GrowthEvent[]
  journals: Journal[]
  focusSessions: FocusSession[]
  todos: Todo[]
  habits: Habit[]
  habitLogs: HabitLog[]
  events: CalEvent[]
  popups: GrowthPopup[]
  // 主角状态联动
  characterMood: 'idle' | 'focus' | 'rest' | 'write' | 'levelup' | 'night'
  setMood: (m: AppStore['characterMood']) => void
  go: (p: PageId) => void
  refresh: () => Promise<void>
  setSettings: (patch: Partial<Settings>) => Promise<void>
  // 结算入账并触发演出
  applyGrowth: (items: Array<{ dimension: DimensionId; points: number; source: 'focus' | 'journal' | 'snapshot' | 'habit'; reason: string }>) => Promise<void>
  receiveGrowth: (result: GrowthApplyResult) => Promise<void>
  pushPopups: (popups: GrowthPopup[]) => void
  shiftPopup: () => void
}

export const useApp = create<AppStore>((set, get) => ({
  dataSyncVersion:0,
  dataRevision:0,
  localDay:localDateKey(),
  growthSummary:null,
  dataResetVersion: 0,
  growthEpoch: 0,
  focusSaving: false,
  focusPending: false,
  knowledgeSection: 'notes',
  stats: Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as Record<DimensionId, number>,
  settings: { ...DEFAULT_SETTINGS },
  focusClock: null,
  focusFinish: null,
  focusRewardPresentation:null,
  todaySeconds: 0,
  page: 'home',
  prevPage: 'home',
  growthEvents: [],
  journals: [],
  focusSessions: [],
  todos: [],
  habits: [],
  habitLogs: [],
  events: [],
  popups: [],
  characterMood: 'idle',
  setMood: (m) => set({ characterMood: m }),
  go: (p) => {
    set((s) => ({ page: p, prevPage: s.page, characterMood: p === 'journal' ? 'write' : 'idle' }))
    // 切换场景→"要怎样呢"，冷却时间内不重复播
    const s = get()
    const now = Date.now()
    if (s.settings.voiceEnabled && now - lastSwitchVoiceAt >= s.settings.voiceSwitchCooldown * 1000) {
      lastSwitchVoiceAt = now
      void playVoiceCat('question', s.settings.volume, (f) => f.includes('要怎样呢'))
    }
  },
  refresh: async () => {
    const generation=++refreshGeneration
    const [state, growthEvents, journals, focusSessions, todos, habits, habitLogs, events, todaySeconds, growthSummary] = await Promise.all([
      window.api.getState(),
      window.api.listGrowth(),
      window.api.listJournals(),
      window.api.listFocus(),
      window.api.todosList(),
      window.api.habitsList(),
      window.api.habitsLogs(),
      window.api.eventsList(),
      window.api.todayFocusSeconds(),
      window.api.growthSummary()
    ])
    if(generation!==refreshGeneration||(state.growthEpoch??0)<get().growthEpoch)return
    set(s=>({ ...state, growthEvents, journals, focusSessions, todos, habits, habitLogs, events, todaySeconds, growthSummary,localDay:growthSummary.date,dataRevision:s.dataRevision+1 }))
  },
  setSettings: async (patch) => {
    const settings = await window.api.updateSettings(patch)
    set({ settings })
  },
  applyGrowth: async (items) => {
    await get().receiveGrowth(await window.api.applyGrowth(items))
  },
  receiveGrowth: async (result) => {
    if((result.growthEpoch??0)<get().growthEpoch)return
    const before = result.before ?? get().stats
    set({ stats: result.stats })
    const popups: GrowthPopup[] = result.events
      .filter((i) => i.points > 0)
      .map((i) => ({ dimension: i.dimension, points: i.points, levelUp: false }))
    for (const dim of result.levelUps) {
      const p = popups.find((x) => x.dimension === dim)
      if (p) p.levelUp = true
    }
    // 升级检测兜底（多笔合并时）
    for (const p of popups) {
      if (levelOf(result.stats[p.dimension]) > levelOf(before[p.dimension])) p.levelUp = true
    }
    if (popups.length) get().pushPopups([{ ...popups[0], levelUp: popups.some(p => p.levelUp), before, after: result.stats }])
    await get().refresh()
    // 角色语音：升级→人格面具召唤
    if (get().settings.voiceEnabled && result.levelUps.length > 0) {
      void playVoiceCat('summon', get().settings.volume)
    }
  },
  pushPopups: (popups) => set((s) => ({ popups: [...s.popups, ...popups] })),
  shiftPopup: () => set((s) => ({ popups: s.popups.slice(1) }))
}))
