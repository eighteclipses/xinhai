export const ERASURE_CONFIRMATION = '清空本应用资料'
export interface ErasurePreview {
  ticket: string
  expiresAt: number
  platform: 'windows' | 'android'
  location: string
  preservedKnowledge: string | null
}
