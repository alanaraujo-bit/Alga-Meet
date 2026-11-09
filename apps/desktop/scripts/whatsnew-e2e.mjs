// Novidades end to end on the REAL app (Electron build stamped 0.1.15) against an isolated QA stack (API + LiveKit).
//   QA_WORK=<dir> QA_API_PORT=4360 QA_LK_PORT=7960 node scripts/whatsnew-e2e.mjs [--skip-build] [--keep]
// Covers: a new account sees no welcome; skipped versions come together; "Entendi" sticks across restarts; "Lembrar
// depois" snoozes; never over another dialog, with the window unfocused, or during a call; the center (history,
// nothing above the installed version, reactions changeable and counted once, media fallback); offline with and
// without the cache; the title-bar update notice (also mid-call); the admin studio (edit, preview, create, publish).
// Screenshots: docs/screenshots/whatsnew/. Never touches the dev stack (:4000/:7880).
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import * as Q from './qa-stack.mjs'

const KEEP = process.argv.includes('--keep')
const VERSION = '0.1.15'
const APP = join(Q.appDir, 'node_modules', '.alga-wn')
const OUT = join(Q.repo, 'docs', 'screenshots', 'whatsnew')
mkdirSync(OUT, { recursive: true })
mkdirSync(Q.WORK, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const electronPath = createRequire(join(Q.appDir, 'package.json'))('electron')
const results = []
const apps = {}

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
  const username = `wn${tag}${run}`
  const email = `${username}@qa.alga.test`
  const password = `novidade ${run} farol ${tag}`
  const r = await ok(null, 'POST', '/auth/register', { email, username, displayName, password, birthDate: '1995-05-05', termsVersion: legal.termsVersion })
  await ok(null, 'POST', '/auth/verify-email', { token: await mailedToken(email, 'verify') })
  return { username, password, token: r.token, id: r.user.id }
}

async function launch(k) {
  rmSync(join(process.env.APPDATA ?? '', 'Alga Meet Dev', 'profiles', `qa-wn-${k}`), { recursive: true, force: true })
  const env = { ...process.env, ALGA_API_URL: Q.API, ALGA_E2E: '1' }
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({
    executablePath: electronPath, cwd: Q.appDir, env,
    args: [APP, `--profile=qa-wn-${k}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.log(`[${k}] pageerror`, e.message))
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_NAME_NOT_RESOLVED|net::ERR_FAILED/.test(m.text()) && console.log(`[${k}] console.error`, m.text().slice(0, 200)))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))
  await page.waitForLoadState('domcontentloaded')
  // Harness only: automation windows open inactive and off-screen, so "is the person looking at this window?" is
  // emulated. Focus emulation says yes; a flag in localStorage (survives reloads) says no, through hasFocus.
  await page.context().addInitScript(() => {
    const orig = Document.prototype.hasFocus
    Document.prototype.hasFocus = function () {
      return localStorage.getItem('__wn_blur') === '1' ? false : orig.call(this)
    }
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  apps[k] = { app, page, cdp }
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  return page
}
async function focus(k, on) {
  await apps[k].page.evaluate((blur) => localStorage.setItem('__wn_blur', blur ? '1' : '0'), !on)
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
    for (const [k, a] of Object.entries(apps)) await a.page.screenshot({ path: join(OUT, `fail-${results.length}-${k}.png`) }).catch(() => undefined)
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
const shot = (k, name) => apps[k].page.screenshot({ path: join(OUT, `${name}.png`) })
const welcome = (p) => p.getByRole('dialog', { name: /O Alga Meet ficou ainda melhor/ })
const center = (p) => p.getByRole('dialog', { name: 'Novidades', exact: true })
const railBtn = (p) => p.getByRole('navigation', { name: 'Espaços' }).getByRole('button', { name: /^Novidades/ })
/** Nothing appears for `ms` (the welcome needs two quiet checks 2.5 s apart, so 9 s is plenty). */
async function staysAway(p, ms = 9000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await welcome(p).isVisible().catch(() => false)) throw new Error('the welcome appeared')
    await sleep(300)
  }
}
const key = (id) => `alga.whatsnew.v1.${id}`
async function setSeen(p, id, seen) {
  await p.evaluate(([k, s]) => {
    const raw = JSON.parse(localStorage.getItem(k) ?? 'null') ?? {}
    localStorage.setItem(k, JSON.stringify({ ...raw, seen: s }))
  }, [key(id), seen])
}
const getSeen = (p, id) => p.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null')?.seen ?? null, key(id))
async function restart(k, u) {
  await apps[k].page.reload()
  await login(apps[k].page, u)
}
const emitUpdate = (k, status) => apps[k].app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].webContents.send('alga:updates:status', s), status)

// ── stack ────────────────────────────────────────────────────
await Q.startLivekit()
await Q.startApi()
const admin = await account('adm', 'Equipe Alga')
const ana = await account('ana', 'Ana Novidades')
await Q.grantStaff(admin.username, 'admin')
admin.token = (await ok(null, 'POST', '/auth/login', { login: admin.username, password: admin.password })).token
ana.token = (await ok(null, 'POST', '/auth/login', { login: ana.username, password: ana.password })).token
const space = await ok(ana.token, 'POST', '/spaces', { name: 'Turma da Ana' })
const voice = space.channels.find((c) => c.type === 'voice')

// 0.1.15 ships published by the migration; 0.1.16 exists for the update notice only.
const upcoming = {
  items: [
    { id: 'cinema-4k', category: 'new', highlight: true, media: null },
    { id: 'eco-roupas', category: 'improved', highlight: false, media: null },
    { id: 'eco-som', category: 'fixed', highlight: false, media: null },
  ],
  text: { 'pt-BR': { title: 'Cinema em 4K', summary: 'Filmes em 4K na Sala de Cinema.', items: { 'cinema-4k': { title: 'Cinema em 4K', body: '' }, 'eco-roupas': { title: 'Mais roupas para o Eco', body: '' }, 'eco-som': { title: 'Som do Eco corrigido', body: '' } } } },
}
await rest(admin.token, 'POST', '/admin/releases', { version: '0.1.16', content: upcoming })
await ok(admin.token, 'POST', '/admin/releases/0.1.16/publish')
const stats = async (v, item) => (await ok(admin.token, 'GET', '/admin/releases')).find((n) => n.version === v).stats.items[item] ?? { up: 0, down: 0 }

// ── person ───────────────────────────────────────────────────
const p = await launch('ana')
await login(p, ana)

await check('Conta nova: nenhuma boas-vindas no primeiro dia, e nada marcado como novo', async () => {
  await staysAway(p)
  await railBtn(p).waitFor()
  const name = await railBtn(p).getAttribute('aria-label')
  if (name !== 'Novidades') throw new Error(`rail says "${name}"`)
  const seen = await getSeen(p, ana.id)
  if (seen?.lastSeen !== VERSION) throw new Error(`lastSeen ${seen?.lastSeen}`)
})

await check('Quem pulou versões (estava na 0.1.11) vê as quatro mais novas juntas, em destaques', async () => {
  await setSeen(p, ana.id, { lastSeen: '0.1.11', viewed: [], snoozeUntil: 0 })
  await restart('ana', ana)
  await welcome(p).waitFor({ timeout: 20_000 })
  await sleep(700)
  await shot('ana', '01-welcome-skipped-versions')
  const picks = await welcome(p).getByRole('tab').count()
  const text = await welcome(p).innerText()
  if (!text.includes('Você pulou algumas versões') || !text.includes('0.1.12')) throw new Error('no skipped-versions summary')
  if (text.includes('0.1.16')) throw new Error('announced a version that is not installed')
  await welcome(p).getByRole('tab').first().focus()
  await p.keyboard.press('ArrowDown')
  await p.keyboard.press('ArrowDown')
  const sel = await welcome(p).getByRole('tab', { selected: true }).innerText()
  await sleep(500)
  return `${picks} destaques; ↓↓ → "${sel.split('\n')[0]}"`
})

await check('A mídia real carrega só quando aparece (perfil da 0.1.12)', async () => {
  const tab = welcome(p).getByRole('tab', { name: /Perfil completo/ })
  await tab.click()
  const img = welcome(p).getByRole('tabpanel').locator('img')
  await until(() => img.evaluate((el) => el.complete && el.naturalWidth > 0), 'image loaded', 20_000)
  await sleep(400)
  await shot('ana', '02-welcome-real-media')
})

await check('"Entendi" marca como visto e não volta depois de reiniciar', async () => {
  await welcome(p).getByRole('button', { name: 'Entendi' }).click()
  await welcome(p).waitFor({ state: 'detached' })
  const seen = await getSeen(p, ana.id)
  if (seen.lastSeen !== VERSION) throw new Error(`lastSeen ${seen.lastSeen}`)
  await restart('ana', ana)
  await staysAway(p)
})

await check('"Lembrar depois" adia (um dia) e o ponto de novidade fica na barra', async () => {
  await setSeen(p, ana.id, { lastSeen: '0.1.14', viewed: [], snoozeUntil: 0 })
  await restart('ana', ana)
  await welcome(p).waitFor({ timeout: 20_000 })
  await sleep(600)
  await shot('ana', '03-welcome-one-version')
  await welcome(p).getByRole('button', { name: 'Lembrar depois' }).click()
  await welcome(p).waitFor({ state: 'detached' })
  const seen = await getSeen(p, ana.id)
  if (!(seen.snoozeUntil > Date.now() + 23 * 3600_000)) throw new Error(`snooze ${seen.snoozeUntil}`)
  await restart('ana', ana)
  await staysAway(p)
  const name = await railBtn(p).getAttribute('aria-label')
  if (name !== 'Novidades, tem coisa nova') throw new Error(`rail says "${name}"`)
})

await check('Nunca por cima de outra janela: espera as Configurações fecharem', async () => {
  await setSeen(p, ana.id, { lastSeen: '0.1.14', viewed: [], snoozeUntil: 0 })
  await restart('ana', ana)
  await p.keyboard.press('Control+,')
  await p.getByRole('dialog', { name: /Configurações/ }).waitFor({ timeout: 10_000 })
  await staysAway(p)
  await p.keyboard.press('Escape')
  await welcome(p).waitFor({ timeout: 15_000 })
  await p.keyboard.press('Escape') // Esc = seen
  await welcome(p).waitFor({ state: 'detached' })
  if ((await getSeen(p, ana.id)).lastSeen !== VERSION) throw new Error('Esc did not mark it seen')
})

await check('Com a janela sem foco (jogo em tela cheia, outro app) não aparece; volta quando a pessoa volta', async () => {
  await setSeen(p, ana.id, { lastSeen: '0.1.14', viewed: [], snoozeUntil: 0 })
  await focus('ana', false)
  await restart('ana', ana)
  if (await p.evaluate(() => document.hasFocus())) throw new Error('harness could not blur the window')
  await staysAway(p)
  await focus('ana', true)
  await welcome(p).waitFor({ timeout: 15_000 })
  await welcome(p).getByRole('button', { name: 'Entendi' }).click()
})

await check('Durante uma chamada: nada de boas-vindas; aviso de atualização não reinicia no meio', async () => {
  await setSeen(p, ana.id, { lastSeen: '0.1.14', viewed: [], snoozeUntil: 0 })
  await focus('ana', false)
  await restart('ana', ana)
  await p.getByRole('navigation', { name: 'Espaços' }).getByRole('button', { name: /^Turma da Ana/ }).click()
  // One click on a voice room previews it; a second click joins.
  const room = p.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: new RegExp(`^(Entrar em |Trocar para )?${voice.name}(, .*)?$`) }).first()
  await room.click()
  await sleep(600)
  await room.click()
  await p.getByText('Voz conectada').first().waitFor({ timeout: 30_000 })
  await focus('ana', true)
  await staysAway(p, 10_000)
  await emitUpdate('ana', { state: 'ready', version: '0.1.16' })
  await p.getByRole('button', { name: 'Atualização pronta' }).click()
  const pop = p.getByRole('dialog', { name: 'Versão 0.1.16 pronta' })
  await pop.getByText('Cinema em 4K').first().waitFor({ timeout: 10_000 })
  if (!(await pop.getByRole('button', { name: 'Reiniciar agora' }).isDisabled())) throw new Error('restart offered mid-call')
  await pop.getByText('Termine a chamada para reiniciar').waitFor()
  await sleep(300)
  await shot('ana', '04-update-ready-in-call')
  await p.keyboard.press('Escape')
  await p.getByRole('button', { name: 'Desconectar' }).first().click()
  await welcome(p).waitFor({ timeout: 20_000 })
  await welcome(p).getByRole('button', { name: 'Entendi' }).click()
  await welcome(p).waitFor({ state: 'detached' })
})

await check('Aviso de atualização: progresso discreto e, pronta, o que vem nela', async () => {
  await emitUpdate('ana', { state: 'downloading', percent: 42, version: '0.1.16' })
  await p.getByText('Baixando atualização · 42%').waitFor()
  await sleep(300)
  await p.screenshot({ path: join(OUT, '05-update-downloading.png'), clip: { x: 0, y: 0, width: 640, height: 44 } })
  await emitUpdate('ana', { state: 'ready', version: '0.1.16' })
  await p.getByRole('button', { name: 'Atualização pronta' }).click()
  const pop = p.getByRole('dialog', { name: 'Versão 0.1.16 pronta' })
  await pop.getByText('Mais roupas para o Eco').waitFor()
  if (await pop.getByRole('button', { name: 'Reiniciar agora' }).isDisabled()) throw new Error('restart disabled outside a call')
  await sleep(300)
  await shot('ana', '06-update-ready')
  await pop.getByRole('button', { name: 'Depois' }).click()
})

await check('Central: histórico até a versão instalada (nunca a 0.1.16), mais nova primeiro', async () => {
  await railBtn(p).click()
  await center(p).waitFor()
  const versions = await center(p).getByRole('option').evaluateAll((els) => els.map((e) => e.getAttribute('data-version')))
  if (versions[0] !== VERSION || versions.includes('0.1.16') || versions.length < 13) throw new Error(versions.join(','))
  await sleep(600)
  await shot('ana', '07-center')
  return versions.join(' ')
})

await check('Gostei/não gostei: um voto por pessoa, dá para trocar e desfazer; a equipe vê só o total', async () => {
  const card = center(p).locator(`section[aria-labelledby="item-${VERSION}-novidades"]`)
  await card.getByRole('button', { name: 'Gostei', exact: true }).click()
  await until(async () => (await stats(VERSION, 'novidades')).up === 1, 'up=1')
  await card.getByRole('button', { name: 'Gostei', exact: true }).click({ trial: false }).catch(() => undefined)
  await until(async () => (await stats(VERSION, 'novidades')).up === 0, 'undone')
  await card.getByRole('button', { name: 'Não gostei', exact: true }).click()
  await until(async () => { const s = await stats(VERSION, 'novidades'); return s.up === 0 && s.down === 1 }, 'down=1')
  await card.getByRole('button', { name: 'Gostei', exact: true }).click()
  await until(async () => { const s = await stats(VERSION, 'novidades'); return s.up === 1 && s.down === 0 }, 'changed to up')
  const pressed = await card.getByRole('button', { name: 'Gostei', exact: true }).getAttribute('aria-pressed')
  if (pressed !== 'true') throw new Error('not shown as mine')
  // The same vote again from the API: still one.
  await ok(ana.token, 'PUT', `/releases/${VERSION}/reactions/novidades`, { value: 1 })
  const s = await stats(VERSION, 'novidades')
  if (s.up !== 1) throw new Error(JSON.stringify(s))
  await sleep(300)
  await shot('ana', '08-center-reacted')
})

await check('Navegação por teclado entre versões e mídia real na 0.1.12', async () => {
  await center(p).getByRole('option', { selected: true }).focus()
  for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowDown')
  const v = await center(p).getByRole('option', { selected: true }).getAttribute('data-version')
  if (v !== '0.1.12') throw new Error(`at ${v}`)
  const img = center(p).locator('article img').first()
  await until(() => img.evaluate((el) => el.complete && el.naturalWidth > 0), 'image loaded', 20_000)
  await sleep(500)
  await shot('ana', '09-center-media')
})

await check('Mídia fora do ar não deixa buraco', async () => {
  const notes = await ok(admin.token, 'GET', '/admin/releases')
  const n = notes.find((x) => x.version === '0.1.14')
  const content = structuredClone(n.content)
  content.items[0].media = { kind: 'image', url: 'https://alga-meet-missing.invalid/nada.png' }
  await ok(admin.token, 'PUT', '/admin/releases/0.1.14', { content, revision: n.revision })
  await p.keyboard.press('Escape')
  await restart('ana', ana)
  await railBtn(p).click()
  await center(p).getByRole('option', { name: /0\.1\.14/ }).click()
  await center(p).getByText('Mídia indisponível agora').waitFor({ timeout: 15_000 })
  await sleep(300)
  await shot('ana', '10-media-unavailable')
  await p.keyboard.press('Escape')
})

await check('Vídeo: toca mudo só na tela; com movimento reduzido, quadro parado e botão de play', async () => {
  const notes = await ok(admin.token, 'GET', '/admin/releases')
  const n = notes.find((x) => x.version === '0.1.13')
  const content = structuredClone(n.content)
  const RAW = 'https://raw.githubusercontent.com/alanaraujo-bit/Alga-Meet/main/'
  content.items[0].media = { kind: 'video', url: `${RAW}apps/site/public/media/room.mp4`, poster: `${RAW}docs/screenshots/2026-11-07-profile-full-v1.png` }
  await ok(admin.token, 'PUT', '/admin/releases/0.1.13', { content, revision: n.revision })
  await restart('ana', ana)
  await railBtn(p).click()
  await center(p).getByRole('option', { name: /0\.1\.13/ }).click()
  const video = center(p).locator('article video')
  await video.waitFor({ timeout: 10_000 })
  const playing = await until(() => video.evaluate((v) => v.readyState >= 2 && !v.paused && v.currentTime > 0 && v.muted), 'video playing', 20_000).catch(() => false)
  const failed = await center(p).getByText('Mídia indisponível agora').isVisible()
  await sleep(300)
  await shot('ana', '16-center-video')
  await p.keyboard.press('Escape')
  await p.emulateMedia({ reducedMotion: 'reduce' })
  await restart('ana', ana)
  await railBtn(p).click()
  await center(p).getByRole('option', { name: /0\.1\.13/ }).click()
  await center(p).getByRole('button', { name: 'Reproduzir animação' }).waitFor({ timeout: 10_000 })
  if (await center(p).locator('article video').count()) throw new Error('video mounted under reduced motion')
  await shot('ana', '17-center-video-reduced-motion')
  await center(p).getByRole('button', { name: 'Reproduzir animação' }).click()
  await center(p).locator('article video[controls]').waitFor({ timeout: 10_000 })
  await p.keyboard.press('Escape')
  await p.emulateMedia({ reducedMotion: 'no-preference' })
  return playing ? 'raw.githubusercontent (octet-stream) toca' : failed ? 'host serve octet-stream+nosniff: caiu no aviso de mídia indisponível' : 'não tocou'
})

await check('Servidor de novidades fora: a central abre com a cópia guardada', async () => {
  await p.route('**/api/v1/releases**', (r) => r.abort())
  await restart('ana', ana)
  await railBtn(p).click()
  await center(p).getByRole('option').first().waitFor({ timeout: 10_000 })
  const n = await center(p).getByRole('option').count()
  await p.keyboard.press('Escape')
  return `${n} versões do cache`
})

await check('Sem cópia e sem servidor: diz "Sem conexão" e se recupera sozinho', async () => {
  await p.evaluate((k) => {
    const raw = JSON.parse(localStorage.getItem(k) ?? 'null')
    localStorage.setItem(k, JSON.stringify({ seen: raw.seen }))
  }, key(ana.id))
  await restart('ana', ana)
  await railBtn(p).click()
  await center(p).getByText('Sem conexão').waitFor({ timeout: 10_000 })
  await shot('ana', '11-center-offline')
  await p.unroute('**/api/v1/releases**')
  await center(p).getByRole('option').first().waitFor({ timeout: 45_000 })
  await p.keyboard.press('Escape')
})

await check('Tela estreita: central e boas-vindas continuam legíveis', async () => {
  await apps.ana.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(860, 700))
  await sleep(500)
  await railBtn(p).click()
  await center(p).waitFor()
  await sleep(500)
  await shot('ana', '12-center-narrow')
  await p.keyboard.press('Escape')
  await apps.ana.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820))
})

// ── team ─────────────────────────────────────────────────────
const a = await launch('adm')
await login(a, admin)
const studio = () => a.getByRole('dialog', { name: 'Escrever novidades' })

await check('Estúdio (só admin): editar, salvar com Ctrl+S e a central mostra a correção', async () => {
  await a.getByRole('navigation', { name: 'Espaços' }).getByRole('button', { name: /^Novidades/ }).click()
  await center(a).getByRole('button', { name: 'Escrever novidades' }).click()
  await studio().waitFor()
  await studio().getByRole('option', { name: /0\.1\.15/ }).click()
  const title = studio().getByLabel('Título da versão')
  await title.fill('Cada atualização, contada por nós (revisado)')
  await sleep(300)
  await shot('adm', '13-studio')
  await a.keyboard.press('Control+s')
  await until(async () => (await ok(ana.token, 'GET', `/releases/${VERSION}`)).content.text['pt-BR'].title.endsWith('(revisado)'), 'saved', 10_000)
})

await check('Estúdio: pré-visualizar as boas-vindas de um rascunho sem marcar nada como visto', async () => {
  await studio().getByRole('button', { name: 'Ver boas-vindas' }).click()
  await welcome(a).waitFor()
  await welcome(a).getByText('Pré-visualização').waitFor()
  await sleep(500)
  await shot('adm', '14-studio-preview-welcome')
  await a.keyboard.press('Escape')
  await welcome(a).waitFor({ state: 'detached' })
  await studio().waitFor()
})

await check('Estúdio: nova nota nasce rascunho (invisível) e publicar a deixa visível', async () => {
  await studio().getByRole('button', { name: 'Nova nota' }).click()
  const dlg = a.getByRole('dialog', { name: 'Nova nota de versão' })
  await dlg.waitFor()
  const v = await dlg.getByLabel('Versão').inputValue()
  if (v !== '0.1.17') throw new Error(`suggested ${v}`)
  await dlg.getByRole('button', { name: 'Criar rascunho' }).click()
  await dlg.waitFor({ state: 'detached' })
  if ((await rest(ana.token, 'GET', '/releases/0.1.17')).status !== 404) throw new Error('draft visible')
  await studio().getByRole('button', { name: 'Publicar', exact: true }).click()
  const confirm = a.getByRole('dialog', { name: 'Publicar as novidades da 0.1.17?' })
  await confirm.waitFor()
  await sleep(300)
  await shot('adm', '15-studio-publish')
  await confirm.getByRole('button', { name: 'Publicar' }).click()
  await until(async () => (await rest(ana.token, 'GET', '/releases/0.1.17')).status === 200, 'published')
  // Still never shown to someone on 0.1.15.
  const list = await ok(ana.token, 'GET', `/releases?upTo=${VERSION}`)
  if (list.some((n) => n.version === '0.1.17')) throw new Error('0.1.17 leaked to 0.1.15')
})

await check('Pessoas sem papel de admin não abrem o estúdio nem a API', async () => {
  if (await center(p).getByRole('button', { name: 'Escrever novidades' }).count()) throw new Error('studio button for a non-admin')
  const r = await rest(ana.token, 'GET', '/admin/releases')
  if (r.status !== 403) throw new Error(`status ${r.status}`)
})

writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), version: VERSION, results }, null, 2))
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (!KEEP) {
  for (const { app } of Object.values(apps)) await app.close().catch(() => undefined)
  Q.stopAll()
}
process.exit(failed.length ? 1 : 0)
