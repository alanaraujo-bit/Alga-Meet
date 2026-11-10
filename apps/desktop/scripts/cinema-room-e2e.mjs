// Cinema room: fullscreen menus, the live chat and the lock, end to end on two REAL app instances (Ana projects, Bia
// sits) against an isolated QA stack that this script starts and stops.
//   QA_WORK=<dir> QA_API_PORT=4380 QA_LK_PORT=7980 node scripts/cinema-room-e2e.mjs --film=<path.mkv with an SRT> [--skip-build] [--keep]
// The film needs one embedded subtitle track (the fullscreen check picks it in the menu). Screenshots:
// docs/screenshots/cinema-room/. Never touches the dev stack (:4000/:7880).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import * as Q from './qa-stack.mjs'

const KEEP = process.argv.includes('--keep')
const FILM = process.argv.find((a) => a.startsWith('--film='))?.slice(7)
if (!FILM || !existsSync(FILM)) throw new Error('--film=<path.mkv> is required')
const APP = join(Q.appDir, 'node_modules', '.alga-qa-room')
const OUT = join(Q.repo, 'docs', 'screenshots', 'cinema-room')
mkdirSync(OUT, { recursive: true })
mkdirSync(Q.WORK, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const electronPath = createRequire(join(Q.appDir, 'package.json'))('electron')
const apps = {}
const results = []

if (!process.argv.includes('--skip-build')) {
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
  const username = `room${tag}${run}`
  const email = `${username}@qa.alga.test`
  const password = `sessao ${run} poltrona ${tag}`
  const r = await rest(null, 'POST', '/auth/register', { email, username, displayName, password, birthDate: '1995-05-05', termsVersion: legal.termsVersion })
  await rest(null, 'POST', '/auth/verify-email', { token: await mailedToken(email, 'verify') })
  return { username, password, token: r.token, id: r.user.id }
}

async function launch(k, x) {
  rmSync(join(process.env.APPDATA ?? '', 'Alga Meet Dev', 'profiles', `qa-room-${k}`), { recursive: true, force: true })
  const env = { ...process.env, ALGA_API_URL: Q.API, ALGA_E2E: '1' }
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({
    executablePath: electronPath, cwd: Q.appDir, env,
    args: [APP, `--profile=qa-room-${k}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
      '--autoplay-policy=no-user-gesture-required', '--force-device-scale-factor=1'],
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.log(`[${k}] pageerror`, e.message))
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_NAME_NOT_RESOLVED|net::ERR_FAILED/.test(m.text()) && console.log(`[${k}] console.error`, m.text().slice(0, 240)))
  await app.evaluate(({ BrowserWindow }, o) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(1440, 900)
    win.setPosition(o.x, 0)
  }, { x })
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
    for (const a of Object.values(apps)) await a.page.keyboard.up('Space').catch(() => undefined)
  }
}
const chatLines = (page) => page.getByRole('log', { name: 'Chat da sala' }).getByRole('listitem')
const badge = (page) => page.locator('[class*=lockBadge]')
/** The room's lock state, read from the page (the badge only shows for a moment). */
const lockCover = (page) => page.locator('[class*=lockCover]')

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

// Ana projects (the native file dialog answered by the harness), Bia sits, Ana starts.
await apps.a.app.evaluate(({ dialog }, file) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
}, FILM)
await pa.getByRole('toolbar', { name: 'Controles da chamada' }).getByRole('button', { name: 'Cinema' }).click()
await pa.getByRole('dialog', { name: 'Projetar para a sala' }).waitFor({ timeout: 30_000 })
await pa.getByRole('dialog').getByRole('button', { name: /^(Abrir sessão|Continuar de)/ }).click()
await pb.getByRole('button', { name: 'Sentar', exact: true }).click({ timeout: 30_000 })
await until(async () => !(await pa.getByRole('button', { name: /^Começar/ }).isDisabled()), 'all ready', 90_000)
await pa.getByRole('button', { name: /^Começar/ }).click()
await until(async () => {
  const [a, b] = [await video(pa), await video(pb)]
  return a && b && !a.paused && !b.paused && a.t > 1 && b.t > 1
}, 'both playing', 60_000)
for (const p of [pa, pb]) {
  const close = p.getByRole('status').getByRole('button', { name: 'Fechar' })
  for (let i = 0; i < 5 && (await close.count()) > 0; i++) await close.first().click({ timeout: 2000 }).catch(() => undefined)
}

// ── fullscreen ──────────────────────────────────────────────
await check('Tela cheia: o menu de legendas abre dentro da sala, escolhe a legenda, e o menu ⋯ e as dicas também aparecem', async () => {
  await pb.mouse.move(700, 400)
  await pb.getByRole('button', { name: 'Tela cheia' }).click()
  await until(() => pb.evaluate(() => !!document.fullscreenElement), 'fullscreen', 5000)
  await pb.mouse.move(720, 420)
  await pb.getByRole('button', { name: 'Legendas e áudio' }).click()
  const menu = pb.getByRole('menu')
  await menu.waitFor({ timeout: 5000 })
  const inside = await pb.evaluate(() => !!document.fullscreenElement?.contains(document.querySelector('[role="menu"]')))
  if (!inside) throw new Error('the menu is outside the fullscreen element')
  await sleep(300)
  await shot('b', '01-fullscreen-subtitles-menu')
  await menu.getByRole('menuitemcheckbox', { name: /Português/ }).or(menu.getByRole('menuitem', { name: /Português/ })).first().click()
  await until(() => pb.evaluate(() => [...document.querySelectorAll('[class*=subtitles]')].some((e) => e.textContent?.trim())), 'a subtitle on screen', 10_000)
  await pb.mouse.move(1380, 860)
  await pb.getByRole('button', { name: 'Mais opções' }).click()
  await pb.getByRole('menu').getByRole('menuitem', { name: 'Travar a tela' }).or(pb.getByRole('menu').getByRole('menuitemcheckbox', { name: 'Travar a tela' })).first().waitFor({ timeout: 5000 })
  await sleep(300)
  await shot('b', '02-fullscreen-more-menu')
  await pb.keyboard.press('Escape') // closes the menu, not the fullscreen (the room's Esc runs after it)
  await pb.getByRole('button', { name: 'Chat' }).hover()
  await until(() => pb.getByRole('tooltip').isVisible(), 'tooltip in fullscreen', 4000)
})

// ── chat ────────────────────────────────────────────────────
await check('Chat: Enter abre, a mensagem chega aos dois, sobe sobre o filme e some sozinha', async () => {
  await pa.mouse.move(700, 400)
  await pa.keyboard.press('Enter')
  const field = pa.getByRole('textbox', { name: 'Mensagem para a sala' })
  await field.waitFor({ timeout: 4000 })
  await field.fill('que abertura, hein')
  await pa.keyboard.press('Enter')
  await chatLines(pb).filter({ hasText: 'que abertura, hein' }).waitFor({ timeout: 5000 })
  await field.fill('alguém mais achou que o prédio vai cair? porque eu tenho certeza que vai, olha aquela rachadura no canto')
  await pa.keyboard.press('Enter')
  await chatLines(pb).filter({ hasText: 'rachadura' }).waitFor({ timeout: 5000 })
  await pa.keyboard.press('Escape')
  await field.waitFor({ state: 'detached', timeout: 3000 })
  const line = await chatLines(pb).first().innerText()
  if (!line.includes('Ana')) throw new Error(`no name in the line: ${line}`)
  await sleep(2600) // the room's controls hide: the chat stays
  await shot('b', '03-chat-over-film')
  const t0 = Date.now()
  await until(async () => (await chatLines(pb).count()) === 0, 'lines leave on their own', 12_000)
  return `sumiu em ${((Date.now() - t0) / 1000 + 2.6).toFixed(1)} s`
})

await check('Chat: o campo aberto mostra a conversa recente; vazio não envia; Bia responde', async () => {
  await pb.mouse.move(700, 400)
  await pb.getByRole('button', { name: 'Chat' }).click()
  const field = pb.getByRole('textbox', { name: 'Mensagem para a sala' })
  await field.waitFor({ timeout: 4000 })
  if ((await chatLines(pb).count()) !== 2) throw new Error(`open shows ${await chatLines(pb).count()} lines`)
  await field.fill('kkkk com certeza 😂')
  await pb.keyboard.press('Enter')
  await chatLines(pa).filter({ hasText: 'com certeza' }).waitFor({ timeout: 5000 })
  await sleep(400)
  await shot('b', '04-chat-open')
  await field.fill('   ')
  await pb.keyboard.press('Enter') // blank: closes, sends nothing
  await field.waitFor({ state: 'detached', timeout: 3000 })
  await sleep(500)
  if ((await chatLines(pa).count()) !== 1) throw new Error('a blank line was sent')
})

// ── lock ────────────────────────────────────────────────────
await check('Cadeado: segurar Espaço 3 s trava sem pausar; travada, clique, setas e R não fazem nada', async () => {
  await pb.mouse.move(700, 400)
  await sleep(300)
  await pb.keyboard.down('Space')
  await sleep(1600)
  await shot('b', '05-lock-holding')
  if ((await video(pa)).paused) throw new Error('the hold paused the room')
  await sleep(1600)
  await pb.keyboard.up('Space')
  await lockCover(pb).waitFor({ timeout: 2000 })
  await badge(pb).filter({ hasText: 'Tela travada' }).waitFor({ timeout: 2000 })
  await sleep(300)
  await shot('b', '06-locked')
  const before = (await video(pa)).t
  await pb.mouse.click(700, 400) // would pause
  await pb.keyboard.press('ArrowRight') // would seek
  await pb.keyboard.press('r') // would open the reactions
  await pb.keyboard.press('Enter') // would open the chat
  await pb.keyboard.press('Control+k') // the app's switcher
  await sleep(1200)
  const a = await video(pa)
  if (a.paused) throw new Error('a click paused the room while locked')
  if (a.t - before > 10) throw new Error('an arrow seeked while locked')
  if (await pb.getByRole('toolbar', { name: 'Reações' }).isVisible()) throw new Error('R opened the reactions')
  if (await pb.getByRole('textbox', { name: 'Mensagem para a sala' }).count()) throw new Error('Enter opened the chat')
  if (await pb.getByRole('dialog', { name: /Ir para|Buscar/ }).count()) throw new Error('Ctrl K opened the switcher')
  if ((await pb.locator('[class*=ui][data-shown="true"]').count()) > 0) throw new Error('the controls came up while locked')
})

await check('Cadeado: um toque em Espaço só lembra como destravar; a conversa continua chegando', async () => {
  await pb.keyboard.press('Space')
  await sleep(700)
  if ((await video(pa)).paused) throw new Error('a tap paused while locked')
  await badge(pb).filter({ hasText: 'Segure Espaço por 3 s' }).waitFor({ timeout: 2000 })
  await pa.keyboard.press('Enter')
  await pa.getByRole('textbox', { name: 'Mensagem para a sala' }).fill('travou aí?')
  await pa.keyboard.press('Enter')
  await pa.keyboard.press('Escape')
  await chatLines(pb).filter({ hasText: 'travou aí?' }).waitFor({ timeout: 5000 })
  await sleep(300)
  await shot('b', '07-locked-chat-arrives')
})

await check('Cadeado: segurar o selo com o mouse por 3 s destrava; segurar Espaço também', async () => {
  await pb.mouse.move(690, 380)
  const box = await badge(pb).boundingBox()
  if (!box) throw new Error('no badge after a move')
  await pb.mouse.move(box.x + 20, box.y + box.height / 2)
  await pb.mouse.down()
  await sleep(3300)
  await pb.mouse.up()
  await lockCover(pb).waitFor({ state: 'detached', timeout: 2000 })
  await badge(pb).filter({ hasText: 'Tela destravada' }).waitFor({ timeout: 2000 })
  // and Space again: lock, then unlock
  await pb.keyboard.down('Space')
  await sleep(3200)
  await pb.keyboard.up('Space')
  await lockCover(pb).waitFor({ timeout: 2000 })
  await pb.keyboard.down('Space')
  await sleep(3200)
  await pb.keyboard.up('Space')
  await lockCover(pb).waitFor({ state: 'detached', timeout: 2000 })
  if ((await video(pa)).paused) throw new Error('locking/unlocking paused the room')
})

await check('Espaço tocado pausa e volta a tocar para todos (no soltar da tecla)', async () => {
  await pb.keyboard.press('Space')
  await until(async () => (await video(pa))?.paused, 'A paused by B', 8000)
  await pb.keyboard.press('Space')
  await until(async () => !(await video(pa))?.paused, 'A playing again', 15_000)
})

await check('Menos movimento: chat e cadeado funcionam, o anel de progresso ainda enche', async () => {
  await pb.emulateMedia({ reducedMotion: 'reduce' })
  await pb.keyboard.down('Space')
  await sleep(1800)
  const ring = await pb.locator('[class*=lockRing] circle').nth(1).getAttribute('stroke-dashoffset')
  const full = 2 * Math.PI * 9
  if (!(Number(ring) < full * 0.8)) throw new Error(`the ring did not fill (offset ${ring} of ${full.toFixed(1)})`)
  await sleep(1500)
  await pb.keyboard.up('Space')
  await lockCover(pb).waitFor({ timeout: 2000 })
  await pb.keyboard.down('Space')
  await sleep(3200)
  await pb.keyboard.up('Space')
  await lockCover(pb).waitFor({ state: 'detached', timeout: 2000 })
  await pb.emulateMedia({ reducedMotion: null })
})

await check('Sair da tela cheia e voltar à chamada nunca deixa a sala travada', async () => {
  await pb.keyboard.down('Space')
  await sleep(3200)
  await pb.keyboard.up('Space')
  await lockCover(pb).waitFor({ timeout: 2000 })
  await pb.keyboard.press('Escape')
  await until(() => pb.evaluate(() => !document.fullscreenElement), 'out of fullscreen', 5000)
  // still locked (Esc only leaves fullscreen); the room is left through the call's screen
  if (!(await lockCover(pb).count())) throw new Error('Esc unlocked')
  await pb.evaluate(() => window.dispatchEvent(new Event('blur')))
  await pb.keyboard.down('Space')
  await sleep(3200)
  await pb.keyboard.up('Space')
  await lockCover(pb).waitFor({ state: 'detached', timeout: 2000 })
  await sleep(300)
  await shot('b', '08-windowed-after')
})

writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (!KEEP) {
  for (const { app } of Object.values(apps)) await app.close().catch(() => undefined)
  Q.stopAll()
}
process.exit(failed.length ? 1 : 0)
