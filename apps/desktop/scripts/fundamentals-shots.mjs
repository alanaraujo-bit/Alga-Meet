// Fundamentals (backlog BL-02, BL-04, BL-05, BL-07) end to end + screenshots, isolated from the dev stack.
//   node scripts/fundamentals-shots.mjs [--skip-build] [--keep]
// - Same isolated stack as activity-shots.mjs: own API (qa-stack.mjs) on :4360, QA_WORK = %TEMP%/alga-presence-qa.
//   No LiveKit process: who is in a voice room is simulated with LiveKit webhooks signed with the QA keys.
// - Two app profiles, both off-screen (Playwright automation mode): an existing account, and a brand-new person
//   arriving through algameet://invite/<code>.
// - The "no connection" case stops the QA API for a few seconds and starts it again (the dev stack is untouched).
// Output: docs/screenshots/<date>-fundamentals-*.png
import { createHash } from 'node:crypto'
import { execSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AccessToken } from 'livekit-server-sdk'
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
  writeFileSync(join(APP, 'package.json'), JSON.stringify({ name: '@alga/desktop', productName: 'Alga Meet', version: '0.1.5', main: './main/index.js' }, null, 2))
  cpSync(join(appDir, 'build', 'runtime'), join(APP, 'build', 'runtime'), { recursive: true })
  cpSync(join(appDir, 'build', 'bin'), join(APP, 'build', 'bin'), { recursive: true })
}

// ── API + data ────────────────────────────────────────────────
Q.stopApi()
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
// The same cast as activity-shots.mjs (kept between runs: signup is rate limited per IP).
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
  cast0 = { alan, friends }
  writeFileSync(usersFile, JSON.stringify(cast0))
}
const { alan, friends } = cast0
const [bia, caio] = friends

// A fresh space for this run, with the friends inside.
const SPACE = 'Galera do Fim de Semana'
const space = await call('POST', '/spaces', { name: SPACE }, alan.token)
const text = space.channels.find((c) => c.type === 'text')
const voice = space.channels.find((c) => c.type === 'voice')
const inv = await call('POST', `/spaces/${space.id}/invites`, {}, alan.token)
for (const f of friends) await call('POST', `/invites/${inv.code}`, undefined, f.token)

// Friends online with activities (the lobby shows what each one is doing).
const min = 60_000
const activities = [
  { kind: 'game', name: 'Counter-Strike 2', startedAt: Date.now() - 52 * min, steamAppId: 730 },
  { kind: 'creative', name: 'Blender', startedAt: Date.now() - 18 * min },
  { kind: 'code', name: 'Visual Studio Code', startedAt: Date.now() - 95 * min },
]
const sockets = friends.map((f, i) => {
  const ws = new WebSocket(Q.API.replace('http', 'ws') + '/gateway')
  ws.onmessage = (m) => {
    const j = JSON.parse(m.data)
    if (j.t === 'READY') {
      ws.send(JSON.stringify({ op: 'activity', activity: activities[i] }))
      setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ op: 'heartbeat' })), j.d.heartbeatIntervalMs * 0.8).unref()
    }
  }
  ws.onopen = () => ws.send(JSON.stringify({ op: 'identify', token: f.token }))
  return ws
})
await sleep(1500)

// Bia and Caio are in the voice room (what LiveKit would tell the server).
async function lkWebhook(payload) {
  const body = JSON.stringify(payload)
  const at = new AccessToken('devkey', 'alga-dev-secret-change-me-0123456789abcdef')
  at.sha256 = createHash('sha256').update(body).digest('base64')
  const r = await fetch(`${API}/livekit/webhook`, { method: 'POST', headers: { 'content-type': 'application/webhook+json', authorization: await at.toJwt() }, body })
  if (!r.ok) throw new Error(`webhook ${r.status} ${await r.text()}`)
}
let seq = 0
for (const f of [bia, caio]) {
  await lkWebhook({ event: 'participant_joined', id: `FUND_${run}_${++seq}`, createdAt: String(Math.floor(Date.now() / 1000)), room: { name: `ch_${voice.id}` }, participant: { identity: f.id } })
}

// ── app A: the existing account ───────────────────────────────
const appA = await electron.launch({ args: [APP, '--profile=fund-a'], env: { ...process.env, ALGA_API_URL: Q.API, ALGA_E2E: '1' } })
const page = await appA.firstWindow()
await page.waitForLoadState('domcontentloaded')
await appA.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
await page.evaluate((t) => (localStorage.clear(), window.alga.auth.setToken(t)), alan.token)
await page.reload()
await page.waitForSelector('nav', { timeout: 20_000 })
await sleep(2500)
const joins = []
page.on('request', (r) => r.url().includes('/voice/join') && joins.push(r.url()))

let n = 0
async function shot(p, name) {
  await sleep(500)
  const file = join(outDir, `${today}-fundamentals-${name}-v${++n}.png`)
  await p.screenshot({ path: file })
  console.log('shot', file)
}
const rail = page.getByRole('navigation', { name: 'Espaços' })
const spaceBtn = rail.getByRole('button', { name: new RegExp(SPACE) }).last() // the one created by this run

// 1. Look into the room before entering (BL-05).
await spaceBtn.click()
await sleep(1200)
// Its name says "Entrar em …" once the lobby is open (the next click enters).
const room = page.locator('aside').getByRole('button', { name: new RegExp(voice.name) }).first()
await room.click()
await sleep(1500)
check(await page.getByRole('toolbar', { name: 'Antes de entrar' }).isVisible(), 'first click opens the room lobby (dock "Antes de entrar")')
check(joins.length === 0, 'first click does not join the voice room')
check(await page.getByRole('list', { name: /2 pessoas conversando agora/ }).isVisible().catch(() => false), 'lobby lists the two people inside')
check(await page.locator('section').getByText('Counter-Strike 2').first().isVisible().catch(() => false), "lobby shows what they're doing")
check(await page.getByText('Ninguém te vê aqui ainda').isVisible().catch(() => false), 'lobby says nobody sees you yet')
await shot(page, 'lobby')
await room.click()
for (let i = 0; i < 20 && joins.length === 0; i++) await sleep(150)
check(joins.length === 1, 'second click on the same room enters it (POST /voice/join)')
await sleep(1500)
await page.keyboard.press('Escape')

// 2. Calm notifications (BL-07): levels in the space menu, silence, channel mute.
await page.getByRole('button', { name: /^Conversas/ }).first().click().catch(() => undefined)
await sleep(800)
await spaceBtn.click({ button: 'right' })
await sleep(600)
check(await page.getByRole('menu').getByText('Notificações').isVisible(), 'space menu has the "Notificações" group')
check(await page.getByRole('menu').getByText('padrão deste espaço').isVisible().catch(() => false), 'the adaptive default is named (small space: every message)')
await shot(page, 'space-menu')
await page.getByRole('menu').getByText('Silenciado', { exact: true }).click()
await sleep(500)
await call('POST', `/channels/${text.id}/messages`, { content: 'alguém pra um CS hoje?', nonce: `n-${run}-1` }, bia.token)
await sleep(1500)
const silencedLabel = await spaceBtn.getAttribute('aria-label')
check(!/mensagens novas/.test(silencedLabel ?? ''), `silenced space shows no unread (${silencedLabel})`)
await spaceBtn.click({ button: 'right' })
await sleep(500)
await page.getByRole('menu').getByText('Todas as mensagens').click()
await sleep(800)
const loudLabel = await spaceBtn.getAttribute('aria-label')
check(/mensagens novas/.test(loudLabel ?? ''), `back to "Todas as mensagens": unread shows again (${loudLabel})`)
await spaceBtn.click()
await sleep(1000)
// While silenced its name reads "geral Silenciado" (the mark is announced).
const chanRow = page.locator('aside').getByRole('button', { name: new RegExp(`^${text.name}(\\s|$)`) })
await chanRow.click({ button: 'right' })
await sleep(500)
await page.getByRole('menu').getByText('Silenciar canal').click()
await sleep(600)
check(await page.locator('aside').getByRole('img', { name: 'Silenciado' }).first().isVisible().catch(() => false), 'a silenced channel shows the bell-slash mark')
await shot(page, 'muted-channel')
await chanRow.click({ button: 'right' })
await sleep(400)
await page.getByRole('menu').getByText('Reativar canal').click()
await sleep(400)

// 3. A message sent without connection goes out by itself, once (BL-02).
await chanRow.click()
await sleep(1200)
Q.stopApi()
await sleep(2500)
const composer = page.locator('[data-composer]')
await composer.click()
const offline = `Mandei sem internet ${run}`
await composer.fill(offline)
await page.keyboard.press('Enter')
await sleep(2000)
check(await page.getByText('Sem conexão. Ela sai sozinha').isVisible().catch(() => false), 'a send without connection waits calmly (not a red error)')
await shot(page, 'queued')
await Q.startApi()
let gone = false
for (let i = 0; i < 60 && !gone; i++) {
  await sleep(1000)
  gone = !(await page.getByText('Sem conexão. Ela sai sozinha').isVisible().catch(() => false))
}
check(gone, 'the waiting message went out by itself when the connection came back')
const history = await call('GET', `/channels/${text.id}/messages`, undefined, alan.token)
check(history.filter((m) => m.content === offline).length === 1, 'and it exists exactly once on the server')
await shot(page, 'sent-after-reconnect')

// 4. A new person arrives through a friend's invite (BL-04).
const invite2 = await call('POST', `/spaces/${space.id}/invites`, {}, alan.token)
rmSync(join(process.env.APPDATA ?? '', 'Alga Meet Dev', 'profiles', 'fund-new'), { recursive: true, force: true })
const appB = await electron.launch({ args: [APP, '--profile=fund-new', `algameet://invite/${invite2.code}`], env: { ...process.env, ALGA_API_URL: Q.API, ALGA_E2E: '1' } })
const pb = await appB.firstWindow()
await pb.waitForLoadState('domcontentloaded')
await appB.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 860))
await sleep(3000)
check(await pb.getByText('Alan te chamou para').isVisible().catch(() => false), 'sign-in screen shows who invited ("Alan te chamou para")')
check(await pb.getByText(SPACE).first().isVisible().catch(() => false), 'and the space name')
check(await pb.getByRole('heading', { name: 'Criar sua conta' }).isVisible().catch(() => false), 'it starts on "Criar conta"')
await shot(pb, 'invite-welcome')
await pb.getByLabel('E-mail').fill(`nova.${run}@example.com`)
await pb.getByLabel('Nome de exibição').fill('Nina')
await pb.getByLabel('Nome de usuário').fill(`nina_${run}`)
await pb.getByLabel('Data de nascimento').fill('14031999')
await pb.getByLabel('Senha', { exact: true }).fill('correct horse battery staple')
await pb.locator('input[type="checkbox"]').first().check()
await pb.getByRole('button', { name: 'Criar conta' }).click()
let landed = false
for (let i = 0; i < 40 && !landed; i++) {
  await sleep(500)
  landed = await pb.locator('aside').getByRole('button', { name: new RegExp(SPACE) }).first().isVisible().catch(() => false)
}
check(landed, 'after creating the account the person lands inside the space, no extra click')
await sleep(1500)
await shot(pb, 'invite-landed')

for (const ws of sockets) ws.close()
await appB.close()
await appA.close()
if (!args.includes('--keep')) Q.stopApi()
const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length ? 1 : 0)
