// 内置合成提示音：不依赖外部音频文件
let ctx: AudioContext | null = null
let master: GainNode | null = null
let configuredVolume=0.8

function ensure(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value=configuredVolume
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function setVolume(v: number): void {
  configuredVolume=Math.max(0,Math.min(1,v))
  if (master) master.gain.value = configuredVolume
}

function tone(
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType = 'sine',
  peak = 0.5,
  glideTo?: number
): void {
  const c = ensure()
  const t0 = c.currentTime + start
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g)
  g.connect(master!)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

function noise(start: number, dur: number, from: number, to: number, peak = 0.3): void {
  const c = ensure()
  const t0 = c.currentTime + start
  const len = Math.floor(c.sampleRate * dur)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = buf
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(from, t0)
  filter.frequency.exponentialRampToValueAtTime(to, t0 + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(peak, t0 + dur * 0.3)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(filter)
  filter.connect(g)
  g.connect(master!)
  src.start(t0)
}

// 成长提示音：上升音阶 + 星光闪烁感
export function playGrowth(): void {
  ensure()
  tone(523.25, 0, 0.18, 'sine', 0.4) // C5
  tone(659.25, 0.09, 0.18, 'sine', 0.4) // E5
  tone(783.99, 0.18, 0.22, 'sine', 0.45) // G5
  tone(1046.5, 0.27, 0.4, 'triangle', 0.3) // C6 shimmer
  tone(2093, 0.3, 0.3, 'sine', 0.12) // sparkle
}

// 升级提示音：更宏大的上行琶音
export function playLevelUp(): void {
  ensure()
  noise(0, 0.8, 200, 2400, 0.15)
  tone(392, 0, 0.25, 'sine', 0.4)
  tone(523.25, 0.12, 0.25, 'sine', 0.4)
  tone(659.25, 0.24, 0.25, 'sine', 0.4)
  tone(783.99, 0.36, 0.3, 'sine', 0.45)
  tone(1046.5, 0.5, 0.6, 'triangle', 0.35)
  tone(1568, 0.55, 0.7, 'sine', 0.18)
}

// 开始专注：下潜水声
export function playDive(): void {
  ensure()
  noise(0, 1.1, 3000, 180, 0.35)
  tone(180, 0.1, 0.9, 'sine', 0.15, 70)
}

// 专注结束：水面波纹钟声
export function playSurface(): void {
  ensure()
  tone(880, 0, 0.7, 'sine', 0.35)
  tone(1318.5, 0.05, 0.9, 'sine', 0.2)
  noise(0, 0.5, 800, 4000, 0.08)
}

// 即时反馈点击音（一级动效）
export function playClick(): void {
  ensure()
  tone(1200, 0, 0.06, 'square', 0.08)
}

// One short chime per visible note; future beats are scheduled by the overlay and cancelled on skip.
export function playNoteBeat(index:number):void {
  const frequency=[659.25,783.99,1046.5][index%3]
  tone(frequency,0,.17,'sine',.18)
  tone(frequency*2,.025,.12,'triangle',.045)
}
