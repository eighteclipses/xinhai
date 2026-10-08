import { isBackupClientKey, validateBackupClientState } from '../../../shared/backupDatabase'

export function captureBackupClientState():Record<string,string> {
  const result:Record<string,string>={}
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i)
    if(key&&isBackupClientKey(key)){const value=localStorage.getItem(key);if(value!==null)result[key]=value}
  }
  return result
}

export async function replayBackupClientState():Promise<void> {
  const pending=await window.api.backupClientRestore()
  if(!pending)return
  validateBackupClientState(pending.state)
  // The SQLite queue is acknowledged only after every localStorage write succeeds.
  // A crash or quota failure can retry the same deterministic replacement at boot.
  for(const key of Object.keys(captureBackupClientState()))localStorage.removeItem(key)
  for(const [key,value] of Object.entries(pending.state))localStorage.setItem(key,value)
  await window.api.backupAcknowledgeRestore(pending.token)
}

// Explicit escape hatch for a valid archive whose drafts exceed this device's quota.
// The durable queue is released only after the user has actually saved an external copy.
export async function exportPendingDraftsAndContinue():Promise<boolean> {
  const pending=await window.api.backupClientRestore()
  if(!pending)return true
  const saved=await window.api.saveFile('xinhai-pending-drafts.json',JSON.stringify(pending.state,null,2))
  if(!saved)return false
  for(const key of Object.keys(captureBackupClientState()))localStorage.removeItem(key)
  await window.api.backupAcknowledgeRestore(pending.token)
  return true
}
