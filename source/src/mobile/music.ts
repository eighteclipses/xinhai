import { native, request } from './native'
import type { ImportedTrack, MusicImportResult, MusicStorageInfo } from '../shared/musicLibrary'
// Android creates and migrates music_imports before WebView/JS starts. Keep
// this hook for the shared db initializer, but never recreate or overwrite the
// native resource tables from the renderer side.
export function initMusic(_connection:unknown){}
export function listImportedMusic():ImportedTrack[]{return native('musicList')}
export function importMusicFiles():Promise<MusicImportResult>{return request('musicImport')}
export function removeImportedMusic(id:string):ImportedTrack[]{return native('musicRemove',{id})}
export function undoRemoveImportedMusic(id:string):ImportedTrack[]{return native('musicUndoRemove',{id})}
export function musicStorageInfo():MusicStorageInfo{return {platform:'android',folderPath:null,canOpenFolder:false,canImportFolder:false,message:'平板上点击“添加音乐”选择本机音乐，可一次多选，不用寻找指定目录。'}}
export async function openMusicFolder():Promise<void>{throw Error('平板通过“添加音乐”选择本机音乐进行管理，不用寻找指定目录。')}
export async function importMusicFolder():Promise<MusicImportResult>{throw Error('平板不支持导入整个文件夹，请使用“添加音乐”一次多选音乐。')}
