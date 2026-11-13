/*
 * The Alga Worlds lab: the renderer's page served alone in a browser, opened at #worlds-lab, with the 3D asset pack
 * of the repo (apps/server/assets/worlds/v1) served next to it. No Electron, no API, no account: the room, the light
 * and the figures can be worked on, measured and photographed by themselves.
 *   npx vite --config vite.worlds-lab.config.ts     then http://localhost:5391/#worlds-lab
 *   query: ?room=starter|lounge &mood=hora_azul|tarde|noite &quality=auto|low|medium|high &people=0..15 &view=<name>
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const PACK = resolve(__dirname, '../server/assets/worlds/v1')
const TYPES: Record<string, string> = { '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.hdr': 'application/octet-stream', '.md': 'text/markdown' }

function worldsPack(): Plugin {
  return {
    name: 'alga:worlds-pack',
    configureServer(server) {
      server.middlewares.use('/__worlds', (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]!)).replace(/^([/\\])+/, '')
        const file = join(PACK, rel)
        if (!file.startsWith(PACK + sep) || !existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-cache')
        createReadStream(file).pipe(res)
      })
    },
  }
}

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
  plugins: [react(), worldsPack()],
  optimizeDeps: { exclude: ['livekit-client'] },
  server: { port: 5391, strictPort: true },
})
