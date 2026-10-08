import type Database from 'better-sqlite3'
import { isBackupClientKey } from '../shared/backupDatabase'
import type { ClientStateSyncRequest } from '../shared/clientState'

const TABLE = 'durable_client_state'
const META_TABLE = 'durable_client_state_meta'
const MARKER_KEY = 'initialized'
const MARKER_VALUE = '1'
const MAX_KEY_CHARS = 6_000
const MAX_VALUE_CHARS = 8 * 1024 * 1024
const MAX_TOTAL_CHARS = 10 * 1024 * 1024

type State = Record<string, string>
type StateRow = { key: string; value: string; chars: number }

/** Synchronous store for only the client-state keys already included in full backups. */
export function createDurableClientStateStore(db: Database.Database) {
  if (db.inTransaction) throw Error('客户端状态存储不能在数据库事务中初始化')

  db.exec(`
    CREATE TABLE IF NOT EXISTS "${TABLE}" (
      "key" TEXT PRIMARY KEY NOT NULL,
      "value" TEXT NOT NULL,
      "chars" INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "${META_TABLE}" (
      "key" TEXT PRIMARY KEY NOT NULL,
      "value" TEXT NOT NULL
    );
  `)

  const readMarker = db.prepare(`SELECT "value" FROM "${META_TABLE}" WHERE "key"=?`)
  const insertValue = db.prepare(`INSERT INTO "${TABLE}" ("key","value","chars") VALUES (?,?,?)`)
  const readChars = db.prepare(`SELECT "chars" AS chars FROM "${TABLE}" WHERE "key"=?`)
  const sameValue = db.prepare(`SELECT 1 AS present FROM "${TABLE}" WHERE "key"=? AND "value"=? LIMIT 1`)
  const totalSize = db.prepare(`SELECT COALESCE(SUM("chars"),0) AS chars FROM "${TABLE}"`)
  const readAllRows = db.prepare(`SELECT "key" AS key,"value" AS value,"chars" AS chars FROM "${TABLE}" ORDER BY "key"`)
  const insertMarker = db.prepare(`INSERT INTO "${META_TABLE}" ("key","value") VALUES (?,?)`)
  const clearValues = db.prepare(`DELETE FROM "${TABLE}"`)
  const updateValue = db.prepare(`UPDATE "${TABLE}" SET "value"=?,"chars"=? WHERE "key"=?`)
  const removeValue = db.prepare(`DELETE FROM "${TABLE}" WHERE "key"=?`)

  function assertOutsideTransaction(): void {
    if (db.inTransaction) throw Error('客户端状态不能加入正在进行的数据库事务')
  }

  function validateKey(key: unknown): string {
    if (typeof key !== 'string' || !isBackupClientKey(key) || key.length > MAX_KEY_CHARS) {
      throw Error('客户端状态键不受支持')
    }
    return key
  }

  function validateValue(value: unknown): string {
    if (typeof value !== 'string') throw Error('客户端状态值必须是字符串')
    if (value.length > MAX_VALUE_CHARS) throw Error('单项客户端状态超过 8 Mi 字符限制')
    return value
  }

  function validateEntry(key: unknown, value: unknown): {key:string;value:string} {
    return {key:validateKey(key),value:validateValue(value)}
  }

  function validateState(input: unknown): State {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('客户端状态初始化数据无效')
    if (Object.getOwnPropertySymbols(input).length) throw Error('客户端状态字段无效')
    const state: State = Object.create(null)
    let total = 0
    for (const key of Object.keys(input)) {
      const value = (input as Record<string, unknown>)[key]
      const entry=validateEntry(key, value)
      total += entry.key.length + entry.value.length
      if (total > MAX_TOTAL_CHARS) throw Error('客户端存储超过 10 Mi 字符限制')
      state[entry.key] = entry.value
    }
    return state
  }

  function getState(): State {
    const state: State = Object.create(null)
    let total = 0
    for (const row of readAllRows.all() as StateRow[]) {
      validateEntry(row.key, row.value)
      const chars = row.key.length + row.value.length
      if (chars !== row.chars) throw Error('客户端状态字符计数损坏')
      total += chars
      if (total > MAX_TOTAL_CHARS) throw Error('客户端存储超过 10 Mi 字符限制')
      state[row.key] = row.value
    }
    return state
  }

  function requireInitialized(): void {
    const marker = readMarker.get(MARKER_KEY) as { value: string } | undefined
    if (marker?.value !== MARKER_VALUE) throw Error('客户端状态存储尚未完成初始化')
  }

  function initialize(browserState: unknown): State {
    assertOutsideTransaction()
    return db.transaction(() => {
      const marker = readMarker.get(MARKER_KEY) as { value: string } | undefined
      if (marker?.value === MARKER_VALUE) return getState()
      if (marker) throw Error('客户端状态初始化标记损坏')

      // Validate only when no marker exists. Once initialized, native state wins;
      // stale browser contents must not be able to block or overwrite it.
      const state = validateState(browserState)
      clearValues.run()
      for (const [key, value] of Object.entries(state)) insertValue.run(key, value, key.length + value.length)
      insertMarker.run(MARKER_KEY, MARKER_VALUE)
      return getState()
    }).immediate()
  }

  function set(key: unknown, value: unknown): void {
    assertOutsideTransaction()
    const entry=validateEntry(key, value)
    db.transaction(() => {
      requireInitialized()
      const previous = readChars.get(entry.key) as { chars: number } | undefined
      const same = sameValue.get(entry.key, entry.value)
      if (same) {
        if (!previous || previous.chars !== entry.key.length + entry.value.length) throw Error('客户端状态字符计数损坏')
        return
      }
      const currentChars = Number((totalSize.get() as { chars: number }).chars)
      const nextChars = currentChars - (previous?.chars ?? 0) + entry.key.length + entry.value.length
      if (!Number.isSafeInteger(nextChars) || nextChars > MAX_TOTAL_CHARS) throw Error('客户端存储超过 10 Mi 字符限制')
      if (previous) {
        const result = updateValue.run(entry.value, entry.key.length + entry.value.length, entry.key)
        if (result.changes !== 1) throw Error('更新客户端状态失败')
      } else insertValue.run(entry.key, entry.value, entry.key.length + entry.value.length)
    }).immediate()
  }

  function remove(key: unknown): void {
    assertOutsideTransaction()
    validateKey(key)
    db.transaction(() => {
      requireInitialized()
      removeValue.run(key)
    }).immediate()
  }

  function clear(): void {
    assertOutsideTransaction()
    db.transaction(() => {
      requireInitialized()
      // Keep the initialization marker so stale browser data cannot be re-imported.
      clearValues.run()
    }).immediate()
  }

  function handle(request: unknown): State | null {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw Error('客户端状态请求无效')
    const value = request as Record<string, unknown>
    if (typeof value.op !== 'string') throw Error('客户端状态请求无效')
    switch (value.op) {
      case 'initialize':
        assertKeys(value, ['op', 'state'])
        return initialize(value.state)
      case 'set':
        assertKeys(value, ['op', 'key', 'value'])
        set(value.key, value.value)
        return null
      case 'remove':
        assertKeys(value, ['op', 'key'])
        remove(value.key)
        return null
      case 'clear':
        assertKeys(value, ['op'])
        clear()
        return null
      default:
        throw Error('客户端状态操作不受支持')
    }
  }

  return { initialize, set, remove, clear, handle }
}

function assertKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value)
  if (actual.length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) {
    throw Error('客户端状态请求字段无效')
  }
}
