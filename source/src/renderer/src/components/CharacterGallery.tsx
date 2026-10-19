import { useEffect, useRef, useState } from 'react'
import { CHARACTER_ART_SOURCE, characterArtById, visibleCharacterArtGroups as characterArtGroups, isCharacterArtVisible, type CharacterArt } from '../../../shared/characterArt'
import { COMMERCIAL_EDITION } from '../../../shared/edition'
import { useApp } from '../store/app'
import CharacterPortrait from './CharacterPortrait'
import CharacterPlacement from './CharacterPlacement'
import '../styles/character-gallery.css'

export default function CharacterGallery() {
  const settings = useApp(state => state.settings), setSettings = useApp(state => state.setSettings)
  const selected = characterArtById(settings.characterArtId)
  const hiddenSelection=settings.characterStyle==='gallery'&&!!selected&&!isCharacterArtVisible(selected)
  const [placing,setPlacing]=useState(false)
  const [expanded, setExpanded] = useState(false)
  const [role, setRole] = useState((isCharacterArtVisible(selected)?selected?.characterId:undefined) ?? characterArtGroups[0]?.id ?? '')
  const [busy, setBusy] = useState(false), saving = useRef(false)
  const [message, setMessage] = useState('')
  useEffect(() => { if (selected&&isCharacterArtVisible(selected)) setRole(selected.characterId) }, [selected?.characterId])
  if (COMMERCIAL_EDITION || !characterArtGroups.length) return null
  const group = characterArtGroups.find(item => item.id === role) ?? characterArtGroups[0]
  const legacyNames = { auto: '自动陪伴', seated: '原有坐姿', uniform: '原有常服', battle: '原有战斗服', gallery: '人物库', hidden: '已隐藏立绘' }
  const current = !settings.showCharacter || settings.characterStyle === 'hidden' ? '已隐藏立绘'
    : settings.characterStyle==='gallery'&&hiddenSelection?'此角色暂时隐藏':settings.characterStyle === 'gallery' && selected ? `${selected.characterName} · ${selected.variantName}` : legacyNames[settings.characterStyle]
  async function choose(art?: CharacterArt) {
    if (saving.current) return
    saving.current = true; setBusy(true); setMessage('')
    try {
      await setSettings(art ? { characterStyle: 'gallery', characterArtId: art.id, showCharacter: true } : { characterStyle: 'auto', showCharacter: true })
      setMessage(art ? `已选择：${art.characterName} · ${art.variantName}` : '已恢复自动陪伴')
    } catch { setMessage('人物选择未能保存，请重试。') }
    finally { saving.current = false; setBusy(false) }
  }
  async function toggleVisible() {
    if (saving.current) return
    const show = !settings.showCharacter || settings.characterStyle === 'hidden'
    saving.current = true; setBusy(true); setMessage('')
    try {
      // Keep the selected art, placement, scale and opacity when switching off.
      // The old hidden style predates this switch; restore its retained selection.
      await setSettings({ showCharacter: show, ...(show && settings.characterStyle === 'hidden' ? { characterStyle: selected ? 'gallery' as const : 'auto' as const } : {}) })
      setMessage(show ? '已开启立绘，保留原来的选择、位置与大小。' : '已关闭立绘，原来的选择、位置与大小已保留。')
    } catch { setMessage('显示立绘未能保存，请重试。原来的设置仍保留。') }
    finally { saving.current = false; setBusy(false) }
  }
  return <section className="glass character-gallery" id="customize-characters" tabIndex={-1} aria-labelledby="character-gallery-title">
    <header><div><span className="en-label">CHARACTER COLLECTION</span><h2 id="character-gallery-title">人物库 · 月行水上</h2><p>当前：{current}</p></div>
      <button className="btn" aria-expanded={expanded} aria-controls="character-gallery-content" onClick={() => setExpanded(value => !value)}>{expanded ? '收起人物库' : `浏览 3 位角色 · ${characterArtGroups.reduce((n,g)=>n+g.variants.length,0)} 张立绘`}</button>
    </header>
    <div className="character-visibility" aria-busy={busy}>
      <div><strong>显示立绘</strong><p>随时开启或关闭，不会清空所选角色、位置与大小。{settings.characterStyle==='auto'&&'自动陪伴会避开背景已有的人物。'}</p></div>
      <button type="button" role="switch" aria-label="显示立绘" aria-checked={settings.showCharacter&&settings.characterStyle!=='hidden'} disabled={busy} onClick={()=>void toggleVisible()}><span aria-hidden="true"/><span>{busy?'保存中…':settings.showCharacter&&settings.characterStyle!=='hidden'?'已开启':'已关闭'}</span></button>
    </div>
    <div className="character-placement-entry"><button className="btn" disabled={busy||!settings.showCharacter||settings.characterStyle==='hidden'||hiddenSelection} onClick={()=>setPlacing(true)}>调整立绘</button><p>{hiddenSelection?'此角色暂时隐藏。原选择与素材已保留，请选择下方三位角色之一。':!settings.showCharacter||settings.characterStyle==='hidden'?'开启上方“显示立绘”后，可调整位置与大小；也可展开人物库换角色。':'在独立调整模式中拖动或缩放，完成保存后应用到各页。'}</p></div>
    {placing&&<CharacterPlacement onClose={()=>setPlacing(false)}/>}
    {expanded && <div id="character-gallery-content">
      <p className="character-gallery-guide">先选角色，再点选立绘或服装差分。选中的人物固定显示；自动陪伴仍会避开背景里已有的人物。</p>
      <div className="character-role-list" role="group" aria-label="浏览人物角色">{characterArtGroups.map(item => <button type="button" key={item.id} aria-pressed={item.id === group.id} disabled={busy} onClick={() => { setRole(item.id); setMessage('') }}><strong>{item.name}</strong><small>{item.variants.length} 张立绘</small></button>)}</div>
      <h3>{group.name} <span>· {group.variants.length} 个服装 / 持物差分</span></h3>
      <div className="character-variant-grid" role="group" aria-label={group.name + '的立绘差分'}>{group.variants.map(art => <button type="button" key={art.id} disabled={busy}
        aria-pressed={settings.showCharacter && settings.characterStyle === 'gallery' && settings.characterArtId === art.id}
        aria-label={'选择 ' + art.characterName + ' · ' + art.variantName} onClick={() => void choose(art)}>
        <CharacterPortrait art={art} /><strong>{art.variantName}</strong><small>{art.characterName}</small>
      </button>)}</div>
      <footer><button className="btn" disabled={busy} onClick={() => void choose()}>使用自动陪伴</button><a href={CHARACTER_ART_SOURCE} target="_blank" rel="noreferrer">来源：bilibili @rmxlinux ↗</a></footer>
      <p className="character-gallery-source">游戏资源由 rmxlinux 解包、优化并整理分享；服装名称为便于选择的画面描述。原有立绘继续保留。</p>
    </div>}
    {message && <p className="character-gallery-message" role="status">{message}</p>}
  </section>
}
