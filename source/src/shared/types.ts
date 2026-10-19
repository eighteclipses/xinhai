import { COMMERCIAL_EDITION, PERSONAL_EDITION } from './edition'
import { personalAppearancePatch } from './personalAppearance'
import type { WallpaperItem, SavedTheme } from './themeLibrary'
import type { HomeLayouts } from './homeLayout'
export type DimensionId = 'knowledge' | 'will' | 'expression' | 'care' | 'craft'

export const DIMENSIONS: DimensionId[] = ['knowledge', 'will', 'expression', 'care', 'craft']

export const DIMENSION_NAMES: Record<DimensionId, string> = {
  knowledge: '学识',
  will: '意志',
  expression: '表达',
  care: '体贴',
  craft: '灵巧'
}

// 学识使用界面主色，其他维度保留有文字标注的语义辅色。
export const DIMENSION_COLORS: Record<DimensionId, string> = {
  knowledge: 'var(--theme-color)',
  will: '#989FFB',
  expression: '#FABA80',
  care: '#FF5268',
  craft: '#93CC96'
}

// P5R 等级称号（Lv1-5），沿用本项目维度：意志对应勇气、表达对应魅力。
export const DIMENSION_IDIOMS: Record<DimensionId, [string, string, string, string, string]> = {
  knowledge: ['才疏学浅', '勤奋好学', '知识分子', '博学多闻', '百科字典'],
  will: ['胆小多疑', '独当一面', '不屈不挠', '大胆无畏', '狮王之心'],
  expression: ['一般程度', '令人在意', '潜力十足', '魅力洋溢', '超凡脱俗'],
  care: ['不甚关心', '倾听高手', '善解人意', '乐于助人', '圣母慈爱'],
  craft: ['笨手笨脚', '普普通通', '专业职人', '大师手艺', '点石成金']
}

export function idiomOf(dimension: DimensionId, level: number): string {
  return DIMENSION_IDIOMS[dimension][Math.min(4, Math.max(0, level - 1))]
}

// 设计文档 7.4 等级阈值
export const LEVEL_THRESHOLDS = [0, 60, 180, 360, 600]

export function levelOf(points: number): number {
  let lv = 1
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (points >= LEVEL_THRESHOLDS[i]) lv = i + 1
  }
  return lv
}

export function nextThreshold(points: number): number | null {
  for (const t of LEVEL_THRESHOLDS) if (points < t) return t
  return null
}

export type GrowthSource = 'focus' | 'journal' | 'snapshot' | 'habit'

export interface Todo {
  categoryId?: string | null
  id: number
  title: string
  priority: number
  date: string
  estPomos: number
  done: boolean
  focusMinutes: number
  createdAt: number
  completedAt?: number | null
}
export type TodoUpdateInput = Pick<Todo,'id'|'title'|'priority'|'date'|'estPomos'|'categoryId'>

export interface Habit {
  categoryId?: string | null
  id: number
  name: string
  dimension: DimensionId
  weeklyTarget: number
}

export interface HabitLog {
  categoryId?: string | null
  id: number
  habitId: number
  date: string
  ts: number
}
export type HabitUpdateInput = Pick<Habit,'id'|'name'|'dimension'|'weeklyTarget'|'categoryId'>

export interface CalEvent {
  categoryId?: string | null
  id: number
  title: string
  date: string
  kind: '课程' | '考试' | '截止' | '学习'
}

export const EVENT_COLORS: Record<CalEvent['kind'], string> = {
  课程: '#00A8F0',
  考试: '#FF5268',
  截止: '#FABA80',
  学习: '#93CC96'
}
export type CalendarEventUpdateInput = CalEvent

export interface GrowthEvent {
  id: number
  ts: number
  dimension: DimensionId
  points: number
  source: GrowthSource
  reason: string
}
export const GROWTH_SOURCE_NAMES:Record<GrowthSource,string>={focus:'专注',journal:'日记',snapshot:'即时拍',habit:'习惯'}
export interface GrowthSummary {
  date:string
  recentByDimension:Record<DimensionId,GrowthEvent[]>
  activeDimensions:DimensionId[]
  todayEventCount:number
  todayMaxPoints:number
}

export interface FocusSession {
  categoryId?: string | null
  id: number
  startedAt: number
  endedAt: number
  minutes: number
  seconds?: number // Legacy rows have minute precision.
  mode: string
  taskLabel: string
}

export interface FocusTaskSummary {
  totalSeconds: number
  sessionCount: number
  legacySessionCount: number
  tasks: Array<{ taskLabel: string; seconds: number; sessionCount: number; lastEndedAt: number; legacySessionCount: number }>
}

export interface EvidenceItem {
  sentenceId: number
  indicatorId: string
  evidence: string
  polarity: 'positive' | 'negative' | 'unknown' | 'not_mentioned'
  strength: number
}

export interface ScoreResult {
  engine: 'llm' | 'local'
  fallbackReason?: 'not-configured' | 'unavailable'
  insufficient: boolean
  scores: Record<DimensionId, number>
  reasons: Record<DimensionId, string>
  summary: string
  evidence: EvidenceItem[]
}

export interface Journal {
  categoryId?: string | null
  id: number
  ts: number
  content: string
  scores: Record<DimensionId, number>
  summary: string
  engine: 'llm' | 'local'
}

export interface JournalCursor { ts:number; id:number }
export interface JournalPageQuery { categoryId?:string|null; query?:string; cursor?:JournalCursor|null; limit?:number }
export interface JournalPage { items:Journal[]; total:number; matchedTotal:number; nextCursor:JournalCursor|null }

export interface JournalCommitInput {
  categoryId?: string | null
  token: string
  content: string
  scores: Record<DimensionId, number>
  summary: string
  engine: 'llm' | 'local'
}
export interface JournalCommitResult { journal: Journal; growth: GrowthApplyResult }

export type BackgroundId = 'original-deep-sea' | 'original-forest-dawn' | 'original-orbital-night' | 'masq-aigis-red' | 'masq-aigis-gold' | 'masq-makoto' | 'masq-yukari' | 'rain-aigis' | 'rain-makoto' | 'rain-yukari' | 'makoto-blue' | 'makoto-yuki-4k' | 'blue4k' | 'stream' | 'train-night' | 'train-day' | 'classroom' | 'classroom-window' | 'moon-on-water-loop' | 'moon-colonnade-ai' | 'moon-courtyard-ai' | 'sea' | 'custom'

export interface CustomBackground { id?:string; name:string; src:string; kind:'image'|'video'; poster:string; themeColor?:string }

export interface Settings {
  focusPanelLayout: { x:number; y:number; scale:number } | null
  focusBackgroundBehavior: 'wait' | 'continue'
  focusRewardPresentation: 'round' | 'batch'
  homeLayouts: HomeLayouts
  wallpaperLibrary: WallpaperItem[]
  savedThemes: SavedTheme[]
  sceneTransition: 'fade' | 'arc' | 'none'
  ambientEffect: 'none' | 'motes' | 'stars'
  wallpaperMotion: boolean
  themeMode: 'wallpaper' | 'fixed'
  themeColor: string
  wallpaperThemeColors: Record<string, string>
  autoSceneEnabled: boolean
  autoSceneIntervalSeconds: number
  autoSceneMode: 'random' | 'sequence'
  autoSceneIds: BackgroundId[]
  autoSceneFocus: boolean
  autoSceneWallpaper: boolean
  autoSceneOther: boolean
  clockPosition: {x:number;y:number} | null
  playerPosition: {x:number;y:number} | null
  musicLibraryPosition: {x:number;y:number} | null
  playerScale: number
  clockStyle: 'classic' | 'minimal' | 'p3r' | 'hidden'
  clockScale: number
  playerStyle: 'bar' | 'card' | 'mp3'
  backgroundFit: 'cover' | 'contain'

  customBackground: CustomBackground | null
  llmEndpoint: string
  llmKey: string
  llmModel: string
  volume: number
  reduceMotion: boolean
  focusAlloutEnabled: boolean
  particles: boolean
  showCharacter: boolean
  background: BackgroundId
  pageBackgrounds: boolean
  voiceEnabled: boolean
  autoPlayMusic: boolean
  voiceSwitchCooldown: number
  panelOpacity: number
  panelBlur: number
  wallpaperDim: number
  characterStyle: 'auto' | 'seated' | 'uniform' | 'battle' | 'gallery' | 'hidden'
  characterArtId: string
  characterOpacity: number
  characterScale: number
  characterPosition: import('./characterPlacement').CharacterPosition | null
  timerPosition: 'center' | 'left' | 'right' | 'bottom'
  wallpaperClock: boolean
  knowledgePath: string
}

export const DEFAULT_SETTINGS: Settings = {
  focusPanelLayout: null,
  focusBackgroundBehavior: 'wait',
  focusRewardPresentation: 'batch',
  homeLayouts: { version: 2 },
  wallpaperLibrary: [],
  savedThemes: [],
  sceneTransition: COMMERCIAL_EDITION ? 'fade' : 'arc',
  ambientEffect: COMMERCIAL_EDITION ? 'motes' : 'none',
  wallpaperMotion: COMMERCIAL_EDITION,
  themeMode: 'wallpaper',
  themeColor: COMMERCIAL_EDITION ? '#67ddd1' : '#21bce7',
  wallpaperThemeColors: {},
  autoSceneEnabled: false,
  autoSceneIntervalSeconds: 300,
  autoSceneMode: 'random',
  autoSceneIds: COMMERCIAL_EDITION ? ['original-deep-sea','original-forest-dawn','original-orbital-night'] : ['masq-aigis-red','masq-aigis-gold','masq-makoto','masq-yukari','rain-aigis','rain-makoto','rain-yukari'],
  autoSceneFocus: true,
  autoSceneWallpaper: true,
  autoSceneOther: false,
  clockPosition: null,
  playerPosition: null,
  musicLibraryPosition: null,
  playerScale: 1,
  clockStyle: COMMERCIAL_EDITION ? 'minimal' : 'classic',
  clockScale: .8,
  playerStyle: COMMERCIAL_EDITION ? 'card' : 'bar',
  backgroundFit: 'cover',
  customBackground: null,
  llmEndpoint: '',
  llmKey: '',
  llmModel: 'deepseek-chat',
  volume: 0.8,
  reduceMotion: false,
  focusAlloutEnabled: false,
  particles: true,
  showCharacter: !COMMERCIAL_EDITION,
  background: COMMERCIAL_EDITION ? 'original-deep-sea' : 'train-night',
  pageBackgrounds: !COMMERCIAL_EDITION,
  voiceEnabled: false,
  autoPlayMusic: false,
  voiceSwitchCooldown: 60,
  panelOpacity: COMMERCIAL_EDITION ? .58 : .46,
  panelBlur: COMMERCIAL_EDITION ? 8 : 4,
  wallpaperDim: 0.08,
  characterStyle: COMMERCIAL_EDITION ? 'hidden' : 'auto',
  characterArtId: '',
  characterOpacity: 1,
  characterScale: 1,
  characterPosition: null,
  timerPosition: 'center',
  wallpaperClock: true,
  knowledgePath: '',
  // Existing databases merge their saved values over these new-install defaults.
  ...(PERSONAL_EDITION && !COMMERCIAL_EDITION ? personalAppearancePatch() : {})
}

export interface AppState {
  stats: Record<DimensionId, number>
  settings: Settings
  growthEpoch: number
}

export type DataResetScope = 'growth' | 'practice'
export interface GrowthResetInfo { eventCount:number; practiceCount:number; canUndo:boolean; lastResetAt:number|null }

export interface GrowthApplyResult {
  growthEpoch?: number
  before?: Record<DimensionId, number>
  events: GrowthEvent[]
  stats: Record<DimensionId, number>
  levelUps: DimensionId[]
}

export interface FocusCommitInput {
  categoryId?: string | null
  token: string
  startedAt: number
  endedAt: number
  seconds: number
  mode: string
  taskLabel: string
  todoId: number | null
}
export interface FocusCommitResult {
  session: FocusSession
  growth: GrowthApplyResult
  before: Record<DimensionId, number>
  rewardState?: FocusRewardState
}
export interface FocusRewardState {earnedNotes:number;pendingNotes:number;remainderSeconds:number}
export interface FocusRewardPresentation {token:string;blockIds:string[];notes:number;before:Record<DimensionId,number>;after:Record<DimensionId,number>}
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
export function dimensionProgress(points: number): number {
  const level = levelOf(points)
  if (level === 5) return 1
  const lower = LEVEL_THRESHOLDS[level - 1], upper = LEVEL_THRESHOLDS[level]
  return (points - lower) / (upper - lower)
}
export function radarRadius(points: number): number {
  return Math.min(1, (levelOf(points) + dimensionProgress(points)) / 5)
}

export interface KnowledgeNote { path:string; title:string; content:string; revision:string; modifiedAt:number; categoryId?:string|null }
export interface KnowledgeVault { root:string; notes:KnowledgeNote[]; skipped:number }
export interface KnowledgeNoteTarget { path:string; revision:string; expectedRoot:string }

export type ReviewRating = 'again' | 'familiar' | 'remembered'
export interface ReviewCard {
  categoryId?:string|null
  id:string; question:string; answer:string; topic:string; sourceRoot:string; sourcePath:string
  dueDate:string; intervalDays:number; reviews:number; archived:boolean; version:number
  createdAt:number; updatedAt:number
}
export type ReviewDraft = Pick<ReviewCard,'id'|'question'|'answer'|'topic'|'sourceRoot'|'sourcePath'|'version'|'categoryId'>

export interface CalendarEntry { categoryId?:string|null; id:string; date:string; kind:'todo'|'habit'|'journal'|'focus'|'event'; title:string; detail:string; ts?:number; state?:string; durationSeconds?:number }
