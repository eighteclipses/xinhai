import { useEffect, useRef, useState } from 'react'
import { authorMessage, releaseNotes } from '../../../shared/announcementContent'
import { PERSONAL_RELEASE_DATE, PERSONAL_RELEASE_VERSION, PERSONAL_RELEASE_CHANGES, PERSONAL_RELEASE_SUMMARY } from '../../../shared/personalRelease'
import credits from '../../../shared/credits.json'
import '../styles/startup-announcement.css'

const preferenceKey = 'xinhai-announcement-muted-version'
type Section = 'welcome' | 'history' | 'credits' | 'support'
const sections: { id: Section; label: string }[] = [
  { id: 'welcome', label: '作者想说' }, { id: 'history', label: '版本足迹' },
  { id: 'credits', label: '素材鸣谢' }, { id: 'support', label: '支持作者' }
]
// Payment images are not source assets. The author's original prose is kept.
const payments: {id:string;name:string;src:string}[] = []

export function openStartupAnnouncement() {
  window.dispatchEvent(new Event('xinhai-open-announcement'))
}

export default function StartupAnnouncement() {
  const dialog = useRef<HTMLDialogElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(preferenceKey) !== PERSONAL_RELEASE_VERSION } catch { return true }
  })
  const [muted, setMuted] = useState(!open)
  const [section, setSection] = useState<Section>('welcome')
  const [enlarged, setEnlarged] = useState<string | null>(null)
  const [storageError, setStorageError] = useState(false)
  const close = () => { setOpen(false); setEnlarged(null) }

  useEffect(() => {
    const reopen = () => { setSection('welcome'); setEnlarged(null); setOpen(true) }
    window.addEventListener('xinhai-open-announcement', reopen)
    return () => window.removeEventListener('xinhai-open-announcement', reopen)
  }, [])
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
    return () => { if (element.open) element.close() }
  }, [open])
  useEffect(() => { content.current?.scrollTo(0, 0) }, [section, enlarged])

  function changePreference(value: boolean) {
    try {
      if (value) localStorage.setItem(preferenceKey, PERSONAL_RELEASE_VERSION)
      else localStorage.removeItem(preferenceKey)
      setMuted(value); setStorageError(false)
    } catch { setStorageError(true) }
  }

  return <dialog ref={dialog} className="startup-announcement" aria-labelledby="announcement-title"
    onCancel={event => { event.preventDefault(); enlarged ? setEnlarged(null) : close() }}>
    <header className="announcement-heading">
      <div><span className="announcement-kicker">STUDY IN THE BLUE / 更新公告</span>
        <h1 id="announcement-title">心海共学 · {PERSONAL_RELEASE_VERSION}</h1>
        <p>独立源码快照 · Windows / 横屏 Android<span> / {PERSONAL_RELEASE_DATE}</span></p>
      </div>
      <button type="button" className="announcement-close" onClick={close} aria-label="关闭更新公告">×</button>
    </header>
    <nav className="announcement-tabs" aria-label="公告内容">{sections.map(item =>
      <button type="button" key={item.id} aria-pressed={section === item.id} onClick={() => { setSection(item.id); setEnlarged(null) }}>{item.label}</button>
    )}</nav>
    <div className="announcement-content" ref={content} tabIndex={0} aria-label={sections.find(item => item.id === section)?.label}>
      {section === 'welcome' && <div className="announcement-welcome">
        <span className="announcement-eyebrow">写给正在使用心海的你</span>
        <h2>谢谢你，让这个小小的学习空间有了意义。</h2>
        {authorMessage.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        <div className="announcement-latest"><span>这次更新 · {PERSONAL_RELEASE_VERSION}</span><ul>
          {PERSONAL_RELEASE_CHANGES.map(change => <li key={change}>{change}</li>)}
        </ul></div>
        <p className="announcement-signature">—— 心海共学的作者</p>
      </div>}
      {section === 'history' && <section><h2>一点一点，走到现在</h2>
        <p className="announcement-muted">本次为源码快照 {PERSONAL_RELEASE_VERSION}，采用中性示例素材；完整个人版安装包另行提供。以下保留原有版本的开发历史与合并范围。</p>
        <ol className="announcement-history">
          <li><div><strong>{PERSONAL_RELEASE_VERSION}</strong><span>自用版 · 本次</span></div><p>{PERSONAL_RELEASE_SUMMARY}</p></li>
          <li><div><strong>0.2.32</strong><span>自用版 · 本地候选</span></div><p>重新制作三幕纪念演出与周年配乐，修复笔记仅改大小写的重名误报；实体平板验收发现的后台提醒能力缺口及专注新需求继续并入0.2.33。</p></li>
          <li><div><strong>0.2.31</strong><span>自用版</span></div><p>首页随窗口等比例放大；三位人物支持拖动与缩放；提色后继续随壁纸配色，各张壁纸独立记色，并补齐早期版本记录。</p></li>
          <li><div><strong>0.2.30</strong><span>自用版</span></div><p>新增自定义学习分类、原版首页自由拖动与恢复默认、月行水上循环壁纸和推荐外观；修复休息轮换计时及 Android 完整备份兼容，保留旧学习记录。</p></li>
          <li><div><strong>0.2.29</strong><span>自用版</span></div><p>新增 11 位角色、29 张立绘与两张 AI 修复背景；补齐待办、习惯和日历安排编辑，完善日记全库管理、复习分类和统计刷新。</p></li>
          <li><div><strong>0.2.28</strong><span>自用版</span></div><p>修复壁纸长播、笔记／日记管理和到时提醒；新增日历分类汇总、按任务累计专注时长、启动公告、素材署名与自愿支持入口。</p></li>
          {releaseNotes.map(item => <li key={item.edition + item.version}><div><strong>{item.version}</strong><span>{item.edition === 'commercial' ? '通用主题版' : item.edition === 'personal' ? '自用版' : '早期共用记录'}</span></div><p>{item.summary}</p></li>)}
        </ol>
      </section>}
      {section === 'credits' && <section><h2>感谢这些创作者与分享者</h2>
        <p className="announcement-muted">这里列出素材来源与创作参考。B站条目以 @ 名称署名，点击可查看来源作品；其他平台在条目中标明。原作者尚未确认的素材继续保留待补标记。</p>
        <ul className="announcement-credits">{credits.map((item, index) => <li key={index}>{item.url
          ? <a href={item.url} target="_blank" rel="noreferrer">{item.label}<span aria-hidden="true"> ↗</span></a>
          : <span>{item.label}</span>}</li>)}</ul>
        <p className="announcement-muted">游戏 IP、素材及音乐的权利归各自权利人所有。来源署名不代表获得再分发授权；自愿支持用于心海的开发维护，不代表购买第三方素材。</p>
      </section>}
      {section === 'support' && <section className="announcement-support"><h2>给作者回一点血</h2>
        <p>如果心海陪你度过了一段不错的学习时光，欢迎量力支持开发和维护。金额随意，也可以只留一句反馈。谢谢你。</p>
        <p className="announcement-muted">完全自愿，不影响任何已有功能。源码快照不附收款码，可在完整个人版公告中查看作者提供的支持方式。</p>
        {enlarged ? <div className="announcement-payment-expanded">
          <button type="button" className="announcement-text-button" onClick={() => setEnlarged(null)}>← 返回两种支持方式</button>
          <img src={payments.find(item => item.id === enlarged)!.src} alt={`${payments.find(item => item.id === enlarged)!.name}收款码原图`} />
        </div> : <div className="announcement-payments">{payments.map(item => <figure key={item.id}>
          <figcaption>{item.name}支持</figcaption>
          <button type="button" onClick={() => setEnlarged(item.id)} aria-label={`放大${item.name}收款码`}><img src={item.src} alt={`${item.name}收款码`} /></button>
          <span>点击查看大图</span>
        </figure>)}</div>}
      </section>}
    </div>
    <footer className="announcement-footer"><div><label><input type="checkbox" checked={muted} onChange={event => changePreference(event.target.checked)} />本版本不再自动弹出</label>
      <small>{storageError ? '偏好暂未保存，仍可直接关闭公告。' : '随时可在「设置 → 更新公告与作者」重新查看。'}</small></div>
      <button type="button" className="announcement-primary" onClick={close}>开始共学 <span aria-hidden="true">→</span></button>
    </footer>
  </dialog>
}
