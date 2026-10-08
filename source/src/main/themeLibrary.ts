import { getState, updateSettings } from './db'
import { DEFAULT_SCENE_ID } from '../shared/sceneCatalog'
import { applyThemePatch, captureTheme, LIBRARY_LIMIT, parseThemeManifest, rememberWallpaper, savedThemeById, themeName, wallpaperById, type SavedTheme, type ThemeManifest } from '../shared/themeLibrary'
import type { CustomBackground, Settings } from '../shared/types'

export function addWallpaper(custom:CustomBackground):Settings {
  return updateSettings(rememberWallpaper(getState().settings,custom))
}
export function selectWallpaper(id:string):Settings {
  const current=getState().settings,item=wallpaperById(current,id)
  return updateSettings({customBackground:item,background:'custom'})
}
export function renameWallpaper(id:string,name:string):Settings {
  const current=getState().settings;wallpaperById(current,id);name=themeName(name)
  return updateSettings({wallpaperLibrary:current.wallpaperLibrary.map(item=>item.id===id?{...item,name}:item),
    ...(current.customBackground?.id===id?{customBackground:{...current.customBackground,name}}:{})})
}
export function removeWallpaper(id:string):Settings {
  const current=getState().settings;wallpaperById(current,id)
  const using=current.savedThemes.filter(theme=>theme.wallpaper.type==='library'&&theme.wallpaper.id===id)
  if(using.length)throw Error('这张壁纸正被主题“'+using[0].name+'”使用，请先删除对应主题后再移除')
  const selected=current.customBackground?.id===id
  // Only remove the reference; never delete a user's original file or historical app copy here.
  return updateSettings({wallpaperLibrary:current.wallpaperLibrary.filter(item=>item.id!==id),
    ...(selected?{customBackground:null,...(current.background==='custom'?{background:DEFAULT_SCENE_ID}:{})}:{})})
}
export function saveTheme(name:string):Settings {
  const current=getState().settings;name=themeName(name)
  if(current.savedThemes.length>=LIBRARY_LIMIT)throw Error('已保存 100 套主题，请先删除不需要的主题')
  if(current.savedThemes.some(theme=>theme.name===name))throw Error('已有同名主题，请换一个名称')
  const theme=captureTheme(current,name,crypto.randomUUID())
  return updateSettings({savedThemes:[...current.savedThemes,theme]})
}
export function applyTheme(id:string):Settings {
  const current=getState().settings
  return updateSettings(applyThemePatch(current,savedThemeById(current,id)))
}
export function renameTheme(id:string,name:string):Settings {
  const current=getState().settings;savedThemeById(current,id);name=themeName(name)
  if(current.savedThemes.some(theme=>theme.id!==id&&theme.name===name))throw Error('已有同名主题，请换一个名称')
  return updateSettings({savedThemes:current.savedThemes.map(theme=>theme.id===id?{...theme,name}:theme)})
}
export function removeTheme(id:string):Settings {
  const current=getState().settings;savedThemeById(current,id)
  return updateSettings({savedThemes:current.savedThemes.filter(theme=>theme.id!==id)})
}
export function exportTheme(id:string):{manifest:ThemeManifest;wallpaper:CustomBackground|null} {
  const current=getState().settings,theme=savedThemeById(current,id)
  const wallpaper=theme.wallpaper.type==='library'?wallpaperById(current,theme.wallpaper.id):null
  let descriptor:ThemeManifest['wallpaper']
  if(wallpaper){
    let extension:string
    try{extension=new URL(wallpaper.src).pathname.split('.').pop()!.toLowerCase()}catch{throw Error('壁纸文件地址无效，请重新导入')}
    if(!(wallpaper.kind==='video'?['mp4','webm']:['png','jpg','jpeg','webp']).includes(extension))throw Error('壁纸文件格式不支持导出')
    descriptor={type:'embedded',file:'wallpaper.'+extension,name:wallpaper.name,kind:wallpaper.kind}
  }else{
    if(theme.wallpaper.type!=='builtin')throw Error('主题壁纸已不存在')
    descriptor=theme.wallpaper
  }
  return {manifest:parseThemeManifest({format:'xinhai-theme',version:1,name:theme.name,appearance:theme.appearance,wallpaper:descriptor}),wallpaper}
}
export function importTheme(value:unknown,wallpaper:CustomBackground|null):Settings {
  const manifest=parseThemeManifest(value),current=getState().settings
  if(current.savedThemes.length>=LIBRARY_LIMIT)throw Error('已保存 100 套主题，请先删除不需要的主题')
  let staged=current,reference:SavedTheme['wallpaper']
  if(manifest.wallpaper.type==='embedded'){
    if(!wallpaper||wallpaper.kind!==manifest.wallpaper.kind)throw Error('主题壁纸附件缺失或类型不符')
    staged={...current,...rememberWallpaper(current,wallpaper)}
    reference={type:'library',id:staged.customBackground!.id!}
  }else{
    if(wallpaper)throw Error('内置主题不应附带本地文件')
    reference={type:'builtin',id:manifest.wallpaper.id}
  }
  let name=manifest.name,index=2
  while(staged.savedThemes.some(theme=>theme.name===name))name=[...manifest.name].slice(0,32).join('')+' '+index++
  const theme:SavedTheme={id:crypto.randomUUID(),name,createdAt:Date.now(),appearance:manifest.appearance,wallpaper:reference}
  return updateSettings({wallpaperLibrary:staged.wallpaperLibrary,savedThemes:[...staged.savedThemes,theme],...applyThemePatch(staged,theme)})
}
