// Shared by cosmetics-shots.mjs and cosmetics-perf.mjs: an isolated build of the desktop app and an Electron launcher
// pointed at the dev-only gallery (index.html#cosmetics-gallery). Never touches the owner's dev stack: the build goes
// to <tmp>/alga-cosmetics (not apps/desktop/out, which `electron-vite dev` uses), the profile is `cosmetics`, and the
// API URL is a dead port, so nothing talks to :4000 or :7880. Callers close what they launch.
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { _electron, chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
export const desktop = join(here, '..')
export const repo = join(desktop, '..', '..')
export const work = process.env.COSMETICS_DIR ?? join(tmpdir(), 'alga-cosmetics')
export const appDir = join(work, 'app')
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Builds main + preload + renderer into <work>/app/out, with links to node_modules and build/ next to it. */
export function build({ skip = false } = {}) {
  mkdirSync(appDir, { recursive: true })
  copyFileSync(join(desktop, 'package.json'), join(appDir, 'package.json'))
  for (const [name, target] of [['node_modules', join(repo, 'node_modules')], ['build', join(desktop, 'build')]])
    if (!existsSync(join(appDir, name))) symlinkSync(target, join(appDir, name), 'junction')
  if (skip && existsSync(join(appDir, 'out', 'renderer', 'index.html'))) return
  execSync(`npx electron-vite build --outDir "${join(appDir, 'out')}"`, { cwd: desktop, stdio: 'inherit' })
}

/**
 * Captures without any window: the built renderer served on 127.0.0.1 (own port) to a headless Chromium. The
 * gallery needs no bridge or API. Use this for screenshots; Electron (`launch`) only where its process metrics count.
 */
export async function launchHeadless({ scale = 1, size = [1440, 900] } = {}) {
  const root = join(appDir, 'out', 'renderer')
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.json': 'application/json' }
  const server = createServer((req, res) => {
    const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) return void res.writeHead(404).end()
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}/index.html`
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: scale })
  page.on('pageerror', (e) => console.error('pageerror:', e.message))
  return { app: { close: async () => (await browser.close(), server.close()) }, page }
}
let base = null

/**
 * Launches the isolated Electron build (perf: GPU process metrics). Never shows or focuses the window: with the
 * main process's automation mode the window opens off-screen and inactive. One instance at a time.
 */
export async function launch({ scale = 1, size = [1440, 900] } = {}) {
  const env = { ...process.env, ALGA_API_URL: 'http://127.0.0.1:9' }
  delete env.ELECTRON_RENDERER_URL
  const app = await _electron.launch({
    executablePath: join(repo, 'node_modules', 'electron', 'dist', 'electron.exe'),
    cwd: appDir,
    env,
    args: [
      appDir,
      '--profile=cosmetics',
      `--force-device-scale-factor=${scale}`,
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.error('pageerror:', e.message))
  page.on('console', (m) => m.type() === 'error' && console.error('console.error:', m.text().slice(0, 300)))
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]?.setContentSize(w, h), size)
  base = null
  return { app, page }
}

/** Opens the gallery in `mode` ('' | 'sheet' | 'bench' | 'bench-off') and waits for it. */
export async function gallery(page, mode = '') {
  const href = (base ?? pathToFileURL(join(appDir, 'out', 'renderer', 'index.html')).href) + `#cosmetics-gallery${mode ? `/${mode}` : ''}`
  // A hash change alone is a same-document navigation: reload so main.tsx picks the gallery route.
  await page.goto(href)
  await page.reload()
  await page.waitForSelector(mode.startsWith('bench') ? '[data-testid=cosmetics-bench]' : mode === 'sheet' ? '[data-testid=cosmetics-sheet]' : '[data-testid=cosmetics-gallery]', { timeout: 20_000 })
  await page.evaluate(() => document.fonts.ready)
}
