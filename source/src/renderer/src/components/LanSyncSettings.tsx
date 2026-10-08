import { useEffect, useRef, useState } from 'react'
import type { SyncStatus } from '../../../shared/lanSyncTypes'

const stateLabels: Record<SyncStatus['state'], string> = {
  off: '同步已关闭', waiting: '等待连接', syncing: '正在同步',
  online: '已连接', offline: '设备离线', error: '同步遇到问题'
}

const tableLabels: Record<string, string> = {
  journals: '学习日记', focus_sessions: '专注记录', todos: '学习任务',
  habits: '习惯', habit_logs: '习惯记录', events: '日程',
  review_cards: '复习卡片', review_logs: '复习记录', growth_events: '成长记录'
}
const fieldLabels: Record<string, string> = {
  content: '正文', summary: '摘要', title: '标题', name: '名称',
  note: '备注', notes: '备注', question: '问题', answer: '答案', reason: '说明'
}

function formatTime(value: number | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未同步'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作未完成，请重试。'
}

export default function LanSyncSettings() {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [pollError, setPollError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [pairCode, setPairCode] = useState<{ code: string; expiresAt: number } | null>(null)
  const [inputCode, setInputCode] = useState('')
  const [now, setNow] = useState(Date.now())
  const [removeId, setRemoveId] = useState<string | null>(null)
  const mounted = useRef(false)
  const locked = useRef(false)
  const polling = useRef(false)
  const revision = useRef(0)

  async function refresh() {
    if (locked.current || polling.current) return
    polling.current = true
    const request = ++revision.current
    try {
      if (typeof window.api.syncStatus !== 'function') throw new Error('此版本尚未提供局域网同步，请更新应用后重试。')
      const next = await window.api.syncStatus()
      if (mounted.current && request === revision.current) {
        setStatus(next)
        setPollError('')
      }
    } catch (error) {
      if (mounted.current && request === revision.current) setPollError(errorMessage(error))
    } finally {
      polling.current = false
    }
  }

  useEffect(() => {
    mounted.current = true
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 3000)
    return () => {
      mounted.current = false
      ++revision.current
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!pairCode) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [pairCode])

  useEffect(() => {
    if (status && !status.enabled) setPairCode(null)
  }, [status?.enabled])

  async function run(key: string, work: () => Promise<SyncStatus | void>, success = '') {
    if (locked.current) return
    locked.current = true
    ++revision.current // A read started before this action must not overwrite its result.
    setBusy(key)
    setActionError('')
    setNotice('')
    try {
      const next = await work()
      if (!mounted.current) return
      if (next) { setStatus(next); setPollError('') }
      if (success) setNotice(success)
    } catch (error) {
      if (mounted.current) setActionError(errorMessage(error))
    } finally {
      locked.current = false
      if (mounted.current) setBusy('')
    }
  }

  const secondsLeft = pairCode ? Math.max(0, Math.ceil((pairCode.expiresAt - now) / 1000)) : 0
  const disabled = Boolean(busy)
  const host = status?.role === 'host'

  return (
    <section className="glass lan-sync" aria-labelledby="lan-sync-heading">
      <header className="lan-sync-header">
        <div>
          <span className="lan-sync-kicker">LOCAL NETWORK · STUDY DATA</span>
          <h2 id="lan-sync-heading">局域网学习同步</h2>
        </div>
        <span className="lan-sync-state" data-state={pollError ? 'error' : status?.state ?? 'waiting'}>
          <i aria-hidden="true" />{pollError ? '状态暂不可用' : status ? stateLabels[status.state] : '正在读取状态…'}
        </span>
      </header>

      <div className="lan-sync-scope">
        <p>同步已完成的学习数据。壁纸、布局、API 配置、音乐文件与播放设置保留在各自设备；Markdown 知识库单独管理，不包含在本次同步中。</p>
        <p>请让两端应用保持打开，并连接同一局域网。离线时可继续学习，重新连接后会自动重试并合并数据。</p>
      </div>

      {pollError && <div className="lan-sync-feedback" role="alert">
        <p>{pollError}{status && ' 下方显示上次读取的状态。'}</p>
        <button type="button" className="btn" disabled={disabled} onClick={() => void refresh()}><span>重新读取状态</span></button>
      </div>}

      {status && <>
        <div className="lan-sync-device">
          <div><h3>本机 · {host ? '主机' : '客户端'}</h3><strong>{status.deviceName}</strong><small>设备标识：{status.deviceId}</small></div>
          <button type="button" className="lan-sync-switch" role="switch" aria-checked={status.enabled}
            aria-label="启用局域网同步" disabled={disabled}
            onClick={() => void run('enable', () => window.api.syncEnable(!status.enabled))}>
            <span>{busy === 'enable' ? '正在设置…' : '启用局域网同步'}</span><i aria-hidden="true"><b /></i>
          </button>
        </div>

        <div className="lan-sync-columns">
          <div className="lan-sync-block">
            <h3>{host ? '配对新设备' : '连接主机'}</h3>
            {host ? <>
              <p>开启同步后生成一次性配对码，在另一台设备上粘贴完整内容并点击配对。配对码有效期为 5 分钟。</p>
              <button type="button" className="btn" disabled={disabled || !status.enabled}
                onClick={() => void run('code', async () => {
                  const code = await window.api.syncPairCode()
                  if (mounted.current) setPairCode(code)
                })}><span>{busy === 'code' ? '正在生成…' : pairCode ? '重新生成配对码' : '生成一次性配对码'}</span></button>
              {!status.enabled && <p className="lan-sync-hint">请先开启上方的局域网同步。</p>}
              {pairCode && <div className="lan-sync-code">
                <label htmlFor="lan-sync-generated-code">完整配对码</label>
                <textarea id="lan-sync-generated-code" readOnly value={pairCode.code} rows={4} spellCheck={false}
                  onFocus={(event) => event.currentTarget.select()} aria-describedby="lan-sync-expiry" />
                <div className="lan-sync-actions">
                  <span id="lan-sync-expiry">{secondsLeft ? `${Math.floor(secondsLeft / 60)} 分 ${String(secondsLeft % 60).padStart(2, '0')} 秒后过期 · 仅可使用一次` : '配对码已过期，请重新生成'}</span>
                  <button type="button" className="btn" disabled={disabled || !secondsLeft}
                    onClick={() => void run('copy', async () => {
                      if (!navigator.clipboard?.writeText) throw new Error('此设备不支持直接复制，请选中上方完整配对码后手动复制。')
                      try { await navigator.clipboard.writeText(pairCode.code) }
                      catch { throw new Error('复制未完成，请选中上方完整配对码后手动复制。') }
                    }, '已复制完整配对码。')}><span>复制配对码</span></button>
                </div>
              </div>}
            </> : <>
              <p>在主机的「局域网学习同步」中生成配对码，再将完整内容粘贴到这里。</p>
              <label className="lan-sync-code" htmlFor="lan-sync-input-code">主机配对码
                <textarea id="lan-sync-input-code" value={inputCode} onChange={(event) => setInputCode(event.target.value)}
                  placeholder="粘贴完整配对码" rows={4} spellCheck={false} autoCapitalize="off" autoCorrect="off" disabled={disabled} />
              </label>
              <button type="button" className="btn" disabled={disabled || !inputCode.trim()}
                onClick={() => void run('pair', async () => {
                  const next = await window.api.syncPair(inputCode.trim())
                  if (mounted.current) setInputCode('')
                  return next
                })}><span>{busy === 'pair' ? '正在配对…' : '配对并连接'}</span></button>
            </>}
          </div>

          <div className="lan-sync-block">
            <h3>连接状态</h3>
            <p className="lan-sync-message">{status.message || stateLabels[status.state]}</p>
            <dl className="lan-sync-facts">
              <div><dt>最近同步</dt><dd>{formatTime(status.lastSync)}</dd></div>
              <div><dt>{host ? '主机局域网地址' : '连接地址'}</dt><dd>{status.addresses.length
                ? status.addresses.map((address) => <code key={address}>{address}</code>)
                : status.enabled ? '暂无可用地址，请检查局域网连接。' : '启用并连接后显示'}</dd></div>
            </dl>
            <button type="button" className="btn" disabled={disabled || !status.enabled || !status.peers.length || status.state === 'syncing'}
              onClick={() => void run('sync', () => window.api.syncNow())}><span>{busy === 'sync' || status.state === 'syncing' ? '正在同步…' : host ? '检查连接' : '立即同步'}</span></button>
            {host && <p className="lan-sync-hint">平板打开应用时约每 5 秒检查一次，两端的新增记录会自动同步。</p>}
          </div>
        </div>

        <div className="lan-sync-block lan-sync-peers">
          <h3>已配对设备 <span>· {status.peers.length}</span></h3>
          {status.peers.length ? <ul>{status.peers.map((peer) => <li key={peer.id}>
            <div className="lan-sync-peer-info"><strong>{peer.name}</strong><small>设备标识：{peer.id}</small><small>最近同步：{formatTime(peer.lastSync)}</small>
              {peer.error && <p className="lan-sync-peer-error">{peer.error}</p>}
            </div>
            {removeId === peer.id ? <div className="lan-sync-remove">
              <p>解除与「{peer.name}」的配对？之后连接需要重新配对。</p>
              <div className="lan-sync-actions">
                <button type="button" className="btn" disabled={disabled} onClick={() => void run(`remove:${peer.id}`, async () => {
                  const next = await window.api.syncUnpair(peer.id)
                  if (mounted.current) setRemoveId(null)
                  return next
                }, '已解除配对。')}><span>{busy === `remove:${peer.id}` ? '正在解除…' : '确认解除'}</span></button>
                <button type="button" className="btn" disabled={disabled} onClick={() => setRemoveId(null)}><span>取消</span></button>
              </div>
            </div> : <button type="button" className="btn" disabled={disabled} onClick={() => setRemoveId(peer.id)} aria-label={`解除与 ${peer.name} 的配对`}><span>解除配对</span></button>}
          </li>)}</ul> : <p>尚未配对设备。完成上方配对后，两端的学习数据会在连接时合并。</p>}
        </div>

        {status.conflicts.length > 0 && <div className="lan-sync-block lan-sync-conflicts">
          <h3>待确认的文本冲突 · {status.conflicts.length}</h3>
          <p>同一字段存在两个版本。展开查看完整文本，再保留当前采用的内容，或恢复另一版本；每次只处理这一条冲突的字段。</p>
          {status.conflicts.map((conflict) => <details key={conflict.id}>
            <summary>{tableLabels[conflict.table] || conflict.table} · {fieldLabels[conflict.field] || conflict.field}<small>冲突标识：{conflict.id}</small></summary>
            <div className="lan-sync-versions">
              <div><h4>当前采用的内容</h4><pre>{conflict.winner || '（空文本）'}</pre>
                <button type="button" className="btn" disabled={disabled} onClick={() => void run(`keep:${conflict.id}`, () => window.api.syncResolve(conflict.id, false), '已保留该字段当前采用的内容。')}><span>{busy === `keep:${conflict.id}` ? '正在保存…' : '保留当前内容'}</span></button>
              </div>
              <div><h4>另一版本的内容</h4><pre>{conflict.other || '（空文本）'}</pre>
                <button type="button" className="btn" disabled={disabled} onClick={() => void run(`restore:${conflict.id}`, () => window.api.syncResolve(conflict.id, true), '已将该字段恢复为另一版本。')}><span>{busy === `restore:${conflict.id}` ? '正在恢复…' : '将此字段恢复为另一版本'}</span></button>
              </div>
            </div>
          </details>)}
        </div>}

        <footer className="lan-sync-backup">
          <div><h3>配对前备份</h3><p>{status.hasBackup ? '已保留配对前的数据副本，可导出留存。' : '暂无配对前备份。配对后可在这里查看备份是否已生成。'}</p></div>
          <button type="button" className="btn" disabled={disabled || !status.hasBackup} onClick={() => void run('backup', async () => {
            const content = await window.api.syncBackup()
            const path = await window.api.saveFile('xinhai-prepair-backup.json', content)
            if (mounted.current) setNotice(path ? `配对前备份已导出：${path}` : '已取消备份导出。')
          })}><span>{busy === 'backup' ? '正在导出…' : '导出配对前备份'}</span></button>
        </footer>
      </>}
      {actionError && <p className="lan-sync-feedback" role="alert">{actionError}</p>}
      <div className="lan-sync-notice" role="status" aria-live="polite">{notice}</div>
    </section>
  )
}
