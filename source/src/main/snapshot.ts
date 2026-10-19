import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { ModelClient } from '../shared/modelConfig'
import { scoreJournal } from './scoring'
import { DIMENSIONS, type DimensionId } from '../shared/types'

// 可选本机自动化调试：POST /snapshot {caption} → 评分入账 → 桌面触发现场演出
export function startSnapshotServer(getWindow: () => BrowserWindow | null,model:ModelClient): void {
  // No edition starts this experimental listener by default. Local automation
  // also requires a caller-owned token, because a request may use a paid model.
  if (process.env.XINHAI_ENABLE_SNAPSHOT !== '1') return
  const token = process.env.XINHAI_SNAPSHOT_TOKEN || ''
  if (Buffer.byteLength(token) < 32 || Buffer.byteLength(token) > 256) {
    console.error('即时拍未启用：请通过 XINHAI_SNAPSHOT_TOKEN 设置32到256字节的随机令牌。')
    return
  }
  const expected = Buffer.from(`Bearer ${token}`)
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    const actual = Buffer.from(req.headers.authorization || '')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if (req.method === 'POST' && req.url === '/snapshot') {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > 1024 * 1024) req.destroy()
        else chunks.push(c)
      })
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8')
        void (async () => {
          try {
            const { caption } = JSON.parse(body || '{}') as { caption?: string }
            const text = (caption ?? '').trim()
            if (text.length < 4) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'caption too short' }))
              return
            }
            // 即时拍是一句话描述，最小字数阈值比日记宽松（v3 skill 无覆盖率概念）
            const result = await scoreJournal(text, model, { minText: 6 })
            const snippet = text.slice(0, 24) + (text.length > 24 ? '…' : '')
            const items = DIMENSIONS.filter((d) => result.scores[d] > 0).map((d) => ({
              dimension: d as DimensionId,
              points: result.scores[d],
              source: 'snapshot' as const,
              reason: `即时拍 · ${snippet}`
            }))
            const win = getWindow()
            if (win) win.webContents.send('remote-growth', items)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, scores: result.scores, summary: result.summary }))
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'snapshot failed' }))
          }
        })()
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  server.on('error', error => { console.error('即时拍服务未启动：', error.message) })
  server.listen(7391, '127.0.0.1', () => {
    console.log('snapshot server on 127.0.0.1:7391')
  })
}
