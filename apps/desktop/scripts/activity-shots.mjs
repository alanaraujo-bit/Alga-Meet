// Rich presence ("Atividade") end to end + screenshots, isolated from the dev stack.
//   node scripts/activity-shots.mjs [--skip-build] [--keep]
// - Own API from qa-stack.mjs on :4360 (QA_WORK = %TEMP%/alga-presence-qa), no LiveKit (no voice here).
// - The app is built to QA_WORK/app and launched by Playwright (automation mode: off-screen, never steals focus).
// - Three friends are simulated over the gateway with REAL app icons extracted by the detector helper.
// - The real detector is exercised: the Calculator is focused for real, shows up in Settings → Atividade as "not
//   recognized" (off), is switched on in the UI, and a friend's socket must then receive it in PRESENCE_UPDATE.
// Output: docs/screenshots/<date>-activity-*.png. Brings a Calculator window to the front for ~20 s, then closes it.
import { execSync, spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

process.env.QA_WORK ??= join(tmpdir(), 'alga-presence-qa')
process.env.QA_API_PORT ??= '4360'
const Q = await import('./qa-stack.mjs')
const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, '..')
const repo = join(appDir, '..', '..')
const APP = join(Q.WORK, 'app')
const API = `${Q.API}/api/v1`
const args = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const today = new Date().toISOString().slice(0, 10)
const outDir = join(repo, 'docs', 'screenshots')
mkdirSync(outDir, { recursive: true })
const checks = []
const check = (ok, what) => {
  checks.push({ ok: !!ok, what })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}

// ── build ─────────────────────────────────────────────────────
if (!args.includes('--skip-build')) {
  execSync('node scripts/build-activity.mjs', { cwd: appDir, stdio: 'inherit' })
  execSync(`npx electron-vite build --outDir "${APP}"`, { cwd: appDir, stdio: 'inherit' })
  writeFileSync(join(APP, 'package.json'), JSON.stringify({ name: '@alga/desktop', productName: 'Alga Meet', version: '0.1.2', main: './main/index.js' }, null, 2))
  cpSync(join(appDir, 'build', 'runtime'), join(APP, 'build', 'runtime'), { recursive: true })
  cpSync(join(appDir, 'build', 'bin'), join(APP, 'build', 'bin'), { recursive: true })
}

// ── API + data ────────────────────────────────────────────────
Q.stopApi() // a fresh process: fresh in-memory rate limits, current server code
await sleep(800)
await Q.startApi()
async function call(method, path, body, token) {
  const r = await fetch(API + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text}`)
  return text ? JSON.parse(text) : null
}
function mailedToken(email) {
  const files = existsSync(Q.OUTBOX) ? readdirSync(Q.OUTBOX).filter((f) => f.includes('verify')).sort().reverse() : []
  for (const f of files) {
    const eml = readFileSync(join(Q.OUTBOX, f), 'utf8')
    if (eml.includes(email)) return /[?&]token=([A-Za-z0-9_-]+)/.exec(eml)?.[1]
  }
  return null
}
const legal = await call('GET', '/legal')
const run = Date.now().toString(36).slice(-4)
async function person(username, displayName) {
  const email = `${username}.${run}@example.com`
  const res = await call('POST', '/auth/register', {
    email, username: `${username}_${run}`, displayName, password: 'correct horse battery staple', birthDate: '1999-03-14', termsVersion: legal.termsVersion,
  })
  for (let i = 0; i < 40 && !mailedToken(email); i++) await sleep(250)
  const token = mailedToken(email)
  if (token) await call('POST', '/auth/verify-email', { token })
  return { ...res.user, token: res.token }
}
// Accounts are kept between runs (QA_WORK/users.json): signup is rate limited per IP.
const usersFile = join(Q.WORK, 'presence-users.json')
let cast0 = existsSync(usersFile) ? JSON.parse(readFileSync(usersFile, 'utf8')) : null
if (cast0 && !(await call('GET', '/users/@me', undefined, cast0.alan.token).then(() => true, () => false))) cast0 = null
if (!cast0) {
  const alan = await person('alan', 'Alan')
  const friends = [await person('bia', 'Bia Moraes'), await person('caio', 'Caio'), await person('duda', 'Duda Reis')]
  for (const f of friends) {
    await call('POST', '/relationships', { username: f.username }, alan.token)
    await call('PUT', `/relationships/${alan.id}`, { type: 'friend' }, f.token)
  }
  const space = await call('POST', '/spaces', { name: 'Resenha' }, alan.token)
  const invite = await call('POST', `/spaces/${space.id}/invites`, {}, alan.token)
  for (const f of friends) await call('POST', `/invites/${invite.code}`, undefined, f.token)
  cast0 = { alan, friends }
  writeFileSync(usersFile, JSON.stringify(cast0))
}
const { alan, friends } = cast0

// ── real icons, through the detector helper ──────────────────
function extractIcons(paths) {
  const exe = join(appDir, 'build', 'bin', 'alga-activity.exe')
  const r = spawnSync(exe, [], { input: paths.map((p) => `icon\t${p}\n`).join(''), encoding: 'utf8', timeout: 15_000, windowsHide: true })
  const out = {}
  for (const line of (r.stdout ?? '').split('\n')) {
    try {
      const j = JSON.parse(line)
      if (j.t === 'icon' && j.png) out[j.path] = `data:image/png;base64,${j.png}`
    } catch {}
  }
  return out
}
const CODE = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe')
const BLENDER = 'C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe'
const AE = String.raw`C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\AfterFX.exe`
const icons = extractIcons([CODE, BLENDER, AE])
check(Object.keys(icons).length >= 1, `helper extracted ${Object.keys(icons).length} real icons`)

const min = 60_000
const cast = [
  { kind: 'game', name: 'Counter-Strike 2', startedAt: Date.now() - (84 * min + 12_000), steamAppId: 730 },
  { kind: 'creative', name: 'Blender', startedAt: Date.now() - 47 * min, ...(icons[BLENDER] && { icon: icons[BLENDER] }) },
  { kind: 'code', name: 'Visual Studio Code', startedAt: Date.now() - (133 * min + 41_000), ...(icons[CODE] && { icon: icons[CODE] }) },
]
const sockets = friends.map((f, i) => {
  const ws = new WebSocket(Q.API.replace('http', 'ws') + '/gateway')
  const events = []
  ws.onmessage = (m) => {
    const j = JSON.parse(m.data)
    if (j.op === 'dispatch') events.push(j)
    if (j.t === 'READY') {
      ws.send(JSON.stringify({ op: 'activity', activity: cast[i] }))
      if (i === 2) ws.send(JSON.stringify({ op: 'custom_status', status: { text: 'Virando a noite no código', emoji: '☕' } }))
      // Caio moves from Blender (47 min: becomes "Atividade recente") to After Effects.
      if (i === 1) setTimeout(() => ws.send(JSON.stringify({ op: 'activity', activity: { kind: 'creative', name: 'Adobe After Effects', startedAt: Date.now() - 6 * min, ...(icons[AE] && { icon: icons[AE] }) } })), 1200)
      setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ op: 'heartbeat' })), j.d.heartbeatIntervalMs * 0.8).unref()
    }
  }
  ws.onopen = () => ws.send(JSON.stringify({ op: 'identify', token: f.token }))
  return { ws, events }
})
await sleep(1500)

// ── the app ───────────────────────────────────────────────────
// A clean slate for the detector's per-app choices (this test profile only).
rmSync(join(process.env.APPDATA ?? '', 'Alga Meet Dev', 'profiles', 'presence-a', 'settings.json'), { force: true })
const app = await electron.launch({
  args: [APP, '--profile=presence-a'],
  env: { ...process.env, ALGA_API_URL: Q.API, ALGA_E2E: '1' },
})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
await page.evaluate((t) => (localStorage.clear(), window.alga.auth.setToken(t)), alan.token)
await page.reload()
await page.waitForSelector('[aria-label="Membros"], nav, main', { timeout: 20_000 })
await sleep(2500)

let n = 0
async function shot(name) {
  await sleep(500)
  const p = join(outDir, `${today}-activity-${name}-v${++n}.png`)
  await page.screenshot({ path: p })
  console.log('shot', p)
}
const closePopups = () => page.keyboard.press('Escape').then(() => sleep(300))

// 1. Friends → "Ativo agora"
await page.getByRole('button', { name: /amigos/i }).first().click().catch(() => undefined)
await sleep(1200)
check(await page.getByRole('complementary', { name: 'Ativo agora' }).isVisible(), '"Ativo agora" column visible')
check(await page.getByText('Counter-Strike 2').first().isVisible(), 'friend activity shown in Friends')
await shot('friends')

// 2. The space: member list lines + a profile popover
await page.getByRole('button', { name: /Resenha/ }).first().click().catch(() => undefined)
await sleep(1500)
const members = page.getByRole('complementary', { name: 'Membros' })
check(await members.getByText('Counter-Strike 2').isVisible().catch(() => false), 'member list line shows the activity')
await shot('members')
await members.getByRole('button', { name: /Duda Reis/ }).click()
await sleep(1400)
check(await page.getByRole('region', { name: 'Programando no Visual Studio Code' }).isVisible().catch(() => false), 'profile popover has the activity card')
await shot('profile-code')
await closePopups()
await members.getByRole('button', { name: /Bia Moraes/ }).click()
await sleep(2200)
await shot('profile-steam')
await closePopups()

// 3. Real detection: focus the Calculator for real, find it in Settings, switch it on, a friend must receive it.
const t0 = new Date().toISOString()
spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Process calc'], { windowsHide: true })
await sleep(4000)
await page.getByRole('button', { name: 'Configurações' }).first().click()
await sleep(800)
await page.getByRole('navigation').getByRole('button', { name: 'Atividade' }).click()
await sleep(4000)
const appSwitch = page.getByRole('switch', { name: /^Mostrar .*Calcula/i })
check(await appSwitch.isVisible().catch(() => false), 'Calculator (UWP) listed in Settings → Atividade (real detector)')
check((await appSwitch.getAttribute('aria-checked').catch(() => null)) === 'false', 'unrecognized app starts hidden')
await shot('settings-before')
// Turn every listed app on: whatever really holds the foreground (Windows will not let a background script steal
// focus back for the Calculator) must become the activity after its 8 s dwell and reach a friend.
for (const sw of await page.getByRole('switch', { name: /^Mostrar / }).all()) {
  if ((await sw.getAttribute('aria-checked')) === 'false') await sw.click()
}
const bia = sockets[0]
let got = null
for (let i = 0; i < 50 && !got; i++) {
  await sleep(500)
  got = bia.events.find((e) => e.t === 'PRESENCE_UPDATE' && e.d.userId === alan.id && e.d.activity)
  if (i % 6 === 5) console.log('  detector now:', JSON.stringify(await page.evaluate(() => window.alga.activity.current()))?.slice(0, 100))
}
check(got, `friend received own activity over the gateway (${got?.d.activity?.name ?? 'nothing'}, icon ${got?.d.activity?.icon ? 'yes' : 'no'})`)
await sleep(800)
await shot('settings-after')
await closePopups()

// 4. Own popover (user panel): the card with its controls (pause, hide this app, privacy).
await page.locator('[class*="userRow"] button[aria-haspopup="dialog"]').first().click()
await sleep(1400)
check(await page.getByRole('button', { name: 'Pausar 1 h' }).isVisible().catch(() => false), 'own popover offers pause / hide')
check(await page.locator('[class*="userRow"]').getByText(/^Usando|^Jogando|^Programando|^Criando/).isVisible().catch(() => false), 'user panel line shows own activity')
await shot('own')

// 5. Custom status: the empty bubble invites, a preset fills it, a friend receives it, it shows everywhere.
await page.getByRole('button', { name: 'Definir status' }).first().click()
await sleep(700)
await page.getByRole('button', { name: /Bora jogar\?/ }).click()
await sleep(300)
await shot('status-editor')
await page.getByRole('button', { name: 'Salvar' }).click()
let custom = null
for (let i = 0; i < 20 && !custom; i++) {
  await sleep(250)
  custom = sockets[0].events.find((e) => e.t === 'PRESENCE_UPDATE' && e.d.userId === alan.id && e.d.custom?.text === 'Bora jogar?')
}
check(custom?.d.custom?.expiresAt > Date.now(), 'friend received own custom status with its expiry')
check(await page.locator('[class*="userRow"]').getByText('Bora jogar?').isVisible().catch(() => false), 'user panel line shows the custom status')
await page.locator('[class*="userRow"] button[aria-haspopup="dialog"]').first().click()
await sleep(1200)
await shot('own-status')
await closePopups()
await members.getByRole('button', { name: /Duda Reis/ }).click()
await sleep(1400)
check(await page.locator('[class*="bubble"]').getByText('Virando a noite no código').isVisible().catch(() => false), "a friend's bubble shows in their profile")
await shot('profile-status')
await closePopups()

// 6. Full profile: from the popover's banner; current + recent activity, tabs.
await members.getByRole('button', { name: /Caio/ }).click()
await sleep(1000)
await page.getByRole('button', { name: 'Ver perfil completo' }).first().click()
await sleep(1600)
const dlg = page.getByRole('dialog', { name: /Perfil de Caio/ })
check(await dlg.isVisible().catch(() => false), 'full profile opens from the popover banner')
check(await dlg.getByText('Atividade recente').isVisible().catch(() => false), 'recent activity listed (server memory)')
check(await dlg.getByText('No Alga desde').isVisible().catch(() => false), 'member since shown')
await shot('full-profile')
await dlg.getByRole('tab', { name: /Espaços em comum/ }).click().catch(() => undefined)
await sleep(600)
await shot('full-profile-spaces')
await page.keyboard.press('Escape')
await sleep(400)
// Only the Calculator this run opened.
spawnSync('powershell', ['-NoProfile', '-Command', `Get-Process CalculatorApp -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -gt [datetime]'${t0}' } | Stop-Process`], { windowsHide: true })

for (const s of sockets) s.ws.close()
await app.close()
if (!args.includes('--keep')) Q.stopApi()
const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length ? 1 : 0)
