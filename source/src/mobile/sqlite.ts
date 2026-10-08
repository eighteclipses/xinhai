import { native } from './native'
class Statement {
  constructor(private sql:string){}
  private bind(args:unknown[]){
    if(args.length===1&&args[0]!==null&&typeof args[0]==='object'&&!Array.isArray(args[0])){
      const named=args[0] as Record<string,unknown>,values:unknown[]=[]
      const sql=this.sql.replace(/[@:$]([A-Za-z_][A-Za-z_0-9]*)/g,(_,name)=>{if(!(name in named))throw Error('缺少数据库参数');values.push(named[name]);return '?'})
      return {sql,values}
    }
    return {sql:this.sql,values:args}
  }
  run(...args:unknown[]){return native<{changes:number;lastInsertRowid:number}>('sqlRun',this.bind(args))}
  all(...args:unknown[]){return native<Record<string,unknown>[]>('sqlQuery',this.bind(args))}
  get(...args:unknown[]){return this.all(...args)[0]}
}
export default class Database {
  constructor(_file:string){}
  pragma(_value:string){}
  prepare(sql:string){return new Statement(sql)}
  exec(sql:string){native('sqlExec',{sql});return this}
  transaction<T extends unknown[],R>(fn:(...args:T)=>R){return (...args:T):R=>{
    native('sqlBegin')
    try{const result=fn(...args);native('sqlEnd',{success:true});return result}
    catch(error){native('sqlEnd',{success:false});throw error}
  }}
}
