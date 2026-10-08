import { app, nativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readFile, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as yauzl from 'yauzl'
import yazl from 'yazl'

import type { CustomBackground } from '../shared/types'
import { FALLBACK_POSTER } from '../shared/sceneCatalog'
import { parseThemeManifest } from '../shared/themeLibrary'
import type { ThemeManifest } from '../shared/themeLibrary'
import { normalizeBackgroundImage } from './backgroundImage'

const MANIFEST_FILE = 'theme.json'
const MANIFEST_LIMIT = 64 * 1024
const IMPORT_LIMIT = 301 * 1024 * 1024
const IMAGE_LIMIT = 30 * 1024 * 1024
const VIDEO_LIMIT = 300 * 1024 * 1024
const PIXEL_LIMIT = 100_000_000

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm'])
const EMBEDDED_FILES = new Set([
  'wallpaper.png',
  'wallpaper.jpg',
  'wallpaper.jpeg',
  'wallpaper.webp',
  'wallpaper.mp4',
  'wallpaper.webm'
])

interface ReceiptRecord {
  path: string
  dev: number
  ino: number
  size: number
  birthtimeMs: number
}

interface EmbeddedDescriptor {
  type: 'embedded'
  file: string
  name: string
  kind: 'image' | 'video'
  extension: string
  mime: string
}

interface BuiltinDescriptor {
  type: 'builtin'
  id: string
}

type WallpaperDescriptor = EmbeddedDescriptor | BuiltinDescriptor

interface EntryTotals {
  actual: number
}

const importReceipts = new Map<string, ReceiptRecord>()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fail(message: string): never {
  throw new Error(message)
}

function parseAndCheckManifest(value: unknown): ThemeManifest {
  try {
    return parseThemeManifest(value)
  } catch (error) {
    throw new Error(`主题清单无效：${errorMessage(error)}`)
  }
}

function descriptorForManifest(manifest: ThemeManifest): WallpaperDescriptor {
  const wallpaper = manifest.wallpaper
  if (!wallpaper || typeof wallpaper !== 'object') fail('主题缺少壁纸描述')

  if (wallpaper.type === 'builtin') {
    if (typeof wallpaper.id !== 'string' || wallpaper.id.length === 0) fail('内置壁纸 ID 无效')
    return { type: 'builtin', id: wallpaper.id }
  }

  if (wallpaper.type !== 'embedded' || typeof wallpaper.file !== 'string' || typeof wallpaper.name !== 'string') {
    fail('嵌入壁纸描述无效')
  }
  if (!EMBEDDED_FILES.has(wallpaper.file)) fail('嵌入壁纸文件名无效')
  if (wallpaper.name.length === 0 || wallpaper.name.length > 512) fail('嵌入壁纸名称无效')

  const extension = wallpaper.file.slice(wallpaper.file.lastIndexOf('.') + 1).toLowerCase()
  const image = IMAGE_EXTENSIONS.has(extension)
  const video = VIDEO_EXTENSIONS.has(extension)
  if ((wallpaper.kind === 'image') !== image || (wallpaper.kind === 'video') !== video) {
    fail('嵌入壁纸的扩展名、类型和 MIME 不一致')
  }

  return {
    type: 'embedded',
    file: wallpaper.file,
    name: wallpaper.name,
    kind: wallpaper.kind,
    extension,
    mime: image ? `image/${extension === 'jpg' || extension === 'jpeg' ? 'jpeg' : extension}` :
      extension === 'mp4' ? 'video/mp4' : 'video/webm'
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const path = resolve(candidate)
  const base = resolve(root)
  const rest = relative(base, path)
  return rest !== '' && !rest.startsWith(`..${sep}`) && rest !== '..' && !isAbsolute(rest)
}

async function privateBackgrounds(): Promise<string> {
  const configured = resolve(app.getPath('userData'), 'backgrounds')
  try {
    const existing = await lstat(configured)
    if (existing.isSymbolicLink()) fail('背景目录不能是链接')
    if (!existing.isDirectory()) fail('背景目录不是受控的私有目录')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(configured, { recursive: true })
  }
  const folderInfo = await lstat(configured)
  if (!folderInfo.isDirectory() || folderInfo.isSymbolicLink()) fail('背景目录不是受控的私有目录')
  return realpath(configured)
}

async function sourcePathForExport(source: CustomBackground, folder: string, descriptor: EmbeddedDescriptor): Promise<{ path: string; size: number }> {
  if (source.kind !== descriptor.kind) fail('壁纸类型与主题清单不一致')
  if (typeof source.src !== 'string' || source.src.length === 0) fail('壁纸路径无效')

  let sourceUrl: URL
  try {
    sourceUrl = new URL(source.src)
  } catch {
    fail('壁纸路径无效')
  }
  if (sourceUrl.protocol !== 'file:' || sourceUrl.search || sourceUrl.hash) fail('壁纸必须是本机文件')

  const requested = resolve(fileURLToPath(sourceUrl))
  if (!isPathInside(folder, requested)) fail('只能导出私有背景目录中的壁纸')
  const requestedInfo = await lstat(requested)
  if (!requestedInfo.isFile() || requestedInfo.isSymbolicLink()) fail('壁纸必须是非链接的普通文件')
  const canonical = await realpath(requested)
  if (!isPathInside(folder, canonical)) fail('壁纸路径越过了私有背景目录')
  const canonicalInfo = await lstat(canonical)
  if (!canonicalInfo.isFile() || canonicalInfo.isSymbolicLink()) fail('壁纸必须是非链接的普通文件')

  const limit = descriptor.kind === 'image' ? IMAGE_LIMIT : VIDEO_LIMIT
  if (canonicalInfo.size <= 0 || canonicalInfo.size > limit) {
    fail(descriptor.kind === 'image' ? '图片不能超过 30MB' : '视频不能超过 300MB')
  }

  const header = await readFileHeader(canonical, 64)
  if (descriptor.kind === 'video') {
    if (!videoHeaderMatches(descriptor.extension, header)) fail('视频文件格式与主题清单不一致')
  } else {
    if (!imageHeaderMatches(descriptor.extension, header)) fail('图片文件格式与主题清单不一致')
    const decoded = nativeImage.createFromBuffer(await readFile(canonical))
    if (decoded.isEmpty()) fail('无法读取主题图片')
    const size = decoded.getSize()
    if (size.width * size.height > PIXEL_LIMIT) fail('图片分辨率过高')
  }

  return { path: canonical, size: canonicalInfo.size }
}

async function readFileHeader(file: string, maxBytes: number): Promise<Buffer> {
  const stream = createReadStream(file, { start: 0, end: maxBytes - 1 })
  const chunks: Buffer[] = []
  let total = 0
  try {
    for await (const chunk of stream) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      chunks.push(data)
      total += data.length
    }
  } finally {
    stream.destroy()
  }
  return Buffer.concat(chunks, total)
}

function imageHeaderMatches(extension: string, header: Buffer): boolean {
  if (extension === 'png') return header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (extension === 'jpg' || extension === 'jpeg') return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
  return extension === 'webp' && header.length >= 12 && header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP'
}

function videoHeaderMatches(extension: string, header: Buffer): boolean {
  if (extension === 'mp4') return header.length >= 12 && header.subarray(4, Math.min(header.length, 64)).includes(Buffer.from('ftyp'))
  return extension === 'webm' && header.length >= 4 && header.readUInt32BE(0) === 0x1a45dfa3
}

function validateDestination(destination: string): string {
  if (typeof destination !== 'string' || destination.length === 0 || destination.includes('\0')) fail('导出路径无效')
  return resolve(destination)
}

async function ensureDestinationUsable(destination: string): Promise<void> {
  try {
    const info = await lstat(destination)
    if (info.isDirectory()) fail('导出路径不能是目录')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function ensureAbsent(path: string): Promise<void> {
  try {
    await lstat(path)
    fail('导入目标文件已存在')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function resolvesTo(path: string, target: string): Promise<boolean> {
  try {
    return resolve(await realpath(path)) === resolve(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function writeZip(destination: string, manifestJson: Buffer, source: { path: string; file: string } | null): Promise<void> {
  const temporary = join(dirname(destination), `.xinhai-theme-${randomUUID()}.tmp`)
  const zip = new yazl.ZipFile()
  const output = createWriteStream(temporary, { flags: 'wx' })

  try {
    const completed = new Promise<void>((resolvePromise, rejectPromise) => {
      let settled = false
      const reject = (error: unknown) => {
        if (settled) return
        settled = true
        rejectPromise(error instanceof Error ? error : new Error(String(error)))
      }
      const resolveOutput = () => {
        if (settled) return
        settled = true
        resolvePromise()
      }
      output.once('error', reject)
      output.once('close', resolveOutput)
      zip.once('error', reject)
      zip.outputStream.once('error', reject)
      zip.outputStream.pipe(output)
      zip.addBuffer(manifestJson, MANIFEST_FILE)
      if (source) zip.addFile(source.path, source.file)
      zip.end()
    })
    await completed
    await rename(temporary, destination)
  } catch (error) {
    output.destroy()
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function exportThemeFile(destination: string, manifest: ThemeManifest, source: CustomBackground | null): Promise<void> {
  const checkedManifest = parseAndCheckManifest(manifest)
  const descriptor = descriptorForManifest(checkedManifest)
  const json = Buffer.from(JSON.stringify({
    format: checkedManifest.format,
    version: checkedManifest.version,
    name: checkedManifest.name,
    appearance: checkedManifest.appearance,
    wallpaper: checkedManifest.wallpaper
  }), 'utf8')
  if (json.length > MANIFEST_LIMIT) fail('主题清单不能超过 64KiB')

  const folder = await privateBackgrounds()
  let sourceFile: { path: string; size: number } | null = null
  let archiveSource: { path: string; file: string } | null = null
  if (descriptor.type === 'builtin') {
    if (source !== null) fail('内置主题不能附带本机壁纸')
  } else {
    if (source === null) fail('嵌入主题缺少本机壁纸')
    sourceFile = await sourcePathForExport(source, folder, descriptor)
    archiveSource = { path: sourceFile.path, file: descriptor.file }
  }

  const outputPath = validateDestination(destination)
  await ensureDestinationUsable(outputPath)
  if (sourceFile && await resolvesTo(outputPath, sourceFile.path)) fail('导出目标不能覆盖正在使用的壁纸')
  await writeZip(outputPath, json, archiveSource)
}

function entryIsDirectory(entry: yauzl.Entry): boolean {
  if (entry.fileName.endsWith('/')) return true
  const creator = (entry.versionMadeBy >>> 8) & 0xff
  return creator === 0 && (entry.externalFileAttributes & 0x10) !== 0
}

function entryIsLink(entry: yauzl.Entry): boolean {
  const creator = (entry.versionMadeBy >>> 8) & 0xff
  if (creator !== 3) return false
  const mode = (entry.externalFileAttributes >>> 16) & 0xf000
  return mode === 0xa000 || (mode !== 0 && mode !== 0x4000 && mode !== 0x8000)
}

function validateZipName(name: string): void {
  if (name.length === 0 || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
    fail('ZIP 条目路径无效')
  }
  const parts = name.split('/')
  if (parts.some((part, index) => part === '.' || part === '..' || (part === '' && index !== parts.length - 1))) fail('ZIP 条目路径穿越')
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolvePromise, rejectPromise) => {
    yauzl.open(file, {
      lazyEntries: true,
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true,
      // Metadata enumeration emits `end` before we extract the entries. Keep
      // the random-access reader open until importThemeFile's finally block.
      autoClose: false
    }, (error, zip) => {
      if (error || !zip) rejectPromise(error || new Error('无法打开主题 ZIP'))
      else resolvePromise(zip)
    })
  })
}

async function listEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolvePromise, rejectPromise) => {
    const entries: yauzl.Entry[] = []
    const names = new Set<string>()
    let advertisedTotal = 0
    let settled = false

    const failWith = (error: unknown) => {
      if (settled) return
      settled = true
      zip.close()
      rejectPromise(error instanceof Error ? error : new Error(String(error)))
    }
    zip.once('error', failWith)
    zip.on('entry', entry => {
      if (settled) return
      try {
        validateZipName(entry.fileName)
        if (entry.isEncrypted() || (entry.generalPurposeBitFlag & 0x1) !== 0) fail('不支持加密 ZIP')
        if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) fail('ZIP 压缩方式不受支持')
        if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > IMPORT_LIMIT) fail('ZIP 条目大小无效')
        if (!Number.isSafeInteger(entry.compressedSize) || entry.compressedSize < 0) fail('ZIP 压缩大小无效')
        if (entryIsLink(entry)) fail('ZIP 不允许链接条目')

        const directory = entryIsDirectory(entry)
        if (directory) fail('ZIP 不允许目录条目')
        if (entries.length >= 2) fail('ZIP 最多只能包含两个文件条目')
        const normalized = entry.fileName.normalize('NFC').toLowerCase()
        if (names.has(normalized)) fail('ZIP 包含重复条目')
        names.add(normalized)
        if (entry.fileName !== MANIFEST_FILE && !EMBEDDED_FILES.has(entry.fileName)) fail('ZIP 包含未知文件')

        advertisedTotal += entry.uncompressedSize
        if (!Number.isSafeInteger(advertisedTotal) || advertisedTotal > IMPORT_LIMIT) fail('ZIP 解压后大小超出限制')
        entries.push(entry)
        zip.readEntry()
      } catch (error) {
        failWith(error)
      }
    })
    zip.once('end', () => {
      if (settled) return
      settled = true
      resolvePromise(entries)
    })
    zip.readEntry()
  })
}

function readZipEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, limit: number, totals: EntryTotals): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        rejectPromise(error || new Error('无法读取 ZIP 条目'))
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      void (async () => {
        try {
          for await (const chunk of stream) {
            const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            size += data.length
            totals.actual += data.length
            if (size > limit || totals.actual > IMPORT_LIMIT) {
              stream.destroy()
              throw new Error('ZIP 解压后大小超出限制')
            }
            chunks.push(data)
          }
          if (size !== entry.uncompressedSize) throw new Error('ZIP 条目大小校验失败')
          resolvePromise(Buffer.concat(chunks, size))
        } catch (readError) {
          rejectPromise(readError)
        }
      })()
    })
  })
}

async function copyZipEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, destination: string, limit: number, totals: EntryTotals): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    zip.openReadStream(entry, (error, input) => {
      if (error || !input) {
        rejectPromise(error || new Error('无法读取 ZIP 视频条目'))
        return
      }
      const output = createWriteStream(destination, { flags: 'wx' })
      let size = 0
      const header = Buffer.alloc(64)
      let headerSize = 0
      let outputFailure: Error | null = null
      let rejectOutputFailure: ((error: Error) => void) | null = null
      const outputFailurePromise = new Promise<never>((_, reject) => { rejectOutputFailure = reject })
      output.once('error', error => {
        outputFailure = error instanceof Error ? error : new Error(String(error))
        rejectOutputFailure?.(outputFailure)
      })
      void (async () => {
        try {
          for await (const chunk of input) {
            const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            if (outputFailure) throw outputFailure
            size += data.length
            totals.actual += data.length
            if (size > limit || totals.actual > IMPORT_LIMIT) {
              input.destroy()
              throw new Error('ZIP 视频大小超出限制')
            }
            if (headerSize < header.length) {
              const copied = Math.min(data.length, header.length - headerSize)
              data.copy(header, headerSize, 0, copied)
              headerSize += copied
            }
            if (!output.write(data)) await Promise.race([once(output, 'drain'), outputFailurePromise])
          }
          await Promise.race([
            new Promise<void>(resolveOutput => { output.end(() => resolveOutput()) }),
            outputFailurePromise
          ])
          if (outputFailure) throw outputFailure
          if (size !== entry.uncompressedSize) throw new Error('ZIP 条目大小校验失败')
          resolvePromise(header.subarray(0, headerSize))
        } catch (copyError) {
          output.destroy()
          await rm(destination, { force: true }).catch(() => undefined)
          rejectPromise(copyError)
        }
      })()
    })
  })
}

async function finishImportedFile(target: string, descriptor: EmbeddedDescriptor, name: string): Promise<{ wallpaper: CustomBackground; receipt: string }> {
  const info = await lstat(target)
  if (!info.isFile() || info.isSymbolicLink()) fail('导入结果不是受控文件')
  const receipt = randomUUID()
  importReceipts.set(receipt, {
    path: target,
    dev: info.dev,
    ino: info.ino,
    size: info.size,
    birthtimeMs: info.birthtimeMs
  })
  const src = pathToFileURL(target).href
  return {
    receipt,
    wallpaper: {
      name,
      src,
      kind: descriptor.kind,
      poster: descriptor.kind === 'image' ? src : FALLBACK_POSTER
    }
  }
}

export async function importThemeFile(file: string): Promise<{ manifest: ThemeManifest; wallpaper: CustomBackground | null; receipt: string | null }> {
  if (typeof file !== 'string' || file.length === 0 || file.includes('\0')) fail('导入路径无效')
  const input = resolve(file)
  const inputInfo = await lstat(input)
  if (!inputInfo.isFile() || inputInfo.isSymbolicLink()) fail('导入文件必须是普通文件')
  if (inputInfo.size <= 0 || inputInfo.size > IMPORT_LIMIT) fail('主题 ZIP 不能超过 301MiB')

  const zip = await openZip(input)
  try {
    const entries = await listEntries(zip)
    const files = entries.filter(entry => !entryIsDirectory(entry))
    const themeEntry = files.find(entry => entry.fileName === MANIFEST_FILE)
    if (!themeEntry) fail('ZIP 缺少 theme.json')
    if (themeEntry.uncompressedSize > MANIFEST_LIMIT) fail('theme.json 不能超过 64KiB')

    const totals: EntryTotals = { actual: 0 }
    const manifestBytes = await readZipEntry(zip, themeEntry, MANIFEST_LIMIT, totals)
    let rawManifest: unknown
    try {
      rawManifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes))
    } catch (error) {
      throw new Error(`theme.json 不是有效 JSON：${errorMessage(error)}`)
    }
    const manifest = parseAndCheckManifest(rawManifest)
    const descriptor = descriptorForManifest(manifest)
    const attachment = descriptor.type === 'embedded' ? files.find(entry => entry.fileName === descriptor.file) : undefined

    if (descriptor.type === 'builtin') {
      if (files.length !== 1) fail('内置主题不能包含壁纸附件')
      return { manifest, wallpaper: null, receipt: null }
    }
    if (!attachment || files.length !== 2) fail('嵌入主题的壁纸附件不完整')
    if (attachment.uncompressedSize <= 0) fail('壁纸附件为空')

    const folder = await privateBackgrounds()
    const id = randomUUID()
    const extension = descriptor.extension
    const temporary = join(folder, `.xinhai-theme-import-${id}.tmp`)
    const target = join(folder, `${id}.${descriptor.kind === 'image' ? 'png' : extension}`)
    let ownedTarget = false
    try {
      if (descriptor.kind === 'image') {
        if (attachment.uncompressedSize > IMAGE_LIMIT) fail('图片不能超过 30MB')
        const bytes = await readZipEntry(zip, attachment, IMAGE_LIMIT, totals)
        if (!imageHeaderMatches(extension, bytes.subarray(0, 64))) fail('图片格式与主题清单不一致')
        await writeFile(temporary, normalizeBackgroundImage(bytes), { flag: 'wx' })
      } else {
        if (attachment.uncompressedSize > VIDEO_LIMIT) fail('视频不能超过 300MB')
        const header = await copyZipEntry(zip, attachment, temporary, VIDEO_LIMIT, totals)
        if (!videoHeaderMatches(extension, header)) fail('视频格式与主题清单不一致')
      }
      await ensureAbsent(target)
      await rename(temporary, target)
      ownedTarget = true
      const result = await finishImportedFile(target, descriptor, descriptor.name)
      return { manifest, wallpaper: result.wallpaper, receipt: result.receipt }
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      if (ownedTarget) await rm(target, { force: true }).catch(() => undefined)
      throw error
    }
  } finally {
    if (zip.isOpen) zip.close()
  }
}

export async function finishThemeImport(receipt: string, keep: boolean): Promise<void> {
  if (typeof receipt !== 'string' || receipt.length === 0) fail('导入收据无效')
  const record = importReceipts.get(receipt)
  if (!record) fail('导入收据不存在或已处理')
  if (keep) {
    importReceipts.delete(receipt)
    return
  }

  const current = await lstat(record.path).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  })
  if (!current) {
    importReceipts.delete(receipt)
    return
  }
  if (!current.isFile() || current.isSymbolicLink() || current.dev !== record.dev || current.ino !== record.ino || current.size !== record.size || current.birthtimeMs !== record.birthtimeMs) {
    fail('导入收据指向的文件已发生变化')
  }
  await unlink(record.path)
  importReceipts.delete(receipt)
}
