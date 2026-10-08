import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, realpath, rename, rm, rmdir, stat } from 'node:fs/promises'
import { once } from 'node:events'
import { Transform } from 'node:stream'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as yauzl from 'yauzl'
import yazl from 'yazl'

import { parseDatabaseSnapshot } from '../shared/backupDatabase'
import { validateBackupManifest, validatePortableBackup } from '../shared/backupArchive'
import type { DatabaseSnapshot } from '../shared/backupDatabase'
import type {
  BackupFileEntry,
  BackupManifest,
  BackupMediaSource,
  BackupRestoreResources,
  PortableBackup,
  PreparedBackup
} from '../shared/backupArchiveTypes'

const BACKUP_JSON = 'backup.json'
const DATABASE_JSON = 'database.json'
const ZIP_LIMIT = 2 * 1024 * 1024 * 1024
const FILE_LIMIT = 512 * 1024 * 1024
const MANIFEST_LIMIT = 4 * 1024 * 1024
const DATABASE_LIMIT = 16 * 1024 * 1024
const FILE_COUNT_LIMIT = 10_000

const WALLPAPER_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm'])
const MUSIC_EXTENSIONS = new Set(['mp3', 'ogg', 'wav', 'flac', 'm4a', 'aac', 'opus'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm'])

interface SourceFile {
  path: string
  archivePath: string
  size: number
  sha256: string
  mtimeMs: number
  dev: number
  ino: number
  kind: BackupFileEntry['kind']
  id?: string
}

interface FileStat {
  size: number
  mtimeMs: number
  dev: number
  ino: number
}

interface ReceiptDirectory {
  path: string
  dev: number
  ino: number
}

interface ReceiptRecord {
  files: Array<{ path: string; stat: FileStat; size: number; sha256: string }>
  knowledgeRoot: string
  restoredRootStat: FileStat
  directories: ReceiptDirectory[]
}

interface ArchiveEntryTotals {
  advertised: number
  actual: number
}

const receipts = new Map<string, ReceiptRecord>()

function fail(message: string): never {
  throw new Error('备份文件无效：' + message)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function within(root: string, candidate: string): boolean {
  const base = resolve(root)
  const target = resolve(candidate)
  const rest = relative(base, target)
  return rest !== '' && rest !== '..' && !rest.startsWith('..' + sep) && !isAbsolute(rest)
}

function canonicalArchiveKey(value: string): string {
  return value.normalize('NFC').toLowerCase()
}

function reservedWindowsName(component: string): boolean {
  const stem = component.split('.')[0].toUpperCase()
  return /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/.test(stem)
}

function validateComponent(component: string): void {
  if (!component || component === '.' || component === '..') fail('路径组件无效')
  if (component.endsWith('.') || component.endsWith(' ')) fail('路径组件不能以点或空格结尾')
  if (reservedWindowsName(component)) fail('路径包含 Windows 保留名称')
  if (/[<>:"|?*\u0000-\u001f\u007f]/.test(component)) fail('路径包含非法字符')
}

function validateRelativePath(value: string, label: string): string {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\u0000') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    fail(label + '路径无效')
  }
  const parts = value.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) fail(label + '路径穿越')
  parts.forEach(validateComponent)
  return parts.join('/')
}

function validateKnowledgeArchivePath(value: string): string {
  if (!value.startsWith('knowledge/')) fail('知识库归档路径无效')
  return validateRelativePath(value.slice('knowledge/'.length), '知识库')
}

function validateDirectoryPath(value: string): string {
  if (!value.startsWith('knowledge/')) fail('知识库目录路径无效')
  return validateRelativePath(value.slice('knowledge/'.length), '知识库目录')
}

function extension(value: string): string {
  const ext = extname(value).slice(1).toLowerCase()
  if (!ext) fail('文件缺少扩展名')
  return ext
}

function mediaSourceRoot(kind: BackupMediaSource['kind']): string {
  return resolve(app.getPath('userData'), kind === 'wallpaper' ? 'backgrounds' : 'imported-music')
}

async function ensurePrivateDirectory(path: string): Promise<string> {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isDirectory()) fail('私有目录不是普通目录')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(path, { recursive: true })
  }
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isDirectory()) fail('私有目录不是普通目录')
  return realpath(path)
}

async function existingDirectory(path: string): Promise<string> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isDirectory()) fail('知识库根目录不是普通目录')
  const canonical = await realpath(path)
  const canonicalInfo = await lstat(canonical)
  if (canonicalInfo.isSymbolicLink() || !canonicalInfo.isDirectory()) fail('知识库根目录不是普通目录')
  return canonical
}

async function statRegularFile(path: string, root: string): Promise<{ path: string; stat: FileStat }> {
  if (!within(root, path)) fail('文件越过了受控目录')
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) fail('文件必须是非链接普通文件')
  const canonical = await realpath(path)
  if (!within(root, canonical)) fail('文件真实路径越过了受控目录')
  const canonicalInfo = await lstat(canonical)
  if (!canonicalInfo.isFile() || canonicalInfo.isSymbolicLink()) fail('文件必须是非链接普通文件')
  return {
    path: canonical,
    stat: { size: canonicalInfo.size, mtimeMs: canonicalInfo.mtimeMs, dev: canonicalInfo.dev, ino: canonicalInfo.ino }
  }
}

function sameStat(before: FileStat, after: FileStat): boolean {
  return before.size === after.size && before.mtimeMs === after.mtimeMs && before.dev === after.dev && before.ino === after.ino
}

async function hashFile(path: string, expected?: FileStat): Promise<{ stat: FileStat; sha256: string }> {
  const initial = expected ?? (await statRegularFile(path, dirname(path))).stat
  if (!Number.isSafeInteger(initial.size) || initial.size < 0 || initial.size > FILE_LIMIT) fail('文件大小超出限制')
  const hash = createHash('sha256')
  let size = 0
  const stream = createReadStream(path)
  try {
    for await (const chunk of stream) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += data.length
      if (size > FILE_LIMIT) fail('文件大小超出限制')
      hash.update(data)
    }
  } finally {
    stream.destroy()
  }
  const current = await lstat(path)
  const after: FileStat = { size: current.size, mtimeMs: current.mtimeMs, dev: current.dev, ino: current.ino }
  if (!sameStat(initial, after) || size !== initial.size) fail('源文件在读取期间发生变化')
  return { stat: after, sha256: hash.digest('hex') }
}

async function hashSourceMedia(source: BackupMediaSource): Promise<SourceFile> {
  if (!/^m\d{6}$/.test(source.id)) fail('媒体 ID 必须为 m 加六位数字')
  if (!['wallpaper', 'music'].includes(source.kind)) fail('媒体类型无效')
  if (typeof source.source !== 'string' || source.source.length === 0) fail('媒体来源无效')
  let sourcePath: string
  try {
    if (/^file:/i.test(source.source)) {
      const url = new URL(source.source)
      if (url.protocol !== 'file:' || url.search || url.hash) fail('媒体来源必须是无查询参数的 file URL')
      sourcePath = resolve(fileURLToPath(url))
    } else if (isAbsolute(source.source)) {
      sourcePath = resolve(source.source)
    } else {
      fail('媒体来源必须是绝对路径或 file URL')
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('备份文件无效：')) throw error
    fail('媒体来源必须是 file URL')
  }
  const root = await ensurePrivateDirectory(mediaSourceRoot(source.kind))
  const ext = extension(sourcePath)
  const allowed = source.kind === 'wallpaper' ? WALLPAPER_EXTENSIONS : MUSIC_EXTENSIONS
  if (!allowed.has(ext) || ext !== source.extension.toLowerCase()) fail('媒体扩展名与来源不一致')
  const bounded = await statRegularFile(sourcePath, root)
  const result = await hashFile(bounded.path, bounded.stat)
  if (result.stat.size === 0) fail('媒体文件不能为空')
  return { path: bounded.path, archivePath: `media/${source.id}.${ext}`, size: result.stat.size, sha256: result.sha256, mtimeMs: result.stat.mtimeMs, dev: result.stat.dev, ino: result.stat.ino, kind: source.kind, id: source.id }
}

async function walkKnowledge(root: string): Promise<{ files: SourceFile[]; directories: string[] }> {
  const canonicalRoot = await existingDirectory(root)
  const userDataRoot = await realpath(resolve(app.getPath('userData')))
  if (canonicalRoot === userDataRoot || within(canonicalRoot, userDataRoot)) fail('知识库不能等于或包含应用 userData 根目录')
  const files: SourceFile[] = []
  const directories: string[] = []
  const seen = new Set<string>()
  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const local = join(directory, entry.name)
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      const archivePath = `knowledge/${validateRelativePath(relativePath, '知识库')}`
      const key = canonicalArchiveKey(archivePath)
      if (seen.has(key)) fail('知识库路径大小写或 NFC 冲突')
      seen.add(key)
      const info = await lstat(local)
      if (info.isSymbolicLink()) fail('知识库不能包含符号链接')
      if (info.isDirectory()) {
        const canonical = await realpath(local)
        if (!within(canonicalRoot, canonical)) fail('知识库目录越界')
        directories.push(archivePath)
        if (directories.length > FILE_COUNT_LIMIT) fail('知识库目录数量超过限制')
        await visit(canonical, relativePath)
      } else if (info.isFile()) {
        const bounded = await statRegularFile(local, canonicalRoot)
        const result = await hashFile(bounded.path, bounded.stat)
        files.push({ path: bounded.path, archivePath, size: result.stat.size, sha256: result.sha256, mtimeMs: result.stat.mtimeMs, dev: result.stat.dev, ino: result.stat.ino, kind: 'knowledge' })
        if (files.length > FILE_COUNT_LIMIT) fail('知识库文件数量超过限制')
      } else {
        fail('知识库包含不支持的文件类型')
      }
    }
  }
  await visit(canonicalRoot, '')
  return { files, directories }
}

function totalSize(files: SourceFile[]): number {
  let total = 0
  for (const file of files) {
    total += file.size
    if (!Number.isSafeInteger(total) || total > ZIP_LIMIT) fail('归档展开后大小超过 2GiB')
  }
  return total
}

function manifestFor(files: SourceFile[], directories: string[]): BackupManifest {
  const entries: BackupFileEntry[] = files.map(file => ({ path: file.archivePath, kind: file.kind, size: file.size, sha256: file.sha256, ...(file.id ? { id: file.id } : {}) }))
  return validateBackupManifest({ format: 'xinhai-backup', version: 1, appVersion: app.getVersion(), createdAt: Date.now(), files: entries, directories })
}

class LimitTransform extends Transform {
  total = 0
  constructor(private readonly limit: number) { super() }
  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    this.total += chunk.length
    if (this.total > this.limit) callback(new Error('归档压缩大小超过 2GiB'))
    else callback(null, chunk)
  }
}

function sourceStream(source: SourceFile, verifications: Promise<void>[]): NodeJS.ReadableStream {
  const input = createReadStream(source.path)
  const hash = createHash('sha256')
  let size = 0
  let resolveVerification!: () => void
  let rejectVerification!: (error: Error) => void
  const verification = new Promise<void>((resolvePromise, rejectPromise) => { resolveVerification = resolvePromise; rejectVerification = rejectPromise })
  verification.catch(() => undefined)
  verifications.push(verification)
  let verificationSettled = false
  const rejectVerificationOnce = (error: unknown): void => {
    if (verificationSettled) return
    verificationSettled = true
    rejectVerification(error instanceof Error ? error : new Error(String(error)))
  }
  const transform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length
      if (size > FILE_LIMIT) { callback(new Error('源文件大小超过限制')); return }
      hash.update(chunk)
      callback(null, chunk)
    },
    flush(callback) {
      void (async () => {
        try {
          const current = await lstat(source.path)
          const currentStat: FileStat = { size: current.size, mtimeMs: current.mtimeMs, dev: current.dev, ino: current.ino }
          if (!sameStat({ size: source.size, mtimeMs: source.mtimeMs, dev: source.dev, ino: source.ino }, currentStat) || size !== source.size || hash.digest('hex') !== source.sha256) throw new Error('源文件在归档期间发生变化')
          verificationSettled = true
          resolveVerification()
          callback()
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error))
          rejectVerificationOnce(failure)
          input.destroy(failure)
          callback(failure)
        }
      })()
    }
  })
  transform.once('error', error => { rejectVerificationOnce(error); input.destroy(error) })
  input.once('error', error => { rejectVerificationOnce(error); transform.destroy(error) })
  input.pipe(transform)
  return transform
}

async function writeArchive(destination: string, manifest: BackupManifest, databaseBytes: Buffer, sources: SourceFile[]): Promise<void> {
  if (databaseBytes.length > DATABASE_LIMIT) fail('database.json 超过 16MiB')
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8')
  if (manifestBytes.length > MANIFEST_LIMIT) fail('backup.json 超过 4MiB')
  const expandedSize = manifestBytes.length + databaseBytes.length + sources.reduce((total, source) => total + source.size, 0)
  if (!Number.isSafeInteger(expandedSize) || expandedSize > ZIP_LIMIT) fail('归档展开后大小超过 2GiB')
  const temporary = join(await ensurePrivateDirectory(resolve(app.getPath('userData'), 'backup-work')), `.xinhai-backup-${randomUUID()}.part`)
  const zip = new yazl.ZipFile()
  const output = createWriteStream(temporary, { flags: 'wx' })
  const limit = new LimitTransform(ZIP_LIMIT)
  const verifications: Promise<void>[] = []
  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      let settled = false
      const reject = (error: unknown) => { if (!settled) { settled = true; rejectPromise(error instanceof Error ? error : new Error(String(error))) } }
      const resolveOutput = () => { if (!settled) { settled = true; resolvePromise() } }
      zip.once('error', reject); zip.outputStream.once('error', reject); limit.once('error', reject); output.once('error', reject); output.once('close', resolveOutput)
      zip.outputStream.pipe(limit).pipe(output)
      zip.addBuffer(manifestBytes, BACKUP_JSON)
      zip.addBuffer(databaseBytes, DATABASE_JSON)
      for (const source of sources) {
        zip.addReadStreamLazy(source.archivePath, { size: source.size }, callback => callback(null, sourceStream(source, verifications)))
      }
      zip.end()
    })
    await Promise.all(verifications)
    const info = await stat(temporary)
    if (info.size > ZIP_LIMIT) fail('归档压缩大小超过 2GiB')
    await ensureDestination(destination)
    try {
      try {
        await rename(temporary, destination)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
        const localTemporary = join(dirname(destination), `.${pathBase(destination)}-${randomUUID()}.part`)
        try {
          await copyFile(temporary, localTemporary)
          await rename(localTemporary, destination)
        } finally {
          await rm(localTemporary, { force: true }).catch(() => undefined)
        }
      }
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  } catch (error) {
    output.destroy(); await rm(temporary, { force: true }).catch(() => undefined); throw error
  }
}

function pathBase(value: string): string {
  const parts = value.replaceAll('\\', '/').split('/')
  return parts[parts.length - 1] || 'xinhai-backup'
}

async function ensureDestination(destination: string): Promise<void> {
  if (typeof destination !== 'string' || !destination || destination.includes('\0')) fail('归档目标无效')
  const target = resolve(destination)
  try { if ((await lstat(target)).isDirectory()) fail('归档目标不能是目录') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}

export async function exportArchive(destination: string, portable: PortableBackup, knowledgeRoot: string): Promise<string> {
  const media = await Promise.all(portable.mediaSources.map(hashSourceMedia))
  const knowledge = await walkKnowledge(knowledgeRoot)
  const preliminaryFiles: BackupFileEntry[] = [
    { path: DATABASE_JSON, kind: 'database', size: 1, sha256: '0'.repeat(64) },
    ...media.map(file => ({ path: file.archivePath, kind: file.kind as 'wallpaper' | 'music', size: file.size, sha256: file.sha256, id: file.id! })),
    ...knowledge.files.map(file => ({ path: file.archivePath, kind: 'knowledge' as const, size: file.size, sha256: file.sha256 }))
  ]
  const preliminaryManifest = manifestFor(preliminaryFiles.map(file => ({
    path: '', archivePath: file.path, size: file.size, sha256: file.sha256, mtimeMs: 0, dev: 0, ino: 0, kind: file.kind, id: file.id
  })), knowledge.directories)
  const databaseSnapshot = validatePortableBackup(portable.snapshot, preliminaryManifest)
  const databaseBytes = Buffer.from(JSON.stringify(databaseSnapshot), 'utf8')
  if (databaseBytes.length > DATABASE_LIMIT) fail('database.json 超过 16MiB')
  const databaseHash = createHash('sha256').update(databaseBytes).digest('hex')
  const databaseSource: BackupFileEntry = { path: DATABASE_JSON, kind: 'database', size: databaseBytes.length, sha256: databaseHash }
  const sources = [...media, ...knowledge.files]
  const files: BackupFileEntry[] = [databaseSource, ...sources.map(file => file.id
    ? { path: file.archivePath, kind: file.kind as 'wallpaper' | 'music', size: file.size, sha256: file.sha256, id: file.id }
    : { path: file.archivePath, kind: 'knowledge' as const, size: file.size, sha256: file.sha256 })]
  if (files.length > FILE_COUNT_LIMIT) fail('归档文件数量超过限制')
  totalSize(files.map(file => ({ path: '', archivePath: file.path, size: file.size, sha256: file.sha256, mtimeMs: 0, dev: 0, ino: 0, kind: file.kind, id: file.id })))
  const manifest = validateBackupManifest({ format: 'xinhai-backup', version: 1, appVersion: app.getVersion(), createdAt: Date.now(), files, directories: knowledge.directories })
  const checkedSnapshot = validatePortableBackup(databaseSnapshot, manifest)
  const finalDatabaseBytes = Buffer.from(JSON.stringify(checkedSnapshot), 'utf8')
  if (finalDatabaseBytes.length > DATABASE_LIMIT) fail('database.json 超过 16MiB')
  const finalHash = createHash('sha256').update(finalDatabaseBytes).digest('hex')
  const finalEntry = manifest.files.find(file => file.kind === 'database')
  if (!finalEntry || finalEntry.size !== finalDatabaseBytes.length || finalEntry.sha256 !== finalHash) fail('数据库快照与清单不一致')
  await writeArchive(resolve(destination), manifest, finalDatabaseBytes, sources)
  return resolve(destination)
}

function entryIsDirectory(entry: yauzl.Entry): boolean { return entry.fileName.endsWith('/') || (((entry.versionMadeBy >>> 8) & 0xff) === 0 && (entry.externalFileAttributes & 0x10) !== 0) }
function entryIsLink(entry: yauzl.Entry): boolean {
  if (((entry.versionMadeBy >>> 8) & 0xff) !== 3) return false
  const mode = (entry.externalFileAttributes >>> 16) & 0xf000
  return mode === 0xa000 || (mode !== 0 && mode !== 0x4000 && mode !== 0x8000)
}

async function openArchive(file: string): Promise<yauzl.ZipFile> {
  const input = await lstat(file)
  if (!input.isFile() || input.isSymbolicLink() || input.size > ZIP_LIMIT) fail('备份文件无效或超过 2GiB')
  return new Promise((resolvePromise, rejectPromise) => yauzl.open(file, { lazyEntries: true, decodeStrings: true, strictFileNames: true, validateEntrySizes: true, autoClose: false }, (error, zip) => error || !zip ? rejectPromise(error || new Error('无法打开备份文件')) : resolvePromise(zip)))
}

async function listArchiveEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolvePromise, rejectPromise) => {
    const result: yauzl.Entry[] = [], keys = new Set<string>(), totals: ArchiveEntryTotals = { advertised: 0, actual: 0 }
    let settled = false
    const reject = (error: unknown) => { if (!settled) { settled = true; zip.close(); rejectPromise(error instanceof Error ? error : new Error(String(error))) } }
    zip.once('error', reject)
    zip.on('entry', entry => {
      if (settled) return
      try {
        validateRelativePath(entry.fileName, 'ZIP')
        if (entry.fileName === BACKUP_JSON || entry.fileName === DATABASE_JSON) { /* allowed root names */ }
        else if (!entry.fileName.startsWith('media/') && !entry.fileName.startsWith('knowledge/')) fail('ZIP 包含未知条目')
        if (entryIsDirectory(entry) || entryIsLink(entry) || entry.isEncrypted() || (entry.generalPurposeBitFlag & 1) !== 0) fail('ZIP 包含目录、链接或加密条目')
        if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) fail('ZIP 压缩方式不受支持')
        if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > FILE_LIMIT) fail('ZIP 条目大小无效')
        const key = canonicalArchiveKey(entry.fileName); if (keys.has(key)) fail('ZIP 条目重复')
        keys.add(key); totals.advertised += entry.uncompressedSize; if (totals.advertised > ZIP_LIMIT) fail('ZIP 展开大小超过限制')
        result.push(entry); if (result.length > FILE_COUNT_LIMIT + 2) fail('ZIP 文件数量超过限制')
        zip.readEntry()
      } catch (error) { reject(error) }
    })
    zip.once('end', () => { if (!settled) { settled = true; resolvePromise(result) } })
    zip.readEntry()
  })
}

function readEntryBuffer(zip: yauzl.ZipFile, entry: yauzl.Entry, limit: number, totals: ArchiveEntryTotals): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => zip.openReadStream(entry, (error, stream) => {
    if (error || !stream) { rejectPromise(error || new Error('无法读取 ZIP 条目')); return }
    const chunks: Buffer[] = []; let size = 0
    void (async () => { try { for await (const chunk of stream) { const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += data.length; totals.actual += data.length; if (size > limit || totals.actual > ZIP_LIMIT) throw new Error('ZIP 解压大小超过限制'); chunks.push(data) } if (size !== entry.uncompressedSize) throw new Error('ZIP 条目大小校验失败'); resolvePromise(Buffer.concat(chunks, size)) } catch (e) { rejectPromise(e) } })()
  }))
}

async function copyEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, target: string, expected: BackupFileEntry, totals: ArchiveEntryTotals): Promise<void> {
  const parent = dirname(target); await mkdir(parent, { recursive: true }); const output = createWriteStream(target, { flags: 'wx' }); let opened = false; const hash = createHash('sha256'); let size = 0; let outputError: Error | null = null
  output.once('open', () => { opened = true })
  output.once('error', error => { outputError = error instanceof Error ? error : new Error(String(error)) })
  try {
    await new Promise<void>((resolvePromise, rejectPromise) => zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) { rejectPromise(error || new Error('无法读取 ZIP 文件')); return }
      void (async () => { try { for await (const chunk of stream) { if (outputError) throw outputError; const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += data.length; totals.actual += data.length; if (size > FILE_LIMIT || totals.actual > ZIP_LIMIT) throw new Error('ZIP 展开大小超过限制'); hash.update(data); if (!output.write(data)) await once(output, 'drain') } if (outputError) throw outputError; output.end(() => resolvePromise()) } catch (e) { rejectPromise(e) } })()
    }))
    if (size !== expected.size || hash.digest('hex') !== expected.sha256) throw new Error('归档文件大小或 SHA-256 不匹配')
  } catch (error) { output.destroy(); if (opened) await rm(target, { force: true }).catch(() => undefined); throw error }
}

async function removeEmptyDirectoryTree(path: string): Promise<void> {
  const info = await lstat(path).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : Promise.reject(error))
  if (!info || !info.isDirectory() || info.isSymbolicLink()) return
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) await removeEmptyDirectoryTree(join(path, entry.name))
  }
  if ((await readdir(path)).length === 0) await rmdir(path).catch(error => {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code || '')) throw error
  })
}

async function verifyDirectoryTree(path: string, boundary: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) fail('恢复知识库目录不是普通目录')
  const canonical = await realpath(path)
  if (!within(boundary, canonical)) fail('恢复知识库目录越过受控目录')
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    const childInfo = await lstat(child)
    if (childInfo.isSymbolicLink()) fail('恢复知识库不能包含符号链接')
    if (childInfo.isDirectory()) await verifyDirectoryTree(child, boundary)
    else if (!childInfo.isFile()) fail('恢复知识库包含不支持的文件类型')
  }
}

export async function prepareArchive(source: string): Promise<PreparedBackup> {
  const zip = await openArchive(resolve(source)); const createdFiles: Array<{ path: string; stat: FileStat; size: number; sha256: string }> = []; const receiptDirectories: ReceiptDirectory[] = []; const ticket = randomUUID(); let knowledgeRoot = ''; let restoredRoot = ''; let restoredRootStat: FileStat | null = null
  try {
    const entries = await listArchiveEntries(zip); const byName = new Map(entries.map(entry => [entry.fileName, entry])); const backupEntry = byName.get(BACKUP_JSON); if (!backupEntry || backupEntry.uncompressedSize > MANIFEST_LIMIT) fail('缺少或超大的 backup.json')
    const totals: ArchiveEntryTotals = { advertised: entries.reduce((n, e) => n + e.uncompressedSize, 0), actual: 0 }
      const manifest = validateBackupManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readEntryBuffer(zip, backupEntry, MANIFEST_LIMIT, totals))))
    const expected = new Map(manifest.files.map(file => [file.path, file])); const allowed = new Set([BACKUP_JSON, ...expected.keys()]); if (byName.size !== allowed.size || [...byName.keys()].some(name => !allowed.has(name))) fail('ZIP 条目与清单不一致')
    const databaseEntry = byName.get(DATABASE_JSON); const expectedDatabase = expected.get(DATABASE_JSON); if (!databaseEntry || !expectedDatabase || databaseEntry.uncompressedSize > DATABASE_LIMIT) fail('缺少或超大的 database.json')
    const databaseBytes = await readEntryBuffer(zip, databaseEntry, DATABASE_LIMIT, totals)
    if (databaseBytes.length !== expectedDatabase.size || createHash('sha256').update(databaseBytes).digest('hex') !== expectedDatabase.sha256) fail('database.json 大小或 SHA-256 不匹配')
    const database = parseDatabaseSnapshot(new TextDecoder('utf-8', { fatal: true }).decode(databaseBytes))
    const snapshot = validatePortableBackup(database, manifest)
    const mediaRoot = await ensurePrivateDirectory(resolve(app.getPath('userData'), 'backgrounds')); const musicRoot = await ensurePrivateDirectory(resolve(app.getPath('userData'), 'imported-music')); const restoredParent = await ensurePrivateDirectory(resolve(app.getPath('userData'), 'restored')); restoredRoot = join(restoredParent, ticket)
    await mkdir(restoredRoot)
    const restoredInfo = await lstat(restoredRoot)
    if (!restoredInfo.isDirectory() || restoredInfo.isSymbolicLink()) fail('恢复票据目录不是普通目录')
    restoredRootStat = { size: restoredInfo.size, mtimeMs: restoredInfo.mtimeMs, dev: restoredInfo.dev, ino: restoredInfo.ino }
    knowledgeRoot = join(restoredRoot, 'knowledge'); await mkdir(knowledgeRoot)
    const knowledgeInfo = await lstat(knowledgeRoot)
    if (!knowledgeInfo.isDirectory() || knowledgeInfo.isSymbolicLink()) fail('恢复知识库根目录不是普通目录')
    receiptDirectories.push({ path: knowledgeRoot, dev: knowledgeInfo.dev, ino: knowledgeInfo.ino })
    const media: Record<string, { path: string; url: string }> = {}
    for (const file of manifest.files) {
      if (file.kind === 'database') continue
      const entry = byName.get(file.path); if (!entry) fail('清单文件缺失')
      const target = file.kind === 'knowledge' ? join(knowledgeRoot, validateKnowledgeArchivePath(file.path)) : join(file.kind === 'wallpaper' ? mediaRoot : musicRoot, `${ticket}_${file.id}.${extension(file.path)}`)
      const root = file.kind === 'knowledge' ? knowledgeRoot : file.kind === 'wallpaper' ? mediaRoot : musicRoot
      if (!within(root, target)) fail('恢复路径越界')
      await copyEntry(zip, entry, target, file, totals); const created = await lstat(target); createdFiles.push({ path: target, stat: { size: created.size, mtimeMs: created.mtimeMs, dev: created.dev, ino: created.ino }, size: file.size, sha256: file.sha256 })
      if (file.kind !== 'knowledge') media[file.id!] = { path: target, url: pathToFileURL(target).href }
    }
    for (const directory of manifest.directories) {
      const target = join(knowledgeRoot, validateDirectoryPath(directory)); if (!within(knowledgeRoot, target)) fail('知识库目录越界')
      await mkdir(target, { recursive: true })
      const info = await lstat(target)
      if (!info.isDirectory() || info.isSymbolicLink()) fail('知识库目录不是普通目录')
      receiptDirectories.push({ path: target, dev: info.dev, ino: info.ino })
    }
    const record: ReceiptRecord = { files: createdFiles, knowledgeRoot, restoredRootStat: restoredRootStat!, directories: receiptDirectories }; receipts.set(ticket, record)
    return { ticket, manifest, snapshot, resources: { knowledgeRoot, media } }
  } catch (error) {
    for (const file of createdFiles.reverse()) await rm(file.path, { force: true }).catch(() => undefined)
    if (restoredRoot && restoredRootStat) {
      const current = await lstat(restoredRoot).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : null)
      if (current && current.isDirectory() && !current.isSymbolicLink() && current.dev === restoredRootStat.dev && current.ino === restoredRootStat.ino) await removeEmptyDirectoryTree(restoredRoot).catch(() => undefined)
    }
    throw error
  } finally { if (zip.isOpen) zip.close() }
}

export async function finishArchive(ticket: string, keep: boolean): Promise<void> {
  if (!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(ticket)) fail('票据无效')
  const record = receipts.get(ticket); if (!record) fail('票据不存在或已处理')
  if (keep) { receipts.delete(ticket); return }
  const restoredRoot = dirname(record.knowledgeRoot)
  const restoredParent = await ensurePrivateDirectory(resolve(app.getPath('userData'), 'restored'))
  const restoredInfo = await lstat(restoredRoot).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : Promise.reject(error))
  if (restoredInfo && (!restoredInfo.isDirectory() || restoredInfo.isSymbolicLink() || restoredInfo.dev !== record.restoredRootStat.dev || restoredInfo.ino !== record.restoredRootStat.ino)) fail('票据目录已发生变化')
  const canonicalRestoredRoot = restoredInfo ? await realpath(restoredRoot) : null
  if (canonicalRestoredRoot && !within(restoredParent, canonicalRestoredRoot)) fail('票据目录越过受控目录')
  const removable: Array<{ path: string }> = []
  for (const file of record.files) {
    const current = await lstat(file.path).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : Promise.reject(error))
    if (!current) continue
    if (!current.isFile() || current.isSymbolicLink() || !sameStat(file.stat, { size: current.size, mtimeMs: current.mtimeMs, dev: current.dev, ino: current.ino })) fail('票据文件已发生变化')
    removable.push(file)
  }
  for (const file of removable) await rm(file.path, { force: true })
  if (restoredInfo) await removeEmptyDirectoryTree(restoredRoot)
  receipts.delete(ticket)
}

export async function verifyArchive(ticket: string): Promise<void> {
  if (!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(ticket)) fail('票据无效')
  const record = receipts.get(ticket); if (!record) fail('票据不存在或已处理')
  const restoredParent = await ensurePrivateDirectory(resolve(app.getPath('userData'), 'restored'))
  const restoredRoot = dirname(record.knowledgeRoot)
  const restoredInfo = await lstat(restoredRoot)
  if (!restoredInfo.isDirectory() || restoredInfo.isSymbolicLink() || restoredInfo.dev !== record.restoredRootStat.dev || restoredInfo.ino !== record.restoredRootStat.ino) fail('票据目录已发生变化')
  const canonicalRestoredRoot = await realpath(restoredRoot)
  if (!within(restoredParent, canonicalRestoredRoot)) fail('票据目录越过受控目录')
  const knowledgeRoot = await realpath(record.knowledgeRoot)
  if (!within(canonicalRestoredRoot, knowledgeRoot)) fail('恢复知识库越过受控目录')
  await verifyDirectoryTree(record.knowledgeRoot, canonicalRestoredRoot)
  for (const directory of record.directories) {
    const current = await lstat(directory.path)
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== directory.dev || current.ino !== directory.ino) fail('声明的知识库目录已被删除或替换')
    const canonical = await realpath(directory.path)
    if (directory.path !== record.knowledgeRoot && !within(knowledgeRoot, canonical)) fail('声明的知识库目录越过受控目录')
  }
  const mediaRoots = [await ensurePrivateDirectory(resolve(app.getPath('userData'), 'backgrounds')), await ensurePrivateDirectory(resolve(app.getPath('userData'), 'imported-music'))]
  for (const file of record.files) {
    if (!within(knowledgeRoot, file.path) && !mediaRoots.some(root => within(root, file.path))) fail('恢复文件越过受控目录')
    const current = await lstat(file.path)
    if (!current.isFile() || current.isSymbolicLink()) fail('恢复文件已不是普通文件')
    const currentStat: FileStat = { size: current.size, mtimeMs: current.mtimeMs, dev: current.dev, ino: current.ino }
    if (!sameStat(file.stat, currentStat)) fail('恢复文件在确认前发生变化')
    const result = await hashFile(file.path, file.stat)
    if (result.stat.size !== file.size || result.sha256 !== file.sha256) fail('恢复文件校验值发生变化')
  }
}
