import Database from 'better-sqlite3'
import { join } from 'node:path'
import { createDurableClientStateStore } from './durableClientState'

/** Personal drafts/preferences use a sidecar; the existing learning DB is untouched. */
export function createPersonalClientStateStore(directory:string) {
  const database=new Database(join(directory,'personal-client-state.db'))
  try {
    database.pragma('journal_mode = WAL')
    database.pragma('synchronous = FULL')
    const store=createDurableClientStateStore(database)
    return {...store,close:()=>database.close()}
  } catch(error) { database.close();throw error }
}
