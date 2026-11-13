// Draws the picture of every placeable item of the worlds catalog with the room's own engine and writes them to
// src/renderer/src/features/worlds/thumbs/<sku>.webp (the Ateliê shows them in the inventory and the store).
// Run it after adding or changing an item or the asset pack:
//   node scripts/worlds-thumbs.mjs [sku ...]
// It serves the lab (vite.worlds-lab.config.ts, port 5391) for the time it takes and opens it in a hidden, offscreen
// Electron window. No API, no account.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, '..')
const OUT = join(appDir, 'src', 'renderer', 'src', 'features', 'worlds', 'thumbs')
const PORT = 5391
const SIZE = 288
const only = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const up = () => fetch(`http://localhost:${PORT}/`).then((r) => r.ok, () => false)

let vite = null
if (!(await up())) {
  vite = spawn('npx', ['vite', '--config', 'vite.worlds-lab.config.ts'], { cwd: appDir, shell: true, stdio: 'ignore' })
  for (let i = 0; i < 80 && !(await up()); i++) await sleep(250)
  if (!(await up())) throw new Error('the lab did not come up on :' + PORT)
}

const app = await electron.launch({
  executablePath: createRequire(join(appDir, 'package.json'))('electron'),
  args: [join(here, 'worlds-thumbs-main.cjs'), `http://localhost:${PORT}/?thumbs=1#worlds-lab`, '--force-device-scale-factor=1'],
})
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => typeof window.__thumbs === 'function', null, { timeout: 30_000 })
  const shots = await page.evaluate(([size, skus]) => window.__thumbs(size, skus.length ? skus : undefined), [SIZE, only])
  mkdirSync(OUT, { recursive: true })
  let bytes = 0
  for (const [sku, url] of Object.entries(shots)) {
    const buf = Buffer.from(String(url).replace(/^data:image\/webp;base64,/, ''), 'base64')
    writeFileSync(join(OUT, `${sku}.webp`), buf)
    bytes += buf.length
  }
  console.log(`${Object.keys(shots).length} thumbnails, ${(bytes / 1024).toFixed(0)} KiB → ${OUT}`)
} finally {
  await app.close().catch(() => undefined)
  if (vite?.pid) spawnSync('taskkill', ['/PID', String(vite.pid), '/T', '/F'], { stdio: 'ignore' })
}
