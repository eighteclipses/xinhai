import { chatEndpoint } from './llmEndpoint'

export interface ModelStatus { endpoint:string; model:string; configured:boolean; available:boolean; message:string }
export type JournalAnalysisMode = 'local' | 'model'
export interface ModelSaveInput { endpoint:string; model:string; key?:string|null }
export interface ModelRequest {
  messages:Array<{role:'system'|'user';content:string}>
  json:boolean
  maxTokens:number
}
export interface ModelReply { status:number; body:string }
export interface ModelClient {
  status():Promise<ModelStatus>
  save(input:ModelSaveInput):Promise<ModelStatus>
  clear():Promise<ModelStatus>
  request(input:ModelRequest):Promise<ModelReply>
}
export function validateModelSave(value:unknown):ModelSaveInput {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('模型配置格式无效')
  const v=value as Record<string,unknown>
  if(Object.keys(v).some(k=>!['endpoint','model','key'].includes(k))||typeof v.endpoint!=='string'||v.endpoint.length>2048||typeof v.model!=='string')throw Error('模型配置字段无效')
  const endpoint=chatEndpoint(v.endpoint),model=v.model.trim()||'deepseek-chat'
  if(model.length>200||/[\u0000-\u001f\u007f]/.test(model))throw Error('模型名称无效')
  if(v.key!==undefined&&v.key!==null&&(typeof v.key!=='string'||!v.key.trim()||v.key.length>8192||/[\u0000-\u0020\u007f]/.test(v.key)))throw Error('密钥不能为空或包含空白字符')
  return {endpoint,model,...(v.key!==undefined?{key:v.key as string|null}:{})}
}
export function validateModelRequest(value:unknown):ModelRequest {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('模型请求无效')
  const v=value as Record<string,unknown>
  if(Object.keys(v).length!==3||!Array.isArray(v.messages)||v.messages.length<1||v.messages.length>2||typeof v.json!=='boolean'||typeof v.maxTokens!=='number'||!Number.isSafeInteger(v.maxTokens)||v.maxTokens<1||v.maxTokens>2048)throw Error('模型请求字段无效')
  for(const m of v.messages)if(!m||typeof m!=='object'||Object.keys(m).length!==2||!['system','user'].includes(m.role)||typeof m.content!=='string'||m.content.length>30000)throw Error('模型请求正文无效')
  if(new TextEncoder().encode(JSON.stringify(v)).length>128*1024)throw Error('模型请求内容过长')
  return value as ModelRequest
}
