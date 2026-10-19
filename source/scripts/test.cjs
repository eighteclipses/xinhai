const { spawnSync } = require('node:child_process')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const tests = [
  'check-llm-endpoint.cjs',
  'check-share-parser.cjs',
  'check-scene-motion.cjs',
  'check-video-first-frame-wait.cjs',
  'check-wallpaper-video-colors.cjs',
  'check-backup-format.cjs',
  'check-local-scoring.cjs',
  'check-durable-client-storage.cjs',
  'check-client-state-ipc.cjs',
  'check-theme-contrast.cjs',
  'check-snapshot-security.cjs',
  'check-focus-preferences.cjs'
]
for (const name of tests) {
  console.log(`\nRunning ${name}`)
  const result = spawnSync(process.execPath, [path.join(__dirname, name)], { cwd: root, stdio: 'inherit', timeout: 120000 })
  if (result.error || result.status !== 0) {
    if (result.error) console.error(result.error.message)
    process.exit(result.status || 1)
  }
}
console.log(`\nPASS ${tests.length} source regression scripts (synthetic inputs)`)
