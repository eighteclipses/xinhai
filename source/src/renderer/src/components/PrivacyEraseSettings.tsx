import { useEffect, useRef, useState } from 'react'
import { ERASURE_CONFIRMATION, type ErasurePreview } from '../../../shared/privacyErasure'
import '../styles/privacy-erasure.css'

export default function PrivacyEraseSettings() {
  const dialog = useRef<HTMLDialogElement>(null)
  const lock = useRef(false)
  const live = useRef(true)
  const [preview, setPreview] = useState<ErasurePreview | null>(null)
  const [text, setText] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { live.current = true; return () => { live.current = false; if (!lock.current) void window.api.privacyCancel().catch(() => {}) } }, [])

  async function prepare() {
    if (lock.current) return
    lock.current = true; setBusy(true); setMessage('')
    try {
      const value = await window.api.privacyPrepare()
      if (!live.current) { await window.api.privacyCancel(); return }
      setPreview(value); setText(''); setAcknowledged(false); dialog.current?.showModal()
    } catch (e) { setMessage(e instanceof Error ? e.message : '清理范围暂时无法读取，请重试。') }
    finally { lock.current = false; setBusy(false) }
  }
  async function cancel() {
    if (lock.current) return
    await window.api.privacyCancel().catch(() => {})
    dialog.current?.close(); setPreview(null); setText(''); setMessage('已取消，当前资料未改变。')
  }
  async function erase() {
    if (lock.current || !preview || text !== ERASURE_CONFIRMATION || !acknowledged) return
    lock.current = true; setBusy(true); setMessage('正在提交清理请求，请保持应用打开…')
    try {
      await window.api.privacyErase(preview.ticket, text)
      setMessage(preview.platform === 'windows' ? '清理请求已确认。应用将重新启动，在打开学习库前完成清理。' : '系统已接受请求，应用将关闭。完成后请重新打开应用。')
      // Keep the old UI blocked until the process exits; do not resume writes.
    } catch (e) {
      setMessage((e instanceof Error ? e.message : '清理请求未完成') + '。尚未确认清理完成，请查看提示后重试。')
      lock.current = false; setBusy(false)
    }
  }
  return <section className="glass privacy-erasure" aria-labelledby="privacy-erasure-heading">
    <h2 id="privacy-erasure-heading">清空本应用资料</h2>
    <p>适用于不再保留本机应用资料的情况。与“重新开始成长”不同，这里不会保留用于撤销的快照。</p>
    <p>需要保留资料时，请先用上方“完整备份与恢复”导出备份，再回到这里操作。</p>
    <button type="button" className="btn" disabled={busy} onClick={() => void prepare()}>查看清理范围</button>
    {!preview && message && <p role="status">{message}</p>}
    <dialog ref={dialog} className="privacy-erasure-dialog" aria-labelledby="privacy-erasure-dialog-heading" onCancel={e => { e.preventDefault(); void cancel() }}>
      <h2 id="privacy-erasure-dialog-heading">确认清空本应用资料</h2>
      <p><strong>会删除：</strong>本应用保存的学习记录、撤销快照、主题与设置、草稿、导入媒体副本、模型密钥、登录状态、配对信息，以及应用资料目录内的知识库和缓存。</p>
      <p><strong>会保留：</strong>应用私有存储范围之外的知识库、原始壁纸和音乐、已导出的备份/主题包、另一台设备及第三方服务已保存的数据。取消配对不会替你删除对端资料。</p>
      {preview && <><p className="privacy-erasure-path">本次清理位置：<code>{preview.location}</code></p>{preview.preservedKnowledge && <p className="privacy-erasure-path">{preview.platform === 'windows' ? '此独立知识库会保留：' : '已授权的外部知识库（将撤销目录授权）：'}<code>{preview.preservedKnowledge}</code></p>}
      <p>{preview.platform === 'windows' ? '确认后应用将退出并重新启动，再清理资料。若清理失败，会停止打开学习库并提示重试。' : 'Android 会清除应用私有内部及私有外部存储，并撤销目录授权。即使你另行存放过文件，只要位于本应用私有外部存储，也会被清除。应用会关闭，完成后请重新打开；安装的软件本身会保留。'}</p></>}
      <p>这是删除应用文件，不保证存储介质上的内容无法被专业恢复；系统日志、系统/网盘备份需在相应位置单独管理。</p>
      <label className="privacy-erasure-ack"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={e => setAcknowledged(e.target.checked)} />我已确认范围，已自行备份或不需要这些资料，知道此操作无法在应用内撤销。</label>
      <label className="privacy-erasure-label">输入“{ERASURE_CONFIRMATION}”<input aria-label="永久清理确认文字" value={text} disabled={busy} onChange={e => setText(e.target.value)} autoComplete="off" /></label>
      <div className="privacy-erasure-actions"><button type="button" className="btn" disabled={busy} onClick={() => void cancel()}>取消，保留资料</button><button type="button" className="btn danger" disabled={busy || !acknowledged || text !== ERASURE_CONFIRMATION} onClick={() => void erase()}>确认清空并关闭应用</button></div>
      {message && <p role="status" aria-live="polite">{message}</p>}
    </dialog>
  </section>
}
