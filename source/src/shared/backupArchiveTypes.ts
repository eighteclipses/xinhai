import type { DatabaseSnapshot } from './backupDatabase'

export const BACKUP_FORMAT = 'xinhai-backup'
export const BACKUP_ARCHIVE_LIMIT = 2 * 1024 * 1024 * 1024
export const BACKUP_FILE_LIMIT = 512 * 1024 * 1024
export const BACKUP_MANIFEST_LIMIT = 4 * 1024 * 1024
export const BACKUP_FILE_COUNT_LIMIT = 10000
export const BACKUP_DATABASE_LIMIT = 16 * 1024 * 1024
export const BACKUP_ROOT = 'xinhai-backup://knowledge'
export const backupMediaRef = (id:string):string => 'xinhai-backup://media/'+id
export interface BackupMediaSource { id:string; kind:'wallpaper'|'music'; source:string; extension:string }
export interface BackupFileEntry { path:string; kind:'database'|'wallpaper'|'music'|'knowledge'; size:number; sha256:string; id?:string }
export interface BackupManifest {
  format:'xinhai-backup'; version:1; appVersion:string; createdAt:number
  files:BackupFileEntry[]; directories:string[]
}
export interface PortableBackup { snapshot:DatabaseSnapshot; mediaSources:BackupMediaSource[] }
export interface BackupRestoreResources {
  knowledgeRoot:string; androidKnowledgeRoot?:string
  media:Record<string,{path:string;url:string}>
}
export interface PreparedBackup { ticket:string; manifest:BackupManifest; snapshot:DatabaseSnapshot; resources:BackupRestoreResources }
export interface BackupPreview { ticket:string; createdAt:number; appVersion:string; files:number; bytes:number; counts:Record<string,number>; warnings:string[] }
export interface BackupRestoreResult { safetyBackup:string }
