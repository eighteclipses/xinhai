export const HOME_MODULE_IDS=['welcome','date','focus','shortcuts','recent','agenda','today','growth'] as const
export type HomeModuleId=typeof HOME_MODULE_IDS[number]
export type HomeLayoutProfile='wide'|'compact'|'narrow'
export interface HomeLayoutItem{id:HomeModuleId;x:number;y:number;w:number;h:number;hidden:boolean}
export interface LegacyHomeLayouts{version:1;wide?:HomeLayoutItem[];compact?:HomeLayoutItem[];narrow?:HomeLayoutItem[]}
export interface FreeHomeItem{id:HomeModuleId;dx:number;dy:number;scale:number}
export interface FreeHomeLayouts{version:2;wide?:FreeHomeItem[];compact?:FreeHomeItem[];narrow?:FreeHomeItem[]}
export type HomeLayouts=LegacyHomeLayouts|FreeHomeLayouts
export const HOME_MODULE_LABELS:Record<HomeModuleId,string>={welcome:'问候',date:'日期',focus:'下一段专注',shortcuts:'快捷入口',recent:'上次专注',agenda:'接下来的安排',today:'今日足迹',growth:'心之成长'}
const profiles:HomeLayoutProfile[]=['wide','compact','narrow']
const columns={wide:12,compact:8,narrow:4}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const overlap=(a:HomeLayoutItem,b:HomeLayoutItem)=>!a.hidden&&!b.hidden&&a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y
export function homeLayoutProfile(width:number):HomeLayoutProfile{return width>=1000?'wide':width>=600?'compact':'narrow'}
/** Validate without converting or mutating historical backup snapshots. */
export function parseHomeLayouts(value:unknown):HomeLayouts{
 if(!record(value)||(value.version!==1&&value.version!==2)||Object.keys(value).some(k=>!['version',...profiles].includes(k)))throw Error('首页布局格式无效')
 const result:Record<string,unknown>={version:value.version}
 for(const profile of profiles){
  if(!Object.hasOwn(value,profile))continue
  const rows=value[profile];if(!Array.isArray(rows)||rows.length>8)throw Error('首页模块列表无效')
  const seen=new Set<string>()
  const items=rows.map(row=>{
   if(!record(row)||!HOME_MODULE_IDS.includes(row.id as HomeModuleId)||seen.has(String(row.id)))throw Error('首页模块无效')
   seen.add(String(row.id))
   if(value.version===1){
    if(Object.keys(row).sort().join(',')!=='h,hidden,id,w,x,y'||typeof row.hidden!=='boolean')throw Error('旧首页模块格式无效')
    for(const k of ['x','y','w','h'])if(!Number.isSafeInteger(row[k]))throw Error('旧首页坐标无效')
    const a=row as unknown as HomeLayoutItem
    if(a.x<0||a.y<0||a.w<1||a.h<1||a.h>24||a.x+a.w>columns[profile]||a.y+a.h>256)throw Error('旧首页坐标超出边界')
   }else{
    if(Object.keys(row).sort().join(',')!=='dx,dy,id,scale')throw Error('自由布局模块格式无效')
    for(const k of ['dx','dy','scale'])if(typeof row[k]!=='number'||!Number.isFinite(row[k]))throw Error('自由布局坐标无效')
    if(Math.abs(row.dx as number)>10000||Math.abs(row.dy as number)>10000||(row.scale as number)<.65||(row.scale as number)>2)throw Error('自由布局超出边界')
   }
   return {...row}
  })
  if(value.version===1&&(items as unknown as HomeLayoutItem[]).some((a,i)=>items.slice(i+1).some(b=>overlap(a,b as unknown as HomeLayoutItem))))throw Error('旧首页模块不能重叠')
  result[profile]=items
 }
 return result as unknown as HomeLayouts
}
/** Intermediate grid preferences remain in storage, but never redesign the original home. */
export function normalizeHomeLayouts(value:unknown):FreeHomeLayouts{
 const result:FreeHomeLayouts={version:2}
 if(!record(value)||value.version!==2)return result
 for(const p of profiles)if(Object.hasOwn(value,p)){try{result[p]=(parseHomeLayouts({version:2,[p]:value[p]}) as FreeHomeLayouts)[p]}catch{}}
 return result
}
export function freeHomeItem(layout:FreeHomeLayouts,p:HomeLayoutProfile,id:HomeModuleId):FreeHomeItem{return layout[p]?.find(i=>i.id===id)??{id,dx:0,dy:0,scale:1}}
export function changeFreeHomeItem(layout:FreeHomeLayouts,p:HomeLayoutProfile,item:FreeHomeItem):FreeHomeLayouts{
 const rows=(layout[p]??[]).filter(i=>i.id!==item.id)
 if(item.dx!==0||item.dy!==0||item.scale!==1)rows.push({...item})
 return {...layout,[p]:rows}
}
