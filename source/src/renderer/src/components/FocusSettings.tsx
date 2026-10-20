import { useEffect, useState } from 'react'
import { useApp } from '../store/app'
import type { FocusReminderAccess, FocusReminderCapability } from '../../../shared/focusReminderCapability'

export default function FocusSettings() {
  const settings = useApp(state => state.settings), setSettings = useApp(state => state.setSettings)
  const [capability, setCapability] = useState<FocusReminderCapability | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    const refresh = () => {
      if (!window.api.focusReminderStatus) return
      void window.api.focusReminderStatus().then(value => { if (live) { setCapability(value); setError('') } }).catch(() => { if (live) setError('暂时无法读取系统提醒状态，可以稍后重试。') })
    }
    refresh()
    window.addEventListener('focus', refresh); window.addEventListener('xinhai-resume', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { live = false; window.removeEventListener('focus', refresh); window.removeEventListener('xinhai-resume', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  async function request(access: FocusReminderAccess) {
    try { setError(''); await window.api.focusReminderRequestAccess(access) } catch { setError('没有打开系统设置，请在本应用的系统权限页面检查提醒权限。') }
  }
  return <section className="glass focus-settings" id="settings-focus" tabIndex={-1} style={{ padding: '22px 26px' }} aria-labelledby="focus-settings-title">
    <h2 id="focus-settings-title" style={{ fontSize: 15, fontWeight: 500, color: 'var(--cyan)', margin: '0 0 18px' }}>专注与音符</h2>
    <label style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13, marginBottom: 16 }}>
      后台计时到点后
      <select aria-label="后台计时到点后" value={settings.focusBackgroundBehavior} onChange={event => void setSettings({ focusBackgroundBehavior: event.target.value as 'wait' | 'continue' })}>
        <option value="wait">停住等待，回来先看结算</option><option value="continue">继续休息与下一阶段</option>
      </select>
    </label>
    <p className="scene-hint">{settings.focusBackgroundBehavior === 'wait' ? '软件在后台时，倒计时结束就暂停。回到软件后再开始休息，等待的时间不算专注。' : '软件在后台时，到点自动进入休息，再按计划开始下一段专注。休息不算专注；音符动画会等你回来。异常退出后会先询问如何恢复。'}</p>
    <label style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13, marginTop: 19, marginBottom: 12 }}>
      学习音符演出
      <select aria-label="学习音符演出" value={settings.focusRewardPresentation} onChange={event => void setSettings({ focusRewardPresentation: event.target.value as 'round' | 'batch' })}>
        <option value="batch">攒起来，在结束本次时集中收下</option><option value="round">每段保存后收下本段新增音符</option>
      </select>
    </label>
    <p className="scene-hint">{settings.focusRewardPresentation === 'batch' ? '先把音符攒起来，结束本次专注时一起播放领取动画，也可以随时点“领取音符”。' : '每段专注结束并保存后，播放本段新增音符的领取动画。'}</p>
    <p className="scene-hint">专注每满 25 分钟获得 1 个学习音符。不足部分会累计到下次，例如 15 分钟＋10 分钟也能获得 1 个。暂停和休息不计入。原有学习记录和成长不会重算。</p>
    <p className="scene-hint">运行时点计时面板上的小铅笔，可拖动、调整大小或恢复默认位置。</p>
    {capability?.platform === 'android' && <div style={{ borderTop: '1px solid var(--theme-line)', paddingTop: 16, marginTop: 18 }}>
      <p className="scene-hint" role="status">通知提醒：{capability.notificationsGranted ? '已开启' : '尚未开启'}<br />后台准时提醒：{capability.exactAlarmsGranted ? '已开启' : '需要允许闹钟和提醒'}</p>
      {(!capability.notificationsGranted || !capability.exactAlarmsGranted) && <p className="scene-hint">系统普通提醒可能延后。允许通知和“闹钟和提醒”后，应用才能按本段结束时间发出后台提醒；不影响前台计时。</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {!capability.notificationsGranted && <button className="btn" onClick={() => void request('notifications')}>开启通知提醒</button>}
        {!capability.exactAlarmsGranted && capability.canRequestExactAlarms && <button className="btn" onClick={() => void request('exact-alarm')}>允许后台准时提醒</button>}
        <button className="btn" onClick={() => void request('background')}>检查后台运行限制</button>
      </div>
      <p className="scene-hint">如果退到后台仍无提醒，请打开本应用的耗电管理，允许后台活动。部分系统称为“完全允许后台行为”；仅需调整心海共学，后台耗电可能相应增加。</p>
      <p className="scene-hint">提醒声音遵循系统音量、通知频道与免打扰设置。</p>
    </div>}
    {error && <p role="status" className="scene-hint">{error}</p>}
  </section>
}
