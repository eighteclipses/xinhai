import { sceneCatalog as scenes, DEFAULT_SCENE_ID } from '../../../shared/sceneCatalog'
import type { BackgroundId,CustomBackground } from '../../../shared/types'

export { scenes }
export const backgroundScenes = scenes.filter((s) => s.id !== 'journal' && s.id !== 'stats')
export function sceneColor(scene:ReturnType<typeof resolveScene>):string{return 'themeColor' in scene&&scene.themeColor?scene.themeColor:'#21bce7'}
export function resolveScene(background: BackgroundId, page: string, pageBackgrounds: boolean, custom?:CustomBackground|null) {
  if(background==='custom'&&custom)return {id:'custom',label:custom.name,description:'你的背景',kind:custom.kind,src:custom.src,poster:custom.poster,hasCharacter:true,intro:undefined}
  const id = pageBackgrounds && (page === 'journal' || page === 'stats') ? page : background
  return scenes.find((s) => s.id === id) ?? scenes.find(s=>s.id===DEFAULT_SCENE_ID)!
}
