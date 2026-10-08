import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { hostname, networkInterfaces } from 'node:os'
import { webcrypto } from 'node:crypto'
import type { SyncPacket, SyncStatus } from '../shared/lanSyncTypes'
import {
  SYNC_PORT, SYNC_LIMIT, PAIR_PATH, EXCHANGE_PATH, PAIR_TTL, authenticatedPacket,
  boundedJSON, isId, isObject, isPrivateIPv4, makePairCode, open, parseJSON,
  randomKey, seal, validateWire, type LanSyncEngine, type SyncWire,
} from '../shared/lanSyncCrypto'

const crypto = webcrypto as unknown as Crypto
const META = 'lan.transport.host.v1'
interface Peer { id: string; name: string; key: string; lastSync: number | null; recent: string[] }
interface Ticket { key: string; expiresAt: number; used?: { peerId: string; requestId: string; response: SyncWire } }
interface Config { enabled: boolean; peers: Peer[]; ticket?: Ticket }
class HttpError extends Error { constructor(readonly status: number) { super('同步请求未完成。') } }

function localAddresses(): string[] {
  const physical: string[] = [], other: string[] = []
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    const target = /virtual|vethernet|vmware|vbox|hyper-v|docker|wsl|tailscale|zerotier|tun|tap|loopback|bridge/i.test(name) ? other : physical
    for (const entry of entries || []) if (!entry.internal && entry.family === 'IPv4' && isPrivateIPv4(entry.address)) target.push(entry.address)
  }
  return [...new Set(physical.length ? physical : other)].slice(0, 16)
}
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0
    const timer = setTimeout(() => { reject(new HttpError(408)); req.destroy() }, 5000)
    const done = () => clearTimeout(timer)
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > SYNC_LIMIT) { done(); reject(new HttpError(413)); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => { done(); resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', () => { done(); reject(new HttpError(400)) })
    req.on('aborted', () => { done(); reject(new HttpError(400)) })
  })
}
function respond(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.writableEnded) return
  let text: string
  try { text = boundedJSON(body) } catch { status = 413; text = '{"error":"同步数据超过大小限制。"}' }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), 'Connection': 'close', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(text)
}

export function createLanSyncServer(engine: LanSyncEngine, notify: () => void) {
  const config = engine.getMeta<Config>(META, { enabled: false, peers: [] })
  let server: Server | undefined, starting: Promise<void> | undefined, stopped = false, activeRequests = 0
  let message = '', serial: Promise<unknown> = Promise.resolve()
  const rates = new Map<string, { since: number; count: number }>()
  let globalRate = { since: 0, count: 0 }
  const save = () => engine.setMeta(META, config)
  const name = hostname().replace(/[\x00-\x1f\x7f]/g, '').slice(0, 100) || '心海电脑'
  function status(): SyncStatus {
    const lastSync = Math.max(0, ...config.peers.map(p => p.lastSync || 0)) || null
    return {
      role: 'host', enabled: config.enabled, deviceId: engine.deviceId, deviceName: name, addresses: localAddresses(),
      peers: config.peers.map(p => ({ id: p.id, name: p.name, lastSync: p.lastSync, error: '' })),
      state: !config.enabled || stopped ? 'off' : message ? 'error' : activeRequests ? 'syncing' : lastSync && Date.now() - lastSync < 20000 ? 'online' : config.peers.length ? 'offline' : 'waiting',
      lastSync, message, conflicts: engine.conflicts(), hasBackup: engine.hasBackup(),
    }
  }
  function allowed(ip: string): boolean {
    const now = Date.now()
    if (now - globalRate.since >= 60000) globalRate = { since: now, count: 0 }
    if (++globalRate.count > 240) return false
    for (const [key, value] of rates) if (now - value.since >= 60000) rates.delete(key)
    let rate = rates.get(ip)
    if (!rate) { if (rates.size >= 256) return false; rate = { since: now, count: 0 }; rates.set(ip, rate) }
    return ++rate.count <= 60
  }
  async function process(wire: SyncWire, path: string, live: () => boolean): Promise<SyncWire> {
    if (!live() || wire.hostId !== engine.deviceId || wire.peerId === engine.deviceId) throw new HttpError(403)
    if (path === PAIR_PATH) {
      const ticket = config.ticket
      if (!ticket || ticket.expiresAt <= Date.now()) throw new HttpError(403)
      const payload = await open(ticket.key, 'pair-request', wire, crypto)
      if (!live() || config.ticket !== ticket || ticket.expiresAt <= Date.now()) throw new HttpError(403)
      if (!isObject(payload) || payload.device !== wire.peerId || typeof payload.name !== 'string' || payload.name.length > 100) throw new HttpError(400)
      if (ticket.used) {
        if (ticket.used.peerId !== wire.peerId || ticket.used.requestId !== wire.requestId || !config.peers.some(p => p.id === wire.peerId)) throw new HttpError(403)
        return ticket.used.response
      }
      if (config.peers.length >= 32 && !config.peers.some(p => p.id === wire.peerId)) throw new HttpError(429)
      const peer: Peer = { id: wire.peerId, name: payload.name.replace(/[\x00-\x1f\x7f]/g, '') || '心海平板', key: randomKey(crypto), lastSync: null, recent: [] }
      const response = await seal(ticket.key, 'pair-response', wire, { device: engine.deviceId, key: peer.key, name }, crypto)
      if (!live() || config.ticket !== ticket || ticket.expiresAt <= Date.now()) throw new HttpError(403)
      config.peers = [...config.peers.filter(p => p.id !== peer.id), peer]
      ticket.used = { peerId: peer.id, requestId: wire.requestId, response }
      save() // Commit key and retry response together, before writing the HTTP response.
      return response
    }
    const peer = config.peers.find(p => p.id === wire.peerId)
    if (!peer) throw new HttpError(403)
    const payload = await open(peer.key, 'exchange-request', wire, crypto)
    if (!live() || !config.peers.includes(peer)) throw new HttpError(403)
    if (!isObject(payload)) throw new HttpError(400)
    const packet: SyncPacket = authenticatedPacket(payload.packet, peer.id)
    if (peer.recent.includes(wire.requestId)) throw new HttpError(409)
    // Persist the replay guard before merging. A retry uses a fresh request id and
    // the client's unchanged vector; the merge engine makes resending records safe.
    peer.recent = [...peer.recent.slice(-127), wire.requestId]
    save()
    if (!engine.hasBackup()) engine.backup()
    const changed = engine.merge(packet)
    if (changed > 0) { try { notify() } catch { /* UI failures must not undo a merge. */ } }
    const outgoing = engine.packet(packet.vector)
    const response = await seal(peer.key, 'exchange-response', wire, { packet: outgoing }, crypto)
    if (!live() || !config.peers.includes(peer)) throw new HttpError(403)
    peer.lastSync = Date.now(); save()
    return response
  }
  async function handle(req: IncomingMessage, res: ServerResponse, instance: Server): Promise<void> {
    const live = () => !stopped && config.enabled && server === instance
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '')
    // Reject web-page traffic and untrusted address/method/path combinations before
    // reading any body or performing cryptography. No CORS or preflight support.
    const host = req.headers.host || ''
    if (!live() || !isPrivateIPv4(ip) || req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined || !host.endsWith(':' + SYNC_PORT) || !isPrivateIPv4(host.slice(0, -5))) { respond(res, 403, { error: '同步请求被拒绝。' }); return }
    if (req.method !== 'POST') { respond(res, 405, { error: '同步请求被拒绝。' }); return }
    if (req.url !== PAIR_PATH && req.url !== EXCHANGE_PATH) { respond(res, 404, { error: '同步请求被拒绝。' }); return }
    if (!allowed(ip) || activeRequests >= 8) { respond(res, 429, { error: '请稍后重试同步。' }); return }
    const length = req.headers['content-length']
    if (req.headers['transfer-encoding'] !== undefined || req.headers['content-encoding'] !== undefined || !length || !/^\d+$/.test(length) || Number(length) > SYNC_LIMIT || Number(length) < 2 || req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') { respond(res, 413, { error: '同步请求格式或大小无效。' }); return }
    activeRequests++
    // An absolute deadline also bounds slow responses and requests queued for crypto.
    const deadline = setTimeout(() => { req.destroy(); res.destroy() }, 15000)
    const clearDeadline = () => clearTimeout(deadline)
    res.once('finish', clearDeadline)
    res.once('close', clearDeadline)
    try {
      const wire = validateWire(parseJSON(await readBody(req)))
      const path = req.url
      const result = serial.then(() => process(wire, path, () => live() && !res.destroyed))
      serial = result.catch(() => undefined)
      respond(res, 200, await result)
    } catch (error) { respond(res, error instanceof HttpError ? error.status : 400, { error: '同步请求未通过认证或数据校验。' }) }
    finally { activeRequests-- }
  }
  async function start(): Promise<void> {
    if (starting) return starting
    if (server?.listening || stopped || !config.enabled) return
    const instance = createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 5000 }, (req, res) => { void handle(req, res, instance) })
    instance.maxConnections = 32
    instance.setTimeout(5000, socket => socket.destroy())
    instance.on('checkContinue', (_req, res) => respond(res, 417, { error: '同步请求被拒绝。' }))
    instance.on('checkExpectation', (_req, res) => respond(res, 417, { error: '同步请求被拒绝。' }))
    instance.on('clientError', (_error, socket) => socket.destroy())
    server = instance
    starting = new Promise<void>(resolve => {
      instance.on('error', () => { if (server === instance) { message = '局域网同步端口不可用，请检查 7392 端口后重试。'; server = undefined }; resolve() })
      instance.listen(SYNC_PORT, '0.0.0.0', () => {
        if (!config.enabled || stopped || server !== instance) { instance.close(); instance.closeAllConnections() }
        else message = ''
        resolve()
      })
    }).finally(() => { starting = undefined })
    return starting
  }
  function close(): void {
    const instance = server; server = undefined
    if (instance) { instance.close(); instance.closeAllConnections() }
  }
  async function enable(value: boolean): Promise<SyncStatus> {
    config.enabled = Boolean(value); stopped = false
    if (!value) { delete config.ticket; close(); message = '' }
    save()
    if (value) { await starting; await start() }
    return status()
  }
  async function pairCode(): Promise<{ code: string; expiresAt: number }> {
    if (!config.enabled || stopped) throw Error('请先开启局域网同步。')
    await start()
    if (!server?.listening) throw Error('局域网同步服务尚未启动。')
    const addresses = localAddresses()
    if (!addresses.length) throw Error('未找到局域网 IPv4 地址，请连接 Wi-Fi 或有线网络。')
    const ticket: Ticket = { key: randomKey(crypto), expiresAt: Date.now() + PAIR_TTL }
    config.ticket = ticket; save()
    return { code: makePairCode({ hostId: engine.deviceId, addresses, port: SYNC_PORT, key: ticket.key, name }), expiresAt: ticket.expiresAt }
  }
  async function now(): Promise<SyncStatus> { if (config.enabled && !stopped) await start(); return status() }
  async function unpair(id: string): Promise<SyncStatus> {
    if (!isId(id)) throw Error('同步设备标识无效。')
    config.peers = config.peers.filter(p => p.id !== id)
    if (config.ticket?.used?.peerId === id) delete config.ticket
    save(); return status()
  }
  function stop(): void { stopped = true; close() }
  if (config.enabled) void start()
  return { status, enable, pairCode, now, unpair, stop }
}
