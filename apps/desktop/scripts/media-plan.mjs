#!/usr/bin/env node
// Plan gating end to end + the voice screens, against this script's OWN stack — never the owner's dev stack
// (API :4000, LiveKit :7880): an API child process on :4350 (own PGlite/uploads/outbox in <tmp>/alga-media-plan,
// billing sandbox with a known webhook secret) and a LiveKit on :7980 whose webhooks reach that API.
//
//   node apps/desktop/scripts/media-plan.mjs [--no-build] [--part=plan,shots,recap]
//
// plan:  two lab pages (the same media engine the app uses) joined with tokens from POST /voice/join. Ana (free)
//        shares a real 1920x1080@60 window asking for 1080p60, Bruno watches in Original. Upgrade through the
//        sandbox checkout, downgrade through a signed sandbox webhook (revoked), each timed from the provider event
//        to the sender's new cap and to what Bruno decodes; the SFU's view of the track (muted?) is read through
//        RoomService. Control: the same share with the client gate disabled must be muted by the server.
//        Results: docs/benchmarks/media-plan.json.
// shots: two real app instances (Ana, Bruno; Chromium fake devices: Bruno's mic is speech) plus lab-page "guests"
//        to fill the room; screens go to docs/screenshots/<date>-<screen>-v<n>.png (numbering continues). A full-screen
//        test pattern covers the desktop while a picker is open, so thumbnails never show the real screen.
// recap: diagnostics of an in-place 720p60 → 1080p60 change (capture size, encodings, what is sent, every 500 ms).
import { spawn, spawnSync } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { RoomServiceClient, TrackSource } from 'livekit-server-sdk'
import * as L from './media-lab.mjs'

const { arg, ev, launch, log, sleep, repo, desktop, r1 } = L
const PORT = 4350
const API = `http://127.0.0.1:${PORT}`
const LK_PORT = 7980
const LK_HTTP = `http://127.0.0.1:${LK_PORT}`
const DIR = join(tmpdir(), 'alga-media-plan')
const SANDBOX_SECRET = randomBytes(32).toString('hex')
const parts = arg('part', 'plan,shots').split(',')
const outJson = join(repo, 'docs/benchmarks/media-plan.json')
const shotsDir = join(repo, 'docs/screenshots')
const today = new Date().toISOString().slice(0, 10)
const results = existsSync(outJson) ? JSON.parse(readFileSync(outJson, 'utf8')) : {}
const save = () => writeFileSync(outJson, JSON.stringify(results, null, 2) + '\n')

// ─────────────── own LiveKit (webhooks → own API) ───────────────
let livekit = null
async function startLiveKit() {
  const exe = join(repo, 'infra/livekit/bin/livekit-server.exe')
  if (!existsSync(exe)) throw new Error('LiveKit binary missing: run `node scripts/livekit.mjs` once')
  if (await fetch(LK_HTTP).then(() => true, () => false)) throw new Error(`:${LK_PORT} busy`)
  const yaml = readFileSync(join(repo, 'infra/livekit/livekit.dev.yaml'), 'utf8')
    .replace(/^port: \d+/m, `port: ${LK_PORT}`)
    .replace(/tcp_port: \d+/, 'tcp_port: 7981')
    .replace(/port_range_start: \d+/, 'port_range_start: 50600')
    .replace(/port_range_end: \d+/, 'port_range_end: 50700')
    .replace(/http:\/\/127\.0\.0\.1:4000\//, `${API}/`)
  const cfg = join(DIR, 'livekit.yaml')
  writeFileSync(cfg, yaml)
  const out = openSync(join(DIR, 'livekit.log'), 'w')
  livekit = spawn(exe, ['--config', cfg], { cwd: repo, stdio: ['ignore', out, out] })
  L.children.add(livekit)
  for (let i = 0; i < 100; i++) {
    if (await fetch(LK_HTTP).then((r) => r.ok, () => false)) return log('LiveKit up on', LK_PORT)
    await sleep(200)
  }
  throw new Error('LiveKit did not come up')
}

// ─────────────── own API ───────────────
let server = null
const health = () => fetch(`${API}/health`).then((r) => r.json()).then((j) => j.ok === true, () => false)
async function startApi() {
  if (await health()) throw new Error(`something already listens on ${API}: stop it first (never share a PGLITE_DIR)`)
  const serverDir = join(repo, 'apps/server')
  // Known sandbox secret: this script signs the provider's webhooks (downgrade = subscription revoked).
  const boot = `
    const { buildApp } = await import(${JSON.stringify(pathToFileURL(join(serverDir, 'src/app.ts')).href)})
    const { loadConfig } = await import(${JSON.stringify(pathToFileURL(join(serverDir, 'src/config.ts')).href)})
    const config = loadConfig()
    config.billing.sandboxSecret = process.env.SANDBOX_SECRET
    const app = await buildApp(config)
    await app.listen({ port: ${PORT}, host: '127.0.0.1' })
    process.stdin.on('end', async () => { await app.close(); process.exit(0) })
    process.stdin.resume()`
  const env = {
    ...process.env, NODE_ENV: 'development', LOG_LEVEL: 'warn', PORT: String(PORT), HOST: '127.0.0.1', SANDBOX_SECRET,
    PGLITE_DIR: join(DIR, 'pglite'), UPLOADS_DIR: join(DIR, 'uploads'), EMAIL_OUTBOX_DIR: join(DIR, 'outbox'),
    LIVEKIT_URL: LK_HTTP, LIVEKIT_PUBLIC_URL: `ws://127.0.0.1:${LK_PORT}`, BILLING_PROVIDER: 'sandbox', PUBLIC_URL: API,
  }
  const logFile = openSync(join(DIR, 'api.log'), 'w')
  server = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', boot], { cwd: serverDir, env, stdio: ['pipe', logFile, logFile] })
  for (let i = 0; i < 120; i++) {
    if (await health()) return log('API up on', PORT)
    if (server.exitCode !== null) throw new Error(`API exited with ${server.exitCode} (see ${join(DIR, 'api.log')})`)
    await sleep(500)
  }
  throw new Error('API did not come up')
}
async function stopApi() {
  if (!server || server.exitCode !== null) return
  const done = new Promise((r) => server.once('exit', r))
  server.stdin.end()
  await Promise.race([done, sleep(15_000)])
  if (server.exitCode === null) L.killTree(server.pid)
}

async function api(token, method, path, body, attempt = 0) {
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 429 && attempt < 10) {
    await sleep(7000)
    return api(token, method, path, body, attempt + 1)
  }
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`)
  return data
}

// ─────────────── people + space ───────────────
const PEOPLE = [['ana', 'Ana Ribeiro'], ['bruno', 'Bruno Costa'], ['carla', 'Carla Mendes'], ['diego', 'Diego Alves'], ['elisa', 'Elisa Nogueira'], ['fabio', 'Fábio Lima'], ['gui', 'Guilherme Rocha']]
async function verify(u) {
  const outbox = join(DIR, 'outbox')
  for (let i = 0; i < 60; i++) {
    for (const f of existsSync(outbox) ? readdirSync(outbox).filter((x) => x.includes('verify_email')) : []) {
      const eml = readFileSync(join(outbox, f), 'utf8')
      if (!eml.includes(u.me.email)) continue
      const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(eml)?.[1]
      if (token && (await api(null, 'POST', '/auth/verify-email', { token }).then(() => true, () => false))) return
    }
    await sleep(250)
  }
  throw new Error(`no verification mail for ${u.username}`)
}
async function seed() {
  const U = {}
  // Adults who accepted the current Termos, as the signup screen sends (the one-time prompts stay out of the way).
  const { termsVersion } = await api(null, 'GET', '/legal')
  for (const [key, displayName] of PEOPLE) {
    const username = `${key}.${randomBytes(2).toString('hex')}`
    const password = randomBytes(12).toString('base64url')
    const r = await api(null, 'POST', '/auth/register', { email: `${username}@plan.alga.test`, username, displayName, password, birthDate: '1994-05-12', termsVersion })
    U[key] = { key, username, password, token: r.token, me: r.user }
  }
  for (const u of Object.values(U)) await verify(u)
  const space = await api(U.ana.token, 'POST', '/spaces', { name: 'Estúdio Alga' })
  const geral = space.channels.find((c) => c.type === 'text')
  const focus = await api(U.ana.token, 'POST', `/spaces/${space.id}/channels`, { type: 'voice', name: 'Sala de foco', topic: 'Pareamento e revisão ao vivo' })
  const inv = await api(U.ana.token, 'POST', `/spaces/${space.id}/invites`, { maxAgeSeconds: 0, maxUses: 0 })
  for (const u of Object.values(U)) if (u.key !== 'ana') await api(u.token, 'POST', `/invites/${inv.code}`)
  // Nicknames: the stage and the pre-join preview must show these, not the account names.
  await api(U.ana.token, 'PATCH', `/spaces/${space.id}/members/${U.bruno.me.id}`, { nickname: 'Brunão' })
  await api(U.ana.token, 'PATCH', `/spaces/${space.id}/members/${U.carla.me.id}`, { nickname: 'Carlinha' })
  await api(U.bruno.token, 'POST', `/channels/${geral.id}/messages`, { content: 'Tô na Sala de foco, chega aí 🎧' })
  return { U, space, geral, focus }
}

// ─────────────── billing (sandbox provider) ───────────────
async function upgrade(u) {
  const cat = await api(u.token, 'GET', '/billing/catalog')
  const product = cat.products.find((p) => p.kind === 'plan' && p.interval === 'month')
  const co = await api(u.token, 'POST', '/billing/checkout', { productId: product.id })
  // What the browser does on the provider page: the sandbox confirms like a verified webhook would.
  const t0 = Date.now()
  const page = await fetch(co.url)
  if (!page.ok) throw new Error(`sandbox page → ${page.status}`)
  return { t0, reference: co.reference }
}
async function revoke(reference) {
  const body = JSON.stringify({ id: `revoke:${reference}:${Date.now()}`, type: 'sandbox.subscription', updates: [{ kind: 'subscription', reference, status: 'revoked', occurredAt: new Date().toISOString() }] })
  const t = Math.floor(Date.now() / 1000)
  const sig = `t=${t},v1=${createHmac('sha256', SANDBOX_SECRET).update(`${t}.${body}`).digest('hex')}`
  const t0 = Date.now()
  const res = await fetch(`${API}/api/v1/billing/webhooks/sandbox`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-alga-sandbox-signature': sig }, body })
  if (!res.ok) throw new Error(`sandbox webhook → ${res.status} ${await res.text()}`)
  return t0
}

// ─────────────── lab pages joined through the API ───────────────
const labUrl = (token) => pathToFileURL(join(desktop, 'out/renderer/index.html')).href + `?${new URLSearchParams({ url: `ws://127.0.0.1:${LK_PORT}`, token })}#media-lab`
async function labJoin(inst, u, channelId, publishMic) {
  const res = await api(u.token, 'POST', '/voice/join', { channelId })
  await inst.page.goto(labUrl(res.token))
  await inst.page.waitForSelector('[data-testid=media-lab]', { timeout: 20_000 })
  await ev(inst, (p) => window.__mediaLab.media.join(p), { url: res.url, token: res.token, channelId, publishMic, streamPresets: res.streamPresets, refresh: undefined })
  return res
}
const mediaState = (inst) => ev(inst, () => window.__mediaLab.useMedia.getState())
async function until(fn, ms = 20_000, step = 50) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const v = await fn()
    if (v) return v
    await sleep(step)
  }
  return null
}
/** What Bruno decodes of Ana's screen, every 200 ms over `ms`. */
async function received(b, remote, ms) {
  const out = []
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const s = await ev(b, async (id) => (await window.__mediaLab.rawStats({ remote: id, source: 'screen' })).find((x) => x.type === 'inbound-rtp'), remote)
    out.push({ t: Date.now(), frames: s?.framesDecoded ?? 0, w: s?.frameWidth ?? 0, h: s?.frameHeight ?? 0 })
    await sleep(200)
  }
  const span = (out.at(-1).t - out[0].t) / 1000
  return { fps: r1((out.at(-1).frames - out[0].frames) / span), size: `${out.at(-1).w}x${out.at(-1).h}` }
}
async function sfuTrack(rooms, room, identity) {
  const p = await rooms.getParticipant(room, identity)
  const t = p.tracks.find((x) => x.source === TrackSource.SCREEN_SHARE)
  return t ? { muted: t.muted, layers: t.layers.map((l) => `${l.width}x${l.height}@${Math.round(l.bitrate / 1000)}k`) } : null
}
const sentTop = (st) => {
  const l = st.screen.stats?.layers?.filter((x) => x.fps > 0).sort((a, b) => b.width - a.width)[0]
  return l ? `${l.width}x${l.height}@${Math.round(l.fps)}` : null
}

let patternWin = null
async function startPattern1080() {
  patternWin = spawn('ffplay', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=60', '-x', '1920', '-y', '1080', '-left', '0', '-top', '0', '-noborder', '-an', '-window_title', 'AlgaPattern1080'], { stdio: 'ignore' })
  L.children.add(patternWin)
  await sleep(1500)
  const ps = `Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr h, System.IntPtr a, int x, int y, int cx, int cy, uint f);'
$p = Get-Process -Id ${patternWin.pid} -ErrorAction SilentlyContinue
if ($p) { [W.U]::SetWindowPos($p.MainWindowHandle, [System.IntPtr]1, 0, 0, 0, 0, 0x13) | Out-Null }`
  spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' })
}
/** Full-screen test pattern on top while a picker is open: its thumbnails show this, never the real desktop. */
let coverWin = null
async function coverScreen() {
  coverWin = spawn('ffplay', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-fs', '-alwaysontop', '-an', '-window_title', 'AlgaCover'], { stdio: 'ignore' })
  L.children.add(coverWin)
  await sleep(1500)
}
function uncoverScreen() {
  if (!coverWin) return
  L.killTree(coverWin.pid)
  L.children.delete(coverWin)
  coverWin = null
}
function stopPattern() {
  uncoverScreen()
  if (!patternWin) return
  L.killTree(patternWin.pid)
  L.children.delete(patternWin)
  patternWin = null
}

async function partPlan(seedData, sig) {
  const { U, focus } = seedData
  const rooms = new RoomServiceClient(LK_HTTP, 'devkey', L.secret)
  await startPattern1080()
  const a = await launch('lab-plan-a', sig.silence, [], false)
  const b = await launch('lab-plan-b', sig.silence, [], true)
  const R = (results.plan = { when: new Date().toISOString(), steps: [] })
  const step = (name, data) => {
    R.steps.push({ name, ...data })
    log(name, JSON.stringify(data))
    save()
  }
  try {
    const ja = await labJoin(a, U.ana, focus.id, false)
    await labJoin(b, U.bruno, focus.id, true)
    await until(async () => (await mediaState(a)).connection.state === 'connected')
    const s0 = await mediaState(a)
    step('ana entra (Grátis)', { joinStreamPresets: ja.streamPresets, plan: s0.screen.plan, offered: s0.screen.offered.map((p) => p.id), locked: s0.screen.locked.map((p) => p.id), hardware: s0.screen.hardwareEncoder, codec: s0.screen.codec })

    const sourceId = await ev(a, async () => (await window.__mediaLab.media.getScreenSources()).find((s) => s.kind === 'window' && s.name.includes('AlgaPattern1080'))?.id ?? null)
    if (!sourceId) throw new Error('pattern window not found')
    await ev(a, (o) => window.__mediaLab.media.startScreenShare(o), { sourceId, quality: '1080p60', contentType: 'motion' })
    await sleep(800)
    await ev(b, (id) => window.__mediaLab.media.watch(id, 'source'), U.ana.me.id)
    await sleep(6000)
    let sa = await mediaState(a)
    step('pede 1080p60 no Grátis', { publishedPreset: sa.screen.preset, sentTop: sentTop(sa), bruno: await received(b, U.ana.me.id, 3000), sfu: await sfuTrack(rooms, ja.room, U.ana.me.id) })

    // Upgrade during the share: provider confirms → ENTITLEMENTS_UPDATE/ME_UPDATE + the token attribute → the cap lifts.
    const up = await upgrade(U.ana)
    const attr = await until(async () => (await mediaState(a)).screen.plan?.includes('1080p60'))
    const tAttr = Date.now()
    const lifted = await until(async () => (await mediaState(a)).screen.preset === '1080p60')
    const tLift = Date.now()
    const seen = await until(async () => {
      const s = await ev(b, async (id) => (await window.__mediaLab.rawStats({ remote: id, source: 'screen' })).find((x) => x.type === 'inbound-rtp'), U.ana.me.id)
      return s?.frameWidth === 1920
    }, 20_000, 100)
    const tSeen = Date.now()
    await sleep(4000)
    sa = await mediaState(a)
    step('upgrade (sandbox) durante a transmissão', { planAttributeMs: attr ? tAttr - up.t0 : null, liftedMs: lifted ? tLift - up.t0 : null, brunoSees1080Ms: seen ? tSeen - up.t0 : null, offered: sa.screen.offered.map((p) => p.id), locked: sa.screen.locked.map((p) => p.id), publishedPreset: sa.screen.preset, sentTop: sentTop(sa), bruno: await received(b, U.ana.me.id, 3000), sfu: await sfuTrack(rooms, ja.room, U.ana.me.id), notice: sa.notice?.text ?? null })

    // Downgrade (refund/chargeback: revoked = ends now): the client re-caps before anything else happens.
    const tDn = await revoke(up.reference)
    const dAttr = await until(async () => (await mediaState(a)).screen.plan && !(await mediaState(a)).screen.plan.includes('1080p60'))
    const tdAttr = Date.now()
    const capped = await until(async () => (await mediaState(a)).screen.preset !== '1080p60')
    const tCap = Date.now()
    const seen720 = await until(async () => {
      const s = await ev(b, async (id) => (await window.__mediaLab.rawStats({ remote: id, source: 'screen' })).find((x) => x.type === 'inbound-rtp'), U.ana.me.id)
      return s?.frameHeight === 720
    }, 20_000, 100)
    const tSeen720 = Date.now()
    await sleep(4000)
    sa = await mediaState(a)
    step('downgrade (webhook revoked) durante a transmissão', { planAttributeMs: dAttr ? tdAttr - tDn : null, recappedMs: capped ? tCap - tDn : null, brunoSees720Ms: seen720 ? tSeen720 - tDn : null, publishedPreset: sa.screen.preset, sentTop: sentTop(sa), bruno: await received(b, U.ana.me.id, 3000), sfu: await sfuTrack(rooms, ja.room, U.ana.me.id), notice: sa.notice?.text ?? null })

    // Control: the same 1080p60 share with the client gate off is muted by the server (D11 server-side check).
    await ev(a, () => window.__mediaLab.media.stopScreenShare())
    await sleep(1500)
    await ev(a, () => window.__mediaLab.media.setPlanPresets(null))
    await ev(a, (o) => window.__mediaLab.media.startScreenShare(o), { sourceId, quality: '1080p60', contentType: 'motion' })
    const muted = await until(async () => (await sfuTrack(rooms, ja.room, U.ana.me.id))?.muted === true, 10_000, 200)
    step('controle: portão do cliente desligado, 1080p60 no Grátis', { serverMuted: !!muted, sfu: await sfuTrack(rooms, ja.room, U.ana.me.id), apiLog: readFileSync(join(DIR, 'api.log'), 'utf8').split('\n').filter((l) => l.includes('above the plan')).length })
    await ev(a, () => window.__mediaLab.media.stopScreenShare())
  } finally {
    stopPattern()
    await L.close(a)
    await L.close(b)
  }
}

/** Diagnostics of an in-place upgrade (720p60 → 1080p60): capture, encodings and what is sent, every 500 ms. */
async function partRecap(seedData, sig) {
  const { U, focus } = seedData
  await startPattern1080()
  const a = await launch('lab-plan-a', sig.silence, [], false)
  const b = await launch('lab-plan-b', sig.silence, [], true)
  try {
    await labJoin(a, U.ana, focus.id, false)
    await labJoin(b, U.bruno, focus.id, true)
    await until(async () => (await mediaState(a)).connection.state === 'connected')
    await ev(a, () => window.__mediaLab.media.setPlanPresets(null))
    const sourceId = await ev(a, async () => (await window.__mediaLab.media.getScreenSources()).find((s) => s.kind === 'window' && s.name.includes('AlgaPattern1080'))?.id ?? null)
    await ev(a, (o) => window.__mediaLab.media.startScreenShare(o), { sourceId, quality: '720p60', contentType: 'motion' })
    await sleep(800)
    await ev(b, (id) => window.__mediaLab.media.watch(id, 'source'), U.ana.me.id)
    await sleep(6000)
    const probe = () => ev(a, async () => {
      const d = window.__mediaLab.media.debug
      const v = d.screen?.video.track
      const out = (await window.__mediaLab.rawStats('screen')).filter((x) => x.type === 'outbound-rtp').map((o) => `${o.rid}:${o.frameWidth}x${o.frameHeight}@${Math.round(o.framesPerSecond ?? 0)} ${o.qualityLimitationReason}`)
      const pair = (await window.__mediaLab.rawStats('screen')).find((x) => x.type === 'candidate-pair' && x.nominated)
      return { sourceId: d.screen?.sourceId ?? null, preset: d.screen?.preset.id, settings: v?.mediaStreamTrack.getSettings(), enc: v?.sender?.getParameters().encodings.map((e) => `${e.rid}:/${e.scaleResolutionDownBy} ${Math.round((e.maxBitrate ?? 0) / 1000)}k@${e.maxFramerate} ${e.active ? 'on' : 'off'}`), out, bweKbps: Math.round((pair?.availableOutgoingBitrate ?? 0) / 1000) }
    })
    log('before', JSON.stringify(await probe()))
    await ev(a, () => window.__mediaLab.media.setScreenQuality('1080p60'))
    for (let i = 0; i < 24; i++) {
      log(`t+${i * 0.5}s`, JSON.stringify(await probe()))
      await sleep(500)
    }
  } finally {
    stopPattern()
    await L.close(a)
    await L.close(b)
  }
}

// ─────────────── voice screens (real app) ───────────────
const existing = readdirSync(shotsDir)
function nextPath(screen) {
  const re = new RegExp(`^${today}-${screen}-v(\\d+)\\.png$`)
  const n = Math.max(0, ...existing.map((f) => Number(re.exec(f)?.[1] ?? 0))) + 1
  existing.push(`${today}-${screen}-v${n}.png`)
  return join(shotsDir, `${today}-${screen}-v${n}.png`)
}
const shots = []
async function shot(page, screen) {
  await sleep(300)
  const p = nextPath(screen)
  await page.screenshot({ path: p, animations: 'disabled' })
  shots.push(p)
  log('  ✓', p.slice(repo.length + 1))
}
const MEDIA_FLAGS = (wav) => ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-background-timer-throttling']
async function launchApp(profile, wav, size = [1320, 840]) {
  const { _electron } = await import('playwright')
  const electronPath = (await import('electron')).default
  rmSync(join(process.env.APPDATA ?? '', 'Alga Meet', 'profiles', profile), { recursive: true, force: true })
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RENDERER_URL'))
  env.ALGA_API_URL = API
  const app = await _electron.launch({ executablePath: electronPath, args: [desktop, `--profile=${profile}`, ...MEDIA_FLAGS(wav)], cwd: desktop, env })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(w, h)
    win.center()
  }, size)
  await page.waitForLoadState('domcontentloaded')
  page.on('pageerror', (e) => log(`${profile} pageerror:`, e.message))
  return { app, page }
}
async function login(page, u) {
  await page.getByLabel('E-mail ou nome de usuário').fill(u.username)
  await page.getByLabel('Senha', { exact: true }).fill(u.password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.getByRole('navigation', { name: 'Espaços' }).waitFor({ timeout: 30_000 })
  await sleep(600)
}
const rail = (page, name) => page.getByRole('navigation', { name: 'Espaços' }).getByRole('button', { name })
const channels = (page) => page.getByRole('complementary', { name: 'Canais' })
const dock = (page) => page.getByRole('toolbar', { name: 'Controles da chamada' })
const waitConnected = (page) => page.getByText('Voz conectada').first().waitFor({ timeout: 30_000 })
async function park(page) {
  await page.mouse.move(5, 300)
  await page.evaluate(() => document.activeElement?.blur?.())
  await sleep(300)
}

/** Guests: one Electron process, one lab window each, joined through the API with their own accounts (silent mic). */
async function startGuests(sig) {
  const inst = await launch('lab-plan-guests', sig.silence)
  return {
    inst,
    windows: [],
    async add(u, channelId) {
      const res = await api(u.token, 'POST', '/voice/join', { channelId })
      const url = labUrl(res.token)
      const page = this.windows.length === 0 ? inst.page : await (async () => {
        const [p] = await Promise.all([inst.app.waitForEvent('window'), inst.app.evaluate(({ BrowserWindow }, href) => {
          const w = new BrowserWindow({ width: 420, height: 300, show: false, webPreferences: { backgroundThrottling: false } })
          void w.loadURL(href)
        }, url)])
        return p
      })()
      if (this.windows.length === 0) await page.goto(url)
      await page.waitForSelector('[data-testid=media-lab]', { timeout: 20_000 })
      await page.evaluate((p) => window.__mediaLab.media.join(p), { url: res.url, token: res.token, channelId, publishMic: true })
      this.windows.push(page)
    },
    async removeLast() {
      const p = this.windows.pop()
      await p?.evaluate(() => window.__mediaLab.media.leave()).catch(() => undefined)
      if (p && p !== inst.page) await p.close().catch(() => undefined)
    },
  }
}

async function partShots(seedData, sig) {
  const { U, focus } = seedData
  const { speech, silence } = sig
  const A = await launchApp('shots-plan-a', silence)
  const B = await launchApp('shots-plan-b', speech)
  const guests = await startGuests(sig)
  try {
    return await shotsFlow(A, B, guests, U, focus)
  } catch (e) {
    await A.page.screenshot({ path: join(DIR, 'fail-a.png') }).catch(() => undefined)
    await B.page.screenshot({ path: join(DIR, 'fail-b.png') }).catch(() => undefined)
    throw e
  } finally {
    await L.close(guests.inst).catch(() => undefined)
    await A.app.close().catch(() => undefined)
    await B.app.close().catch(() => undefined)
  }
}

async function shotsFlow(A, B, guests, U, focus) {
  {
    await login(A.page, U.ana)
    await login(B.page, U.bruno)
    // Guests in the room first: Bruno's pre-join preview shows space nicknames (Carlinha), not account names.
    await guests.add(U.carla, focus.id)
    await guests.add(U.diego, focus.id)
    await rail(B.page, /^Estúdio Alga/).click()
    await B.page.keyboard.press('Control+K')
    await B.page.keyboard.type('Sala de foco')
    await sleep(250)
    await B.page.keyboard.press('Enter')
    await B.page.getByRole('button', { name: 'Entrar em Sala de foco', exact: true }).waitFor()
    await B.page.getByText('Carlinha').first().waitFor({ timeout: 15_000 })
    await park(B.page)
    await shot(B.page, 'voice-preview')

    // Grids: A (Ana) sees 3, 5 and 7 people (A + B + guests). Balanced rows, nicknames on the tiles.
    await B.page.getByRole('button', { name: 'Entrar em Sala de foco', exact: true }).click()
    await waitConnected(B.page)
    await guests.removeLast()
    await rail(A.page, /^Estúdio Alga/).click()
    await channels(A.page).getByRole('button', { name: /Sala de foco/ }).click()
    await waitConnected(A.page)
    await sleep(2500)
    await park(A.page)
    await shot(A.page, 'voice-stage-3')
    for (const k of ['diego', 'elisa']) await guests.add(U[k], focus.id)
    await sleep(3000)
    await park(A.page)
    await shot(A.page, 'voice-stage-5')
    for (const k of ['fabio', 'gui']) await guests.add(U[k], focus.id)
    await sleep(3000)
    await park(A.page)
    await shot(A.page, 'voice-stage-7')
    await guests.removeLast()
    await guests.removeLast()

    // Free plan picker: 1080p60 is visible, locked, with one calm way to Alga Plus.
    await coverScreen()
    await dock(A.page).getByRole('button', { name: 'Compartilhar tela' }).click()
    const picker = A.page.getByRole('dialog', { name: 'Compartilhar tela' })
    await picker.waitFor()
    await picker.getByRole('radiogroup', { name: 'Telas' }).getByRole('radio').first().waitFor({ timeout: 20_000 })
    await sleep(2500)
    await park(A.page)
    await shot(A.page, 'screen-picker-plan-locked')
    await picker.getByRole('button', { name: 'Transmitir' }).click()
    await picker.waitFor({ state: 'detached', timeout: 15_000 })
    uncoverScreen()
    await A.page.getByText('Você está transmitindo').first().waitFor()

    // Bruno watches: the stream takes the big tile, the room stays a grid under it.
    await B.page.getByRole('button', { name: 'Assistir' }).first().click()
    await B.page.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.readyState >= 2 && v.videoWidth > 0), null, { timeout: 20_000 })
    await sleep(2500)
    await park(B.page)
    await shot(B.page, 'stream-featured')

    // Away from the stage (text channel): the mini-player keeps the stream; dragged, it snaps to a corner.
    await channels(B.page).getByRole('button', { name: /^geral/ }).click()
    const mini = B.page.getByRole('region', { name: /em miniatura/ })
    await mini.waitFor({ timeout: 10_000 })
    await sleep(1500)
    await mini.hover()
    await sleep(300)
    await shot(B.page, 'stream-mini-player')
    const box = await mini.boundingBox()
    await B.page.mouse.move(box.x + 160, box.y + 120)
    await B.page.mouse.down()
    await B.page.mouse.move(box.x - 500, box.y - 400, { steps: 12 })
    await B.page.mouse.up()
    await sleep(600)
    await park(B.page)
    await shot(B.page, 'stream-mini-player-snapped')
    await mini.hover()
    await mini.getByRole('button', { name: 'Voltar para a chamada' }).click()
    await B.page.getByRole('region', { name: /em miniatura/ }).waitFor({ state: 'detached', timeout: 10_000 })

    // Upgrade mid-share (sandbox provider): the picker now offers 1080p60, applied live.
    const up = await upgrade(U.ana)
    await sleep(1500)
    await coverScreen()
    await dock(A.page).getByRole('button', { name: 'Parar transmissão' }).click()
    await A.page.getByRole('menuitem', { name: 'Trocar o que está sendo compartilhado' }).click()
    await picker.waitFor()
    // Offered (not the locked row, which is named "1080p 60 fps: Alga Plus") once the plan update landed.
    await picker.getByRole('radio', { name: '1080p 60 fps', exact: true }).waitFor({ timeout: 20_000 })
    await picker.getByRole('radio', { name: '1080p 60 fps', exact: true }).click()
    await sleep(2000)
    await park(A.page)
    await shot(A.page, 'screen-picker-live-plus')
    await picker.getByRole('button', { name: 'Aplicar' }).click()
    await picker.waitFor({ state: 'detached', timeout: 15_000 })
    uncoverScreen()
    await sleep(3000)

    // Downgrade (refund): re-capped in place, said once.
    await revoke(up.reference)
    await A.page.getByText(/Seu plano não inclui/).first().waitFor({ timeout: 20_000 })
    await sleep(800)
    await shot(A.page, 'screen-sharing-recapped')
  }
}
// ─────────────── main ───────────────
try {
  if (!process.argv.includes('--no-build')) {
    const r = spawnSync('npm', ['run', 'build', '-w', 'apps/desktop'], { cwd: repo, stdio: 'inherit', shell: true })
    if (r.status !== 0) throw new Error('build failed')
  }
  rmSync(DIR, { recursive: true, force: true })
  mkdirSync(DIR, { recursive: true })
  const sig = L.makeSignals()
  await startApi()
  await startLiveKit()
  const data = await seed()
  log('seeded', Object.keys(data.U).length, 'people')
  if (parts.includes('plan')) await partPlan(data, sig)
  if (parts.includes('recap')) await partRecap(data, sig)
  if (parts.includes('shots')) await partShots(data, sig)
  log('done', shots.length ? `${shots.length} screenshots` : '')
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  stopPattern()
  await L.cleanup()
  await stopApi()
  if (livekit) L.killTree(livekit.pid)
}
