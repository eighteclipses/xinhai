import { parseDatabaseSnapshot, validateDatabaseSnapshot, type DatabaseSnapshot } from './backupDatabase'
import { BACKUP_ARCHIVE_LIMIT, BACKUP_DATABASE_LIMIT, BACKUP_FILE_COUNT_LIMIT, BACKUP_FILE_LIMIT, BACKUP_ROOT, backupMediaRef, type BackupManifest, type BackupMediaSource, type BackupRestoreResources, type PortableBackup } from './backupArchiveTypes'

const IMAGE=['png','jpg','jpeg','webp'],VIDEO=['mp4','webm'],MUSIC=['mp3','ogg','wav','flac','m4a','aac','opus']
const builtinPoster=/^backgrounds\/originals\/(?:deep-sea|forest-dawn|orbital-night)\.png$/
const idPattern=/^m\d{6}$/
const fail=(message:string):never=>{throw Error('备份无效：'+message)}
const object=(v:unknown):Record<string,any>=>{if(!v||typeof v!=='object'||Array.isArray(v))return fail('对象结构损坏');return v as Record<string,any>}
const exact=(v:Record<string,unknown>,keys:string[])=>{if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail('字段不匹配')}
const int=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v))

export function safeBackupPath(value:unknown):string {
  if(typeof value!=='string'||!value||value.length>1024||value.includes('\\')||value.startsWith('/')||value.endsWith('/'))return fail('附件路径无效')
  for(const segment of value.split('/')){
    if(!segment||segment==='.'||segment==='..'||segment.length>200||/[<>:"|?*\u0000-\u001f\u007f]/.test(segment)||/[. ]$/.test(segment)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(segment))fail('附件路径不兼容或越界')
  }
  return value
}
export function backupPathKey(path:string):string {return path.normalize('NFC').toLowerCase()}
export function validateBackupManifest(value:unknown):BackupManifest {
  const m=object(value);exact(m,['format','version','appVersion','createdAt','files','directories'])
  if(m.format!=='xinhai-backup'||m.version!==1||typeof m.appVersion!=='string'||!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(m.appVersion)||!int(m.createdAt,1,Number.MAX_SAFE_INTEGER))fail('不支持的归档格式或版本')
  if(!Array.isArray(m.files)||!m.files.length||m.files.length>BACKUP_FILE_COUNT_LIMIT||!Array.isArray(m.directories)||m.directories.length>BACKUP_FILE_COUNT_LIMIT)fail('文件或目录数量无效')
  const paths=new Set<string>(),files=new Set<string>(),ids=new Set<string>();let total=0,database=0
  for(const entry of m.files){
    const f=object(entry),media=f.kind==='wallpaper'||f.kind==='music'
    exact(f,media?['path','kind','size','sha256','id']:['path','kind','size','sha256'])
    const p=safeBackupPath(f.path),key=backupPathKey(p)
    if(paths.has(key))fail('附件路径重复或大小写冲突');paths.add(key);files.add(key)
    if(!int(f.size,0,BACKUP_FILE_LIMIT)||typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256))fail('附件大小或校验值无效')
    total+=f.size;if(total>BACKUP_ARCHIVE_LIMIT)fail('展开后的文件超过 2 GiB')
    if(f.kind==='database'){if(p!=='database.json'||f.size===0||f.size>BACKUP_DATABASE_LIMIT)fail('数据库文件无效或超过 16 MiB');database++}
    else if(media){
      if(typeof f.id!=='string'||!idPattern.test(f.id)||ids.has(f.id))fail('媒体编号重复或无效');ids.add(f.id)
      const ext=p.split('.').at(-1)!
      if(p!==`media/${f.id}.${ext}`||!(f.kind==='music'?MUSIC:[...IMAGE,...VIDEO]).includes(ext)||!f.size)fail('媒体附件格式无效')
    }else if(f.kind!=='knowledge'||!p.startsWith('knowledge/'))fail('未知附件类型')
  }
  if(database!==1)fail('必须有唯一的数据库文件')
  for(const v of m.directories){const p=safeBackupPath(v),key=backupPathKey(p);if(!p.startsWith('knowledge/')||paths.has(key))fail('目录重复或路径冲突');paths.add(key)}
  for(const p of paths){const parts=p.split('/');while(parts.length>1){parts.pop();if(files.has(parts.join('/')))fail('文件和子目录路径冲突')}}
  return value as BackupManifest
}

function settings(snapshot:DatabaseSnapshot):Record<string,any>{return JSON.parse(String(snapshot.tables.settings[0].json))}
function editRoots(snapshot:DatabaseSnapshot,from:string,to:string):void {
  const replaceCards=(rows:Array<Record<string,any>>)=>{for(const card of rows)if(card.sourceRoot===from)card.sourceRoot=to}
  replaceCards(snapshot.tables.review_cards)
  for(const row of snapshot.tables.growth_resets){if(!row.practice_json)continue;const practice=JSON.parse(String(row.practice_json));replaceCards(practice.before.review_cards);const after=JSON.parse(practice.after);replaceCards(after.review_cards);practice.after=JSON.stringify(after);row.practice_json=JSON.stringify(practice)}
  const next:Record<string,string>={}
  for(const [key,text] of Object.entries(snapshot.clientState)){
    let target=key,value=text
    if(key==='xinhai-review-draft-v1'){const draft=object(JSON.parse(text));if(draft.sourceRoot===from)draft.sourceRoot=to;value=JSON.stringify(draft)}
    else if(key.startsWith('xinhai-note:'+from+':'))target='xinhai-note:'+to+':'+key.slice(('xinhai-note:'+from+':').length)
    if(Object.hasOwn(next,target))fail('知识库草稿在路径转换后发生冲突，请先另存冲突草稿')
    next[target]=value
  }
  snapshot.clientState=next
}
function keyForSource(source:string):string {
  let p=source
  try{if(p.startsWith('file:'))p=decodeURIComponent(new URL(p).pathname).replace(/^\/([A-Za-z]:\/)/,'$1')}catch{fail('本机媒体路径损坏')}
  p=p.replaceAll('\\','/')
  return /^[A-Za-z]:\//.test(p)?p.toLowerCase():p
}
function extension(source:string):string {
  let p=source
  try{if(/^[a-z]+:\/\//i.test(source))p=decodeURIComponent(new URL(source).pathname)}catch{fail('媒体地址无效')}
  return p.split('.').at(-1)?.toLowerCase()||''
}
function walkWallpapers(s:Record<string,any>,map:(source:string)=>string):void {
  for(const wall of [...s.wallpaperLibrary,...(s.customBackground?[s.customBackground]:[])]){
    wall.src=map(wall.src)
    if(!builtinPoster.test(wall.poster))wall.poster=map(wall.poster)
  }
}
function musicState(snapshot:DatabaseSnapshot,map:(source:string)=>string|null):void {
  for(const key of ['xinhai-music-prefs','xinhai-music-resume']){
    const text=snapshot.clientState[key];if(!text)continue
    const row=object(JSON.parse(text))
    if(typeof row.file==='string'){
      const next=map(row.file)
      if(next!==null)row.file=next
      else if(key==='xinhai-music-resume'){delete snapshot.clientState[key];continue}
      else delete row.file
    }
    snapshot.clientState[key]=JSON.stringify(row)
  }
}
export function makePortableBackup(input:DatabaseSnapshot,knowledgeRoot:string):PortableBackup {
  const snapshot=clone(validateDatabaseSnapshot(input)),mediaSources:BackupMediaSource[]=[],sources=new Map<string,string>()
  const add=(source:string,kind:'wallpaper'|'music')=>{
    const key=keyForSource(source),previous=sources.get(key);if(previous)return previous
    const ext=extension(source);if(!(kind==='music'?MUSIC:[...IMAGE,...VIDEO]).includes(ext))fail('当前资料中有不支持的媒体格式')
    const id='m'+String(mediaSources.length+1).padStart(6,'0'),ref=backupMediaRef(id)
    mediaSources.push({id,kind,source,extension:ext});sources.set(key,ref)
    if(kind==='music'){const name=key.replaceAll('\\','/').split('/').at(-1);sources.set('https://app.xinhai.local/local/music/'+name,ref)}
    return ref
  }
  const s=settings(snapshot);walkWallpapers(s,source=>add(source,'wallpaper'));s.knowledgePath=BACKUP_ROOT;snapshot.tables.settings[0].json=JSON.stringify(s)
  for(const row of snapshot.tables.music_imports)row.path=add(String(row.path),'music')
  musicState(snapshot,source=>sources.get(keyForSource(source))??(/^netease:[1-9]\d*$/.test(source)?source:null))
  editRoots(snapshot,knowledgeRoot,BACKUP_ROOT)
  return {snapshot,mediaSources}
}

export function validatePortableBackup(value:unknown,manifestValue:unknown):DatabaseSnapshot {
  const manifest=validateBackupManifest(manifestValue)
  const text=JSON.stringify(value);if(new TextEncoder().encode(text).length>BACKUP_DATABASE_LIMIT)fail('数据库文件超过 16 MiB')
  const snapshot=parseDatabaseSnapshot(text),s=settings(snapshot)
  if(s.knowledgePath!==BACKUP_ROOT)fail('知识库根引用不是可迁移标识')
  const media=new Map(manifest.files.filter(f=>f.id).map(f=>[backupMediaRef(f.id!),f])),used=new Set<string>()
  const ref=(source:unknown,kind:'wallpaper'|'music')=>{if(typeof source!=='string'||!media.has(source)||media.get(source)!.kind!==kind)fail('媒体引用不在备份清单中');used.add(source as string);return source as string}
  // Validate without mutating the user's parsed data.
  walkWallpapers(s,source=>ref(source,'wallpaper'))
  for(const row of snapshot.tables.music_imports)ref(row.path,'music')
  for(const key of ['xinhai-music-prefs','xinhai-music-resume']){if(!snapshot.clientState[key])continue;const row=object(JSON.parse(snapshot.clientState[key]));if(row.file!==undefined&&!/^netease:[1-9]\d*$/.test(row.file))ref(row.file,'music')}
  if(used.size!==media.size)fail('清单包含未被资料引用的媒体')
  return snapshot
}
export function materializeBackup(input:DatabaseSnapshot,manifest:BackupManifest,resources:BackupRestoreResources):DatabaseSnapshot {
  const snapshot=clone(validatePortableBackup(input,manifest)),s=settings(snapshot)
  const mediaRef=(ref:string,field:'url'|'path')=>{const id=ref.slice('xinhai-backup://media/'.length);const target=resources.media[id];if(!target||typeof target[field]!=='string'||!target[field])return fail('恢复后的媒体映射缺失');return target[field]}
  walkWallpapers(s,ref=>mediaRef(ref,'url'));s.knowledgePath=resources.knowledgeRoot;snapshot.tables.settings[0].json=JSON.stringify(s)
  for(const row of snapshot.tables.music_imports)row.path=mediaRef(String(row.path),'path')
  musicState(snapshot,source=>source.startsWith('xinhai-backup://media/')?mediaRef(source,'url'):source)
  editRoots(snapshot,BACKUP_ROOT,resources.knowledgeRoot)
  return validateDatabaseSnapshot(snapshot)
}
