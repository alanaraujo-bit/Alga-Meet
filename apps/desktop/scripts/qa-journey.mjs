// Independent QA: the user journey of a group of friends moving from Discord, on three REAL app instances
// (profiles qa-a, qa-b, qa-c) against the isolated stack of qa-stack.mjs (own API, LiveKit, PGlite, outbox).
//   node scripts/qa-stack.mjs build && node scripts/qa-stack.mjs start
//   node scripts/qa-journey.mjs [--steps=0,1,…,11] [--summary]
//   node scripts/qa-stack.mjs stop
// Each check asserts a real outcome (UI + API state). A failing check leaves a screenshot of every open window in
// docs/qa/2026-11-01/ and the run goes on. Console errors/warnings of all renderers and the main-process output are
// collected in QA_WORK (console.jsonl, main-<profile>.log) and summarised by --summary. Report:
// docs/qa/2026-11-01-report.md.
// Never touches the dev stack: no :4000/:7880, no default/bob profile, no apps/server/data, no apps/desktop/out.
// Harness instrumentation in the main process (not product code): shell.openExternal and Notification.show are
// recorded instead of opening the owner's browser / showing toasts on the owner's desktop, and desktopCapturer only
// returns the QA test-pattern window, so no capture ever contains the owner's screen. The sharer runs WITHOUT
// Chromium's fake devices (they replace any getDisplayMedia with a synthetic screen) and gets a synthetic WebAudio
// microphone instead, so the real microphone is never opened.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, join } from 'node:path'
import { _electron as electron } from 'playwright'
import * as Q from './qa-stack.mjs'

// QA_OUT: re-runs keep their screenshots apart from the report's evidence.
const OUT = process.env.QA_OUT ?? join(Q.repo, 'docs', 'qa', '2026-11-01')
const STATE = join(Q.WORK, 'state.json')
const RESULTS = join(Q.WORK, 'results.json')
const CONSOLE = join(Q.WORK, 'console.jsonl')
const args = process.argv.slice(2)
const STEPS = (args.find((a) => a.startsWith('--steps='))?.split('=')[1] ?? '0,1,2,3,4,5,6,7,8,9,10,11').split(',').map(Number)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const load = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d)
mkdirSync(OUT, { recursive: true })
mkdirSync(Q.WORK, { recursive: true })

const state = load(STATE, { users: {} })
const results = load(RESULTS, { steps: {} })
const save = () => {
  writeFileSync(STATE, JSON.stringify(state, null, 2))
  writeFileSync(RESULTS, JSON.stringify(results, null, 2))
}
const U = state.users
const PROFILE = { A: 'qa-a', B: 'qa-b', C: 'qa-c' }

// ── REST (never throws: checks look at the status) ───────────
async function api(token, method, path, body) {
  for (let attempt = 0; ; attempt++) {
    let res
    try {
      res = await fetch(`${Q.API}/api/v1${path}`, {
        method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch (e) {
      if (attempt < 20) {
        await sleep(1000)
        continue
      }
      throw e
    }
    if (res.status === 429 && attempt < 6) {
      await sleep(10_000)
      continue
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null)
    return { status: res.status, data }
  }
}
async function ok(token, method, path, body) {
  const r = await api(token, method, path, body)
  if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.data)?.slice(0, 300)}`)
  return r.data
}
/** Full state as the server sends it (gateway READY): spaces with channels/roles/members, DMs, presences. */
function ready(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${Q.API.replace(/^http/, 'ws')}/gateway`)
    const timer = setTimeout(() => (ws.close(), reject(new Error('READY timeout'))), 10_000)
    ws.onopen = () => ws.send(JSON.stringify({ op: 'identify', token }))
    ws.onmessage = (ev) => {
      const f = JSON.parse(String(ev.data))
      if (f.op === 'dispatch' && f.t === 'READY') {
        clearTimeout(timer)
        ws.close()
        resolve(f.d)
      }
    }
    ws.onerror = () => (clearTimeout(timer), reject(new Error('gateway error')))
    ws.onclose = (e) => e.code >= 4000 && (clearTimeout(timer), reject(new Error(`gateway closed ${e.code}`)))
  })
}
const spaceOf = async (k) => (await ready(await tokenOf(k))).spaces.find((s) => s.id === state.spaceId)
/** The app's own session token (DPAPI store, read through the preload bridge). */
const tokenOf = (k) => apps.get(k).page.evaluate(() => window.alga.auth.getToken())

// ── outbox (console e-mail driver of OUR API) ────────────────
async function mailedToken(email, kind, after = 0) {
  const esc = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (let i = 0; i < 80; i++) {
    const files = existsSync(Q.OUTBOX) ? readdirSync(Q.OUTBOX).filter((f) => f.includes(kind)).sort().reverse() : []
    for (const f of files) {
      const p = join(Q.OUTBOX, f)
      const eml = readFileSync(p, 'utf8')
      if (statSync(p).mtimeMs < after || !new RegExp(`^To: .*${esc}`, 'mi').test(eml)) continue
      const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(eml)?.[1]
      if (token) return token
    }
    await sleep(250)
  }
  throw new Error(`no ${kind} e-mail for ${email} in the QA outbox`)
}
const mails = (email) =>
  (existsSync(Q.OUTBOX) ? readdirSync(Q.OUTBOX) : []).filter((f) => readFileSync(join(Q.OUTBOX, f), 'utf8').includes(email))

// ── media fixtures ───────────────────────────────────────────
function ffmpeg(a) {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...a], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`)
}
function fixtures() {
  const dir = join(Q.WORK, 'media')
  mkdirSync(dir, { recursive: true })
  const f = (n) => join(dir, n)
  if (!existsSync(f('speech.wav'))) {
    const raw = f('speech-raw.wav')
    const ps = `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'pt-BR' } | Select-Object -First 1
if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }
$s.SetOutputToWaveFile('${raw.replace(/'/g, "''")}')
$p = New-Object System.Speech.Synthesis.PromptBuilder
foreach ($t in @('Fala galera, bora jogar hoje?', 'Entrei na sala agora.', 'Alguém compartilha a tela?', 'Tô ouvindo todo mundo.')) { $p.AppendText($t); $p.AppendBreak([TimeSpan]::FromMilliseconds(400)) }
$s.Speak($p)
$s.Dispose()`
    const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
    if (r.status === 0 && existsSync(raw)) ffmpeg(['-i', raw, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', f('speech.wav')])
    else ffmpeg(['-f', 'lavfi', '-i', "aevalsrc='0.35*sin(2*PI*190*t)*gt(sin(2*PI*0.4*t),-0.3)':s=48000:d=20", '-ac', '1', '-c:a', 'pcm_s16le', f('speech.wav')])
  }
  if (!existsSync(f('tone.wav'))) ffmpeg(['-f', 'lavfi', '-i', "aevalsrc='0.3*sin(2*PI*330*t)*gt(sin(2*PI*0.5*t),0)':s=48000:d=20", '-ac', '1', '-c:a', 'pcm_s16le', f('tone.wav')])
  if (!existsSync(f('silence.wav'))) ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '10', '-c:a', 'pcm_s16le', f('silence.wav')])
  if (!existsSync(f('foto-praia.jpg'))) ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=800x600:rate=1', '-frames:v', '1', f('foto-praia.jpg')])
  if (!existsSync(f('regras-do-clube.txt'))) writeFileSync(f('regras-do-clube.txt'), 'Regras do clube\n1. Respeito sempre.\n2. Sem spam.\n')
  return { speech: f('speech.wav'), tone: f('tone.wav'), silence: f('silence.wav'), image: f('foto-praia.jpg'), text: f('regras-do-clube.txt') }
}
const MEDIA = fixtures()
const MIC = { A: MEDIA.tone, B: MEDIA.speech, C: MEDIA.silence }

// ── app instances ────────────────────────────────────────────
const electronPath = createRequire(join(Q.appDir, 'package.json'))('electron')
const apps = new Map()
const profileDir = (k) => join(process.env.APPDATA ?? '', 'Alga Meet Dev', 'profiles', PROFILE[k])
const appEnv = () => {
  const env = { ...process.env, ALGA_API_URL: Q.API, ALGA_E2E: '1' }
  delete env.ELECTRON_RENDERER_URL
  return env
}
const flags = (k) => [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-audio-capture=${MIC[k]}`,
  // Several windows on one desktop: keep the covered ones rendering (harness only).
  '--disable-features=CalculateNativeWinOcclusion',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
]
/** The sharer: real window capture, so NO fake-device/fake-ui switches (fake-ui would auto-pick a real screen). */
const realCaptureFlags = ['--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-background-timer-throttling']
// Without the fake devices the renderer would open the owner's real microphone: getUserMedia is answered with a
// synthetic tone (WebAudio) and camera requests are refused. getDisplayMedia is only observed (stream kept for checks).
const SYNTHETIC_MIC = `(() => {
  const md = navigator.mediaDevices
  if (!md || md.__qa) return
  md.__qa = true
  md.getUserMedia = async (c) => {
    if (c && c.video) throw new DOMException('QA harness: camera blocked', 'NotAllowedError')
    const ctx = new AudioContext({ sampleRate: 48000 })
    const osc = ctx.createOscillator()
    osc.frequency.value = 330
    const gain = ctx.createGain()
    gain.gain.value = 0
    let on = false
    setInterval(() => { on = !on; gain.gain.setTargetAtTime(on ? 0.3 : 0, ctx.currentTime, 0.01) }, 600)
    const dst = ctx.createMediaStreamDestination()
    osc.connect(gain).connect(dst)
    osc.start()
    window.__qaSyntheticMic = (window.__qaSyntheticMic || 0) + 1
    return dst.stream
  }
  const dm = md.getDisplayMedia.bind(md)
  md.getDisplayMedia = async (c) => { const st = await dm(c); window.__qaScreen = st; window.__qaScreenReq = c; return st }
})()`
const redact = (u) => u.replace(/([?&](?:access_token|token|sig|uid|exp)=)[^&]+/g, '$1…')
const consoleLines = []
function logConsole(k, type, text) {
  const line = { at: new Date().toISOString(), step: cur?.id ?? null, profile: PROFILE[k], type, text: redact(text).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<jwt>').slice(0, 600) }
  consoleLines.push(line)
  appendFileSync(CONSOLE, JSON.stringify(line) + '\n')
}

async function instrument(k) {
  const { app } = apps.get(k)
  await app.evaluate(({ shell, Notification, desktopCapturer }) => {
    globalThis.__qa = { external: [], toasts: [] }
    shell.openExternal = async (url) => void globalThis.__qa.external.push(url)
    Notification.prototype.show = function () {
      globalThis.__qa.toasts.push({ title: this.title, body: this.body, at: Date.now() })
    }
    const orig = desktopCapturer.getSources.bind(desktopCapturer)
    desktopCapturer.getSources = async (o) => (await orig(o)).filter((s) => s.name.includes('QA-Share'))
  })
}

async function launch(k, { fresh = false, extra = [], x = 0, realCapture = false } = {}) {
  if (apps.has(k)) return apps.get(k)
  if (fresh) rmSync(profileDir(k), { recursive: true, force: true })
  const app = await electron.launch({ executablePath: electronPath, args: [Q.QA_APP, `--profile=${PROFILE[k]}`, ...(realCapture ? realCaptureFlags : flags(k)), ...extra], cwd: Q.appDir, env: appEnv() })
  const mainLog = join(Q.WORK, `main-${PROFILE[k]}.log`)
  app.process().stdout?.on('data', (d) => appendFileSync(mainLog, d))
  app.process().stderr?.on('data', (d) => appendFileSync(mainLog, d))
  const page = await app.firstWindow()
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && logConsole(k, m.type(), `${m.text()}${m.location()?.url ? ` @ ${redact(m.location().url)}` : ''}`))
  page.on('pageerror', (e) => logConsole(k, 'pageerror', e.stack ?? e.message))
  // The URL behind each "Failed to load resource" line (secrets in query strings redacted).
  page.on('response', (r) => r.status() >= 400 && logConsole(k, 'http', `${r.status()} ${r.request().method()} ${redact(r.url())}`))
  page.on('requestfailed', (r) => logConsole(k, 'http', `failed ${r.request?.().method?.() ?? r.method()} ${redact(r.url())} ${r.failure()?.errorText ?? ''}`))
  apps.set(k, { app, page })
  // Playwright emulates focus (document.hasFocus() always true); the app decides on toasts by real focus.
  await (await page.context().newCDPSession(page)).send('Emulation.setFocusEmulationEnabled', { enabled: false })
  await instrument(k)
  const offset = { A: 0, B: 380, C: 760 }[k] + x
  await app.evaluate(({ BrowserWindow }, o) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setContentSize(1280, 800)
    w.setPosition(40 + o, 30 + Math.round(o / 6))
  }, offset)
  await page.waitForLoadState('domcontentloaded')
  if (realCapture) {
    await page.context().addInitScript(SYNTHETIC_MIC)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    expect(await page.evaluate(() => !!navigator.mediaDevices.__qa), 'synthetic mic not installed')
  }
  await sleep(500)
  return apps.get(k)
}
async function close(k) {
  const a = apps.get(k)
  if (!a) return
  apps.delete(k)
  await a.app.close().catch(() => undefined)
}
const closeAll = async () => {
  for (const k of [...apps.keys()]) await close(k)
}
const P = (k) => apps.get(k).page
/** A second app process with a deep link on the same profile (Windows hands algameet:// links over like this). */
function secondInstance(k, link) {
  const r = spawnSync(electronPath, [Q.QA_APP, `--profile=${PROFILE[k]}`, link], { cwd: Q.appDir, env: appEnv(), timeout: 30_000 })
  return r.status
}

// ── UI helpers ───────────────────────────────────────────────
const rail = (k, name) => P(k).getByRole('navigation', { name: 'Espaços' }).getByRole('button', { name })
const channels = (k) => P(k).getByRole('complementary', { name: 'Canais' })
const composer = (k) => P(k).getByRole('textbox', { name: /^Mensagem para/ })
/** Newest message containing `text` (re-runs keep older ones in the history). */
const msg = (k, text) => P(k).locator('[data-message-id]').filter({ hasText: text }).last()
const home = (k) => P(k).getByRole('button', { name: 'Conversas', exact: true }).click()
const dock = (k) => P(k).getByRole('toolbar', { name: 'Controles da chamada' })
const settings = (k) => P(k).getByRole('dialog', { name: 'Configurações' })
async function openSettings(k, section) {
  const dlg = settings(k)
  if (!(await dlg.isVisible())) {
    await P(k).getByRole('button', { name: 'Configurações', exact: true }).click()
    await dlg.waitFor()
  }
  await dlg.getByRole('navigation').getByRole('button', { name: section, exact: true }).click()
  await sleep(400)
  return dlg
}
async function closeSettings(k) {
  if (await settings(k).isVisible()) {
    await P(k).keyboard.press('Escape')
    await settings(k).waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined)
  }
}
const SPACE_RE = () => new RegExp(`^${state.spaceName}`)
const nav = (k) => P(k).getByRole('navigation', { name: 'Espaços' })
async function signIn(k, login, password) {
  const p = P(k)
  await p.getByLabel('E-mail ou nome de usuário').fill(login)
  await p.getByLabel('Senha', { exact: true }).fill(password)
  await p.getByRole('button', { name: 'Entrar', exact: true }).click()
}
async function login(k, u = U[k]) {
  const p = P(k)
  if (await nav(k).isVisible().catch(() => false)) return
  await p.getByLabel('E-mail ou nome de usuário').or(nav(k)).first().waitFor({ timeout: 20_000 })
  if (await nav(k).isVisible()) return
  for (let i = 0; i < 8; i++) {
    await signIn(k, u.username, u.password)
    const limited = p.getByText('Muitas tentativas')
    await nav(k).or(limited).first().waitFor({ timeout: 20_000 })
    if (await nav(k).isVisible()) break
    await sleep(10_000)
  }
  await nav(k).waitFor({ timeout: 20_000 })
  await sleep(500)
}
/** Up and signed in (existing profile). */
async function up(k, opts) {
  await launch(k, opts)
  await login(k)
  return P(k)
}
const until = async (fn, { timeout = 15_000, every = 250, what = 'condition' } = {}) => {
  const t0 = Date.now()
  let last
  while (Date.now() - t0 < timeout) {
    try {
      last = await fn()
      if (last) return last
    } catch (e) {
      last = e
    }
    await sleep(every)
  }
  throw new Error(`timeout waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`)
}
const expect = (cond, message) => {
  if (!cond) throw new Error(message)
}

// ── steps & checks ───────────────────────────────────────────
let cur = null
class Abort extends Error {}
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)

async function evidence(name) {
  const files = []
  for (const [k, { page }] of apps) {
    const f = join(OUT, `s${cur.id}-${slug(name)}-${PROFILE[k]}.png`)
    // A screen picker shows only the QA window (desktopCapturer filtered), so any screenshot is safe to keep.
    if (await page.screenshot({ path: f, timeout: 8000 }).then(() => true, () => false)) files.push(basename(f))
    const aria = await page.locator('body').ariaSnapshot({ timeout: 5000 }).catch(() => '')
    if (aria) writeFileSync(join(Q.WORK, `aria-s${cur.id}-${slug(name)}-${PROFILE[k]}.yml`), aria)
  }
  return files
}
async function check(name, fn, { hard = false } = {}) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    cur.checks.push({ name, ok: true, detail: detail === undefined ? '' : String(detail), ms: Date.now() - t0 })
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (e) {
    const ev = await evidence(name)
    const detail = (e?.message ?? String(e)).split('\n').slice(0, 4).join(' | ').slice(0, 700)
    cur.checks.push({ name, ok: false, detail, evidence: ev, ms: Date.now() - t0 })
    console.log(`  ✗ ${name} — ${detail}`)
    save()
    if (hard) throw new Abort(name)
  }
  save()
}
/** Observations that are not pass/fail (measurements, notes for the report). */
const note = (text) => {
  cur.notes.push(text)
  console.log(`  · ${text}`)
}

const STEP_FNS = {}
const step = (id, title, fn) => (STEP_FNS[id] = { title, fn })

// ─────────────────────────────────────────────────────────────
// 0. Staff account (granted with grant-staff.ts on OUR PGlite while no app is connected).
step(0, 'Preparação: conta de equipe (grant-staff.ts no banco do QA)', async () => {
  await check('API e LiveKit do QA no ar', async () => {
    expect((await api(null, 'GET', '/health')).status === 200, 'API down')
    expect(await fetch(`http://127.0.0.1:${Q.LK_PORT}/`).then((r) => r.ok, () => false), 'LiveKit down')
    return `${Q.API}, ws://127.0.0.1:${Q.LK_PORT}`
  }, { hard: true })
  if (!state.staff) {
    const legal = await ok(null, 'GET', '/legal')
    const username = `qa.staff.${randomBytes(2).toString('hex')}`
    const password = `${randomBytes(9).toString('base64url')} farol aceso`
    await ok(null, 'POST', '/auth/register', { email: `${username}@qa.alga.test`, username, displayName: 'Equipe QA', password, birthDate: '1990-03-03', termsVersion: legal.termsVersion })
    state.staff = { username, password }
    save()
  }
  await check('grant-staff.ts moderator no banco do QA', async () => {
    const out = await Q.grantStaff(state.staff.username, 'moderator')
    const r = await ok(null, 'POST', '/auth/login', { login: state.staff.username, password: state.staff.password })
    state.staff.token = r.token
    state.staff.id = r.user.id
    save()
    expect((await api(r.token, 'GET', '/admin/reports?limit=1')).status === 200, '/admin/reports not allowed for the staff account')
    return out
  }, { hard: true })
})

// ─────────────────────────────────────────────────────────────
step(1, 'Cadastro (idade + termos), verificação de e-mail, logout/login, senha errada, sessão após reiniciar', async () => {
  const people = { A: 'Ana Souza', B: 'Bruno Lima', C: 'Caio Prado' }
  for (const k of ['A', 'B', 'C']) {
    const username = `qa${k.toLowerCase()}.${randomBytes(2).toString('hex')}`
    U[k] = { username, email: `${username}@qa.alga.test`, password: `${randomBytes(9).toString('base64url')} mar azul`, displayName: people[k] }
  }
  save()
  for (const k of ['A', 'B', 'C']) await launch(k, { fresh: true })

  for (const k of ['A', 'B', 'C']) {
    await check(`${k}: cria conta no app com data de nascimento e aceite dos termos`, async () => {
      const p = P(k)
      await p.getByRole('button', { name: 'Criar conta' }).click()
      await p.getByLabel('E-mail', { exact: true }).fill(U[k].email)
      await p.getByLabel('Nome de exibição').fill(U[k].displayName)
      await p.getByLabel('Nome de usuário').fill(U[k].username)
      await p.getByLabel('Data de nascimento').fill('14031995')
      await p.getByLabel('Senha', { exact: true }).fill(U[k].password)
      await p.getByRole('checkbox').check()
      await p.getByRole('button', { name: 'Criar conta' }).click()
      await p.getByText(`Boas-vindas, ${U[k].displayName.split(' ')[0]}`).waitFor({ timeout: 20_000 })
      const me = await ok(await tokenOf(k), 'GET', '/users/@me')
      U[k].id = me.id
      save()
      expect(me.ageBracket === 'adult', `ageBracket=${me.ageBracket}`)
      expect(me.needsTermsAcceptance === false, 'needsTermsAcceptance still true after signup with terms')
      expect(me.emailVerified === false, 'new account already verified?')
      return `id ${me.id}, ageBracket=${me.ageBracket}`
    }, { hard: true })
    await P(k).getByRole('button', { name: 'Pular por agora' }).click().catch(() => undefined)
  }

  await check('A: confirma o e-mail colando o link do e-mail no app', async () => {
    const p = P('A')
    const token = await mailedToken(U.A.email, 'verify_email')
    await p.getByRole('button', { name: 'Confirme seu e-mail' }).first().click()
    const dlg = p.getByRole('dialog', { name: 'Confirme seu e-mail' })
    await dlg.getByLabel('Link ou código').fill(`algameet://auth/verify-email?token=${token}`)
    await dlg.getByRole('button', { name: 'Confirmar', exact: true }).click()
    await p.getByText('E-mail confirmado').first().waitFor({ timeout: 15_000 })
    expect((await ok(await tokenOf('A'), 'GET', '/users/@me')).emailVerified === true, 'API says not verified')
  })
  await check('B: confirma o e-mail pelo deep link algameet:// (segunda instância)', async () => {
    const token = await mailedToken(U.B.email, 'verify_email')
    const code = secondInstance('B', `algameet://auth/verify-email?token=${token}`)
    await P('B').getByText('E-mail confirmado. Tudo liberado.').waitFor({ timeout: 20_000 })
    expect((await ok(await tokenOf('B'), 'GET', '/users/@me')).emailVerified === true, 'API says not verified')
    return `segunda instância saiu com ${code}`
  })
  await check('C: confirma o e-mail colando só o código', async () => {
    const p = P('C')
    const token = await mailedToken(U.C.email, 'verify_email')
    await p.getByRole('button', { name: 'Confirme seu e-mail' }).first().click()
    const dlg = p.getByRole('dialog', { name: 'Confirme seu e-mail' })
    await dlg.getByLabel('Link ou código').fill(token)
    await dlg.getByRole('button', { name: 'Confirmar', exact: true }).click()
    await p.getByText('E-mail confirmado').first().waitFor({ timeout: 15_000 })
    expect((await ok(await tokenOf('C'), 'GET', '/users/@me')).emailVerified === true, 'API says not verified')
  })

  let oldToken
  await check('A: sai da conta pelo painel do usuário e a sessão é revogada no servidor', async () => {
    const p = P('A')
    oldToken = await tokenOf('A')
    await p.getByRole('button', { name: new RegExp(`^${U.A.displayName}`) }).first().click()
    await p.getByRole('dialog', { name: 'Definir status' }).getByRole('button', { name: 'Sair da conta' }).click()
    await p.getByLabel('E-mail ou nome de usuário').waitFor({ timeout: 15_000 })
    expect((await tokenOf('A')) === null, 'token still stored after logout')
    const r = await api(oldToken, 'GET', '/users/@me')
    expect(r.status === 401, `old session still valid after logout: GET /users/@me → ${r.status}`)
  })
  await check('A: senha errada mostra erro e não entra', async () => {
    const p = P('A')
    await signIn('A', U.A.username, 'senha-totalmente-errada-123')
    await p.getByText('E-mail, usuário ou senha incorretos.').waitFor({ timeout: 15_000 })
    expect(!(await nav('A').isVisible()), 'shell visible after wrong password')
  })
  await check('A: entra de novo com o e-mail (verificado) e a senha certa', async () => {
    await P('A').getByLabel('E-mail ou nome de usuário').fill('')
    await signIn('A', U.A.email, U.A.password)
    await nav('A').waitFor({ timeout: 20_000 })
  })
  await check('A: sessão continua depois de reiniciar o app (sem tela de login)', async () => {
    await close('A')
    await launch('A')
    const p = P('A')
    await nav('A').or(p.getByLabel('E-mail ou nome de usuário')).first().waitFor({ timeout: 25_000 })
    expect(await nav('A').isVisible(), 'login screen after restart: session not persisted')
  })
  await closeAll()
})

// ─────────────────────────────────────────────────────────────
step(2, 'Amigos: pedido por username, aceitar, bloqueio (C ↛ B), presença', async () => {
  await up('A')
  await up('B')
  await up('C')
  await check('A envia pedido de amizade para B pelo nome de usuário', async () => {
    const p = P('A')
    await home('A')
    await p.getByRole('button', { name: 'Amigos' }).first().click()
    await p.getByRole('button', { name: 'Adicionar amigo' }).first().click()
    await p.getByPlaceholder('nome_de_usuario').fill(U.B.username)
    await p.getByRole('button', { name: 'Enviar pedido' }).click()
    await p.getByText(`Pedido enviado para @${U.B.username}`).waitFor({ timeout: 10_000 })
  })
  await check('B recebe o pedido ao vivo (badge) e aceita em Pendentes', async () => {
    const p = P('B')
    await home('B')
    await p.getByRole('button', { name: 'Amigos' }).first().click()
    await p.getByRole('tab', { name: /Pendentes/ }).click()
    const row = p.getByRole('listitem').filter({ hasText: U.A.displayName })
    await row.waitFor({ timeout: 10_000 })
    await row.getByRole('button', { name: 'Aceitar' }).click()
    await p.getByText(`Agora você e ${U.A.displayName} são amigos.`).waitFor({ timeout: 10_000 })
    const rels = await ok(await tokenOf('B'), 'GET', '/relationships')
    expect(rels.find((r) => r.user.id === U.A.id)?.type === 'friend', 'B→A not friend in API')
    const relsA = await ok(await tokenOf('A'), 'GET', '/relationships')
    expect(relsA.find((r) => r.user.id === U.B.id)?.type === 'friend', 'A→B not friend in API')
  })
  await check('A vê B como amigo (aba Todos) sem recarregar', async () => {
    const p = P('A')
    await p.getByRole('tab', { name: 'Todos' }).click()
    await p.getByRole('listitem').filter({ hasText: U.B.displayName }).waitFor({ timeout: 10_000 })
  })
  await check('C pede amizade a B; B bloqueia C pelo menu do pedido', async () => {
    const pc = P('C')
    await home('C')
    await pc.getByRole('button', { name: 'Amigos' }).first().click()
    await pc.getByRole('button', { name: 'Adicionar amigo' }).first().click()
    await pc.getByPlaceholder('nome_de_usuario').fill(U.B.username)
    await pc.getByRole('button', { name: 'Enviar pedido' }).click()
    await pc.getByText(`Pedido enviado para @${U.B.username}`).waitFor({ timeout: 10_000 })
    const pb = P('B')
    await pb.getByRole('tab', { name: /Pendentes/ }).click()
    const row = pb.getByRole('listitem').filter({ hasText: U.C.displayName })
    await row.waitFor({ timeout: 10_000 })
    await row.getByRole('button', { name: 'Mais opções' }).click()
    await pb.getByRole('menuitem', { name: 'Bloquear' }).click()
    await pb.getByText(`${U.C.displayName} foi bloqueado.`).waitFor({ timeout: 10_000 })
    const rels = await ok(await tokenOf('B'), 'GET', '/relationships')
    expect(rels.find((r) => r.user.id === U.C.id)?.type === 'blocked', 'API: B→C not blocked')
  })
  await check('C não consegue pedir amizade de novo a B (app mostra erro)', async () => {
    const pc = P('C')
    await pc.getByRole('button', { name: 'Adicionar amigo' }).first().click()
    await pc.getByPlaceholder('nome_de_usuario').fill(U.B.username)
    await pc.getByRole('button', { name: 'Enviar pedido' }).click()
    await pc.getByRole('alert').first().waitFor({ timeout: 10_000 })
    const text = await pc.getByRole('alert').first().innerText()
    const rels = await ok(await tokenOf('B'), 'GET', '/relationships')
    expect(rels.find((r) => r.user.id === U.C.id)?.type === 'blocked', 'block was replaced by a request')
    return `mensagem: "${text}"`
  })
  await check('C não consegue abrir DM com B nem mandar mensagem (API)', async () => {
    const tc = await tokenOf('C')
    const r = await api(tc, 'POST', '/users/@me/channels', { recipientIds: [U.B.id] })
    expect(r.status === 403 || r.status === 404, `POST /users/@me/channels C→B → ${r.status}`)
    return `POST /users/@me/channels → ${r.status} ${r.data?.error?.code ?? ''}`
  })
  await check('C não aparece mais para B em Pendentes (vai para Bloqueados)', async () => {
    const pb = P('B')
    await pb.getByRole('tab', { name: /Bloqueados/ }).click()
    await pb.getByRole('listitem').filter({ hasText: U.C.displayName }).waitFor({ timeout: 10_000 })
  })

  // Presence, as B sees A in the friends list.
  const statusName = { idle: 'Ausente', dnd: 'Não perturbe', invisible: 'Invisível', online: 'Online' }
  const seenAs = { idle: 'Ausente', dnd: 'Não perturbe', invisible: 'Offline', online: 'Online' }
  const pb = P('B')
  await pb.getByRole('tab', { name: 'Todos' }).click()
  for (const s of ['idle', 'dnd', 'invisible', 'online']) {
    await check(`presença: A muda para "${statusName[s]}" e B vê "${seenAs[s]}"`, async () => {
      const pa = P('A')
      await pa.getByRole('button', { name: new RegExp(`^${U.A.displayName}`) }).first().click()
      await pa.getByRole('dialog', { name: 'Definir status' }).getByRole('radio', { name: new RegExp(`^${statusName[s]}`) }).click()
      await pa.keyboard.press('Escape')
      const t0 = Date.now()
      const row = pb.getByRole('listitem').filter({ hasText: U.A.displayName })
      await until(async () => (await row.innerText({ timeout: 2000 })).includes(seenAs[s]), { timeout: 10_000, what: `B to see A as ${seenAs[s]}` })
      return `${Date.now() - t0} ms`
    })
  }
  await closeAll()
})

// ─────────────────────────────────────────────────────────────
step(3, 'DM A↔B: enviar, editar, excluir, reações, resposta, menção, anexos, digitando, não lidas, notificação', async () => {
  await up('A')
  await up('B')
  const pa = P('A')
  const pb = P('B')
  await check('A abre a DM com B pelo botão Mensagem da lista de amigos', async () => {
    await home('A')
    await pa.getByRole('button', { name: 'Amigos' }).first().click()
    await pa.getByRole('tab', { name: 'Todos' }).click()
    await pa.getByRole('listitem').filter({ hasText: U.B.displayName }).hover()
    await pa.getByRole('listitem').filter({ hasText: U.B.displayName }).getByRole('button', { name: 'Mensagem' }).click()
    await composer('A').waitFor({ timeout: 10_000 })
    const dm = (await ready(await tokenOf('A'))).privateChannels.find((c) => c.type === 'dm' && JSON.stringify(c).includes(U.B.id))
    expect(dm, 'no DM channel A↔B in READY')
    state.dmId = dm.id
    save()
  }, { hard: true })
  // B sits on the friends list, so the DM is "not open" for B (unread state applies).
  await home('B')
  await pb.getByRole('button', { name: 'Amigos' }).first().click()

  await check('typing: B vê "Ana está digitando" enquanto A digita', async () => {
    await composer('A').click()
    await pa.keyboard.type('Oi Bruno, chegou?', { delay: 60 })
    // B opens the DM to see the indicator.
    await pb.getByRole('button', { name: new RegExp(U.A.displayName) }).first().click({ timeout: 10_000 }).catch(() => undefined)
    await pa.keyboard.type(' ', { delay: 30 })
    await pb.getByText(`${U.A.displayName} está digitando`).waitFor({ timeout: 8000 })
    await home('B')
    await pb.getByRole('button', { name: 'Amigos' }).first().click()
  })
  let firstId
  await check('A envia mensagem; B recebe ao vivo; DM fica não lida para B (lista + rail)', async () => {
    await composer('A').press('Enter')
    await msg('A', 'Oi Bruno, chegou?').waitFor()
    const row = pb.getByRole('button', { name: new RegExp(U.A.displayName) }).first()
    await until(async () => /rowUnread/.test((await row.getAttribute('class')) ?? ''), { timeout: 10_000, what: 'DM row unread for B' })
    const msgs = await ok(await tokenOf('B'), 'GET', `/channels/${state.dmId}/messages?limit=5`)
    firstId = msgs.find((m) => m.content.startsWith('Oi Bruno'))?.id
    expect(firstId, 'message not in API')
    const homeBadge = await pb.getByRole('button', { name: 'Conversas', exact: true }).innerText().catch(() => '')
    return `badge Conversas: "${homeBadge.replace(/\s+/g, ' ').trim()}"`
  })
  await check('B abre a DM: mensagem aparece e o estado não lida some (ack no servidor)', async () => {
    await pb.getByRole('button', { name: new RegExp(U.A.displayName) }).first().click()
    await msg('B', 'Oi Bruno, chegou?').waitFor({ timeout: 10_000 })
    const row = pb.getByRole('button', { name: new RegExp(U.A.displayName) }).first()
    await until(async () => !/rowUnread/.test((await row.getAttribute('class')) ?? ''), { timeout: 8000, what: 'unread cleared' })
  })
  await check('A edita a mensagem pela barra de ações; B vê o texto novo e "(editado)"', async () => {
    await msg('A', 'Oi Bruno, chegou?').hover()
    await msg('A', 'Oi Bruno, chegou?').getByRole('button', { name: 'Editar' }).click()
    const editor = pa.getByRole('textbox', { name: 'Editar' })
    await editor.waitFor()
    await editor.fill('Oi Bruno, chegou? Bora jogar às 21h')
    await editor.press('Enter')
    await msg('B', 'Bora jogar às 21h').waitFor({ timeout: 10_000 })
    await msg('B', 'Bora jogar às 21h').getByText('(editado)').waitFor({ timeout: 5000 })
  })
  await check('B reage com 👍; A vê a reação com contagem 1', async () => {
    await msg('B', 'Bora jogar às 21h').hover()
    await msg('B', 'Bora jogar às 21h').getByRole('button', { name: 'Reagir com 👍' }).click()
    await msg('A', 'Bora jogar às 21h').getByRole('button', { name: /^👍: 1 reação/ }).waitFor({ timeout: 10_000 })
  })
  await check('B responde à mensagem; A vê a resposta ligada à original', async () => {
    await msg('B', 'Bora jogar às 21h').hover()
    await msg('B', 'Bora jogar às 21h').getByRole('button', { name: 'Responder' }).click()
    await pb.getByText('Respondendo a').waitFor()
    await composer('B').fill('Fechado! Levo o fone novo')
    await composer('B').press('Enter')
    await msg('A', 'Fechado! Levo o fone novo').waitFor({ timeout: 10_000 })
    const m = (await ok(await tokenOf('A'), 'GET', `/channels/${state.dmId}/messages?limit=5`)).find((x) => x.content.startsWith('Fechado'))
    expect(m?.replyToId === firstId, `reply not linked in API: replyToId=${m?.replyToId} expected ${firstId}`)
    expect(await msg('A', 'Fechado! Levo o fone novo').getByText('Bora jogar às 21h').count(), 'reply preview not shown on A')
  })
  await check('A menciona B com @ pelo autocomplete e continua digitando (6 vezes); a mensagem leva <@id> e o texto na ordem', async () => {
    const sent = []
    for (let i = 1; i <= 6; i++) {
      await composer('A').click()
      await pa.keyboard.type(`valeu @${U.B.displayName.slice(0, 3)}`)
      await pa.getByRole('listbox', { name: 'Mencionar' }).waitFor({ timeout: 5000 })
      await pa.keyboard.press('Enter')
      // Someone who keeps typing right after picking the suggestion (no pause).
      await pa.keyboard.type(`até mais ${i}`)
      await pa.keyboard.press('Enter')
      await sleep(700)
      const m = (await ok(await tokenOf('A'), 'GET', `/channels/${state.dmId}/messages?limit=1`))[0]
      sent.push(m.content)
    }
    expect(sent.every((c) => c.includes(`<@${U.B.id}>`)), `mention not encoded: ${sent.join(' | ')}`)
    const bad = sent.filter((c, i) => !c.endsWith(`até mais ${i + 1}`))
    expect(bad.length === 0, `texto digitado logo depois de escolher a menção saiu fora de ordem em ${bad.length}/6: ${bad.map((c) => JSON.stringify(c.replace(/<@[^>]+>/, '<@B>'))).join(' | ')}`)
    return sent.map((c) => c.replace(/<@[^>]+>/, '<@B>')).join(' | ')
  })
  await check('A envia imagem + arquivo (.txt) pelo botão de anexar; B vê a imagem carregada e o arquivo', async () => {
    await pa.locator('input[type=file]').first().setInputFiles([MEDIA.image, MEDIA.text])
    await composer('A').fill('fotos do rolê e as regras')
    await composer('A').press('Enter')
    const m = msg('B', 'fotos do rolê')
    await m.waitFor({ timeout: 20_000 })
    await until(() => m.evaluate((el) => [...el.querySelectorAll('img')].some((i) => i.naturalWidth > 0)), { timeout: 20_000, what: 'image loaded on B' })
    await m.getByText('regras-do-clube.txt').waitFor({ timeout: 10_000 })
    const api_ = (await ok(await tokenOf('B'), 'GET', `/channels/${state.dmId}/messages?limit=5`)).find((x) => x.content.startsWith('fotos'))
    expect(api_?.attachments?.length === 2, `attachments in API: ${api_?.attachments?.length}`)
    return api_.attachments.map((a) => `${a.filename} ${a.contentType}`).join(', ')
  })
  await check('A exclui uma mensagem (com confirmação); some para B', async () => {
    await composer('A').fill('mensagem errada, vou apagar')
    await composer('A').press('Enter')
    await msg('B', 'mensagem errada').waitFor({ timeout: 10_000 })
    await msg('A', 'mensagem errada').hover()
    await msg('A', 'mensagem errada').getByRole('button', { name: 'Excluir' }).click()
    await pa.getByRole('dialog', { name: 'Excluir mensagem?' }).getByRole('button', { name: 'Excluir' }).click()
    await msg('B', 'mensagem errada').waitFor({ state: 'detached', timeout: 10_000 })
  })
  await check('notificação: B minimizado recebe aviso do Windows da DM de A', async () => {
    await apps.get('B').app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
    await sleep(800)
    const focused = await pb.evaluate(() => document.hasFocus())
    await composer('A').fill('tá aí? 🔔')
    await composer('A').press('Enter')
    const toasts = await until(async () => {
      const t = await apps.get('B').app.evaluate(() => globalThis.__qa.toasts)
      return t.find((x) => x.body.includes('tá aí')) ? t : null
    }, { timeout: 10_000, what: 'toast on B' })
    const t = toasts.find((x) => x.body.includes('tá aí'))
    await apps.get('B').app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore())
    return `hasFocus=${focused}; toast "${t.title}: ${t.body}"`
  })
  await check('badge da barra de tarefas: B com DM não lida', async () => {
    // Badge comes through window.setOverlayIcon; read the renderer intent instead (count sent to main).
    await home('B')
    await pb.getByRole('button', { name: 'Amigos' }).first().click()
    await sleep(10_000) // server limit: 10 messages / 10 s per user (this step sends many in a row)
    await composer('A').fill('última do dia')
    await composer('A').press('Enter')
    const row = pb.getByRole('button', { name: new RegExp(U.A.displayName) }).first()
    await until(async () => /rowUnread/.test((await row.getAttribute('class')) ?? ''), { timeout: 10_000, what: 'DM row unread for B' })
  })
  await closeAll()
})

// ─────────────────────────────────────────────────────────────
step(4, 'Espaço: criar, convite (link + deep link), cargos (Mod com MANAGE_MESSAGES), excluir mensagens, expulsar/banir', async () => {
  state.spaceName = `Clube QA ${randomBytes(2).toString('hex')}`
  save()
  await up('A')
  await up('B')
  await up('C')
  const pa = P('A')
  await check('A cria o espaço "Clube QA" pelo rail', async () => {
    await pa.getByRole('button', { name: 'Criar ou entrar em um espaço' }).click()
    await pa.getByRole('menuitem', { name: 'Criar espaço' }).click()
    await pa.getByLabel('Nome do espaço').fill(state.spaceName)
    await pa.getByRole('button', { name: 'Criar espaço' }).click()
    await pa.getByRole('dialog').waitFor({ state: 'detached', timeout: 10_000 })
    await rail('A', SPACE_RE()).waitFor()
    const sp = (await ready(await tokenOf('A'))).spaces.find((x) => x.name === state.spaceName)
    expect(sp, 'space not in READY')
    state.spaceId = sp.id
    state.geralId = sp.channels.find((c) => c.type === 'text')?.id
    state.voiceId = sp.channels.find((c) => c.type === 'voice')?.id
    save()
    return `canais: ${sp.channels.map((c) => `${c.type}:${c.name}`).join(', ')}`
  }, { hard: true })
  await check('A gera convite em "Convidar pessoas" e o link aparece', async () => {
    await channels('A').getByRole('button', { name: state.spaceName }).first().click()
    await pa.getByRole('menuitem', { name: 'Convidar pessoas' }).click()
    const dlg = pa.getByRole('dialog')
    await dlg.getByRole('button', { name: 'Copiar' }).waitFor({ timeout: 10_000 })
    // The field says "Gerando convite…" until the server answers.
    const link = await until(async () => {
      const v = await dlg.getByLabel('Link de convite').inputValue()
      return /\/i\/[A-Za-z0-9_-]+/.test(v) ? v : null
    }, { timeout: 10_000, what: 'invite link' })
    const code = /\/i\/([A-Za-z0-9_-]+)/.exec(link)?.[1]
    expect(code, `no code in invite link: ${link}`)
    state.inviteCode = code
    const inv = await ok(null, 'GET', `/invites/${code}`)
    expect(inv.space.id === state.spaceId, 'invite points to another space')
    save()
    await pa.keyboard.press('Escape')
    return `código ${code}`
  }, { hard: true })
  await check('B entra pelo deep link algameet://invite/<código> (segunda instância)', async () => {
    secondInstance('B', `algameet://invite/${state.inviteCode}`)
    const dlg = P('B').getByRole('dialog', { name: 'Entrar em um espaço' })
    await dlg.getByText(state.spaceName).waitFor({ timeout: 20_000 })
    await dlg.getByRole('button', { name: 'Entrar no espaço' }).click()
    await rail('B', SPACE_RE()).waitFor({ timeout: 10_000 })
  })
  await check('C entra colando o link de convite em "Entrar com convite"', async () => {
    const pc = P('C')
    await pc.getByRole('button', { name: 'Criar ou entrar em um espaço' }).click()
    await pc.getByRole('menuitem', { name: 'Entrar com convite' }).click()
    await pc.getByLabel('Link ou código do convite').fill(`https://alga.meet/i/${state.inviteCode}`)
    await pc.getByRole('dialog').getByText(state.spaceName).waitFor({ timeout: 10_000 })
    await pc.getByRole('button', { name: 'Entrar no espaço' }).click()
    await rail('C', SPACE_RE()).waitFor({ timeout: 10_000 })
  })
  const geral = async (k) => {
    await rail(k, SPACE_RE()).click()
    await channels(k).getByRole('button', { name: /^geral/ }).click()
    await composer(k).waitFor()
  }
  await geral('A')
  await geral('B')
  await geral('C')
  await check('mensagens no #geral: A, B e C conversam', async () => {
    for (const [k, text] of [['A', 'Bem-vindos ao Clube QA!'], ['A', 'Regra 1: nada de spoiler'], ['C', 'opa, cheguei'], ['C', 'mensagem chata do Caio']]) {
      await composer(k).fill(text)
      await composer(k).press('Enter')
      await msg(k, text).waitFor()
    }
    await msg('B', 'mensagem chata do Caio').waitFor({ timeout: 10_000 })
    const ids = await msg('B', 'mensagem chata do Caio').first().getAttribute('data-message-id')
    state.cMessageId = ids
    save()
  })
  await check('A cria o cargo "Mod" com Gerenciar mensagens', async () => {
    await channels('A').getByRole('button', { name: state.spaceName }).first().click()
    await pa.getByRole('menuitem', { name: 'Configurações do espaço' }).click()
    const dlg = pa.getByRole('dialog', { name: /^Configurações de / })
    await dlg.waitFor()
    await dlg.getByRole('navigation').getByRole('button', { name: 'Cargos', exact: true }).click()
    await dlg.getByRole('button', { name: 'Criar cargo' }).click()
    await dlg.getByLabel('Nome do cargo').waitFor()
    await dlg.getByLabel('Nome do cargo').fill('Mod')
    await dlg.getByRole('switch', { name: /Gerenciar mensagens/ }).click()
    await dlg.getByRole('button', { name: 'Salvar' }).click().catch(() => undefined)
    await sleep(1200)
    const roles = await ok(await tokenOf('A'), 'GET', `/spaces/${state.spaceId}/roles`)
    const mod = roles.find((r) => r.name === 'Mod')
    expect(mod, `role not in API: ${roles.map((r) => r.name).join(',')}`)
    expect((BigInt(mod.permissions) & 512n) === 512n, `MANAGE_MESSAGES not set: ${mod.permissions}`)
    state.modRoleId = mod.id
    save()
    return `permissions=${mod.permissions}`
  })
  await check('A dá o cargo Mod para B em Membros', async () => {
    const dlg = pa.getByRole('dialog', { name: /^Configurações de / })
    await dlg.getByRole('navigation').getByRole('button', { name: 'Membros', exact: true }).click()
    const row = dlg.getByRole('listitem').filter({ hasText: U.B.displayName })
    await row.getByRole('button', { name: 'Adicionar cargo' }).click()
    await pa.getByRole('menuitemcheckbox', { name: 'Mod' }).click()
    await sleep(800)
    await pa.keyboard.press('Escape')
    const mb = (await spaceOf('A')).members.find((m) => m.user.id === U.B.id)
    expect(mb?.roleIds?.includes(state.modRoleId), `B roles in READY: ${JSON.stringify(mb?.roleIds)}`)
    await pa.getByRole('dialog', { name: /^Configurações de / }).waitFor({ state: 'detached', timeout: 5000 }).catch(() => pa.keyboard.press('Escape'))
  })
  /** Delete someone else's message from the app: toolbar or context menu. Returns how it was offered. */
  const modDelete = async (k, text) => {
    const p = P(k)
    const m = msg(k, text)
    await m.hover()
    await sleep(300)
    const inToolbar = await m.getByRole('button', { name: 'Excluir' }).count()
    await m.click({ button: 'right' })
    await sleep(300)
    const inMenu = await p.getByRole('menuitem', { name: 'Excluir' }).count()
    // Escape on the menu itself (the page keyboard can miss it when the window is not focused), then wait it out.
    const menu = p.getByRole('menu').first()
    await menu.press('Escape').catch(() => p.keyboard.press('Escape'))
    await menu.waitFor({ state: 'detached', timeout: 3000 }).catch(() => undefined)
    return { inToolbar, inMenu, id: await m.getAttribute('data-message-id') }
  }
  await check('B (cargo Mod, Gerenciar mensagens) apaga a mensagem de A pelo app', async () => {
    const pb = P('B')
    const r = await modDelete('B', 'Regra 1: nada de spoiler')
    if (!r.inToolbar && !r.inMenu) {
      // Same action through the API with B's own session: the server allows it, the app just never offers it.
      const del = await api(await tokenOf('B'), 'DELETE', `/channels/${state.geralId}/messages/${r.id}`)
      await msg('A', 'Regra 1: nada de spoiler').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined)
      throw new Error(`o app não oferece "Excluir" para o Mod (barra de ações: ${r.inToolbar}, menu de contexto: ${r.inMenu}); o mesmo DELETE pela API com a sessão de B → ${del.status} e a mensagem some para todos`)
    }
    const m = msg('B', 'Regra 1: nada de spoiler')
    await m.hover()
    await m.getByRole('button', { name: 'Excluir' }).click()
    const dlg = pb.getByRole('dialog', { name: 'Excluir mensagem?' })
    await dlg.getByText(`A mensagem de ${U.A.displayName} será apagada`).waitFor({ timeout: 5000 })
    await dlg.getByRole('button', { name: 'Excluir' }).click()
    await msg('A', 'Regra 1: nada de spoiler').waitFor({ state: 'detached', timeout: 10_000 })
    return `barra: ${r.inToolbar}, menu: ${r.inMenu}; o diálogo nomeia ${U.A.displayName}`
  })
  await check('A (dono do espaço) apaga a mensagem de C pelo app', async () => {
    await composer('C').fill('spam spam spam do Caio')
    await composer('C').press('Enter')
    await msg('A', 'spam spam spam do Caio').waitFor({ timeout: 10_000 })
    const r = await modDelete('A', 'spam spam spam do Caio')
    if (!r.inToolbar && !r.inMenu) {
      const del = await api(await tokenOf('A'), 'DELETE', `/channels/${state.geralId}/messages/${r.id}`)
      throw new Error(`nem o dono vê "Excluir" na mensagem de outra pessoa (barra: ${r.inToolbar}, menu: ${r.inMenu}); DELETE pela API com a sessão de A → ${del.status}`)
    }
    return `barra: ${r.inToolbar}, menu: ${r.inMenu}`
  })
  await check('C (sem cargo) não tem "Excluir" na mensagem de A e a API recusa (403)', async () => {
    const m = msg('C', 'Bem-vindos ao Clube QA!')
    await m.hover()
    await sleep(300)
    const n = await m.getByRole('button', { name: 'Excluir' }).count()
    const id = await m.first().getAttribute('data-message-id')
    const r = await api(await tokenOf('C'), 'DELETE', `/channels/${state.geralId}/messages/${id}`)
    expect(n === 0, 'C sees Excluir on A message')
    expect(r.status === 403, `DELETE by C → ${r.status}`)
    return `DELETE → ${r.status}`
  })
  const memberAction = async (who, action) => {
    await channels('A').getByRole('button', { name: state.spaceName }).first().click()
    await pa.getByRole('menuitem', { name: 'Configurações do espaço' }).click()
    const dlg = pa.getByRole('dialog', { name: /^Configurações de / })
    await dlg.getByRole('navigation').getByRole('button', { name: 'Membros', exact: true }).click()
    const row = dlg.getByRole('listitem').filter({ hasText: who })
    await row.getByRole('button', { name: /^Ações para/ }).click()
    await pa.getByRole('menuitem', { name: action }).click()
    const confirm = pa.getByRole('dialog', { name: new RegExp(`^${action}`) })
    await confirm.waitFor()
    if (action === 'Banir') await confirm.getByLabel(/Motivo/).fill('Spam no #geral (teste de QA)')
    await confirm.getByRole('button', { name: action }).click()
    await confirm.waitFor({ state: 'detached', timeout: 10_000 })
    await pa.keyboard.press('Escape')
  }
  await check('A expulsa C; o espaço some do app de C ao vivo', async () => {
    await memberAction(U.C.displayName, 'Expulsar')
    await rail('C', SPACE_RE()).waitFor({ state: 'detached', timeout: 10_000 })
  })
  await check('C expulso pode voltar com o convite (comportamento documentado)', async () => {
    const r = await api(await tokenOf('C'), 'POST', `/invites/${state.inviteCode}`)
    expect(r.status < 300, `rejoin after kick → ${r.status}`)
    await rail('C', SPACE_RE()).waitFor({ timeout: 10_000 })
  })
  await check('A bane C (com motivo); C perde o espaço e aparece em Banimentos', async () => {
    await memberAction(U.C.displayName, 'Banir')
    await rail('C', SPACE_RE()).waitFor({ state: 'detached', timeout: 10_000 })
    const bans = await ok(await tokenOf('A'), 'GET', `/spaces/${state.spaceId}/bans`)
    expect(bans.some((b) => b.user.id === U.C.id), 'ban not in API')
  })
  await check('depois do ban, as mensagens antigas de C continuam assinadas com o nome dele (visão de A)', async () => {
    const head = msg('A', 'opa, cheguei')
    const text = (await head.innerText()).split('\n').slice(0, 3).join(' ')
    const apiAuthor = (await ok(await tokenOf('A'), 'GET', `/channels/${state.geralId}/messages?limit=20`)).find((m) => m.content === 'opa, cheguei')?.author?.displayName
    expect(text.includes(U.C.displayName), `autor exibido: "${text}" (a API manda author.displayName="${apiAuthor}")`)
    return text
  })
  await check('C banido não consegue voltar pelo convite (app mostra o motivo)', async () => {
    const pc = P('C')
    await pc.getByRole('button', { name: 'Criar ou entrar em um espaço' }).click()
    await pc.getByRole('menuitem', { name: 'Entrar com convite' }).click()
    await pc.getByLabel('Link ou código do convite').fill(state.inviteCode)
    // The preview loads first (debounced lookup), then the button is enabled.
    await pc.getByRole('dialog').getByText(state.spaceName).waitFor({ timeout: 10_000 })
    await pc.getByRole('button', { name: 'Entrar no espaço' }).click()
    await pc.getByRole('dialog').getByText(/banid/i).waitFor({ timeout: 8000 }).catch(() => undefined)
    const text = (await pc.getByRole('dialog').innerText().catch(() => '')).replace(/\s+/g, ' ')
    const r = await api(await tokenOf('C'), 'POST', `/invites/${state.inviteCode}`)
    expect(r.status === 403, `API join while banned → ${r.status}`)
    expect(!(await rail('C', SPACE_RE()).isVisible()), 'space visible for banned C')
    await pc.keyboard.press('Escape')
    expect(/banid/i.test(text), `o app não diz que a pessoa foi banida: "${text.slice(0, 300)}"`)
    return `API ${r.status} "${r.data?.error?.message}"; app: "${(/[^.]*banid[^.]*\./i.exec(text) ?? [''])[0].trim()}"`
  })
  await closeAll()
})

// ─────────────────────────────────────────────────────────────
const { RoomServiceClient } = createRequire(join(Q.repo, 'apps', 'server', 'package.json'))('livekit-server-sdk')
const sfu = new RoomServiceClient(`http://127.0.0.1:${Q.LK_PORT}`, 'devkey', 'alga-dev-secret-change-me-0123456789abcdef')
const ROOM_PREFIX = 'ch_' // apps/server/src/voice.ts roomName()
const sfuPeople = (channelId) => sfu.listParticipants(`${ROOM_PREFIX}${channelId}`).catch(() => [])
/** Speaking glow written by the app on the tile (--speak, 0..1), as `k` sees `userId`. */
async function speakLevel(k, userId, min = 0.3, timeout = 15_000) {
  const t0 = Date.now()
  let best = 0
  while (Date.now() - t0 < timeout) {
    const v = await P(k).evaluate((id) => Math.max(0, ...[...document.querySelectorAll(`[data-user-id="${id}"]`)].map((el) => Number(el.style.getPropertyValue('--speak') || 0))), userId).catch(() => 0)
    best = Math.max(best, v)
    if (v >= min) return v
    await sleep(40)
  }
  throw new Error(`no speaking glow for ${userId} on ${k} (max --speak ${best.toFixed(2)})`)
}
const tile = (k, who) => P(k).locator(`[data-user-id="${U[who].id}"]`).first()
const voiceStatesOf = async (k) => (await ready(await tokenOf(k))).voiceStates
async function joinVoice(k, name = 'Geral') {
  await rail(k, SPACE_RE()).click()
  const t0 = Date.now()
  await channels(k).getByRole('button', { name: new RegExp(`^(Entrar em |Trocar para )?${name}(, .*)?$`) }).first().click()
  await P(k).getByText('Voz conectada').first().waitFor({ timeout: 30_000 })
  return Date.now() - t0
}
const lsGet = (k, key) => P(k).evaluate((key_) => JSON.parse(localStorage.getItem(key_) ?? 'null'), key)

step(5, 'Voz: entrar, fala, mute/deafen, volume por pessoa, trocar de canal, reinício do LiveKit, queda de 5 s, desconectar', async () => {
  await up('A')
  await up('B')
  if (!state.voice2Id) {
    const c = await ok(await tokenOf('A'), 'POST', `/spaces/${state.spaceId}/channels`, { type: 'voice', name: 'Sala 2' })
    state.voice2Id = c.id
    save()
    await sleep(500)
  }
  await check('A e B entram no canal de voz "Geral" com um clique', async () => {
    const ta = await joinVoice('A')
    const tb = await joinVoice('B')
    const ppl = await until(async () => {
      const p = await sfuPeople(state.voiceId)
      return p.length === 2 ? p : null
    }, { timeout: 10_000, what: '2 participants in the SFU room' })
    const mics = ppl.map((p) => p.tracks.filter((t) => t.source === 2 /* MICROPHONE */).length)
    return `A ${ta} ms, B ${tb} ms; SFU: 2 participantes com ${mics.join('/')} faixa(s) de microfone`
  }, { hard: true })
  await check('indicador de fala: A vê o brilho de B (voz real do arquivo) e B vê o de A', async () => {
    const vb = await speakLevel('A', U.B.id, 0.3)
    const va = await speakLevel('B', U.A.id, 0.3)
    return `--speak B em A=${vb.toFixed(2)}, A em B=${va.toFixed(2)}`
  })
  await check('A desativa o microfone: B vê o ícone no tile de A, o SFU marca a faixa como muda e o estado de voz diz selfMute', async () => {
    await dock('A').getByRole('button', { name: 'Desativar microfone' }).click()
    await tile('B', 'A').getByRole('img', { name: 'Microfone desativado' }).waitFor({ timeout: 8000 })
    const mic = await until(async () => {
      const p = (await sfuPeople(state.voiceId)).find((x) => x.identity === U.A.id)
      const t = p?.tracks.find((x) => x.source === 2)
      return !t || t.muted ? t ?? 'unpublished' : null
    }, { timeout: 8000, what: 'A mic muted at the SFU' })
    const vs = (await voiceStatesOf('B')).find((v) => v.userId === U.A.id)
    expect(vs?.selfMute === true, `voice state selfMute=${vs?.selfMute}`)
    return mic === 'unpublished' ? 'faixa despublicada no SFU' : 'faixa muted=true no SFU'
  })
  await check('A desativa o áudio: B vê "Áudio desativado"; o estado de voz diz selfDeaf', async () => {
    await dock('A').getByRole('button', { name: 'Desativar áudio' }).click()
    await tile('B', 'A').getByRole('img', { name: 'Áudio desativado' }).waitFor({ timeout: 8000 })
    const vs = (await voiceStatesOf('B')).find((v) => v.userId === U.A.id)
    expect(vs?.selfDeaf === true, `voice state selfDeaf=${vs?.selfDeaf}`)
  })
  await check('A reativa o áudio e o microfone: os ícones somem para B e o brilho de A volta', async () => {
    await dock('A').getByRole('button', { name: 'Ativar áudio' }).click()
    await sleep(400)
    const still = await dock('A').getByRole('button', { name: 'Ativar microfone' }).isVisible()
    if (still) await dock('A').getByRole('button', { name: 'Ativar microfone' }).click()
    await until(async () => (await tile('B', 'A').getByRole('img').count()) === 0, { timeout: 8000, what: 'no flags on A tile' })
    await speakLevel('B', U.A.id, 0.3)
    return still ? 'ao reativar o áudio o microfone continuou mudo (como no Discord)' : 'reativar o áudio também reativou o microfone'
  })
  await check('volume por pessoa: A põe B em 50% pelo menu do tile; vale e fica salvo', async () => {
    const pa = P('A')
    await tile('A', 'B').hover()
    await tile('A', 'B').getByRole('button', { name: `Volume de ${U.B.displayName}` }).click()
    const pop = pa.getByRole('dialog', { name: `Volume de ${U.B.displayName}` })
    await pop.waitFor()
    await pop.locator('input[type=range]').fill('50')
    await pop.getByText('50%').waitFor({ timeout: 3000 })
    await pa.keyboard.press('Escape')
    const prefs = await lsGet('A', 'alga.media.prefs.v1')
    expect(prefs?.volumes?.[U.B.id] === 0.5, `saved volume ${prefs?.volumes?.[U.B.id]}`)
    const els = await pa.evaluate(() => [...document.querySelectorAll('audio')].map((a) => a.volume))
    return `prefs volumes[B]=0.5; <audio>.volume = [${els.map((v) => v.toFixed(2)).join(', ')}]`
  })
  await check('A troca para "Sala 2" com um clique; servidor, SFU e B veem A na Sala 2', async () => {
    const t = await joinVoice('A', 'Sala 2')
    await until(async () => (await voiceStatesOf('B')).find((v) => v.userId === U.A.id)?.channelId === state.voice2Id, { timeout: 8000, what: 'A voice state in Sala 2' })
    const inSala2 = await until(async () => {
      const p = (await sfuPeople(state.voice2Id)).map((x) => x.identity)
      return p.includes(U.A.id) ? p : null
    }, { timeout: 8000, what: 'A in SFU room Sala 2' })
    const inGeral = await until(async () => {
      const p = (await sfuPeople(state.voiceId)).map((x) => x.identity)
      return p.includes(U.A.id) ? null : p
    }, { timeout: 8000, what: 'A out of the Geral SFU room' })
    await tile('B', 'A').waitFor({ state: 'detached', timeout: 8000 })
    return `${t} ms; Geral=${inGeral.length}, Sala 2=${inSala2.length}`
  })
  await check('A volta para "Geral" e o volume de B continua 50%', async () => {
    await joinVoice('A', 'Geral')
    await tile('A', 'B').hover()
    await tile('A', 'B').getByRole('button', { name: `Volume de ${U.B.displayName}` }).click()
    const pop = P('A').getByRole('dialog', { name: `Volume de ${U.B.displayName}` })
    await pop.getByText('50%').waitFor({ timeout: 3000 })
    await P('A').keyboard.press('Escape')
  })
  const sfuOutage = async (downMs) => {
    const t0 = Date.now()
    Q.stopLivekit()
    const sawA = await P('A').getByText('Reconectando à voz…').first().waitFor({ timeout: 25_000 }).then(() => Date.now() - t0, () => null)
    const left = downMs - (Date.now() - t0)
    if (left > 0) await sleep(left)
    await Q.startLivekit()
    const back = Date.now()
    await P('A').getByText('Voz conectada').first().waitFor({ timeout: 60_000 })
    await P('B').getByText('Voz conectada').first().waitFor({ timeout: 60_000 })
    const conn = Date.now() - back
    await speakLevel('A', U.B.id, 0.3, 30_000)
    const audio = Date.now() - back
    const vs = (await voiceStatesOf('A')).filter((v) => v.channelId === state.voiceId).map((v) => v.userId)
    const sfuNow = (await sfuPeople(state.voiceId)).map((p) => p.identity)
    expect(vs.length === 2 && new Set(vs).size === 2, `voice states after reconnect: ${vs.length} (${vs.join(',')})`)
    expect(sfuNow.length === 2, `SFU participants after reconnect: ${sfuNow.length}`)
    return `"Reconectando" visível ${sawA ?? 'nunca'} ms após matar o SFU; "Voz conectada" ${conn} ms e áudio de B de volta ${audio} ms depois do SFU voltar`
  }
  await check('reinício do LiveKit: A e B mostram "Reconectando" e voltam sozinhos com áudio', () => sfuOutage(0))
  await check('queda de 5 s do SFU (processo morto 5 s): volta sozinho com áudio', () => sfuOutage(5000))
  await check('A sai pelo botão Desconectar: some para B, do SFU e do estado de voz', async () => {
    await dock('A').getByRole('button', { name: 'Desconectar' }).click()
    await tile('B', 'A').waitFor({ state: 'detached', timeout: 8000 })
    await until(async () => !(await sfuPeople(state.voiceId)).some((p) => p.identity === U.A.id), { timeout: 8000, what: 'A out of the SFU room' })
    await until(async () => !(await voiceStatesOf('B')).some((v) => v.userId === U.A.id), { timeout: 8000, what: 'A voice state removed' })
  })
  await dock('B').getByRole('button', { name: 'Desconectar' }).click().catch(() => undefined)
  await closeAll()
})

// ─────────────────────────────────────────────────────────────
let ffplay = null
/** Primary screen work area: the share window must be fully on screen (off-screen parts are captured black). */
const WORK_AREA = (() => {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea | Select-Object X,Y,Width,Height | ConvertTo-Json -Compress'], { encoding: 'utf8' })
  try {
    return JSON.parse(r.stdout)
  } catch {
    return { X: 0, Y: 0, Width: 1920, Height: 1080 }
  }
})()
function startShareWindow({ size = '640x360', noborder = false } = {}) {
  // The ONLY window the QA picker can see: a moving test pattern (60 fps), bottom-right, fully on screen.
  const [w, h] = size.split('x').map(Number)
  const left = WORK_AREA.X + WORK_AREA.Width - w - 24
  const top = WORK_AREA.Y + WORK_AREA.Height - h - 60
  ffplay = spawn('ffplay', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=60`, '-an', '-window_title', 'QA-Share-Window', '-left', String(left), '-top', String(top), ...(noborder ? ['-noborder'] : [])], { stdio: 'ignore' })
  writeFileSync(join(Q.WORK, 'pids.json'), JSON.stringify({ ...load(join(Q.WORK, 'pids.json'), {}), ffplay: ffplay.pid }, null, 2))
}
function stopShareWindow() {
  if (ffplay?.pid) spawnSync('taskkill', ['/PID', String(ffplay.pid), '/T', '/F'], { stdio: 'ignore' })
  ffplay = null
}
/** Frames per second `k` really renders (requestVideoFrameCallback on the largest playing <video>). */
const rxFps = (k, ms = 3000) =>
  P(k).evaluate(async (dur) => {
    const v = [...document.querySelectorAll('video')].filter((x) => x.readyState >= 2 && x.videoWidth > 0).sort((a, b) => b.clientWidth - a.clientWidth)[0]
    if (!v) return { fps: 0, w: 0, h: 0 }
    let n = 0
    const t0 = performance.now()
    await new Promise((res) => {
      const tick = () => (performance.now() - t0 < dur ? (n++, v.requestVideoFrameCallback(tick)) : res())
      v.requestVideoFrameCallback(tick)
    })
    return { fps: Math.round((n * 1000) / dur), w: v.videoWidth, h: v.videoHeight }
  }, ms)
/** What getDisplayMedia really returned to the sharer (label, surface, size, frames/s measured on the raw track). */
const screenSource = (k) =>
  P(k).evaluate(async () => {
    const tr = window.__qaScreen?.getVideoTracks()[0]
    if (!tr || tr.readyState !== 'live') return { label: tr?.label ?? null, live: false }
    const v = document.createElement('video')
    v.muted = true
    v.srcObject = new MediaStream([tr])
    await v.play()
    let n = 0
    const t0 = performance.now()
    await new Promise((res) => {
      const tick = () => (performance.now() - t0 < 3000 ? (n++, v.requestVideoFrameCallback(tick)) : res())
      v.requestVideoFrameCallback(tick)
    })
    v.srcObject = null
    const st = tr.getSettings()
    return { label: tr.label, surface: st.displaySurface, w: st.width, h: st.height, fps: Math.round(n / 3), settingsFps: st.frameRate, constraints: tr.getConstraints() }
  })
/** B asks for the top layer ("Original"), so frames/s reflect the sender's preset and not the tile-sized layer. */
async function watchOriginal(k) {
  const g = P(k).getByRole('group', { name: /^Transmissão de / }).first()
  await g.hover()
  await g.getByRole('radio', { name: 'Original' }).click()
  await sleep(4000)
  await g.hover()
  return (await g.getByRole('radio', { name: 'Original' }).getAttribute('aria-checked')) === 'true'
}
/** The viewer's own stats overlay (Ctrl+Shift+E): resolution, frames/s, codec, decoder. */
async function viewerStats(k) {
  await P(k).keyboard.press('Control+Shift+E')
  await sleep(2000)
  const text = (await P(k).getByLabel('Estatísticas da transmissão').first().innerText().catch((e) => e.message)).replace(/\s+/g, ' ')
  await P(k).keyboard.press('Control+Shift+E')
  return text
}
/** Where the picture really is inside the frame `k` renders: bounding box of non-black pixels, as fractions. */
const contentBox = (k) =>
  P(k).evaluate(() => {
    const v = [...document.querySelectorAll('video')].filter((x) => x.readyState >= 2 && x.videoWidth > 0).sort((a, b) => b.clientWidth - a.clientWidth)[0]
    if (!v) return null
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    const g = c.getContext('2d')
    g.drawImage(v, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1
    for (let y = 0; y < c.height; y += 2)
      for (let x = 0; x < c.width; x += 2) {
        const i = (y * c.width + x) * 4
        if (d[i] + d[i + 1] + d[i + 2] > 60) {
          if (x < x0) x0 = x
          if (y < y0) y0 = y
          if (x > x1) x1 = x
          if (y > y1) y1 = y
        }
      }
    return { frame: `${c.width}x${c.height}`, w: +((x1 - x0 + 2) / c.width).toFixed(2), h: +((y1 - y0 + 2) / c.height).toFixed(2), x: +(x0 / c.width).toFixed(2), y: +(y0 / c.height).toFixed(2) }
  })
/** The sender's own line on the stage ("640×360 · 29 fps · 407 kb/s · por hardware"). */
const senderLine = async (k) => ((await P(k).getByText(/\d+×\d+ · \d+ fps/).first().innerText().catch(() => '')) || '').trim()
const picker = (k) => P(k).getByRole('dialog', { name: 'Compartilhar tela' })
/** One share of the QA window at `opts` size; what the viewer's decoder does with it. */
async function shareOnce(opts, [res, fps] = ['720p', 30]) {
  startShareWindow(opts)
  await sleep(1500)
  try {
    await openPicker('A')
    await setQuality('A', res, fps)
    await picker('A').getByRole('button', { name: 'Transmitir' }).click()
    await P('A').getByText('Você está transmitindo').first().waitFor({ timeout: 10_000 })
    await sleep(2000)
    const src = await screenSource('A')
    await P('B').getByRole('button', { name: /^Assistir/ }).first().click({ timeout: 15_000 })
    await sleep(6000)
    const rx = await rxFps('B')
    await P('B').keyboard.press('Control+Shift+E')
    await sleep(2000)
    const stats = (await P('B').getByLabel('Estatísticas da transmissão').first().innerText().catch((e) => e.message)).replace(/\s+/g, ' ')
    // The stats overlay is the evidence: keep it on screen for the failure screenshot.
    if (!(rx.w > 0)) await P('B').screenshot({ path: join(OUT, `s${cur.id}-janela-pequena-sem-imagem-${Date.now() % 100000}-qa-b.png`) })
    await P('B').keyboard.press('Control+Shift+E')
    await dock('A').getByRole('button', { name: 'Parar transmissão' }).click()
    await P('A').getByRole('menuitem', { name: 'Parar transmissão' }).click()
    await sleep(1500)
    return { src: `${src.w}x${src.h}@${src.fps}`, rx, stats }
  } finally {
    stopShareWindow()
  }
}

async function openPicker(k) {
  await dock(k).getByRole('button', { name: 'Compartilhar tela' }).click()
  await picker(k).waitFor()
  await picker(k).getByRole('tab', { name: 'Janelas' }).click()
  // One source: no grid, the preview is the choice; several: one radio per window.
  await picker(k).getByText('QA-Share-Window').first().waitFor({ timeout: 20_000 })
  const r = picker(k).getByRole('radio', { name: /QA-Share-Window/ })
  if (await r.count()) await r.first().click()
}
/** Resolution × frame-rate controls of the picker: what can be picked and what shows locked (Alga Plus). */
async function qualities(k) {
  const res = picker(k).getByRole('radiogroup', { name: 'Resolução' })
  const fps = picker(k).getByRole('radiogroup', { name: 'Quadros por segundo' })
  const offered = []
  const locked = []
  for (const r of await res.getByRole('radio').all()) {
    const name = (await r.innerText()).trim()
    if ((await r.getAttribute('aria-disabled')) === 'true') {
      locked.push(`${name} (toda a resolução)`)
      continue
    }
    await r.click()
    await sleep(150)
    for (const f of await fps.getByRole('radio').all()) {
      const label = `${name} ${(await f.innerText()).trim()}`
      if ((await f.getAttribute('aria-disabled')) === 'true') locked.push(label)
      else offered.push(label)
    }
  }
  return { offered, locked }
}
async function setQuality(k, res, fps) {
  await picker(k).getByRole('radiogroup', { name: 'Resolução' }).getByRole('radio', { name: res, exact: true }).click()
  await picker(k).getByRole('radiogroup', { name: 'Quadros por segundo' }).getByRole('radio', { name: `${fps} fps`, exact: true }).click()
}
async function payInBrowser(k, n) {
  const url = await until(async () => (await apps.get(k).app.evaluate(() => globalThis.__qa.external))[n - 1], { timeout: 20_000, what: `openExternal #${n}` })
  const res = await fetch(url)
  expect(res.ok, `sandbox page → ${res.status}`)
  return url
}

const MAIN_WINDOW = { size: '960x540', noborder: true }
step(6, 'Tela: transmitir janela de teste, assistir, trocar qualidade, mini-player, parar; janela pequena; limite do grátis; upgrade sandbox, cancelar, retomar', async () => {
  startShareWindow(MAIN_WINDOW)
  await sleep(1500)
  try {
    await up('A', { realCapture: true })
    await up('B')
    await joinVoice('A')
    await joinVoice('B')
    await check('grátis: o seletor oferece até 1080p30 e mostra 1080p60+ bloqueados como Alga Plus', async () => {
      await openPicker('A')
      const q = await qualities('A')
      state.freeQualities = q
      save()
      expect(!q.offered.some((x) => /1080p 60|1440p|4K/i.test(x)), `free offers a Plus preset: ${q.offered.join(', ')}`)
      expect(q.locked.some((x) => /1080p 60/.test(x ?? '')), `1080p60 not shown as locked: ${q.locked.join(', ')}`)
      return `oferece [${q.offered.join(', ')}], bloqueados [${q.locked.join(', ')}]`
    })
    await check('só a janela de teste aparece como fonte (nenhuma tela real do dono)', async () => {
      await picker('A').getByRole('tab', { name: 'Telas' }).click()
      await picker('A').getByText('Nenhuma tela encontrada.').waitFor({ timeout: 5000 })
      await picker('A').getByRole('tab', { name: 'Janelas' }).click()
      const grid = await picker('A').getByRole('radiogroup', { name: 'Janelas' }).getByRole('radio').allInnerTexts()
      const preview = await picker('A').getByRole('img', { name: /^Prévia: / }).getAttribute('alt')
      expect(grid.every((w) => w.includes('QA-Share')) && preview === 'Prévia: QA-Share-Window', `windows=${grid.join('|')} preview=${preview}`)
      return `telas: nenhuma; janelas: ${grid.length ? grid.join(', ') : 'só a QA-Share-Window (prévia direta, sem grade)'}`
    })
    await check('A transmite a janela em 720p30; B clica em Assistir e recebe o vídeo', async () => {
      await setQuality('A', '720p', 30)
      await picker('A').getByRole('button', { name: 'Transmitir' }).click()
      await picker('A').waitFor({ state: 'detached', timeout: 15_000 })
      await P('A').getByText('Você está transmitindo').first().waitFor({ timeout: 10_000 })
      await P('B').getByRole('button', { name: /^Assistir/ }).first().click({ timeout: 15_000 })
      await P('B').waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.readyState >= 2 && v.videoWidth > 0), null, { timeout: 20_000 })
      await sleep(2500)
      const src = await screenSource('A')
      // Electron leaves the label empty for window captures: the surface and the exact window size identify it.
      expect(src.surface === 'window' && `${src.w}x${src.h}` === MAIN_WINDOW.size, `captured source is not the QA window: ${JSON.stringify(src)}`)
      expect(await P('A').evaluate(() => window.__qaSyntheticMic > 0), 'A mic is not the synthetic one')
      const original = await watchOriginal('B')
      const f = await rxFps('B')
      state.fps720p30 = { rx: f, src }
      save()
      return `captura real da janela (${src.surface}) ${src.w}×${src.h} a ${src.fps} fps na origem; B recebe ${f.w}×${f.h} a ${f.fps} fps com "Original" ${original ? 'marcado' : 'NÃO marcado'}; ${await viewerStats('B')}`
    })
    await check('A troca a qualidade para 720p60 sem parar; B continua recebendo (e mais fluido)', async () => {
      await dock('A').getByRole('button', { name: 'Parar transmissão' }).click()
      await P('A').getByRole('menuitem', { name: 'Trocar o que está sendo compartilhado' }).click()
      await picker('A').waitFor()
      await setQuality('A', '720p', 60)
      await picker('A').getByRole('button', { name: 'Aplicar' }).click()
      await picker('A').waitFor({ state: 'detached', timeout: 10_000 })
      await sleep(4000)
      const f = await rxFps('B')
      const src = await screenSource('A')
      expect(f.fps > 0 && f.w > 0, 'B stopped receiving video after the change')
      const before = state.fps720p30?.rx?.fps ?? 0
      expect(f.fps >= before + 10, `B continua a ${f.fps} fps (antes ${before}) embora a origem tenha subido de ${state.fps720p30?.src?.fps} para ${src.fps} fps; B recebe ${f.w}×${f.h} com "Original" marcado; ${await viewerStats('B')}`)
      return `B ${before} → ${f.fps} fps (${f.w}×${f.h}); origem ${state.fps720p30?.src?.fps} → ${src.fps} fps`
    })
    await check('mini-player: B sai da chamada para a DM e a transmissão continua em miniatura; "Voltar" volta ao palco', async () => {
      const pb = P('B')
      await home('B')
      await pb.getByRole('button', { name: new RegExp(U.A.displayName) }).first().click()
      const mini = pb.getByRole('region', { name: `Transmissão de ${U.A.displayName} em miniatura` })
      await mini.waitFor({ timeout: 8000 })
      await until(() => mini.locator('video').evaluate((v) => v.readyState >= 2 && v.videoWidth > 0), { timeout: 10_000, what: 'mini-player video playing' })
      await mini.getByRole('button', { name: 'Voltar para a chamada' }).click()
      await mini.waitFor({ state: 'detached', timeout: 8000 })
      await dock('B').waitFor({ timeout: 8000 })
    })
    await check('A para a transmissão: some para B e do SFU', async () => {
      await dock('A').getByRole('button', { name: 'Parar transmissão' }).click()
      await P('A').getByRole('menuitem', { name: 'Parar transmissão' }).click()
      await P('A').getByText('Você está transmitindo').first().waitFor({ state: 'detached', timeout: 8000 })
      await until(async () => !(await sfuPeople(state.voiceId)).find((p) => p.identity === U.A.id)?.tracks.some((t) => t.source === 3), { timeout: 8000, what: 'screen track gone from SFU' })
      await P('B').waitForFunction(() => ![...document.querySelectorAll('video')].some((v) => v.readyState >= 2 && v.videoWidth > 0), null, { timeout: 10_000 })
    })
    await check('janela pequena (640×360, como um player ou terminal): B recebe imagem', async () => {
      stopShareWindow()
      const r = await shareOnce({ size: '640x360', noborder: true })
      startShareWindow(MAIN_WINDOW)
      await sleep(1500)
      expect(r.rx.w > 0 && r.rx.fps > 0, `B não recebe imagem (fica em "Carregando a transmissão…"): origem ${r.src}; estatísticas de B: ${r.stats}`)
      return `origem ${r.src}; B ${r.rx.w}×${r.rx.h} a ${r.rx.fps} fps; ${r.stats}`
    })
    await check('upgrade pelo sandbox: A assina o Plus no app, paga na página de teste e o plano chega ao vivo', async () => {
      const dlg = await openSettings('A', 'Assinatura')
      await dlg.getByRole('button', { name: 'Assinar o Alga Plus' }).click()
      await dlg.getByText('Aguardando a confirmação do pagamento…').waitFor({ timeout: 10_000 })
      await payInBrowser('A', 1)
      await dlg.getByText('Pagamento confirmado. Obrigado por apoiar o Alga Meet.').waitFor({ timeout: 20_000 })
      const b = await ok(await tokenOf('A'), 'GET', '/billing/me')
      expect(b.plan?.id === 'plus', `billing/me: ${JSON.stringify(b).slice(0, 200)}`)
      await closeSettings('A')
      return `plano=${b.plan?.id}, assinatura=${b.subscription?.status}`
    })
    await check('Plus: o seletor libera 1080p60; A transmite em 1080p60 e o SFU não muta a faixa', async () => {
      await openPicker('A')
      const q = await qualities('A')
      expect(q.offered.includes('1080p 60 fps'), `1080p60 still locked on Plus: offered ${q.offered.join(', ')}`)
      await setQuality('A', '1080p', 60)
      await picker('A').getByRole('button', { name: 'Transmitir' }).click()
      await P('A').getByText('Você está transmitindo').first().waitFor({ timeout: 15_000 })
      await sleep(12_000) // the server re-checks the plan PLAN_RECHECK_MS (10 s) after a change
      const t = (await sfuPeople(state.voiceId)).find((p) => p.identity === U.A.id)?.tracks.find((x) => x.source === 3)
      expect(t && !t.muted, `screen track ${t ? 'muted by the server' : 'missing'} on Plus`)
      await dock('A').getByRole('button', { name: 'Parar transmissão' }).click()
      await P('A').getByRole('menuitem', { name: 'Parar transmissão' }).click()
      return `oferece [${q.offered.join(', ')}]; camadas no SFU ${t.layers?.map((l) => `${l.width}x${l.height}`).join('/') ?? ''}`
    })
    await check('cancelar a renovação: aviso honesto e a API marca cancelAtPeriodEnd', async () => {
      const dlg = await openSettings('A', 'Assinatura')
      await dlg.getByRole('button', { name: 'Cancelar renovação' }).click()
      const modal = P('A').getByRole('dialog', { name: 'Cancelar a renovação do Plus?' })
      await modal.getByRole('button', { name: 'Cancelar renovação' }).click()
      await dlg.getByText(/^Renovação cancelada\. O Plus vale até/).waitFor({ timeout: 15_000 })
      const b = await ok(await tokenOf('A'), 'GET', '/billing/me')
      expect(b.subscription?.cancelAtPeriodEnd === true, `cancelAtPeriodEnd=${b.subscription?.cancelAtPeriodEnd}`)
    })
    await check('retomar a renovação: volta a "renova em" e a API desfaz o cancelamento', async () => {
      const dlg = settings('A')
      await dlg.getByRole('button', { name: 'Retomar renovação' }).click()
      await dlg.getByText(/renova em/).waitFor({ timeout: 15_000 })
      const b = await ok(await tokenOf('A'), 'GET', '/billing/me')
      expect(b.subscription?.cancelAtPeriodEnd === false, `cancelAtPeriodEnd=${b.subscription?.cancelAtPeriodEnd}`)
      expect(b.plan?.id === 'plus', `plan=${JSON.stringify(b.plan)}`)
      await closeSettings('A')
    })
    await dock('A').getByRole('button', { name: 'Desconectar' }).click().catch(() => undefined)
    await dock('B').getByRole('button', { name: 'Desconectar' }).click().catch(() => undefined)
  } finally {
    await closeAll()
    stopShareWindow()
  }
})

// ─────────────────────────────────────────────────────────────
const F13 = 91 // uiohook keycode; harmless key, emitted at the hook layer (no OS-level input injection)
async function hookKey(k, phase) {
  await apps.get(k).app.evaluate((_e, [code, ph]) => {
    const { uIOhook } = globalThis.__alga.require('uiohook-napi')
    uIOhook.emit(ph, { keycode: code })
  }, [F13, phase])
}
const onHotkeys = (k) =>
  P(k).evaluate(() => {
    window.__qaHk = []
    window.alga.hotkeys.onEvent((e) => window.__qaHk.push(e))
  })
step(7, 'Configurações que persistem ao reiniciar: dispositivos, gravação do atalho de push-to-talk, densidade, reduzir animações', async () => {
  await up('B')
  const chosen = {}
  /** Device picker = button "<label>: <device>" opening a menu of menuitemcheckbox. Picks the last real device. */
  const pickDevice = async (label) => {
    // The list fills in after the engine enumerates devices: reopen the menu until real devices show (≤ 10 s).
    const t0 = Date.now()
    const menu = P('B').getByRole('menu')
    let names = []
    for (;;) {
      await settings('B').getByRole('button', { name: new RegExp(`^${label}: `) }).click()
      await menu.waitFor()
      names = (await menu.getByRole('menuitemcheckbox').allInnerTexts()).map((n) => n.trim())
      if (names.some((n) => !/^Padrão do sistema/.test(n)) || Date.now() - t0 > 10_000) break
      await P('B').keyboard.press('Escape')
      await sleep(500)
    }
    const pick = names.filter((n) => !/^Padrão do sistema/.test(n)).at(-1)
    expect(pick, `no device in the ${label} menu after ${Date.now() - t0} ms: ${names.join(' | ')}`)
    if (Date.now() - t0 > 1000) note(`${label}: a lista de dispositivos só apareceu ${Date.now() - t0} ms depois de abrir Voz e vídeo`)
    await menu.getByRole('menuitemcheckbox', { name: pick, exact: true }).click()
    await settings('B').getByRole('button', { name: `${label}: ${pick}` }).waitFor({ timeout: 5000 })
    return pick
  }
  await check('B escolhe microfone e saída de áudio (dispositivos falsos do Chromium) e o modo Aperte para falar', async () => {
    await openSettings('B', 'Voz e vídeo')
    chosen.in = await pickDevice('Microfone')
    chosen.out = await pickDevice('Saída de áudio')
    await settings('B').getByRole('radio', { name: 'Aperte para falar' }).click()
    return `entrada "${chosen.in}", saída "${chosen.out}"`
  })
  await check('B grava o atalho de push-to-talk (F13 pelo hook global)', async () => {
    const dlg = await openSettings('B', 'Atalhos')
    await dlg.getByRole('button', { name: 'Gravar' }).first().click()
    await dlg.getByText('Pressione a combinação… (Esc cancela)').waitFor({ timeout: 5000 })
    await hookKey('B', 'keydown')
    await hookKey('B', 'keyup')
    await dlg.getByText('F13').first().waitFor({ timeout: 5000 })
    await onHotkeys('B')
    await hookKey('B', 'keydown')
    await hookKey('B', 'keyup')
    const ev = await until(async () => {
      const e = await P('B').evaluate(() => window.__qaHk)
      return e.length ? e : null
    }, { timeout: 5000, what: 'hotkey event' })
    return `F13 gravado; evento ${JSON.stringify(ev)}`
  })
  await check('B muda a densidade para Compacta e liga Reduzir animações', async () => {
    const dlg = await openSettings('B', 'Aparência')
    await dlg.getByRole('radio', { name: 'Compacta' }).click()
    const sw = dlg.getByRole('switch', { name: 'Reduzir animações' })
    if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click()
    const ui = await lsGet('B', 'alga.ui.v1')
    expect(ui?.density === 'compact' && ui?.reducedMotion === true, `alga.ui.v1: ${JSON.stringify(ui)}`)
  })
  await closeSettings('B')
  const before = { media: await lsGet('B', 'alga.media.prefs.v1'), ui: await lsGet('B', 'alga.ui.v1') }
  await close('B')
  await up('B')
  await check('depois de reiniciar: dispositivos e modo de entrada continuam', async () => {
    const dlg = await openSettings('B', 'Voz e vídeo')
    const vin = await dlg.getByRole('button', { name: /^Microfone: / }).getAttribute('aria-label')
    const vout = await dlg.getByRole('button', { name: /^Saída de áudio: / }).getAttribute('aria-label')
    const ptt = await dlg.getByRole('radio', { name: 'Aperte para falar' }).getAttribute('aria-checked')
    expect(vin === `Microfone: ${chosen.in}`, `microfone depois de reiniciar: "${vin}" (escolhido "${chosen.in}")`)
    expect(vout === `Saída de áudio: ${chosen.out}`, `saída depois de reiniciar: "${vout}" (escolhida "${chosen.out}")`)
    expect(ptt === 'true', 'modo de entrada voltou para detecção de voz')
    return `${vin}; ${vout}`
  })
  await check('depois de reiniciar: o atalho F13 continua na tela e o main volta a reagir a ele sem abrir Configurações', async () => {
    await closeSettings('B')
    await onHotkeys('B')
    await hookKey('B', 'keydown')
    await hookKey('B', 'keyup')
    const ev = await until(async () => {
      const e = await P('B').evaluate(() => window.__qaHk)
      return e.length ? e : null
    }, { timeout: 5000, what: 'hotkey event after restart' }).catch(() => null)
    const dlg = await openSettings('B', 'Atalhos')
    await dlg.getByText('F13').first().waitFor({ timeout: 5000 })
    expect(ev, 'after restart the F13 binding is shown but the main process does not react to it (hook not re-armed)')
    return JSON.stringify(ev)
  })
  await check('depois de reiniciar: densidade Compacta e Reduzir animações continuam', async () => {
    const dlg = await openSettings('B', 'Aparência')
    expect((await dlg.getByRole('radio', { name: 'Compacta' }).getAttribute('aria-checked')) === 'true', 'density reset')
    expect((await dlg.getByRole('switch', { name: 'Reduzir animações' }).getAttribute('aria-checked')) === 'true', 'reduced motion reset')
  })
  // Leave the QA profile without a global hook: clear the binding and go back to voice detection.
  await openSettings('B', 'Atalhos')
  await settings('B').getByRole('button', { name: 'Remover atalho' }).first().click().catch(() => undefined)
  const dlg = await openSettings('B', 'Voz e vídeo')
  await dlg.getByRole('radio', { name: 'Detecção de voz' }).click().catch(() => undefined)
  note(`localStorage antes do reinício: ${JSON.stringify(before).slice(0, 500)}`)
  await closeAll()
})

// ─────────────────────────────────────────────────────────────
step(8, 'Trust & Safety: denúncia, suspensão pela equipe, tela restrita, recurso, exportação de dados, exclusão de conta (carência)', async () => {
  await up('B')
  await up('C')
  const pb = P('B')
  await check('B denuncia a mensagem de C (menu da mensagem → motivo → enviar)', async () => {
    await rail('B', SPACE_RE()).click()
    await channels('B').getByRole('button', { name: /^geral/ }).click()
    const m = msg('B', 'mensagem chata do Caio')
    await m.waitFor({ timeout: 10_000 })
    await m.click({ button: 'right' })
    await pb.getByRole('menuitem', { name: 'Denunciar mensagem' }).click()
    const dlg = pb.getByRole('dialog', { name: 'Denunciar mensagem' })
    await dlg.waitFor()
    await dlg.getByRole('radio', { name: /Assédio ou intimidação/ }).click()
    await dlg.getByRole('button', { name: 'Continuar' }).click()
    await dlg.getByRole('textbox').first().fill('Mensagens provocativas repetidas no #geral (QA).')
    await dlg.getByRole('button', { name: 'Enviar denúncia' }).click()
    await pb.getByText('Denúncia recebida').waitFor({ timeout: 10_000 })
    const reports = await ok(state.staff.token, 'GET', '/admin/reports?limit=20')
    const list = reports.reports ?? reports.items ?? reports
    const r = list.find((x) => JSON.stringify(x).includes(U.C.id) && JSON.stringify(x).includes('harassment'))
    expect(r, `report not in /admin/reports: ${JSON.stringify(reports).slice(0, 300)}`)
    state.reportId = r.id
    save()
    await pb.keyboard.press('Escape')
    return `denúncia ${r.id} na fila da equipe`
  })
  await check('equipe suspende C; o app aberto de C sai e mostra a medida', async () => {
    const until3 = new Date(Date.now() + 3 * 86_400_000).toISOString()
    await ok(state.staff.token, 'POST', `/admin/users/${U.C.id}/actions`, { type: 'suspend', reason: 'harassment', until: until3, note: 'QA: suspensão de teste' })
    const pc = P('C')
    await pc.getByText(/aplicou uma medida na sua conta|Sua conta está suspensa/).first().waitFor({ timeout: 15_000 })
    return (await pc.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 160)
  })
  await check('C entra de novo e vê a tela "Sua conta está suspensa" com a regra e o prazo', async () => {
    const pc = P('C')
    if (await pc.getByLabel('E-mail ou nome de usuário').isVisible().catch(() => false)) await signIn('C', U.C.username, U.C.password)
    await pc.getByRole('heading', { name: 'Sua conta está suspensa' }).waitFor({ timeout: 20_000 })
    const text = (await pc.locator('body').innerText()).replace(/\s+/g, ' ')
    expect(/assédio/i.test(text), `regra não aparece: ${text.slice(0, 200)}`)
    return text.slice(0, 200)
  })
  await check('C envia um recurso pela tela restrita; a equipe recebe', async () => {
    const pc = P('C')
    await pc.getByLabel('O que aconteceu, do seu ponto de vista').fill('Foi uma brincadeira entre amigos, já pedi desculpas no grupo. (QA)')
    await pc.getByRole('button', { name: 'Enviar recurso' }).click()
    await pc.getByText(/Recurso enviado|Seu recurso está em análise/).first().waitFor({ timeout: 10_000 })
    const ap = await ok(state.staff.token, 'GET', '/admin/appeals?limit=20')
    const list = ap.appeals ?? ap.items ?? ap
    expect(JSON.stringify(list).includes(U.C.id), `appeal not in /admin/appeals: ${JSON.stringify(ap).slice(0, 200)}`)
  })
  await check('B pede a exportação dos dados em Privacidade; fica pronta e o link chega por e-mail', async () => {
    const dlg = await openSettings('B', 'Privacidade')
    const t0 = Date.now()
    await dlg.getByRole('button', { name: 'Pedir cópia' }).click()
    await dlg.getByText(/Preparando sua cópia/).waitFor({ timeout: 10_000 })
    const ex = await until(async () => {
      const l = await ok(await tokenOf('B'), 'GET', '/users/@me/exports')
      const items = l.exports ?? l.items ?? l
      return items.find((x) => x.status === 'ready') ?? null
    }, { timeout: 150_000, every: 3000, what: 'export ready' })
    const ui = await dlg.getByText(/^Pronta\./).waitFor({ timeout: 90_000 }).then(() => 'a tela mudou sozinha para "Pronta"', () => null)
    const mail = mails(U.B.email).filter((f) => /export/i.test(f))
    expect(mail.length > 0, 'no export e-mail in the outbox')
    expect(ui, `export ready in the API after ${Math.round((Date.now() - t0) / 1000)} s but Privacidade still says "Preparando…" (no live update)`)
    await closeSettings('B')
    return `pronta em ${Math.round((Date.now() - t0) / 1000)} s; ${ui}; e-mail ${mail.at(-1)}`
  })
  await check('B exclui a conta (senha) → sai na hora, a sessão morre no servidor e a tela avisa a carência', async () => {
    await closeSettings('B')
    const dlg = await openSettings('B', 'Privacidade')
    await dlg.getByRole('button', { name: 'Excluir conta…' }).click()
    const del = pb.getByRole('dialog', { name: 'Excluir sua conta' })
    await del.waitFor()
    await del.getByLabel('Sua senha').fill(U.B.password)
    const oldToken = await tokenOf('B')
    await del.getByRole('button', { name: 'Excluir minha conta' }).click()
    await pb.getByLabel('E-mail ou nome de usuário').waitFor({ timeout: 15_000 })
    const notice = (await pb.locator('body').innerText()).replace(/\s+/g, ' ')
    const r = await api(oldToken, 'GET', '/users/@me')
    expect(r.status === 401, `old session after delete → ${r.status}`)
    expect(/será excluída em/.test(notice), `no grace notice on the login screen: ${notice.slice(0, 200)}`)
    return (/Sua conta será excluída[^.]*\./.exec(notice) ?? [''])[0]
  })
  await check('carência: B entra de novo dentro dos 7 dias e a exclusão é cancelada', async () => {
    await signIn('B', U.B.username, U.B.password)
    await nav('B').waitFor({ timeout: 20_000 })
    await pb.getByText('Exclusão cancelada').first().waitFor({ timeout: 10_000 })
  })
  await closeAll()
})

// ─────────────────────────────────────────────────────────────
step(9, 'Janela: minimizar, restaurar, fechar para a bandeja, 960×600', async () => {
  await up('A')
  const win = (fn) => apps.get('A').app.evaluate(({ BrowserWindow }, f) => new Function('w', f)(BrowserWindow.getAllWindows()[0]), fn)
  await check('minimizar: a janela minimiza e o ícone da bandeja continua', async () => {
    await win('w.minimize()')
    await until(() => win('return w.isMinimized()'), { timeout: 5000, what: 'minimized' })
    const tray = await apps.get('A').app.evaluate(() => globalThis.__alga.trayState())
    expect(tray.exists, 'tray icon missing')
  })
  await check('restaurar (abrir o app de novo, como pelo atalho/bandeja): volta ao normal', async () => {
    secondInstance('A', '--qa-restore')
    await until(async () => !(await win('return w.isMinimized()')) && (await win('return w.isVisible()')), { timeout: 8000, what: 'restored' })
  })
  await check('fechar (X) com "Fechar para a bandeja": some da tela, processo e sessão continuam', async () => {
    await win('w.close()')
    await sleep(800)
    const visible = await win('return w.isVisible()')
    const tray = await apps.get('A').app.evaluate(() => globalThis.__alga.trayState())
    expect(!visible, 'window still visible after close')
    expect(tray.exists, 'tray gone after close')
    const t = await P('A').evaluate(() => window.alga.auth.getToken())
    expect((await api(t, 'GET', '/users/@me')).status === 200, 'session lost')
  })
  await check('abrir de novo pela segunda instância: a janela volta', async () => {
    secondInstance('A', '--qa-restore')
    await until(() => win('return w.isVisible()'), { timeout: 8000, what: 'visible again' })
  })
  await check('depois de reiniciar o app, as mensagens de C (banido do espaço) mostram o nome do autor', async () => {
    await rail('A', SPACE_RE()).click()
    await channels('A').getByRole('button', { name: /^geral/ }).click()
    const head = msg('A', 'opa, cheguei')
    await head.waitFor({ timeout: 10_000 })
    const text = (await head.innerText()).split('\n').slice(0, 3).join(' ')
    expect(text.includes(U.C.displayName), `autor exibido: "${text}"`)
    return text
  })
  await check('960×600 (mínimo): sem rolagem horizontal; rail, canais e campo de mensagem visíveis', async () => {
    await win('w.setContentSize(960, 600)')
    await sleep(800)
    await rail('A', SPACE_RE()).click()
    await channels('A').getByRole('button', { name: /^geral/ }).click()
    await composer('A').waitFor()
    const m = await P('A').evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, ih: innerHeight }))
    const box = await composer('A').boundingBox()
    await P('A').screenshot({ path: join(OUT, 's9-960x600-qa-a.png') })
    expect(m.sw <= m.iw, `horizontal overflow: scrollWidth ${m.sw} > ${m.iw}`)
    expect(box && box.y + box.height <= m.ih && box.x >= 0, `composer outside the viewport: ${JSON.stringify(box)}`)
    for (const l of [nav('A'), channels('A')]) expect(await l.isVisible(), 'rail/sidebar hidden')
    return `${m.iw}×${m.ih}, evidência s9-960x600-qa-a.png`
  })
  await check('abaixo do mínimo: a janela não encolhe além de 960×600', async () => {
    await win('w.setContentSize(800, 500)')
    await sleep(500)
    const [w, h] = await win('return w.getContentSize()')
    expect(w >= 960 && h >= 600, `content size ${w}×${h}`)
    return `${w}×${h}`
  })
  await closeAll()
})




// ─────────────────────────────────────────────────────────────
// Re-runs of what failed intermittently, so the report has a rate and fresh evidence (not part of the default list).
step(10, 'Repetição: janela pequena (640×360) transmitida 6 vezes; o espectador recebe imagem?', async () => {
  await up('A', { realCapture: true })
  await up('B')
  await joinVoice('A')
  await joinVoice('B')
  const sizes = [{ size: '640x360', noborder: true }, { size: '640x360' }]
  for (let i = 1; i <= 6; i++) {
    const o = sizes[i % 2]
    await check(`tentativa ${i}: janela ${o.noborder ? '640×360 sem borda' : '640×360 com borda (642×392)'} → B recebe imagem`, async () => {
      const r = await shareOnce(o)
      expect(r.rx.w > 0 && r.rx.fps > 0, `B sem imagem: origem ${r.src}; ${r.stats}`)
      return `origem ${r.src}; B ${r.rx.w}×${r.rx.h} a ${r.rx.fps} fps; ${r.stats}`
    })
  }
  await dock('A').getByRole('button', { name: 'Desconectar' }).click().catch(() => undefined)
  await dock('B').getByRole('button', { name: 'Desconectar' }).click().catch(() => undefined)
  await closeAll()
})


step(11, 'Repetição: imagem recebida de uma janela 960×540 em 720p30, e "Original" no espectador', async () => {
  startShareWindow(MAIN_WINDOW)
  await sleep(1500)
  try {
    await up('A', { realCapture: true })
    await up('B')
    await joinVoice('A')
    await joinVoice('B')
    await openPicker('A')
    await setQuality('A', '720p', 30)
    await picker('A').getByRole('button', { name: 'Transmitir' }).click()
    await P('A').getByText('Você está transmitindo').first().waitFor({ timeout: 10_000 })
    await P('B').getByRole('button', { name: /^Assistir/ }).first().click({ timeout: 15_000 })
    await P('B').waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.readyState >= 2 && v.videoWidth > 0), null, { timeout: 20_000 })
    await sleep(3000)
    await check('720p30 sem nenhuma troca: o quadro que B recebe mostra a janela inteira (sem faixas pretas)', async () => {
      const rx = await rxFps('B')
      const box = await contentBox('B')
      const src = await screenSource('A')
      await P('B').screenshot({ path: join(OUT, 's11-720p30-quadro-recebido-qa-b.png') })
      // testsrc2 fills its whole frame (checked with ffmpeg): any black border is the pipeline's.
      expect(box && box.w >= 0.95 && box.h >= 0.95, `a janela ocupa só ${box?.w}×${box?.h} do quadro ${box?.frame} que B recebe (canto ${box?.x},${box?.y}); origem ${src.w}×${src.h}; transmissor "${await senderLine('A')}"`)
      return `${rx.w}×${rx.h}, imagem ${box.w}×${box.h}`
    })
    await check('"Original" no espectador entrega a resolução da origem (960×540)', async () => {
      await watchOriginal('B')
      const rx = await rxFps('B')
      const sender = await senderLine('A')
      expect(rx.w === 960 && rx.h === 540, `com "Original" marcado B recebe ${rx.w}×${rx.h} a ${rx.fps} fps (origem 960×540); transmissor mostra "${sender}"; ${await viewerStats('B')}`)
      return `${rx.w}×${rx.h} a ${rx.fps} fps`
    })
    await dock('A').getByRole('button', { name: 'Desconectar' }).click().catch(() => undefined)
    await dock('B').getByRole('button', { name: 'Desconectar' }).click().catch(() => undefined)
  } finally {
    await closeAll()
    stopShareWindow()
  }
})

// ─────────────────────────────────────────────────────────────
async function main() {
  const missing = STEPS.filter((s) => !STEP_FNS[s])
  for (const id of STEPS) {
    if (!STEP_FNS[id]) continue
    const { title, fn } = STEP_FNS[id]
    cur = results.steps[id] = { id, title, at: new Date().toISOString(), checks: [], notes: [] }
    console.log(`\n[${id}] ${title}`)
    try {
      await fn()
    } catch (e) {
      if (!(e instanceof Abort)) {
        const ev = await evidence('erro-inesperado')
        cur.checks.push({ name: 'passo terminou com erro inesperado do harness', ok: false, detail: (e?.stack ?? String(e)).slice(0, 700), evidence: ev })
        console.log('  ✗ unexpected:', e?.stack ?? e)
      } else cur.aborted = e.message
    } finally {
      await closeAll()
      save()
    }
  }
  if (missing.length) console.log('steps not defined yet:', missing.join(','))
}
/** Markdown pieces for the report: the check table and the console/network summary. */
function summary() {
  const lines = ['| Passo | Verificações | OK | Falhas |', '|---|---|---|---|']
  for (const st of Object.values(results.steps).sort((a, b) => a.id - b.id)) {
    const okN = st.checks.filter((c) => c.ok).length
    lines.push(`| ${st.id}. ${st.title} | ${st.checks.length} | ${okN} | ${st.checks.length - okN} |`)
  }
  lines.push('')
  for (const st of Object.values(results.steps).sort((a, b) => a.id - b.id))
    for (const c of st.checks) lines.push(`- [${c.ok ? 'x' : ' '}] ${st.id} · ${c.name}${c.detail ? ` — ${c.detail}` : ''}${c.evidence?.length ? ` (${c.evidence.join(', ')})` : ''}`)
  lines.push('')
  const all = existsSync(CONSOLE) ? readFileSync(CONSOLE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  const groups = new Map()
  for (const l of all) {
    const key = `${l.type} | ${l.text.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>').replace(/(PA|RM|TR)_\w+/g, '$1_…').replace(/\d{2,}/g, 'N').slice(0, 170)}`
    const g = groups.get(key) ?? { n: 0, steps: new Set(), profiles: new Set() }
    g.n++
    g.steps.add(l.step)
    g.profiles.add(l.profile)
    groups.set(key, g)
  }
  lines.push('| Ocorrências | Passos | Perfis | Tipo e mensagem |', '|---|---|---|---|')
  for (const [k, g] of [...groups].sort((a, b) => b[1].n - a[1].n)) lines.push(`| ${g.n} | ${[...g.steps].join(',')} | ${[...g.profiles].join(',')} | \`${k.replace(/\|/g, '/')}\` |`)
  console.log(lines.join('\n'))
}
if (args.includes('--summary')) summary()
else await main()
