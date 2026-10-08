import { useReducedEffects } from '../lib/motion'
import { useEffect, useRef } from 'react'
import { useApp } from '../store/app'
import { effectiveThemeColor } from '../../../shared/theme'

// 统一水下空间：所有模块共享同一场景，用深度分层
// seaMode=true 时绘制不透明深度渐变（程序化心海）；否则只叠加光柱/气泡/粒子/水波
export default function UnderwaterBackground({ depth, seaMode }: { depth: number; seaMode: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const depthRef = useRef(depth)
  const mouseRef = useRef({ x: 0.5, y: 0.5 })
  const reduce = useReducedEffects()
  const particlesOn = useApp((s) => s.settings.particles)
  const themeColor = useApp((s) => effectiveThemeColor(s.settings))

  useEffect(() => {
    depthRef.current = depth
  }, [depth])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const accent = [1,3,5].map(i=>parseInt(themeColor.slice(i,i+2),16))
    const light = lerpColor(accent,[255,255,255],.55).join(',')
    let raf = 0
    let w = (canvas.width = window.innerWidth)
    let h = (canvas.height = window.innerHeight)
    const onResize = () => {
      w = canvas.width = window.innerWidth
      h = canvas.height = window.innerHeight
      if (reduce) draw()
    }
    window.addEventListener('resize', onResize)

    interface Bubble {
      x: number
      y: number
      r: number
      v: number
      sway: number
    }
    const bubbles: Bubble[] = Array.from({ length: 26 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 1 + Math.random() * 3.5,
      v: 0.25 + Math.random() * 0.7,
      sway: Math.random() * Math.PI * 2
    }))
    interface Mote {
      x: number
      y: number
      r: number
      vx: number
      vy: number
      a: number
    }
    const motes: Mote[] = Array.from({ length: 40 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.6 + Math.random() * 1.6,
      vx: (Math.random() - 0.5) * 0.12,
      vy: (Math.random() - 0.5) * 0.08,
      a: 0.08 + Math.random() * 0.25
    }))
    const shards = Array.from({ length: 10 }, (_, i) => ({
      x: Math.random() * w, y: Math.random() * h, size: 18 + Math.random() * 46,
      speed: 0.12 + Math.random() * 0.25, phase: i * 1.7
    }))

    let cur = depthRef.current
    let t = 0

    let previous = performance.now()
    const draw = () => {
      const now = performance.now()
      const step = Math.min(3, (now - previous) / (1000 / 60))
      previous = now
      t += step / 60
      cur = reduce ? depthRef.current : cur + (depthRef.current - cur) * 0.04
      const m = mouseRef.current
      const px = (m.x - 0.5) * 14
      const py = (m.y - 0.5) * 8

      ctx.clearRect(0, 0, w, h)
      if (seaMode) {
        // 深度渐变继承独立主题色。
        const top = lerpColor(lerpColor([8,8,8],accent,.35),[3,3,3],cur)
        const bottom = lerpColor(lerpColor([3,3,3],accent,.14),[1,1,1],cur)
        const grad = ctx.createLinearGradient(0, 0, 0, h)
        grad.addColorStop(0, rgb(top))
        grad.addColorStop(1, rgb(bottom))
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, w, h)
      }

      // 光柱（水面折射）
      if (!reduce) {
        const rayAlpha = 0.1 * (1 - cur * 0.8)
        for (let i = 0; i < 4; i++) {
          const cx = w * (0.15 + i * 0.25) + Math.sin(t * 0.3 + i) * 40 + px
          const g2 = ctx.createLinearGradient(cx, 0, cx + 120, h * 0.8)
          g2.addColorStop(0, `rgba(${light}, ${rayAlpha})`)
          g2.addColorStop(1, `rgba(${light}, 0)`)
          ctx.fillStyle = g2
          ctx.beginPath()
          ctx.moveTo(cx - 30, -10)
          ctx.lineTo(cx + 60, -10)
          ctx.lineTo(cx + 190, h * 0.85)
          ctx.lineTo(cx + 20, h * 0.85)
          ctx.closePath()
          ctx.fill()
        }
      }

      if (particlesOn && !reduce) {
        // 斜切几何碎片：借鉴活动 PV 的分屏与切片语言，保持低存在感以免遮挡内容。
        for (const s of shards) {
          s.y -= s.speed * step
          if (s.y < -80) { s.y = h + 60; s.x = Math.random() * w }
          const drift = Math.sin(t * .5 + s.phase) * 22 + px * .25
          ctx.fillStyle = `rgba(${light}, ${0.025 + 0.02 * Math.sin(t + s.phase)})`
          ctx.beginPath()
          ctx.moveTo(s.x + drift, s.y)
          ctx.lineTo(s.x + s.size + drift, s.y + s.size * .22)
          ctx.lineTo(s.x + s.size * .55 + drift, s.y + s.size)
          ctx.lineTo(s.x - s.size * .18 + drift, s.y + s.size * .55)
          ctx.closePath(); ctx.fill()
        }
        // 漂浮颗粒（视差）
        for (const p of motes) {
          p.x += p.vx * step
          p.y += p.vy * step
          if (p.x < 0) p.x = w
          if (p.x > w) p.x = 0
          if (p.y < 0) p.y = h
          if (p.y > h) p.y = 0
          const tw = 0.6 + 0.4 * Math.sin(t * 1.5 + p.x)
          ctx.fillStyle = `rgba(${light}, ${p.a * tw * (1 - cur * 0.5)})`
          ctx.beginPath()
          ctx.arc(p.x + px * 0.4, p.y + py * 0.4, p.r, 0, Math.PI * 2)
          ctx.fill()
        }
        // 上升气泡
        for (const b of bubbles) {
          b.y -= b.v * step
          b.sway += 0.02 * step
          if (b.y < -10) {
            b.y = h + 10
            b.x = Math.random() * w
          }
          const bx = b.x + Math.sin(b.sway) * 12 + px * 0.6
          ctx.strokeStyle = `rgba(${light}, ${0.25 * (1 - cur * 0.4)})`
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(bx, b.y, b.r, 0, Math.PI * 2)
          ctx.stroke()
          ctx.fillStyle = `rgba(${light}, ${0.12})`
          ctx.beginPath()
          ctx.arc(bx - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.35, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // 水波（顶部）
      if (!reduce) {
        ctx.strokeStyle = `rgba(${light}, ${0.12 * (1 - cur)})`
        ctx.lineWidth = 1.5
        for (let line = 0; line < 3; line++) {
          ctx.beginPath()
          for (let x = 0; x <= w; x += 8) {
            const y = 30 + line * 26 + Math.sin(x * 0.012 + t * (0.8 + line * 0.2)) * 6
            if (x === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.stroke()
        }
      }

      if (!reduce && !document.hidden) raf = requestAnimationFrame(draw)
    }
    const onVisibility = () => {
      cancelAnimationFrame(raf)
      previous = performance.now()
      if (!document.hidden) draw()
    }
    document.addEventListener('visibilitychange', onVisibility)
    draw()
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reduce, particlesOn, seaMode, themeColor, reduce ? depth : null])

  return <canvas aria-hidden="true" ref={canvasRef} style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }} />
}

function lerpColor(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t))
}
function rgb(c: number[]): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}
