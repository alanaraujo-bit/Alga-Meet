// Sala de Cinema screens next to the approved mockups, on two REAL app instances (Ana projects, Bia sits) against the
// isolated QA stack. Each state is captured at 1440×900 and composed as mockup | app into docs/design/cinema/compare.
//   QA_WORK=<dir> node scripts/qa-stack.mjs start
//   QA_WORK=<dir> node scripts/cinema-shots.mjs [--build] [--keep] --film=<2.39 film with chapters, see below>
//   QA_WORK=<dir> node scripts/qa-stack.mjs stop
// The film: any MKV works; the compare set used a 1920×804 dusk still (ffmpeg geq), 10 min, chapters Abertura … Créditos,
// two AC-3 5.1 tracks (por "Dublado", eng "Original") and a Portuguese SRT, named Duna.Parte.Dois.2024.1080p.WEB-DL.mkv.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, cpSync } from 'node:fs'
import { execSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import * as Q from './qa-stack.mjs'

const KEEP = process.argv.includes('--keep')
const FILM = process.argv.find((a) => a.startsWith('--film='))?.slice(7)
if (!FILM || !existsSync(FILM)) throw new Error('--film=<path.mkv> is required')
/** Own build dir: never the one another QA run uses. */
const APP = join(Q.appDir, 'node_modules', '.alga-qa-shots')
const MOCK = join(Q.repo, 'docs', 'design', 'cinema', 'mockups', 'jpg')
const COMPARE = join(Q.repo, 'docs', 'design', 'cinema', 'compare')
const SHOTS = join(Q.WORK, 'shots')
const FFMPEG = 'ffmpeg'
mkdirSync(SHOTS, { recursive: true })
mkdirSync(COMPARE, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const electronPath = createRequire(join(Q.appDir, 'package.json'))('electron')
const apps = {}
const log = (...a) => console.log(`[cinema-shots ${new Date().toISOString().slice(11, 19)}]`, ...a)

if (process.argv.includes('--build') || !existsSync(join(APP, 'main', 'index.js'))) {
  execSync(`npx electron-vite build --outDir "${APP}"`, { cwd: Q.appDir, stdio: 'inherit' })
  writeFileSync(join(APP, 'package.json'), JSON.stringify({ name: '@alga/desktop', productName: 'Alga Meet', version: '0.1.0', main: './main/index.js' }, null, 2))
  cpSync(join(Q.appDir, 'build', 'runtime'), join(APP, 'build', 'runtime'), { recursive: true })
}
const ffDst = join(APP, 'build', 'ffmpeg')
if (!existsSync(ffDst)) symlinkSync(join(Q.appDir, 'build', 'ffmpeg'), ffDst, 'junction')

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
  const username = `shot${tag}${run}`
  const email = `${username}@qa.alga.test`
  const password = `sessao ${run} poltrona ${tag}`
  const r = await rest(null, 'POST', '/auth/register', { email, username, displayName, password, birthDate: '1995-05-05', termsVersion: legal.termsVersion })
  await rest(null, 'POST', '/auth/verify-email', { token: await mailedToken(email, 'verify') })
  return { username, password, token: r.token, id: r.user.id }
}

const WS_HOOK = () => {
  // Harness only: the gateway socket and this window's last cinema_status, to stage a stall (mockup 08).
  const orig = WebSocket.prototype.send
  WebSocket.prototype.send = function (data) {
    window.__ws = this
    window.__send = (d) => orig.call(this, d)
    if (typeof data === 'string' && data.startsWith('{"op":"cinema_status"')) {
      window.__status = data
      if (window.__holdStatus) return // the staged stall holds (the seat's own "ready" would end it at once)
    }
    return orig.call(this, data)
  }
}

async function launch(k, x) {
  rmSync(join(process.env.APPDATA ?? '', 'Alga Meet Dev', 'profiles', `qa-shot-${k}`), { recursive: true, force: true })
  const env = { ...process.env, ALGA_API_URL: Q.API, ALGA_E2E: '1' }
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({
    executablePath: electronPath, cwd: Q.appDir, env,
    args: [APP, `--profile=qa-shot-${k}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
      '--autoplay-policy=no-user-gesture-required', '--force-device-scale-factor=1'],
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.log(`[${k}] pageerror`, e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${k}] ${m.type()}`, m.text().slice(0, 300))
  })
  await app.evaluate(({ BrowserWindow }, o) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(1440, 900)
    win.setPosition(o.x, 0)
  }, { x })
  await page.context().addInitScript(WS_HOOK)
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
const video = (page) => page.evaluate(() => {
  const v = document.querySelector('video')
  return v && { t: v.currentTime, paused: v.paused, ready: v.readyState }
})

/** Screenshot of one window + the composite mockup | app (≈1440 px wide JPG); `mock` null = a check, kept in SHOTS only. */
async function shot(k, name, mock = name) {
  const png = join(SHOTS, `${name}.png`)
  // toasts from earlier steps ("Ana pulou para …") are not part of the state being compared
  const toasts = apps[k].page.getByRole('region', { name: 'Notificações' }).getByRole('button', { name: 'Dispensar' })
  // a DOM click, not the mouse: a pointer event would wake the room's hidden interface
  for (let i = 0; i < 5 && (await toasts.count()) > 0; i++) await toasts.first().evaluate((el) => el.click()).catch(() => undefined)
  await sleep(250)
  await apps[k].page.screenshot({ path: png })
  if (mock === null) return log('check', name, png)
  const m = join(MOCK, `${mock}.jpg`)
  const out = join(COMPARE, `${name}.jpg`)
  // no mockup for this state (countdown): the app alone
  const args = existsSync(m)
    ? ['-i', m, '-i', png, '-filter_complex', '[0]scale=-2:900[a];[1]scale=-2:900[b];[a][b]hstack=inputs=2,scale=1440:-2:flags=lanczos']
    : ['-i', png, '-vf', 'scale=1440:-2:flags=lanczos']
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args, '-q:v', '3', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`compose: ${r.stderr}`)
  log('shot', name, png)
  return png
}

// ── run ──────────────────────────────────────────────────────
if (!(await fetch(`${Q.API}/api/v1/health`).then((r) => r.ok, () => false))) throw new Error('QA stack down: node scripts/qa-stack.mjs start')
const A = await account('a', 'Ana Souza')
const B = await account('b', 'Bia Lima')
const space = await rest(A.token, 'POST', '/spaces', { name: 'Os de Sempre' })
const invite = await rest(A.token, 'POST', `/spaces/${space.id}/invites`, {})
await rest(B.token, 'POST', `/invites/${invite.code}`)
const voice = space.channels.find((c) => c.type === 'voice')
await rest(A.token, 'PATCH', `/channels/${voice.id}`, { name: 'Sexta do filme', topic: 'Filme toda sexta, 21h' }).catch((e) => log('rename voice', e.message))

const pa = await launch('a', 0)
const pb = await launch('b', 1460)
await login(pa, A)
await login(pb, B)
async function joinVoice(page) {
  await page.getByRole('navigation', { name: 'Espaços' }).getByRole('button', { name: /^Os de Sempre/ }).click()
  await page.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: /^(Entrar em |Trocar para )?Sexta do filme(, .*)?$/ }).first().click()
  const pill = page.getByRole('toolbar', { name: 'Antes de entrar' }).getByRole('button', { name: /^Entrar/ })
  if (await pill.isVisible().catch(() => false)) await pill.click()
  await page.getByText('Voz conectada').first().waitFor({ timeout: 30_000 })
}
const dock = (page) => page.getByRole('toolbar', { name: 'Controles da chamada' })
const closeNotices = async (page) => {
  const close = page.getByRole('status').getByRole('button', { name: 'Fechar' })
  for (let i = 0; i < 5 && (await close.count()) > 0; i++) await close.first().click({ timeout: 2000 }).catch(() => undefined)
}
/** `n` reactions from a window (the picker: R, the emoji, Esc); the server takes a burst of 5 then 1/s. */
async function react(page, n, emoji = '😂') {
  await page.keyboard.press('r')
  for (let i = 0; i < n; i++) {
    await page.getByRole('button', { name: `Reagir ${emoji}` }).click()
    await sleep(i < 4 ? 120 : 1050)
  }
  await page.keyboard.press('Escape')
}
const UNTIL = process.argv.find((a) => a.startsWith('--until='))?.slice(8)
let stopped = false
const step = async (name, fn) => {
  if (stopped) return
  try {
    await fn()
  } catch (e) {
    log(`FAIL ${name}: ${e?.message ?? e}`)
    for (const [k, a] of Object.entries(apps)) await a.page.screenshot({ path: join(SHOTS, `fail-${name}-${k}.png`) }).catch(() => undefined)
  }
  if (UNTIL && name.startsWith(UNTIL)) stopped = true
}

await joinVoice(pa)
await joinVoice(pb)
await pa.mouse.move(1300, 500)
await pb.mouse.move(1300, 500)

await step('02-ficha', async () => {
  await apps.a.app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, FILM)
  await dock(pa).getByRole('button', { name: 'Cinema' }).click()
  await pa.getByRole('dialog', { name: 'Projetar para a sala' }).waitFor({ timeout: 30_000 })
  await pa.getByLabel('Título').click()
  await pa.keyboard.press('End')
  await sleep(700)
  await shot('a', '02-ficha')
  await pa.getByRole('dialog').getByRole('button', { name: /^(Abrir sessão|Continuar de)/ }).click()
})

await step('04-foyer-vazio', async () => {
  await pa.getByText('Esperando a galera sentar').waitFor({ timeout: 20_000 })
  await closeNotices(pa)
  await sleep(6000) // the poster comes from the factory after the subtitles
  await pa.mouse.move(1300, 300)
  await shot('a', '04-foyer-vazio')
})

await step('01-chamada-cartao', async () => {
  await pb.getByRole('button', { name: 'Sentar', exact: true }).waitFor({ timeout: 10_000 })
  await pb.mouse.move(1300, 300)
  await sleep(800)
  await shot('b', '01-chamada-cartao')
})

await step('03-foyer', async () => {
  await pb.getByRole('button', { name: 'Sentar', exact: true }).click()
  await pa.getByRole('group', { name: /^Bia/ }).waitFor({ timeout: 10_000 })
  await sleep(800) // after the Eco's hop
  await shot('a', '03-foyer')
  await closeNotices(pb)
  await until(async () => !(await pa.getByRole('button', { name: /^Começar/ }).isDisabled()), 'all ready', 60_000)
  await sleep(500)
  await shot('a', '03-foyer-ready', '03-foyer')
})

await step('05-assistindo-ui', async () => {
  await pa.getByRole('button', { name: /^Começar/ }).click()
  await until(async () => {
    const [a, b] = [await video(pa), await video(pb)]
    return a && b && !a.paused && !b.paused && a.t > 1 && b.t > 1
  }, 'both playing', 40_000)
  // reactions along the way (the heat map), then "A travessia" (third chapter), so the hover shows a chapter
  await sleep(1500)
  await react(pb, 3)
  await react(pa, 2, '🔥')
  for (const [a, b] of [[5, 2], [1, 4], [3, 1]]) {
    await pa.keyboard.press('Shift+ArrowRight')
    await until(async () => !(await video(pb))?.paused, 'B playing after the seek', 30_000)
    await sleep(1500)
    await react(pa, a)
    await react(pb, b, '😱')
  }
  await pa.keyboard.press('Shift+ArrowRight')
  await sleep(2500)
  await until(async () => !(await video(pb))?.paused, 'B playing after the seek', 30_000)
  await sleep(9000) // the thumbnail sprite is made after the first video pieces, fetched once the seat was ready
  const bar = pb.getByRole('slider', { name: 'Linha do tempo' })
  const box = await bar.boundingBox()
  await pb.keyboard.press('Shift') // a keyboard focus shows the sync chip's tooltip ("2 de 2 · ±n ms")
  await pb.getByRole('status').filter({ hasText: /Em sincronia|prontos/ }).first().focus().catch(() => undefined)
  await pb.mouse.move(box.x + box.width * 0.62, box.y + box.height / 2)
  await sleep(900)
  if (!(await pb.locator('[class*=hoverCard]').count())) {
    log('no hover card after mouse.move: dispatching the pointer event in the page')
    await pb.evaluate(([x, y]) => document.elementFromPoint(x, y)?.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerType: 'mouse' })), [box.x + box.width * 0.62, box.y + box.height / 2])
    await sleep(300)
    log('hover card now', await pb.locator('[class*=hoverCard]').count())
  }
  await shot('b', '05-assistindo-ui')
})

await step('06-assistindo-limpo', async () => {
  await sleep(6000) // Ana's reaction bucket refills (burst 5, 1/s) after the reactions of 05
  await pb.mouse.move(700, 300)
  await pb.getByRole('button', { name: 'Legendas e áudio' }).click()
  await pb.getByRole('menuitemcheckbox', { name: /Português/ }).or(pb.getByRole('menuitem', { name: /Português/ })).first().click()
  await pa.keyboard.press('Home').catch(() => undefined)
  // back to the start, where the SRT has its two cues (1–5 s, 6–10 s)
  await pa.getByRole('slider', { name: 'Linha do tempo' }).focus()
  await pa.keyboard.press('Home')
  await until(async () => {
    const b = await video(pb)
    return b && !b.paused && b.t > 1 && b.t < 2.2
  }, 'B in the first cue', 30_000)
  await sleep(2300) // the interface hides after 2 s without the mouse
  await pa.keyboard.press('r')
  await pa.getByRole('button', { name: 'Reagir 😂' }).click()
  await sleep(380)
  await shot('b', '06-assistindo-limpo')
})

await step('07-pausa', async () => {
  await pa.keyboard.press('Escape')
  await pa.evaluate(() => document.activeElement?.blur()) // a focused emoji would take the Space
  await pa.locator('body').press('Space')
  await until(async () => (await video(pb))?.paused, 'B paused', 10_000)
  await pb.mouse.move(900, 200)
  await sleep(1200)
  await shot('b', '07-pausa')
})

await step('09-intervalo', async () => {
  await pb.evaluate(() => sessionStorage.setItem('alga.cinema.devPauseShiftMs', '200000'))
  await sleep(900)
  await pb.mouse.move(1300, 120)
  await sleep(300)
  await shot('b', '09-intervalo')
  await pb.evaluate(() => sessionStorage.removeItem('alga.cinema.devPauseShiftMs'))
})

await step('countdown', async () => {
  await sleep(16_000) // a pause longer than CINEMA_COUNTDOWN_AFTER_PAUSE_MS resumes with the 3 s countdown
  await pa.locator('body').press('Space')
  await sleep(900)
  await shot('b', 'countdown')
})

await step('08-esperando', async () => {
  await until(async () => !(await video(pa))?.paused, 'A playing again', 15_000)
  await sleep(2500)
  await pb.evaluate(() => {
    window.__holdStatus = true
    const st = JSON.parse(window.__status)
    window.__send(JSON.stringify({ ...st, status: 'stalled', aheadS: 6 }))
  })
  await sleep(700)
  await pa.mouse.move(900, 200)
  await sleep(400)
  await shot('a', '08-esperando')
  await pb.evaluate(() => (window.__holdStatus = false))
})

// ── Batch B: engineering mode, reduced motion, small window, fullscreen, host away, the ticket, the next episode ──
const setSize = (k, w, h) => apps[k].app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h])
const playing = (page) => until(async () => {
  const v = await video(page)
  return v && !v.paused && v.t > 0.5
}, 'playing', 30_000)

await step('engenharia', async () => {
  await playing(pb)
  await pb.mouse.move(700, 320)
  await pb.getByRole('button', { name: 'Mais opções' }).click()
  await pb.getByRole('menuitem', { name: 'Modo engenharia' }).click()
  await pb.getByRole('button', { name: 'Sair do modo engenharia' }).waitFor({ timeout: 5000 })
  await sleep(600)
  await shot('b', 'engenharia', null)
  await pb.getByRole('button', { name: 'Sair do modo engenharia' }).click()
  await playing(pb)
})

await step('reduzido', async () => {
  await pb.emulateMedia({ reducedMotion: 'reduce' })
  await pb.mouse.move(720, 330)
  await sleep(700)
  await shot('b', '05-assistindo-ui-reduzido', '05-assistindo-ui')
  await pa.locator('body').press('Space')
  await until(async () => (await video(pb))?.paused, 'B paused', 10_000)
  await pb.mouse.move(900, 200)
  await sleep(800)
  await shot('b', '07-pausa-reduzido', '07-pausa')
  await sleep(16_000) // a long pause resumes with the countdown (text with reduced motion)
  await pa.locator('body').press('Space')
  await sleep(900)
  await shot('b', 'countdown-reduzido')
  await pb.emulateMedia({ reducedMotion: null })
})

await step('small-window', async () => {
  await playing(pb)
  await setSize('b', 960, 600)
  await sleep(1200)
  await pb.mouse.move(500, 300)
  await sleep(600)
  await shot('b', 'small-window', '05-assistindo-ui')
  await pa.locator('body').press('Space')
  await until(async () => (await video(pb))?.paused, 'B paused', 10_000)
  await sleep(900)
  await shot('b', 'small-window-pausa', '07-pausa')
  await pa.locator('body').press('Space')
  await setSize('b', 1440, 900)
  await sleep(1000)
})

await step('fullscreen', async () => {
  await playing(pb)
  await pb.locator('body').press('f')
  await until(() => pb.evaluate(() => !!document.fullscreenElement), 'fullscreen', 5000)
  await sleep(1500)
  await pb.mouse.move(800, 400)
  await sleep(600)
  await shot('b', 'fullscreen', '05-assistindo-ui')
  await pb.locator('body').press('Escape')
  await until(() => pb.evaluate(() => !document.fullscreenElement), 'out of fullscreen', 5000)
  await sleep(800)
})

await step('host-away', async () => {
  // the host's socket drops and stays down for 4 s (its reconnect would otherwise end host_away at once)
  await pa.evaluate(() => {
    const W = window.WebSocket
    // a socket to a closed port fails like a dropped network; the app's own backoff retries
    window.WebSocket = Object.assign(function (_url, protocols) { return new W('ws://127.0.0.1:9/', protocols) }, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
    setTimeout(() => (window.WebSocket = W), 4000)
    window.__ws.close()
  })
  await pb.getByText(/saiu da sessão/).first().waitFor({ timeout: 8000 })
  await sleep(300)
  await shot('b', 'host-away', null)
  await pb.getByText(/saiu da sessão/).first().waitFor({ state: 'hidden', timeout: 30_000 })
})

await step('11-canhoto', async () => {
  // the end of the film with no next file: the host's client ends the session and everyone gets the ticket
  if (await video(pa).then((v) => v?.paused)) await pa.locator('body').press('Space')
  await playing(pa)
  await pa.mouse.move(700, 400)
  await pa.getByRole('slider', { name: 'Linha do tempo' }).focus()
  await pa.keyboard.press('End')
  const ticket = (page) => page.getByRole('dialog', { name: /^Canhoto da sessão/ })
  await ticket(pa).waitFor({ timeout: 40_000 })
  await ticket(pb).waitFor({ timeout: 10_000 })
  await sleep(3600) // the lights come up over 3 s, then the stub
  await pa.mouse.move(1300, 800)
  await shot('a', '11-canhoto')
  await shot('b', '11-canhoto-bia', null)
  for (const page of [pa, pb]) await page.getByRole('button', { name: 'Voltar para a chamada' }).click()
})

await step('10-proximo-episodio', async () => {
  // two episodes in one folder (copies of the film: the room only needs S01E02 -> S01E03 by name)
  const dir = join(SHOTS, 'series')
  mkdirSync(dir, { recursive: true })
  const ep = (n) => join(dir, `A.Travessia.S01E0${n}.1080p.WEB-DL.mkv`)
  for (const n of [2, 3]) if (!existsSync(ep(n))) cpSync(FILM, ep(n))
  await apps.a.app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, ep(2))
  await dock(pa).getByRole('button', { name: 'Cinema' }).click()
  await pa.getByRole('dialog', { name: 'Projetar para a sala' }).waitFor({ timeout: 30_000 })
  await pa.getByRole('dialog').getByRole('button', { name: /^(Abrir sessão|Do começo)/ }).first().click()
  await pb.getByRole('button', { name: 'Sentar', exact: true }).click({ timeout: 20_000 })
  await until(async () => !(await pa.getByRole('button', { name: /^Começar/ }).isDisabled()), 'all ready', 60_000)
  // Bia leaves the call's screen while seated: the film goes on in a corner (mini)
  await pb.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: /geral/ }).first().click()
  await pa.getByRole('button', { name: /^Começar/ }).click()
  await playing(pa)
  await playing(pb)
  await sleep(1500)
  await shot('b', 'mini', null)
  await pb.getByRole('button', { name: 'Voltar para a sala' }).evaluate((el) => el.click())
  await sleep(1200)
  // to just before the credits chapter (540 s of 600)
  await pa.mouse.move(700, 400)
  const bar = pa.getByRole('slider', { name: 'Linha do tempo' })
  const box = await bar.boundingBox()
  await pa.mouse.click(box.x + (box.width * 533) / 600, box.y + box.height / 2)
  await pa.locator('section[aria-label^="Próximo:"]').waitFor({ timeout: 40_000 })
  await sleep(700)
  await shot('a', '10-proximo-episodio')
  await shot('b', '10-proximo-episodio-bia', null)
  // the switch: same session, same seats, S01E03 from its start
  await pb.getByText('· S01E03').first().waitFor({ timeout: 30_000 })
  await until(async () => {
    const v = await video(pb)
    return v && !v.paused && v.t > 1 && v.t < 60
  }, 'B playing S01E03', 40_000)
  await shot('b', 'switched-s01e03', null)
})

log('composites in', COMPARE)
if (!KEEP) for (const a of Object.values(apps)) await a.app.close().catch(() => undefined)
process.exit(0)
