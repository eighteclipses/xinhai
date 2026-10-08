import { isBackupClientKey } from '../shared/backupDatabase'

export interface DurableClientStorageBackend {
  initialize(state: Record<string, string>): Record<string, string>
  set(key: string, value: string): void
  remove(key: string): void
  clear(): void
}

interface StorageMethods {
  setItem: (this: Storage, key: string, value: string) => void
  removeItem: (this: Storage, key: string) => void
  clear: (this: Storage) => void
  getItem: (this: Storage, key: string) => string | null
  key: (this: Storage, index: number) => string | null
}

const originalsByPrototype = new WeakMap<object, StorageMethods>()
const backendsByStorage = new WeakMap<Storage, DurableClientStorageBackend>()
const installed = new WeakSet<Storage>()
const MAX_KEY_CHARS = 6_000
const MAX_VALUE_CHARS = 8 * 1024 * 1024
const MAX_TOTAL_CHARS = 10 * 1024 * 1024

/**
 * Installs a narrow synchronous durable mirror for one localStorage object.
 * The native state wins after the first browser-to-native migration.
 */
export function installDurableClientStorage(storage: Storage, backend: DurableClientStorageBackend): void {
  if (installed.has(storage)) return

  const prototype = Object.getPrototypeOf(storage) as object | null
  if (!prototype) throw Error('无法读取浏览器存储原型')
  const methods = originalsByPrototype.get(prototype) ?? readMethods(prototype)
  const browserState = captureAllowed(storage, methods)
  const authoritative = validateState(backend.initialize(browserState))

  // Do not let our own writes enter the native bridge during initial hydration.
  replaceAllowed(storage, methods, authoritative)

  if (!originalsByPrototype.has(prototype)) installWrappers(prototype, methods)
  backendsByStorage.set(storage, backend)
  installed.add(storage)
  originalsByPrototype.set(prototype, methods)
}

function readMethods(prototype: object): StorageMethods {
  const candidate = prototype as StorageMethods
  for (const name of ['setItem', 'removeItem', 'clear', 'getItem', 'key'] as const) {
    if (typeof candidate[name] !== 'function') throw Error('浏览器存储接口不完整：' + name)
  }
  return {
    setItem: candidate.setItem,
    removeItem: candidate.removeItem,
    clear: candidate.clear,
    getItem: candidate.getItem,
    key: candidate.key
  }
}

function installWrappers(prototype: object, methods: StorageMethods): void {
  const setDescriptor = Object.getOwnPropertyDescriptor(prototype, 'setItem')
  const removeDescriptor = Object.getOwnPropertyDescriptor(prototype, 'removeItem')
  const clearDescriptor = Object.getOwnPropertyDescriptor(prototype, 'clear')
  if (!setDescriptor || !removeDescriptor || !clearDescriptor || !('value' in setDescriptor) || !('value' in removeDescriptor) || !('value' in clearDescriptor)) {
    throw Error('浏览器存储方法无法安全替换')
  }

  try {
    Object.defineProperty(prototype, 'setItem', {
      ...setDescriptor,
      value: function (this: Storage, key: string, value: string) {
        if (arguments.length < 2) throw new TypeError('Storage.setItem requires a key and value')
        const backend = backendsByStorage.get(this)
        if (!backend) return methods.setItem.call(this, key, value)
        const normalizedKey = toStorageString(key)
        if (!isBackupClientKey(normalizedKey)) return methods.setItem.call(this, normalizedKey, value)

        const previous = methods.getItem.call(this, normalizedKey)
        methods.setItem.call(this, normalizedKey, value)
        const next = methods.getItem.call(this, normalizedKey)
        if (next === null) {
          restoreOne(this, methods, normalizedKey, previous)
          throw Error('浏览器没有保存客户端状态')
        }
        try {
          backend.set(normalizedKey, next)
        } catch (error) {
          restoreOne(this, methods, normalizedKey, previous)
          throw error
        }
      }
    })
    Object.defineProperty(prototype, 'removeItem', {
      ...removeDescriptor,
      value: function (this: Storage, key: string) {
        if (arguments.length < 1) throw new TypeError('Storage.removeItem requires a key')
        const backend = backendsByStorage.get(this)
        if (!backend) return methods.removeItem.call(this, key)
        const normalizedKey = toStorageString(key)
        if (!isBackupClientKey(normalizedKey)) return methods.removeItem.call(this, normalizedKey)

        const previous = methods.getItem.call(this, normalizedKey)
        methods.removeItem.call(this, normalizedKey)
        try {
          backend.remove(normalizedKey)
        } catch (error) {
          restoreOne(this, methods, normalizedKey, previous)
          throw error
        }
      }
    })
    Object.defineProperty(prototype, 'clear', {
      ...clearDescriptor,
      value: function (this: Storage) {
        const backend = backendsByStorage.get(this)
        if (!backend) return methods.clear.call(this)

        const previous = captureAll(this, methods)
        try {
          methods.clear.call(this)
        } catch (error) {
          restoreAll(this, methods, previous, error)
        }
        try {
          backend.clear()
        } catch (error) {
          restoreAll(this, methods, previous, error)
        }
      }
    })
  } catch (error) {
    // If a host refuses to replace one method, put earlier descriptors back.
    try { Object.defineProperty(prototype, 'setItem', setDescriptor) } catch { /* keep original failure */ }
    try { Object.defineProperty(prototype, 'removeItem', removeDescriptor) } catch { /* keep original failure */ }
    try { Object.defineProperty(prototype, 'clear', clearDescriptor) } catch { /* keep original failure */ }
    throw error
  }
}

function toStorageString(value: unknown): string {
  // Template interpolation follows Web IDL DOMString conversion, including Symbol rejection.
  return `${value}`
}

function captureAllowed(storage: Storage, methods: StorageMethods): Record<string, string> {
  const state: Record<string, string> = Object.create(null)
  for (let index = 0; index < storage.length; index++) {
    const key = methods.key.call(storage, index)
    if (!key || !isBackupClientKey(key)) continue
    const value = methods.getItem.call(storage, key) as string | null
    if (value !== null) state[key] = value
  }
  return state
}

function captureAll(storage: Storage, methods: StorageMethods): Record<string, string> {
  const state: Record<string, string> = Object.create(null)
  for (let index = 0; index < storage.length; index++) {
    const key = methods.key.call(storage, index)
    if (key === null) continue
    const value = methods.getItem.call(storage, key) as string | null
    if (value !== null) state[key] = value
  }
  return state
}

function validateState(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('本机客户端状态格式无效')
  if (Object.getOwnPropertySymbols(value).length) throw Error('本机客户端状态字段无效')
  let total = 0
  const result: Record<string, string> = Object.create(null)
  for (const key of Object.keys(value)) {
    const item = (value as Record<string, unknown>)[key]
    if (!isBackupClientKey(key) || key.length > MAX_KEY_CHARS || typeof item !== 'string' || item.length > MAX_VALUE_CHARS) {
      throw Error('本机客户端状态字段无效')
    }
    total += key.length + item.length
    if (total > MAX_TOTAL_CHARS) throw Error('本机客户端状态超过 10 Mi 字符限制')
    result[key] = item
  }
  return result
}

function replaceAllowed(storage: Storage, methods: StorageMethods, next: Record<string, string>): void {
  const previous = captureAllowed(storage, methods)
  try {
    removeAllowed(storage, methods)
    for (const [key, value] of Object.entries(next)) methods.setItem.call(storage, key, value)
  } catch (error) {
    try {
      removeAllowed(storage, methods)
      for (const [key, value] of Object.entries(previous)) methods.setItem.call(storage, key, value)
    } catch (rollbackError) {
      throw Error('恢复浏览器客户端状态失败：' + String(error) + '；' + String(rollbackError))
    }
    throw error
  }
}

function removeAllowed(storage: Storage, methods: StorageMethods): void {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = methods.key.call(storage, index)
    if (key && isBackupClientKey(key)) keys.push(key)
  }
  for (const key of keys) methods.removeItem.call(storage, key)
}

function restoreOne(storage: Storage, methods: StorageMethods, key: string, value: string | null): void {
  try {
    if (value === null) methods.removeItem.call(storage, key)
    else methods.setItem.call(storage, key, value)
  } catch (rollbackError) {
    throw Error('本机客户端状态提交失败，且浏览器副本回滚失败：' + String(rollbackError))
  }
}

function restoreAll(storage: Storage, methods: StorageMethods, snapshot: Record<string, string>, cause: unknown): never {
  try {
    methods.clear.call(storage)
    for (const [key, value] of Object.entries(snapshot)) methods.setItem.call(storage, key, value)
  } catch (rollbackError) {
    throw Error('清空客户端状态失败，且浏览器副本回滚失败：' + String(cause) + '；' + String(rollbackError))
  }
  throw cause
}
