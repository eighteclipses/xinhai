const assert = require('node:assert/strict')
const Module = require('node:module')
const { buildSync } = require('esbuild')

const root = require('node:path').resolve(__dirname, '..')
const built = buildSync({
  stdin: {
    contents: "export * from './src/shared/llmEndpoint'; export * from './src/shared/llmTransport'",
    resolveDir: root,
    sourcefile: 'llm-qa-entry.ts'
  },
  bundle: true,
  platform: 'node',
  target: 'es2022',
  format: 'cjs',
  write: false
})
const mod = new Module(__filename, module)
mod.filename = __filename
mod.paths = module.paths
mod._compile(built.outputFiles[0].text, __filename)
const api = mod.exports

function assertSafeReject(input) {
  const secret = 'secret-api-key'
  assert.throws(() => api.chatEndpoint(input.replace('__SECRET__', secret)), error => {
    const message = String(error)
    return !message.includes(input) && !message.includes(secret)
  }, `unsafe endpoint accepted or error leaked input: ${input}`)
}

const endpointCases = [
  ['', 'https://api.deepseek.com/chat/completions'],
  [' https://api.deepseek.com/ ', 'https://api.deepseek.com/chat/completions'],
  ['https://api.example.test/v1', 'https://api.example.test/v1/chat/completions'],
  ['https://api.example.test/v1/chat/completions/', 'https://api.example.test/v1/chat/completions'],
  ['http://127.0.0.1:43123/v1', 'http://127.0.0.1:43123/v1/chat/completions'],
  ['http://localhost:43123/v1', 'http://127.0.0.1:43123/v1/chat/completions'],
  ['http://[::1]:43123/v1', 'http://[::1]:43123/v1/chat/completions'],
  ['https://localhost:43123/v1', 'https://127.0.0.1:43123/v1/chat/completions']
]
for (const [input, expected] of endpointCases) assert.equal(api.chatEndpoint(input), expected)

for (const input of [
  'http://example.test/v1',
  'http://localhost./v1',
  'http://127.0.0.1./v1',
  'http://2130706433/v1',
  'http://0177.0.0.1/v1',
  'http://127.1/v1',
  'http://0x7f000001/v1',
  'http://user:__SECRET__@127.0.0.1/v1',
  'http:\\127.0.0.1\\v1',
  'http:///127.0.0.1/v1',
  'http://127.0.0.1//v1',
  'https://api.example.test/v1?api_key=__SECRET__',
  'https://api.example.test/v1#__SECRET__',
  'file:///tmp/model',
  'ftp://api.example.test/v1'
]) assertSafeReject(input)

const goodContent = '{"scores":{"knowledge":1},"summary":"ok"}'
assert.equal(api.parseLlmReply({
  status: 200,
  body: JSON.stringify({ choices: [{ message: { content: goodContent } }] })
}), goodContent)
assert.equal(api.parseLlmReply({
  status: 201,
  body: JSON.stringify({ choices: [{ message: { content: '' } }] })
}), '')

function assertReplyReject(reply, expectedText) {
  assert.throws(() => api.parseLlmReply(reply), error => {
    const message = String(error)
    return message.includes(expectedText) && !message.includes('REMOTE-SECRET') && !message.includes('raw provider body')
  })
}

assertReplyReject({ status: 302, body: 'REMOTE-SECRET raw provider body' }, '暂时无法完成请求')
assertReplyReject({ status: 500, body: JSON.stringify({ error: 'REMOTE-SECRET raw provider body' }) }, '暂时无法完成请求')
assertReplyReject({ status: 200, body: 'REMOTE-SECRET raw provider body' }, '不是有效 JSON')
assertReplyReject({ status: 200, body: JSON.stringify({ choices: [] }) }, '返回格式无效')
assertReplyReject({ status: 200, body: JSON.stringify({ choices: [{}] }) }, '返回格式无效')
assertReplyReject({ status: 200, body: JSON.stringify({ choices: [{ message: {} }] }) }, '返回格式无效')
assertReplyReject({ status: 200, body: JSON.stringify({ choices: [{ message: { content: { secret: 'REMOTE-SECRET' } } }] }) }, '返回格式无效')
assertReplyReject({ status: 204, body: '' }, '不是有效 JSON')
assertReplyReject({ status: 200, body: 'x'.repeat(4 * 1024 * 1024 + 1) }, '响应过大')
assertReplyReject({ status: 200, body: '界'.repeat(Math.ceil((4 * 1024 * 1024) / 3)) }, '响应过大')
assertReplyReject({ status: 200, body: { choices: [] } }, '返回格式无效')

console.log('PASS endpoint normalization and strict loopback/HTTPS policy')
console.log('PASS response parser rejects redirects, HTTP errors, malformed/oversize bodies without echoing remote content')
