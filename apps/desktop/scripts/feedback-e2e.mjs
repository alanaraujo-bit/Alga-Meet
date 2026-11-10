// Feedback ("Conta pro Eco") end to end on the REAL app (Electron build stamped 0.1.15) against an isolated QA stack.
//   QA_WORK=<dir> QA_API_PORT=4370 QA_LK_PORT=7970 node scripts/feedback-e2e.mjs [--skip-build] [--keep]
// Covers: the three discreet entries (Ctrl K, user menu, Settings › Avançado) and nothing in the rail; the four kinds;
// "Vai junto" with the log visible and removable; the app's own screenshot without the card in it; sent and
// "Seus envios"; an empty send; a network failure that loses nothing; the draft across a restart; the card is not
// modal; during a call; the offer after a crash (once, only in a quiet moment); reduced motion.
// What reaches the server is checked on the request the app makes and on GET /feedback/@me (the API has no team
// route yet, and PGlite allows one process). Screenshots: docs/screenshots/feedback/. Never touches the dev stack.
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import * as Q from './qa-stack.mjs'

const KEEP = process.argv.includes('--keep')
const VERSION = '0.1.15'
const APP = join(Q.appDir, 'node_modules', '.alga-fb')
const OUT = join(Q.repo, 'docs', 'screenshots', 'feedback')
const PROFILE = 'qa-fb-ana'
const DATA = join(process.env.APPDATA ?? '', 'Alga Meet Dev', 'profiles', PROFILE)
mkdirSync(OUT, { recursive: true })
mkdirSync(Q.WORK, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const electronPath = createRequire(join(Q.appDir, 'package.json'))('electron')
const results = []
let app, p

if (!process.argv.includes('--skip-build')) {
  execSync(`npx electron-vite build --outDir "${APP}"`, { cwd: Q.appDir, stdio: 'inherit' })
  writeFileSync(join(APP, 'package.json'), JSON.stringify({ name: '@alga/desktop', productName: 'Alga Meet', version: VERSION, main: './main/index.js' }, null, 2))
  cpSync(join(Q.appDir, 'build', 'runtime'), join(APP, 'build', 'runtime'), { recursive: true })
}

async function rest(token, method, path, body) {
  const res = await fetch(`${Q.API}/api/v1${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, data: res.status === 204 ? null : await res.json().catch(() => null) }
}
async function ok(token, method, path, body) {
  const r = await rest(token, method, path, body)
  if (r.status >= 300) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(r.data)}`)
  return r.data
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
  const legal = await ok(null, 'GET', '/legal')
  const run = Math.random().toString(36).slice(2, 6)
  const username = `fb${tag}${run}`
  const email = `${username}@qa.alga.test`
  const password = `retorno ${run} farol ${tag}`
  const r = await ok(null, 'POST', '/auth/register', { email, username, displayName, password, birthDate: '1995-05-05', termsVersion: legal.termsVersion })
  await ok(null, 'POST', '/auth/verify-email', { token: await mailedToken(email, 'verify') })
  return { username, password, token: r.token, id: r.user.id }
}

/** POST /feedback requests the app made (multipart text, or null when it carries a file). */
const posts = []
async function launch({ wipe }) {
  if (wipe) rmSync(DATA, { recursive: true, force: true })
  const env = { ...process.env, ALGA_API_URL: Q.API, ALGA_E2E: '1' }
  delete env.ELECTRON_RENDERER_URL
  app = await electron.launch({
    executablePath: electronPath, cwd: Q.appDir, env,
    args: [APP, `--profile=${PROFILE}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  })
  p = await app.firstWindow()
  p.on('pageerror', (e) => console.log('pageerror', e.message))
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_NAME_NOT_RESOLVED|net::ERR_FAILED/.test(m.text()) && console.log('console.error', m.text().slice(0, 200)))
  p.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/api/v1/feedback')) posts.push(r.postData())
  })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))
  await p.waitForLoadState('domcontentloaded')
  // Harness only: automation windows open inactive, so "is the person looking at this window?" is emulated. Focus
  // emulation says yes; a flag in localStorage (survives reloads) says no, through hasFocus.
  await p.context().addInitScript(() => {
    const orig = Document.prototype.hasFocus
    Document.prototype.hasFocus = function () {
      return localStorage.getItem('__fb_blur') === '1' ? false : orig.call(this)
    }
  })
  const cdp = await p.context().newCDPSession(p)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await p.reload()
  await p.waitForLoadState('domcontentloaded')
}
const looking = (on) => p.evaluate((blur) => localStorage.setItem('__fb_blur', blur ? '1' : '0'), !on)
async function login(u) {
  const nav = p.getByRole('navigation', { name: 'Espaços' })
  await p.getByLabel('E-mail ou nome de usuário').or(nav).first().waitFor({ timeout: 30_000 })
  if (!(await nav.isVisible())) {
    await p.getByLabel('E-mail ou nome de usuário').fill(u.username)
    await p.getByLabel('Senha', { exact: true }).fill(u.password)
    await p.getByRole('button', { name: 'Entrar', exact: true }).click()
  }
  await nav.waitFor({ timeout: 30_000 })
  await p.getByRole('button', { name: 'Pular por agora' }).click({ timeout: 3000 }).catch(() => undefined)
  await sleep(400)
}
async function check(name, fn) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    results.push({ name, pass: true, ms: Date.now() - t0, detail: detail ?? null })
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (e) {
    results.push({ name, pass: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 500) })
    console.log(`FAIL ${name} — ${e?.message ?? e}`)
    await p.screenshot({ path: join(OUT, `fail-${results.length}.png`) }).catch(() => undefined)
    // Leave the next scenario a clean slate.
    await p.unroute('**/api/v1/feedback').catch(() => undefined)
    await p.emulateMedia({ reducedMotion: null }).catch(() => undefined)
    await p.evaluate(() => document.querySelector('[data-feedback] button[aria-label="Fechar"]')?.click()).catch(() => undefined)
    await sleep(600)
  }
}
const until = async (fn, what, timeout = 10_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const v = await fn().catch(() => false)
    if (v) return v
    await sleep(200)
  }
  throw new Error(`timeout: ${what}`)
}
const shot = (name) => p.screenshot({ path: join(OUT, `${name}.png`) })
const card = () => p.getByRole('dialog', { name: 'Enviar feedback' })
const offer = () => p.getByRole('status').filter({ hasText: 'Travei da última vez' })
const area = () => card().getByRole('textbox', { name: 'Seu feedback' })
const kind = (name) => card().getByRole('radio', { name, exact: true })
const sendBtn = () => card().getByRole('button', { name: 'Enviar', exact: true })
/** The "Vai junto" summary line says the log goes. */
const logGoes = () => card().getByText('· log recente do app').isVisible()
const mine = (token) => ok(token, 'GET', '/feedback/@me')
async function openByCtrlK() {
  await p.keyboard.press('Control+k')
  await p.keyboard.type('feedback')
  await p.getByRole('option', { name: /Enviar feedback/ }).first().waitFor({ timeout: 5000 })
  await p.keyboard.press('Enter')
  await card().waitFor()
  await sleep(700) // the entrance settles
}
async function closeCard() {
  if (!(await card().isVisible().catch(() => false))) return
  await card().getByRole('button', { name: 'Fechar' }).first().click()
  await card().waitFor({ state: 'detached' })
}
/** Nothing matching `loc` shows up for `ms` (the offer needs two quiet checks 2.5 s apart). */
async function staysAway(loc, ms = 9000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await loc.isVisible().catch(() => false)) throw new Error('it appeared')
    await sleep(300)
  }
}
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

// ── stack ────────────────────────────────────────────────────
await Q.startLivekit()
await Q.startApi()
const ana = await account('ana', 'Ana Retorno')
const space = await ok(ana.token, 'POST', '/spaces', { name: 'Turma da Ana' })
const voice = space.channels.find((c) => c.type === 'voice')

await launch({ wipe: true })
await login(ana)

await check('Ctrl K › "Enviar feedback" abre o cartão no canto, e a barra de espaços não ganha nada', async () => {
  const rail = p.getByRole('navigation', { name: 'Espaços' })
  if (await rail.getByRole('button', { name: /feedback/i }).count()) throw new Error('a feedback button in the rail')
  await openByCtrlK()
  const box = await card().boundingBox()
  const dock = await p.locator('[data-user-dock]').boundingBox()
  if (Math.abs(box.x - dock.x) > 2 || box.y + box.height > dock.y) throw new Error(`card at ${JSON.stringify(box)}, dock at ${JSON.stringify(dock)}`)
  if (box.width > 404) throw new Error(`card is ${box.width}px wide`)
  if ((await card().getAttribute('aria-modal')) !== 'false') throw new Error('the card is modal')
  if (!(await kind('Ideia').getAttribute('aria-checked'))) throw new Error('Ideia is not the default')
  await shot('01-open-from-ctrl-k')
})

await check('Os quatro tipos: a pergunta, a cor e o que vai junto mudam', async () => {
  const cases = [
    ['Bug', 'Eita. O que deu errado?', true, '02-kind-bug'],
    ['Travou', 'Travou? O que você fazia na hora?', true, '03-kind-crash'],
    ['Ideia', 'Boa! Qual é a ideia?', false, '04-kind-idea'],
    ['Elogio', 'Opa. Do que você gostou?', false, '05-kind-praise'],
  ]
  const tones = new Set()
  for (const [name, ask, log, file] of cases) {
    await kind(name).click()
    await card().getByText(ask).waitFor()
    const hasLog = await logGoes()
    if (hasLog !== log) throw new Error(`${name}: log line ${hasLog ? 'shown' : 'missing'}`)
    await sleep(1300) // the Eco's reaction and the color cross-fade end
    tones.add(await card().evaluate((el) => getComputedStyle(el).getPropertyValue('--fb-tone').trim()))
    await shot(file)
  }
  if (tones.size !== 4) throw new Error(`tones: ${[...tones].join(' ')}`)
  return [...tones].join(' ')
})

await check('"Vai junto › ver" mostra a versão, o sistema, onde a pessoa estava e o log; desligado, o log não sai do app', async () => {
  await kind('Bug').click()
  await card().getByRole('button', { name: 'ver', exact: true }).click()
  await card().getByText('Onde você estava').waitFor()
  const detail = await card().innerText()
  for (const want of [VERSION, 'Windows', 'Início', 'O contexto não leva nomes']) if (!detail.includes(want)) throw new Error(`"ver" lacks "${want}"`)
  const log = await card().locator('pre').innerText()
  if (!/ INFO start v0\.1\.15/.test(log)) throw new Error(`log shown: ${log.slice(0, 120)}`)
  await sleep(300)
  await shot('06-vai-junto-open')
  await card().getByRole('switch', { name: 'Log recente do app' }).click()
  if (await card().locator('pre').count()) throw new Error('log still shown when off')
  if (await logGoes()) throw new Error('summary still says the log goes')
  await area().fill('o áudio some quando compartilho a tela')
  const before = posts.length
  await sendBtn().click()
  await card().getByText('Recebido. Valeu, Ana!').waitFor({ timeout: 10_000 })
  const body = posts[before]
  if (!body || /name="log"/.test(body)) throw new Error('the log left the app')
  if (!/name="kind"\s+bug/.test(body) || !/"view":"home"/.test(body)) throw new Error(`body: ${body.slice(0, 300)}`)
  if (/spaceId|channelId|userId/.test(body)) throw new Error('an id in the context')
  const list = await mine(ana.token)
  if (list.length !== 1 || list[0].kind !== 'bug' || list[0].hasScreenshot) throw new Error(JSON.stringify(list))
  await closeCard()
})

await check('"Tirar print do app" captura a janela sem o cartão, e o print chega ao servidor', async () => {
  const reference = (await p.screenshot()).toString('base64') // the app without the card
  await openByCtrlK()
  await kind('Bug').click()
  const rect = await card().boundingBox()
  const withCard = (await p.screenshot()).toString('base64')
  await card().getByRole('button', { name: 'Tirar print do app' }).click()
  const thumb = card().getByRole('img', { name: 'Print que vai junto' })
  await thumb.waitFor({ timeout: 10_000 })
  // Mean color distance, inside the card's rectangle, between two pictures of the window.
  const diff = (a, b) => p.evaluate(async ([a, b, rect]) => {
    const load = async (src) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const k = img.naturalWidth / innerWidth
      const c = new OffscreenCanvas(Math.round(rect.width * k), Math.round(rect.height * k))
      const g = c.getContext('2d')
      g.drawImage(img, Math.round(rect.x * k), Math.round(rect.y * k), c.width, c.height, 0, 0, c.width, c.height)
      // Compare at a common small size: the two captures may differ in device scale.
      const s = new OffscreenCanvas(100, 100)
      s.getContext('2d').drawImage(c, 0, 0, 100, 100)
      return s.getContext('2d').getImageData(0, 0, 100, 100).data
    }
    const [x, y] = [await load(a), await load(b)]
    let sum = 0
    for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i])
    return sum / x.length
  }, [a, b, rect])
  const captured = await thumb.getAttribute('src')
  const clean = await diff(captured, `data:image/png;base64,${reference}`)
  const control = await diff(`data:image/png;base64,${withCard}`, `data:image/png;base64,${reference}`)
  if (!(clean < 4 && control > clean * 3)) throw new Error(`card in the print? distance ${clean.toFixed(2)} (with the card: ${control.toFixed(2)})`)
  await card().getByText('Confira: o print mostra o que estava na tela.').waitFor()
  await sleep(600)
  await shot('07-print-captured')
  await area().fill('a legenda some quando pauso o filme')
  await sendBtn().click()
  await card().getByText('Recebido. Valeu, Ana!').waitFor({ timeout: 10_000 })
  await card().hover() // the pointer over the card holds it open
  if ((await card().locator('[data-leaves]').count()) !== 1) throw new Error('no leaves on the sent pane')
  await sleep(1200)
  await shot('08-sent')
  const list = await mine(ana.token)
  if (list.length !== 2 || !list[0].hasScreenshot) throw new Error(JSON.stringify(list))
  return `distância ${clean.toFixed(2)} sem o cartão, ${control.toFixed(2)} com ele`
})

await check('"Seus envios" lista o que foi enviado, com "Recebido"', async () => {
  await card().getByRole('button', { name: 'Enviar outro' }).click()
  await card().getByRole('button', { name: 'Seus envios · 2' }).click()
  await card().getByRole('heading', { name: 'Seus envios' }).waitFor()
  const rows = card().getByRole('listitem')
  if ((await rows.count()) !== 2) throw new Error(`${await rows.count()} rows`)
  const first = await rows.first().innerText()
  if (!first.includes('a legenda some') || !first.includes('com print') || !first.includes('Recebido')) throw new Error(first)
  await sleep(400)
  await shot('09-mine')
  await card().getByRole('button', { name: 'Voltar' }).click()
  await area().waitFor()
})

await check('Enviar vazio: nada sai do app e o foco fica no campo', async () => {
  const before = posts.length
  await area().fill('   ')
  await sendBtn().click()
  await sleep(250)
  await shot('10-empty-send')
  await sleep(800)
  if (posts.length !== before) throw new Error('an empty feedback was posted')
  if (!(await area().evaluate((el) => el === document.activeElement))) throw new Error('focus left the field')
  if (await card().getByText('Recebido').count()) throw new Error('it claims to have sent')
  await area().fill('')
})

await check('Sem rede: o erro aparece no lugar, texto e print continuam, "Tentar de novo" envia', async () => {
  await kind('Travou').click()
  await area().fill('abri o Cinema e o app congelou')
  await card().getByRole('button', { name: 'Tirar print do app' }).click()
  await card().getByRole('img', { name: 'Print que vai junto' }).waitFor({ timeout: 10_000 })
  await p.route('**/api/v1/feedback', (r) => r.abort())
  await sendBtn().click()
  await card().getByRole('alert').filter({ hasText: 'Não foi possível falar com o servidor' }).waitFor({ timeout: 10_000 })
  if ((await area().inputValue()) !== 'abri o Cinema e o app congelou') throw new Error('the text was lost')
  if (!(await card().getByRole('img', { name: 'Print que vai junto' }).isVisible())) throw new Error('the screenshot was lost')
  await sleep(500)
  await shot('11-network-failure')
  await p.unroute('**/api/v1/feedback')
  await card().getByRole('button', { name: 'Tentar de novo' }).click()
  await card().getByText('Recebido. Valeu, Ana!').waitFor({ timeout: 10_000 })
  const list = await mine(ana.token)
  if (list.length !== 3 || list[0].kind !== 'crash' || !list[0].hasScreenshot) throw new Error(JSON.stringify(list))
  await closeCard()
})

await check('O rascunho sobrevive a fechar com Esc e a reiniciar o app', async () => {
  await openByCtrlK()
  await kind('Elogio').click()
  await area().fill('a sala de cinema ficou linda')
  await p.keyboard.press('Escape')
  await card().waitFor({ state: 'detached' })
  await p.reload()
  await login(ana)
  await openByCtrlK()
  if ((await area().inputValue()) !== 'a sala de cinema ficou linda') throw new Error(`text: "${await area().inputValue()}"`)
  if ((await kind('Elogio').getAttribute('aria-checked')) !== 'true') throw new Error('the kind was lost')
  await shot('12-draft-survives')
})

await check('Não é modal: com o cartão aberto dá para trocar de espaço e de canal', async () => {
  await p.getByRole('navigation', { name: 'Espaços' }).getByRole('button', { name: /^Turma da Ana/ }).click()
  await p.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: /geral/ }).first().click()
  await p.getByRole('complementary', { name: 'Canais' }).waitFor()
  if (!(await card().isVisible())) throw new Error('the card closed')
  if ((await area().inputValue()) !== 'a sala de cinema ficou linda') throw new Error('the draft was lost')
  await card().getByRole('button', { name: 'ver', exact: true }).click()
  await card().getByText('Um espaço').waitFor()
  await sleep(300)
  await shot('13-not-modal')
  await area().fill('')
  await closeCard()
})

await check('Em chamada: o cartão abre acima do painel de voz, sem cobrir os controles da chamada', async () => {
  const room = p.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: new RegExp(`^(Entrar em |Trocar para )?${voice.name}(, .*)?$`) }).first()
  await room.click()
  await sleep(600)
  await room.click()
  await p.getByText('Voz conectada').first().waitFor({ timeout: 30_000 })
  await openByCtrlK()
  await kind('Bug').click()
  await card().getByRole('button', { name: 'ver', exact: true }).click()
  await card().getByText('em chamada').waitFor()
  const box = await card().boundingBox()
  const dock = await p.locator('[data-user-dock]').boundingBox()
  if (box.y + box.height > dock.y) throw new Error('the card covers the voice panel')
  if (box.y < 40) throw new Error('the card goes under the title bar')
  for (const name of ['Desconectar', 'Desativar microfone']) {
    for (const b of await p.getByRole('button', { name }).all()) {
      const r = await b.boundingBox()
      if (r && overlap(box, r)) throw new Error(`the card covers "${name}"`)
    }
  }
  await sleep(500)
  await shot('14-in-call')
  await closeCard()
  await p.getByRole('button', { name: 'Desconectar' }).first().click()
  await sleep(800)
})

await check('Depois de um travamento: a oferta espera o momento calmo, abre em "Travou" com o log da sessão que caiu, e não volta', async () => {
  // A real second run of the app (so main.log has a previous session), then the note a crashed session leaves.
  await app.close()
  await launch({ wipe: false })
  await login(ana)
  await staysAway(offer(), 6000) // no crash, no offer
  writeFileSync(join(DATA, 'crash-marker.json'), JSON.stringify({ kind: 'unresponsive', at: Date.now() - 60_000, version: VERSION, pid: 1 }))
  await looking(false)
  await p.reload()
  await login(ana)
  await staysAway(offer(), 9000) // the window is not being looked at
  if (existsSync(join(DATA, 'crash-marker.json'))) throw new Error('the marker was not consumed')
  await looking(true)
  await offer().waitFor({ timeout: 15_000 })
  await sleep(500)
  await shot('15-crash-offer')
  await offer().getByRole('button', { name: 'Contar' }).click()
  await card().waitFor()
  if ((await kind('Travou').getAttribute('aria-checked')) !== 'true') throw new Error('not on "Travou"')
  await card().getByRole('button', { name: 'ver', exact: true }).click()
  await card().getByText('a janela parou de responder').waitFor()
  const log = await card().locator('pre').innerText()
  const starts = log.match(/ INFO start v/g)?.length ?? 0
  if (starts !== 1 || !/ INFO quit/.test(log)) throw new Error(`not the previous session's log (${starts} starts): ${log.slice(-200)}`)
  await sleep(300)
  await shot('15b-crash-card')
  await area().fill('estava vendo um filme e a janela parou')
  const before = posts.length
  await sendBtn().click()
  await card().getByText('Recebido. Valeu, Ana!').waitFor({ timeout: 10_000 })
  if (!/"crash":"unresponsive"/.test(posts[before] ?? '') || !/name="log"/.test(posts[before] ?? '')) throw new Error('crash context or log missing in the request')
  await closeCard()
  await p.reload()
  await login(ana)
  await staysAway(offer(), 9000)
})

await check('Menos movimento: envia sem folhas e com tudo visível', async () => {
  await p.emulateMedia({ reducedMotion: 'reduce' })
  await openByCtrlK()
  await kind('Ideia').click()
  await area().fill('queria fixar mensagens no canal')
  await sendBtn().click()
  await card().getByText('Recebido. Valeu, Ana!').waitFor({ timeout: 10_000 })
  await card().hover()
  if (await card().locator('[data-leaves]').count()) throw new Error('leaves under reduced motion')
  await sleep(300)
  await shot('16-reduced-motion')
  await closeCard()
  await p.emulateMedia({ reducedMotion: null })
})

await check('As outras duas entradas abrem o mesmo cartão: menu do usuário e Configurações › Avançado', async () => {
  await p.locator('[data-user-dock] button[aria-haspopup="dialog"]').click()
  const item = p.getByRole('button', { name: 'Enviar feedback', exact: true })
  await item.waitFor()
  await sleep(300)
  await shot('17-user-menu')
  await item.click()
  await card().waitFor()
  await closeCard()
  await p.keyboard.press('Control+,')
  const settings = p.getByRole('dialog', { name: 'Configurações' })
  await settings.getByRole('button', { name: 'Avançado' }).click()
  const row = settings.getByRole('button', { name: 'Enviar feedback', exact: true })
  await row.scrollIntoViewIfNeeded()
  await sleep(300)
  await shot('18-settings-row')
  await row.click()
  await card().waitFor()
  await settings.waitFor({ state: 'detached', timeout: 5000 })
  await closeCard()
})

await check('O servidor guardou cada envio uma vez, só para quem enviou', async () => {
  const list = await mine(ana.token)
  const kinds = list.map((f) => f.kind).join(',')
  if (kinds !== 'idea,crash,crash,bug,bug') throw new Error(kinds)
  const other = await account('bia', 'Bia Vizinha')
  if ((await mine(other.token)).length) throw new Error('someone else sees them')
  return kinds
})

writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), version: VERSION, results }, null, 2))
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (!KEEP) {
  await app.close().catch(() => undefined)
  Q.stopAll()
}
process.exit(failed.length ? 1 : 0)
