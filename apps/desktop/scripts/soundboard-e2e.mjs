// Soundboard end to end on two REAL app instances (profiles qa-sb-a, qa-sb-b) against the isolated QA stack.
//   node scripts/qa-stack.mjs build && node scripts/qa-stack.mjs start
//   node scripts/soundboard-e2e.mjs [--keep]      (--keep: leave both windows open for a human look)
//   node scripts/qa-stack.mjs stop
// A uploads a sound through the editor, B sees it arrive; A plays it and B's renderer really starts it (counted by a
// harness-only wrapper around AudioBufferSourceNode.start, never product code); cooldown is shown and enforced by the
// server; B muting the soundboard or deafening hears nothing but still gets the "who played" announcement; deleting
// removes it for B. Screenshots: docs/screenshots/soundboard/. Never touches the dev stack (:4000/:7880).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import * as Q from './qa-stack.mjs'

const KEEP = process.argv.includes('--keep')
const OUT = join(Q.repo, 'docs', 'screenshots', 'soundboard')
mkdirSync(OUT, { recursive: true })
mkdirSync(Q.WORK, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const electronPath = createRequire(join(Q.appDir, 'package.json'))('electron')
const results = []
const apps = {}

async function rest(token, method, path, body) {
  const res = await fetch(`${Q.API}/api/v1${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  return { status: res.status, data }
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

/** 8 s test clip: 1 s of silence, then a rising tone with a pulse (a trim has something to find). */
function fixture() {
  const p = join(Q.WORK, 'soundboard-fixture.wav')
  const rate = 44100
  const n = rate * 8
  const b = Buffer.alloc(44 + n * 4)
  b.write('RIFF', 0); b.writeUInt32LE(b.length - 8, 4); b.write('WAVE', 8)
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22)
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i++) {
    const tt = i / rate
    const v = tt < 1 ? 0 : 0.4 * Math.sin(2 * Math.PI * (220 + 60 * tt) * tt) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * tt))
    const s = Math.round(v * 32767)
    b.writeInt16LE(s, 44 + i * 4)
    b.writeInt16LE(s, 46 + i * 4)
  }
  writeFileSync(p, b)
  return p
}

async function account(tag) {
  const legal = await ok(null, 'GET', '/legal')
  const run = Math.random().toString(36).slice(2, 6)
  const username = `sb${tag}${run}`
  const email = `${username}@qa.alga.test`
  const password = `som ${run} farol aceso ${tag}`
  const r = await ok(null, 'POST', '/auth/register', { email, username, displayName: tag === 'a' ? 'Ana Som' : 'Bruno Som', password, birthDate: '1995-05-05', termsVersion: legal.termsVersion })
  await ok(null, 'POST', '/auth/verify-email', { token: await mailedToken(email, 'verify') })
  return { username, password, token: r.token, id: r.user.id }
}

const AUDIO_HOOK = () => {
  // Harness only: counts real starts of decoded sounds (the soundboard player and the editor preview use buffer
  // sources; UI cues are oscillators).
  window.__sbStarts = []
  const orig = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (...a) {
    window.__sbStarts.push({ at: Date.now(), ms: Math.round((this.buffer?.duration ?? 0) * 1000) })
    return orig.apply(this, a)
  }
}

async function launch(k, x) {
  // Fresh profile every run: the accounts are new each time.
  rmSync(join(process.env.APPDATA ?? '', 'Alga Meet Dev', 'profiles', `qa-sb-${k}`), { recursive: true, force: true })
  const env = { ...process.env, ALGA_API_URL: Q.API, ALGA_E2E: '1' }
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({
    executablePath: electronPath, cwd: Q.appDir, env,
    args: [Q.QA_APP, `--profile=qa-sb-${k}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required'],
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.log(`[${k}] pageerror`, e.message))
  page.on('console', (m) => m.type() === 'error' && console.log(`[${k}] console.error`, m.text().slice(0, 200)))
  await page.context().addInitScript(AUDIO_HOOK)
  await app.evaluate(({ BrowserWindow }, o) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(1180, 780); w.setPosition(30 + o, 30) }, x)
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

async function check(name, fn) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    results.push({ name, pass: true, ms: Date.now() - t0, detail: detail ?? null })
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (e) {
    results.push({ name, pass: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 400) })
    console.log(`FAIL ${name} — ${e?.message ?? e}`)
    for (const [k, a] of Object.entries(apps)) await a.page.screenshot({ path: join(OUT, `fail-${results.length}-${k}.png`) }).catch(() => undefined)
  }
}
const until = async (fn, what, timeout = 10_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const v = await fn()
    if (v) return v
    await sleep(150)
  }
  throw new Error(`timeout: ${what}`)
}
const starts = (page) => page.evaluate(() => window.__sbStarts.length)
const shot = (k, name) => apps[k].page.screenshot({ path: join(OUT, `${name}.png`) })
const dock = (page) => page.getByRole('toolbar', { name: 'Controles da chamada' })
const panel = (page) => page.getByRole('dialog', { name: 'Soundboard' })
async function openPanel(page) {
  if (await panel(page).isVisible().catch(() => false)) return panel(page)
  await dock(page).getByRole('button', { name: 'Soundboard' }).click()
  await panel(page).waitFor()
  return panel(page)
}
async function closePanel(page) {
  if (await panel(page).isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await panel(page).waitFor({ state: 'detached' })
  }
}

// ── run ──────────────────────────────────────────────────────
if (!(await fetch(`${Q.API}/api/v1/health`).then((r) => r.ok, () => false))) throw new Error('QA stack down: node scripts/qa-stack.mjs start')
const A = await account('a')
const B = await account('b')
const space = await ok(A.token, 'POST', '/spaces', { name: `Sons ${Date.now() % 10000}` })
const invite = await ok(A.token, 'POST', `/spaces/${space.id}/invites`, {})
await ok(B.token, 'POST', `/invites/${invite.code}`)
const voice = space.channels.find((c) => c.type === 'voice')
const FILE = fixture()
let sound = null

const pa = await launch('a', 0)
const pb = await launch('b', 600)
await login(pa, A)
await login(pb, B)

async function joinVoice(page) {
  await page.getByRole('navigation', { name: 'Espaços' }).getByRole('button', { name: new RegExp(`^${space.name}`) }).click()
  await page.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: new RegExp(`^(Entrar em |Trocar para )?${voice.name}(, .*)?$`) }).first().click()
  await page.getByText('Voz conectada').first().waitFor({ timeout: 30_000 })
}

await check('A e B entram na call; o botão Soundboard aparece no dock', async () => {
  await joinVoice(pa)
  await joinVoice(pb)
  await dock(pa).getByRole('button', { name: 'Soundboard' }).waitFor()
})

await check('Painel vazio para quem gerencia: convite para adicionar', async () => {
  const p = await openPanel(pa)
  await p.getByRole('button', { name: 'Adicionar som' }).waitFor()
  await shot('a', '01-panel-empty')
})

await check('A sobe um som pelo editor: arquivo de 8 s, corta, nomeia e salva', async () => {
  await panel(pa).getByRole('button', { name: 'Adicionar som' }).click()
  const dlg = pa.getByRole('dialog', { name: 'Novo som' })
  await dlg.waitFor()
  await shot('a', '02-editor-drop')
  await dlg.locator('input[type=file]').setInputFiles(FILE)
  await dlg.getByRole('slider', { name: 'Fim do trecho' }).waitFor({ timeout: 15_000 })
  const end = dlg.getByRole('slider', { name: 'Fim do trecho' })
  const before = Number(await end.getAttribute('aria-valuenow'))
  await end.focus()
  for (let i = 0; i < 15; i++) await pa.keyboard.press('Shift+ArrowLeft') // −1.5 s
  const after = Number(await end.getAttribute('aria-valuenow'))
  if (!(before - after >= 1400)) throw new Error(`end handle did not move: ${before} → ${after}`)
  await dlg.getByRole('button', { name: 'Ouvir trecho' }).click()
  await until(async () => (await starts(pa)) > 0, 'preview started')
  await shot('a', '03-editor-trim')
  await dlg.getByLabel('Nome').fill('Sirene da vitória')
  await dlg.getByRole('button', { name: 'Salvar som' }).click()
  await dlg.waitFor({ state: 'detached', timeout: 15_000 })
  const list = await ok(A.token, 'GET', `/spaces/${space.id}/sounds`)
  sound = list[0]
  if (!sound || sound.name !== 'Sirene da vitória') throw new Error(`server list: ${JSON.stringify(list)}`)
  if (sound.durationMs > 5000 || sound.durationMs < 3000) throw new Error(`duration ${sound.durationMs}`)
  return `${sound.durationMs} ms no servidor`
})

await check('B vê o som chegar no painel sem recarregar', async () => {
  const p = await openPanel(pb)
  await p.getByRole('button', { name: `Tocar ${sound.name} para todos` }).waitFor({ timeout: 8000 })
  await shot('b', '04-panel-member')
})

await check('A toca: o som sai no app de B e A entra em cooldown', async () => {
  const b0 = await starts(pb)
  const a0 = await starts(pa)
  const p = await openPanel(pa)
  const t0 = Date.now()
  await p.getByRole('button', { name: `Tocar ${sound.name} para todos` }).click()
  await until(async () => (await starts(pb)) > b0, 'B started the sound', 5000)
  const latency = Date.now() - t0
  await until(async () => (await starts(pa)) > a0, 'A hears own sound', 3000)
  const played = await pb.evaluate(() => window.__sbStarts.at(-1).ms)
  if (Math.abs(played - sound.durationMs) > 30) throw new Error(`B played ${played} ms, sound is ${sound.durationMs} ms`)
  await sleep(400)
  await shot('a', '05-playing')
  await until(() => pa.locator('[data-state=cooldown]').count(), 'tiles in cooldown', sound.durationMs + 1500)
  await shot('a', '06-cooldown')
  return `clique → B tocando em ${latency} ms`
})

await check('B ouve o anúncio "Ana Som tocou Sirene da vitória"', async () => {
  await until(async () => (await pb.getByRole('status').allTextContents()).some((t) => t.includes('tocou Sirene da vitória')), 'announcement')
})

await check('Servidor impõe o cooldown (429 com retryAfterMs)', async () => {
  const r = await rest(A.token, 'POST', `/channels/${voice.id}/soundboard/play`, { soundId: sound.id })
  if (r.status !== 429 || !(r.data?.error?.retryAfterMs > 0)) throw new Error(`${r.status} ${JSON.stringify(r.data)}`)
  return `retryAfterMs ${r.data.error.retryAfterMs}`
})

/** A's own panel open and every tile back to ready (the client and the server agree on the cooldown). */
const waitReady = async () => {
  await openPanel(pa)
  await until(async () => (await pa.locator('[data-state=cooldown], [data-state=playing]').count()) === 0, 'cooldown over', 12_000)
}
/** A plays and B's announcement proves the server fanned it out (so "B did not hear" is not vacuous). */
async function aPlays() {
  const before = await pb.evaluate(() => [...document.querySelectorAll('[role=status]')].map((e) => e.textContent).join('|'))
  await (await openPanel(pa)).getByRole('button', { name: `Tocar ${sound.name} para todos` }).click()
  await until(async () => {
    const now = await pb.evaluate(() => [...document.querySelectorAll('[role=status]')].map((e) => e.textContent).join('|'))
    return now !== before && now.includes('tocou')
  }, 'B got the SOUNDBOARD_PLAY announcement', 4000)
  if (await pa.getByText('Calma aí').count()) throw new Error('A was told to wait although the tiles looked ready')
}

await check('B silencia o soundboard: não ouve, mas vê quem tocou', async () => {
  const p = await openPanel(pb)
  await p.getByRole('switch', { name: 'Silenciar soundboard' }).click()
  await shot('b', '07-muted')
  await closePanel(pb)
  await waitReady()
  const b0 = await starts(pb)
  await aPlays()
  await sleep(1500)
  if ((await starts(pb)) !== b0) throw new Error('B played while the soundboard was muted')
  await (await openPanel(pb)).getByRole('switch', { name: 'Silenciar soundboard' }).click()
  await closePanel(pb)
})

await check('B ensurdecido não ouve o som', async () => {
  await dock(pb).getByRole('button', { name: 'Desativar áudio' }).click()
  await waitReady()
  const b0 = await starts(pb)
  await aPlays()
  await sleep(1500)
  if ((await starts(pb)) !== b0) throw new Error('B played while deafened')
  await dock(pb).getByRole('button', { name: 'Ativar áudio' }).click()
})

await check('Quem não está na call não pode tocar (403)', async () => {
  const r = await rest(B.token, 'POST', `/channels/${voice.id}/soundboard/play`, { soundId: 'alga:nada' })
  if (r.status !== 404 && r.status !== 403) throw new Error(String(r.status))
  const outsider = await account('c')
  await ok(outsider.token, 'POST', `/invites/${invite.code}`)
  const r2 = await rest(outsider.token, 'POST', `/channels/${voice.id}/soundboard/play`, { soundId: sound.id })
  if (r2.status !== 403) throw new Error(`outsider got ${r2.status}`)
})

await check('Janela estreita: o painel continua usável', async () => {
  await apps.a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(820, 640))
  await sleep(500)
  await closePanel(pa)
  await openPanel(pa)
  await shot('a', '08-narrow')
  await closePanel(pa)
  await apps.a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1180, 780))
})

await check('A apaga o som (confirmação inline) e some para B', async () => {
  const p = await openPanel(pa)
  await p.getByRole('button', { name: `Apagar: ${sound.name}` }).click({ force: true })
  await shot('a', '09-delete-confirm')
  await p.getByRole('button', { name: 'Apagar', exact: true }).click()
  await until(async () => (await ok(B.token, 'GET', `/spaces/${space.id}/sounds`)).length === 0, 'server list empty')
  const pB = await openPanel(pb)
  await until(async () => (await pB.getByRole('button', { name: `Tocar ${sound.name} para todos` }).count()) === 0, 'tile gone on B')
})

writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + '\n')
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} pass`)
if (!KEEP) for (const a of Object.values(apps)) await a.app.close().catch(() => undefined)
process.exit(failed.length ? 1 : 0)
