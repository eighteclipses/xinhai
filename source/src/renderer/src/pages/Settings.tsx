import Toggle from '../components/Toggle'
import { COMMERCIAL_EDITION } from '../../../shared/edition'
import credits from '../../../shared/credits.json'
import DataReset from '../components/DataReset'
import BackupSettings from '../components/BackupSettings'
import LanSyncSettings from '../components/LanSyncSettings'
import ModelSettings from '../components/ModelSettings'
import { useState } from 'react'
import { useApp } from '../store/app'

export default function Settings() {
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const [saved, setSaved] = useState('')

  async function doExport(kind: 'json' | 'csv') {
    const content = kind === 'json' ? await window.api.exportJson() : await window.api.exportCsv()
    const name = kind === 'json' ? 'xinhai-backup.json' : 'xinhai-growth.csv'
    const path = await window.api.saveFile(name, content)
    setSaved(path ? `已导出：${path}` : '已取消导出')
  }

  return (
    <div style={{ position: 'relative', zIndex: 2, height: '100%', padding: '64px 56px 90px', overflowY: 'auto' }}>
      <div className="page-title" style={{ marginBottom: 24 }}>
        <span className="en">SYSTEM</span>
        <span className="zh">系统设置</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'start', gap: 28, maxWidth: 1080 }}>
        <LanSyncSettings />
        <ModelSettings />

        <BackupSettings />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div className="glass" style={{ padding: '22px 26px' }}>
            <div style={{ fontSize: 14, letterSpacing: '0.3em', color: 'var(--cyan)', marginBottom: 8 }}>声音与体验</div>
            <p className="scene-hint">背景、日期、随身听和演出预览已移到自定义。</p><button className="btn" onClick={()=>useApp.getState().go('customize')}>打开自定义 ↗</button>
            {!COMMERCIAL_EDITION&&<Toggle on={settings.voiceEnabled} onChange={(v) => setSettings({ voiceEnabled: v })} label="本地角色语音" desc="可选本地语音资源；源码不附音频，默认关闭" />}
            <Toggle on={settings.autoPlayMusic} onChange={(v) => setSettings({ autoPlayMusic: v })} label="打开应用自动播放音乐" />
            {!COMMERCIAL_EDITION&&<label style={{ fontSize: 14, color: 'var(--ink-dim)', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
              切换场景语音间隔（秒，0=每次都播）
              <input
                type="number"
                min={0}
                max={3600}
                value={settings.voiceSwitchCooldown}
                onChange={(e) => setSettings({ voiceSwitchCooldown: Math.max(0, Number(e.target.value) || 0) })}
                style={{ width: 90 }}
              />
            </label>}
            <label style={{ fontSize: 14, color: 'var(--ink-dim)', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
              提示音音量
              <input type="range" min={0} max={1} step={0.05} value={settings.volume} onChange={(e) => setSettings({ volume: Number(e.target.value) })} style={{ flex: 1, padding: 0 }} />
              <span style={{ fontFamily: 'var(--font-num)', width: 34 }}>{Math.round(settings.volume * 100)}</span>
            </label>
          </div>

          <div className="glass" style={{ padding: '22px 26px' }}>
            <div style={{ fontSize: 14, letterSpacing: '0.3em', color: 'var(--cyan)', marginBottom: 14 }}>数据</div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button className="btn" onClick={() => doExport('json')}>
                <span>JSON 学习记录导出</span>
              </button>
              <button className="btn" onClick={() => doExport('csv')}>
                <span>CSV 成长记录</span>
              </button>
            </div>
            <DataReset />
            <details className="asset-credits"><summary>素材与鸣谢</summary><p>这是非官方粉丝项目的源码快照。内置三张由 SVG 代码绘制的示例背景和空音乐列表。下列历史参考资料对应的第三方游戏素材没有随源码分发，署名不代表授权。自主代码按 PolyForm Noncommercial 1.0.0 提供；第三方代码保留各自许可。</p><ul>{credits.map((item,i)=><li key={i}>{item.url?<a href={item.url} target="_blank" rel="noreferrer">{item.label}</a>:item.label}</li>)}</ul></details>
            {saved && <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 10 }}>{saved}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
