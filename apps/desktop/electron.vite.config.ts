import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rolldownOptions: {
        // mls-worker: the utilityProcess hosting the MLS WASM (src/main/mls), forked from out/main by mls/host.ts.
        input: { index: resolve(__dirname, 'src/main/index.ts'), 'mls-worker': resolve(__dirname, 'src/main/mls/worker.ts') },
      },
    },
  },
  preload: {},
  renderer: {
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react()],
    // electron-vite leaves the renderer unminified by default: ~2.5x more JS to parse on every cold start.
    build: { minify: true },
  },
})
