const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')
const { buildSync } = require('esbuild')

const root = path.resolve(__dirname, '..')
let handler, listen
const fakeHttp = {
  createServer(callback) {
    handler = callback
    return {
      on() {},
      listen(port, host, ready) { listen = { port, host }; ready() }
    }
  }
}
const originalLoad = Module._load
Module._load = function(name, ...args) { return name === 'node:http' ? fakeHttp : originalLoad.call(this, name, ...args) }
const prior = Object.fromEntries(['XINHAI_ENABLE_SNAPSHOT', 'XINHAI_SNAPSHOT_TOKEN'].map(key => [key, process.env[key]]))
try {
  const built = buildSync({ entryPoints: [path.join(root, 'src/main/snapshot.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'] })
  const filename = path.join(__dirname, '.snapshot-fixture.cjs')
  const fixture = new Module(filename, module)
  fixture.filename = filename
  fixture.paths = module.paths
  fixture._compile(built.outputFiles[0].text, filename)
  const { startSnapshotServer } = fixture.exports
  const client = { status: async () => ({ configured: false }), request: async () => { throw Error('Unexpected network request') } }
  delete process.env.XINHAI_ENABLE_SNAPSHOT
  delete process.env.XINHAI_SNAPSHOT_TOKEN
  startSnapshotServer(() => null, client)
  assert.equal(handler, undefined, 'default source launch must not open a listener')
  process.env.XINHAI_ENABLE_SNAPSHOT = '1'
  startSnapshotServer(() => null, client)
  assert.equal(handler, undefined, 'missing token must not open a listener')
  const token = 'fixture-'.repeat(5)
  process.env.XINHAI_SNAPSHOT_TOKEN = token
  startSnapshotServer(() => null, client)
  assert.deepEqual(listen, { port: 7391, host: '127.0.0.1' })
  function call(authorization, method = 'OPTIONS', url = '/snapshot') {
    const req = Object.assign(new EventEmitter(), { method, url, headers: authorization ? { authorization } : {} })
    const res = { headers: {}, status: 0, body: undefined, setHeader(key, value) { this.headers[key] = value }, writeHead(status) { this.status = status }, end(body) { this.body = body } }
    handler(req, res)
    return { req, res }
  }
  assert.equal(call().res.status, 401)
  assert.equal(call('Bearer wrong').res.status, 401)
  assert.equal(call(`Bearer ${token}`).res.status, 204)
  assert.equal(call(`Bearer ${token}`, 'POST', '/snapshot-extra').res.status, 404)
  const unauthorized = call()
  assert.equal(unauthorized.res.headers['Access-Control-Allow-Origin'], undefined)
  assert.equal(unauthorized.res.headers['Cache-Control'], 'no-store')
  console.log('PASS snapshot disabled by default; explicit token, loopback bind, auth, exact route and no wildcard CORS')
} finally {
  Module._load = originalLoad
  for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
