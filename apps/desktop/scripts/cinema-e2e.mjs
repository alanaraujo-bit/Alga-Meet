// Sala de Cinema dev stage end to end on two REAL app instances (profiles qa-cine-a, qa-cine-b) against the isolated QA stack.
//   QA_WORK=<dir> node scripts/qa-stack.mjs build && QA_WORK=<dir> node scripts/qa-stack.mjs start
//   QA_WORK=<dir> node scripts/cinema-e2e.mjs [--keep] [--film=<path.mkv>]
//   QA_WORK=<dir> node scripts/qa-stack.mjs stop
// Ana projects a fixture film (the native file dialog is answered by the harness in main; everything after it is the
// product path: ffmpeg check, probe, film sheet, cinema_open, piece factory), Bruno sits, Ana starts; both play, pause,
// seek and Bruno switches audio. Cross-window sync is measured with requestVideoFrameCallback (media time at a wall-clock
// display instant, same machine = same clock). Screenshots: docs/screenshots/2026-11-05-cinema-dev-*.png (+ 1440 px JPG).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import * as Q from './qa-stack.mjs'

const KEEP = process.argv.includes('--keep')
const SHOTS = join(Q.repo, 'docs', 'screenshots')
const PREFIX = '2026-11-05-cinema-dev'
const FFMPEG = join(Q.appDir, 'build', 'ffmpeg', 'ffmpeg.exe')
const SRC = process.argv.find((a) => a.startsWith('--film='))?.slice(7) ?? join(Q.appDir, 'test-fixtures', 'cinema', 'long-h264-1080p-10min.mkv')
const SUBS = join(Q.appDir, 'test-fixtures', 'cinema', 'h264-aac-srt-ass.mkv')
mkdirSync(Q.WORK, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const electronPath = createRequire(join(Q.appDir, 'package.json'))('electron')
const results = []
const apps = {}
const log = (...a) => console.log(`[cinema-e2e ${new Date().toISOString().slice(11, 19)}]`, ...a)

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
  const username = `cine${tag}${run}`
  const email = `${username}@qa.alga.test`
  const password = `sessao ${run} poltrona ${tag}`
  const r = await rest(null, 'POST', '/auth/register', { email, username, displayName, password, birthDate: '1995-05-05', termsVersion: legal.termsVersion })
  await rest(null, 'POST', '/auth/verify-email', { token: await mailedToken(email, 'verify') })
  return { username, password, token: r.token, id: r.user.id }
}

/** The fixture with two audio tracks (same sound, two labels: an audio switch to prove) and the 20 s SRT on top. */
function film() {
  const out = join(Q.WORK, 'Noite.no.Cinema.2026.1080p.mkv')
  if (existsSync(out)) return out
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', SRC, '-i', SUBS, '-map', '0:v', '-map', '0:a:0', '-map', '0:a:0', '-map', '1:s:0', '-c', 'copy',
    '-metadata:s:a:0', 'language=por', '-metadata:s:a:0', 'title=Dublado', '-metadata:s:a:1', 'language=eng', '-metadata:s:a:1', 'title=Original',
    '-disposition:a:0', 'default', '-disposition:a:1', '0', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`fixture: ${r.stderr}`)
  return out
}

/** The QA build finds ffmpeg at <app>/build/ffmpeg in dev mode: point it at the repo's copy (a junction, no 150 MB copy). */
function linkFfmpeg() {
  const dst = join(Q.QA_APP, 'build', 'ffmpeg')
  if (!existsSync(dst)) symlinkSync(join(Q.appDir, 'build', 'ffmpeg'), dst, 'junction')
}

const WS_HOOK = () => {
  // Harness only: timestamps of every cinema_* gateway frame this window sends (the server allows 300 per 60 s).
  window.__cine = []
  const orig = WebSocket.prototype.send
  WebSocket.prototype.send = function (data) {
    if (typeof data === 'string' && data.startsWith('{"op":"cinema_')) window.__cine.push([Date.now(), data.slice(7, data.indexOf('"', 7))])
    return orig.call(this, data)
  }
}
/** Most cinema_* frames sent in any 60 s window, and the count per op. */
const frameLoad = (page) => page.evaluate(() => {
  const xs = window.__cine ?? []
  let max = 0
  for (let i = 0, j = 0; i < xs.length; i++) {
    while (xs[i][0] - xs[j][0] >= 60_000) j++
    max = Math.max(max, i - j + 1)
  }
  const byOp = {}
  for (const [, op] of xs) byOp[op] = (byOp[op] ?? 0) + 1
  return { total: xs.length, max60s: max, byOp }
})

async function launch(k, x, w, h) {
  rmSync(join(process.env.APPDATA ?? '', 'Alga Meet Dev', 'profiles', `qa-cine-${k}`), { recursive: true, force: true })
  const env = { ...process.env, ALGA_API_URL: Q.API, ALGA_E2E: '1' }
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({
    executablePath: electronPath, cwd: Q.appDir, env,
    args: [Q.QA_APP, `--profile=qa-cine-${k}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
      '--autoplay-policy=no-user-gesture-required'],
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.log(`[${k}] pageerror`, e.message))
  page.on('console', (m) => {
    const tx = m.text()
    if (m.type() === 'error' || tx.includes('[cinema')) console.log(`[${k}] ${m.type()}`, tx.slice(0, 300))
  })
  await app.evaluate(({ BrowserWindow }, o) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(o.w, o.h)
    win.setPosition(o.x, 0)
  }, { x, w, h })
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

async function check(name, fn) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    results.push({ name, pass: true, ms: Date.now() - t0, detail: detail ?? null })
    log(`PASS ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
    return detail
  } catch (e) {
    results.push({ name, pass: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 600) })
    log(`FAIL ${name} — ${e?.message ?? e}`)
    for (const [k, a] of Object.entries(apps)) await a.page.screenshot({ path: join(Q.WORK, `fail-${results.length}-${k}.png`) }).catch(() => undefined)
    return null
  }
}
const until = async (fn, what, timeout = 15_000) => {
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
  return v && { t: v.currentTime, paused: v.paused, ready: v.readyState, rate: v.playbackRate }
})
const statsText = (page) => page.evaluate(() => [...document.querySelectorAll('[aria-label="Estatísticas"]')].map((e) => e.textContent).find((x) => x?.includes('Relógio')) ?? '')
const seatsText = (page) => page.evaluate(() => document.querySelector('[aria-label="Poltronas"]')?.textContent ?? '')

/** Media time each window shows at the same wall-clock instant (rVFC), A − B in ms, over n paired frames. */
async function offsets(n = 20) {
  const frame = () => new Promise((res) => {
    const v = document.querySelector('video')
    if (!v || v.paused) return res(null)
    v.requestVideoFrameCallback((_now, m) => res((m.mediaTime - (performance.timeOrigin + m.expectedDisplayTime) / 1000) * 1000))
  })
  const xs = []
  for (let i = 0; i < n; i++) {
    const [a, b] = await Promise.all([apps.a.page.evaluate(frame), apps.b.page.evaluate(frame)])
    if (a !== null && b !== null) xs.push(a - b)
    await sleep(100)
  }
  if (!xs.length) throw new Error('no paired frames (paused?)')
  const s = [...xs].sort((x, y) => x - y)
  const abs = xs.map(Math.abs).sort((x, y) => x - y)
  const r = (v) => Math.round(v * 10) / 10
  return { n: xs.length, medianMs: r(s[s.length >> 1]), p95AbsMs: r(abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))]), maxAbsMs: r(abs.at(-1)) }
}

async function shot(k, name) {
  const p = join(SHOTS, `${PREFIX}-${name}-${k}.png`)
  await apps[k].page.screenshot({ path: p })
  return p
}
/** Side by side (A | B) and ~1440 px JPG copies for the owner's phone, with the bundled ffmpeg. */
function sideBySide(name, a, b) {
  const out = join(SHOTS, `${PREFIX}-${name}.png`)
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', a, '-i', b, '-filter_complex', '[0][1]hstack=inputs=2', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`hstack: ${r.stderr}`)
  return out
}
function jpg(png) {
  const out = png.replace(/\.png$/, '.jpg')
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', png, '-vf', 'scale=1440:-2:flags=lanczos', '-q:v', '3', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`jpg: ${r.stderr}`)
  return out
}

// ── run ──────────────────────────────────────────────────────
if (!(await fetch(`${Q.API}/api/v1/health`).then((r) => r.ok, () => false))) throw new Error('QA stack down: node scripts/qa-stack.mjs start')
linkFfmpeg()
const FILM = film()
log('film', FILM)
const A = await account('a', 'Ana Cine')
const B = await account('b', 'Bruno Cine')
const space = await rest(A.token, 'POST', '/spaces', { name: `Cinema ${Date.now() % 10000}` })
const invite = await rest(A.token, 'POST', `/spaces/${space.id}/invites`, {})
await rest(B.token, 'POST', `/invites/${invite.code}`)
const voice = space.channels.find((c) => c.type === 'voice')

const W = 1440
const H = 900
const pa = await launch('a', 0, W, H)
const pb = await launch('b', W + 20, W, H)
await login(pa, A)
await login(pb, B)

async function joinVoice(page) {
  await page.getByRole('navigation', { name: 'Espaços' }).getByRole('button', { name: new RegExp(`^${space.name}`) }).click()
  await page.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: new RegExp(`^(Entrar em |Trocar para )?${voice.name}(, .*)?$`) }).first().click()
  // The first click may only open the room's lobby: then its join pill enters.
  const pill = page.getByRole('toolbar', { name: 'Antes de entrar' }).getByRole('button', { name: /^Entrar/ })
  if (await pill.isVisible().catch(() => false)) await pill.click()
  await page.getByText('Voz conectada').first().waitFor({ timeout: 30_000 })
}
const dock = (page) => page.getByRole('toolbar', { name: 'Controles da chamada' })
const metrics = {}

await check('A e B entram na call; o botão Cinema está no dock', async () => {
  await joinVoice(pa)
  await joinVoice(pb)
  await dock(pa).getByRole('button', { name: 'Cinema' }).waitFor()
})

await check('A projeta: Cinema → arquivo → ficha → Abrir sessão', async () => {
  // Harness only: answers the native file dialog in main with the fixture's path.
  await apps.a.app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, FILM)
  await dock(pa).getByRole('button', { name: 'Cinema' }).click()
  const sheet = pa.getByRole('dialog', { name: 'Projetar para a chamada' })
  await sheet.waitFor({ timeout: 30_000 })
  await shot('a', 'sheet')
  const title = await sheet.getByLabel('Título').inputValue()
  await sheet.getByRole('button', { name: 'Abrir sessão' }).click()
  await pa.locator('video').waitFor({ timeout: 15_000 })
  return `título "${title}"`
})

await check('B vê o cartão e senta', async () => {
  const sit = pb.getByRole('button', { name: 'Sentar', exact: true })
  await sit.waitFor({ timeout: 10_000 })
  await shot('b', 'card')
  await sit.click()
  await pb.locator('video').waitFor({ timeout: 15_000 })
})

await check('As duas poltronas ficam prontas no foyer', async () => {
  const t0 = Date.now()
  await until(async () => ((await seatsText(pa)).match(/pronto/g)?.length ?? 0) >= 2, 'two ready seats', 60_000)
  metrics.foyerReadyMs = Date.now() - t0
  await shot('a', 'foyer')
  await shot('b', 'foyer')
  // one-time notices (IP on sitting, headphones) are in the foyer shots; out of the way for the rest
  for (const page of [pa, pb]) {
    const close = page.getByRole('status').getByRole('button', { name: 'Fechar' })
    for (let i = 0; i < 5 && (await close.count()) > 0; i++) await close.first().click({ timeout: 2000 })
  }
  return await seatsText(pa)
})

await check('A começa: as duas janelas tocam', async () => {
  await pa.getByRole('button', { name: 'Começar', exact: true }).first().click()
  await until(async () => {
    const [a, b] = [await video(pa), await video(pb)]
    return a && b && !a.paused && !b.paused && a.t > 2 && b.t > 2
  }, 'both playing', 30_000)
})

await check('Sincronia tocando (rVFC, A − B)', async () => {
  await sleep(6000) // let the sync loop converge
  metrics.playing = await offsets(30)
  return metrics.playing
})

await check('Painel S nas duas janelas; o atalho chega já tomado (defaultPrevented) aos ouvintes de bolha, como o do chat de DM', async () => {
  // a bubble-phase window listener, like ChatView's "type anywhere → composer", must see the key as taken
  await pb.evaluate(() => window.addEventListener('keydown', (e) => { if (e.key === 's') window.__sTaken = e.defaultPrevented }, { once: true }))
  await pa.keyboard.press('s')
  await pb.keyboard.press('s')
  if ((await pb.evaluate(() => window.__sTaken)) !== true) throw new Error('S reached the bubble phase untaken')
  await until(async () => (await statsText(pa)).includes('Relógio') && (await statsText(pb)).includes('Relógio'), 'stats panels')
  await sleep(1500)
  metrics.statsPlayingA = await statsText(pa)
  metrics.statsPlayingB = await statsText(pb)
  const a = await shot('a', 'playing')
  const b = await shot('b', 'playing')
  metrics.playingShots = [a, b, sideBySide('playing', a, b)]
})

await check('A pausa: as duas param no mesmo frame', async () => {
  await pa.getByRole('button', { name: 'Pausar', exact: true }).click()
  const r = await until(async () => {
    const [a, b] = [await video(pa), await video(pb)]
    return a && b && a.paused && b.paused && a.ready >= 2 && b.ready >= 2 && { a: a.t, b: b.t }
  }, 'both paused', 10_000)
  await sleep(1200)
  const [a, b] = [await video(pa), await video(pb)]
  metrics.paused = { aS: a.t, bS: b.t, deltaMs: Math.round((a.t - b.t) * 1000 * 10) / 10 }
  const sa = await shot('a', 'paused')
  const sb = await shot('b', 'paused')
  metrics.pausedShots = [sa, sb, sideBySide('same-frame', sa, sb)]
  return metrics.paused
})

await check('A toca de novo e pula +10 s: todos esperam ficar prontos e tocam juntos', async () => {
  await pa.getByRole('button', { name: 'Tocar', exact: true }).click()
  await until(async () => !(await video(pb))?.paused, 'B resumes', 10_000)
  await sleep(2000)
  const before = (await video(pa)).t
  await pa.getByRole('button', { name: 'Avançar 10 s' }).click()
  await until(async () => {
    const [a, b] = [await video(pa), await video(pb)]
    return a && b && !a.paused && !b.paused && a.t > before + 9 && b.t > before + 9
  }, 'both playing after the seek', 30_000)
  await sleep(5000)
  metrics.afterSeek = await offsets(20)
  return metrics.afterSeek
})

await check('Pulo para trás (Shift+←, 60 s): ensure + setPlayhead no host, todos voltam juntos', async () => {
  const before = (await video(pa)).t
  await pa.locator('video').click({ position: { x: 5, y: 5 } }).catch(() => undefined) // focus off the buttons
  await pa.keyboard.press('Shift+ArrowLeft')
  await until(async () => {
    const [a, b] = [await video(pa), await video(pb)]
    return a && b && !a.paused && !b.paused && a.t < before - 30 && b.t < before - 30
  }, 'both playing after the backward seek', 30_000)
  await sleep(5000)
  metrics.afterBackSeek = await offsets(20)
  return metrics.afterBackSeek
})

await check('B troca o áudio (só para ele) e o filme segue em sincronia', async () => {
  const sel = pb.getByLabel('Faixa de áudio')
  const options = await sel.locator('option').allTextContents()
  if (options.length < 2) throw new Error(`audio options: ${options}`)
  await sel.selectOption({ index: 1 })
  await until(async () => /Faixa de áudio\s*a1(?!\s*→)/.test(await statsText(pb)), 'B on audio a1', 30_000)
  await sleep(4000)
  metrics.afterAudio = await offsets(20)
  metrics.statsAudioB = await statsText(pb)
  const a = await shot('a', 'audio-switch')
  const b = await shot('b', 'audio-switch')
  metrics.audioShots = [a, b, sideBySide('audio-switch', a, b)]
  return { options, ...metrics.afterAudio }
})

await check('B liga a legenda (SRT do arquivo) e ela aparece no começo do filme', async () => {
  await pb.getByLabel('Legenda').selectOption({ index: 1 })
  await pa.locator('video').click({ position: { x: 5, y: 5 } }).catch(() => undefined)
  await pa.keyboard.press('Shift+ArrowLeft') // back to 0: the SRT cues are at 1–5 s and 6–10 s
  await until(async () => (await pb.getByText(/Legenda SRT|Segunda linha/).count()) > 0, 'cue on B', 30_000)
  await shot('b', 'subtitles')
  return (await pb.getByText(/Legenda SRT|Segunda linha/).first().textContent())
})

await check('Final: estatísticas das duas janelas', async () => {
  metrics.statsFinalA = await statsText(pa)
  metrics.statsFinalB = await statsText(pb)
  return { a: metrics.statsFinalA, b: metrics.statsFinalB }
})

await check('Cota do gateway: < 300 frames cinema_* por 60 s em cada janela', async () => {
  metrics.frames = { a: await frameLoad(pa), b: await frameLoad(pb) }
  if (metrics.frames.a.max60s >= 300 || metrics.frames.b.max60s >= 300) throw new Error(JSON.stringify(metrics.frames))
  return metrics.frames
})

await check('A encerra: os dois veem o resumo', async () => {
  await pa.getByRole('button', { name: 'Encerrar sessão' }).first().click()
  await until(async () => (await pb.getByText('Sessão encerrada').count()) > 0, 'summary on B', 10_000)
})

const jpgs = []
for (const f of readdirSync(SHOTS).filter((x) => x.startsWith(PREFIX) && x.endsWith('.png'))) jpgs.push(jpg(join(SHOTS, f)))
writeFileSync(join(Q.WORK, 'cinema-e2e.json'), JSON.stringify({ at: new Date().toISOString(), film: FILM, results, metrics, jpgs }, null, 2) + '\n')
const failed = results.filter((r) => !r.pass)
log(`${results.length - failed.length}/${results.length} pass; results in ${join(Q.WORK, 'cinema-e2e.json')}`)
if (!KEEP) for (const a of Object.values(apps)) await a.app.close().catch(() => undefined)
process.exit(failed.length ? 1 : 0)
