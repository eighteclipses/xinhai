import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BackupPreview } from '../../../shared/backupArchiveTypes'
import { captureBackupClientState } from '../lib/backupClientState'
import '../styles/backup-settings.css'

const CONFIRMATION = '恢复备份'
const countLabels: Record<string, string> = {
  journals: '日记', focus_sessions: '专注记录', growth_events: '成长记录', todos: '待办',
  habits: '习惯', habit_logs: '习惯记录', events: '日程', review_cards: '复习卡片',
  review_logs: '复习记录', knowledge: '知识库文件', wallpapers: '壁纸', themes: '主题', music: '音乐'
}
const countOrder = ['journals', 'focus_sessions', 'growth_events', 'todos', 'habits', 'habit_logs', 'events', 'review_cards', 'review_logs', 'knowledge', 'wallpapers', 'themes', 'music'] as const

function errorText(error: unknown): string {
  if (!(error instanceof Error) || !error.message) return '备份操作未完成，请稍后重试。'
  const cleaned = error.message
    .replace(/^Error invoking remote method\s+['"][^'"]+['"]:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  return cleaned || '备份操作未完成，请稍后重试。'
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '未知大小'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`
}

function formatDate(value: number): string {
  if (!Number.isFinite(value)) return '日期未知'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

export default function BackupSettings() {
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<BackupPreview | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const ticketRef = useRef<string | null>(null)
  const mountedRef = useRef(false)
  const busyRef = useRef('')
  const busyOverlayRef = useRef<HTMLDivElement | null>(null)
  const inertBeforeBusyRef = useRef<string | null | undefined>(undefined)
  const focusBeforeBusyRef = useRef<HTMLElement | null>(null)

  async function run(key: string, work: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = key
    setBusy(key)
    setMessage('')
    try { await work() }
    catch (error) { setMessage(errorText(error)) }
    finally { busyRef.current = ''; setBusy('') }
  }

  async function exportFullBackup() {
    await run('export', async () => {
      const path = await window.api.backupExport(captureBackupClientState())
      setMessage(path ? `完整备份已导出：${path}` : '已取消导出，当前资料未改变。')
    })
  }

  async function prepareBackup() {
    await run('prepare', async () => {
      const previous = ticketRef.current
      if (previous) {
        await window.api.backupCancel(previous)
        ticketRef.current = null
        setPreview(null)
      }
      const next = await window.api.backupPrepare()
      if (!next) { setMessage('已取消选择备份文件。'); return }
      ticketRef.current = next.ticket
      setPreview(next)
      setConfirmation('')
      setMessage('备份已完成校验。确认内容后才会替换当前资料。')
    })
  }

  async function cancelPreview() {
    const ticket = ticketRef.current
    if (!ticket) { setPreview(null); setConfirmation(''); return }
    await run('cancel', async () => {
      await window.api.backupCancel(ticket)
      if (ticketRef.current === ticket) ticketRef.current = null
      setPreview(null)
      setConfirmation('')
      setMessage('已取消备份预览，当前资料未改变。')
    })
  }

  async function restoreBackup() {
    const ticket = ticketRef.current
    if (!ticket || !preview || confirmation !== CONFIRMATION) return
    await run('restore', async () => {
      const result = await window.api.backupRestore(ticket, confirmation, captureBackupClientState())
      if (!result) {
        setMessage('已取消保存当前资料的安全副本，恢复未执行；备份预览仍保留。')
        return
      }
      ticketRef.current = null
      setMessage(`恢复完成。当前资料安全副本：${result.safetyBackup}。正在重新载入应用…`)
      window.setTimeout(() => window.location.reload(), 250)
    })
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const ticket = ticketRef.current
      // React StrictMode immediately remounts this component during development.
      // Delay the cancellation until that probe has had a chance to remount.
      if (ticket) queueMicrotask(() => {
        if (mountedRef.current || ticketRef.current !== ticket) return
        void window.api.backupCancel(ticket).catch(() => undefined)
        if (ticketRef.current === ticket) ticketRef.current = null
      })
    }
  }, [])

  useEffect(() => {
    const root = document.getElementById('root')
    if (!busy || !root) return
    inertBeforeBusyRef.current = root.getAttribute('inert')
    focusBeforeBusyRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    root.setAttribute('inert', '')
    const focusOverlay = () => busyOverlayRef.current?.focus()
    const frame = window.requestAnimationFrame(focusOverlay)
    return () => {
      window.cancelAnimationFrame(frame)
      if (inertBeforeBusyRef.current === null) root.removeAttribute('inert')
      else if (inertBeforeBusyRef.current !== undefined) root.setAttribute('inert', inertBeforeBusyRef.current)
      inertBeforeBusyRef.current = undefined
      const previous = focusBeforeBusyRef.current
      focusBeforeBusyRef.current = null
      if (previous?.isConnected) window.requestAnimationFrame(() => previous.focus())
    }
  }, [busy])

  const counts = preview ? countOrder.map(key => [key, preview.counts[key]] as const).filter(([, value]) => Number.isFinite(value) && value > 0) : []
  const busyOverlay = busy ? <div ref={busyOverlayRef} className="backup-busy-layer" role="dialog" aria-modal="true" aria-labelledby="backup-busy-heading" aria-live="polite" aria-busy="true" tabIndex={-1} onKeyDown={event => { if (event.key === 'Tab') { event.preventDefault(); busyOverlayRef.current?.focus() } }}>
    <div className="backup-busy-card"><span className="backup-spinner" aria-hidden="true" /><strong id="backup-busy-heading">{busy === 'export' ? '正在生成完整备份…' : busy === 'prepare' ? '正在校验备份…' : busy === 'restore' ? '正在恢复资料…' : busy === 'cancel' ? '正在取消预览…' : '正在处理…'}</strong><small>请保持应用打开，不要重复点击。</small></div>
  </div> : null

  return <section className="glass backup-settings" aria-labelledby="backup-settings-heading">
    {busyOverlay && createPortal(busyOverlay, document.body)}
    <header className="backup-settings-heading">
      <div><span className="backup-eyebrow">LOCAL ARCHIVE · COMPLETE DATA</span><h2 id="backup-settings-heading">完整备份与恢复</h2></div>
      <span className="backup-local-badge">仅在本机处理</span>
    </header>
    <p className="backup-intro">完整备份包含当前知识库、导入媒体、学习记录和本机草稿，文件始终由你选择位置保存。API Key、登录凭据和局域网同步配对信息不会写入备份。</p>
    <div className="backup-scope-grid">
      <div><strong>会备份</strong><span>知识库完整文件树 · 壁纸与音乐 · 日记、专注、待办、习惯、复习卡片 · 本机草稿</span></div>
      <div><strong>不会备份</strong><span>模型密钥与地址 · 网易云登录 · 局域网同步设备与配对密钥</span></div>
    </div>
    <div className="backup-actions">
      <button type="button" className="btn primary" disabled={!!busy} onClick={() => void exportFullBackup()}>导出完整备份</button>
      <button type="button" className="btn" disabled={!!busy} onClick={() => void prepareBackup()}>选择备份并预览</button>
    </div>
    <p className="backup-fast-export-note">下方 JSON / CSV 是快速导出，便于查看或迁移部分记录；它们不是包含知识库和媒体的完整备份。</p>

    {preview && <div className="backup-preview" aria-labelledby="backup-preview-heading">
      <div className="backup-preview-heading"><div><span className="backup-eyebrow">READY TO REVIEW</span><h3 id="backup-preview-heading">备份预览</h3></div><span className="backup-preview-version">v{preview.appVersion}</span></div>
      <dl className="backup-preview-facts"><div><dt>创建时间</dt><dd>{formatDate(preview.createdAt)}</dd></div><div><dt>文件数量</dt><dd>{preview.files.toLocaleString('zh-CN')}</dd></div><div><dt>展开后大小</dt><dd>{formatBytes(preview.bytes)}</dd></div></dl>
      <div className="backup-counts" aria-label="备份内容计数">{counts.length ? counts.map(([key, value]) => <span key={key}><b>{Number(value).toLocaleString('zh-CN')}</b>{countLabels[key] || key}</span>) : <span>未提供内容计数</span>}</div>
      {preview.warnings.length > 0 && <div className="backup-warnings" role="note"><strong>恢复前请留意</strong><ul>{preview.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>}
      <p className="backup-restore-risk">恢复会替换当前学习资料。应用会先让你选择保存当前资料的安全副本；如果取消安全副本，恢复不会执行，当前预览会保留。</p>
      <label className="backup-confirm-label">确认恢复<input value={confirmation} placeholder={`请输入“${CONFIRMATION}”`} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></label>
      <div className="backup-preview-actions"><button type="button" className="btn primary" disabled={!!busy || confirmation !== CONFIRMATION} onClick={() => void restoreBackup()}>输入“恢复备份”后恢复</button><button type="button" className="btn" disabled={!!busy} onClick={() => void cancelPreview()}>取消预览</button></div>
    </div>}
    {message && <p className="backup-message" role="status">{message}</p>}
  </section>
}
