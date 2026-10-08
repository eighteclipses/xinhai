import { COMMERCIAL_EDITION } from '../shared/edition'
import { requireModelAnalysis, LOCAL_ANALYSIS_ONLY_MESSAGE } from '../shared/modelScope'
import { PERSONAL_JOURNAL_PROMPT } from './personalScoringPrompt'
import { scoreLocal } from '../shared/localScoring'
export { scoreLocal } from '../shared/localScoring'
import { parseLlmReply } from '../shared/llmTransport'
import type { ModelClient, JournalAnalysisMode } from '../shared/modelConfig'
import { DIMENSIONS, DIMENSION_NAMES, type DimensionId, type ScoreResult, type EvidenceItem } from '../shared/types'

// One structured response contains scores, reasons and a summary.
async function completeJson(client:ModelClient, system:string, user:string):Promise<Record<string,unknown>> {
  const call=async(withFormat:boolean):Promise<Record<string,unknown>>=>{
    const reply=await client.request({messages:[{role:'system',content:system},{role:'user',content:user}],json:withFormat,maxTokens:1024})
    if(reply.status<200||reply.status>=300)throw Object.assign(Error('模型服务暂时不可用'),{status:reply.status})
    const content=parseLlmReply(reply)
    const cleaned = content.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '')
    return JSON.parse(cleaned) as Record<string, unknown>
  }
  try {
    return await call(true)
  } catch (error) {
    // Retry only a rejected JSON-format option, never auth, quota or network errors.
    if (![400,422].includes(Number((error as {status?:number}).status))) throw error
    return await call(false)
  }
}

function clampScore(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(5, Math.round(n)))
}

export async function scoreLLM(text: string, client:ModelClient): Promise<ScoreResult> {
  requireModelAnalysis()
  const result = await completeJson(client, PERSONAL_JOURNAL_PROMPT, `日记：\n${text}`)

  const rawScores = (result.scores && typeof result.scores === 'object' ? result.scores : result) as Record<string, unknown>
  const rawReasons = (result.reasons && typeof result.reasons === 'object' ? result.reasons : {}) as Record<string, unknown>
  if(!DIMENSIONS.every(d=>rawScores[d]!==null&&rawScores[d]!==''&&rawScores[d]!==undefined&&Number.isFinite(Number(rawScores[d]))))throw Error('模型返回的五维结果不完整')

  const scores = {} as Record<DimensionId, number>
  const reasons = {} as Record<DimensionId, string>
  for (const dim of DIMENSIONS) {
    scores[dim] = clampScore(rawScores[dim])
    const reason = String(rawReasons[dim] ?? '').slice(0, 60)
    reasons[dim] = reason || (scores[dim] > 0 ? `有${DIMENSION_NAMES[dim]}证据` : '未提及明确行为证据')
  }

  const insufficient = text.trim().length < 20
  if (insufficient) for (const dim of DIMENSIONS) scores[dim] = 0

  const summary = String(result.summary ?? '').slice(0, 120)
  return {
    engine: 'llm',
    insufficient,
    scores,
    reasons,
    summary: insufficient ? '今日文字太短，无法可靠判断，未强行给分。' : summary || makeSummary(scores, insufficient),
    evidence: [] as EvidenceItem[]
  }
}

export async function scoreJournal(text: string, client:ModelClient, opts?: { minText?: number; mode?:JournalAnalysisMode }): Promise<ScoreResult> {
  if(typeof text!=='string'||text.length>30000)throw Error('日记内容无效或过长')
  if(opts?.mode!==undefined&&opts.mode!=='local'&&opts.mode!=='model')throw Error('请选择有效的分析方式')
  if(opts?.mode==='model')requireModelAnalysis()
  // Local analysis never reads credentials or contacts a model, even if a Key exists.
  if(opts?.mode==='local'||(COMMERCIAL_EDITION&&opts?.mode===undefined))return scoreLocal(text,opts?.minText)
  let status
  try{status=await client.status()}catch{return {...scoreLocal(text,opts?.minText),fallbackReason:'unavailable'}}
  if (status.configured) {
    try {
      if(!status.available)throw Error('模型配置暂不可用')
      return await scoreLLM(text, client)
    } catch {
      // LLM 失败时回退本地规则
      return {...scoreLocal(text, opts?.minText),fallbackReason:'unavailable'}
    }
  }
  return {...scoreLocal(text, opts?.minText),fallbackReason:'not-configured'}
}

function makeSummary(scores: Record<DimensionId, number>, insufficient: boolean): string {
  if (insufficient) {
    return '今日文字中的行为证据不足，无法可靠判断，未强行给分。'
  }
  const ranked = DIMENSIONS.filter((d) => scores[d] > 0).sort((a, b) => scores[b] - scores[a])
  if (ranked.length === 0) return '今天没有明显的可计分行动，记录下来也是一种看见。'
  const top = ranked.slice(0, 2).map((d) => DIMENSION_NAMES[d]).join('与')
  return `今天最明显的成长是${top}。`
}

export async function testLLMConnection(client:ModelClient):Promise<{ok:boolean;message:string;model?:string;elapsedMs:number}>{
 const start=Date.now()
 if(COMMERCIAL_EDITION)return {ok:false,message:LOCAL_ANALYSIS_ONLY_MESSAGE,elapsedMs:0}
 try{
  const status=await client.status()
  if(!status.configured)return {ok:false,message:'请先保存 API Key。',elapsedMs:Date.now()-start}
  if(!status.available)return {ok:false,message:status.message||'密钥保护服务暂不可用，请重试。',elapsedMs:Date.now()-start}
  const response=await client.request({messages:[{role:'user',content:'Reply only OK.'}],json:false,maxTokens:8})
  if(response.status<200||response.status>=300){const messages:Record<number,string>={401:'密钥无效或已失效',402:'账户余额不足',403:'当前请求无访问权限',404:'接口或模型不存在，请核对实际请求地址与模型名称',429:'请求过于频繁，请稍后重试'};return {ok:false,message:`HTTP ${response.status} · ${messages[response.status]||'服务暂时无法完成请求，请检查地址与模型'}`,elapsedMs:Date.now()-start}}
  parseLlmReply(response)
  return {ok:true,message:'连接成功，已收到模型响应。',model:status.model,elapsedMs:Date.now()-start}
 }catch(error){return {ok:false,message:(error as Error).name==='TimeoutError'?'连接超时，请检查网络后重试。':'无法连接，请检查 API 地址和网络。',elapsedMs:Date.now()-start}}
}
