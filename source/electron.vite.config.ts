import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// This published snapshot has one personal source build. Commercial targets
// and their private build resources are deliberately absent.
const define = { __COMMERCIAL_EDITION__: 'false', __PERSONAL_EDITION__: 'true' }

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], define },
  preload: { plugins: [externalizeDepsPlugin()], define },
  renderer: {
    plugins: [react(), {name:'source-notices',resolveId(id:string){if(id==='virtual:xinhai-notices')return '\0source-notices'},load(id:string){if(id==='\0source-notices')return 'export default '+JSON.stringify('{}')}}],
    define,
    resolve: { alias: { '@': resolve('src/renderer/src') } }
  }
})
