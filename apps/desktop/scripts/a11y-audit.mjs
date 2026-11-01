// Accessibility audit of the REAL app (Playwright _electron): a rule audit injected in the page (a11y-page.mjs: names,
// tabindex, focus, dialogs, menus, live regions, images, contrast), keyboard-only journeys, forced colors and
// reduced motion. No new dependencies (no axe-core).
//   node scripts/a11y-audit.mjs [--skip-build] [--app=<built app dir>] [--label=after] [--only=audit,journeys,live,motion,forced]
// Isolated: its own API (:4480, PGlite under A11Y_WORK = <tmp>/alga-a11y) and LiveKit (:7990, tcp 7991, udp
// 51800-51899), its own build (node_modules/.alga-a11y), its own profiles (a11y-a, a11y-b). Never touches :4000/:7880,
// the default/bob profiles, apps/desktop/out or anyone else's processes; everything it starts is stopped at the end.
// The sharer (Ana) runs WITHOUT Chromium's fake devices (they replace real capture): her microphone is a WebAudio
// tone, desktopCapturer only lists two small ffplay windows titled A11Y-Share-*, notifications/openExternal are
// recorded instead of reaching the desktop. Output: docs/accessibility/2026-11-01/<label>.json + PNGs.
import { execSync, spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { installA11y } from './a11y-page.mjs'

const WORK = process.env.A11Y_WORK ?? join(tmpdir(), 'alga-a11y')
Object.assign(process.env, { QA_WORK: WORK, QA_API_PORT: '4480', QA_LK_PORT: '7990' })
const Q = await import('./qa-stack.mjs')
const LK_PORT = 7990
const args = process.argv.slice(2)
const arg = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=')
const LABEL = arg('label') ?? 'after'
const ONLY = (arg('only') ?? 'audit,journeys,live,motion,forced').split(',')
const APP = arg('app') ? join(Q.repo, arg('app')) : join(Q.repo, 'node_modules', '.alga-a11y')
const OUT = join(Q.repo, 'docs', 'accessibility', '2026-11-01')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(OUT, { recursive: true })
mkdirSync(WORK, { recursive: true })
const result = { label: LABEL, app: APP.slice(Q.repo.length + 1), at: new Date().toISOString(), audit: {}, focus: {}, journeys: [], live: [], motion: {}, forced: { shots: [], focus: {} } }

// ── stack ────────────────────────────────────────────────────
let livekit = null
const ffplays = []
const busy = (port) => fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)
async function startStack() {
  for (const p of [Q.API_PORT, LK_PORT]) if (await busy(p)) throw new Error(`:${p} já está em uso — outra execução do a11y-audit?`)
  rmSync(join(WORK, 'pglite'), { recursive: true, force: true })
  rmSync(Q.OUTBOX, { recursive: true, force: true })
  const yaml = readFileSync(join(Q.repo, 'infra', 'livekit', 'livekit.dev.yaml'), 'utf8')
    .replace(/^port: \d+/m, `port: ${LK_PORT}`)
    .replace(/tcp_port: \d+/, `tcp_port: ${LK_PORT + 1}`)
    .replace(/port_range_start: \d+/, 'port_range_start: 51800')
    .replace(/port_range_end: \d+/, 'port_range_end: 51899')
    .replace(/http:\/\/127\.0\.0\.1:4000\//, `${Q.API}/`)
  writeFileSync(join(WORK, 'livekit.yaml'), yaml)
  const log = openSync(join(WORK, 'livekit.log'), 'a')
  livekit = spawn(join(Q.repo, 'infra', 'livekit', 'bin', 'livekit-server.exe'), ['--config', join(WORK, 'livekit.yaml')], { stdio: ['ignore', log, log], windowsHide: true })
  for (let i = 0; i < 60 && !(await busy(LK_PORT)); i++) await sleep(250)
  await Q.startApi()
}
function stopStack() {
  for (const p of ffplays) spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' })
  if (livekit?.pid) spawnSync('taskkill', ['/PID', String(livekit.pid), '/T', '/F'], { stdio: 'ignore' })
  Q.stopApi()
}
function build() {
  execSync(`npx electron-vite build --outDir "${APP}"`, { cwd: Q.appDir, stdio: 'inherit' })
  writeFileSync(join(APP, 'package.json'), JSON.stringify({ name: '@alga/desktop', productName: 'Alga Meet', version: '0.1.0', main: './main/index.js' }, null, 2))
  cpSync(join(Q.appDir, 'build', 'runtime'), join(APP, 'build', 'runtime'), { recursive: true })
}
/** Small test-pattern windows: the only thing the screen picker may list or capture. */
function shareWindows() {
  for (const i of [1, 2]) {
    ffplays.push(spawn('ffplay', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=240x160:rate=30', '-an', '-window_title', `A11Y-Share-${i}`, '-left', '1500', '-top', String(560 + i * 200)], { stdio: 'ignore' }))
  }
}

// ── REST seed ────────────────────────────────────────────────
async function api(token, method, path, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${Q.API}/api/v1${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 429 && attempt < 8) {
      await sleep(8000)
      continue
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null)
    if (res.status >= 300) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)?.slice(0, 200)}`)
    return data
  }
}
async function verifyEmail(u) {
  for (let i = 0; i < 80; i++) {
    for (const f of existsSync(Q.OUTBOX) ? readdirSync(Q.OUTBOX).filter((f) => f.includes('verify_email')) : []) {
      const eml = readFileSync(join(Q.OUTBOX, f), 'utf8')
      const token = eml.includes(u.email) && /[?&]token=([A-Za-z0-9_-]+)/.exec(eml)?.[1]
      if (token && (await api(null, 'POST', '/auth/verify-email', { token }).then(() => true, () => false))) return
    }
    await sleep(250)
  }
  throw new Error(`no verification e-mail for ${u.email}`)
}
const U = {}
const S = {}
async function seed() {
  const { termsVersion } = await api(null, 'GET', '/legal')
  for (const [k, displayName] of [['ana', 'Ana Teclado'], ['bruno', 'Bruno Costa']]) {
    const username = `a11y.${k}.${randomBytes(2).toString('hex')}`
    const password = `${randomBytes(9).toString('base64url')} farol`
    const email = `${username}@a11y.alga.test`
    const r = await api(null, 'POST', '/auth/register', { email, username, displayName, password, birthDate: '1992-04-10', termsVersion })
    U[k] = { username, password, email, displayName, token: r.token, id: r.user.id }
    await verifyEmail(U[k])
  }
  // Staff (moderator) for the staff-panel journey: grant-staff.ts on OUR PGlite (the API restarts around it).
  await Q.grantStaff(U.ana.username, 'moderator')
  for (const k of ['ana', 'bruno']) U[k].token = (await api(null, 'POST', '/auth/login', { login: U[k].username, password: U[k].password })).token
  const sp = await api(U.ana.token, 'POST', '/spaces', { name: 'Clube A11y' })
  const inv = await api(U.ana.token, 'POST', `/spaces/${sp.id}/invites`, { maxAgeSeconds: 0, maxUses: 0 })
  await api(U.bruno.token, 'POST', `/invites/${inv.code}`)
  S.space = sp
  S.text = sp.channels.find((c) => c.type === 'text')
  S.voice = sp.channels.find((c) => c.type === 'voice')
  const m1 = await api(U.bruno.token, 'POST', `/channels/${S.text.id}/messages`, { content: 'Oi! Alguém joga hoje à noite?' })
  await api(U.ana.token, 'POST', `/channels/${S.text.id}/messages`, { content: 'Eu topo, depois das 21h.', replyToId: m1.id })
  await api(U.bruno.token, 'POST', `/channels/${S.text.id}/messages`, { content: 'Fechado. Chamo a Carla também.' })
}

// ── apps ─────────────────────────────────────────────────────
const electronPath = createRequire(join(Q.appDir, 'package.json'))('electron')
const apps = {}
const PROFILE = { ana: 'a11y-a', bruno: 'a11y-b' }
const SYNTHETIC_MIC = `(() => {
  const md = navigator.mediaDevices
  if (!md || md.__a11y) return
  md.__a11y = true
  md.getUserMedia = async (c) => {
    if (c && c.video) throw new DOMException('a11y harness: camera blocked', 'NotAllowedError')
    const ctx = new AudioContext({ sampleRate: 48000 })
    const osc = ctx.createOscillator()
    osc.frequency.value = 220
    const gain = ctx.createGain()
    gain.gain.value = 0
    const dst = ctx.createMediaStreamDestination()
    osc.connect(gain).connect(dst)
    osc.start()
    return dst.stream
  }
})()`
function micWav() {
  const f = join(WORK, 'speech.wav')
  if (!existsSync(f)) {
    const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', "aevalsrc='0.45*sin(2*PI*190*t)*(0.55+0.45*sin(2*PI*2.3*t))*gt(sin(2*PI*0.35*t),-0.6)':s=48000:d=30", '-ac', '1', '-c:a', 'pcm_s16le', f], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`)
  }
  return f
}
async function launch(k, { x, y, w, h }) {
  rmSync(join(process.env.APPDATA ?? '', 'Alga Meet Dev', 'profiles', PROFILE[k]), { recursive: true, force: true })
  const env = { ...process.env, ALGA_API_URL: Q.API, ALGA_E2E: '1' }
  delete env.ELECTRON_RENDERER_URL
  const bg = ['--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-background-timer-throttling']
  const media = k === 'ana' ? [] : ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${micWav()}`]
  const app = await electron.launch({ executablePath: electronPath, args: [APP, `--profile=${PROFILE[k]}`, ...bg, ...media], cwd: Q.appDir, env })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.log(`  [${k}] pageerror ${e.message.slice(0, 200)}`))
  await app.evaluate(({ shell, Notification, desktopCapturer, BrowserWindow }, o) => {
    shell.openExternal = async () => undefined
    Notification.prototype.show = function () {}
    const orig = desktopCapturer.getSources.bind(desktopCapturer)
    desktopCapturer.getSources = async (opts) => (await orig(opts)).filter((s) => s.name.includes('A11Y-Share'))
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(o.w, o.h)
    win.setPosition(o.x, o.y)
  }, { x, y, w, h })
  if (k === 'ana') {
    await page.context().addInitScript(SYNTHETIC_MIC)
    await page.reload()
  }
  await page.waitForLoadState('domcontentloaded')
  apps[k] = { app, page }
  return page
}
const lib = (p) => p.evaluate(installA11y)
async function signInByApi(p, u) {
  await p.getByLabel('E-mail ou nome de usuário').fill(u.username)
  await p.getByLabel('Senha', { exact: true }).fill(u.password)
  await p.getByRole('button', { name: 'Entrar', exact: true }).click()
  await p.getByRole('navigation', { name: 'Espaços' }).waitFor({ timeout: 30_000 })
}
const nav = (p) => p.getByRole('navigation', { name: 'Espaços' })
async function openSpaceChannel(p, channel = 'geral') {
  await nav(p).getByRole('button', { name: /^Clube A11y/ }).click()
  await p.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: channel, exact: true }).click()
  await p.getByRole('textbox', { name: /^Mensagem para/ }).waitFor()
  await sleep(400)
}
/** Back to a known state between checks: no menu/popover/dialog, chat of #geral. */
async function reset(p) {
  for (let i = 0; i < 4; i++) {
    if (!(await p.locator('[role=menu], [role=dialog]').count())) break
    await p.keyboard.press('Escape')
    await sleep(250)
  }
  if (!(await p.getByRole('textbox', { name: /^Mensagem para #geral/ }).isVisible().catch(() => false))) await openSpaceChannel(p)
}

// ── pass 1: rule audit per screen (+ focus walk) ─────────────
const NO_TRANSITIONS = '*,*::before,*::after{transition:none!important;animation-play-state:paused!important}'
async function focusWalk(p, max = 45) {
  await lib(p)
  const style = await p.addStyleTag({ content: NO_TRANSITIONS })
  await p.evaluate(() => (window.__a11ySeen = new WeakSet()))
  const items = []
  for (let i = 0; i < max; i++) {
    await p.keyboard.press('Tab')
    await sleep(40)
    const r = await p.evaluate(() => window.__a11y.focusProbe())
    if (!r) continue
    if (r.repeat) break
    items.push(r)
  }
  await style.evaluate((n) => n.remove())
  return items
}
async function auditScreen(p, screen, { walk = false, before } = {}) {
  await lib(p)
  if (before) await before()
  await sleep(350)
  const a = await p.evaluate(() => window.__a11y.audit())
  result.audit[screen] = a
  ;(result.contrastStats ??= {})[screen] = await p.evaluate(() => window.__a11y.contrastStats)
  const n = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.length]))
  if (walk) {
    const items = await focusWalk(p)
    result.focus[screen] = { tabbed: items.length, invisible: items.filter((i) => !i.changed).map((i) => i.desc), noFocusVisible: items.filter((i) => !i.focusVisible).map((i) => i.desc) }
    n.focus = result.focus[screen].invisible.length
  }
  console.log(`  · ${screen}: ${Object.entries(n).map(([k, v]) => `${k} ${v}`).join(', ')}`)
}
async function passAudit() {
  console.log('▸ audit')
  const p = apps.ana.page
  const b = apps.bruno.page
  // Signed out (Bruno's window, before he signs in).
  await auditScreen(b, 'entrar', { walk: true })
  await signInByApi(b, U.bruno)
  await openSpaceChannel(p)
  await auditScreen(p, 'chat', { walk: true })
  await auditScreen(p, 'menu-mensagem', {
    before: async () => {
      await p.locator('[data-message-id]').filter({ hasText: 'Chamo a Carla' }).filter({ hasNotText: 'Combinado' }).last().click({ button: 'right' })
      await p.getByRole('menu').waitFor()
    },
  })
  await reset(p)
  await auditScreen(p, 'emoji', {
    before: async () => {
      await p.getByRole('button', { name: 'Emoji', exact: true }).click()
      await p.getByLabel('Buscar emoji').waitFor()
    },
  })
  await reset(p)
  await auditScreen(p, 'perfil', {
    before: async () => {
      await p.locator('[aria-label="Membros"]').getByRole('button', { name: /Bruno Costa/ }).first().click()
      await p.getByRole('dialog', { name: /Bruno Costa/ }).waitFor()
    },
  })
  await reset(p)
  await auditScreen(p, 'ir-para', {
    walk: true,
    before: async () => {
      await p.keyboard.press('Control+k')
      await p.getByRole('dialog', { name: 'Ir para' }).waitFor()
    },
  })
  await reset(p)
  await auditScreen(p, 'denuncia', {
    before: async () => {
      await p.locator('[data-message-id]').filter({ hasText: 'Chamo a Carla' }).filter({ hasNotText: 'Combinado' }).last().click({ button: 'right' })
      await p.getByRole('menuitem', { name: /Denunciar/ }).click()
      await p.getByRole('dialog', { name: 'Denunciar mensagem' }).waitFor()
    },
  })
  await reset(p)
  for (const [section, screen] of [['Minha conta', 'config-conta'], ['Voz e vídeo', 'config-voz'], ['Aparência', 'config-aparencia']]) {
    await auditScreen(p, screen, {
      walk: screen === 'config-aparencia',
      before: async () => {
        if (!(await p.getByRole('dialog', { name: 'Configurações' }).isVisible().catch(() => false))) await p.getByRole('button', { name: 'Configurações', exact: true }).click()
        await p.getByRole('dialog', { name: 'Configurações' }).getByRole('navigation').getByRole('button', { name: section, exact: true }).click()
      },
    })
  }
  await reset(p)
  await auditScreen(p, 'equipe', {
    before: async () => {
      await nav(p).getByRole('button', { name: 'Painel da equipe' }).click()
      await p.getByRole('dialog', { name: 'Painel da equipe' }).waitFor()
    },
  })
  await reset(p)
  await auditScreen(p, 'amigos', { before: () => nav(p).getByRole('button', { name: 'Conversas', exact: true }).click() })
  await openSpaceChannel(p)
  // Voice: both in the call (Bruno speaks), the stage, the dock, the screen picker.
  await joinBoth()
  await auditScreen(p, 'chamada', { walk: true })
  await auditScreen(p, 'seletor-tela', {
    walk: true,
    before: async () => {
      await p.getByRole('toolbar', { name: 'Controles da chamada' }).getByRole('button', { name: 'Compartilhar tela' }).click()
      await p.getByRole('dialog', { name: 'Compartilhar tela' }).waitFor()
      await sleep(1500)
    },
  })
  await reset(p)
}
async function joinBoth() {
  const p = apps.ana.page
  const b = apps.bruno.page
  for (const x of [p, b]) {
    if (await x.getByRole('toolbar', { name: 'Controles da chamada' }).isVisible().catch(() => false)) continue
    if (!(await x.getByRole('complementary', { name: 'Canais' }).isVisible().catch(() => false))) await nav(x).getByRole('button', { name: /^Clube A11y/ }).click()
    await x.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: /^Entrar em Geral|^Geral$/ }).first().click()
    await x.getByRole('toolbar', { name: 'Controles da chamada' }).waitFor({ timeout: 30_000 })
  }
  await sleep(2500)
}

// ── pass 2: keyboard-only journeys ───────────────────────────
const act = (p) => p.evaluate(() => window.__a11y.active())
const fmt = (a) => `${a.role ?? a.tag} "${a.name.slice(0, 50)}"${a.checked != null ? ` (${a.checked})` : ''}`
async function tabUntil(p, pred, { max = 40, shift = false } = {}) {
  for (let i = 1; i <= max; i++) {
    await p.keyboard.press(shift ? 'Shift+Tab' : 'Tab')
    await sleep(50)
    const a = await act(p)
    if (pred(a)) return i
  }
  throw new Error(`${shift ? 'Shift+Tab' : 'Tab'} ×${max} sem chegar ao alvo (foco em ${fmt(await act(p))})`)
}
async function keyUntil(p, key, pred, max = 12) {
  for (let i = 1; i <= max; i++) {
    await p.keyboard.press(key)
    await sleep(80)
    if (pred(await act(p))) return i
  }
  throw new Error(`${key} ×${max} sem chegar ao alvo (foco em ${fmt(await act(p))})`)
}
const inside = (a, re) => a.where.some((w) => re.test(w))
async function waitFor(fn, what, timeout = 8000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (await fn().catch(() => false)) return
    await sleep(150)
  }
  throw new Error(`timeout: ${what}`)
}
async function journey(id, title, fn, { setup } = {}) {
  const p = apps.ana.page
  const j = { id, title, steps: [], ok: true }
  result.journeys.push(j)
  console.log(`▸ ${id} ${title}`)
  try {
    if (setup) await setup(p)
    await lib(p)
    await fn(p, async (text, check) => {
      const detail = await check()
      j.steps.push({ text, ok: true, detail: detail ?? '' })
      console.log(`  ✓ ${text}${detail ? ` — ${detail}` : ''}`)
    })
  } catch (e) {
    j.ok = false
    j.steps.push({ text: 'falhou', ok: false, detail: String(e.message ?? e).split('\n')[0].slice(0, 300) })
    console.log(`  ✗ ${String(e.message ?? e).split('\n')[0].slice(0, 300)}`)
    await p.screenshot({ path: join(WORK, `${LABEL}-${id}.png`) }).catch(() => undefined)
    for (let i = 0; i < 4; i++) await p.keyboard.press('Escape').catch(() => undefined)
  }
}
/** Journeys that start in the conversation: the setup puts the focus in the composer (not part of the journey). */
const fromComposer = async (p) => {
  await reset(p)
  await p.getByRole('textbox', { name: /^Mensagem para/ }).focus()
}
const expectTrue = (cond, msg) => {
  if (!cond) throw new Error(msg)
}
async function passJourneys() {
  const p = apps.ana.page
  await journey('J1', 'Entrar só com o teclado', async (p, step) => {
    await p.getByLabel('E-mail ou nome de usuário').waitFor({ timeout: 30_000 })
    await lib(p)
    await step('foco inicial no campo de login', async () => {
      let a = await act(p)
      if (a.name !== 'E-mail ou nome de usuário') await tabUntil(p, (x) => x.name === 'E-mail ou nome de usuário', { max: 10 })
      a = await act(p)
      return fmt(a)
    })
    await p.keyboard.type(U.ana.username)
    await step('Tab vai para a senha', async () => {
      const n = await tabUntil(p, (x) => x.name === 'Senha', { max: 4 })
      return `${n} Tab`
    })
    await p.keyboard.type(U.ana.password)
    await p.keyboard.press('Enter')
    await step('Enter entra no app', async () => {
      await nav(p).waitFor({ timeout: 30_000 })
      await lib(p)
      return 'navegação "Espaços" visível'
    })
  })

  await journey('J2', 'Rail e lista de canais com setas, abrir um canal', async (p, step) => {
    await step('Tab chega ao rail', async () => `${await tabUntil(p, (a) => inside(a, /^navigation:Espaços/))} Tab até ${fmt(await act(p))}`)
    await step('↓ move entre os itens do rail', async () => {
      const a0 = await act(p)
      await p.keyboard.press('ArrowDown')
      await sleep(100)
      const a1 = await act(p)
      expectTrue(inside(a1, /^navigation:Espaços/) && a1.name !== a0.name, `↓ não moveu o foco (${fmt(a0)} → ${fmt(a1)})`)
      await p.keyboard.press('Home')
      const first = await act(p)
      await keyUntil(p, 'ArrowDown', (a) => /^Clube A11y/.test(a.name), 6)
      return `↓ ${fmt(a0)} → ${fmt(a1)}; Home → ${fmt(first)}; ↓ → ${fmt(await act(p))}`
    })
    await p.keyboard.press('Enter')
    await step('Enter abre o espaço', async () => {
      await p.getByRole('complementary', { name: 'Canais' }).waitFor()
      return fmt(await act(p))
    })
    await step('foco chega à lista de canais e ↓/↑ navegam', async () => {
      const n = await tabUntil(p, (a) => a.name === 'geral' || a.name === 'Entrar em Geral', { shift: true, max: 30 })
      const a0 = await act(p)
      await p.keyboard.press('Home')
      const home = await act(p)
      await keyUntil(p, 'ArrowDown', (a) => /Geral/.test(a.name) && a.name !== 'geral', 4)
      await keyUntil(p, 'ArrowUp', (a) => a.name === 'geral', 4)
      return `${n} Shift+Tab até ${fmt(a0)}; Home → ${fmt(home)}; ↓ até o canal de voz, ↑ volta a ${fmt(await act(p))}`
    })
    await p.keyboard.press('Enter')
    await step('Enter abre #geral e o foco vai ao composer', async () => {
      await waitFor(async () => /^Mensagem para #geral/.test((await act(p)).name), 'foco no composer de #geral')
      return fmt(await act(p))
    })
  }, { setup: async (p) => { await nav(p).getByRole('button', { name: 'Conversas', exact: true }).click(); await sleep(300); await p.evaluate(() => document.activeElement?.blur()) } })

  await journey('J3', 'Escrever, enviar, editar (↑), responder e reagir', async (p, step) => {
    const msg = `Teste de teclado ${randomBytes(2).toString('hex')}`
    await p.keyboard.type(msg)
    await p.keyboard.press('Enter')
    await step('Enter envia', async () => {
      await p.locator('[data-message-id]').filter({ hasText: msg }).last().waitFor()
      return msg
    })
    await sleep(600)
    await p.keyboard.press('ArrowUp')
    await step('↑ no composer vazio edita a última mensagem', async () => {
      await waitFor(async () => (await act(p)).name === 'Editar', 'campo de edição focado')
      return fmt(await act(p))
    })
    await p.keyboard.press('End')
    await p.keyboard.type(' (corrigida)')
    await p.keyboard.press('Enter')
    await step('Enter salva a edição e o foco volta ao composer', async () => {
      await p.locator('[data-message-id]').filter({ hasText: `${msg} (corrigida)` }).last().waitFor()
      await waitFor(async () => /^Mensagem para/.test((await act(p)).name), 'foco de volta no composer', 3000)
      return fmt(await act(p))
    })
    await step('Shift+Tab chega às mensagens e ↑ vai à do Bruno', async () => {
      await tabUntil(p, (a) => a.role === 'article', { shift: true, max: 8 })
      for (let i = 0; i < 4; i++) {
        const txt = await p.evaluate(() => document.activeElement?.textContent ?? '')
        if (txt.includes('Chamo a Carla') && !txt.includes('Combinado')) break
        await p.keyboard.press('ArrowUp')
        await sleep(120)
      }
      const txt = await p.evaluate(() => document.activeElement?.textContent ?? '')
      expectTrue(txt.includes('Chamo a Carla'), 'não chegou à mensagem do Bruno')
      return 'mensagem do Bruno focada'
    })
    await step('Tab entra na barra de ações e reage com 👍', async () => {
      await tabUntil(p, (a) => /^Reagir com/.test(a.name), { max: 3 })
      const label = (await act(p)).name
      await p.keyboard.press('Enter')
      await p.locator('[data-message-id]').filter({ hasText: 'Chamo a Carla' }).filter({ hasNotText: 'Combinado' }).last().locator('button[aria-pressed="true"]').first().waitFor()
      return label
    })
    await step('Responder pela barra de ações leva ao composer', async () => {
      await tabUntil(p, (a) => a.name === 'Responder', { max: 10 })
      await p.keyboard.press('Enter')
      await waitFor(async () => /^Mensagem para/.test((await act(p)).name), 'composer focado após Responder', 3000)
      await p.getByText('Respondendo a').waitFor()
      return fmt(await act(p))
    })
    await p.keyboard.type('Combinado!')
    await p.keyboard.press('Enter')
    await step('resposta enviada com a citação', async () => {
      await p.locator('[data-message-id]').filter({ hasText: 'Combinado!' }).last().filter({ hasText: 'Bruno Costa' }).waitFor()
      return 'ok'
    })
  }, { setup: reset })

  await journey('J4', 'Seletor de emoji e autocomplete de menção', async (p, step) => {
    await p.keyboard.type('Oi @bru')
    await step('@ abre a lista de menções', async () => {
      await p.getByRole('listbox', { name: 'Mencionar' }).waitFor({ timeout: 3000 })
      return (await p.getByRole('listbox', { name: 'Mencionar' }).getByRole('option').allTextContents()).join(', ').slice(0, 60)
    })
    await p.keyboard.press('Enter')
    await step('Enter escolhe a menção', async () => {
      const v = await p.getByRole('textbox', { name: /^Mensagem para/ }).inputValue()
      expectTrue(/@Bruno Costa/.test(v), `composer: "${v}"`)
      return v
    })
    await step('Tab chega ao botão de emoji e Enter abre o seletor', async () => {
      await tabUntil(p, (a) => a.name === 'Emoji', { max: 4 })
      await p.keyboard.press('Enter')
      await waitFor(async () => (await act(p)).name === 'Buscar emoji', 'busca de emoji focada', 3000)
      return fmt(await act(p))
    })
    await p.keyboard.type('sorr')
    await sleep(200)
    await p.keyboard.press('ArrowDown')
    await p.keyboard.press('Enter')
    await step('Enter insere o emoji e o foco volta ao composer', async () => {
      await waitFor(async () => /^Mensagem para/.test((await act(p)).name), 'composer focado', 3000)
      const v = await p.getByRole('textbox', { name: /^Mensagem para/ }).inputValue()
      expectTrue(/\p{Extended_Pictographic}/u.test(v), `sem emoji: "${v}"`)
      return v
    })
    await step('Esc no seletor fecha e devolve o foco ao botão', async () => {
      await tabUntil(p, (a) => a.name === 'Emoji', { max: 4 })
      await p.keyboard.press('Enter')
      await waitFor(async () => (await act(p)).name === 'Buscar emoji', 'busca de emoji focada', 3000)
      await p.keyboard.press('Escape')
      await waitFor(async () => (await act(p)).name === 'Emoji', 'foco no botão Emoji', 2000)
      return fmt(await act(p))
    })
    await tabUntil(p, (a) => /^Mensagem para/.test(a.name), { shift: true, max: 4 })
    await p.keyboard.press('Enter')
    await step('mensagem com menção enviada', async () => {
      await p.locator('[data-message-id]').filter({ hasText: '@Bruno Costa' }).last().waitFor()
      return 'ok'
    })
  }, { setup: reset })

  await journey('J5', 'Ctrl+K: ir para um canal, Esc devolve o foco', async (p, step) => {
    await p.keyboard.press('Control+k')
    await step('Ctrl+K abre "Ir para" com a busca focada', async () => {
      await p.getByRole('dialog', { name: 'Ir para' }).waitFor()
      await waitFor(async () => (await act(p)).role === 'combobox', 'combobox focado', 2000)
      return fmt(await act(p))
    })
    await p.keyboard.type('Clube')
    await sleep(250)
    await p.keyboard.press('ArrowDown')
    await p.keyboard.press('ArrowUp')
    await p.keyboard.press('Enter')
    await step('Enter vai ao destino', async () => {
      await waitFor(async () => !(await p.getByRole('dialog', { name: 'Ir para' }).isVisible()), 'switcher fechado', 3000)
      return fmt(await act(p))
    })
    await fromComposer(p)
    const before = await act(p)
    await p.keyboard.press('Control+k')
    await p.getByRole('dialog', { name: 'Ir para' }).waitFor()
    await p.keyboard.press('Escape')
    await step('Esc fecha e o foco volta para onde estava', async () => {
      await waitFor(async () => (await act(p)).name === before.name, `foco em ${fmt(before)}`, 2000)
      return fmt(await act(p))
    })
  }, { setup: fromComposer })

  await journey('J6', 'Voz: entrar, mudo/ensurdecer, escolher tela, transmitir e parar', async (p, step) => {
    await step('Shift+Tab chega à lista e ↓ ao canal de voz', async () => {
      await tabUntil(p, (a) => a.name === 'geral' || a.name === 'Entrar em Geral', { shift: true, max: 30 })
      if ((await act(p)).name !== 'Entrar em Geral') await keyUntil(p, 'ArrowDown', (a) => /Geral/.test(a.name) && a.name !== 'geral', 6)
      return fmt(await act(p))
    })
    await p.keyboard.press('Enter')
    await step('Enter entra na chamada', async () => {
      await p.getByRole('toolbar', { name: 'Controles da chamada' }).waitFor({ timeout: 30_000 })
      await waitFor(() => p.getByRole('toolbar', { name: 'Controles da chamada' }).getByRole('button', { name: 'Compartilhar tela', exact: true }).evaluate((b) => b.getAttribute('aria-disabled') !== 'true'), 'conectado', 20_000)
      return fmt(await act(p))
    })
    await step('Tab chega aos controles; Enter silencia (aria-pressed)', async () => {
      await tabUntil(p, (a) => inside(a, /^toolbar:Controles da chamada/), { max: 40 })
      if (!/microfone/.test((await act(p)).name)) await keyUntil(p, 'Shift+Tab', (a) => /microfone/.test(a.name), 6)
      await p.keyboard.press('Enter')
      await sleep(400)
      const a = await act(p)
      expectTrue(a.checked === 'true', `mute não ficou pressionado: ${fmt(a)}`)
      return fmt(a)
    })
    await step('Enter de novo reativa; Tab + Enter ensurdece e volta', async () => {
      await p.keyboard.press('Enter')
      await sleep(300)
      await p.keyboard.press('Tab')
      await p.keyboard.press('Enter')
      await sleep(300)
      const a = await act(p)
      expectTrue(/áudio/.test(a.name) && a.checked === 'true', `ensurdecer: ${fmt(a)}`)
      await p.keyboard.press('Enter')
      await sleep(300)
      return fmt(a)
    })
    await step('Compartilhar tela abre o seletor com o foco dentro', async () => {
      await tabUntil(p, (a) => a.name === 'Compartilhar tela', { max: 4 })
      await p.keyboard.press('Enter')
      await p.getByRole('dialog', { name: 'Compartilhar tela' }).waitFor()
      await waitFor(async () => inside(await act(p), /^dialog:Compartilhar tela/), 'foco no seletor', 3000)
      return fmt(await act(p))
    })
    await step('setas escolhem "Janelas" e a segunda janela', async () => {
      await tabUntil(p, (a) => a.role === 'tab', { max: 10 })
      await p.keyboard.press('ArrowRight')
      await sleep(1800)
      expectTrue((await act(p)).name === 'Janelas', `aba: ${fmt(await act(p))}`)
      await tabUntil(p, (a) => a.role === 'radio' && /A11Y-Share/.test(a.name), { max: 4 })
      const first = (await act(p)).name
      await p.keyboard.press('ArrowRight')
      await sleep(200)
      const a = await act(p)
      expectTrue(a.name !== first && a.checked === 'true', `→ não escolheu outra janela (foco em ${fmt(a)})`)
      return `${first} → ${fmt(a)}`
    })
    await step('Transmitir começa a transmissão', async () => {
      await tabUntil(p, (a) => a.name === 'Transmitir', { max: 25 })
      await p.keyboard.press('Enter')
      await p.getByRole('toolbar', { name: 'Controles da chamada' }).getByRole('button', { name: 'Parar transmissão' }).waitFor({ timeout: 20_000 })
      return `foco depois: ${fmt(await act(p))}`
    })
    await step('foco volta ao controle de transmissão', async () => {
      const a = await act(p)
      expectTrue(a.name === 'Parar transmissão', `foco em ${fmt(a)}`)
      return fmt(a)
    })
    await step('Parar transmissão pelo menu do teclado', async () => {
      if ((await act(p)).name !== 'Parar transmissão') await tabUntil(p, (a) => a.name === 'Parar transmissão' && a.role === 'button', { max: 40 })
      await p.keyboard.press('Enter')
      await p.getByRole('menu').waitFor()
      for (let i = 0; i < 3; i++) {
        const cur = await p.evaluate(() => { const m = document.querySelector('[role=menu]'); return m && document.getElementById(m.getAttribute('aria-activedescendant') ?? '')?.textContent })
        if (cur === 'Parar transmissão') break
        await p.keyboard.press('ArrowDown')
      }
      await p.keyboard.press('Enter')
      await p.getByRole('toolbar', { name: 'Controles da chamada' }).getByRole('button', { name: 'Compartilhar tela' }).waitFor({ timeout: 10_000 })
      return `foco depois: ${fmt(await act(p))}`
    })
  }, { setup: reset })

  await journey('J7', 'Configurações: abrir, mudar uma opção, Esc volta', async (p, step) => {
    await step('Tab chega a Configurações e Enter abre', async () => {
      await tabUntil(p, (a) => a.name === 'Configurações', { max: 40 })
      await p.keyboard.press('Enter')
      await p.getByRole('dialog', { name: 'Configurações' }).waitFor()
      await waitFor(async () => inside(await act(p), /^dialog:Configurações/), 'foco dentro', 3000)
      return fmt(await act(p))
    })
    await step('chega a Aparência pelo teclado', async () => {
      await keyUntil(p, 'ArrowDown', (a) => a.name === 'Aparência', 12).catch(() => keyUntil(p, 'Tab', (a) => a.name === 'Aparência', 12))
      await p.keyboard.press('Enter')
      await p.getByRole('dialog', { name: 'Configurações' }).getByRole('heading', { name: 'Aparência' }).waitFor()
      return fmt(await act(p))
    })
    await step('Espaço liga "Reduzir animações"', async () => {
      await tabUntil(p, (a) => a.name === 'Reduzir animações', { max: 30 })
      await p.keyboard.press('Space')
      await waitFor(() => p.evaluate(() => document.documentElement.classList.contains('reduce-motion')), 'html.reduce-motion', 2000)
      await p.keyboard.press('Space')
      return fmt(await act(p))
    })
    await p.keyboard.press('Escape')
    await step('Esc fecha e o foco volta ao botão Configurações', async () => {
      await waitFor(async () => !(await p.getByRole('dialog', { name: 'Configurações' }).isVisible()), 'fechou', 3000)
      await waitFor(async () => (await act(p)).name === 'Configurações', 'foco no gatilho', 2000)
      return fmt(await act(p))
    })
  }, { setup: reset })

  await journey('J8', 'Menu de contexto pelo teclado (Shift+F10 / tecla Menu)', async (p, step) => {
    await step('Shift+F10 numa mensagem abre o menu com o 1º item ativo', async () => {
      await tabUntil(p, (a) => a.role === 'article', { shift: true, max: 8 })
      await p.keyboard.press('Shift+F10')
      await p.getByRole('menu').waitFor({ timeout: 2000 })
      const ad = await p.evaluate(() => document.querySelector('[role=menu]')?.getAttribute('aria-activedescendant'))
      expectTrue(!!ad, 'nenhum item ativo')
      return `${await p.getByRole('menu').getAttribute('aria-label')} · ${ad}`
    })
    await step('Esc fecha e o foco volta à mensagem', async () => {
      await p.keyboard.press('Escape')
      await waitFor(async () => (await act(p)).role === 'article', 'foco na mensagem', 2000)
      return fmt(await act(p))
    })
    await step('tecla Menu abre o mesmo menu', async () => {
      await p.keyboard.press('ContextMenu')
      await p.getByRole('menu').waitFor({ timeout: 2000 })
      await p.keyboard.press('Escape')
      await waitFor(async () => (await act(p)).role === 'article', 'foco na mensagem', 2000)
      return 'ok'
    })
    await step('Shift+F10 num membro abre o menu da pessoa', async () => {
      await tabUntil(p, (a) => /^Bruno Costa/.test(a.name) && !inside(a, /^log:/), { max: 40 })
      await p.keyboard.press('Shift+F10')
      await p.getByRole('menu').waitFor({ timeout: 2000 })
      return (await p.getByRole('menu').getByRole('menuitem').allTextContents()).slice(0, 4).join(', ')
    })
    await step('Esc devolve o foco ao membro', async () => {
      await p.keyboard.press('Escape')
      await waitFor(async () => /Bruno Costa/.test((await act(p)).name), 'foco no membro', 2000)
      return fmt(await act(p))
    })
  }, { setup: fromComposer })

  await journey('J9', 'Denúncia e painel da equipe, Esc devolve o foco', async (p, step) => {
    await step('menu da mensagem → Denunciar abre o diálogo', async () => {
      await tabUntil(p, (a) => a.role === 'article', { shift: true, max: 8 })
      const isBruno = async () => { const t = await p.evaluate(() => document.activeElement?.textContent ?? ''); return t.includes('Chamo a Carla') && !t.includes('Combinado') }
      for (let i = 0; i < 6 && !(await isBruno()); i++) await p.keyboard.press('ArrowUp')
      expectTrue(await isBruno(), 'não chegou à mensagem do Bruno')
      await p.keyboard.press('Shift+F10')
      await p.getByRole('menu').waitFor({ timeout: 2000 })
      for (let i = 0; i < 12; i++) {
        const cur = await p.evaluate(() => { const m = document.querySelector('[role=menu]'); return m && document.getElementById(m.getAttribute('aria-activedescendant') ?? '')?.textContent })
        if (/Denunciar/.test(cur ?? '')) break
        await p.keyboard.press('ArrowDown')
      }
      await p.keyboard.press('Enter')
      await p.getByRole('dialog', { name: 'Denunciar mensagem' }).waitFor()
      await waitFor(async () => inside(await act(p), /^dialog:Denunciar mensagem/), 'foco no diálogo', 2000)
      return fmt(await act(p))
    })
    await step('escolhe um motivo pelo teclado', async () => {
      await tabUntil(p, (a) => a.role === 'radio' || a.role === 'checkbox' || a.tag === 'input', { max: 12 })
      await p.keyboard.press('Space')
      await sleep(150)
      return fmt(await act(p))
    })
    await step('Esc fecha e o foco volta à mensagem', async () => {
      await p.keyboard.press('Escape')
      await waitFor(async () => !(await p.getByRole('dialog', { name: 'Denunciar mensagem' }).isVisible()), 'fechou', 2000)
      await waitFor(async () => (await act(p)).role === 'article', 'foco na mensagem', 2000)
      return fmt(await act(p))
    })
    await step('painel da equipe pelo rail, Esc volta ao botão', async () => {
      await tabUntil(p, (a) => a.name === 'Painel da equipe', { shift: true, max: 60 })
      await p.keyboard.press('Enter')
      await p.getByRole('dialog', { name: 'Painel da equipe' }).waitFor()
      await waitFor(async () => inside(await act(p), /^dialog:Painel da equipe/), 'foco no painel', 3000)
      await p.keyboard.press('Escape')
      await waitFor(async () => (await act(p)).name === 'Painel da equipe', 'foco no gatilho', 3000)
      return fmt(await act(p))
    })
  }, { setup: fromComposer })

  await journey('J10', 'Esc fecha tudo e sai da chamada', async (p, step) => {
    await step('nada aberto, Desconectar pelo teclado', async () => {
      for (let i = 0; i < 3; i++) await p.keyboard.press('Escape')
      expectTrue(!(await p.locator('[role=menu], [role=dialog][aria-modal=true]').count()), 'ainda há menu/diálogo aberto')
      await tabUntil(p, (a) => a.name === 'Desconectar', { max: 60 })
      await p.keyboard.press('Enter')
      await waitFor(async () => !(await p.getByRole('toolbar', { name: 'Controles da chamada' }).isVisible()) && !(await p.getByText('Voz conectada').first().isVisible()), 'saiu', 5000)
      await sleep(300)
      const a = await act(p)
      expectTrue(a.tag !== 'body', 'o foco caiu no <body> ao sair da chamada')
      return `foco depois: ${fmt(a)}`
    })
  }, { setup: async (p) => { await p.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: 'geral', exact: true }).click(); await sleep(300) } })
}

// ── pass 3: live regions ─────────────────────────────────────
async function passLive() {
  console.log('▸ live regions')
  const p = apps.ana.page
  await reset(p)
  await lib(p)
  await p.evaluate(() => window.__a11y.recordLive())
  const expectLive = async (what, re, fn) => {
    const t0 = Date.now()
    await fn()
    let hit = null
    for (let i = 0; i < 40 && !hit; i++) {
      await sleep(200)
      const log = await p.evaluate(() => window.__a11y.live)
      hit = log.filter((e) => e.at >= t0 && re.test(e.text)).find((e) => e.announced) ?? (i === 39 ? log.filter((e) => e.at >= t0 && re.test(e.text))[0] : null)
    }
    const ok = !!hit?.announced
    result.live.push({ what, ok, detail: hit ? `${hit.announced ? 'anunciado' : 'inserido junto com a região (não anunciado)'}: "${hit.text}" em ${hit.region}` : 'nenhuma região viva recebeu o texto' })
    console.log(`  ${ok ? '✓' : '✗'} ${what} — ${result.live.at(-1).detail}`)
  }
  await expectLive('digitando', /Bruno.*digitando/, () => api(U.bruno.token, 'POST', `/channels/${S.text.id}/typing`))
  await expectLive('nova mensagem', /Mensagem nova do Bruno/, () => api(U.bruno.token, 'POST', `/channels/${S.text.id}/messages`, { content: 'Mensagem nova do Bruno' }))
  await expectLive('toast', /copiado/i, async () => {
    await p.getByRole('complementary', { name: 'Canais' }).locator('button[aria-haspopup="dialog"]').last().click()
    await p.getByRole('button', { name: /Copiar nome de usuário/ }).click()
  })
  // Voice: Ana in the call, Bruno joins and leaves.
  const b = apps.bruno.page
  if (await b.getByRole('toolbar', { name: 'Controles da chamada' }).isVisible().catch(() => false)) {
    await b.getByRole('toolbar', { name: 'Controles da chamada' }).getByRole('button', { name: 'Desconectar' }).click()
    await sleep(1500)
  }
  await p.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: /^Entrar em Geral|^Geral$/ }).first().click()
  await p.getByRole('toolbar', { name: 'Controles da chamada' }).waitFor({ timeout: 30_000 })
  await sleep(2000)
  await expectLive('entrou na voz', /Bruno.*entrou/, () => b.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: /^Entrar em Geral|^Geral$/ }).first().click())
  await sleep(1500)
  await expectLive('saiu da voz', /Bruno.*saiu/, () => b.getByRole('toolbar', { name: 'Controles da chamada' }).getByRole('button', { name: 'Desconectar' }).click())
}

// ── pass 4: reduced motion ───────────────────────────────────
async function sampleSpeak(p, ms = 3000) {
  return p.evaluate(async (ms) => {
    const els = [...document.querySelectorAll('[style*="--speak"]')]
    const values = new Map(els.map((e) => [e, new Set()]))
    const t0 = performance.now()
    while (performance.now() - t0 < ms) {
      for (const e of els) values.get(e).add(e.style.getPropertyValue('--speak').trim())
      await new Promise((r) => setTimeout(r, 30))
    }
    const all = [...values.values()].flatMap((s) => [...s])
    return { elements: els.length, distinct: [...new Set(all)].length, intermediate: all.filter((v) => v !== '0' && v !== '1' && v !== '1.000').length, sample: [...new Set(all)].slice(0, 8) }
  }, ms)
}
async function passMotion() {
  console.log('▸ reduced motion')
  const p = apps.ana.page
  await reset(p)
  await joinBoth()
  await lib(p)
  const roomGlow = () => p.evaluate(() => [...document.querySelectorAll('section *')].filter((e) => getComputedStyle(e, '::before').backgroundImage.includes('radial-gradient')).map((e) => getComputedStyle(e, '::before').display).join(','))
  const measure = async (mode) => {
    await sleep(800)
    const speak = await sampleSpeak(p)
    const anims = await p.evaluate(() => window.__a11y.animations())
    result.motion[mode] = { speak, animations: anims.length, animationSamples: anims.slice(0, 8), roomGlow: await roomGlow() }
    console.log(`  · ${mode}: --speak ${speak.distinct} valores (${speak.intermediate} intermediários) em ${speak.elements} elementos, ${anims.length} animações rodando`)
  }
  await measure('normal')
  await p.emulateMedia({ reducedMotion: 'reduce' })
  await measure('prefers-reduced-motion')
  await p.emulateMedia({ reducedMotion: 'no-preference' })
  await p.getByRole('button', { name: 'Configurações', exact: true }).click()
  await p.getByRole('dialog', { name: 'Configurações' }).getByRole('navigation').getByRole('button', { name: 'Aparência', exact: true }).click()
  await p.getByRole('switch', { name: 'Reduzir animações' }).or(p.getByRole('checkbox', { name: 'Reduzir animações' })).first().click()
  await p.keyboard.press('Escape')
  await measure('reduzir-animacoes')
  await p.getByRole('button', { name: 'Configurações', exact: true }).click()
  await p.getByRole('dialog', { name: 'Configurações' }).getByRole('navigation').getByRole('button', { name: 'Aparência', exact: true }).click()
  await p.getByRole('switch', { name: 'Reduzir animações' }).or(p.getByRole('checkbox', { name: 'Reduzir animações' })).first().click()
  await p.keyboard.press('Escape')
}

// ── pass 5: forced colors (Windows high contrast) ────────────
async function passForced() {
  console.log('▸ forced colors')
  const p = apps.ana.page
  await reset(p)
  await joinBoth()
  await p.emulateMedia({ forcedColors: 'active' })
  const shot = async (name, before) => {
    if (before) await before()
    await sleep(500)
    const f = join(OUT, `${LABEL}-forced-${name}.png`)
    await p.screenshot({ path: f, animations: 'disabled' })
    result.forced.shots.push(f.slice(Q.repo.length + 1).replaceAll('\\', '/'))
    await lib(p)
    ;(result.forced.states ??= {})[name] = await p.evaluate(() => window.__a11y.forcedStates())
    console.log(`  · ${name}: ${result.forced.states[name].length} estados ilegíveis/indistintos`)
  }
  const walk = async (screen) => {
    const items = await focusWalk(p, 30)
    result.forced.focus[screen] = { tabbed: items.length, noOutline: items.filter((i) => !i.outline).map((i) => i.desc) }
    console.log(`  · ${screen}: ${items.length} paradas de Tab, ${result.forced.focus[screen].noOutline.length} sem contorno visível`)
  }
  await p.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: 'geral', exact: true }).click()
  await p.getByRole('textbox', { name: /^Mensagem para/ }).focus()
  await walk('chat')
  await shot('chat', async () => {
    await p.getByRole('textbox', { name: /^Mensagem para/ }).focus()
    await p.keyboard.press('Shift+Tab')
    await p.keyboard.press('Shift+Tab')
    await p.keyboard.press('Shift+F10')
    await p.keyboard.press('ArrowDown')
  })
  await reset(p)
  await p.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: /^Entrar em Geral|^Geral$/ }).first().click()
  await p.getByRole('toolbar', { name: 'Controles da chamada' }).waitFor()
  await p.getByRole('toolbar', { name: 'Controles da chamada' }).getByRole('button').first().focus()
  await p.keyboard.press('Enter') // mute: the pressed state must stay visible
  await walk('chamada')
  await shot('chamada', async () => {
    await p.getByRole('toolbar', { name: 'Controles da chamada' }).getByRole('button').first().focus()
    await p.keyboard.press('Tab')
    await p.keyboard.press('Shift+Tab')
  })
  await p.keyboard.press('Enter')
  await shot('seletor-tela', async () => {
    await p.getByRole('toolbar', { name: 'Controles da chamada' }).getByRole('button', { name: 'Compartilhar tela' }).click()
    await p.getByRole('dialog', { name: 'Compartilhar tela' }).waitFor()
    await p.getByRole('tab', { name: 'Janelas' }).click()
    await sleep(1800)
    await p.getByRole('radio', { name: /A11Y-Share/ }).first().focus()
  })
  await reset(p)
  await p.getByRole('button', { name: 'Configurações', exact: true }).click()
  await p.getByRole('dialog', { name: 'Configurações' }).getByRole('navigation').getByRole('button', { name: 'Aparência', exact: true }).click()
  await walk('config-aparencia')
  await shot('config-aparencia', async () => {
    await p.getByRole('switch', { name: 'Reduzir animações' }).click()
    await p.getByRole('switch', { name: 'Reduzir animações' }).focus()
    await p.keyboard.press('Tab')
    await p.keyboard.press('Shift+Tab')
  })
  await p.getByRole('switch', { name: 'Reduzir animações' }).click()
  await reset(p)
  await p.emulateMedia({ forcedColors: 'none' })
}

// ── run ──────────────────────────────────────────────────────
const tally = () => {
  const rules = {}
  for (const a of Object.values(result.audit)) for (const [k, v] of Object.entries(a)) rules[k] = (rules[k] ?? 0) + v.length
  rules.focus = Object.values(result.focus).reduce((n, f) => n + f.invisible.length, 0)
  rules.live = result.live.filter((l) => !l.ok).length
  rules.forcedFocus = Object.values(result.forced.focus).reduce((n, f) => n + f.noOutline.length, 0)
  rules.forcedState = Object.values(result.forced.states ?? {}).reduce((n, f) => n + f.length, 0)
  return rules
}
const cleanup = async () => {
  for (const { app } of Object.values(apps)) await app.close().catch(() => undefined)
  stopStack()
}
// The passes are also importable (scratch drivers reuse the stack, seed and apps): run only when executed directly.
export { apps, U, S, api, lib, act, reset, focusWalk, startStack, stopStack, seed, shareWindows, launch, signInByApi, openSpaceChannel, joinBoth, cleanup }
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.on('SIGINT', () => void cleanup().then(() => process.exit(130)))
  try {
    if (!args.includes('--skip-build') && !arg('app')) build()
    await startStack()
    await seed()
    shareWindows()
    await launch('ana', { x: 40, y: 30, w: 1280, h: 800 })
    await launch('bruno', { x: 1340, y: 30, w: 1000, h: 700 })
    {
      await lib(apps.ana.page)
      const cr = await apps.ana.page.evaluate(() => [window.__a11y.contrast('#767676', '#ffffff'), window.__a11y.contrast('rgb(0 0 0)', 'white'), window.__a11y.contrast('rgba(255,255,255,.5)', '#000')])
      if (Math.abs(cr[0] - 4.54) > 0.02 || Math.abs(cr[1] - 21) > 0.01) throw new Error(`contrast self-test failed: ${cr}`)
    }
    if (ONLY.includes('journeys')) {
      await passJourneys()
    } else await signInByApi(apps.ana.page, U.ana)
    if (ONLY.includes('audit')) await passAudit()
    else await signInByApi(apps.bruno.page, U.bruno)
    if (ONLY.includes('live')) await passLive()
    if (ONLY.includes('motion')) await passMotion()
    if (ONLY.includes('forced')) await passForced()
  } catch (e) {
    console.error('✗ run aborted:', e)
    result.aborted = String(e.message ?? e)
    await apps.ana?.page.screenshot({ path: join(WORK, `${LABEL}-aborted.png`) }).catch(() => undefined)
  } finally {
    result.totals = tally()
    result.journeyPass = result.journeys.filter((j) => j.ok).length
    writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(result, null, 2))
    console.log('totals', result.totals, `journeys ${result.journeyPass}/${result.journeys.length}`)
    await cleanup()
  }
}
