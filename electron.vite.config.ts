import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: { build: { rollupOptions: { input: 'src/main/index.ts' } } },
  preload: { build: { rollupOptions: { input: 'src/preload/index.ts' } } },
  renderer: {
    root: 'src/renderer',
    // Ruffle's self-hosted files (ruffle.js, core.*.js, *.wasm) are served as-is next to index.html, in dev and in the build; no network at runtime.
    publicDir: resolve(__dirname, 'node_modules/@ruffle-rs/ruffle'),
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react()]
  }
})
