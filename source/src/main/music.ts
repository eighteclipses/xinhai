import type Database from 'better-sqlite3'
import { app } from 'electron'
import { mkdir, copyFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
export interface ImportedTrack {file:string;title:string;tag:'local';id:string}
let db:Database.Database
export function initMusic(connection:Database.Database){db=connection;db.exec('CREATE TABLE IF NOT EXISTS music_imports (id TEXT PRIMARY KEY, path TEXT NOT NULL, title TEXT NOT NULL, createdAt INTEGER NOT NULL)')}
export function listImportedMusic():ImportedTrack[]{return (db.prepare('SELECT * FROM music_imports ORDER BY createdAt,id').all() as {id:string;path:string;title:string}[]).map(t=>({id:t.id,file:pathToFileURL(t.path).href,title:t.title,tag:'local'}))}
export async function importMusicFiles(paths:string[]):Promise<{added:number;skipped:number;tracks:ImportedTrack[]}> {
 let added=0,skipped=0
 const folder=join(app.getPath('userData'),'imported-music');await mkdir(folder,{recursive:true})
 for(const source of paths){
  try{
   const ext=extname(source).toLowerCase()
   if(!['.mp3','.ogg','.wav','.flac','.m4a','.aac','.opus'].includes(ext))throw Error('unsupported')
   const info=await stat(source);if(!info.isFile()||!info.size||info.size>512*1024*1024)throw Error('invalid size')
   const hash=createHash('sha256');for await(const chunk of createReadStream(source))hash.update(chunk);const id=hash.digest('hex')
   if(db.prepare('SELECT 1 FROM music_imports WHERE id=?').get(id)){skipped++;continue}
   const destination=join(folder,id+ext);await copyFile(source,destination)
   const result=db.prepare('INSERT OR IGNORE INTO music_imports VALUES (?,?,?,?)').run(id,destination,basename(source,extname(source)),Date.now())
   if(result.changes)added++;else skipped++
  }catch{skipped++}
 }
 return {added,skipped,tracks:listImportedMusic()}
}
// Removes the library entry only; the user's original music file is never deleted.
export function removeImportedMusic(id:string){if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw Error('音乐条目无效');db.prepare('DELETE FROM music_imports WHERE id=?').run(id);return listImportedMusic()}
