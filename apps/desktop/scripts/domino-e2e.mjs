// Dominoes in Alga Worlds end to end on two REAL app instances against an isolated QA stack this script starts and
// stops: sitting at the lounge's table, dealing, each app knowing only its own tiles, a whole round played with the
// keyboard with both apps agreeing after every play, the next round, a bot taking the chair of whoever gets up, the
// table freed when the last person leaves, and the voice call staying up through all of it.
//   QA_WORK=<dir> QA_API_PORT=4398 QA_LK_PORT=7990 node scripts/domino-e2e.mjs [--skip-build] [--keep]
// A packaged build instead of a fresh one (what a release ships): QA_EXE="<...>/release/win-unpacked/Alga Meet.exe",
// with QA_OUT=<dir> so its screenshots do not replace the ones in docs.
// Screenshots: docs/screenshots/domino/. Never touches the dev stack (:4000/:7880).
// To play by hand instead: `--play` stops after both accounts are inside the lounge and leaves the two apps open side
// by side, microphones off, until both windows are closed (then the stack is stopped).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import * as Q from './qa-stack.mjs'

const KEEP = process.argv.includes('--keep')
const PLAY = process.argv.includes('--play')
const APP = join(Q.appDir, 'node_modules', '.alga-qa-domino')
const EXE = process.env.QA_EXE
// A session played by hand leaves the pictures of the docs alone.
const OUT = process.env.QA_OUT ?? (PLAY ? join(Q.WORK, 'play') : join(Q.repo, 'docs', 'screenshots', 'domino'))
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
  const username = `dom${tag}${run}`
  const email = `${username}@qa.alga.test`
  const password = `domino ${run} mesa ${tag}`
  const r = await rest(null, 'POST', '/auth/register', { email, username, displayName, password, birthDate: '1995-05-05', termsVersion: legal.termsVersion })
  await rest(null, 'POST', '/auth/verify-email', { token: await mailedToken(email, 'verify') })
  return { username, password, token: r.token, id: r.user.id }
}

async function launch(k, x) {
  rmSync(join(process.env.APPDATA ?? '', EXE ? 'Alga Meet' : 'Alga Meet Dev', 'profiles', `qa-domino-${k}`), { recursive: true, force: true })
  const env = { ...process.env, ALGA_API_URL: Q.API, ALGA_E2E: '1' }
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({
    executablePath: EXE ?? electronPath, cwd: Q.appDir, env,
    args: [...(EXE ? [] : [APP]), `--profile=qa-domino-${k}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
      '--force-device-scale-factor=1', ...(EXE ? ['--mute-audio'] : [])],
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
const board = (page) => page.getByRole('status', { name: 'Placar do dominó' })
const boardText = async (page) => (await board(page).innerText()).replace(/\s+/g, ' ').trim()
/**
 * What the engine wrote about the lounge's domino table: null while nobody sits at it, else what is shown (`seq`,
 * `phase`, tiles on the line, whether tiles are moving, tiles with numbers in the scene) and, for whoever sits there,
 * their chair, whose turn it is and how many of their tiles fit.
 */
async function digest(page) {
  const raw = await page.evaluate(() => document.querySelector('canvas[data-frames]')?.dataset.domino ?? '')
  const [table, mine] = raw.split('|')
  const t = (table ?? '').split(':')
  if (t[0] !== 'dom' || t[1] === '-' || t.length < 6) return null
  const m = mine ? mine.split(':').map(Number) : null
  return { seq: Number(t[1]), phase: t[2], line: Number(t[3]), still: t[4] === 'still', known: Number(t[5]), seat: m ? m[0] : -1, turn: m ? m[1] : -1, fits: m ? m[2] : 0, choosing: !!m?.[3] }
}
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
/** Walks to a spot beside the table and sits on the chair the room offers there (E). */
async function sitAt(page, who, x, z) {
  await canvas(page).hover({ position: { x: 720, y: 240 } })
  await walkTo(page, x, z, who)
  await page.getByText('Sentar', { exact: true }).waitFor({ timeout: 5000 }).catch(() => { throw new Error(`${who}: no chair offered beside the table`) })
  await page.keyboard.press('KeyE')
  await board(page).waitFor({ timeout: 8000 })
}
/** Both apps show the same step of the game with nothing moving. */
async function settled(pa, pb, what, timeout = 30_000) {
  return until(async () => {
    const [a, b] = [await digest(pa), await digest(pb)]
    return a && b && a.seq === b.seq && a.phase === b.phase && a.line === b.line && a.still && b.still ? [a, b] : null
  }, what, timeout)
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

await check('O lounge abre com a mesa de dominó posta, sem ninguém sentado', async () => {
  await dock(pa).getByRole('button', { name: 'Mundo' }).click()
  await pa.getByRole('menuitemcheckbox', { name: /Lounge/ }).click()
  await hud(pa).waitFor({ timeout: 90_000 })
  await card(pb).getByRole('button', { name: 'Entrar' }).click({ timeout: 15_000 })
  await hud(pb).waitFor({ timeout: 90_000 })
  await until(async () => (await pa.evaluate(() => document.querySelector('canvas[data-frames]')?.dataset.domino ?? '')) === 'dom:-', 'Ana draws the table', 60_000)
  await until(async () => (await pb.evaluate(() => document.querySelector('canvas[data-frames]')?.dataset.domino ?? '')) === 'dom:-', 'Bia draws the table', 60_000)
  await sleep(2000)
  await shot('a', '01-lounge')
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
  console.log('\nPLAY: Ana Souza (esquerda) e Bia Lima (direita) estão no Lounge. Em cada janela, clique numa cadeira da mesa de dominó para sentar.')
  console.log('Feche as duas janelas para encerrar.')
  await Promise.all(Object.values(apps).map(({ app }) => new Promise((resolve) => app.on('close', resolve))))
  Q.stopAll()
  process.exit(0)
}

await check('Ana senta numa cadeira: a câmera vai para a mesa e o dominó espera mais alguém', async () => {
  await sitAt(pa, 'Ana', 0.9, -2.7)
  await board(pa).getByText('Esperando mais alguém').waitFor({ timeout: 8000 })
  if (!(await pa.getByRole('button', { name: 'Começar' }).isDisabled())) throw new Error('one person alone could deal')
  await until(async () => (await digest(pb))?.phase === 'lobby', 'Bia is told someone sits at the table')
  await sleep(1800)
  await shot('a', '02-seated-waiting')
  return await boardText(pa)
})

await check('Bia senta e Ana distribui: 7 pedras para cada, e cada app só conhece as próprias', async () => {
  await sitAt(pb, 'Bia', 2.1, -3.9)
  await board(pa).getByText('Bia Lima', { exact: true }).waitFor({ timeout: 8000 })
  await board(pb).getByText('Ana Souza', { exact: true }).waitFor({ timeout: 8000 })
  await pa.getByRole('button', { name: 'Começar' }).click()
  await until(async () => (await digest(pa))?.phase === 'play' && (await digest(pb))?.phase === 'play', 'both are dealt')
  const [a, b] = await settled(pa, pb, 'the deal ends on both apps')
  // In each scene the only tiles with numbers are that person's own seven: the other fourteen and the stock are blank.
  if (a.known !== 7 || b.known !== 7) throw new Error(`each app should know exactly its own 7 tiles: ${a.known} / ${b.known}`)
  if (a.seat === b.seat) throw new Error('both think they sit on the same chair')
  await shot('a', '03-dealt-ana')
  await shot('b', '04-dealt-bia')
  return `Ana cadeira ${a.seat}, Bia cadeira ${b.seat} · ${await boardText(pa)} | ${await boardText(pb)}`
})

/** Whoever is to play and has a tile that fits plays it with the keyboard; the table draws and passes by itself. */
async function playOn(maxPlays) {
  let plays = 0
  for (let i = 0; i < 400 && plays < maxPlays; i++) {
    const [a, b] = [await digest(pa), await digest(pb)]
    if (!a || !b || a.phase !== 'play' || b.phase !== 'play') break
    if (a.seq !== b.seq || !a.still || !b.still) {
      await sleep(150)
      continue
    }
    const turns = [a, b].filter((d) => d.seat >= 0 && d.seat === d.turn).length
    if (turns > 1) throw new Error(`both apps think it is their turn at step ${a.seq}`)
    const [page, d, who] = a.seat === a.turn ? [pa, a, 'Ana'] : b.seat === b.turn ? [pb, b, 'Bia'] : [null, null, 'a bot']
    if (!page || d.fits === 0) {
      // A bot's turn, or nothing fits: the table plays, draws or passes on its own clock.
      await until(async () => (await digest(pa))?.seq !== a.seq, `the table moves on from step ${a.seq} (${who})`, 20_000)
      continue
    }
    await page.keyboard.press('Enter')
    let asked = Date.now()
    await until(async () => {
      const [na, nb] = [await digest(pa), await digest(pb)]
      if ((na?.seq ?? 0) > a.seq && (nb?.seq ?? 0) > a.seq) return true
      // A tile that fits both ends asks which (the canvas says so a few frames later): Enter again takes the one offered.
      if ((page === pa ? na : nb)?.choosing && Date.now() - asked > 700) {
        asked = Date.now()
        await page.keyboard.press('Enter')
      }
      return false
    }, `${who}'s play reaches both apps (step ${a.seq})`, 12_000)
    plays++
  }
  return plays
}

await check('Uma rodada inteira pelo teclado: a cada jogada as duas mesas ficam iguais, e no fim todas as pedras aparecem', async () => {
  await canvas(pa).click({ position: { x: 720, y: 120 } })
  await canvas(pb).click({ position: { x: 720, y: 120 } })
  const first = await playOn(4)
  const [m1] = await settled(pa, pb, 'both agree after the first plays')
  await shot('a', '05-line-growing')
  const plays = first + (await playOn(200))
  const [a, b] = await settled(pa, pb, 'the round ends on both apps', 60_000)
  if (a.phase !== 'done') throw new Error(`the round did not end: ${JSON.stringify(a)}`)
  // Every hand is turned up now: all 28 tiles have numbers in both scenes, minus what stayed in the stock.
  if (a.known !== b.known || a.known < a.line) throw new Error(`the apps disagree on the tiles shown: ${a.known} / ${b.known}`)
  await sleep(600)
  await shot('a', '06-round-over-ana')
  await shot('b', '07-round-over-bia')
  const [ta, tb] = [await boardText(pa), await boardText(pb)]
  if (!/Bateu|carroça|Lá-e-lô|Cruzada|trancado|Trancou/.test(ta) || !/Bateu|carroça|Lá-e-lô|Cruzada|trancado|Trancou/.test(tb)) throw new Error(`no result on the boards: ${ta} | ${tb}`)
  return `${plays} jogadas de gente, ${a.line} pedras na mesa (4 depois de ${m1.line}) · ${ta} | ${tb}`
})

await check('"Jogar agora" distribui a rodada seguinte sem esperar, e o placar da partida segue', async () => {
  await pb.getByRole('button', { name: 'Jogar agora' }).click()
  await until(async () => (await digest(pa))?.phase === 'play', 'the next round is dealt')
  await settled(pa, pb, 'the second deal ends on both apps')
  const ta = await boardText(pa)
  if (!/Rodada 2|Você abre|Sua vez|Vez de/.test(ta)) throw new Error(`not in round 2: ${ta}`)
  return ta
})

await check('Bia levanta no meio da rodada: um bot fica com as pedras dela e o jogo segue; a vista de cima mostra a mesa', async () => {
  await playOn(2)
  await pb.keyboard.press('KeyE')
  await board(pb).waitFor({ state: 'detached', timeout: 8000 })
  await board(pa).getByText(/\(bot\)/).first().waitFor({ timeout: 8000 })
  const before = (await digest(pa)).seq
  // The bot plays when its turn comes; Ana keeps playing hers.
  await playOn(2)
  const after = await until(async () => {
    const d = await digest(pa)
    return d && d.seq > before + 1 ? d : null
  }, 'the game goes on with the bot', 30_000)
  await pa.keyboard.press('KeyV')
  await sleep(1700)
  await shot('a', '08-top-view-with-bot')
  await pa.keyboard.press('KeyV')
  // Bia, standing by the table, still sees it: the line, and no numbers but the line's.
  const b = await until(async () => {
    const d = await digest(pb)
    return d && d.seq >= after.seq && d.still ? d : null
  }, 'Bia watches from outside')
  if (b.seat !== -1 || b.known !== b.line) throw new Error(`someone watching should only know the line: ${JSON.stringify(b)}`)
  await sleep(600)
  await shot('b', '09-watching-from-outside')
  return `${await boardText(pa)} · passos ${before} → ${after.seq}`
})

await check('Ana levanta: a mesa fica livre de novo, e a voz dos dois nunca caiu', async () => {
  await pa.keyboard.press('KeyE')
  await board(pa).waitFor({ state: 'detached', timeout: 8000 })
  await until(async () => (await digest(pa)) === null && (await digest(pb)) === null, 'the table is free on both apps')
  const end = await voiceJoinedAt(A.token)
  if (end[A.id] !== joinedBefore[A.id] || end[B.id] !== joinedBefore[B.id]) throw new Error(`the call rejoined: ${JSON.stringify(joinedBefore)} → ${JSON.stringify(end)}`)
  await connected(pa).waitFor({ timeout: 2000 })
  await connected(pb).waitFor({ timeout: 2000 })
})

writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (!KEEP) {
  for (const { app } of Object.values(apps)) await app.close().catch(() => undefined)
  Q.stopAll()
}
process.exit(failed.length ? 1 : 0)
