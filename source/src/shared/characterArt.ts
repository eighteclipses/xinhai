import personalArt from './personalCharacterArt.json'
import { COMMERCIAL_EDITION } from './edition'

export interface CharacterArt {
  id: string
  characterId: string
  characterName: string
  variantName: string
  src: string
  width: number
  height: number
  bbox: number[]
  sourceIndex: number
  sha256: string
}

export const CHARACTER_ART_SOURCE = 'https://www.bilibili.com/opus/1244002758676185093'
export const characterArt: readonly CharacterArt[] = COMMERCIAL_EDITION ? [] : personalArt
export const characterArtGroups = [...new Set(characterArt.map(art => art.characterId))].map(id => {
  const variants = characterArt.filter(art => art.characterId === id)
  return { id, name: variants[0].characterName, variants }
})
// Keep the complete source catalog for old settings, backups and provenance.
// The personal gallery and actual portrait layer expose only these characters.
export const VISIBLE_CHARACTER_IDS=['avg_4217_makoto_1','avg_4218_aigis_1','avg_4219_yukari_1'] as const
// Catalog metadata is retained for provenance/settings compatibility. No game
// portraits are distributed in this source snapshot, so none are offered as UI.
const SOURCE_AVAILABLE_ART_IDS = new Set<string>()
export function isCharacterArtVisible(art:CharacterArt|undefined):boolean {return !!art&&SOURCE_AVAILABLE_ART_IDS.has(art.id)&&VISIBLE_CHARACTER_IDS.includes(art.characterId as typeof VISIBLE_CHARACTER_IDS[number])}
export const visibleCharacterArt=characterArt.filter(isCharacterArtVisible)
export const visibleCharacterArtGroups=characterArtGroups.map(group=>({...group,variants:group.variants.filter(isCharacterArtVisible)})).filter(group=>group.variants.length>0)
export function characterArtById(id: unknown): CharacterArt | undefined {
  return typeof id === 'string' ? characterArt.find(art => art.id === id) : undefined
}

/** Display bounds only. The PNG file, colors and alpha remain unmodified. */
export function characterArtViewBox(art: CharacterArt) {
  const padding = 4
  const x = Math.max(0, art.bbox[0] - padding), y = Math.max(0, art.bbox[1] - padding)
  const width = Math.min(art.width, art.bbox[2] + padding) - x
  const height = Math.min(art.height, art.bbox[3] + padding) - y
  return { x, y, width, height, value: `${x} ${y} ${width} ${height}` }
}
