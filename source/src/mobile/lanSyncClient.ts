import { request } from './native'
import type { SyncPacket, SyncStatus, SyncVector } from '../shared/lanSyncTypes'
import {
  SYNC_PORT, PAIR_PATH, EXCHANGE_PATH, PAIR_TTL, authenticatedPacket, boundedJSON,
  copyVector, isId, isObject, isPrivateIPv4, open, parseJSON, parsePairCode, seal,
  validKey, validateWire, type LanSyncEngine, type PairInfo, type SyncWire,
} from '../shared/lanSyncCrypto'

const META = 'lan.transport.client.v1'
interface Peer { id: string; name: string; key: string; addresses: string[]; vector: SyncVector; lastSync: number | null }
interface Pending { info: PairInfo; wire: SyncWire; expiresAt: number }
interface Config { enabled: boolean; peers: Peer[]; pending?: Pending }
class TransportError extends Error { constructor(readonly status: number) { super('局域网连接暂不可用。') } }

export function createLanSyncClient(engine: LanSyncEngine, notify: () => void) {
  const config = engine.getMeta<Config>(META, { enabled: false, peers: [] })
  const errors = new Map<string, string>()
  const deviceName = '心海平板'
  let stopped = false, epoch = 0, inFlight: Promise<SyncStatus> | undefined
  let timer: ReturnType<typeof setInterval> | undefined, message = ''
  const save = () => engine.setMeta(META, config)
  function status(): SyncStatus {
    const lastSync = Math.max(0, ...config.peers.map(p => p.lastSync || 0)) || null
    return {
      role: 'client', enabled: config.enabled, deviceId: engine.deviceId, deviceName,
      addresses: [...new Set(config.peers.flatMap(p => p.addresses))],
      peers: config.peers.map(p => ({ id: p.id, name: p.name, lastSync: p.lastSync, error: errors.get(p.id) || '' })),
      state: !config.enabled || stopped ? 'off' : inFlight ? 'syncing' : message || errors.size ? 'offline' : lastSync && Date.now() - lastSync < 20000 ? 'online' : config.peers.length ? 'offline' : 'waiting',
      lastSync, message, conflicts: engine.conflicts(), hasBackup: engine.hasBackup(),
    }
  }
  function live(generation: number): boolean { return config.enabled && !stopped && generation === epoch }
  async function http(addresses: string[], path: string, wire: SyncWire, generation: number): Promise<{ wire: SyncWire; address: string }> {
    const body = boundedJSON(wire)
    for (const host of addresses) {
      if (!live(generation)) throw new TransportError(0)
      if (!isPrivateIPv4(host)) continue
      try {
        const response = await request<{ status: number; body: string }>('syncHttp', { host, port: SYNC_PORT, path, body })
        if (!live(generation)) throw new TransportError(0)
        if (!isObject(response) || typeof response.status !== 'number' || typeof response.body !== 'string') throw new TransportError(0)
        if (response.status !== 200) throw new TransportError(response.status)
        return { wire: validateWire(parseJSON(response.body), wire), address: host }
      } catch (error) {
        if (error instanceof TransportError && [403, 409, 429].includes(error.status)) throw error
        // Only literal RFC1918 IPv4 addresses from the out-of-band code are tried.
        // Do not expose native errors (which can contain implementation details).
      }
    }
    throw new TransportError(0)
  }
  async function finishPair(generation: number): Promise<void> {
    const pending = config.pending
    if (!pending) return
    if (pending.expiresAt <= Date.now()) { delete config.pending; save(); message = '配对码已过期，请在电脑上重新生成。'; return }
    try {
      const response = await http(pending.info.addresses, PAIR_PATH, pending.wire, generation)
      const payload = await open(pending.info.key, 'pair-response', response.wire)
      if (!live(generation) || config.pending !== pending) return
      if (!isObject(payload) || payload.device !== pending.info.hostId || !validKey(payload.key) || typeof payload.name !== 'string' || payload.name.length > 100) throw new TransportError(0)
      const peer: Peer = {
        id: pending.info.hostId, name: payload.name.replace(/[\x00-\x1f\x7f]/g, '') || '心海电脑', key: payload.key,
        addresses: [response.address, ...pending.info.addresses.filter(a => a !== response.address)], vector: {}, lastSync: null,
      }
      config.peers = [...config.peers.filter(p => p.id !== peer.id), peer]
      delete config.pending; save(); errors.delete(peer.id); message = ''
    } catch (error) {
      if (!live(generation) || config.pending !== pending) return
      if (error instanceof TransportError && error.status === 403) {
        delete config.pending; save(); message = '配对码已使用或过期，请在电脑上重新生成。'
      } else message = '暂时无法连接电脑，将自动重试配对。请确认两台设备位于同一局域网。'
    }
  }
  async function exchange(peer: Peer, generation: number): Promise<void> {
    try {
      const packet = engine.packet(peer.vector)
      const wire = await seal(peer.key, 'exchange-request', { hostId: peer.id, peerId: engine.deviceId, requestId: crypto.randomUUID() }, { packet })
      if (!live(generation) || !config.peers.includes(peer)) return
      const response = await http(peer.addresses, EXCHANGE_PATH, wire, generation)
      const payload = await open(peer.key, 'exchange-response', response.wire)
      if (!live(generation) || !config.peers.includes(peer)) return
      if (!isObject(payload)) throw new TransportError(0)
      const incoming: SyncPacket = authenticatedPacket(payload.packet, peer.id)
      if (!engine.hasBackup()) engine.backup()
      const changed = engine.merge(incoming)
      // Never acknowledge the server's vector until merge succeeds. The engine
      // captures local edits made while the HTTP request was in flight.
      peer.vector = copyVector(incoming.vector)
      peer.lastSync = Date.now()
      peer.addresses = [response.address, ...peer.addresses.filter(a => a !== response.address)]
      save(); errors.delete(peer.id)
      if (changed > 0) { try { notify() } catch { /* Keep acknowledged data even if rendering fails. */ } }
    } catch (error) {
      if (!live(generation) || !config.peers.includes(peer)) return
      errors.set(peer.id, error instanceof TransportError && error.status === 403
        ? '电脑已解除配对或密钥失效，请重新配对。'
        : '暂时无法同步，将自动重试。请确认电脑已开启同步且位于同一局域网。')
    }
  }
  async function run(): Promise<void> {
    const generation = epoch
    if (!live(generation)) return
    await finishPair(generation)
    for (const peer of [...config.peers]) {
      if (!live(generation)) break
      if (config.peers.includes(peer)) await exchange(peer, generation)
    }
  }
  function launch(work: () => Promise<void>): Promise<SyncStatus> {
    const operation = Promise.resolve().then(work).catch(() => {
      if (config.enabled && !stopped) message = '同步暂不可用，将自动重试。'
    }).then(() => { if (inFlight === operation) inFlight = undefined; return status() })
    inFlight = operation
    return operation
  }
  function now(): Promise<SyncStatus> {
    if (inFlight) return inFlight
    if (!config.enabled || stopped) return Promise.resolve(status())
    return launch(run)
  }
  function tick(): void { if (config.enabled && !stopped && document.visibilityState !== 'hidden') void now() }
  function startTimer(): void { if (!timer && config.enabled && !stopped) timer = setInterval(tick, 5000) }
  function clearTimer(): void { if (timer) clearInterval(timer); timer = undefined }
  async function enable(value: boolean): Promise<SyncStatus> {
    epoch++; stopped = false; config.enabled = Boolean(value); message = ''
    if (!value) { clearTimer(); delete config.pending }
    save()
    if (value) { startTimer(); if (inFlight) await inFlight; return now() }
    return status()
  }
  async function pair(code: string): Promise<SyncStatus> {
    const info = parsePairCode(code)
    if (info.hostId === engine.deviceId) throw Error('不能与本机配对。')
    if (config.peers.length >= 16 && !config.peers.some(p => p.id === info.hostId)) throw Error('配对设备过多，请先解除不再使用的设备。')
    const previous = inFlight
    stopped = false; config.enabled = true; message = ''; epoch++
    const generation = epoch
    // Repeated submission and restart use the same authenticated request id, so
    // losing the first response does not consume a code irrecoverably.
    return launch(async () => {
      if (previous) await previous
      if (!live(generation)) return
      if (!config.pending || config.pending.info.key !== info.key || config.pending.info.hostId !== info.hostId || config.pending.expiresAt <= Date.now()) {
        const wire = await seal(info.key, 'pair-request', { hostId: info.hostId, peerId: engine.deviceId, requestId: crypto.randomUUID() }, { device: engine.deviceId, name: deviceName })
        if (!live(generation)) return
        config.pending = { info, wire, expiresAt: Date.now() + PAIR_TTL }
      }
      save(); startTimer(); await run()
    })
  }
  async function unpair(id: string): Promise<SyncStatus> {
    if (!isId(id)) throw Error('同步设备标识无效。')
    epoch++
    config.peers = config.peers.filter(p => p.id !== id); errors.delete(id)
    if (config.pending?.info.hostId === id) { delete config.pending; message = '' }
    save(); return status()
  }
  function stop(): void {
    stopped = true; epoch++; clearTimer()
    window.removeEventListener('xinhai-resume', tick)
    document.removeEventListener('visibilitychange', tick)
  }
  window.addEventListener('xinhai-resume', tick)
  document.addEventListener('visibilitychange', tick)
  if (config.enabled) { startTimer(); void now() }
  return { status, enable, pair, now, unpair, stop }
}
