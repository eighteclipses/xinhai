import { nativeImage } from 'electron'

// Keep normalized copies exportable within the same 30 MiB limit as imports.
export function normalizeBackgroundImage(bytes:Buffer):Buffer {
  let image=nativeImage.createFromBuffer(bytes)
  if(image.isEmpty())throw Error('无法读取这张图片，请换一张试试')
  let size=image.getSize()
  if(size.width*size.height>100_000_000)throw Error('图片分辨率过高')
  if(Math.max(size.width,size.height)>3840)image=image.resize(size.width>=size.height?{width:3840}:{height:3840})
  let output=image.toPNG()
  while(output.length>30*1024*1024){
    size=image.getSize()
    if(size.width<=1||size.height<=1)throw Error('图片无法在大小限制内保存')
    image=image.resize({width:Math.max(1,Math.floor(size.width*.8))})
    output=image.toPNG()
  }
  return output
}
