import { useEffect, useMemo, useState } from 'react'
import noticesText from 'virtual:xinhai-notices'

type PackageNotice = {
  name: string
  version: string
  license: string
  text: string
}

type AdditionalNotice = {
  name: string
  text: string
}

type Notices = {
  packages: PackageNotice[]
  additional: AdditionalNotice[]
  runtimeCredits?: { entries: { id: string; name: string }[] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readText(value: Record<string, unknown>, field: string, path: string): string {
  const text = value[field]
  if (typeof text !== 'string') throw new Error(`${path}.${field} must be text`)
  return text
}

export function parseNotices(json: string): Notices {
  const value: unknown = JSON.parse(json)
  if (!isRecord(value) || !Array.isArray(value.packages) || !Array.isArray(value.additional)) {
    throw new Error('Invalid notices document')
  }
  const hasRuntime = Object.hasOwn(value, 'runtimeCredits')
  if ((value.scope === 'desktop-renderer' && !hasRuntime) || (value.scope === 'mobile' && hasRuntime)) throw Error('Wrong platform notice scope')
  if (hasRuntime && (!isRecord(value.runtimeCredits) || !Array.isArray(value.runtimeCredits.entries) || value.runtimeCredits.entries.length === 0 || value.runtimeCredits.entries.length > 9999)) throw Error('Invalid runtime license index')
  const runtimeIds = new Set<string>()

  return {
    ...(isRecord(value.runtimeCredits) && Array.isArray(value.runtimeCredits.entries) ? {
      runtimeCredits: { entries: value.runtimeCredits.entries.map((entry, index) => {
        if (!isRecord(entry)) throw Error('Invalid runtime license entry')
        const id = readText(entry, 'id', `runtimeCredits[${index}]`)
        if (!/^chromium-\d{4}$/.test(id) || runtimeIds.has(id)) throw Error('Invalid runtime license identifier')
        runtimeIds.add(id)
        return { id, name: readText(entry, 'name', `runtimeCredits[${index}]`) }
      }) }
    } : {}),
    packages: value.packages.map((item, index) => {
      const path = `packages[${index}]`
      if (!isRecord(item)) throw new Error(`${path} must be an object`)
      return {
        name: readText(item, 'name', path),
        version: readText(item, 'version', path),
        license: readText(item, 'license', path),
        text: readText(item, 'text', path),
      }
    }),
    additional: value.additional.map((item, index) => {
      const path = `additional[${index}]`
      if (!isRecord(item)) throw new Error(`${path} must be an object`)
      return {
        name: readText(item, 'name', path),
        text: readText(item, 'text', path),
      }
    }),
  }
}

function LicenseDetails({ summary, text = '', documentId }: { summary: string; text?: string; documentId?: string }) {
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!open || !documentId || body !== null) return
    let active = true
    setLoading(true); setError('')
    Promise.resolve().then(() => {
      if (!window.api.readRuntimeNotice) throw Error('当前平台无法读取桌面运行时许可')
      return window.api.readRuntimeNotice(documentId)
    }).then(value => { if (active) setBody(value) }, reason => {
      if (active) setError(reason instanceof Error ? reason.message : '读取许可未完成')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, documentId, attempt, body])

  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{summary}</summary>
      {open && loading && <p role="status">正在读取本机许可…</p>}
      {open && error && <p role="alert">{error} <button onClick={() => setAttempt(value => value + 1)}>重试</button></p>}
      {open && !loading && !error && (
        <pre
          style={{
            maxHeight: 'min(28vh, 240px)',
            overflow: 'auto',
            margin: '8px 0 12px',
            padding: '10px 12px',
            border: '1px solid color-mix(in srgb, var(--theme-light) 14%, transparent)',
            background: 'color-mix(in srgb, var(--theme-panel) 68%, transparent)',
            color: 'var(--ink-dim)',
            font: '13px/1.65 var(--font-en, monospace)',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {documentId ? body : text}
        </pre>
      )}
    </details>
  )
}

export default function OpenSourceLicenses() {
  const [query, setQuery] = useState('')
  const [visibleRuntime, setVisibleRuntime] = useState(20)
  useEffect(() => setVisibleRuntime(20), [query])
  const notices = useMemo(() => {
    try {
      return { value: parseNotices(noticesText), error: '' }
    } catch {
      return { value: null, error: '许可清单暂时无法读取。' }
    }
  }, [])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const packages = notices.value?.packages.filter((item) =>
    `${item.name} ${item.version} ${item.license}`.toLocaleLowerCase().includes(normalizedQuery),
  ) ?? []
  const additional = notices.value?.additional.filter((item) =>
    item.name.toLocaleLowerCase().includes(normalizedQuery),
  ) ?? []
  const runtime = notices.value?.runtimeCredits?.entries.filter(item => item.name.toLocaleLowerCase().includes(normalizedQuery)) ?? []
  const total = (notices.value?.packages.length ?? 0) + (notices.value?.additional.length ?? 0) + (notices.value?.runtimeCredits?.entries.length ?? 0)

  return (
    <details className="asset-credits">
      <summary>开源许可与附加声明（{total}）</summary>
      <div style={{ marginTop: 12 }}>
        <input
          type="search"
          aria-label="搜索许可名称"
          placeholder="搜索名称、版本或许可类型"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', marginBottom: 10 }}
        />
        {notices.error ? (
          <p role="status">{notices.error}</p>
        ) : (
          <div
            aria-label="许可条目"
            style={{ maxHeight: '52vh', overflowY: 'auto', overscrollBehavior: 'contain' }}
          >
            {packages.map((item, index) => (
              <LicenseDetails
                key={`package-${item.name}-${item.version}-${index}`}
                summary={`${item.name} · ${item.version} · ${item.license}`}
                text={item.text}
              />
            ))}
            {additional.map((item, index) => (
              <LicenseDetails key={`additional-${item.name}-${index}`} summary={item.name} text={item.text} />
            ))}
            {runtime.length > 0 && <details className="runtime-credits" key={normalizedQuery ? 'search' : 'all'} open={Boolean(normalizedQuery)}>
              <summary>Chromium 与运行时组件（{runtime.length}）</summary>
              <p>许可全文保存在本机，展开条目即可离线阅读。</p>
              {runtime.slice(0, visibleRuntime).map(item => <LicenseDetails key={item.id} summary={item.name} documentId={item.id} />)}
              {runtime.length > visibleRuntime && <button onClick={() => setVisibleRuntime(value => value + 20)}>显示更多（剩余 {runtime.length - visibleRuntime} 项）</button>}
            </details>}
            {packages.length + additional.length + runtime.length === 0 && <p>没有匹配的许可条目。</p>}
          </div>
        )}
      </div>
    </details>
  )
}
