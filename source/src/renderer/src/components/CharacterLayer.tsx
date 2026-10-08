import { resolveScene } from '../lib/scenes'
import { useReducedEffects } from '../lib/motion'
import { motion } from 'framer-motion'
import { useApp } from '../store/app'
// Optional, user-supplied local assets. Missing artwork never blocks a build.
const charIdle = 'optional/char-idle.png'
const charFocus = 'optional/char-focus.png'
const charSummon = 'optional/char-summon.png'

// 主角不是装饰壁纸，而是界面空间的一部分（设计文档第十六章）
const MOOD_ART: Record<string, string> = {
  idle: 'design/makoto-seated.png',
  night: charIdle,
  rest: 'design/makoto-seated.png',
  write: charIdle,
  focus: 'design/makoto-seated.png',
  levelup: charSummon
}

const MOOD_FILTER: Record<string, string> = {
  idle: 'brightness(0.95)',
  night: 'brightness(0.72) saturate(0.9)',
  rest: 'brightness(0.85)',
  write: 'brightness(0.82) saturate(0.9)',
  focus: 'brightness(1) saturate(1.05)',
  levelup: 'brightness(1.08) saturate(1.15) drop-shadow(0 0 28px var(--cyan-dim))'
}

export default function CharacterLayer() {
  const page = useApp((s) => s.page)
  const mood = useApp((s) => s.characterMood)
  const show = useApp((s) => s.settings.showCharacter)
  const reduce = useReducedEffects()
  const settings = useApp((s) => s.settings)
  if (!show || settings.characterStyle === 'hidden' || (settings.characterStyle === 'auto' && resolveScene(settings.background, page, settings.pageBackgrounds,settings.customBackground).hasCharacter)) return null
  const effectiveMood = settings.characterStyle === 'auto' ? mood : 'chosen'
  const art = settings.characterStyle === 'auto' ? MOOD_ART : {chosen:settings.characterStyle === 'battle' ? charFocus : settings.characterStyle === 'uniform' ? charIdle : 'design/makoto-seated.png'}

  return (
    <motion.div
      className={'character-layer character-page-' + page}
      style={{
        position: 'fixed',
        right: '-1%',
        bottom: '-3%',
        height: '82%',
        zIndex: 1,
        pointerEvents: 'none',
        opacity: 0.95
      }}
      animate={reduce ? { y: 0 } : { y: [0, -6, 0] }}
      transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
    >
      {Object.entries(art).map(([key, src]) => (
        <motion.img
          key={key}
          src={src}
          alt=""
          onError={event => { event.currentTarget.style.display = 'none' }}
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            height: '100%',
            objectFit: 'contain',
            filter: MOOD_FILTER[key],
            maskImage: 'linear-gradient(to top, transparent 0%, black 10%)',
            WebkitMaskImage: 'linear-gradient(to top, transparent 0%, black 10%)'
          }}
          initial={false}
          animate={{ opacity: effectiveMood === key ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : 0.4 }}
        />
      ))}
    </motion.div>
  )
}
