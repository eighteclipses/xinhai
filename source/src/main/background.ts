import { app } from 'electron'
import { normalizeBackgroundImage } from './backgroundImage'
import { stat,readFile,mkdir,writeFile,copyFile,open } from 'node:fs/promises'
import { join,extname,basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { addWallpaper } from './themeLibrary'
import type { CustomBackground } from '../shared/types'
import { FALLBACK_POSTER } from '../shared/sceneCatalog'
export async function importBackground(file:string){
 const ext=extname(file).toLowerCase(),video=['.mp4','.webm'].includes(ext)
 if(!video&&!['.png','.jpg','.jpeg','.webp'].includes(ext))throw new Error('支持 PNG、JPG、WebP 图片和 MP4、WebM 视频')
 const info=await stat(file),limit=(video?300:30)*1024*1024
 if(!info.isFile()||info.size===0||info.size>limit)throw new Error(video?'请选择不超过 300MB 的视频':'请选择不超过 30MB 的图片')
 const folder=join(app.getPath('userData'),'backgrounds');await mkdir(folder,{recursive:true})
 const id=randomUUID(),target=join(folder,id+(video?ext:'.png'))
 let poster=FALLBACK_POSTER
 if(video){
  const handle=await open(file,'r');const header=Buffer.alloc(64)
  try{await handle.read(header,0,64,0)}finally{await handle.close()}
  if(ext==='.mp4'&&!header.subarray(4,48).includes(Buffer.from('ftyp'))||ext==='.webm'&&header.readUInt32BE(0)!==0x1a45dfa3)throw new Error('视频文件格式无效')
  await copyFile(file,target)
 }
 else {
  await writeFile(target,normalizeBackgroundImage(await readFile(file)));poster=pathToFileURL(target).href
 }
 const customBackground:CustomBackground={name:basename(file),src:pathToFileURL(target).href,kind:video?'video':'image',poster}
 return addWallpaper(customBackground)
}
