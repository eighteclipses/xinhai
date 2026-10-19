import type Database from 'better-sqlite3'
import { parseFocusRecovery, type FocusRecoveryLoad, type FocusRecoveryRecord } from '../shared/focusRecovery'

let connection: Database.Database | undefined

/** Initialize the single-row recovery store on the same SQLite connection as the app data. */
export function initFocusRecovery(db: Database.Database): void {
  connection = db
  db.exec(`CREATE TABLE IF NOT EXISTS focus_recovery (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    token TEXT NOT NULL,
    body TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
}

function db(): Database.Database {
  if (!connection) throw Error('专注恢复存储尚未初始化')
  return connection
}

export function loadFocusRecovery(): FocusRecoveryLoad {
  const row = db().prepare('SELECT token,body FROM focus_recovery WHERE id=1').get() as { token:string; body: string } | undefined
  if (!row) return { record: null, clearedCorrupt: false }
  let record:FocusRecoveryRecord|null=null
  try {
    record = parseFocusRecovery(JSON.parse(row.body))
  } catch {
    // Only parsing failures are corruption. A database failure must preserve the row.
  }
    if (record && record.token===row.token) {
      // A delayed renderer checkpoint must not resurrect a session whose
      // idempotent commit receipt already exists. Break records use a fresh
      // token and remain recoverable.
      if (record.runState!=='waiting'&&(record.mode === 'focus' || record.runState === 'saving')) {
        const committed = db().prepare('SELECT 1 FROM focus_commits WHERE token=? LIMIT 1').get(record.token)
        if (committed) {
          db().prepare('DELETE FROM focus_recovery WHERE id=1 AND token=?').run(record.token)
          return { record: null, clearedCorrupt: false }
        }
      }
      return { record, clearedCorrupt: false }
    }
  db().prepare('DELETE FROM focus_recovery WHERE id=1').run()
  return { record: null, clearedCorrupt: true }
}

export function saveFocusRecovery(record: FocusRecoveryRecord): void {
  const parsed = parseFocusRecovery(record)
  if (!parsed) throw Error('专注恢复状态无效')
  if (parsed.runState!=='waiting'&&(parsed.mode === 'focus' || parsed.runState === 'saving')) {
    const committed = db().prepare('SELECT 1 FROM focus_commits WHERE token=? LIMIT 1').get(parsed.token)
    if (committed) {
      db().prepare('DELETE FROM focus_recovery WHERE id=1 AND token=?').run(parsed.token)
      return
    }
  }
  db().prepare('INSERT OR REPLACE INTO focus_recovery(id,token,body,updated_at) VALUES (1,?,?,?)').run(parsed.token, JSON.stringify(parsed), Date.now())
}

/** Clear only the expected token, so a stale commit cannot erase a newer session. */
export function clearFocusRecovery(token?: string): void {
  if (token) db().prepare('DELETE FROM focus_recovery WHERE id=1 AND token=?').run(token)
  else db().prepare('DELETE FROM focus_recovery WHERE id=1').run()
}
