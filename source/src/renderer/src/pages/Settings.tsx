import Toggle from '../components/Toggle'
import FocusSettings from '../components/FocusSettings'
import { openStartupAnnouncement } from '../components/StartupAnnouncement'
import { COMMERCIAL_EDITION } from '../../../shared/edition'
import credits from '../../../shared/credits.json'
import DataReset from '../components/DataReset'
import BackupSettings from '../components/BackupSettings'
import LanSyncSettings from '../components/LanSyncSettings'
import ModelSettings from '../components/ModelSettings'
import PrivacyInfo from '../components/PrivacyInfo'
import PrivacyEraseSettings from '../components/PrivacyEraseSettings'
import OpenSourceLicenses from '../components/OpenSourceLicenses'
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
        <FocusSettings />
        {COMMERCIAL_EDITION && <PrivacyInfo />}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {!COMMERCIAL_EDITION && <div className="glass" style={{ padding: '22px 26px' }}>
            <div style={{ fontSize: 14, color: 'var(--cyan)', marginBottom: 8 }}>更新公告与作者</div>
            <p className="scene-hint">作者寄语、版本记录、素材鸣谢，以及自愿支持入口。</p>
            <button className="btn" onClick={openStartupAnnouncement}>查看更新公告</button>
          </div>}
          <div className="glass" id="settings-sound" tabIndex={-1} style={{ padding: '22px 26px' }}>
            <div style={{ fontSize: 14, letterSpacing: '0.3em', color: 'var(--cyan)', marginBottom: 8 }}>声音与体验</div>
            <p className="scene-hint">背景、日期、随身听和演出预览已移到自定义。</p><button className="btn" onClick={()=>useApp.getState().go('customize')}>打开自定义 ↗</button>
            {!COMMERCIAL_EDITION&&<Toggle on={settings.voiceEnabled} onChange={(v) => setSettings({ voiceEnabled: v })} label="角色语音" desc="结城理战斗语音，随场景触发" />}
            <Toggle on={settings.autoPlayMusic} onChange={(v) => setSettings({ autoPlayMusic: v })} label="打开应用自动播放音乐" />
            <p className="scene-hint">专注到时使用系统提醒音，受系统音量、通知权限和免打扰设置控制；应用内提醒会保留到确认。</p>
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
            {COMMERCIAL_EDITION?<details className="asset-credits"><summary>主题与资源</summary><p>深海微光、林间晨雾与轨道夜航是使用 OpenAI 图像工具生成的 AI 壁纸。主题配色与布局由心海共学搭配，环境浮光、星点和切换效果由代码绘制。</p><p>字体使用 Bebas Neue 与 Outfit，并附带 SIL Open Font License。动效研究引用的 MIT 许可随应用保存。</p><p>你导入的壁纸与音乐保存在本机，不会上传到主题库；本应用不判断导入图片或视频是否由 AI 生成。</p></details>:<details className="asset-credits"><summary>素材与鸣谢</summary><p>感谢原作者与分享者。以下来源按作者提供的感谢名单整理；相关游戏IP与素材权利归各自权利人所有。</p><ul>{credits.map((item,i)=><li key={i}>{item.url?<a href={item.url} target="_blank" rel="noreferrer">{item.label}</a>:item.label}</li>)}</ul></details>}
            {COMMERCIAL_EDITION && <OpenSourceLicenses />}
            {saved && <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 10 }}>{saved}</div>}
          </div>
        </div>
        {COMMERCIAL_EDITION && <PrivacyEraseSettings />}
      </div>
    </div>
  )
}
