import type { DatabaseSnapshot } from './backupDatabase'
import { makePortableBackup, materializeBackup, validatePortableBackup } from './backupArchive'
import type { BackupPreview, BackupRestoreResult, PortableBackup, PreparedBackup } from './backupArchiveTypes'

interface BackupHost {
  capture(client:Record<string,string>):DatabaseSnapshot
  context():Promise<{knowledgeRoot:string}>
  export(portable:PortableBackup,knowledgeRoot:string,safety:boolean):Promise<string|null>
  prepare():Promise<PreparedBackup|null>
  verify(ticket:string):Promise<void>
  finish(ticket:string,keep:boolean):Promise<void>
  hasActiveFocus():boolean
  pauseSync():Promise<()=>Promise<void>>
  replace(snapshot:DatabaseSnapshot,prepared:PreparedBackup):void
  resetSync():void
}
export function createBackupController(host:BackupHost){
  let busy=false,restoring=false
  const pending=new Map<string,PreparedBackup>()
  async function exclusive<T>(work:()=>Promise<T>):Promise<T>{if(busy)throw Error('请先完成当前备份操作');busy=true;try{return await work()}finally{busy=false}}
  const exportCurrent=async(client:Record<string,string>,safety:boolean)=>{
    const context=await host.context(),snapshot=host.capture(client),portable=makePortableBackup(snapshot,context.knowledgeRoot)
    return host.export(portable,context.knowledgeRoot,safety)
  }
  return {
    get isBusy(){return busy},
    get isRestoring(){return restoring},
    export:(client:Record<string,string>)=>exclusive(()=>exportCurrent(client,false)),
    prepare:()=>exclusive(async():Promise<BackupPreview|null>=>{
      for(const [id] of pending){try{await host.finish(id,false)}finally{pending.delete(id)}}
      const prepared=await host.prepare();if(!prepared)return null
      try{
        validatePortableBackup(prepared.snapshot,prepared.manifest)
        if(typeof prepared.ticket!=='string'||!prepared.ticket)throw Error('恢复票据缺失')
        pending.set(prepared.ticket,prepared)
        const visible=['journals','focus_sessions','growth_events','todos','habits','habit_logs','events','review_cards','review_logs']
        const counts=Object.fromEntries(Object.entries(prepared.snapshot.tables).filter(([table])=>visible.includes(table)).map(([table,rows])=>[table,rows.length]))
        const settings=JSON.parse(String(prepared.snapshot.tables.settings[0].json))
        counts.knowledge=prepared.manifest.files.filter(f=>f.kind==='knowledge').length
        counts.wallpapers=settings.wallpaperLibrary.length;counts.themes=settings.savedThemes.length;counts.music=prepared.snapshot.tables.music_imports.length
        const warnings=['恢复会替换当前记录、设置、当前知识库与媒体清单；先保存当前资料的安全副本。','目标设备原有模型配置保留；局域网配对会清除，需要重新配对。']
        if(prepared.snapshot.tables.focus_recovery.length)warnings.push('备份包含未结束的专注，恢复后仍需选择如何处理离开期间。')
        if(prepared.snapshot.tables.review_cards.some(c=>c.sourceRoot!==''&&c.sourceRoot!=='xinhai-backup://knowledge'))warnings.push('部分复习卡来源不在当前知识库中；卡片正文保留，原来源文件没有纳入本备份。')
        return {ticket:prepared.ticket,createdAt:prepared.manifest.createdAt,appVersion:prepared.manifest.appVersion,files:prepared.manifest.files.length,bytes:prepared.manifest.files.reduce((sum,f)=>sum+f.size,0),counts,warnings}
      }catch(error){await host.finish(prepared.ticket,false);throw error}
    }),
    cancel:(ticket:string)=>exclusive(async()=>{if(!pending.has(ticket))return;try{await host.finish(ticket,false)}finally{pending.delete(ticket)}}),
    restore:(ticket:string,confirmation:string,client:Record<string,string>)=>exclusive(async():Promise<BackupRestoreResult|null>=>{
      if(confirmation!=='恢复备份')throw Error('请输入“恢复备份”确认替换当前资料')
      const prepared=pending.get(ticket);if(!prepared)throw Error('备份预览已失效，请重新选择文件')
      if(host.hasActiveFocus())throw Error('请先结束当前专注或休息，再恢复备份')
      restoring=true;let committed=false,resume:undefined|(()=>Promise<void>)
      try{
        resume=await host.pauseSync()
        const safetyBackup=await exportCurrent(client,true)
        if(!safetyBackup)return null
        await host.verify(ticket)
        const snapshot=materializeBackup(prepared.snapshot,prepared.manifest,prepared.resources)
        host.replace(snapshot,prepared);committed=true;pending.delete(ticket)
        // After commit, failure to retire a receipt must never delete now-live files.
        try{await host.finish(ticket,true)}catch(error){console.error('Backup receipt retirement deferred',error)}
        host.resetSync()
        return {safetyBackup}
      }catch(error){
        if(!committed){try{await host.finish(ticket,false)}catch(cleanup){console.error('Backup staging cleanup deferred',cleanup)}finally{pending.delete(ticket)}}
        throw error
      }finally{
        restoring=false
        if(!committed&&resume)await resume()
      }
    })
  }
}
