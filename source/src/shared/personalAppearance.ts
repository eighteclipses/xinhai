import type { BackgroundId, Settings } from './types'

export type PersonalAppearancePatch = Pick<Settings,
  'background' | 'backgroundFit' | 'themeMode' | 'themeColor' |
  'panelOpacity' | 'panelBlur' | 'wallpaperDim' |
  'clockStyle' | 'clockScale' | 'clockPosition' |
  'playerStyle' | 'playerScale' | 'playerPosition' |
  'timerPosition' | 'wallpaperClock' | 'pageBackgrounds' |
  'particles' | 'ambientEffect' | 'wallpaperMotion' | 'sceneTransition' |
  'autoSceneEnabled' | 'autoSceneIds' | 'showCharacter' | 'characterStyle'>
  & Pick<Settings, 'characterArtId' | 'characterScale' | 'characterPosition' | 'characterOpacity' | 'wallpaperThemeColors'>

// Public source starter: code-authored SVG backgrounds and no third-party art.
// Only a new install or explicit preset application uses these values.
export const PERSONAL_APPEARANCE_PRESET: Readonly<Omit<PersonalAppearancePatch, 'autoSceneIds'>> & { readonly autoSceneIds: readonly BackgroundId[] } = Object.freeze({
  background: 'original-deep-sea',
  backgroundFit: 'cover',
  themeMode: 'wallpaper',
  themeColor: '#67ddd1',
  panelOpacity: .65,
  panelBlur: 10,
  wallpaperDim: .16,
  clockStyle: 'minimal',
  clockScale: .75,
  clockPosition: null,
  playerStyle: 'card',
  playerScale: .9,
  playerPosition: null,
  timerPosition: 'left',
  wallpaperClock: true,
  pageBackgrounds: false,
  particles: false,
  ambientEffect: 'none',
  wallpaperMotion: false,
  sceneTransition: 'none',
  autoSceneEnabled: false,
  autoSceneIds: Object.freeze(['original-deep-sea', 'original-forest-dawn', 'original-orbital-night'] as const),
  showCharacter: false,
  characterStyle: 'hidden',
  characterArtId: '',
  characterScale: 1,
  characterPosition: null,
  characterOpacity: 1,
  // Each imported wallpaper may acquire its own color through the UI.
  wallpaperThemeColors: {}
})

export function personalAppearancePatch(existing?: Pick<Settings,'wallpaperThemeColors'>): PersonalAppearancePatch {
  const patch=JSON.parse(JSON.stringify(PERSONAL_APPEARANCE_PRESET)) as PersonalAppearancePatch
  if(existing)patch.wallpaperThemeColors={...existing.wallpaperThemeColors,...patch.wallpaperThemeColors}
  return patch
}

// These fields did not exist in earlier saved profiles. Their old empty meaning
// must not silently turn into the new starter portrait or a wallpaper override.
export const LEGACY_APPEARANCE_OMISSIONS = {
  characterArtId: '', characterPosition: null, homeLayouts: {version:2}, wallpaperThemeColors: {}
} as const
