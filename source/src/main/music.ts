import type Database from 'better-sqlite3'
import { app } from 'electron'
import { mkdir, copyFile, stat, opendir, realpath } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ImportedTrack, MusicImportResult, MusicStorageInfo } from '../shared/musicLibrary'
export type { ImportedTrack } from '../shared/musicLibrary'
const EXTENSIONS=['.mp3','.ogg','.wav','.flac','.m4a','.aac','.opus']
type MusicRow={id:string;path:string;title:string;createdAt:number}
let db:Database.Database
let lastRemoval:{row:MusicRow;after:string}|null=null
export function clearMusicUndo(){lastRemoval=null}
export function initMusic(connection:Database.Database){db=connection;lastRemoval=null;db.exec('CREATE TABLE IF NOT EXISTS music_imports (id TEXT PRIMARY KEY, path TEXT NOT NULL, title TEXT NOT NULL, createdAt INTEGER NOT NULL)')}
export function listImportedMusic():ImportedTrack[]{return (db.prepare('SELECT * FROM music_imports ORDER BY createdAt,id').all() as {id:string;path:string;title:string}[]).map(t=>({id:t.id,file:pathToFileURL(t.path).href,title:t.title,tag:'local'}))}
export function musicFolder():string{return join(app.getPath('userData'),'imported-music')}
export function musicStorageInfo():MusicStorageInfo{return {platform:'desktop',folderPath:musicFolder(),canOpenFolder:true,canImportFolder:true,message:'点“添加音乐”选择音频，可一次多选；也可以添加一个文件夹中的音频。软件保存导入副本，原文件不移动。源码快照默认不附内置歌曲，可导入自己有权使用的音乐。'}}
export async function importMusicFolder(folder:string):Promise<MusicImportResult>{
 const paths:string[]=[]
 for await(const entry of await opendir(folder)){
  if(!entry.isFile()||!EXTENSIONS.includes(extname(entry.name).toLowerCase()))continue
  paths.push(join(folder,entry.name))
  if(paths.length>1000)throw Error('这个文件夹的音频超过1000首，请分批选择文件添加。')
 }
 return importMusicFiles(paths.sort())
}
export async function importMusicFiles(paths:string[]):Promise<MusicImportResult> {
 let added=0,skipped=0,duplicates=0,failed=0
 const folder=musicFolder();await mkdir(folder,{recursive:true})
 for(const source of paths){
  try{
   const ext=extname(source).toLowerCase()
   if(!EXTENSIONS.includes(ext))throw Error('unsupported')
   const info=await stat(source);if(!info.isFile()||!info.size||info.size>512*1024*1024)throw Error('invalid size')
   const hash=createHash('sha256');for await(const chunk of createReadStream(source))hash.update(chunk);const id=hash.digest('hex')
   if(db.prepare('SELECT 1 FROM music_imports WHERE id=?').get(id)){skipped++;duplicates++;continue}
   const destination=join(folder,id+ext)
   const sourcePath=await realpath(source),destinationPath=await realpath(destination).catch(()=>null)
   if(sourcePath!==destinationPath)await copyFile(source,destination)
   const result=db.prepare('INSERT OR IGNORE INTO music_imports VALUES (?,?,?,?)').run(id,destination,basename(source,extname(source)),Date.now())
   if(result.changes)added++;else {skipped++;duplicates++}
  }catch{skipped++;failed++}
 }
 return {added,skipped,duplicates,failed,tracks:listImportedMusic()}
}
// Removes the library entry only; the user's original music file is never deleted.
function validId(id:string){if(typeof id!=='string'||!id||id.length>512||/[\u0000-\u001f]/.test(id))throw Error('音乐条目无效')}
export function removeImportedMusic(id:string){
 validId(id)
 const row=db.prepare('SELECT * FROM music_imports WHERE id=?').get(id) as MusicRow|undefined
 if(!row)throw Error('这首歌已不在歌单里，请刷新后重试。')
 db.prepare('DELETE FROM music_imports WHERE id=?').run(id)
 const tracks=listImportedMusic();lastRemoval={row,after:JSON.stringify(tracks)};return tracks
}
/** Only an in-process receipt can restore a row; no renderer-supplied file path. */
export async function undoMusicRemoval(id:string):Promise<ImportedTrack[]>{
 validId(id)
 const receipt=lastRemoval
 if(!receipt||receipt.row.id!==id)throw Error('只能撤销最近一次移除；也可以重新添加音乐。')
 if(JSON.stringify(listImportedMusic())!==receipt.after)throw Error('音乐库已经变化，请重新添加这首歌。')
 const info=await stat(receipt.row.path).catch(()=>null)
 if(!info?.isFile()||!info.size)throw Error('音乐副本已不在，请选择原文件重新添加。')
 if(lastRemoval!==receipt||JSON.stringify(listImportedMusic())!==receipt.after)throw Error('音乐库已经变化，请重新添加这首歌。')
 db.prepare('INSERT INTO music_imports(id,path,title,createdAt) VALUES (?,?,?,?)').run(receipt.row.id,receipt.row.path,receipt.row.title,receipt.row.createdAt)
 lastRemoval=null;return listImportedMusic()
}
