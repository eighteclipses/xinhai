import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export function createRuntimeNoticeReader(directory: string) {
  // Index loading is deferred until the first explicit license request.
  let index: Promise<Map<string, { sha256: string; bytes: number }>> | undefined
  async function entries() {
    if (!index) index = readFile(join(directory, 'index.json'), 'utf8').then(raw => {
      const document = JSON.parse(raw)
      if (!Array.isArray(document.entries) || document.entries.length > 9999) throw Error('运行时许可索引无效')
      const result = new Map<string, { sha256: string; bytes: number }>()
      for (const entry of document.entries) {
        if (!/^chromium-\d{4}$/.test(entry.id) || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > 4 * 1024 * 1024 || result.has(entry.id)) throw Error('运行时许可索引无效')
        result.set(entry.id, { sha256: entry.sha256, bytes: entry.bytes })
      }
      return result
    }).catch(error => { index = undefined; throw error })
    return index
  }
  return async (id: unknown): Promise<string> => {
    if (typeof id !== 'string' || !/^chromium-\d{4}$/.test(id)) throw Error('许可条目无效')
    const entry = (await entries()).get(id)
    if (!entry) throw Error('未找到该许可条目')
    const file = join(directory, id + '.txt')
    if ((await stat(file)).size !== entry.bytes) throw Error('许可文件长度不符，请重新安装完整应用')
    const data = await readFile(file)
    if (data.length !== entry.bytes || createHash('sha256').update(data).digest('hex') !== entry.sha256) throw Error('许可文件校验失败，请重新安装完整应用')
    return data.toString('utf8')
  }
}
