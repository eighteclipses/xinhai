import type { KnowledgeNote } from '../../../shared/types'

export type NoteDraft = { content: string; revision: string }
export const noteDraftKey = (root: string, path: string) => 'xinhai-note:' + root + ':' + path
export const NOTE_SAVED_EVENT = 'xinhai-knowledge-note-saved'
export type NoteSaved = { root: string; submitted: NoteDraft; note: KnowledgeNote; draftStorageFailed: boolean }
export const NOTE_RECOVERED_EVENT = 'xinhai-knowledge-note-recovered'
export type NoteRecovered = { root: string; sourcePath: string; submitted: NoteDraft; note: KnowledgeNote; sourceCleared: boolean; cleanupFailed: boolean }
// Storage failures must not discard the only copy when the user switches pages.
// This fallback lives only in this app session; the UI must say so explicitly.
const volatileDrafts = new Map<string, NoteDraft>()
export const noteDraftIsVolatile = (root: string, path: string) => volatileDrafts.has(noteDraftKey(root, path))

export function writeNoteDraft(root: string, path: string, draft: NoteDraft): boolean {
  const key = noteDraftKey(root, path)
  try {
    localStorage.setItem(key, JSON.stringify(draft))
    volatileDrafts.delete(key)
    return true
  } catch {
    volatileDrafts.set(key, draft)
    return false
  }
}

export function forgetNoteDraft(root: string, path: string): void {
  const key = noteDraftKey(root, path)
  localStorage.removeItem(key)
  volatileDrafts.delete(key)
}

export function readNoteDraft(root: string, path: string): NoteDraft | null {
  const volatile = volatileDrafts.get(noteDraftKey(root, path))
  if (volatile) return volatile
  const value = JSON.parse(localStorage.getItem(noteDraftKey(root, path)) || 'null')
  return value && typeof value.content === 'string' && typeof value.revision === 'string' ? value : null
}

export function listRecoverableNoteDrafts(root: string, notes: KnowledgeNote[]): { paths: string[]; unreadable: number } {
  const prefix = noteDraftKey(root, ''), present = new Set(notes.map(note => note.path))
  const keys = new Set(volatileDrafts.keys())
  let unreadable = 0
  try { for (const key of Object.keys(localStorage)) keys.add(key) } catch { unreadable++ }
  const paths: string[] = []
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue
    const path = key.slice(prefix.length)
    if (!path || present.has(path)) continue
    try {
      if (readNoteDraft(root, path)) paths.push(path)
      else unreadable++
    } catch { unreadable++ }
  }
  return { paths: paths.sort((a, b) => a.localeCompare(b)), unreadable }
}

// Called only after the new file has been read back with the submitted content.
// A later edit or a failed cleanup leaves the source draft available to recover.
export function acknowledgeNoteRecovery(root: string, sourcePath: string, submitted: NoteDraft, note: KnowledgeNote): void {
  let sourceCleared = false, cleanupFailed = false
  try {
    const draft = readNoteDraft(root, sourcePath)
    if (draft?.content === submitted.content && draft.revision === submitted.revision) {
      forgetNoteDraft(root, sourcePath)
      sourceCleared = true
    }
  } catch { cleanupFailed = true }
  window.dispatchEvent(new CustomEvent<NoteRecovered>(NOTE_RECOVERED_EVENT, { detail: { root, sourcePath, submitted, note, sourceCleared, cleanupFailed } }))
}

// A save acknowledges only the submitted text. Newer input keeps its draft and
// uses the acknowledged file revision for the next save, even across navigation.
export function acknowledgeNoteSave(root: string, submitted: NoteDraft, note: KnowledgeNote): void {
  let draftStorageFailed = false
  try {
    const draft = readNoteDraft(root, note.path)
    if (draft?.revision === submitted.revision) {
      if (draft.content === submitted.content) forgetNoteDraft(root, note.path)
      else draftStorageFailed = !writeNoteDraft(root, note.path, { ...draft, revision: note.revision })
    }
  } catch { draftStorageFailed = true }
  window.dispatchEvent(new CustomEvent<NoteSaved>(NOTE_SAVED_EVENT, { detail: { root, submitted, note, draftStorageFailed } }))
}

export function knowledgeError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/^Error:\s*/i, '')
    .replace(/^Error invoking remote method\s+['"][^'"]+['"]:\s*/i, '')
    .replace(/^Error:\s*/i, '')
  if (/\b(?:EPERM|EACCES|EBUSY)\b/.test(message)) return '文件暂时无法写入，可能被其他程序占用。请稍后重试，或将当前内容另存为新笔记。'
  return message
}
