import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), {name:'source-notices',resolveId(id:string){if(id==='virtual:xinhai-notices')return '\0source-notices'},load(id:string){if(id==='\0source-notices')return 'export default '+JSON.stringify('{}')}}, {
    name: 'mobile-music-backend',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === './music' && importer?.replaceAll('\\', '/').endsWith('/src/main/db.ts')) return resolve('src/mobile/music.ts')
    }
  }],
  define: { __COMMERCIAL_EDITION__: 'false', __PERSONAL_EDITION__: 'true' },
  publicDir: 'src/renderer/public',
  resolve: { alias: {
    'better-sqlite3': resolve('src/mobile/sqlite.ts'),
    electron: resolve('src/mobile/electron.ts'),
    'node:path': resolve('src/mobile/path.ts')
  } },
  build: { outDir: 'dist/mobile-web', emptyOutDir: true, target: 'chrome100', rollupOptions: { input: 'mobile.html' } }
})
