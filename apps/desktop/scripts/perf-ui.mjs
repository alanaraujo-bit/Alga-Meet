// UI performance harness: drives the REAL Electron app (Playwright _electron) against its OWN API — never the dev
// stack on :4000. The API runs in a child process on PERF_PORT with its own PGlite/uploads/outbox in PERF_DIR and
// a dead LiveKit URL (so it never talks to the owner's SFU); it is closed gracefully when the run ends.
//   node scripts/perf-ui.mjs seed                  # once: 20 users, space "Perf", 10k messages in #geral (~10 min: rate limits)
//   node scripts/perf-ui.mjs chat --label=after    # list metrics (open, older pages, scroll FPS, memory, reopen)
//   node scripts/perf-ui.mjs startup --label=after # 5 cold starts: Electron launch → app shell visible
//   node scripts/perf-ui.mjs idle                  # 10 min signed-in idle focused, then 10 min minimized
//   node scripts/perf-ui.mjs shots                 # main screens at 960x600 and 1920x1080 (scale 1.25)
// Flags: --skip-build. Env: PERF_PORT (4300), PERF_DIR (<tmp>/alga-perf), PERF_MINUTES (idle, default 10).
// Results: <PERF_DIR>/results/<mode>-<label>.json (and a summary on stdout). Profile: `perf` (its own userData).
import { execSync, spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { _electron as electron } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, '..')
const repo = join(appDir, '..', '..')
const serverDir = join(repo, 'apps', 'server')
const PORT = Number(process.env.PERF_PORT ?? 4300)
const API = `http://127.0.0.1:${PORT}`
const DIR = process.env.PERF_DIR ?? join(tmpdir(), 'alga-perf')
const PROFILE = 'perf'
const TARGET = 10_000
const POSTERS = 20
const [mode = 'chat', ...args] = process.argv.slice(2)
const label = args.find((a) => a.startsWith('--label='))?.split('=')[1] ?? 'run'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const stateFile = join(DIR, 'state.json')
mkdirSync(join(DIR, 'results'), { recursive: true })
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { users: [] }
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2))

// ── own API ───────────────────────────────────────────────────
let server = null
async function startApi() {
  if (await health()) throw new Error(`something already listens on ${API}: stop it first (never share a PGLITE_DIR)`)
  const boot = `
    const { buildApp } = await import(${JSON.stringify(pathToFileURL(join(serverDir, 'src', 'app.ts')).href)})
    const { loadConfig } = await import(${JSON.stringify(pathToFileURL(join(serverDir, 'src', 'config.ts')).href)})
    const app = await buildApp(loadConfig())
    await app.listen({ port: ${PORT}, host: '127.0.0.1' })
    process.stdin.on('end', async () => { await app.close(); process.exit(0) })
    process.stdin.resume()`
  const env = {
    ...process.env, NODE_ENV: 'development', LOG_LEVEL: 'warn', PORT: String(PORT), HOST: '127.0.0.1',
    PGLITE_DIR: join(DIR, 'pglite'), UPLOADS_DIR: join(DIR, 'uploads'), EMAIL_OUTBOX_DIR: join(DIR, 'outbox'),
    LIVEKIT_URL: 'http://127.0.0.1:9', LIVEKIT_PUBLIC_URL: 'ws://127.0.0.1:9', BILLING_PROVIDER: 'sandbox',
  }
  server = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', boot], { cwd: serverDir, env, stdio: ['pipe', 'inherit', 'inherit'] })
  for (let i = 0; i < 120; i++) {
    if (await health()) return
    if (server.exitCode !== null) throw new Error(`API exited with ${server.exitCode}`)
    await sleep(500)
  }
  throw new Error('API did not come up')
}
async function stopApi() {
  if (!server || server.exitCode !== null) return
  const done = new Promise((r) => server.once('exit', r))
  server.stdin.end()
  await Promise.race([done, sleep(15_000)])
  if (server.exitCode === null) server.kill()
}
async function health() {
  try {
    return (await (await fetch(`${API}/health`)).json()).ok === true
  } catch {
    return false
  }
}

async function api(token, method, path, body, attempt = 0) {
  const form = body instanceof FormData
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body && !form ? { 'content-type': 'application/json' } : {}) },
    body: form ? body : body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 429 && attempt < 30) {
    await sleep(attempt < 3 ? 1500 : 8000)
    return api(token, method, path, body, attempt + 1)
  }
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`)
  return data
}

// ── seed ──────────────────────────────────────────────────────
function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}
const WORDS = 'a gente o build ficou bom hoje amanhã sala voz tela partida jogo latência ping áudio microfone ruído eco fone teste versão nova servidor canal espaço convite print vídeo câmera mapa fase chefe ranking time call stream resolução quadro fps placa driver atualizei vamos bora quem topa entrar agora depois noite cedo valeu demais sim não talvez'.split(' ')
function content(r, mentionIds) {
  const words = (n) => Array.from({ length: n }, () => WORDS[Math.floor(r() * WORDS.length)]).join(' ')
  const x = r()
  if (x < 0.45) return words(1 + Math.floor(r() * 8))
  if (x < 0.75) return `${words(10 + Math.floor(r() * 20))}.`
  if (x < 0.87) return Array.from({ length: 1 + Math.floor(r() * 3) }, () => `${words(20 + Math.floor(r() * 50))}.`).join('\n\n')
  if (x < 0.92) return `olha isso:\n\`\`\`ts\n${Array.from({ length: 3 + Math.floor(r() * 7) }, (_, i) => `const v${i} = ${Math.floor(r() * 1000)} // ${words(3)}`).join('\n')}\n\`\`\``
  if (x < 0.96) return `<@${mentionIds[Math.floor(r() * mentionIds.length)]}> ${words(4 + Math.floor(r() * 10))}`
  if (x < 0.98) return `lista:\n- ${words(3)}\n- ${words(4)}\n- ${words(2)}`
  return `**${words(2)}** e *${words(3)}* com \`${words(1)}\` https://alga.meet/${words(1)}`
}

function images() {
  const dir = join(DIR, 'media')
  mkdirSync(dir, { recursive: true })
  const list = [['wide.jpg', 'gradients=s=1280x720:c0=0x0b2a33:c1=0x21c9ca'], ['tall.jpg', 'gradients=s=720x1080:c0=0x1a1440:c1=0xef87c4'], ['square.png', 'mandelbrot=s=640x640']]
  for (const [n, src] of list) {
    const p = join(dir, n)
    if (!existsSync(p)) spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', src, '-frames:v', '1', p])
  }
  const doc = join(dir, 'notas.txt')
  if (!existsSync(doc)) writeFileSync(doc, 'notas da partida\n'.repeat(50))
  return [...list.map(([n]) => join(dir, n)), doc]
}
const fileForm = (paths, payload) => {
  const f = new FormData()
  f.append('payload_json', JSON.stringify(payload))
  for (const p of paths) f.append('files', new Blob([readFileSync(p)]), basename(p))
  return f
}

async function verify(u) {
  const box = join(DIR, 'outbox')
  for (let i = 0; i < 40; i++) {
    for (const f of existsSync(box) ? readdirSync(box).filter((x) => x.includes('verify_email')) : []) {
      const eml = readFileSync(join(box, f), 'utf8')
      if (!eml.includes(u.email)) continue
      const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(eml)?.[1]
      if (token && (await api(null, 'POST', '/auth/verify-email', { token }).then(() => true, () => false))) return
    }
    await sleep(250)
  }
  throw new Error(`no verification mail for ${u.username}`)
}

// One-time legal gate (age + Termos): adult birth date and the current terms, so the shell is not held behind it.
const ADULT_BIRTH = '1994-05-12'
let legal
const termsVersion = async () => (legal ??= (await api(null, 'GET', '/legal')).termsVersion)
async function settleLegal(u) {
  const me = await api(u.token, 'GET', '/users/@me')
  if (me.ageBracket === 'unknown') await api(u.token, 'PATCH', '/users/@me/birth-date', { birthDate: ADULT_BIRTH })
  if (me.needsTermsAcceptance) await api(u.token, 'POST', '/users/@me/accept-terms', { termsVersion: await termsVersion() })
}

async function seed() {
  for (let i = state.users.length; i < POSTERS; i++) {
    const username = `perf.${i === 0 ? 'dona' : `u${String(i).padStart(2, '0')}`}.${randomBytes(2).toString('hex')}`
    const password = randomBytes(12).toString('base64url')
    const email = `${username}@perf.alga.test`
    const displayName = i === 0 ? 'Dona do Perf' : `Pessoa ${i}`
    const r = await api(null, 'POST', '/auth/register', { email, username, displayName, password, birthDate: ADULT_BIRTH, termsVersion: await termsVersion() })
    state.users.push({ username, password, email, token: r.token, id: r.user.id })
    save()
    console.log('  user', username)
  }
  const [owner, ...rest] = state.users
  const T = (u) => u.token
  if (!state.spaceId) {
    await verify(owner)
    const sp = await api(T(owner), 'POST', '/spaces', { name: 'Perf' })
    const geral = sp.channels.find((c) => c.type === 'text')
    const outro = await api(T(owner), 'POST', `/spaces/${sp.id}/channels`, { type: 'text', name: 'outro' })
    const arquivos = await api(T(owner), 'POST', `/spaces/${sp.id}/channels`, { type: 'text', name: 'arquivos' })
    const inv = await api(T(owner), 'POST', `/spaces/${sp.id}/invites`, { maxAgeSeconds: 0, maxUses: 0 })
    for (const u of rest) await api(T(u), 'POST', `/invites/${inv.code}`)
    Object.assign(state, { spaceId: sp.id, channels: { geral: geral.id, outro: outro.id, arquivos: arquivos.id }, posted: 0 })
    save()
    for (let i = 0; i < 30; i++) await api(T(rest[i % rest.length]), 'POST', `/channels/${outro.id}/messages`, { content: `mensagem ${i} no outro canal` })
    const [wide, tall, square, doc] = images()
    const post = (u, text, files) => api(T(u), 'POST', `/channels/${arquivos.id}/messages`, fileForm(files, { content: text }))
    await post(rest[0], 'Print da partida de ontem 🎮', [wide])
    await post(rest[1], 'Três fundos pra tela de chamada:', [wide, tall, square])
    await post(rest[2], '', [square, tall])
    await post(rest[3], 'Notas da partida', [doc])
    await post(rest[0], 'e mais uma', [tall])
  }
  const ch = state.channels.geral
  const ids = []
  const r = rng(42)
  const media = images().slice(0, 3)
  let next = state.posted
  const t0 = Date.now()
  // One loop per user, ≤ 1 message/s each (the route allows 10 per 10 s per user): ~POSTERS messages/s overall.
  await Promise.all(state.users.map(async (u, k) => {
    await sleep(k * 50)
    while (next < TARGET) {
      next++
      const started = Date.now()
      const text = content(r, state.users.map((x) => x.id))
      const replyToId = ids.length > 10 && r() < 0.04 ? ids[ids.length - 1 - Math.floor(r() * Math.min(200, ids.length))] : undefined
      const withFiles = r() < 0.01
      const m = withFiles
        ? await api(u.token, 'POST', `/channels/${ch}/messages`, fileForm(media.slice(0, 1 + Math.floor(r() * 3)), { content: r() < 0.5 ? text : '', replyToId }))
        : await api(u.token, 'POST', `/channels/${ch}/messages`, { content: text, ...(replyToId ? { replyToId } : {}) })
      ids.push(m.id)
      if (r() < 0.03) {
        const emoji = ['👍', '😂', '🎉', '❤️', '🔥'][Math.floor(r() * 5)]
        await api(state.users[Math.floor(r() * POSTERS)].token, 'PUT', `/channels/${ch}/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`).catch(() => undefined)
      }
      if (next % 250 === 0) {
        state.posted = next
        save()
        console.log(`  ${next}/${TARGET} (${Math.round((Date.now() - t0) / 1000)} s)`)
      }
      await sleep(Math.max(0, 1050 - (Date.now() - started)))
    }
  }))
  state.posted = TARGET
  save()
}

// ── app driving ───────────────────────────────────────────────
const require = createRequire(join(appDir, 'package.json'))
const electronPath = require('electron')

async function launch({ width = 1320, height = 840, scale, extra = [], metrics = false } = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RENDERER_URL'))
  env.ALGA_API_URL = API
  const t0 = Date.now()
  const app = await electron.launch({
    executablePath: electronPath,
    args: [appDir, `--profile=${PROFILE}`, ...(scale ? [`--force-device-scale-factor=${scale}`] : []), ...extra],
    cwd: appDir,
    env,
  })
  const page = await app.firstWindow()
  let cdp = null
  if (metrics) {
    cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable', { timeDomain: 'timeTicks' })
  }
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(w, h)
    win.center()
    win.focus()
  }, [width, height])
  return { app, page, t0, cdp }
}
const shell = (page) => page.getByRole('navigation', { name: 'Espaços' })
async function signIn(page) {
  const u = state.users[0]
  const login = page.getByLabel('E-mail ou nome de usuário')
  await shell(page).or(login).first().waitFor({ timeout: 30_000 })
  if (await shell(page).isVisible()) return
  await login.fill(u.username)
  await page.getByLabel('Senha', { exact: true }).fill(u.password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await shell(page).waitFor({ timeout: 30_000 })
}
const channel = (page, name) => page.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: new RegExp(`^${name}`) })
async function openSpace(page) {
  await shell(page).getByRole('button', { name: /^Perf/ }).click()
  await channel(page, 'outro').waitFor()
}

/** Private bytes (MB) of every app process, and the renderer's JS heap after a full GC. */
async function memory(app, page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('HeapProfiler.collectGarbage')
  await sleep(300)
  const heap = (await cdp.send('Runtime.getHeapUsage')).usedSize / 2 ** 20
  await cdp.detach()
  const metrics = await app.evaluate(({ app }) => app.getAppMetrics())
  const mb = (kb) => Math.round(kb / 1024)
  const total = metrics.reduce((a, m) => a + (m.memory.privateBytes ?? 0), 0)
  const byType = {}
  for (const m of metrics) {
    const k = m.type === 'Utility' ? `Utility:${m.serviceName ?? m.name ?? '?'}` : m.type
    byType[k] = (byType[k] ?? 0) + mb(m.memory.privateBytes ?? 0)
  }
  const dom = await page.evaluate(() => document.getElementsByTagName('*').length)
  return { privateMB: mb(total), byType, heapMB: Math.round(heap), domNodes: dom }
}

// In-page helpers (serialized into page.evaluate).
const PAGE_HELPERS = `
  window.__perf = {
    frames: (n) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f) }),
    until: async (pred, ms = 20000) => { const end = performance.now() + ms; while (!pred()) { if (performance.now() > end) return false; await new Promise((r) => requestAnimationFrame(r)) } return true },
    list: () => document.querySelector('[aria-label^="Mensagens em"]'),
    rows: () => document.querySelectorAll('[data-message-id]').length,
    stats: (d) => { const s = [...d].sort((a, b) => a - b); const q = (p) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1); const sum = d.reduce((a, b) => a + b, 0); return { frames: d.length, fps: +(1000 * d.length / sum).toFixed(1), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +s[s.length - 1].toFixed(1), over25ms: d.filter((x) => x > 25).length } },
  }`

async function chat() {
  const out = { label, at: new Date().toISOString() }
  const { app, page } = await launch()
  await signIn(page)
  await page.evaluate(PAGE_HELPERS)
  await sleep(1500)
  out.memShell = await memory(app, page)

  // Click → first message rows painted. Cold = the space's last channel (#geral) with nothing loaded yet.
  const open = async (btn) =>
    btn.evaluate(async (b) => {
      const P = window.__perf
      const t0 = performance.now()
      b.click()
      await P.until(() => P.list() && P.rows() > 0)
      const first = performance.now() - t0
      await P.frames(2)
      // Client-side part: from the first page's response (when this click fetched one) to painted rows.
      const f = performance.getEntriesByType('resource').filter((e) => e.name.includes('/messages?limit=') && e.startTime >= t0).at(-1)
      const loaded = Math.max(P.rows(), ...[...document.querySelectorAll('[aria-posinset]')].map((e) => Number(e.getAttribute('aria-posinset'))))
      return { firstRowsMs: +first.toFixed(1), paintedMs: +(performance.now() - t0).toFixed(1), afterResponseMs: f ? +(performance.now() - f.responseEnd).toFixed(1) : null, rows: P.rows(), loaded, channel: P.list().getAttribute('aria-label') }
    })
  out.open = await open(shell(page).getByRole('button', { name: /^Perf/ }))
  if (!out.open.channel.endsWith('geral')) throw new Error(`space opened ${out.open.channel}: open #geral once, then rerun`)
  await sleep(1000)
  out.memOpen = await memory(app, page)

  // Older pages up to the start of the channel: each = scrollTop 0 → fetch → rows in place; anchor drift in px.
  out.pages = await page.evaluate(async () => {
    const P = window.__perf
    performance.setResourceTimingBufferSize(100000)
    const fetches = () => performance.getEntriesByType('resource').filter((e) => e.name.includes('/messages?before='))
    const res = []
    for (let i = 0; i < 400; i++) {
      const sc = P.list()
      const n = fetches().length
      const t0 = performance.now()
      sc.scrollTop = 0
      sc.dispatchEvent(new Event('scroll'))
      await P.frames(3)
      // The channel intro at the top and nothing loading: the whole history is in.
      if (sc.querySelector('h2') && sc.getAttribute('aria-busy') !== 'true' && fetches().length === n) break
      // Drift: the first visible message must stay where it is when the page lands above it.
      const anchor = [...sc.querySelectorAll('[data-message-id]')].find((el) => el.getBoundingClientRect().bottom > sc.getBoundingClientRect().top)
      const id = anchor?.dataset.messageId
      const top0 = anchor ? anchor.getBoundingClientRect().top : 0
      const ok = await P.until(() => fetches().length > n && P.list().getAttribute('aria-busy') !== 'true', 15000)
      if (!ok) {
        const l = P.list()
        const first = l.querySelector('[data-key]')
        res.push({ error: 'timeout', h2: !!l.querySelector('h2'), busy: l.getAttribute('aria-busy'), n, now: fetches().length, scrollTop: l.scrollTop, scrollHeight: l.scrollHeight, firstKind: first?.dataset.kind, firstPos: l.querySelector('[aria-posinset]')?.getAttribute('aria-posinset'), alert: l.querySelector('[role=alert]')?.textContent ?? null, rows: P.rows() })
        break
      }
      await P.frames(2)
      const f = fetches().at(-1)
      const now = performance.now()
      const same = id && P.list().querySelector(`[data-message-id="${CSS.escape(id)}"]`)
      res.push({ totalMs: +(now - t0).toFixed(1), netMs: +(f.responseEnd - f.startTime).toFixed(1), afterResponseMs: +(now - f.responseEnd).toFixed(1), driftPx: same ? +Math.abs(same.getBoundingClientRect().top - top0).toFixed(1) : null })
      // The API allows 200 requests/min per user: pace the loop (the timings above are per page, unaffected).
      await new Promise((r) => setTimeout(r, Math.max(30, 330 - (performance.now() - t0))))
    }
    return res
  })
  const pg = out.pages.filter((p) => !p.error)
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null }
  out.pageSummary = {
    pages: pg.length,
    first10: { total: med(pg.slice(0, 10).map((p) => p.totalMs)), afterResponse: med(pg.slice(0, 10).map((p) => p.afterResponseMs)) },
    last10: { total: med(pg.slice(-10).map((p) => p.totalMs)), afterResponse: med(pg.slice(-10).map((p) => p.afterResponseMs)) },
    maxDriftPx: Math.max(0, ...pg.map((p) => p.driftPx ?? 0)),
  }
  await sleep(1000)
  out.memLoaded = await memory(app, page)

  // Scroll FPS: programmatic scroll in rAF steps, down from the top then up from the bottom.
  const scroll = (dir, step, distance) =>
    page.evaluate(async ([dir, step, distance]) => {
      const P = window.__perf
      const sc = P.list()
      sc.scrollTop = dir > 0 ? 0 : sc.scrollHeight
      await P.frames(10)
      const d = []
      let moved = 0
      let last = 0
      await new Promise((resolve) => {
        const tick = (now) => {
          if (last) d.push(now - last)
          last = now
          sc.scrollTop += dir * step
          moved += step
          if (moved >= distance) resolve()
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      return P.stats(d)
    }, [dir, step, distance])
  out.idleFrames = await page.evaluate(async () => {
    const d = []
    let last = 0
    await new Promise((r) => { const f = (now) => { if (last) d.push(now - last); last = now; d.length < 120 ? requestAnimationFrame(f) : r() }; requestAnimationFrame(f) })
    return window.__perf.stats(d)
  })
  out.scrollDown = await scroll(1, 40, 24000)
  out.scrollUp = await scroll(-1, 40, 24000)
  out.flingUp = await scroll(-1, 240, 60000)

  // Reopen with the whole history in memory: pure render cost.
  await channel(page, 'outro').click()
  await page.getByRole('heading', { name: 'outro' }).first().waitFor()
  await sleep(800)
  out.reopen = await open(channel(page, 'geral'))
  await sleep(1500)
  out.memReopen = await memory(app, page)
  await app.close()
  return out
}

async function startup(runs = 5) {
  const res = []
  {
    const { app, page } = await launch()
    await signIn(page) // makes sure the profile holds a session
    await app.close()
  }
  for (let i = 0; i < runs; i++) {
    const { app, page, t0, cdp } = await launch({ metrics: true })
    const inPage = await page.waitForFunction(() => document.querySelector('nav[aria-label="Espaços"]') && performance.now(), null, { polling: 'raf', timeout: 30_000 })
    const wall = Date.now() - t0
    const navMs = await inPage.jsonValue()
    const origin = await page.evaluate(() => performance.timeOrigin)
    // Where the renderer's time goes: JS/CSS files, first contentful paint, the API/gateway calls before the shell.
    const parts = await page.evaluate(() => {
      const r = (x) => Math.round(x)
      const res = performance.getEntriesByType('resource')
      const files = res.filter((e) => /[.](js|css)$/.test(e.name))
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime
      return {
        jsCssDoneMs: r(Math.max(0, ...files.map((e) => e.responseEnd))),
        jsKB: r(files.filter((e) => e.name.endsWith('.js')).reduce((a, e) => a + e.decodedBodySize, 0) / 1024),
        fcpMs: fcp ? r(fcp) : null,
        dclMs: r(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd),
        firstApiMs: r(Math.min(...res.filter((e) => e.name.includes('/api/')).map((e) => e.startTime))),
      }
    })
    // Main-thread time spent until the shell is up (script parse/compile/run, style, layout), from Blink counters.
    const { metrics } = await cdp.send('Performance.getMetrics')
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]))
    const ms = (k) => Math.round((m[k] ?? 0) * 1000)
    res.push({ wallMs: wall, rendererMs: Math.round(navMs), launchToNavigationMs: Math.round(origin - t0), ...parts, scriptMs: ms('ScriptDuration'), styleMs: ms('RecalcStyleDuration'), layoutMs: ms('LayoutDuration'), taskMs: ms('TaskDuration'), heapMB: Math.round((m.JSHeapUsedSize ?? 0) / 2 ** 20) })
    await sleep(1500)
    await app.close()
    await sleep(1000)
  }
  return res
}

/** Average CPU % of every process over the last minute and private memory, after `minutes` idle. */
async function idle() {
  const minutes = Number(process.env.PERF_MINUTES ?? 10)
  const { app, page } = await launch()
  await signIn(page)
  await openSpace(page)
  await channel(page, 'geral').click()
  await page.locator('[data-message-id]').first().waitFor()
  const sample = async () => {
    await app.evaluate(({ app }) => app.getAppMetrics()) // resets the CPU averaging window
    await sleep(60_000)
    const m = await app.evaluate(({ app }) => app.getAppMetrics())
    return {
      cpuPercent: +m.reduce((a, x) => a + x.cpu.percentCPUUsage, 0).toFixed(2),
      wakeupsPerSec: m.reduce((a, x) => a + (x.cpu.idleWakeupsPerSecond ?? 0), 0),
      privateMB: Math.round(m.reduce((a, x) => a + (x.memory.privateBytes ?? 0), 0) / 1024),
      byType: Object.fromEntries(m.map((x) => [`${x.type}${x.serviceName ? `:${x.serviceName}` : ""}-${x.pid}`, { mb: Math.round((x.memory.privateBytes ?? 0) / 1024), cpu: +x.cpu.percentCPUUsage.toFixed(2) }])),
    }
  }
  console.log(`idle focused ${minutes} min…`)
  await sleep((minutes - 1) * 60_000)
  const focused = await sample()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
  console.log(`idle minimized ${minutes} min…`)
  await sleep((minutes - 1) * 60_000)
  const minimized = await sample()
  await app.close()
  return { minutes, focused, minimized }
}

/** Behaviours the virtualized list must keep, checked in the real app (throws on the first failure). */
async function check() {
  const [owner, u1, u2] = state.users
  const ch = state.channels.geral
  const ok = (cond, what) => {
    if (!cond) throw new Error(`check failed: ${what}`)
    console.log('  ✓', what)
  }
  const { app, page } = await launch()
  await signIn(page)
  await page.evaluate(PAGE_HELPERS)
  await openSpace(page)
  await channel(page, 'outro').click()
  // Unread line: messages from someone else while the channel is closed.
  await api(u1.token, 'POST', `/channels/${ch}/messages`, { content: 'check: primeira nova' })
  await api(u1.token, 'POST', `/channels/${ch}/messages`, { content: 'check: segunda nova' })
  await sleep(500)
  await channel(page, 'geral').click()
  const log = page.getByRole('log', { name: /^Mensagens em/ })
  await log.locator('[data-message-id]').first().waitFor()
  await sleep(600)
  const dist = () => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)
  ok((await dist()) < 32, 'opens stuck to the bottom')
  ok((await log.locator('[data-kind="unread"]').count()) === 1, 'unread line above the new messages')
  ok((await log.getAttribute('aria-live')) === 'off', 'log does not announce rows mounted by scrolling')
  const art = log.locator('[role="article"]').last()
  ok(Number(await art.getAttribute('aria-posinset')) > 0 && (await art.getAttribute('aria-setsize')) !== null, 'articles carry aria-posinset/aria-setsize')

  // Hover toolbar and context menu.
  const lastMsg = log.locator('[data-message-id]').last()
  await lastMsg.hover()
  ok(await lastMsg.locator('[role="toolbar"]').isVisible(), 'hover toolbar')
  await lastMsg.click({ button: 'right' })
  ok(await page.getByRole('menu').isVisible(), 'context menu')
  await page.keyboard.press('Escape')

  // Sending sticks to the bottom; someone else's message while scrolled up shows the pill and keeps the view still.
  const composer = page.getByRole('textbox', { name: /Mensagem para/ })
  await composer.fill('check: minha mensagem')
  await composer.press('Enter')
  await page.getByText('check: minha mensagem').last().waitFor()
  await sleep(400)
  ok((await dist()) < 32, 'own message keeps the list at the bottom')
  await log.evaluate((el) => (el.scrollTop -= 3000))
  await sleep(500)
  const firstVisible = () =>
    log.evaluate((el) => {
      const top = el.getBoundingClientRect().top
      const row = [...el.querySelectorAll('[data-message-id]')].find((r) => r.getBoundingClientRect().top >= top)
      return { id: row.dataset.messageId, y: row.getBoundingClientRect().top }
    })
  const v0 = await firstVisible()
  await api(u2.token, 'POST', `/channels/${ch}/messages`, { content: 'check: chegou enquanto lia' })
  await page.getByRole('button', { name: '1 nova mensagem' }).waitFor()
  const v1 = await firstVisible()
  ok(v1.id === v0.id && Math.abs(v1.y - v0.y) < 1, 'incoming message while reading: view does not move, pill counts it')

  // A row above the viewport grows (reaction): what you read stays put.
  const above = await log.evaluate((el) => {
    const top = el.getBoundingClientRect().top
    return [...el.querySelectorAll('[data-message-id]')].filter((r) => r.getBoundingClientRect().bottom < top).at(-1)?.dataset.messageId
  })
  ok(!!above, 'a mounted row above the viewport (overscan)')
  await api(u1.token, 'PUT', `/channels/${ch}/messages/${above}/reactions/${encodeURIComponent('🔥')}`)
  await sleep(800)
  const v2 = await firstVisible()
  ok(v2.id === v0.id && Math.abs(v2.y - v0.y) < 1, `reaction above the viewport keeps the anchor (moved ${(v2.y - v0.y).toFixed(1)} px)`)
  await page.getByRole('button', { name: '1 nova mensagem' }).click()
  await sleep(600)
  ok((await dist()) < 32, 'pill jumps to the newest')

  // Keyboard: Tab-reachable newest message, ↑ walks back through unmounted rows keeping focus on an article.
  await lastMsg.click({ position: { x: 5, y: 5 } })
  await log.locator('[role="article"][tabindex="0"]').focus()
  const pos0 = Number(await page.evaluate(() => document.activeElement.getAttribute('aria-posinset')))
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowUp')
  await sleep(300)
  const focus = await page.evaluate(() => {
    const a = document.activeElement
    const r = a.getBoundingClientRect()
    const sc = a.closest('[role="log"]').getBoundingClientRect()
    return { role: a.getAttribute('role'), pos: Number(a.getAttribute('aria-posinset')), visible: r.top >= sc.top - 1 && r.bottom <= sc.bottom + 1 }
  })
  ok(focus.role === 'article' && focus.pos === pos0 - 40 && focus.visible, `↑ ×40 moves focus 40 messages back, in view (${pos0} → ${focus.pos})`)
  await page.keyboard.press('End')
  await sleep(300)
  ok((await dist()) < 32 && (await page.evaluate(() => document.activeElement.getAttribute('role'))) === 'article', 'End: newest message focused, at the bottom')

  // Inline edit from the composer (↑ on empty), Esc cancels.
  await composer.focus()
  await composer.press('ArrowUp')
  const editor = log.getByRole('textbox', { name: 'Editar' })
  await editor.waitFor()
  ok(await editor.evaluate((el) => el === document.activeElement), 'inline edit of the last own message, focused')
  await editor.press('Escape')
  await editor.waitFor({ state: 'detached' })

  // Reply jump to a message far above (not mounted): it mounts, centers and flashes.
  const ids = await api(owner.token, 'GET', `/channels/${ch}/messages?limit=100`)
  const target = ids.at(-1)
  const reply = await api(owner.token, 'POST', `/channels/${ch}/messages`, { content: 'check: resposta a uma antiga', replyToId: target.id })
  await page.locator(`[data-message-id="${reply.id}"]`).waitFor()
  await sleep(400)
  ok((await log.locator(`[data-message-id="${target.id}"]`).count()) === 0, 'reply target starts unmounted')
  await page.locator(`[data-message-id="${reply.id}"]`).getByRole('button').first().click()
  const t = log.locator(`[data-message-id="${target.id}"]`)
  await t.waitFor()
  await sleep(100)
  const inView = await t.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const sc = el.closest('[role="log"]').getBoundingClientRect()
    return r.top >= sc.top && r.bottom <= sc.bottom && el.className.includes('flash')
  })
  ok(inView, 'reply jump mounts the original, in view, flashing')
  await app.close()
  return { ok: true }
}

// ── screenshots ──────────────────────────────────────────────
const shotsDir = process.env.PERF_SHOTS_DIR ?? join(repo, 'docs', 'screenshots')
const day = '2026-11-01'
function nextShot(screen, size) {
  const re = new RegExp(`^${day}-${screen}-${size}-v(\\d+)\\.png$`)
  const n = Math.max(0, ...readdirSync(shotsDir).map((f) => Number(re.exec(f)?.[1] ?? 0))) + 1
  return join(shotsDir, `${day}-${screen}-${size}-v${n}.png`)
}
async function shots() {
  const done = []
  for (const [size, opts] of [['960x600', { width: 960, height: 600, scale: 1.25 }], ['1920x1080', { width: 1536, height: 864, scale: 1.25 }]]) {
    const { app, page } = await launch(opts)
    await signIn(page)
    const snap = async (screen) => {
      await sleep(500)
      const p = nextShot(screen, size)
      await page.screenshot({ path: p, animations: 'disabled' })
      done.push(p)
      console.log('  ✓', p.slice(repo.length + 1))
    }
    await openSpace(page)
    await channel(page, 'arquivos').click()
    await page.locator('[data-message-id] img').first().waitFor()
    await sleep(800)
    await snap('chat-attachments')
    // User settings: Assinatura and Personalização (the shop).
    await page.getByRole('button', { name: 'Configurações', exact: true }).click()
    const dlg = page.getByRole('dialog', { name: 'Configurações' })
    await dlg.waitFor()
    await dlg.getByRole('button', { name: 'Assinatura' }).click()
    await sleep(1200)
    await snap('billing')
    await dlg.getByRole('button', { name: 'Personalização' }).click()
    await sleep(1200)
    await snap('shop')
    await page.keyboard.press('Escape')
    await dlg.waitFor({ state: 'detached' })
    // Space settings (owner: every section).
    await page.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: 'Perf', exact: true }).first().click()
    await page.getByRole('menuitem', { name: /Configurações do espaço/ }).click()
    const sdlg = page.getByRole('dialog').first()
    await sdlg.waitFor()
    await sleep(800)
    await snap('space-settings')
    for (const section of ['Cargos', 'Membros']) {
      const b = sdlg.getByRole('button', { name: section, exact: true })
      if (await b.count()) {
        await b.first().click()
        await sleep(800)
        await snap(`space-settings-${section.toLowerCase()}`)
      }
    }
    await page.keyboard.press('Escape')
    await app.close()
  }
  return done
}

// ── main ──────────────────────────────────────────────────────
if (mode !== 'seed' && !args.includes('--skip-build')) {
  console.log('building…')
  execSync('npx electron-vite build', { cwd: appDir, stdio: 'inherit' })
}
let result
try {
  await startApi()
  if (mode !== 'seed') for (const u of state.users) await settleLegal(u)
  if (mode === 'seed') await seed()
  else if (!state.spaceId || state.posted < TARGET) throw new Error('run `node scripts/perf-ui.mjs seed` first')
  else if (mode === 'chat') result = await chat()
  else if (mode === 'startup') result = await startup()
  else if (mode === 'idle') result = await idle()
  else if (mode === 'shots') result = await shots()
  else if (mode === 'check') result = await check()
  else throw new Error(`unknown mode ${mode}`)
} finally {
  await stopApi()
}
if (result) {
  const p = join(DIR, 'results', `${mode}-${label}.json`)
  writeFileSync(p, JSON.stringify(result, null, 2))
  const { pages, ...brief } = result
  console.log(JSON.stringify(brief, null, 2))
  console.log('→', p)
}
