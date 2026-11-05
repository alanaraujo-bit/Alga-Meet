// Package C in the real app (growth-plan §5.2 C): the store, gifts (with the reveal), Plus v2, Casa and the try-on in
// a call, against our OWN API (sandbox billing, PGlite under STORE_WORK) and our OWN LiveKit, never the dev stack
// (:4000 / :7880, profiles default/bob). One Electron at a time, off-screen (automation mode), closed after each part.
// Screens → docs/screenshots/2026-11-01-<screen>-v1.png; reveal / try-on GIFs → docs/design/cosmetics/store/.
//   node scripts/cosmetics-store.mjs [--skip-build] [--only=store,gift,reveal,plus,annual,teen,casa,tryon,context]
//   env: STORE_API_PORT (4740), STORE_LK_PORT (7960), STORE_WORK (<tmp>/alga-store-qa), STORE_TAG (v1)
// Test accounts are created here on that throwaway API (random passwords, kept in STORE_WORK/users.json).
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, chromium } from 'playwright'
import { appDir, build, repo, sleep } from './cosmetics-lib.mjs'

const API_PORT = Number(process.env.STORE_API_PORT ?? 4740)
const LK_PORT = Number(process.env.STORE_LK_PORT ?? 7960)
const WORK = process.env.STORE_WORK ?? join(tmpdir(), 'alga-store-qa')
const TAG = process.env.STORE_TAG ?? 'v1'
const API = `http://127.0.0.1:${API_PORT}`
const SHOTS = join(repo, 'docs', 'screenshots')
const GIFS = join(repo, 'docs', 'design', 'cosmetics', 'store')
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',')
const want = (part) => !only || only.includes(part)
mkdirSync(WORK, { recursive: true })
mkdirSync(GIFS, { recursive: true })

// Our API through qa-stack's launcher (tracked PIDs in OUR work dir), with e-mails auto-verified (closed test server).
Object.assign(process.env, { QA_WORK: WORK, QA_API_PORT: String(API_PORT), QA_LK_PORT: String(LK_PORT), ALGA_AUTO_VERIFY_EMAIL: '1', EMAIL_DRIVER: 'console', ALGA_ALLOW_CONSOLE_EMAIL: '1' })
const qa = await import('./qa-stack.mjs')

// ── our LiveKit (own ports and UDP range, webhook to our API) ──
const lkPidFile = join(WORK, 'livekit.pid')
async function startLivekit() {
  const yaml = readFileSync(join(repo, 'infra', 'livekit', 'livekit.dev.yaml'), 'utf8')
    .replace(/^port: \d+/m, `port: ${LK_PORT}`)
    .replace(/tcp_port: \d+/, `tcp_port: ${LK_PORT + 1}`)
    .replace(/port_range_start: \d+/, 'port_range_start: 51600')
    .replace(/port_range_end: \d+/, 'port_range_end: 51699')
    .replace(/http:\/\/127\.0\.0\.1:4000\//, `${API}/`)
  writeFileSync(join(WORK, 'livekit.yaml'), yaml)
  const out = openSync(join(WORK, 'livekit.log'), 'a')
  const child = spawn(join(repo, 'infra', 'livekit', 'bin', 'livekit-server.exe'), ['--config', join(WORK, 'livekit.yaml')], { detached: true, stdio: ['ignore', out, out], windowsHide: true })
  child.unref()
  writeFileSync(lkPidFile, String(child.pid))
  for (let i = 0; i < 60; i++) {
    if (await fetch(`http://127.0.0.1:${LK_PORT}/`).then((r) => r.ok, () => false)) return
    await sleep(250)
  }
  throw new Error('LiveKit did not come up')
}
const stopLivekit = () => existsSync(lkPidFile) && spawnSync('taskkill', ['/PID', readFileSync(lkPidFile, 'utf8').trim(), '/T', '/F'], { stdio: 'ignore' })

// ── API helpers ──
async function api(token, method, path, body) {
  const res = await fetch(`${API}/api/v1${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`), { status: res.status })
  return data
}
/** The sandbox provider's page, approved (what the user's browser would do). */
const approve = async (url) => {
  const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}outcome=approve`)
  if (!r.ok) throw new Error(`sandbox approve ${r.status}`)
}
const pay = async (token, path, body) => {
  const res = await api(token, 'POST', path, body)
  await approve(res.url)
  return res
}
const until = async (fn, ms = 15_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await fn()) return true
    await sleep(250)
  }
  throw new Error('timed out')
}

const PEOPLE = [
  ['marina', 'Marina Duarte', '1994-05-12'],
  ['caio', 'Caio Torres', '1991-09-03'],
  ['rafa', 'Rafa Moreira', '1996-01-20'],
  ['bia', 'Bia Lins', `${new Date().getFullYear() - 16}-03-10`], // 16: receives gifts, never buys
]

async function seed() {
  const file = join(WORK, 'users.json')
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    for (const u of Object.values(saved.users)) u.me = await api(u.token, 'GET', '/users/@me')
    return saved
  }
  const { termsVersion } = await api(null, 'GET', '/legal')
  const users = {}
  for (const [key, displayName, birthDate] of PEOPLE) {
    const password = randomBytes(12).toString('base64url')
    const r = await api(null, 'POST', '/auth/register', { email: `${key}@store.alga.test`, username: key, displayName, password, birthDate, termsVersion })
    users[key] = { username: key, password, token: r.token, me: r.user }
  }
  const T = (k) => users[k].token
  const id = (k) => users[k].me.id
  for (const [a, b] of [['marina', 'caio'], ['marina', 'rafa'], ['marina', 'bia'], ['caio', 'rafa']]) {
    await api(T(a), 'POST', '/relationships', { username: users[b].username })
    await api(T(b), 'PUT', `/relationships/${id(a)}`, { type: 'friend' })
  }
  const space = await api(T('marina'), 'POST', '/spaces', { name: 'Hora Azul' })
  const inv = await api(T('marina'), 'POST', `/spaces/${space.id}/invites`, { maxAgeSeconds: 0, maxUses: 0 })
  for (const k of ['caio', 'rafa', 'bia']) await api(T(k), 'POST', `/invites/${inv.code}`)
  const voice = space.channels.find((c) => c.type === 'voice')
  const saved = { users, spaceId: space.id, voice: { id: voice.id, name: voice.name } }
  writeFileSync(file, JSON.stringify(saved, null, 2))

  // Gifts need friends of 72 h+: age the friendships in OUR PGlite (the API is stopped around it, one process per dir).
  qa.stopApi()
  await sleep(1500)
  const { PGlite } = await import('@electric-sql/pglite')
  const db = new PGlite(join(WORK, 'pglite'))
  await db.query("update relationships set since = now() - interval '5 days'")
  await db.close()
  await qa.startApi()

  // Purchases through the sandbox provider (webhook-confirmed like the real one).
  await pay(T('marina'), '/billing/checkout', { productId: 'deco_ha_halo_vidro' })
  await pay(T('marina'), '/billing/checkout', { productId: 'nameplate_ha_crepusculo' })
  await pay(T('marina'), '/billing/checkout', { productId: 'effect_ha_hora_azul' })
  await until(async () => (await api(T('marina'), 'GET', '/billing/me')).items.length >= 3)
  await api(T('marina'), 'PUT', '/users/@me/cosmetics', { avatarDecoration: 'deco_ha_halo_vidro', nameplate: 'nameplate_ha_crepusculo', profileEffect: 'effect_ha_hora_azul' })
  await pay(T('caio'), '/billing/checkout', { productId: 'plus_monthly' })
  await pay(T('rafa'), '/billing/checkout', { productId: 'plus_yearly' })
  await pay(T('rafa'), '/billing/checkout', { productId: 'theme_ha_noite_indigo' })
  // A gift already waiting for Caio (opened in the reveal), and a wishlist Marina shows her friends.
  await pay(T('marina'), '/billing/gifts', { productId: 'deco_ha_constelacao', recipientId: id('caio'), message: 'Pra você brilhar na call de sexta ✨' })
  for (const p of ['deco_ha_fita_seda', 'effect_ha_poeira_luz', 'theme_ha_nevoa_lavanda', 'aura_ha_respiro', 'frame_ha_cinema']) await api(T('marina'), 'PUT', `/billing/wishlist/${p}`)
  // The space's Casa: Caio lit it for 30 days and chose to appear on the mural.
  await pay(T('caio'), `/spaces/${space.id}/upgrade/contributions`, { productId: 'casa_30d', showOnWall: true })
  await sleep(1500)
  return saved
}

// ── the app ──
const require = createRequire(join(repo, 'apps', 'desktop', 'package.json'))
const electronPath = require('electron')

async function launch(u, { extra = [], width = 1440, height = 900 } = {}) {
  const profile = `store-${u.username}`
  rmSync(join(process.env.APPDATA ?? '', 'Alga Meet Dev', 'profiles', profile), { recursive: true, force: true })
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RENDERER_URL'))
  env.ALGA_API_URL = API
  const app = await _electron.launch({ executablePath: electronPath, cwd: appDir, env, args: [appDir, `--profile=${profile}`, '--force-device-scale-factor=1', ...extra] })
  // Checkout pages "open in the browser": record them here instead, the script approves them like the user would.
  await app.evaluate(({ shell }) => {
    globalThis.__opened = []
    shell.openExternal = async (url) => void globalThis.__opened.push(url)
  })
  const page = await app.firstWindow()
  // The first stack frames say where, not only what (a bare message is hard to trace in a minified bundle).
  page.on('pageerror', (e) => console.error('  pageerror:', e.message, (e.stack ?? '').split(String.fromCharCode(10)).slice(1, 4).join(' | ')))
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]?.setContentSize(w, h), [width, height])
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate((t) => window.alga.auth.setToken(t), u.token)
  await page.reload()
  await page.getByRole('navigation', { name: 'Espaços' }).waitFor({ timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready)
  await sleep(800)
  return { app, page }
}
const opened = (app) => app.evaluate(() => globalThis.__opened.splice(0))
async function approveOpened(app) {
  let urls = []
  await until(async () => (urls = await opened(app)).length > 0)
  for (const u of urls) await approve(u)
}

const shot = async (page, name, clip) => {
  await sleep(350)
  const path = join(SHOTS, `2026-11-01-${name}-${TAG}.png`)
  await page.screenshot({ path, ...(clip ? { clip } : {}) })
  console.log('  ✓', name)
}
const box = async (loc, pad = 0) => {
  const b = await loc.boundingBox()
  return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 }
}

/** Records the page while `act` runs (+ `ms`), crops `clip` into a GIF (CDP screencast frames → ffmpeg). */
async function gif(page, clip, ms, act, file) {
  const cdp = await page.context().newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ buf: Buffer.from(data, 'base64'), t: metadata.timestamp, w: metadata.deviceWidth })
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined)
  })
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
  await sleep(200)
  await act()
  await sleep(ms)
  await cdp.send('Page.stopScreencast')
  await cdp.detach()
  if (frames.length < 2) return console.warn(`  ${file}: too few frames`)
  const dir = mkdtempSync(join(tmpdir(), 'alga-gif-'))
  const k = frames[0].buf.readUInt32BE(16) / frames[0].w
  const list = []
  frames.forEach((f, i) => {
    const name = join(dir, `f${String(i).padStart(4, '0')}.png`)
    writeFileSync(name, f.buf)
    list.push(`file '${name.replace(/\\/g, '/')}'`, `duration ${Math.max(0.01, (frames[i + 1]?.t ?? f.t + 1.2) - f.t).toFixed(3)}`)
  })
  list.push(list[list.length - 2])
  writeFileSync(join(dir, 'list.txt'), list.join('\n'))
  const crop = [clip.width, clip.height, clip.x, clip.y].map((v) => Math.round(v * k))
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'),
    '-vf', `crop=${crop.join(':')},fps=25,scale=${Math.min(crop[0], 640)}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    '-loop', '0', join(GIFS, file)], { encoding: 'utf8' })
  rmSync(dir, { recursive: true, force: true })
  if (r.status !== 0) console.warn(`  ffmpeg: ${r.stderr}`)
  else console.log('  ✓', `gif ${file}`)
}

const settings = async (page, section) => {
  if (!(await page.locator('[data-settings]').isVisible().catch(() => false))) await page.keyboard.press('Control+,')
  const dlg = page.locator('[data-settings]')
  await dlg.getByRole('button', { name: section, exact: true }).click()
  await sleep(700)
  return dlg
}
const closeSettings = async (page) => {
  await page.keyboard.press('Escape')
  await sleep(400)
}
const storeTab = async (dlg, name) => {
  await dlg.getByRole('tab', { name }).click()
  await sleep(500)
}
const tile = (dlg, name) => dlg.getByRole('button', { name: new RegExp(`^${name}`) }).first()

async function part(name, fn) {
  if (!want(name)) return
  console.log(name)
  try {
    await fn()
  } catch (e) {
    console.error(`  ✗ ${name}:`, e.message)
  }
}

// ── run ──
build({ skip: process.argv.includes('--skip-build') })
await startLivekit()
await qa.startApi()
let crowd
try {
  const saved = await seed()
  const U = saved.users

  await part('store', async () => {
    const { app, page } = await launch(U.marina)
    try {
      const dlg = await settings(page, 'Personalização')
      await dlg.getByRole('tablist', { name: 'Seções da loja' }).waitFor()
      await sleep(2400) // the hero card's Hora azul plays once
      await shot(page, 'store-collection')
      // An item you do not own: the large preview on your own card, the price, every action and its fine print.
      await tile(dlg, 'Fita de seda').click()
      await sleep(1400)
      await shot(page, 'store-item-detail')
      // The fitting room: several items at once on your card.
      await dlg.getByRole('button', { name: 'Provar no perfil' }).click()
      await tile(dlg, 'Névoa lavanda').click()
      await dlg.getByRole('button', { name: 'Provar no perfil' }).click()
      await tile(dlg, 'Poeira de luz').click()
      await sleep(2000)
      await shot(page, 'store-fitting-room')
      // A wave-2 item: visible, wishable, tried on the profile, not sold yet.
      await tile(dlg, 'Respiro').scrollIntoViewIfNeeded()
      await tile(dlg, 'Respiro').click()
      await sleep(1200)
      await shot(page, 'store-wave2-item')
      await storeTab(dlg, 'Conjuntos')
      await dlg.getByRole('button', { name: /Conjunto Hora Azul/ }).click()
      await sleep(1200)
      await shot(page, 'store-bundles')
      await storeTab(dlg, 'Lista de desejos')
      await shot(page, 'store-wishlist')
      await storeTab(dlg, 'Presentes')
      await shot(page, 'store-gifts-sent')
    } finally {
      await app.close()
    }
  })

  await part('gift', async () => {
    const { app, page } = await launch(U.marina)
    try {
      const dlg = await settings(page, 'Personalização')
      await tile(dlg, 'Órbita').click()
      await sleep(600)
      // Tap 1: Presentear on the item page.
      await dlg.getByRole('button', { name: 'Presentear', exact: true }).click()
      const modal = page.getByRole('dialog', { name: /Presentear|Presente para/ })
      await modal.waitFor()
      await shot(page, 'gift-pick-friend')
      // Tap 2: the friend. The review shows the item on THEIR card.
      await modal.getByRole('button', { name: /Rafa Moreira/ }).click()
      await sleep(1600)
      await modal.locator('textarea').fill('Achei a sua cara. Bom fim de semana!')
      await shot(page, 'gift-review')
      // Tap 3: Pagar (Pix first). The provider page "opens"; we approve it like the user would.
      await modal.getByRole('button', { name: /^Pagar R\$/ }).click()
      await sleep(600)
      await shot(page, 'gift-waiting')
      await approveOpened(app)
      await modal.getByText(/^Pago\./).waitFor({ timeout: 20_000 })
      await shot(page, 'gift-paid')
      await modal.getByRole('button', { name: 'OK' }).click()
      // From a friend's card: Presentear → their wishlist first.
      await closeSettings(page)
      await page.getByRole('navigation', { name: 'Espaços' }).getByRole('button', { name: /Hora Azul/ }).first().click()
      await sleep(1200)
      await page.getByRole('complementary', { name: 'Membros' }).getByRole('button', { name: /Caio Torres/ }).click()
      await sleep(900)
      await shot(page, 'profile-popover-gift')
      await page.getByRole('dialog', { name: /Caio/ }).getByRole('button', { name: 'Presentear' }).click()
      await page.getByRole('dialog', { name: /Presente para Caio/ }).waitFor()
      await sleep(900)
      await shot(page, 'gift-pick-item')
      await page.keyboard.press('Escape')
      await sleep(400)
      // Casa: the space's purchase.
      await page.getByRole('navigation', { name: 'Espaços' }).getByRole('button', { name: /Hora Azul/ }).first().click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Casa do espaço' }).click()
      await page.getByRole('dialog', { name: /Casa · Hora Azul/ }).waitFor()
      await sleep(1200)
      await shot(page, 'casa-lit')
      await page.getByRole('radio', { name: /R\$ 5,00/ }).click()
      await page.getByRole('dialog', { name: /Casa/ }).evaluate((el) => el.querySelector('[class*="_contribute_"]')?.scrollIntoView({ block: 'center' }))
      await sleep(400)
      await shot(page, 'casa-contribute')
    } finally {
      await app.close()
    }
  })

  await part('reveal', async () => {
    const { app, page } = await launch(U.caio)
    try {
      // A gift delivered live: GIFT_RECEIVED opens the reveal by itself.
      await pay(U.rafa.token, '/billing/gifts', { productId: 'nameplate_ha_fio_luz', recipientId: U.caio.me.id, message: 'Feliz sexta, Caio! Pra combinar com o seu Plus.' })
      const modal = page.getByRole('dialog', { name: /te mandou um presente/ })
      await modal.waitFor({ timeout: 20_000 })
      await sleep(600)
      await shot(page, 'gift-reveal-closed')
      const clip = await box(modal, 8)
      await gif(page, clip, 1800, () => modal.getByRole('button', { name: 'Abrir' }).click(), 'gift-reveal.gif')
      await sleep(400)
      await shot(page, 'gift-reveal-open')
      await modal.getByRole('button', { name: 'Usar agora' }).click()
      await modal.getByText('Pronto: está no seu perfil.').waitFor()
      await shot(page, 'gift-reveal-used')
      await modal.getByRole('button', { name: 'OK' }).click()
      // The one waiting since before (opened from Presentes), refused to show the calm refusal.
      const dlg = await settings(page, 'Personalização')
      await storeTab(dlg, 'Presentes')
      await shot(page, 'store-gifts-received')
      await dlg.getByRole('button', { name: 'Abrir' }).first().click()
      const m2 = page.getByRole('dialog', { name: /te mandou um presente/ })
      await m2.getByRole('button', { name: 'Recusar' }).click()
      await shot(page, 'gift-refuse-confirm')
      await page.keyboard.press('Escape')
      // Plus subscriber: the wardrobe drawn as itself, the tenure ladder, passes.
      await closeSettings(page)
      const plan = await settings(page, 'Assinatura')
      await sleep(1200)
      await shot(page, 'plus-subscriber')
      await plan.evaluate((el) => el.querySelector('[class*="_content_"]')?.scrollTo({ top: 640 }))
      await sleep(900)
      await shot(page, 'plus-subscriber-perks')
      await plan.getByRole('button', { name: 'Mandar convite' }).click()
      await page.getByRole('dialog', { name: 'Convite Plus de 7 dias' }).waitFor()
      await shot(page, 'plus-pass-dialog')
    } finally {
      await app.close()
    }
  })

  await part('plus', async () => {
    const { app, page } = await launch(U.marina)
    try {
      await settings(page, 'Assinatura')
      await sleep(1600)
      await shot(page, 'plus-free')
      await page.locator('[data-settings]').evaluate((el) => el.querySelector('[class*="_content_"]')?.scrollTo({ top: 99999 }))
      await sleep(600)
      await shot(page, 'plus-free-history-refund')
    } finally {
      await app.close()
    }
  })

  await part('annual', async () => {
    const { app, page } = await launch(U.rafa)
    try {
      const plan = await settings(page, 'Assinatura')
      await plan.evaluate((el) => el.querySelector('[class*="_content_"]')?.scrollTo({ top: 99999 }))
      await sleep(900)
      await plan.getByRole('heading', { name: 'Item anual' }).scrollIntoViewIfNeeded()
      await shot(page, 'plus-annual-item')
    } finally {
      await app.close()
    }
  })

  await part('teen', async () => {
    const { app, page } = await launch(U.bia)
    try {
      const dlg = await settings(page, 'Personalização')
      await tile(dlg, 'Halo de vidro').click()
      await sleep(1000)
      await shot(page, 'store-teen')
    } finally {
      await app.close()
    }
  })

  await part('tryon', async () => {
    // Rafa tries on in the call (a LiveKit "bot" with a real POST /voice/join); Marina's app shows what everyone sees.
    const voice = saved.voice
    crowd = await startCrowd()
    await crowd.add(U.rafa, voice.id)
    const { app, page } = await launch(U.marina, { extra: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
    try {
      await page.getByRole('navigation', { name: 'Espaços' }).getByRole('button', { name: /Hora Azul/ }).first().click()
      await sleep(800)
      await page.getByRole('button', { name: new RegExp(voice.name) }).first().click()
      // Since 0.1.6 the first click only looks into the room (lobby); "Entrar" joins.
      await page.getByRole('button', { name: /^Entrar/ }).first().click()
      await sleep(4000)
      await api(U.rafa.token, 'POST', '/billing/try-on', { productId: 'deco_ha_fita_seda' })
      await sleep(1500)
      await shot(page, 'tryon-stage')
      // In a call the stage replaces the member list: open Rafa's profile from the room's people in the sidebar.
      await page.getByRole('button', { name: /Rafa Moreira/ }).first().click()
      await sleep(900)
      await shot(page, 'tryon-popover')
      await page.keyboard.press('Escape')
      // Marina's own try-on, from the item page, while in the call.
      const dlg = await settings(page, 'Personalização')
      await tile(dlg, 'Órbita').click()
      await sleep(500)
      const btn = dlg.getByRole('button', { name: /Provar na chamada/ })
      await btn.scrollIntoViewIfNeeded()
      await gif(page, await box(dlg.locator('aside'), 4), 1600, () => btn.click(), 'tryon-store.gif')
      await shot(page, 'tryon-store-on')
    } finally {
      await app.close()
    }
  })

  await part('context', async () => {
    // The heroes in the places they live: member list row, profile popover, the stage.
    const { app, page } = await launch(U.caio)
    try {
      await page.getByRole('navigation', { name: 'Espaços' }).getByRole('button', { name: /Hora Azul/ }).first().click()
      await sleep(1000)
      const members = page.getByRole('complementary', { name: 'Membros' })
      await members.getByRole('button', { name: /Marina Duarte/ }).hover()
      await sleep(900)
      await shot(page, 'heroes-member-list', await box(members, 0))
      await members.getByRole('button', { name: /Marina Duarte/ }).click()
      await sleep(2400)
      const pop = page.getByRole('dialog', { name: /Marina/ })
      await shot(page, 'heroes-profile-popover', await box(pop, 16))
      await gif(page, await box(pop, 8), 2600, async () => {
        await page.keyboard.press('Escape')
        await sleep(200)
        await members.getByRole('button', { name: /Marina Duarte/ }).click()
      }, 'heroes-profile-open.gif')
    } finally {
      await app.close()
    }
  })
} finally {
  await crowd?.close().catch(() => undefined)
  qa.stopApi()
  stopLivekit()
}

/** LiveKit participants from a headless Chromium (a real POST /voice/join each), silent. */
async function startCrowd() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-web-security'] })
  const page = await browser.newPage()
  const lk = readFileSync(join(require.resolve('livekit-client'), '..', 'livekit-client.esm.mjs'))
  await page.route('http://127.0.0.1:7998/**', (route) =>
    new URL(route.request().url()).pathname === '/lk.mjs'
      ? route.fulfill({ body: lk, contentType: 'text/javascript' })
      : route.fulfill({ contentType: 'text/html', body: "<!doctype html><script type=module>import * as LK from '/lk.mjs'; window.LK = LK; window.ready = true</script>" }),
  )
  await page.goto('http://127.0.0.1:7998/')
  await page.waitForFunction(() => window.ready)
  await page.evaluate(() => {
    window.rooms = {}
    window.addBot = async (id, url, token) => {
      const room = new window.LK.Room({ adaptiveStream: false, dynacast: false })
      await room.connect(url, token, { autoSubscribe: false })
      const ctx = new AudioContext()
      const dest = ctx.createMediaStreamDestination()
      const osc = ctx.createConstantSource()
      osc.connect(dest)
      osc.start()
      await room.localParticipant.publishTrack(dest.stream.getAudioTracks()[0], { source: window.LK.Track.Source.Microphone })
      window.rooms[id] = room
    }
  })
  return {
    add: async (u, channelId) => {
      const res = await api(u.token, 'POST', '/voice/join', { channelId })
      await page.evaluate(([id, url, token]) => window.addBot(id, url, token), [u.me.id, res.url, res.token])
    },
    close: () => browser.close(),
  }
}
