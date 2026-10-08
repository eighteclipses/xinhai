const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
const omittedDirectories = new Set(['.git', 'node_modules', 'out', 'dist', 'design-review', '.gradle', '__pycache__'])
const approvedBinary = new Set(['build/icon.png', 'build/icon.ico', 'src/renderer/public/design/app-icon.png', ...['mdpi','hdpi','xhdpi','xxhdpi','xxxhdpi'].map(size => `android/app/src/main/res/mipmap-${size}/ic_launcher.png`)])
const files = []
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (omittedDirectories.has(entry.name)) continue
    const file = path.join(directory, entry.name)
    assert(!entry.isSymbolicLink(), `Unexpected symlink: ${file}`)
    if (entry.isDirectory()) visit(file)
    else files.push(file)
  }
}
visit(root)
for (const file of files) {
  const rel = path.relative(root, file).replaceAll('\\', '/')
  assert(!/\.(?:db(?:-.*)?|sqlite[\w-]*|jks|keystore|p12|pfx|pem|key|mp4|webm|mp3|ogg|wav|flac|ttf|woff2?)$/i.test(rel), `Sensitive or omitted input: ${rel}`)
  assert(!/(?:^|\/)(?:commercial|commercial-runtime|release-prep)(?:\/|$)/.test(rel), `Private commercial directory: ${rel}`)
  assert(!/(?:^|\/)\.env(?:\.|$)/.test(rel), `Environment file: ${rel}`)
  if (approvedBinary.has(rel)) continue
  const text = fs.readFileSync(file, 'utf8')
  assert(!text.includes('\u0000'), `Unapproved binary: ${rel}`)
  if (rel === 'scripts/check-source.cjs') continue
  assert(!/(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text), `Potential credential: ${rel}`)
  assert(!/(?:亲手修订过的真实判例|[A-Z]:[\\/]Users[\\/]|[A-Z0-9._%+-]+@qq\.com)/i.test(text), `Private source content: ${rel}`)
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
assert.equal(pkg.name, 'xinhai-source')
assert.equal(pkg.license, 'PolyForm-Noncommercial-1.0.0')
assert(!Object.keys(pkg.scripts).some(name => name.includes('commercial')))
const main = fs.readFileSync(path.join(root, 'src/main/index.ts'), 'utf8')
const setProfile = main.indexOf("app.setPath('userData', sourceProfile)")
assert(setProfile > 0 && setProfile < main.indexOf('\n  initDb()'), 'Source profile must be isolated before database/model initialization')
assert(main.includes("const sourceProfile = join(app.getPath('appData'), 'xinhai-source')"))
assert(!main.includes("'xinhai-community'") && !main.includes("'心海学习库-主题版'"))
const license = fs.readFileSync(path.join(root, 'LICENSE'))
assert.equal(crypto.createHash('sha256').update(license).digest('hex'), 'ffcca38841adb694b6f380647e15f17c446a4d1656fed51a1e2041d064c94cc8', 'License must match the downloaded official text')
assert(fs.existsSync(path.join(root, 'resources/licenses/RhineLabUI-MIT.txt')))
for (const config of ['electron.vite.config.ts', 'vite.mobile.config.ts']) {
  const text = fs.readFileSync(path.join(root, config), 'utf8')
  assert(text.includes("__COMMERCIAL_EDITION__: 'false'"), `${config}: source build must disable commercial target`)
  assert(!text.includes('commercial-runtime') && !text.includes('commercial-assets'))
}
for (const name of ['deep-sea', 'forest-dawn', 'orbital-night']) assert(fs.existsSync(path.join(root, `src/renderer/public/backgrounds/originals/${name}.svg`)))
assert(!fs.readFileSync(path.join(root, 'src/renderer/src/components/CharacterLayer.tsx'), 'utf8').includes('resources/assets/'))
console.log(`PASS source file scope (${files.length} files), license, private input scan, isolated profile and media-free build entries`)
