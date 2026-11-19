/*
 * The PWA: the desktop renderer, unchanged, with the web window.alga (src/web/bridge.ts) instead of the preload.
 *   npx vite --config vite.web.config.ts          dev on http://localhost:5173, API proxied to ALGA_API_UPSTREAM
 *   npx vite build --config vite.web.config.ts    → out/web (served by infra/web: Caddy + /api and /gateway proxied)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { livekitRedUnderE2ee } from './livekit-red'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }
const outDir = resolve(__dirname, 'out/web')

/** Stamps public/sw.js with this build's id, so every deploy installs a new worker (and drops the old page cache). */
function stampServiceWorker(): Plugin {
  return {
    name: 'alga:stamp-sw',
    apply: 'build',
    closeBundle() {
      const file = resolve(outDir, 'sw.js')
      writeFileSync(file, readFileSync(file, 'utf8').replace('__BUILD_ID__', `${pkg.version}-${Date.now().toString(36)}`))
    },
  }
}

export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  publicDir: resolve(__dirname, 'src/web/public'),
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [livekitRedUnderE2ee(), react(), stampServiceWorker()],
  optimizeDeps: { exclude: ['livekit-client'] },
  build: { outDir, emptyOutDir: true, minify: true, target: 'es2022' },
  // Same origin as in production (infra/web/Caddyfile): /api and /gateway go to ALGA_API_UPSTREAM (default: QA stack).
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(['/api', '/gateway'].map((p) => [p, { target: process.env.ALGA_API_UPSTREAM ?? 'http://127.0.0.1:4340', ws: true, changeOrigin: true }])),
  },
})
