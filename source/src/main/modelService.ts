import { safeStorage } from 'electron'
import { requireModelAnalysis } from '../shared/modelScope'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { chatEndpoint } from '../shared/llmEndpoint'
import { validateModelRequest, validateModelSave, type ModelClient, type ModelReply, type ModelRequest, type ModelSaveInput, type ModelStatus } from '../shared/modelConfig'

const VAULT_FILE = 'model-config.enc'
const VAULT_FORMAT = 'xinhai-model-vault'
const MAX_REPLY_BYTES = 4 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 30_000

interface ModelConfig {
  endpoint: string
  model: string
  key: string
}

interface VaultEnvelope {
  format: typeof VAULT_FORMAT
  version: 1
  ciphertext: string
}

interface ModelHost {
  directory: string
  readLegacy: () => { endpoint: string; model: string; key: string }
  clearLegacy: () => void
  savePublic: (endpoint: string, model: string) => void
}

interface AsyncSafeStorage {
  isAsyncEncryptionAvailable?: () => Promise<boolean>
  encryptStringAsync?: (plainText: string) => Promise<Buffer>
  decryptStringAsync?: (encrypted: Buffer) => Promise<{ result: string; shouldReEncrypt: boolean }>
  isEncryptionAvailable: () => boolean
  encryptString: (plainText: string) => Buffer
  decryptString: (encrypted: Buffer) => string
  getSelectedStorageBackend?: () => string
}

const storage = safeStorage as unknown as AsyncSafeStorage

class SafeModelError extends Error {
  constructor(message: string) { super(message); this.name = 'ModelServiceError' }
}

function safeFailure(message: string): SafeModelError {
  return new SafeModelError(message)
}

function safeLoadFailure(): SafeModelError {
  return safeFailure('模型配置无法读取，请重试或明确移除旧密钥。')
}

function exactObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw safeFailure('模型加密配置损坏。')
  const result = value as Record<string, unknown>
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) throw safeFailure('模型加密配置损坏。')
  return result
}

function validateConfig(value: unknown): ModelConfig {
  const row = exactObject(value, ['endpoint', 'model', 'key'])
  const parsed = validateModelSave(row)
  if (typeof parsed.key !== 'string' || !parsed.key) throw safeFailure('模型加密配置损坏。')
  return { endpoint: parsed.endpoint, model: parsed.model, key: parsed.key }
}

function validateEnvelope(value: unknown): VaultEnvelope {
  const row = exactObject(value, ['format', 'version', 'ciphertext'])
  if (row.format !== VAULT_FORMAT || row.version !== 1 || typeof row.ciphertext !== 'string' || !row.ciphertext || !/^[A-Za-z0-9+/]+={0,2}$/.test(row.ciphertext)) throw safeFailure('模型加密配置损坏。')
  const bytes = Buffer.from(row.ciphertext, 'base64')
  if (!bytes.length) throw safeFailure('模型加密配置损坏。')
  return row as unknown as VaultEnvelope
}

async function encryptionAvailable(): Promise<boolean> {
  try {
    if (storage.isAsyncEncryptionAvailable) {
      if (!await storage.isAsyncEncryptionAvailable()) return false
    } else if (!storage.isEncryptionAvailable()) return false
    if (process.platform === 'linux' && storage.getSelectedStorageBackend?.() === 'basic_text') return false
    return true
  } catch {
    return false
  }
}

async function encrypt(plainText: string): Promise<Buffer> {
  if (!await encryptionAvailable()) throw safeFailure('系统加密存储不可用，未保存模型密钥。')
  try {
    return storage.encryptStringAsync ? await storage.encryptStringAsync(plainText) : storage.encryptString(plainText)
  } catch {
    throw safeFailure('系统加密存储失败，未保存模型密钥。')
  }
}

async function decrypt(encrypted: Buffer): Promise<string> {
  if (!await encryptionAvailable()) throw safeFailure('系统加密存储不可用，无法读取模型配置。')
  try {
    if (storage.decryptStringAsync) {
      try { return (await storage.decryptStringAsync(encrypted)).result } catch { return storage.decryptString(encrypted) }
    }
    return storage.decryptString(encrypted)
  } catch {
    throw safeFailure('模型加密配置无法解密，请清除后重新保存。')
  }
}

async function ordinaryDirectory(directory: string): Promise<string> {
  try {
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw safeFailure('模型配置目录不是私有普通目录。')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(directory, { recursive: true })
  }
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw safeFailure('模型配置目录不是私有普通目录。')
  return realpath(directory)
}

function vaultPath(directory: string): string {
  return join(directory, VAULT_FILE)
}

async function readVault(directory: string): Promise<ModelConfig | null> {
  const file = vaultPath(directory)
  let bytes: Buffer
  try {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size>128*1024) throw safeFailure('模型加密配置损坏。')
    bytes = await readFile(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    if (error instanceof SafeModelError) throw error
    throw safeFailure('模型加密配置无法读取。')
  }
  let envelope: VaultEnvelope
  try {
    envelope = validateEnvelope(JSON.parse(bytes.toString('utf8')))
  } catch (error) {
    if (error instanceof Error && error.message === '模型加密配置损坏。') throw error
    throw safeFailure('模型加密配置损坏。')
  }
  const plain = await decrypt(Buffer.from(envelope.ciphertext, 'base64'))
  try {
    return validateConfig(JSON.parse(plain))
  } catch (error) {
    if (error instanceof Error && error.message === '模型加密配置损坏。') throw error
    throw safeFailure('模型加密配置损坏。')
  }
}

async function writeVault(directory: string, config: ModelConfig): Promise<void> {
  const ciphertext = await encrypt(JSON.stringify(config))
  const envelope: VaultEnvelope = { format: VAULT_FORMAT, version: 1, ciphertext: ciphertext.toString('base64') }
  const temporary = join(directory, `.${VAULT_FILE}.${randomUUID()}.tmp`)
  try {
    const handle=await open(temporary,'wx',0o600)
    try{await handle.writeFile(JSON.stringify(envelope),'utf8');await handle.sync()}finally{await handle.close()}
    const check = await readVaultFromFile(temporary)
    if (!check || check.endpoint !== config.endpoint || check.model !== config.model || check.key !== config.key) throw safeFailure('模型加密配置校验失败，未覆盖原配置。')
    await rename(temporary, vaultPath(directory))
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

async function readVaultFromFile(file: string): Promise<ModelConfig | null> {
  let bytes: Buffer
  try { bytes = await readFile(file) } catch { throw safeFailure('模型加密配置校验失败，未覆盖原配置。') }
  try {
    const envelope = validateEnvelope(JSON.parse(bytes.toString('utf8')))
    return validateConfig(JSON.parse(await decrypt(Buffer.from(envelope.ciphertext, 'base64'))))
  } catch {
    throw safeFailure('模型加密配置校验失败，未覆盖原配置。')
  }
}

function statusFor(config: ModelConfig | null, available: boolean, message: string): ModelStatus {
  return { endpoint: config?.endpoint ?? '', model: config?.model ?? 'deepseek-chat', configured: Boolean(config), available, message }
}

export function createModelService(host: ModelHost): ModelClient {
  const queue: { current: Promise<unknown> } = { current: Promise.resolve() }
  let loaded = false
  let config: ModelConfig | null = null
  let loadError: Error | null = null
  let publicSyncError = false
  let legacyCleanupError = false
  let directory = ''

  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(work, work)
    queue.current = next.then(() => undefined, () => undefined)
    return next
  }

  const load = async (): Promise<void> => {
    if (loaded && !loadError) return
    loaded = true
    try {
      loadError = null
      directory = await ordinaryDirectory(host.directory)
      const existing = await readVault(directory)
      if (existing) {
        config = existing
        try { host.clearLegacy(); legacyCleanupError = false } catch { legacyCleanupError = true }
        return
      }
      const legacy = host.readLegacy()
      const endpoint = chatEndpoint(legacy.endpoint || '')
      const model = legacy.model.trim() || 'deepseek-chat'
      if (legacy.key.trim()) {
        const migrated = validateConfig({ endpoint, model, key: legacy.key.trim() })
        await writeVault(directory, migrated)
        config = migrated
        let publicSaved = true
        try { host.savePublic(endpoint, model); publicSyncError = false } catch { publicSaved = false; publicSyncError = true; legacyCleanupError = true }
        if (publicSaved) {
          try { host.clearLegacy(); legacyCleanupError = false } catch { legacyCleanupError = true }
        }
      } else {
        config = null
        try { host.savePublic(endpoint, model) } catch { publicSyncError = true }
        if(legacy.key)try{host.clearLegacy()}catch{legacyCleanupError=true}
      }
    } catch (error) {
      loadError = error instanceof SafeModelError ? error : safeLoadFailure()
    }
  }

  const getStatus = async (): Promise<ModelStatus> => {
    await load()
    if (loadError) return statusFor(null, false, loadError.message)
    const available = await encryptionAvailable()
    if (!available) return statusFor(config, false, '系统加密存储不可用。')
    if (config && publicSyncError) {
      try { host.savePublic(config.endpoint, config.model); publicSyncError = false } catch { publicSyncError = true }
    }
    if (legacyCleanupError) {
      try { host.clearLegacy(); legacyCleanupError = false } catch { legacyCleanupError = true }
    }
    if (publicSyncError) return statusFor(config, true, '加密模型配置已保存，但公开设置同步失败，请重试。')
    if (legacyCleanupError) return statusFor(config, true, '加密模型配置已保存，但旧配置清理失败，请重试。')
    return statusFor(config, true, config ? '已配置模型 API。' : '尚未配置模型 API Key。')
  }

  const save = async (input: ModelSaveInput): Promise<ModelStatus> => serial(async () => {
    requireModelAnalysis()
    await load()
    if (loadError) throw loadError
    const next = validateModelSave(input)
    const previous = config
    let candidate: ModelConfig
    if (next.key === undefined) {
      if (!previous) throw safeFailure('尚未配置模型 API Key，请输入新的 API Key。')
      if (next.endpoint !== previous.endpoint) throw safeFailure('更换 API 地址必须重新输入 API Key。')
      candidate = { endpoint: next.endpoint, model: next.model, key: previous.key }
    } else if (next.key === null) {
      if (previous) {
        try { host.clearLegacy(); host.savePublic(next.endpoint, next.model) } catch { throw safeFailure('公开设置清理失败，模型密钥仍被保留。') }
        await rm(vaultPath(directory), { force: true })
      } else {
        try { host.clearLegacy(); host.savePublic(next.endpoint, next.model) } catch { throw safeFailure('公开设置清理失败。') }
      }
      config = null; publicSyncError = false; legacyCleanupError = false
      return getStatus()
    } else {
      candidate = { endpoint: next.endpoint, model: next.model, key: next.key }
    }
    try { await writeVault(directory, candidate) } catch (error) {
      if (error instanceof SafeModelError) throw error
      throw safeFailure('模型加密配置保存失败，原配置未改变。')
    }
    try {
      host.savePublic(candidate.endpoint, candidate.model)
      publicSyncError = false
    } catch {
      config = candidate
      publicSyncError = true
      legacyCleanupError = true
      throw safeFailure('模型配置已加密保存，但公开设置同步失败，请重试。')
    }
    config = candidate
    try { host.clearLegacy(); legacyCleanupError = false } catch { legacyCleanupError = true; throw safeFailure('模型配置已加密保存，但旧配置清理失败，请重试。') }
    return getStatus()
  })

  const clear = async (): Promise<ModelStatus> => serial(async () => {
    await load()
    if (loadError && !directory) throw loadError
    try { host.clearLegacy(); host.savePublic('', config?.model || 'deepseek-chat') } catch { throw safeFailure('公开设置清理失败，模型密钥仍被保留。') }
    try { await rm(vaultPath(directory), { force: true }) } catch { throw safeFailure('模型密钥文件删除失败，模型密钥仍被保留。') }
    config = null; loadError = null; publicSyncError = false; legacyCleanupError = false
    return getStatus()
  })

  const request = async (input: ModelRequest): Promise<ModelReply> => serial(async () => {
    requireModelAnalysis()
    const valid = validateModelRequest(input)
    await load()
    if (loadError) throw loadError
    if (!config) throw safeFailure('尚未配置模型 API Key。')
    const endpoint = chatEndpoint(config.endpoint)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, messages: valid.messages, max_tokens: valid.maxTokens, ...(valid.json ? { response_format: { type: 'json_object' } } : {}) })
      })
      if (!response.body) {
        const body = await response.text()
        if (new TextEncoder().encode(body).length > MAX_REPLY_BYTES) throw safeFailure('模型响应超过 4 MiB 限制。')
        return { status: response.status, body: response.ok ? body : '' }
      }
      const chunks: Buffer[] = []; let total = 0
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        const bytes = Buffer.from(chunk)
        total += bytes.length
        if (total > MAX_REPLY_BYTES) throw safeFailure('模型响应超过 4 MiB 限制。')
        chunks.push(bytes)
      }
      const body = Buffer.concat(chunks).toString('utf8')
      return { status: response.status, body: response.ok ? body : '' }
    } catch (error) {
      if (error instanceof Error && error.message.includes('超过 4 MiB')) throw error
      if (error instanceof Error && error.name === 'AbortError') throw safeFailure('模型请求超时。')
      throw safeFailure('模型请求失败。')
    } finally {
      clearTimeout(timeout)
    }
  })

  return { status: () => serial(getStatus), save, clear, request }
}
