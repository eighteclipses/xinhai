export interface LlmReply {
  status: number
  body: string
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmRequestBody {
  model: string
  messages: LlmMessage[]
  temperature?: number
  max_tokens?: number
  response_format?: { type: 'json_object' }
}

export const MAX_LLM_REPLY_BYTES = 4 * 1024 * 1024

function parseError(message: string): never {
  // Deliberately never include status text, response bodies, or request data.
  throw Error(message)
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

/**
 * Validate one already-received chat response and return its first message.
 * This function performs no network I/O and never places a remote body in an
 * exception, log, or user-facing error.
 */
export function parseLlmReply(reply: LlmReply): string {
  if (!reply || typeof reply !== 'object' || !Number.isInteger(reply.status) || typeof reply.body !== 'string') {
    return parseError('模型服务返回格式无效。')
  }
  if (reply.status < 200 || reply.status >= 300) parseError('模型服务暂时无法完成请求。')
  if (utf8Bytes(reply.body) > MAX_LLM_REPLY_BYTES) parseError('模型服务响应过大。')

  let value: unknown
  try { value = JSON.parse(reply.body) } catch { parseError('模型服务返回不是有效 JSON。') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) parseError('模型服务返回格式无效。')
  const choices = (value as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) parseError('模型服务返回格式无效。')
  const first = choices[0]
  if (!first || typeof first !== 'object' || Array.isArray(first)) parseError('模型服务返回格式无效。')
  const message = (first as { message?: unknown }).message
  if (!message || typeof message !== 'object' || Array.isArray(message)) parseError('模型服务返回格式无效。')
  const content = (message as { content?: unknown }).content
  if (typeof content !== 'string') parseError('模型服务返回格式无效。')
  return content
}
