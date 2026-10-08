import { native, request } from './native'
import type { ImportedTrack } from '../main/music'
// Android creates and migrates music_imports before WebView/JS starts. Keep
// this hook for the shared db initializer, but never recreate or overwrite the
// native resource tables from the renderer side.
export function initMusic(_connection:unknown){}
export function listImportedMusic():ImportedTrack[]{return native('musicList')}
export function importMusicFiles():Promise<{added:number;skipped:number;tracks:ImportedTrack[]}>{return request('musicImport')}
export function removeImportedMusic(id:string):ImportedTrack[]{return native('musicRemove',{id})}
