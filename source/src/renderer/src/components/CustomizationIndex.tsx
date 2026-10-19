import { useState } from 'react'
import type { PageId } from '../store/app'
import { goToSetting } from '../lib/settingNavigation'
import { visibleCharacterArtGroups } from '../../../shared/characterArt'
import { COMMERCIAL_EDITION } from '../../../shared/edition'
import '../styles/customization-index.css'

const entries: { group: string; title: string; detail: string; keywords: string; page: PageId; target: string }[] = [
  { group: '画面', title: '一键外观组合', detail: '顶部的推荐外观与主题搭配', keywords: '默认 初始 预设 还原 重置 恢复', page: 'customize', target: 'customize-presets' },
  { group: '画面', title: '壁纸与背景', detail: '场景收藏、上传背景、显示方式', keywords: '图片 视频 自定义 导入 本地 铺满 完整', page: 'customize', target: 'customize-scenes' },
  { group: '画面', title: '人物立绘', detail: '显示开关、角色服装、位置与大小', keywords: '人物库 隐藏 关闭 开启 结城理 埃癸斯 岳羽由加莉 缩放', page: 'customize', target: 'customize-characters' },
  { group: '画面', title: '壁纸独立配色', detail: '随壁纸配色、取色或固定主题色', keywords: '颜色 提色 提取 调色 主题 灰白', page: 'customize', target: 'customize-colors' },
  { group: '画面', title: '画面与阅读', detail: '透明度、暗化、模糊、专注计时位置', keywords: '面板 不透明 清晰 人物表现 左侧 中间 右侧 左下角', page: 'customize', target: 'customize-reading' },
  { group: '小组件与动态', title: '时钟与日期', detail: '日期样式与大小；可在桌面拖动', keywords: '时间 月相 P3R 极简 隐藏 时钟', page: 'customize', target: 'customize-clock' },
  { group: '小组件与动态', title: '播放器外观', detail: '随身听、卡片、大小与位置恢复', keywords: '音乐 MP3 挂绳 底栏 缩放', page: 'customize', target: 'customize-player' },
  { group: '小组件与动态', title: '壁纸自动切换', detail: '循环间隔、顺序、参与场景', keywords: '轮换 自动 场景 随机 秒 分钟', page: 'customize', target: 'customize-rotation' },
  { group: '小组件与动态', title: '动态与演出', detail: '转场、光点、减少动态与演出预览', keywords: '声音 动画 粒子 气泡 总攻击 成长 关闭', page: 'customize', target: 'customize-effects' },
  { group: '其他页面', title: '00 · 桌面布局', detail: '去共学桌面，点顶部小铅笔拖动、缩放或恢复默认', keywords: '首页 布局 排版 模块 大小 自由 调整', page: 'home', target: 'home-layout-edit' },
  { group: '其他页面', title: '08 · 学习分类', detail: '去成长轨迹，新增科目、改名/颜色、排序、停用或恢复', keywords: '自定义 学科 项目 目标 分类 管理 统计', page: 'history', target: 'history-categories' },
  { group: '其他页面', title: '09 · 专注与音符', detail: '去系统设置，调整后台到时行为、音符演出与提醒权限', keywords: '计时 集中 结算 25 分钟 累计 后台 等待 继续 通知 闹钟 提醒', page: 'settings', target: 'settings-focus' },
  { group: '其他页面', title: '09 · 声音与体验', detail: '去系统设置，调整角色语音、自动播放与提示音量', keywords: '语音 冷却 间隔 音效 声音 静音 音乐', page: 'settings', target: 'settings-sound' }
]

export default function CustomizationIndex() {
  const [query, setQuery] = useState('')
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const matches = entries.filter(entry => (entry.target !== 'customize-characters' || !COMMERCIAL_EDITION && visibleCharacterArtGroups.length > 0) && words.every(word => `${entry.title} ${entry.detail} ${entry.keywords}`.toLocaleLowerCase().includes(word)))
  return <nav className="customization-index" aria-label="自定义快速定位">
    <div className="customization-index-heading"><div><h2>想调整什么？</h2><p>点入口定位到控件。搜索只筛选入口，下方设置与未保存的调整都保留。</p></div>
      <form role="search" onSubmit={event => { event.preventDefault(); const first = matches[0]; if (first) goToSetting(first.page, first.target) }}>
        <label htmlFor="customization-search">查找设置</label><input id="customization-search" type="search" value={query} placeholder="如：立绘、配色、音符、布局" onChange={event => setQuery(event.target.value)} />
      </form>
    </div>
    {['画面', '小组件与动态', '其他页面'].map(group => {
      const items = matches.filter(entry => entry.group === group)
      return items.length > 0 && <div className="customization-index-group" key={group}><span>{group}</span><div>{items.map(entry => <button type="button" key={entry.target} title={entry.detail} onClick={() => goToSetting(entry.page, entry.target)}><strong>{entry.title}</strong><small>{entry.detail}</small><span aria-hidden="true">{entry.page === 'customize' ? '↓' : '↗'}</span></button>)}</div></div>
    })}
    {words.length > 0 && <p className="customization-index-result" role="status">{matches.length ? `找到 ${matches.length} 个入口。按回车可前往第一个。` : '暂时没找到这个关键词，可试试“壁纸”“立绘”“音符”或“布局”。下方完整设置仍可使用。'}</p>}
  </nav>
}
