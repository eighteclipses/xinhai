const DEFAULT_ENDPOINT = 'https://api.deepseek.com'
const LOOPBACK_AUTHORITY = /^(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i
const LOCALHOST_AUTHORITY = /^localhost(?::[0-9]{1,5})?$/i

function invalidAddress(): never {
  throw Error('API 地址无效，请使用 HTTPS 地址；本机 HTTP 服务仅允许回环地址。')
}

function authorityOf(raw: string): string {
  const match = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/.exec(raw)
  if (!match || !match[1]) invalidAddress()
  return match[1]
}

function utf8HasUnsafeControl(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value)
}

// Accept provider base URLs and full OpenAI-compatible chat endpoints.
// External services must use HTTPS. Plain HTTP is intentionally restricted to
// an explicitly written loopback authority before URL canonicalisation, so
// integer, octal, abbreviated and trailing-dot IP spellings cannot become a
// loopback address after WHATWG URL parsing.
export function chatEndpoint(input: string): string {
  if (typeof input !== 'string') invalidAddress()
  const raw = input.trim() || DEFAULT_ENDPOINT
  if (utf8HasUnsafeControl(raw) || raw.includes('\\')) invalidAddress()
  if (raw.includes('?') || raw.includes('#')) throw Error('API 地址不能包含查询参数或片段。')

  const authority = authorityOf(raw)
  if (authority.includes('@')) invalidAddress()
  if (/\//.test(authority) || /\s/.test(authority)) invalidAddress()
  if (/^localhost\.(?::[0-9]{1,5})?$/i.test(authority)) invalidAddress()

  let url: URL
  try { url = new URL(raw) } catch { invalidAddress() }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) invalidAddress()
  if (url.search || url.hash) throw Error('API 地址不能包含查询参数或片段。')
  if (!url.hostname || url.port && !/^\d+$/.test(url.port)) invalidAddress()
  if (url.pathname.includes('//')) invalidAddress()

  const isLoopback = LOOPBACK_AUTHORITY.test(authority)
  if (url.protocol === 'http:' && !isLoopback) invalidAddress()
  if (LOCALHOST_AUTHORITY.test(authority)) url.hostname = '127.0.0.1'

  const basePath = url.pathname.replace(/\/+$/, '')
  url.pathname = basePath.endsWith('/chat/completions')
    ? basePath
    : basePath + '/chat/completions'
  url.search = ''
  url.hash = ''
  return url.toString()
}
