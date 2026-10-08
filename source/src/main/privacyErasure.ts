import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ERASURE_CONFIRMATION, type ErasurePreview } from '../shared/privacyErasure'
import { privacyDeleteScript } from './privacyDeleteScript'

const MARKER = '.xinhai-studio-erase-pending.json'
function profilePath(profile: string): string {
  const path = resolve(profile)
  if (!isAbsolute(profile) || basename(path) !== 'xinhai-studio') throw Error('应用资料目录不符合清理范围，未执行清理')
  return join(realpathSync(dirname(path)), 'xinhai-studio')
}
function profileRoot(profile: string): string {
  const path = profilePath(profile), info = lstatSync(path)
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(path) !== path) throw Error('应用资料目录不能是链接，未执行清理')
  return path
}
function identity(path: string) {
  const stat = lstatSync(path, { bigint: true })
  return { dev: String(stat.dev), ino: String(stat.ino) }
}
function knowledgeLocation(root: string, knowledge: () => string) {
  let current = knowledge()
  try { current = realpathSync(current) } catch { current = resolve(current) }
  const rel = relative(root, current)
  return { current, preserved: rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel) ? current : null }
}
export function createErasureRequest(profile: string, knowledge: () => string) {
  let pending: { preview: ErasurePreview; id: ReturnType<typeof identity>; knowledge: string } | null = null
  return {
    prepare(): ErasurePreview {
      const location = profileRoot(profile), note = knowledgeLocation(location, knowledge)
      const preview: ErasurePreview = { ticket: randomUUID(), expiresAt: Date.now() + 600_000, platform: 'windows', location, preservedKnowledge: note.preserved }
      pending = { preview, id: identity(location), knowledge: note.current }
      return { ...preview }
    },
    cancel() { pending = null },
    schedule(ticket: unknown, confirmation: unknown) {
      if (confirmation !== ERASURE_CONFIRMATION) throw Error('请输入“清空本应用资料”确认')
      if (!pending || ticket !== pending.preview.ticket || Date.now() > pending.preview.expiresAt) throw Error('清理预览已失效，请重新查看范围')
      const root = profileRoot(profile), id = identity(root)
      if (root !== pending.preview.location || id.dev !== pending.id.dev || id.ino !== pending.id.ino || knowledgeLocation(root, knowledge).current !== pending.knowledge) throw Error('资料位置已变化，请重新查看清理范围')
      const marker = join(dirname(root), MARKER), temporary = marker + '.' + randomUUID() + '.tmp'
      if (existsSync(marker)) throw Error('已有待完成的清理，请关闭后重新打开应用')
      try {
        const fd = openSync(temporary, 'wx', 0o600)
        try { writeFileSync(fd, JSON.stringify({ operation: 'erase-commercial-profile', version: 2, root, ...id }) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
        renameSync(temporary, marker)
      } finally { if (existsSync(temporary)) unlinkSync(temporary) }
      pending = null
    }
  }
}

// Before Electron acquires its profile lock or initializes SQLite/sessions.
// Native handles pin every ancestor; deletion never follows a reparse point.
export function finishPendingErasure(profile: string): boolean {
  const path = profilePath(profile), marker = join(dirname(path), MARKER)
  let stat
  try { stat = lstatSync(marker) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw Error('清理状态文件无效，已停止启动以保护资料')
  const pending = JSON.parse(readFileSync(marker, 'utf8'))
  const root = profileRoot(path), id = identity(root)
  if (pending?.operation !== 'erase-commercial-profile' || pending.version !== 2 || pending.root !== root || pending.dev !== id.dev || pending.ino !== id.ino) throw Error('待清理目录已移动或被替换，已停止启动以保护资料')
  if (process.platform !== 'win32') throw Error('本机资料清理仅支持 Windows')
  const temp = mkdtempSync(join(dirname(root), '.xinhai-erase-worker-'))
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  try {
    execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(privacyDeleteScript, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 120_000, maxBuffer: 64 * 1024,
      env: { ...process.env, TEMP: temp, TMP: temp, XINHAI_ERASE_ROOT: root, XINHAI_ERASE_DEV: id.dev, XINHAI_ERASE_INO: id.ino }
    })
  } catch (error) {
    const failure = error as { status?: number; code?: string }
    throw Error(`本机清理程序未完成（${failure.status ?? failure.code ?? '未知错误'}），待清理状态仍保留`)
  }
  if (existsSync(root)) throw Error('应用资料目录仍存在，清理尚未完成')
  unlinkSync(marker)
  return true
}
