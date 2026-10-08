// 结城理语音：按分类目录播放（summon/skill/action/result/answer/question/retreat/entrust/breath）
// 已清除全部语气词/语气音，只保留语义语音
// Howl 池：按文件懒创建并缓存，替换即造即弃的 new Audio()
import { Howl } from 'howler'
import { COMMERCIAL_EDITION } from '../../../shared/edition'

export type VoiceCat =
  | 'breath'
  | 'skill'
  | 'summon'
  | 'action'
  | 'result'
  | 'answer'
  | 'question'
  | 'retreat'
  | 'entrust'

interface ManifestItem {
  file: string
  cat: VoiceCat
}

let items: ManifestItem[] | null = null
let lastPlayed = ''

async function loadManifest(): Promise<ManifestItem[]> {
  if(COMMERCIAL_EDITION)return []
  if (items) return items
  try {
    const res = await fetch('voices/manifest.json')
    items = (await res.json()) as ManifestItem[]
  } catch {
    items = []
  }
  return items!
}

const howls = new Map<string, Howl>()
let current: Howl | null = null

function getHowl(file: string): Howl {
  let howl = howls.get(file)
  if (!howl) {
    howl = new Howl({
      src: ['voices/' + file.split('/').map(encodeURIComponent).join('/')],
      preload: true
    })
    howls.set(file, howl)
  }
  return howl
}

function playHowl(file: string, volume: number): void {
  // 新语音打断旧语音（单播）
  if (current) {
    current.stop()
    current = null
  }
  const howl = getHowl(file)
  howl.volume(Math.max(0, Math.min(1, volume * 0.85)))
  howl.play()
  current = howl
}

export async function playVoiceCat(
  cat: VoiceCat,
  volume: number,
  filter?: (file: string) => boolean
): Promise<void> {
  const list = await loadManifest()
  let pool = list.filter((i) => i.cat === cat && (!filter || filter(i.file)))
  const dedup = pool.filter((i) => i.file !== lastPlayed)
  if (dedup.length > 0) pool = dedup
  if (pool.length === 0) return
  const pick = pool[Math.floor(Math.random() * pool.length)]
  lastPlayed = pick.file
  playHowl(pick.file, volume)
}

// 胜负结果："赢了呢"
export async function playWin(volume: number): Promise<void> {
  const list = await loadManifest()
  const win = list.find((i) => i.cat === 'result' && i.file.includes('赢了呢'))
  if (!win) return
  playHowl(win.file, volume)
}
