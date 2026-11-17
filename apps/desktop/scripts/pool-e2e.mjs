// Pool in Alga Worlds end to end on two REAL app instances against an isolated QA stack this script starts and stops:
// taking a cue at the lounge's table, practice becoming a match when the second player joins, a break played with the
// mouse and a shot with the keyboard, both apps ending every shot with the balls in the same places, the turn and the
// score agreeing, leaving the table, and the voice call staying up through all of it.
//   QA_WORK=<dir> QA_API_PORT=4396 QA_LK_PORT=7996 node scripts/pool-e2e.mjs [--skip-build] [--keep]
// A packaged build instead of a fresh one (what a release ships): QA_EXE="<...>/release/win-unpacked/Alga Meet.exe",
// with QA_OUT=<dir> so its screenshots do not replace the ones in docs.
// Screenshots: docs/screenshots/pool/. Never touches the dev stack (:4000/:7880).
// To play by hand instead: `--play` stops after both accounts are inside the lounge and leaves the two apps open side
// by side, microphones off, one player each, until both windows are closed (then the stack is stopped).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import * as Q from './qa-stack.mjs'

const KEEP = process.argv.includes('--keep')
const PLAY = process.argv.includes('--play')
const APP = join(Q.appDir, 'node_modules', '.alga-qa-pool')
const EXE = process.env.QA_EXE
// A session played by hand leaves the pictures of the docs alone.
const OUT = process.env.QA_OUT ?? (PLAY ? join(Q.WORK, 'play') : join(Q.repo, 'docs', 'screenshots', 'pool'))
mkdirSync(OUT, { recursive: true })
mkdirSync(Q.WORK, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const electronPath = createRequire(join(Q.appDir, 'package.json'))('electron')
const apps = {}
const results = []

if (!EXE && !process.argv.includes('--skip-build')) {
  execSync(`npx electron-vite build --outDir "${APP}"`, { cwd: Q.appDir, stdio: 'inherit' })
  writeFileSync(join(APP, 'package.json'), JSON.stringify({ name: '@alga/desktop', productName: 'Alga Meet', version: '0.1.0', main: './main/index.js' }, null, 2))
  cpSync(join(Q.appDir, 'build', 'runtime'), join(APP, 'build', 'runtime'), { recursive: true })
}

async function rest(token, method, path, body) {
  const res = await fetch(`${Q.API}/api/v1${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`)
  return data
}
async function mailedToken(email, kind) {
  for (let i = 0; i < 80; i++) {
    const files = existsSync(Q.OUTBOX) ? readdirSync(Q.OUTBOX).filter((f) => f.includes(kind)).sort().reverse() : []
    for (const f of files) {
      const eml = readFileSync(join(Q.OUTBOX, f), 'utf8')
      if (!eml.includes(email)) continue
      const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(eml)?.[1]
      if (token) return token
    }
    await sleep(250)
  }
  throw new Error(`no ${kind} e-mail for ${email}`)
}
async function account(tag, displayName) {
  const legal = await rest(null, 'GET', '/legal')
  const run = Math.random().toString(36).slice(2, 6)
  const username = `sin${tag}${run}`
  const email = `${username}@qa.alga.test`
  const password = `sinuca ${run} mesa ${tag}`
  const r = await rest(null, 'POST', '/auth/register', { email, username, displayName, password, birthDate: '1995-05-05', termsVersion: legal.termsVersion })
  await rest(null, 'POST', '/auth/verify-email', { token: await mailedToken(email, 'verify') })
  return { username, password, token: r.token, id: r.user.id }
}

async function launch(k, x) {
  rmSync(join(process.env.APPDATA ?? '', EXE ? 'Alga Meet' : 'Alga Meet Dev', 'profiles', `qa-pool-${k}`), { recursive: true, force: true })
  const env = { ...process.env, ALGA_API_URL: Q.API, ALGA_E2E: '1' }
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({
    executablePath: EXE ?? electronPath, cwd: Q.appDir, env,
    args: [...(EXE ? [] : [APP]), `--profile=qa-pool-${k}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
      '--force-device-scale-factor=1'],
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.log(`[${k}] pageerror`, e.message))
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_NAME_NOT_RESOLVED|net::ERR_FAILED/.test(m.text()) && console.log(`[${k}] console.error`, m.text().slice(0, 240)))
  await app.evaluate(({ BrowserWindow }, o) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(1440, 900)
    win.setPosition(o.x, 0)
  }, { x })
  await page.waitForLoadState('domcontentloaded')
  apps[k] = { app, page }
  return page
}
async function login(page, u) {
  const nav = page.getByRole('navigation', { name: 'Espaços' })
  await page.getByLabel('E-mail ou nome de usuário').or(nav).first().waitFor({ timeout: 30_000 })
  if (!(await nav.isVisible())) {
    await page.getByLabel('E-mail ou nome de usuário').fill(u.username)
    await page.getByLabel('Senha', { exact: true }).fill(u.password)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  }
  await nav.waitFor({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Pular por agora' }).click({ timeout: 3000 }).catch(() => undefined)
  await sleep(500)
}
const until = async (fn, what, timeout = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const v = await fn().catch(() => null)
    if (v) return v
    await sleep(200)
  }
  throw new Error(`timeout: ${what}`)
}
const shot = (k, name) => apps[k].page.screenshot({ path: join(OUT, `${name}.png`) })
async function check(name, fn) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    results.push({ name, pass: true, ms: Date.now() - t0, detail: detail ?? null })
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (e) {
    results.push({ name, pass: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 500) })
    console.log(`FAIL ${name} — ${e?.message ?? e}`)
    for (const [k, a] of Object.entries(apps)) await a.page.screenshot({ path: join(OUT, `fail-${results.length}-${k}.png`) }).catch(() => undefined)
  }
}

const dock = (page) => page.getByRole('toolbar', { name: 'Controles da chamada' })
const hud = (page) => page.getByRole('toolbar', { name: 'Controles do mundo' })
const card = (page) => page.getByRole('article', { name: 'Mundo aberto' })
const connected = (page) => page.getByText('Voz conectada').first()
const canvas = (page) => page.locator('canvas[data-frames]')
const board = (page) => page.getByRole('status', { name: 'Placar da sinuca' })
/** What the engine wrote about the lounge's table: `sin:<shots>:<fingerprint of the balls>` or `sin:rolling`. */
const digest = (page) => page.evaluate(() => document.querySelector('canvas[data-frames]')?.dataset.pool ?? '')
const boardText = async (page) => (await board(page).innerText()).replace(/\s+/g, ' ').trim()
/** Balls each scoreboard shows as still on the table. */
const ballsLeft = (page) => page.evaluate(() => {
  const el = document.querySelector('[aria-label="Placar da sinuca"]')
  return el ? [...el.querySelectorAll('i')].filter((i) => i.textContent && !/Gone/.test(i.className)).map((i) => i.textContent).join(',') : null
})
function voiceJoinedAt(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${Q.API.replace(/^http/, 'ws')}/gateway`)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('gateway: no READY'))
    }, 8000)
    ws.onopen = () => ws.send(JSON.stringify({ op: 'identify', token }))
    ws.onerror = () => {
      clearTimeout(timer)
      reject(new Error('gateway: socket error'))
    }
    ws.onmessage = (m) => {
      const f = JSON.parse(String(m.data))
      if (f.t !== 'READY') return
      clearTimeout(timer)
      ws.close()
      resolve(Object.fromEntries(f.d.voiceStates.map((v) => [v.userId, v.joinedAt])))
    }
  })
}
/** Where the figure is and which way the camera looks, as the engine writes it on its canvas: [x, z, yaw]. */
const whereAmI = async (page) => (await page.evaluate(() => document.querySelector('canvas[data-frames]')?.dataset.at ?? '')).split(',').map(Number)
/** Walks with W A S D to a spot of the floor (the keys move along the camera, so each step is steered from where it is). */
async function walkTo(page, tx, tz, who) {
  for (let i = 0; i < 40; i++) {
    const [x, z, yaw] = await whereAmI(page)
    if (!Number.isFinite(x)) {
      await sleep(300)
      continue
    }
    const dx = tx - x, dz = tz - z
    if (Math.hypot(dx, dz) < 0.3) return
    // Forward and right of the camera on the floor, as the engine walks them.
    const ahead = dx * -Math.sin(yaw) + dz * -Math.cos(yaw), right = dx * Math.cos(yaw) + dz * -Math.sin(yaw)
    const [key, far] = Math.abs(ahead) >= Math.abs(right) ? [ahead > 0 ? 'KeyW' : 'KeyS', Math.abs(ahead)] : [right > 0 ? 'KeyD' : 'KeyA', Math.abs(right)]
    await page.keyboard.down(key)
    await sleep(Math.min(700, Math.max(90, (far / 1.5) * 1000 * 0.85)))
    await page.keyboard.up(key)
    await sleep(140)
  }
  throw new Error(`${who}: never got to (${tx}, ${tz}); at ${await whereAmI(page)}`)
}
/** Walks to a spot beside the table and takes a cue with E. */
async function takeCue(page, who, x, z) {
  await canvas(page).hover({ position: { x: 720, y: 240 } })
  await walkTo(page, x, z, who)
  await page.getByText('Jogar sinuca', { exact: true }).waitFor({ timeout: 5000 }).catch(() => { throw new Error(`${who}: no hint to take a cue beside the table`) })
  await page.keyboard.press('KeyE')
  await board(page).waitFor({ timeout: 8000 })
}
/** Both apps have finished playing a shot: the same number of shots and the same balls, bit for bit. */
async function sameTable(pa, pb, shots) {
  return until(async () => {
    const [a, b] = [await digest(pa), await digest(pb)]
    return a === b && a.startsWith(`sin:${shots}:`) ? a : null
  }, `both apps on shot ${shots} with the same balls`, 45_000)
}

// ── stack, accounts, call, world ───────────────────────────────────
await Q.startLivekit()
await Q.startApi()
const A = await account('a', 'Ana Souza')
const B = await account('b', 'Bia Lima')
const space = await rest(A.token, 'POST', '/spaces', { name: 'Os de Sempre' })
const invite = await rest(A.token, 'POST', `/spaces/${space.id}/invites`, {})
await rest(B.token, 'POST', `/invites/${invite.code}`)
const pa = await launch('a', 0)
const pb = await launch('b', 1460)
await login(pa, A)
await login(pb, B)
async function joinVoice(page) {
  await page.getByRole('navigation', { name: 'Espaços' }).getByRole('button', { name: /^Os de Sempre/ }).click()
  const room = page.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: /^(Entrar em |Trocar para )?Geral(, .*)?$/ }).first()
  await room.click()
  const pill = page.getByRole('toolbar', { name: 'Antes de entrar' }).getByRole('button', { name: /^Entrar/ })
  if (await pill.isVisible().catch(() => false)) await pill.click()
  else {
    await sleep(600)
    await room.click()
  }
  await connected(page).waitFor({ timeout: 30_000 })
}
await joinVoice(pa)
await joinVoice(pb)
const joinedBefore = await voiceJoinedAt(A.token)
if (!joinedBefore[A.id] || !joinedBefore[B.id]) throw new Error(`both must be in voice before the world: ${JSON.stringify(joinedBefore)}`)

await check('O lounge abre com a mesa de sinuca arrumada, igual nas duas telas', async () => {
  await dock(pa).getByRole('button', { name: 'Mundo' }).click()
  await pa.getByRole('menuitemcheckbox', { name: /Lounge/ }).click()
  await hud(pa).waitFor({ timeout: 90_000 })
  await card(pb).getByRole('button', { name: 'Entrar' }).click({ timeout: 15_000 })
  await hud(pb).waitFor({ timeout: 90_000 })
  const d = await until(async () => {
    const [a, b] = [await digest(pa), await digest(pb)]
    return a && a === b ? a : null
  }, 'both draw the table', 60_000)
  await sleep(2000)
  await shot('a', '01-lounge-table')
  return d
})

if (PLAY) {
  // Half the screen each, and no microphones: two apps on one computer would only hear each other.
  const area = await apps.a.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
  const half = Math.floor(area.width / 2)
  for (const [k, x] of [['a', area.x], ['b', area.x + half]]) {
    await apps[k].app.evaluate(({ BrowserWindow }, bounds) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.setBounds(bounds)
      win.show()
    }, { x, y: area.y, width: half, height: area.height })
    await dock(apps[k].page).getByRole('button', { name: 'Desativar microfone' }).click({ timeout: 4000 }).catch(() => undefined)
  }
  console.log(`\nPLAY: Ana Souza (esquerda) e Bia Lima (direita) estão no Lounge. Clique na mesa em cada janela para pegar um taco.`)
  console.log('Feche as duas janelas para encerrar.')
  await Promise.all(Object.values(apps).map(({ app }) => new Promise((resolve) => app.on('close', resolve))))
  Q.stopAll()
  process.exit(0)
}

await check('Perto da mesa aparece "Jogar sinuca"; E pega o taco e começa o treino livre', async () => {
  await takeCue(pa, 'Ana', 0.35, -1.3)
  await board(pa).getByText('Treino livre').waitFor({ timeout: 5000 })
  await sleep(3500)
  await shot('a', '02-practice-aim')
  return await boardText(pa)
})

await check('Bia pega o outro taco: vira partida, bolas arrumadas de novo, saída de Ana', async () => {
  await takeCue(pb, 'Bia', -1.1, -3.35)
  await board(pa).getByText('Bia Lima', { exact: true }).waitFor({ timeout: 8000 })
  await board(pb).getByText('Ana Souza', { exact: true }).waitFor({ timeout: 8000 })
  await until(async () => /Saída/.test(await boardText(pa)), 'Ana has the break')
  await until(async () => /Vez de Ana Souza/.test(await boardText(pb)), 'Bia sees it is Ana\'s turn')
  await sameTable(pa, pb, 0)
  await sleep(3000)
  await shot('a', '03-match-break')
  await shot('b', '04-opponent-sees-aim')
  return `${await boardText(pa)} | ${await boardText(pb)}`
})

await check('Ana dá a saída puxando o taco com o botão direito: as bolas rolam nas duas telas e param no mesmo lugar', async () => {
  const box = await canvas(pa).boundingBox()
  const x = box.x + box.width / 2, y = box.y + box.height * 0.35
  await pa.mouse.move(x, y)
  await pa.mouse.down({ button: 'right' })
  for (let i = 1; i <= 12; i++) {
    await pa.mouse.move(x, y + i * 22)
    await sleep(25)
  }
  await sleep(250)
  await shot('a', '05-cue-drawn-back')
  await pa.mouse.up({ button: 'right' })
  await until(async () => (await digest(pa)) === 'sin:rolling', 'Ana\'s balls roll', 5000)
  await until(async () => (await digest(pb)) === 'sin:rolling', 'Bia sees them roll', 5000)
  await sleep(900)
  await shot('b', '06-break-rolling')
  const d = await sameTable(pa, pb, 1)
  await sleep(1200)
  await shot('a', '07-after-break')
  const [ta, tb] = [await boardText(pa), await boardText(pb)]
  const [la, lb] = [await ballsLeft(pa), await ballsLeft(pb)]
  if (la !== lb) throw new Error(`the scoreboards disagree on the balls: ${la} / ${lb}`)
  return `${d} · ${ta} | ${tb}`
})

await check('Quem está na vez taca com Espaço; de novo as duas mesas terminam iguais e só um tem a vez', async () => {
  const turnA = /Sua vez|Bola na mão/.test(await boardText(pa))
  const [mine, other, who] = turnA ? [pa, pb, 'Ana'] : [pb, pa, 'Bia']
  await canvas(mine).click({ position: { x: 720, y: 320 } })
  await mine.keyboard.down('Space')
  await sleep(650)
  await mine.keyboard.up('Space')
  await until(async () => (await digest(other)) === 'sin:rolling', `${who}'s shot rolls on the other app`, 6000)
  const d = await sameTable(pa, pb, 2)
  await sleep(1000)
  const [ta, tb] = [await boardText(pa), await boardText(pb)]
  const turns = [ta, tb].filter((t) => /Sua vez|Bola na mão/.test(t)).length
  const over = /venceu/.test(ta)
  if (!over && turns !== 1) throw new Error(`exactly one of them should have the turn: ${ta} | ${tb}`)
  await shot(turnA ? 'b' : 'a', '08-watching-the-other')
  return `${who} tacou · ${d} · ${ta} | ${tb}`
})

await check('A vista de cima (V) mostra a mesa inteira', async () => {
  const page = /Sua vez|Bola na mão/.test(await boardText(pa)) ? pa : pb
  await canvas(page).click({ position: { x: 720, y: 320 } })
  await page.keyboard.press('KeyV')
  await sleep(1800)
  await shot(page === pa ? 'a' : 'b', '09-top-view')
  await page.keyboard.press('KeyV')
  await sleep(800)
})

await check('Esc larga o taco: quem ficou segue em treino livre na mesma mesa, e a voz dos dois nunca caiu', async () => {
  await canvas(pa).click({ position: { x: 720, y: 320 } })
  await pa.keyboard.press('Escape')
  await board(pa).waitFor({ state: 'detached', timeout: 8000 })
  await board(pb).getByText('Treino livre').waitFor({ timeout: 8000 })
  const end = await voiceJoinedAt(A.token)
  if (end[A.id] !== joinedBefore[A.id] || end[B.id] !== joinedBefore[B.id]) throw new Error(`the call rejoined: ${JSON.stringify(joinedBefore)} → ${JSON.stringify(end)}`)
  await connected(pa).waitFor({ timeout: 2000 })
  await connected(pb).waitFor({ timeout: 2000 })
  return await boardText(pb)
})

writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (!KEEP) {
  for (const { app } of Object.values(apps)) await app.close().catch(() => undefined)
  Q.stopAll()
}
process.exit(failed.length ? 1 : 0)
