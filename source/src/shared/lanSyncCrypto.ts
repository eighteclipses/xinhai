import type { SyncConflict, SyncPacket, SyncVector } from './lanSyncTypes'

export const SYNC_PORT = 7392
export const SYNC_LIMIT = 8 * 1024 * 1024
export const PAIR_PATH = '/xinhai-sync/v1/pair'
export const EXCHANGE_PATH = '/xinhai-sync/v1/exchange'
export const PAIR_TTL = 5 * 60 * 1000
export interface LanSyncEngine {
  deviceId: string
  capture(): void
  packet(known?: Record<string, number>): SyncPacket
  merge(packet: unknown): number
  getMeta<T>(key: string, fallback: T): T
  setMeta(key: string, value: unknown): void
  backup(): void
  hasBackup(): boolean
  conflicts(): SyncConflict[]
  resolve(id: string, useOther: boolean): void
  exportBackup(): string
}
export interface PairInfo { hostId: string; addresses: string[]; port: number; key: string; name: string }
export interface SyncEnvelope { iv: string; body: string }
export interface SyncWire extends SyncEnvelope { hostId: string; peerId: string; requestId: string }
export type SyncRole = 'pair-request' | 'pair-response' | 'exchange-request' | 'exchange-response'
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
export function isPrivateIPv4(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) return false
  const p = value.split('.').map(Number)
  return p.every(n => n <= 255) && (p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168))
}
export function base64url(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function unbase64url(value: unknown, limit = SYNC_LIMIT): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > Math.ceil(limit * 4 / 3) || value.length % 4 === 1 || !/^[A-Za-z0-9_-]*$/.test(value)) throw Error('同步数据无效。')
  const text = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4))
  const bytes = Uint8Array.from(text, c => c.charCodeAt(0))
  if (bytes.length > limit || base64url(bytes) !== value) throw Error('同步数据无效。')
  return bytes
}
export function randomKey(provider: Crypto = globalThis.crypto): string {
  return base64url(provider.getRandomValues(new Uint8Array(32)))
}
export function validKey(value: unknown): value is string {
  try { return unbase64url(value, 32).length === 32 } catch { return false }
}
export function boundedJSON(value: unknown): string {
  const result = JSON.stringify(value)
  if (!result || encoder.encode(result).length > SYNC_LIMIT) throw Error('同步数据超过 8 MiB 限制。')
  return result
}
export function parseJSON(text: string): unknown {
  if (typeof text !== 'string' || text.length > SYNC_LIMIT || encoder.encode(text).length > SYNC_LIMIT) throw Error('同步数据超过 8 MiB 限制。')
  return JSON.parse(text)
}
export function parsePairCode(code: string): PairInfo {
  try {
    if (typeof code !== 'string' || code.length > 4096 || !code.trim().startsWith('XH1.')) throw Error()
    const p: unknown = JSON.parse(decoder.decode(unbase64url(code.trim().slice(4), 3072)))
    if (!isObject(p) || !isId(p.hostId) || !validKey(p.key) || p.port !== SYNC_PORT || typeof p.name !== 'string' || p.name.length > 100 || !Array.isArray(p.addresses) || !p.addresses.length || p.addresses.length > 16 || !p.addresses.every(isPrivateIPv4)) throw Error()
    return { hostId: p.hostId, key: p.key, port: SYNC_PORT, name: p.name, addresses: [...new Set(p.addresses as string[])] }
  } catch { throw Error('配对码无效，请粘贴电脑上生成的完整配对码。') }
}
export function makePairCode(info: PairInfo): string { return 'XH1.' + base64url(encoder.encode(JSON.stringify(info))) }
export function validateWire(value: unknown, expected?: { hostId: string; peerId: string; requestId: string }): SyncWire {
  if (!isObject(value) || !isId(value.hostId) || !isId(value.peerId) || !isId(value.requestId) || typeof value.iv !== 'string' || value.iv.length !== 16 || typeof value.body !== 'string' || value.body.length < 22 || value.body.length > SYNC_LIMIT) throw Error('同步认证失败。')
  if (expected && (value.hostId !== expected.hostId || value.peerId !== expected.peerId || value.requestId !== expected.requestId)) throw Error('同步认证失败。')
  return value as unknown as SyncWire
}
function aad(role: SyncRole, ids: { hostId: string; peerId: string; requestId: string }): Uint8Array<ArrayBuffer> {
  if (!isId(ids.hostId) || !isId(ids.peerId) || !isId(ids.requestId)) throw Error('同步设备标识无效。')
  return encoder.encode(JSON.stringify(['XH1', role, ids.hostId, ids.peerId, ids.requestId]))
}
export async function seal(key: string, role: SyncRole, ids: { hostId: string; peerId: string; requestId: string }, payload: unknown, provider: Crypto = globalThis.crypto): Promise<SyncWire> {
  const raw = unbase64url(key, 32)
  if (raw.length !== 32) throw Error('同步认证失败。')
  const iv = provider.getRandomValues(new Uint8Array(12))
  const imported = await provider.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt'])
  const encrypted = await provider.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(role, ids), tagLength: 128 }, imported, encoder.encode(boundedJSON(payload)))
  const wire = { hostId: ids.hostId, peerId: ids.peerId, requestId: ids.requestId, iv: base64url(iv), body: base64url(new Uint8Array(encrypted)) }
  boundedJSON(wire)
  return wire
}
export async function open(key: string, role: SyncRole, wire: SyncWire, provider: Crypto = globalThis.crypto): Promise<unknown> {
  try {
    validateWire(wire)
    const raw = unbase64url(key, 32), iv = unbase64url(wire.iv, 12), body = unbase64url(wire.body)
    if (raw.length !== 32 || iv.length !== 12 || body.length < 16) throw Error()
    const imported = await provider.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt'])
    const clear = await provider.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(role, wire), tagLength: 128 }, imported, body)
    return parseJSON(decoder.decode(clear))
  } catch { throw Error('同步认证失败。') }
}
// Full record/schema validation belongs to the merge engine. Transport binds the sender
// and checks the vector before it can influence which records the engine returns.
export function authenticatedPacket(value: unknown, deviceId: string): SyncPacket {
  if (!isObject(value) || (value.version !== 1 && value.version !== 2) || value.device !== deviceId || !Array.isArray(value.records) || !isObject(value.vector) || Object.keys(value.vector).length > 4096) throw Error('同步数据无效。')
  for (const [id, count] of Object.entries(value.vector)) if (!isId(id) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw Error('同步数据无效。')
  return value as unknown as SyncPacket
}
export function copyVector(vector: SyncVector): SyncVector { return { ...vector } }
