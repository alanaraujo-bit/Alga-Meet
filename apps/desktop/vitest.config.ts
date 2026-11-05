import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Same `@` alias as the renderer build (electron.vite.config.ts), so modules that import '@/…' can be tested.
export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
})
