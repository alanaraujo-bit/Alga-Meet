// Full profile screenshots against an isolated QA API (qa-stack.mjs), same cast as activity-shots.mjs.
//   node scripts/profile-shots.mjs [--skip-build] [--keep]
// Output: docs/screenshots/<date>-profile-*.png
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


const min = 60_000
// Caio: a bio and a color; Blender for 47 min (becomes "Atividade recente"), then After Effects now.
await call('PATCH', '/users/@me', { bio: 'Motion designer. Blender de dia, After Effects de noite. Café sempre.', accentColor: '#c86bfa' }, friends[1].token)
const sockets = friends.map((f, i) => {
  const ws = new WebSocket(Q.API.replace('http', 'ws') + '/gateway')
  ws.onmessage = (m) => {
    const j = JSON.parse(m.data)
    if (j.t === 'READY') {
      if (i === 1) {
        ws.send(JSON.stringify({ op: 'activity', activity: { kind: 'creative', name: 'Blender', startedAt: Date.now() - 47 * min } }))
        setTimeout(() => ws.send(JSON.stringify({ op: 'activity', activity: { kind: 'creative', name: 'Adobe After Effects', startedAt: Date.now() - 6 * min } })), 1200)
        ws.send(JSON.stringify({ op: 'custom_status', status: { text: 'Renderizando, não me chama', emoji: '🎬' } }))
      }
      setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ op: 'heartbeat' })), j.d.heartbeatIntervalMs * 0.8).unref()
    }
  }
  ws.onopen = () => ws.send(JSON.stringify({ op: 'identify', token: f.token }))
  return ws
})
await sleep(2500)

const app = await electron.launch({ args: [APP, '--profile=presence-a'], env: { ...process.env, ALGA_API_URL: Q.API, ALGA_E2E: '1' } })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
await page.evaluate((t) => (localStorage.clear(), window.alga.auth.setToken(t)), alan.token)
await page.reload()
await page.waitForSelector('nav, main', { timeout: 20_000 })
await sleep(2500)
let n = 0
async function shot(name) {
  await sleep(700)
  const p = join(outDir, `${today}-profile-${name}-v${++n}.png`)
  await page.screenshot({ path: p })
  console.log('shot', p)
}

// 1. Friends list → click Caio → full profile
await page.getByRole('button', { name: /amigos/i }).first().click().catch(() => undefined)
await sleep(1200)
await page.getByRole('button', { name: /Ver perfil de Caio/ }).first().click()
await sleep(1800)
const dlg = page.getByRole('dialog', { name: /Perfil de Caio/ })
check(await dlg.isVisible().catch(() => false), 'full profile opens from the friends list')
check(await dlg.getByText('No Alga desde').isVisible().catch(() => false), 'member since fact')
check(await dlg.getByText('Amigos desde').isVisible().catch(() => false), 'friends since fact')
await shot('full')
await dlg.getByRole('tab', { name: /Amigos em comum/ }).click().catch(() => undefined)
await shot('full-friends')
await page.keyboard.press('Escape')
await sleep(500)

// 2. Context menu on the friend row has "Ver perfil"
await page.getByRole('button', { name: /Ver perfil de Bia/ }).first().click({ button: 'right' })
await sleep(500)
check(await page.getByRole('menuitem', { name: 'Ver perfil' }).isVisible().catch(() => false), 'friend menu has Ver perfil')
await page.keyboard.press('Escape')
await sleep(300)

// 3. The space popover: "Ver perfil" hint visible without hover
await page.getByRole('button', { name: /Resenha/ }).first().click().catch(() => undefined)
await sleep(1500)
const members = page.getByRole('complementary', { name: 'Membros' })
await members.getByRole('button', { name: /Caio/ }).click().catch(() => undefined)
await sleep(1000)
await page.mouse.move(5, 5)
await shot('popover')

for (const ws of sockets) ws.close()
await app.close()
if (!args.includes('--keep')) Q.stopApi()
const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length ? 1 : 0)
