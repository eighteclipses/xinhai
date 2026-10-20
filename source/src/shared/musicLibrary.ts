export interface ImportedTrack { file: string; title: string; tag: 'local'; id: string }
export interface MusicImportResult { added: number; skipped: number; tracks: ImportedTrack[]; cancelled?: boolean; duplicates?: number; failed?: number }
export interface MusicStorageInfo {
  platform: 'desktop' | 'android'
  folderPath: string | null
  canOpenFolder: boolean
  canImportFolder: boolean
  message: string
}
