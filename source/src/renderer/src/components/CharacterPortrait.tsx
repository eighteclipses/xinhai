import { characterArtViewBox, type CharacterArt } from '../../../shared/characterArt'

export default function CharacterPortrait({ art, className = '', align = 'center' }: { art: CharacterArt; className?: string; align?: 'center' | 'bottom' }) {
  const bounds = characterArtViewBox(art)
  return <svg className={'character-art-viewport ' + className} viewBox={bounds.value} width={bounds.width} height={bounds.height}
    preserveAspectRatio={align === 'bottom' ? 'xMaxYMax meet' : 'xMidYMid meet'} aria-hidden="true" focusable="false" data-character-art-id={art.id}>
    <image href={art.src} x="0" y="0" width={art.width} height={art.height} />
  </svg>
}
