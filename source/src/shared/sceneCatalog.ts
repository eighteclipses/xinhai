import { originalThemes } from './originalThemes'

export interface SceneDefinition {
  id: string
  label: string
  description: string
  kind: 'image' | 'video' | 'procedural'
  src: string
  poster: string
  hasCharacter: boolean
  themeColor?: string
  collection?: string
  intro?: string
}
// Only the source-authored SVG examples are shipped. Historical third-party
// filenames remain in scenes.json as reference metadata and are not activated.
export const DEFAULT_SCENE_ID = 'original-deep-sea'
export const FALLBACK_POSTER = originalThemes[0].poster
export const sceneCatalog: SceneDefinition[] = [...originalThemes]
