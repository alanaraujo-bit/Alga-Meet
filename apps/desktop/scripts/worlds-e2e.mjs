// Alga Worlds end to end on two REAL app instances against an isolated QA stack this script starts and stops: opening
// the world of a call, walking in, seeing each other, reactions, a shared screen on the room's screen, the voice call
// staying up through all of it, a failing 3D pack leaving the call intact, and the Ateliê (arranging and saving the
// room, a real sandbox purchase unlocking a piece).
//   QA_WORK=<dir> QA_API_PORT=4395 QA_LK_PORT=7995 node scripts/worlds-e2e.mjs [--skip-build] [--keep]
// A packaged build instead of a fresh one (what a release ships): QA_EXE="<...>/release/win-unpacked/Alga Meet.exe",
// with QA_OUT=<dir> so its screenshots do not replace the ones in docs.
// Screenshots: docs/screenshots/worlds/. Never touches the dev stack (:4000/:7880). The screen that is shared is
// Chromium's synthetic one (the fake-device switches), never this computer's.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import * as Q from './qa-stack.mjs'

const KEEP = process.argv.includes('--keep')
const APP = join(Q.appDir, 'node_modules', '.alga-qa-worlds')
const EXE = process.env.QA_EXE
const OUT = process.env.QA_OUT ?? join(Q.repo, 'docs', 'screenshots', 'worlds')
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
  const username = `wld${tag}${run}`
  const email = `${username}@qa.alga.test`
  const password = `mundo ${run} sala ${tag}`
  const r = await rest(null, 'POST', '/auth/register', { email, username, displayName, password, birthDate: '1995-05-05', termsVersion: legal.termsVersion })
  await rest(null, 'POST', '/auth/verify-email', { token: await mailedToken(email, 'verify') })
  return { username, password, token: r.token, id: r.user.id }
}
/** A purchase through the sandbox provider: checkout, then its page approved (what the person's browser would do). */
async function buy(token, productId) {
  const co = await rest(token, 'POST', '/billing/checkout', { productId })
  const r = await fetch(co.url)
  if (!r.ok) throw new Error(`sandbox approve ${r.status}`)
}

async function launch(k, x) {
  rmSync(join(process.env.APPDATA ?? '', EXE ? 'Alga Meet' : 'Alga Meet Dev', 'profiles', `qa-worlds-${k}`), { recursive: true, force: true })
  const env = { ...process.env, ALGA_API_URL: Q.API, ALGA_E2E: '1' }
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({
    executablePath: EXE ?? electronPath, cwd: Q.appDir, env,
    args: [...(EXE ? [] : [APP]), `--profile=qa-worlds-${k}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
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
/** What the engine wrote on its canvas: frames drawn, tier, draw calls. */
const engine = (page) => page.evaluate(() => {
  const c = document.querySelector('canvas[data-frames]')
  return c ? { frames: Number(c.dataset.frames), tier: c.dataset.tier, calls: Number(c.dataset.calls), triangles: Number(c.dataset.triangles) } : null
})
/** The name tags the engine draws over the figures, with where each is on screen. */
const tags = (page) => page.evaluate(() => [...document.querySelectorAll('.world-tag')].filter((e) => e.style.display !== 'none' && !('me' in e.dataset)).map((e) => ({ name: e.firstChild?.textContent ?? '', at: e.style.transform })))
/**
 * When each person joined the voice room, as the SERVER knows it (VoiceState.joinedAt comes from LiveKit's own
 * participant_joined). A world must never change it: the same value before and after means the call never dropped or
 * rejoined, however briefly.
 */
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
async function drawing(page, what) {
  const a = await until(() => engine(page), `${what}: the engine is on the page`, 60_000)
  await sleep(1200)
  const b = await engine(page)
  if (!(b.frames > a.frames)) throw new Error(`${what}: no new frames (${a.frames} → ${b.frames})`)
  return b
}

// ── stack, accounts, call ───────────────────────────────────
await Q.startLivekit()
await Q.startApi()
const A = await account('a', 'Ana Souza')
const B = await account('b', 'Bia Lima')
await rest(A.token, 'POST', '/users/@me/relationships', { username: B.username }).catch(() => undefined)
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

await check('O botão Mundo abre o lounge: a sala desenha e a chamada continua conectada', async () => {
  await dock(pa).getByRole('button', { name: 'Mundo' }).click()
  await pa.getByRole('menuitemcheckbox', { name: /Lounge/ }).click()
  await hud(pa).waitFor({ timeout: 90_000 })
  const e = await drawing(pa, 'A')
  await connected(pa).waitFor({ timeout: 2000 })
  await sleep(2500)
  await shot('a', '01-lounge')
  return `${e.tier}, ${e.calls} draws, ${Math.round(e.triangles / 1000)}k tris`
})

await check('Quem está na chamada e fora do mundo vê o cartão "Mundo aberto" e entra por ele', async () => {
  await card(pb).waitFor({ timeout: 10_000 })
  await card(pb).getByText('1 pessoa lá dentro').waitFor({ timeout: 5000 })
  await shot('b', '02-card')
  await card(pb).getByRole('button', { name: 'Entrar' }).click()
  await hud(pb).waitFor({ timeout: 90_000 })
  await drawing(pb, 'B')
  // Each sees the other's figure, by name.
  await until(async () => (await tags(pa)).some((t) => t.name === 'Bia Lima'), 'A sees Bia', 30_000)
  await until(async () => (await tags(pb)).some((t) => t.name === 'Ana Souza'), 'B sees Ana', 30_000)
  await sleep(1500)
  await shot('b', '03-together')
})

await check('Ana anda (W A S D) e Bia vê a figura dela mudar de lugar', async () => {
  const before = (await tags(pb)).find((t) => t.name === 'Ana Souza')?.at
  await pa.locator('canvas[data-frames]').click({ position: { x: 700, y: 300 } }).catch(() => undefined)
  await pa.keyboard.down('KeyW')
  await sleep(1800)
  await pa.keyboard.up('KeyW')
  await pa.keyboard.down('KeyD')
  await sleep(900)
  await pa.keyboard.up('KeyD')
  const after = await until(async () => {
    const t = (await tags(pb)).find((x) => x.name === 'Ana Souza')?.at
    return t && t !== before ? t : null
  }, 'Ana moved on B', 8000)
  return `${before} → ${after}`.replace(/translate\(-50%, -100%\) /g, '')
})

await check('Uma reação de Ana aparece sobre a figura dela na tela de Bia', async () => {
  await hud(pa).getByRole('button', { name: '👏' }).click()
  await pb.locator('.world-reaction').first().waitFor({ timeout: 5000 })
  await shot('b', '04-reaction')
})

await check('A tela que Ana compartilha aparece na tela da sala para Bia, sem Bia clicar em Assistir', async () => {
  await dock(pa).getByRole('button', { name: 'Compartilhar tela' }).click()
  const picker = pa.getByRole('dialog', { name: 'Compartilhar tela' })
  await picker.waitFor({ timeout: 10_000 })
  const source = picker.getByRole('radio').first()
  if (await source.count()) await source.click().catch(() => undefined)
  await picker.getByRole('button', { name: 'Transmitir' }).click()
  // B's room screen is fed by a <video> the media engine attached: it has frames.
  const v = await until(() => pb.evaluate(() => {
    const el = [...document.querySelectorAll('video')].find((x) => x.readyState >= 2 && x.videoWidth > 0)
    return el ? { w: el.videoWidth, h: el.videoHeight } : null
  }), 'B decodes the shared screen', 40_000)
  await hud(pb).getByRole('button', { name: 'Assistir à tela' }).click()
  await sleep(3500)
  await shot('b', '05-screen-on-tv')
  await hud(pb).getByRole('button', { name: 'Parar de assistir' }).click()
  return `${v.w}×${v.h}`
})

await check('Ana leva a chamada para a sala dela: Bia continua dentro, agora na "Sala de Ana Souza"', async () => {
  await sleep(5200) // the place of a world changes at most once every few seconds
  await dock(pa).getByRole('button', { name: 'Mundo' }).click()
  await pa.getByRole('menuitemcheckbox', { name: /Minha sala/ }).click()
  await pb.getByText('Sala de Ana Souza').first().waitFor({ timeout: 30_000 })
  await hud(pb).waitFor({ timeout: 60_000 })
  await sleep(4000)
  await shot('b', '06-anas-room')
})

await check('Sair do mundo não mexe na voz: para o servidor, os dois nunca saíram da chamada', async () => {
  await hud(pb).getByRole('button', { name: 'Sair do mundo' }).click()
  await hud(pb).waitFor({ state: 'detached', timeout: 8000 })
  await connected(pb).waitFor({ timeout: 2000 })
  await connected(pa).waitFor({ timeout: 2000 })
  const now = await voiceJoinedAt(A.token)
  if (now[A.id] !== joinedBefore[A.id] || now[B.id] !== joinedBefore[B.id]) throw new Error(`the call rejoined: ${JSON.stringify(joinedBefore)} → ${JSON.stringify(now)}`)
  if (await pb.locator('canvas[data-frames]').count()) throw new Error('the 3D canvas stayed after leaving')
  await card(pb).waitFor({ timeout: 5000 })
  await shot('b', '07-back-on-call')
})

await check('Se o cenário 3D não baixa, o mundo diz que não abriu e a chamada segue inteira', async () => {
  // A fresh profile state for B's pack: nothing cached, and every request for it fails.
  await pb.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry('alga-worlds-v1', { recursive: true }).catch(() => undefined)
  })
  await pb.route('**/worlds/assets/**', (route) => route.abort())
  await card(pb).getByRole('button', { name: 'Entrar' }).click()
  await pb.getByText('O mundo não abriu').waitFor({ timeout: 30_000 })
  await connected(pb).waitFor({ timeout: 2000 })
  await shot('b', '08-failed-gracefully')
  await pb.getByRole('button', { name: 'Voltar para a chamada' }).click()
  await dock(pb).getByRole('button', { name: 'Microfone', exact: false }).first().waitFor({ timeout: 5000 }).catch(() => undefined)
  await connected(pb).waitFor({ timeout: 2000 })
  await pb.unroute('**/worlds/assets/**')
})

await check('Ateliê: Ana põe uma peça na sala, salva, e a sala guardada no servidor tem a peça', async () => {
  const before = (await rest(A.token, 'GET', '/worlds/rooms/@me')).items.length
  await pa.keyboard.press('Control+K')
  await pa.keyboard.type('Ateliê')
  await pa.keyboard.press('Enter')
  const studio = pa.getByRole('dialog', { name: 'Ateliê' })
  await studio.waitFor({ timeout: 15_000 })
  await studio.getByText(/de 90 peças na sala/).waitFor({ timeout: 60_000 })
  await until(() => engine(pa), 'the studio engine', 60_000)
  await studio.getByRole('tab', { name: 'Plantas' }).click()
  await studio.getByRole('button', { name: /Colocar na sala: Calocásia/ }).click()
  await studio.getByText(`${before + 1} de 90 peças na sala`).waitFor({ timeout: 15_000 })
  await sleep(1500)
  await shot('a', '09-studio-room')
  await studio.getByRole('button', { name: 'Salvar sala' }).click()
  await pa.getByText('Sala salva.').first().waitFor({ timeout: 10_000 })
  const after = await rest(A.token, 'GET', '/worlds/rooms/@me')
  if (after.items.length !== before + 1) throw new Error(`the saved room has ${after.items.length} items, expected ${before + 1}`)
  return `${before} → ${after.items.length} peças`
})

await check('Uma peça da loja não salva sem compra; depois de uma compra de verdade (sandbox) ela é de Ana', async () => {
  const studio = pa.getByRole('dialog', { name: 'Ateliê' })
  await studio.getByRole('tab', { name: 'Assentos' }).click()
  await studio.getByRole('button', { name: /Colocar na sala: Poltrona Lounge de couro/ }).click()
  await studio.getByText(/Provando “Poltrona Lounge de couro”/).waitFor({ timeout: 10_000 })
  if (await studio.getByRole('button', { name: 'Salvar sala' }).count()) throw new Error('Salvar is offered with a piece that is not hers')
  await shot('a', '10-studio-trying')
  // The server refuses it too (the app is not the only lock).
  const room = await rest(A.token, 'GET', '/worlds/rooms/@me')
  const refused = await fetch(`${Q.API}/api/v1/worlds/rooms/@me`, {
    method: 'PUT', headers: { authorization: `Bearer ${A.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: room.name, access: room.access, finish: room.finish, items: [...room.items, { id: 'zz9', sku: 'w_poltrona_lounge', x: 0, y: 0, z: 0, rot: 0 }] }),
  })
  if (refused.status !== 403) throw new Error(`the server answered ${refused.status} to an unowned piece`)
  await buy(A.token, 'w_poltrona_lounge')
  await studio.getByRole('button', { name: 'Salvar sala' }).waitFor({ timeout: 15_000 })
  await studio.getByRole('button', { name: 'Salvar sala' }).click()
  await pa.getByText('Sala salva.').first().waitFor({ timeout: 10_000 })
  const after = await rest(A.token, 'GET', '/worlds/rooms/@me')
  if (!after.items.some((i) => i.sku === 'w_poltrona_lounge')) throw new Error('the bought piece is not in the saved room')
})

await check('Manequim: Ana troca a roupa e a peça de cabeça, salva, e o servidor guarda o manequim dela', async () => {
  const studio = pa.getByRole('dialog', { name: 'Ateliê' })
  await studio.getByRole('tab', { name: 'Manequim' }).click()
  await studio.getByRole('button', { name: 'Macacão' }).click()
  await studio.getByRole('button', { name: 'Headset' }).click()
  await sleep(1500)
  await shot('a', '11-studio-avatar')
  await studio.getByRole('button', { name: 'Salvar manequim' }).click()
  await pa.getByText('Manequim salvo.').first().waitFor({ timeout: 10_000 })
  const me = await rest(A.token, 'GET', '/users/@me')
  if (me.world?.outfit !== 'o_macacao' || me.world?.head !== 'h_headset') throw new Error(`saved avatar: ${JSON.stringify(me.world)}`)
  await studio.getByRole('tab', { name: 'Loja' }).click()
  await sleep(800)
  await shot('a', '12-studio-store')
  await pa.keyboard.press('Escape')
  await studio.waitFor({ state: 'detached', timeout: 8000 })
  if (await pa.locator('canvas[data-frames]').count() > 1) throw new Error('two 3D canvases are alive')
})

await check('Desconectar da chamada fecha o mundo e solta a placa de vídeo', async () => {
  // Through the Ateliê, the purchase and the saves, the voice of both is still the one from the start.
  const end = await voiceJoinedAt(A.token)
  if (end[A.id] !== joinedBefore[A.id] || end[B.id] !== joinedBefore[B.id]) throw new Error(`the call rejoined: ${JSON.stringify(joinedBefore)} → ${JSON.stringify(end)}`)
  await dock(pa).getByRole('button', { name: 'Desconectar' }).click()
  await pa.locator('canvas[data-frames]').waitFor({ state: 'detached', timeout: 8000 })
  await card(pb).waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined)
})

writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (!KEEP) {
  for (const { app } of Object.values(apps)) await app.close().catch(() => undefined)
  Q.stopAll()
}
process.exit(failed.length ? 1 : 0)
