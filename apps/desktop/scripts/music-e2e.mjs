// Music in a call (the "music bot") end to end on two REAL app instances against an isolated QA stack this script
// starts and stops. Plays real YouTube videos (needs internet). Each window's player position is read from the
// messages YouTube's embed posts to the page (the same ones the app listens to).
//   QA_WORK=<dir> QA_API_PORT=4390 QA_LK_PORT=7990 node scripts/music-e2e.mjs [--skip-build] [--keep]
// Screenshots: docs/screenshots/music/. Never touches the dev stack (:4000/:7880).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import * as Q from './qa-stack.mjs'

const KEEP = process.argv.includes('--keep')
const APP = join(Q.appDir, 'node_modules', '.alga-qa-music')
const OUT = join(Q.repo, 'docs', 'screenshots', 'music')
mkdirSync(OUT, { recursive: true })
mkdirSync(Q.WORK, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const electronPath = createRequire(join(Q.appDir, 'package.json'))('electron')
const apps = {}
const results = []
const SONG_1 = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const SONG_2 = 'https://youtu.be/9bZkp7q19f0?si=share'

if (!process.argv.includes('--skip-build')) {
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
  const username = `mus${tag}${run}`
  const email = `${username}@qa.alga.test`
  const password = `musica ${run} fila ${tag}`
  const r = await rest(null, 'POST', '/auth/register', { email, username, displayName, password, birthDate: '1995-05-05', termsVersion: legal.termsVersion })
  await rest(null, 'POST', '/auth/verify-email', { token: await mailedToken(email, 'verify') })
  return { username, password, token: r.token, id: r.user.id }
}

/** Harness only: keeps the last state/time YouTube's player posted to this page. */
const TAP = () => {
  window.__yt = { state: null, time: null, at: 0 }
  window.addEventListener('message', (e) => {
    if (typeof e.origin !== 'string' || !e.origin.includes('youtube')) return
    try {
      const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
      const i = d && d.info
      if (d?.event === 'onStateChange' && typeof i === 'number') window.__yt.state = i
      if (i && typeof i === 'object') {
        if (typeof i.playerState === 'number') window.__yt.state = i.playerState
        if (typeof i.currentTime === 'number') {
          window.__yt.time = i.currentTime
          window.__yt.at = Date.now()
        }
      }
    } catch {}
  })
}

async function launch(k, x) {
  rmSync(join(process.env.APPDATA ?? '', 'Alga Meet Dev', 'profiles', `qa-music-${k}`), { recursive: true, force: true })
  const env = { ...process.env, ALGA_API_URL: Q.API, ALGA_E2E: '1' }
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({
    executablePath: electronPath, cwd: Q.appDir, env,
    args: [APP, `--profile=qa-music-${k}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
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
  await page.context().addInitScript(TAP)
  await page.reload()
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

const yt = (page) => page.evaluate(() => window.__yt)
const card = (page) => page.getByRole('region', { name: 'Música da call' })
const field = (page) => card(page).getByRole('textbox', { name: 'Link do YouTube' })
const dock = (page) => page.getByRole('toolbar', { name: 'Controles da chamada' })
async function paste(page, url) {
  await field(page).focus()
  await page.evaluate((u) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', u)
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, url)
}
/** Both players playing, within `tol` s of each other (each read at the same wall instant, adjusted for its age). */
async function inStep(pa, pb, tol = 2.5) {
  return until(async () => {
    const [a, b] = [await yt(pa), await yt(pb)]
    if (a?.state !== 1 || b?.state !== 1 || a.time === null || b.time === null) return null
    const now = Date.now()
    const ta = a.time + (now - a.at) / 1000
    const tb = b.time + (now - b.at) / 1000
    return Math.abs(ta - tb) <= tol ? { ta, tb, diff: Math.abs(ta - tb) } : null
  }, 'both players playing in step', 45_000)
}

// ── stack, accounts, call ───────────────────────────────────
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
  await page.getByText('Voz conectada').first().waitFor({ timeout: 30_000 })
}
await joinVoice(pa)
await joinVoice(pb)

await check('O botão Música abre o cartão vazio com o campo pronto; colar um link toca para os dois, no mesmo ponto', async () => {
  await dock(pa).getByRole('button', { name: 'Música' }).click()
  await card(pa).waitFor({ timeout: 5000 })
  if (!(await field(pa).evaluate((el) => el === document.activeElement))) throw new Error('the field is not focused')
  await sleep(400)
  await shot('a', '01-empty')
  await paste(pa, SONG_1)
  await card(pb).getByText(/Never Gonna Give You Up/i).first().waitFor({ timeout: 15_000 })
  await card(pa).getByText(/Never Gonna Give You Up/i).first().waitFor({ timeout: 5000 })
  const r = await inStep(pa, pb)
  await sleep(1500)
  await shot('b', '02-playing')
  return `diferença ${r.diff.toFixed(2)} s`
})

await check('Bia põe outra na fila; Ana vê "A seguir"; pausar e voltar valem para os dois', async () => {
  await paste(pb, SONG_2)
  await card(pa).getByText('A seguir · 1').waitFor({ timeout: 15_000 })
  await card(pb).getByRole('button', { name: 'Pausar' }).click()
  await until(async () => (await yt(pa))?.state === 2, 'A paused', 8000)
  await card(pa).getByText(/Bia Lima pausou/).waitFor({ timeout: 4000 })
  await sleep(500)
  await shot('a', '03-paused-queue')
  await card(pa).getByRole('button', { name: 'Tocar' }).click()
  await inStep(pa, pb)
})

await check('Mudar o ponto da música leva os dois para lá', async () => {
  const bar = card(pa).getByRole('slider', { name: 'Posição da música' })
  await bar.evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, '120')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const r = await until(async () => {
    const [a, b] = [await yt(pa), await yt(pb)]
    return a?.time > 118 && b?.time > 118 && a.time < 135 && b.time < 135 ? { a: a.time, b: b.time } : null
  }, 'both near 2:00', 20_000)
  return `A ${r.a.toFixed(1)} s · B ${r.b.toFixed(1)} s`
})

await check('Pular troca a música dos dois; a fila esvazia', async () => {
  await card(pb).getByRole('button', { name: 'Pular' }).click()
  await card(pa).getByText(/GANGNAM/i).first().waitFor({ timeout: 15_000 })
  await card(pb).getByText(/GANGNAM/i).first().waitFor({ timeout: 5000 })
  if (await card(pa).getByText(/A seguir/).count()) throw new Error('the queue still shows')
  const r = await inStep(pa, pb)
  await sleep(1000)
  await shot('a', '04-skipped')
  return `diferença ${r.diff.toFixed(2)} s`
})

await check('Link que não é do YouTube: a frase aparece na hora e nada sai do app', async () => {
  await field(pa).fill('https://vimeo.com/76979871')
  await pa.keyboard.press('Enter')
  await card(pa).getByRole('alert').filter({ hasText: 'não é de um vídeo do YouTube' }).waitFor({ timeout: 3000 })
  await shot('a', '05-invalid')
  await field(pa).fill('')
})

await check('"Parar de ouvir" tira o player só de Ana; Bia segue tocando; "Ouvir de novo" volta no ponto da sala', async () => {
  await card(pa).getByRole('button', { name: 'Parar de ouvir (só você)' }).click()
  await card(pa).getByText('Você parou de ouvir', { exact: false }).waitFor({ timeout: 3000 })
  if (await card(pa).locator('iframe').count()) throw new Error('the player stayed')
  await sleep(1500)
  if ((await yt(pb))?.state !== 1) throw new Error('B stopped too')
  await card(pa).getByRole('button', { name: 'Ouvir de novo' }).click()
  await inStep(pa, pb)
})

await check('Recolher deixa o player (≥ 200×200) e o título, sem cobrir os controles da call', async () => {
  await card(pb).getByRole('button', { name: 'Recolher' }).click()
  await sleep(500)
  const box = await card(pb).boundingBox()
  const frame = await card(pb).locator('iframe').boundingBox()
  if (!frame || frame.width < 200 || frame.height < 200) throw new Error(`player ${JSON.stringify(frame)}: YouTube wants at least 200×200`)
  const d = await dock(pb).boundingBox()
  if (d && box.y + box.height > d.y && box.x < d.x + d.width) throw new Error('the card covers the call controls')
  await shot('b', '06-compact')
})

await check('Parar limpa a música dos dois; sair da call some com o cartão', async () => {
  await card(pa).getByRole('button', { name: 'Parar e limpar a fila' }).click()
  await card(pb).waitFor({ state: 'detached', timeout: 8000 }) // Bia did not open it: it goes with the music
  await card(pa).getByText('Nada tocando').waitFor({ timeout: 4000 }) // Ana opened it: it stays, empty
  await dock(pa).getByRole('button', { name: 'Desconectar' }).click()
  await card(pa).waitFor({ state: 'detached', timeout: 8000 })
})

writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (!KEEP) {
  for (const { app } of Object.values(apps)) await app.close().catch(() => undefined)
  Q.stopAll()
}
process.exit(failed.length ? 1 : 0)
