import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: { build: { rollupOptions: { input: 'src/main/index.ts' } } },
  preload: { build: { rollupOptions: { input: 'src/preload/index.ts' } } },
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react()]
  }
})
