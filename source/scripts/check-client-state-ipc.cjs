const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const esbuild = require('esbuild')

const entry = path.resolve(__dirname, '../src/main/windowSecurity.ts')
const listeners = new Map()
const fakeElectron = {
  ipcMain: {
    handle() { throw Error('unexpected invoke handler') },
    on(channel, listener) {
      const registered = listeners.get(channel) || []
      registered.push(listener)
      listeners.set(channel, registered)
    }
  },
  shell: { openExternal: async () => {} }
}

function loadWithMockElectron() {
  const result = esbuild.buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', target: 'node18', external: ['electron'], write: false, logLevel: 'silent' })
  const originalLoad = Module._load
  const loaded = new Module(entry, module)
  loaded.filename = entry
  loaded.paths = Module._nodeModulePaths(path.dirname(entry))
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return fakeElectron
    return originalLoad.call(this, request, parent, isMain)
  }
  try { loaded._compile(result.outputFiles[0].text, entry) }
  finally { Module._load = originalLoad }
  return loaded.exports
}

function eventFor(sender, senderFrame) {
  const writes = []
  const event = { sender, senderFrame }
  Object.defineProperty(event, 'returnValue', { set(value) { writes.push(value) }, get() { return writes.at(-1) } })
  return { event, writes }
}

async function main() {
  const security = loadWithMockElectron()
  const mainFrame = { url: 'file:///app.asar/out/renderer/index.html#section' }
  const webContents = { mainFrame, isDestroyed: () => false }
  const ipc = security.trustedIpc(() => ({ webContents, isDestroyed: () => false }), true, 'file:///app.asar/out/renderer/index.html')
  let handled = 0
  ipc.syncHandler('client-state:sync-test', (_event, request) => {
    handled++
    if (request?.fail) throw Error('injected storage failure')
    if (request?.async) return Promise.resolve('must not be acknowledged')
    return { value: request?.value ?? null }
  })

  const [listener] = listeners.get('client-state:sync-test') || []
  assert.equal(listeners.get('client-state:sync-test')?.length, 1, 'sync channel must register a single IPC listener')

  const trusted = eventFor(webContents, mainFrame)
  listener(trusted.event, { value: 'committed' })
  assert.equal(trusted.writes.length, 1, 'trusted request must write returnValue exactly once')
  assert.deepEqual(trusted.event.returnValue, { ok: true, value: { value: 'committed' } })
  assert.equal(handled, 1)

  const childFrame = eventFor(webContents, { url: mainFrame.url })
  listener(childFrame.event, { value: 'blocked' })
  assert.equal(childFrame.writes.length, 1, 'untrusted frame must receive a single explicit denial')
  assert.deepEqual(childFrame.event.returnValue, { ok: false, error: '拒绝来自非应用主页面的请求' })
  assert.equal(handled, 1, 'untrusted frame must never reach the storage handler')

  const otherWindow = eventFor({ mainFrame, isDestroyed: () => false }, mainFrame)
  listener(otherWindow.event, { value: 'blocked' })
  assert.equal(otherWindow.writes.length, 1)
  assert.equal(handled, 1, 'another WebContents must never reach the storage handler')

  const wrongUrlFrame = eventFor(webContents, { url: 'file:///other/index.html' })
  listener(wrongUrlFrame.event, { value: 'blocked' })
  assert.equal(wrongUrlFrame.writes.length, 1)
  assert.equal(handled, 1, 'wrong renderer URL must never reach the storage handler')

  const failure = eventFor(webContents, mainFrame)
  listener(failure.event, { fail: true })
  assert.equal(failure.writes.length, 1)
  assert.deepEqual(failure.event.returnValue, { ok: false, error: 'injected storage failure' })

  const asyncResult = eventFor(webContents, mainFrame)
  listener(asyncResult.event, { async: true })
  assert.equal(asyncResult.writes.length, 1)
  assert.deepEqual(asyncResult.event.returnValue, { ok: false, error: '同步 IPC 不支持异步处理' }, 'async handler must never pretend to commit synchronously')
  assert.equal(handled, 3)

  console.log('PASS client-state IPC guard: single reply, trusted origin, error envelope, and async rejection')
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
