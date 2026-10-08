import type { BackgroundId, Settings } from './types'

export interface OriginalTheme {
  id: BackgroundId
  label: string
  description: string
  kind: 'image'
  src: string
  poster: string
  hasCharacter: false
  themeColor: string
  collection: 'originals'
  appearance: Pick<Settings, 'panelOpacity' | 'panelBlur' | 'wallpaperDim' | 'ambientEffect' | 'wallpaperMotion' | 'sceneTransition'>
}

export const originalThemes: OriginalTheme[] = [
  {id:'original-deep-sea',label:'深海微光',description:'青绿光束 · 安静下潜',kind:'image',src:'backgrounds/originals/deep-sea.svg',poster:'backgrounds/originals/deep-sea.svg',hasCharacter:false,themeColor:'#67ddd1',collection:'originals',appearance:{panelOpacity:.58,panelBlur:8,wallpaperDim:.08,ambientEffect:'motes',wallpaperMotion:true,sceneTransition:'fade'}},
  {id:'original-forest-dawn',label:'林间晨雾',description:'暖金晨光 · 林间书房',kind:'image',src:'backgrounds/originals/forest-dawn.svg',poster:'backgrounds/originals/forest-dawn.svg',hasCharacter:false,themeColor:'#e7bc76',collection:'originals',appearance:{panelOpacity:.64,panelBlur:10,wallpaperDim:.18,ambientEffect:'motes',wallpaperMotion:false,sceneTransition:'fade'}},
  {id:'original-orbital-night',label:'轨道夜航',description:'雾紫星光 · 轨道观景台',kind:'image',src:'backgrounds/originals/orbital-night.svg',poster:'backgrounds/originals/orbital-night.svg',hasCharacter:false,themeColor:'#b6abef',collection:'originals',appearance:{panelOpacity:.6,panelBlur:8,wallpaperDim:.12,ambientEffect:'stars',wallpaperMotion:true,sceneTransition:'arc'}}
]

export function originalThemePatch(id: BackgroundId): Partial<Settings> {
  const theme=originalThemes.find(item=>item.id===id)
  if(!theme)throw new Error('主题不存在')
  // Appearance only: preserve records, credentials, imported media and accessibility preferences.
  return {...theme.appearance,background:theme.id,themeMode:'wallpaper',themeColor:theme.themeColor,pageBackgrounds:false,showCharacter:false,characterStyle:'hidden',clockStyle:'minimal',playerStyle:'card',backgroundFit:'cover'}
}
