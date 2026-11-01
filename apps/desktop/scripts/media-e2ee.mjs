#!/usr/bin/env node
// E2EE media lab (docs/decisions/0004-e2ee.md phase 1b) and the screen-share regressions QA found (BUG-02, BUG-03).
// Real Electron instances of a lab build, our own API (it is the MLS Delivery Service) and our own LiveKit, both on
// their own ports, data in a temp dir. Never touches :4000/:7880, the default/bob profiles or apps/desktop/out.
//
//   node apps/desktop/scripts/media-e2ee.mjs [--no-build] [--phase=bugs,join,cpu,loss,codec,nokey] [--reps=6] [--joins=20] [--tag=after]
//   node apps/desktop/scripts/media-e2ee.mjs --phase=percall   (per-call E2EE flag: pass/fail, not in the default run)
//   (also: node apps/desktop/scripts/media-lab.mjs --e2ee …)
//
// The SFU runs ICE-lite behind scripts/netem/udp-impair.mjs (as media-net.mjs), so the loss phase can impair media;
// the other phases run it with no impairment. Who shares a screen runs WITHOUT Chromium fake devices: that flag
// swaps any getDisplayMedia for Chromium's own synthetic screen (QA report 2026-11-01), so real windows (ffplay test
// patterns) are captured. Results: docs/benchmarks/e2ee-media.json (numbers quoted in docs/benchmarks/e2ee-media.md).
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import electronPath from 'electron'
import { AccessToken } from 'livekit-server-sdk'
import { _electron } from 'playwright'
import * as L from './media-lab.mjs'
import { createImpairProxy } from '../../../scripts/netem/udp-impair.mjs'

const { arg, ev, sleep, log, r1, summary, median, killTree, repo, desktop, secret } = L
const argv = process.argv.slice(2)
const phases = arg('phase', 'bugs,join,cpu,loss,codec,nokey').split(',')
const REPS = Number(arg('reps', 6))
const JOINS = Number(arg('joins', 20))
const TAG = arg('tag', 'after')
const API_PORT = 4470
const LK_PORT = 7970
const UDP_PORT = 7972
const API = `http://127.0.0.1:${API_PORT}`
const LK_WS = `ws://127.0.0.1:${LK_PORT}`
const WORK = join(tmpdir(), 'alga-e2ee-lab')
// Two levels below the repo: main resolves native/mls/pkg as <appPath>/../../native/mls/pkg in unpackaged builds.
const APP = arg('app', null) ? join(repo, 'node_modules', arg('app')) : join(repo, 'node_modules', '.alga-e2ee-lab')
const outJson = join(repo, 'docs/benchmarks/e2ee-media.json')
const results = existsSync(outJson) ? JSON.parse(readFileSync(outJson, 'utf8')) : {}
const save = () => writeFileSync(outJson, JSON.stringify(results, null, 2) + '\n')
const [PROXY_IP, SFU_IP] = (() => {
  const v4 = Object.values(networkInterfaces()).flat().filter((x) => x && x.family === 'IPv4' && !x.internal).map((x) => x.address)
  const proxyIp = v4.find((x) => /^(192.168|10)./.test(x)) ?? v4[0]
  const sfuIp = v4.find((x) => x !== proxyIp && x.startsWith('169.254.')) ?? v4.find((x) => x !== proxyIp)
  if (!proxyIp || !sfuIp) throw new Error('needs two non-loopback IPv4 addresses (see media-net.mjs)')
  return [proxyIp, sfuIp]
})()

const children = new Set()
const apps = new Set()
let proxy = null
async function cleanup() {
  for (const a of apps) await a.close().catch(() => undefined)
  apps.clear()
  for (const c of children) killTree(c.pid)
  children.clear()
  await proxy?.close()
}
process.on('SIGINT', () => void cleanup().then(() => process.exit(130)))
// A stray rejection must not leave our SFU, API, ffplay or Electron instances behind.
process.on('unhandledRejection', (e) => (console.error('unhandled', e), void cleanup().then(() => process.exit(1))))

// ─────────────── stack ───────────────
const portBusy = (port) => fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)
async function startStack() {
  for (const p of [API_PORT, LK_PORT]) if (await portBusy(p)) throw new Error(`:${p} busy — another media-e2ee run?`)
  rmSync(WORK, { recursive: true, force: true })
  mkdirSync(WORK, { recursive: true })
  const yaml = readFileSync(join(repo, 'infra/livekit/livekit.dev.yaml'), 'utf8')
    .replace(/^port: \d+/m, `port: ${LK_PORT}`)
    .replace(/^bind_addresses:.*$/m, 'bind_addresses: ["127.0.0.1"]')
    .replace(/^\s*port_range_start:.*\r?\n/m, '')
    .replace(/^\s*port_range_end:.*\r?\n/m, '')
    // ICE-lite on one UDP mux port of the SFU's own IP, advertising the proxy: all media crosses the proxy.
    .replace(/tcp_port: \d+/, `tcp_port: 0\n  udp_port: ${UDP_PORT}\n  use_ice_lite: true\n  ips:\n    includes: [${SFU_IP}/32]`)
    .replace(/node_ip: [\d.]+/, `node_ip: ${PROXY_IP}`)
    .replace(/http:\/\/127\.0\.0\.1:4000\//, `${API}/`)
  writeFileSync(join(WORK, 'livekit.yaml'), yaml)
  proxy = await createImpairProxy({ listen: { host: PROXY_IP, port: UDP_PORT }, target: { host: SFU_IP, port: UDP_PORT }, upstreamHost: SFU_IP, seed: 7 })
  const lkOut = openSync(join(WORK, 'livekit.log'), 'a')
  const lk = spawn(join(repo, 'infra/livekit/bin/livekit-server.exe'), ['--config', join(WORK, 'livekit.yaml')], { stdio: ['ignore', lkOut, lkOut], windowsHide: true })
  children.add(lk)
  const env = {
    ...process.env, NODE_ENV: 'development', PORT: String(API_PORT), HOST: '127.0.0.1',
    PGLITE_DIR: join(WORK, 'pglite'), UPLOADS_DIR: join(WORK, 'uploads'), EMAIL_OUTBOX_DIR: join(WORK, 'outbox'),
    LIVEKIT_URL: `http://127.0.0.1:${LK_PORT}`, LIVEKIT_PUBLIC_URL: LK_WS, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: secret,
    BILLING_PROVIDER: 'sandbox', LOG_LEVEL: 'warn',
  }
  const apiOut = openSync(join(WORK, 'api.log'), 'a')
  const api = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', '--dev'], { cwd: join(repo, 'apps/server'), env, stdio: ['ignore', apiOut, apiOut], windowsHide: true })
  children.add(api)
  for (let i = 0; i < 240; i++) {
    if ((await fetch(`${API}/api/v1/health`).then((r) => r.ok, () => false)) && (await portBusy(LK_PORT))) return log('stack up: API', API, 'LiveKit', LK_PORT)
    await sleep(500)
  }
  throw new Error(`stack did not come up (${WORK})`)
}

async function rest(token, method, path, body) {
  const res = await fetch(`${API}/api/v1${path}`, { method, headers: { ...(token && { authorization: `Bearer ${token}` }), ...(body && { 'content-type': 'application/json' }) }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}
/** Three friends and their group DM: the call every E2EE phase uses. */
async function accounts() {
  const legal = await rest(null, 'GET', '/legal')
  const run = Math.random().toString(36).slice(2, 6)
  const users = {}
  for (const k of ['a', 'b', 'c']) {
    const username = `e2ee${k}${run}`
    const r = await rest(null, 'POST', '/auth/register', { email: `${username}@lab.alga.test`, username, displayName: `Lab ${k.toUpperCase()}`, password: `lab ${run} farol aceso ${k}`, birthDate: '1990-03-03', termsVersion: legal.termsVersion })
    users[k] = { token: r.token, id: r.user.id, username }
  }
  for (const [x, y] of [['a', 'b'], ['a', 'c'], ['b', 'c']]) {
    await rest(users[x].token, 'POST', '/relationships', { username: users[y].username })
    await rest(users[y].token, 'PUT', `/relationships/${users[x].id}`, { type: 'friend' })
  }
  const ch = await rest(users.a.token, 'POST', '/users/@me/channels', { recipientIds: [users.b.id, users.c.id] })
  return { users, channelId: ch.id }
}

// ─────────────── app ───────────────
function build() {
  const r = spawnSync(`npx electron-vite build --outDir "${APP}"`, { cwd: desktop, stdio: 'inherit', shell: true })
  if (r.status !== 0) throw new Error('build failed')
  writeFileSync(join(APP, 'package.json'), JSON.stringify({ name: '@alga/desktop', productName: 'Alga Meet', version: '0.1.0', main: './main/index.js' }, null, 2))
  cpSync(join(desktop, 'build', 'runtime'), join(APP, 'build', 'runtime'), { recursive: true })
}

/** `wav`: fake mic fed from it (fake devices). No wav = real capture (screen sharer), never publishing a mic. */
async function launch(name, { wav = null, noHevc = false } = {}) {
  const env = { ...process.env, ALGA_API_URL: API }
  delete env.ELECTRON_RENDERER_URL
  const disable = ['CalculateNativeWinOcclusion', ...(noHevc ? ['PlatformHEVCDecoderSupport'] : [])]
  const app = await _electron.launch({
    executablePath: electronPath,
    cwd: APP,
    env,
    args: [APP, `--profile=e2ee-lab-${name}`, ...(wav ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] : []), `--disable-features=${disable.join(',')}`, '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  })
  apps.add(app)
  const page = await app.firstWindow()
  page.on('console', (m) => {
    const t = m.text()
    if ((m.type() === 'error' || m.type() === 'warning') && !/default device|MissingKey|missing key|InvalidKey|Unexpected SIF/.test(t)) log(`${name} console.${m.type()}:`, t.slice(0, 240))
  })
  page.on('pageerror', (e) => log(`${name} pageerror:`, e.message))
  await page.waitForLoadState('domcontentloaded')
  await page.goto(pathToFileURL(join(APP, 'renderer/index.html')).href + '?lab=e2ee#media-lab')
  await page.waitForSelector('[data-testid=media-lab]', { timeout: 20_000 })
  return { app, page, name, id: name }
}
async function close(inst) {
  apps.delete(inst.app)
  await inst.app.close().catch(() => undefined)
}
const S = (inst) => ev(inst, () => window.__mediaLab.useMedia.getState())

/** Signed-in instance (gateway up, main's E2EE device registered). */
async function signIn(inst, user) {
  await ev(inst, (t) => window.__mediaLab.signIn(t), user.token)
  inst.id = user.id
  inst.user = user
}
/** POST /voice/join + media.join, like the app. `e2ee: false` = lab baseline with E2EE off (both ends). */
// POST /voice/join allows 10 per minute per user: one join per user every 6.5 s at most.
async function joinCall(inst, channelId, o = {}) {
  await sleep(Math.max(0, (inst.lastJoin ?? 0) + 6500 - Date.now()))
  inst.lastJoin = Date.now()
  return ev(inst, ([c, o]) => window.__mediaLab.joinChannel(c, o), [channelId, o])
}
const leave = (inst) => ev(inst, () => window.__mediaLab.media.leave())

async function clockOffset(a, b) {
  let best = { rtt: Infinity, offset: 0 }
  for (let i = 0; i < 15; i++) {
    const a1 = await ev(a, () => window.__mediaLab.epochNow())
    const bt = await ev(b, () => window.__mediaLab.epochNow())
    const a2 = await ev(a, () => window.__mediaLab.epochNow())
    if (a2 - a1 < best.rtt) best = { rtt: a2 - a1, offset: bt - (a1 + a2) / 2 }
  }
  return best.offset // clock(B) - clock(A)
}

/** CPU seconds per process type over `ms` (cumulativeCPUUsage): % of one core = Δcpu / Δwall × 100. */
async function cpuWindow(insts, ms) {
  const read = (i) => i.app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, cpu: m.cpu.cumulativeCPUUsage ?? 0 })))
  const t0 = Date.now()
  const s0 = await Promise.all(insts.map(read))
  await sleep(ms)
  const s1 = await Promise.all(insts.map(read))
  const wall = (Date.now() - t0) / 1000
  return Object.fromEntries(insts.map((inst, k) => {
    const by = {}
    for (const p of s1[k]) {
      const before = s0[k].find((x) => x.pid === p.pid)?.cpu ?? 0
      by[p.type] = r1((by[p.type] ?? 0) + ((p.cpu - before) / wall) * 100)
    }
    return [inst.name, by]
  }))
}

// ─────────────── test patterns ───────────────
let win = null
async function patternWindow(w, h) {
  stopPattern()
  win = spawn('ffplay', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=60`, '-x', String(w), '-y', String(h), '-left', '40', '-top', '40', '-noborder', '-an', '-window_title', 'AlgaE2eeWin'], { stdio: 'ignore' })
  children.add(win)
  await sleep(1500)
}
function stopPattern() {
  if (!win) return
  killTree(win.pid)
  children.delete(win)
  win = null
}
const windowSource = (inst) => ev(inst, async () => (await window.__mediaLab.media.getScreenSources()).find((s) => s.kind === 'window' && s.name.includes('AlgaE2eeWin'))?.id ?? null)
async function share(a, o) {
  const sourceId = await windowSource(a)
  if (!sourceId) throw new Error('pattern window not among capture sources')
  await ev(a, (o) => window.__mediaLab.media.startScreenShare(o), { sourceId, audio: false, ...o })
}
/** Viewer: until the <video> shows a frame (ms) or null on timeout, plus the viewer's stats then. */
async function firstFrame(b, from, timeoutMs = 15_000) {
  const t0 = Date.now()
  const ok = await b.page
    .waitForFunction((id) => (document.querySelector(`[data-testid="video-${id}"]`)?.videoWidth ?? 0) > 0, from, { timeout: timeoutMs, polling: 50 })
    .then(() => true, () => false)
  const ms = Date.now() - t0
  const s = await S(b)
  return { ms: ok ? ms : null, stats: s.viewers[from]?.stats ?? null }
}
const sendCodec = (a) =>
  ev(a, async () => {
    const st = await window.__mediaLab.rawStats('screen')
    return [...new Set(st.filter((s) => s.type === 'outbound-rtp').map((o) => st.find((s) => s.id === o.codecId)?.mimeType).filter(Boolean))]
  })

// ─────────────── signals ───────────────
function signals() {
  const sig = L.makeSignals()
  sig.tone = join(L.work, 'tone.wav')
  if (!existsSync(sig.tone)) {
    const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=30', '-af', 'volume=0.5', '-ac', '1', '-c:a', 'pcm_s16le', sig.tone])
    if (r.status !== 0) throw new Error('ffmpeg tone failed')
  }
  return sig
}

// ─────────────── phases ───────────────

/** QA BUG-02 (small window: viewer never gets a picture) and BUG-03 ("Original" stays on the middle layer). No E2EE, direct LiveKit tokens. */
async function phaseBugs(sig) {
  const out = (results[`bugs-${TAG}`] = { when: new Date().toISOString(), bug02: [], bug03: [] })
  const a = await launch('bug-a')
  const b = await launch('bug-b', { wav: sig.silence })
  const tok = async (identity) => {
    const at = new AccessToken('devkey', secret, { identity, name: identity, ttl: '1h' })
    at.addGrant({ roomJoin: true, room: 'e2ee-lab-bugs', canPublish: true, canSubscribe: true })
    return at.toJwt()
  }
  a.id = 'bug-a'
  b.id = 'bug-b'
  try {
    const plainJoin = async (inst, publishMic) => ev(inst, async (t) => {
      window.__mediaLab.media.labNoE2ee = true
      await window.__mediaLab.media.join({ url: t.url, token: t.token, publishMic: t.publishMic })
    }, { url: LK_WS, token: await tok(inst.id), publishMic })
    await plainJoin(b, true)
    await plainJoin(a, false)
    await sleep(2000)
    for (const [w, h] of argv.includes('--b03only') ? [] : [[640, 360], [642, 392]]) {
      await patternWindow(w, h)
      for (let i = 0; i < REPS; i++) {
        await share(a, { quality: '720p30' })
        await sleep(1000)
        await ev(b, (id) => window.__mediaLab.media.watch(id, 'auto'), 'bug-a')
        const f = await firstFrame(b, 'bug-a')
        await sleep(2000)
        const st = (await S(b)).viewers['bug-a']?.stats
        const run = { window: `${w}x${h}`, i, firstFrameMs: f.ms, sent: await sendCodec(a), recv: st && { codec: st.codec, size: `${st.width}x${st.height}`, fps: r1(st.fps), decoder: st.decoderImplementation, kbps: r1(st.bitrateKbps) } }
        out.bug02.push(run)
        log('BUG-02', JSON.stringify(run))
        save()
        await ev(b, (id) => window.__mediaLab.media.unwatch(id), 'bug-a')
        await ev(a, () => window.__mediaLab.media.stopScreenShare())
        await sleep(1500)
      }
    }
    await patternWindow(960, 540)
    const fmt = (st) => st && `${st.width}x${st.height}@${Math.round(st.fps)}`
    const layers = async () => (await S(a)).screen.stats?.layers?.map((l) => `${l.width}x${l.height}@${Math.round(l.fps)}`)
    // Inline (not lab.captureFps): the same probe runs against the "before" build.
    const capFps = () => ev(a, async () => {
      const t = window.__mediaLab.media.debug.screen?.video.track?.mediaStreamTrack
      if (!t) return null
      const clone = t.clone()
      const rd = new MediaStreamTrackProcessor({ track: clone }).readable.getReader()
      let n = 0
      const t0 = performance.now()
      while (performance.now() - t0 < 2000) {
        const r = await Promise.race([rd.read(), new Promise((res) => setTimeout(() => res(null), 500))])
        if (r?.value) (r.value.close(), n++)
      }
      void rd.cancel().catch(() => undefined)
      clone.stop()
      return Math.round((n * 1000) / (performance.now() - t0))
    })
    for (let i = 0; i < Math.max(2, REPS / 3); i++) {
      await share(a, { quality: '720p30' })
      await sleep(1000)
      // A stage-sized tile (the app's, not the lab's big one): "auto" legitimately picks the middle layer here.
      await ev(b, (id) => window.__mediaLab.media.watch(id, 'auto'), 'bug-a')
      await b.page.waitForSelector('[data-testid="video-bug-a"]')
      await ev(b, () => Object.assign(document.querySelector('[data-testid="video-bug-a"]').style, { width: '480px', height: '270px' }))
      await firstFrame(b, 'bug-a')
      await sleep(4000)
      const auto = fmt((await S(b)).viewers['bug-a']?.stats)
      await ev(b, (id) => window.__mediaLab.media.setStreamQuality(id, 'source'), 'bug-a')
      await sleep(8000)
      const src = fmt((await S(b)).viewers['bug-a']?.stats)
      const adaptive = await ev(b, () => window.__mediaLab.screenAdaptive?.('bug-a') ?? 'n/a')
      const cap30 = await capFps()
      await ev(a, () => window.__mediaLab.media.setScreenQuality('720p60'))
      const gap = await ev(b, (ms) => window.__mediaLab.frameTimes(document.querySelector('[data-testid="video-bug-a"]'), ms), 4000)
      await sleep(6000)
      const enc = await ev(a, async () => {
        const t = window.__mediaLab.media.debug.screen?.video.track
        const st = await window.__mediaLab.rawStats('screen')
        return { encodings: t?.sender?.getParameters().encodings?.map((e) => `${e.rid}:${e.active ? 'on' : 'off'}/${e.maxFramerate}fps/${e.scaleResolutionDownBy}`), limits: st.filter((x) => x.type === 'outbound-rtp').map((o) => `${o.rid}:${o.qualityLimitationReason}`) }
      })
      const run = { i, auto, original: src, adaptiveAfterOriginal: adaptive, capture30: cap30, after60: fmt((await S(b)).viewers['bug-a']?.stats), capture60: await capFps(), senderLayers: await layers(), sender: enc, switchMaxGapMs: Math.round(gap.maxMs) }
      {
        await sleep(15_000)
        Object.assign(run, { after60At25s: fmt((await S(b)).viewers['bug-a']?.stats), senderLayersAt25s: await layers(), viewerDecoder: (await S(b)).viewers['bug-a']?.stats?.decoderImplementation, brokenDecoders: await ev(b, () => window.__mediaLab.media.debug.brokenDecoders ?? null) })
      }
      await ev(b, (id) => window.__mediaLab.media.unwatch(id), 'bug-a')
      await ev(a, () => window.__mediaLab.media.stopScreenShare())
      await sleep(1500)
      // Same window started at 720p60 directly: what a fresh capture gets.
      await share(a, { quality: '720p60' })
      await sleep(1000)
      await ev(b, (id) => window.__mediaLab.media.watch(id, 'source'), 'bug-a')
      await firstFrame(b, 'bug-a')
      await sleep(8000)
      Object.assign(run, { fresh60: fmt((await S(b)).viewers['bug-a']?.stats), fresh60Capture: await capFps(), fresh60Layers: await layers() })
      out.bug03.push(run)
      log('BUG-03', JSON.stringify(run))
      save()
      await ev(b, (id) => window.__mediaLab.media.unwatch(id), 'bug-a')
      await ev(a, () => window.__mediaLab.media.stopScreenShare())
      await ev(a, () => window.__mediaLab.media.setScreenDefaults({ quality: '720p30' }))
      await sleep(1500)
    }
    // Viewer-side fallback alone: the sender's HEVC size rule off, so the viewer's HEVC decoder really fails.
    if (TAG !== 'before' && !argv.includes('--b03only')) {
      out.runtimeFallback = []
      await patternWindow(640, 360)
      await ev(a, () => (window.__mediaLab.media.hevcMinSide = 0))
      for (let i = 0; i < Math.min(REPS, 3); i++) {
        await share(a, { quality: '720p30' })
        await sleep(300)
        const sentAtStart = await sendCodec(a)
        await sleep(700)
        await ev(b, (id) => window.__mediaLab.media.watch(id, 'auto'), 'bug-a')
        const f = await firstFrame(b, 'bug-a', 25_000)
        await sleep(1500)
        const st = (await S(b)).viewers['bug-a']?.stats
        const run = { i, firstFrameMs: f.ms, sentAtStart, sent: await sendCodec(a), recv: st && { codec: st.codec, decoder: st.decoderImplementation }, brokenDecoders: await ev(b, () => window.__mediaLab.media.debug.brokenDecoders) }
        out.runtimeFallback.push(run)
        log('runtime fallback', JSON.stringify(run))
        save()
        await ev(b, (id) => window.__mediaLab.media.unwatch(id), 'bug-a')
        await ev(a, () => window.__mediaLab.media.stopScreenShare())
        await sleep(1500)
      }
      await ev(a, () => (window.__mediaLab.media.hevcMinSide = 144))
    }
  } finally {
    stopPattern()
    await close(a)
    await close(b)
  }
}

/** Join time with E2EE vs without, interleaved in blocks of 5: A joins a call where B already is. */
async function phaseJoin(sig, acc) {
  const out = (results.join = { when: new Date().toISOString(), joins: JOINS, mic: 'tom 1 kHz contínuo (dispositivo falso), processamento desligado, PTT pressionado (portão aberto)', runs: [] })
  const a = await launch('a', { wav: sig.tone })
  const b = await launch('b', { wav: sig.silence })
  try {
    await signIn(a, acc.users.a)
    await signIn(b, acc.users.b)
    for (const i of [a, b]) await ev(i, () => (window.__mediaLab.media.setProcessing('off'), window.__mediaLab.media.setInputMode('ptt'), window.__mediaLab.media.pttDown()))
    const offset = await clockOffset(a, b)
    const blocks = Math.ceil(JOINS / 5)
    for (let blk = 0; blk < blocks * 2; blk++) {
      const e2ee = blk % 2 === 1
      await leave(b)
      await joinCall(b, acc.channelId, { e2ee })
      await sleep(1500)
      for (let k = 0; k < 5; k++) {
        await sleep(Math.max(0, (a.lastJoin ?? 0) + 6500 - Date.now()))
        const probe = ev(b, ([id]) => window.__mediaLab.firstAudio(id, -40, 10_000), [a.id]).catch(() => null)
        const t0 = await ev(a, () => window.__mediaLab.epochNow())
        const j = await joinCall(a, acc.channelId, { e2ee })
        const heard = await probe
        const run = { e2ee, joinMs: j.joinMs, e2eeMs: j.e2eeMs, firstAudioMs: heard === null ? null : Math.round(heard - offset - t0), state: (await S(a)).e2ee?.state }
        out.runs.push(run)
        log('join', JSON.stringify(run))
        await sleep(1200)
        await leave(a)
        await sleep(1500)
      }
      save()
    }
    for (const e2ee of [false, true]) {
      const r = out.runs.filter((x) => x.e2ee === e2ee)
      out[e2ee ? 'e2ee' : 'plain'] = { joinMs: summary(r.map((x) => x.joinMs)), firstAudioMs: summary(r.filter((x) => x.firstAudioMs !== null).map((x) => x.firstAudioMs)), noAudio: r.filter((x) => x.firstAudioMs === null).length }
    }
    save()
  } finally {
    await close(a)
    await close(b)
  }
}

/** CPU of one voice track (A sends a tone, B receives) and of a 720p60 HEVC window share, E2EE on/off interleaved. */
async function phaseCpu(sig, acc) {
  // --cpu=voice|screen runs one half (and keeps the other half's earlier numbers); --rounds=N (default 4).
  const part = arg('cpu', 'voice,screen').split(',')
  const ROUNDS = Number(arg('rounds', 4))
  const out = (results.cpu = { ...results.cpu, when: new Date().toISOString(), ...(part.includes('voice') && { voice: [] }), ...(part.includes('screen') && { screen: [] }) })
  // SIF/cryptor warnings in the console cost the renderer CPU too: counted per window, never logged.
  let warnings = 0
  let a = await launch('a', { wav: sig.tone })
  let b = await launch('b', { wav: sig.silence })
  try {
    await signIn(a, acc.users.a)
    await signIn(b, acc.users.b)
    await ev(a, () => (window.__mediaLab.media.setProcessing('off'), window.__mediaLab.media.setInputMode('ptt'), window.__mediaLab.media.pttDown()))
    await ev(b, () => (window.__mediaLab.media.setInputMode('ptt'), window.__mediaLab.media.pttUp()))
    for (const i of [a, b]) i.page.on('console', () => void warnings++)
    for (let r = 0; r < (part.includes('voice') ? ROUNDS : 0); r++) {
      for (const e2ee of r % 2 ? [true, false] : [false, true]) {
        await joinCall(b, acc.channelId, { e2ee })
        await joinCall(a, acc.channelId, { e2ee })
        await sleep(5000)
        warnings = 0
        const cpu = await cpuWindow([a, b], 60_000)
        const run = { e2ee, round: r, sender: cpu.a.Tab, receiver: cpu.b.Tab, gpuA: cpu.a.GPU, gpuB: cpu.b.GPU, consoleMessages: warnings }
        out.voice.push(run)
        log('cpu voice', JSON.stringify(run))
        save()
        await leave(a)
        await leave(b)
        await sleep(1500)
      }
    }
    await close(a)
    await close(b)
    a = await launch('a')
    b = await launch('b', { wav: sig.silence })
    await signIn(a, acc.users.a)
    await signIn(b, acc.users.b)
    await ev(b, () => (window.__mediaLab.media.setInputMode('ptt'), window.__mediaLab.media.pttUp()))
    await patternWindow(1280, 720)
    for (let r = 0; r < (part.includes('screen') ? ROUNDS : 0); r++) {
      for (const e2ee of r % 2 ? [true, false] : [false, true]) {
        await joinCall(b, acc.channelId, { e2ee })
        await joinCall(a, acc.channelId, { e2ee, publishMic: false })
        await share(a, { quality: '720p60' })
        await sleep(1000)
        await ev(b, (id) => window.__mediaLab.media.watch(id, 'source'), a.id)
        await firstFrame(b, a.id)
        await sleep(8000)
        const cpu = await cpuWindow([a, b], 30_000)
        const tx = (await S(a)).screen.stats
        const rx = (await S(b)).viewers[a.id]?.stats
        const run = { e2ee, round: r, sender: cpu.a.Tab, viewer: cpu.b.Tab, gpuA: cpu.a.GPU, gpuB: cpu.b.GPU, sent: await sendCodec(a), top: tx?.layers?.[0] && `${tx.layers[0].width}x${tx.layers[0].height}@${Math.round(tx.layers[0].fps)}`, recv: rx && `${rx.codec} ${rx.width}x${rx.height}@${Math.round(rx.fps)} ${Math.round(rx.bitrateKbps)}kbps` }
        out.screen.push(run)
        log('cpu screen', JSON.stringify(run))
        save()
        await ev(a, () => window.__mediaLab.media.stopScreenShare())
        await leave(a)
        await leave(b)
        await sleep(1500)
      }
    }
    for (const k of ['voice', 'screen']) {
      if (!out[k]) continue
      const m = (e2ee, f) => r1(median(out[k].filter((x) => x.e2ee === e2ee).map(f)))
      const second = k === 'voice' ? 'receiver' : 'viewer'
      out[`${k}Summary`] = { plain: { sender: m(false, (x) => x.sender), [second]: m(false, (x) => x[second]) }, e2ee: { sender: m(true, (x) => x.sender), [second]: m(true, (x) => x[second]) } }
    }
    save()
  } finally {
    stopPattern()
    await close(a)
    await close(b)
  }
}

/** Voice concealment under uplink loss (RTT 50 ± 30 ms): E2EE + RED (restored) vs no E2EE + RED vs E2EE without RED. */
async function phaseLoss(sig, acc) {
  const out = (results.loss = { when: new Date().toISOString(), signal: 'TTS pt-BR em loop (como media-network.md §1), modo Padrão, VAD automático', seconds: 25, runs: [] })
  const a = await launch('a', { wav: sig.speech })
  const b = await launch('b', { wav: sig.silence })
  const keys = ['packetsReceived', 'packetsLost', 'concealedSamples', 'silentConcealedSamples', 'totalSamplesReceived', 'concealmentEvents']
  const inbound = () => ev(b, async ([id, keys]) => {
    const st = await window.__mediaLab.rawStats({ remote: id, source: 'mic' })
    const s = st.find((x) => x.type === 'inbound-rtp')
    return { ...Object.fromEntries(keys.map((k) => [k, s?.[k] ?? 0])), codec: st.find((x) => x.id === s?.codecId)?.mimeType ?? null }
  }, [a.id, keys])
  const sent = () => ev(a, async () => (await window.__mediaLab.rawStats('mic')).find((x) => x.type === 'outbound-rtp'))
  try {
    await signIn(a, acc.users.a)
    await signIn(b, acc.users.b)
    for (const i of [a, b]) await ev(i, () => (window.__mediaLab.media.setProcessing('standard'), window.__mediaLab.media.setInputMode('vad')))
    for (let rep = 0; rep < 2; rep++) {
      for (const mode of [{ e2ee: false, red: true }, { e2ee: true, red: true }, { e2ee: true, red: false }]) {
        await joinCall(b, acc.channelId, mode)
        await joinCall(a, acc.channelId, mode)
        await sleep(3000)
        for (const loss of [0, 5, 10]) {
          proxy.reset()
          proxy.set('up', { delay: 25, jitter: 15, loss })
          proxy.set('down', { delay: 25, jitter: 15 })
          await sleep(6000)
          const [i0, s0] = [await inbound(), await sent()]
          await sleep(25_000)
          const [i1, s1] = [await inbound(), await sent()]
          const d = Object.fromEntries(keys.map((k) => [k, i1[k] - i0[k]]))
          const run = { ...mode, rep, lossPct: loss, codec: i1.codec, rtpLossPct: r1((100 * Math.max(0, d.packetsLost)) / Math.max(1, d.packetsReceived + d.packetsLost)), concealedPct: r1((100 * (d.concealedSamples - d.silentConcealedSamples)) / Math.max(1, d.totalSamplesReceived)), eventsPerMin: r1((d.concealmentEvents * 60) / 25), sendKbps: r1(((s1.bytesSent - s0.bytesSent) * 8) / Math.max(1, s1.timestamp - s0.timestamp)) }
          out.runs.push(run)
          log('loss', JSON.stringify(run))
          save()
        }
        proxy.reset()
        await leave(a)
        await leave(b)
        await sleep(1500)
      }
    }
  } finally {
    proxy.reset()
    await close(a)
    await close(b)
  }
}

/** Codec by room decode capability under E2EE (no backup codec): a viewer without HEVC decode joins mid-share, then leaves. */
/** Verified email (the outbox link): invites need it. */
async function verifyEmail(user) {
  const box = join(WORK, 'outbox')
  for (let i = 0; i < 60; i++) {
    for (const f of existsSync(box) ? readdirSync(box).filter((x) => x.includes('verify_email')) : []) {
      const eml = readFileSync(join(box, f), 'utf8')
      const token = eml.includes(`${user.username}@`) && /[?&]token=([A-Za-z0-9_-]+)/.exec(eml)?.[1]
      if (token && (await rest(null, 'POST', '/auth/verify-email', { token }).then(() => true, () => false))) return
    }
    await sleep(250)
  }
  throw new Error(`no verification mail for ${user.username}`)
}

/**
 * Per-call E2EE flag (server 133002d, client fix): a space voice channel follows Space.e2ee (off: plain media, no MLS
 * join), toggling it live makes both ends rejoin (share and mute kept), and a DM call is E2EE. Pass/fail, no numbers.
 */
async function phasePerCall(sig, acc) {
  const { a: ua, b: ub } = acc.users
  for (const u of [ua, ub]) await verifyEmail(u)
  const space = await rest(ua.token, 'POST', '/spaces', { name: 'Per-call lab' })
  const voice = space.channels.find((c) => c.type === 'voice') ?? (await rest(ua.token, 'POST', `/spaces/${space.id}/channels`, { type: 'voice', name: 'Voz' }))
  const inv = await rest(ua.token, 'POST', `/spaces/${space.id}/invites`, { maxAgeSeconds: 0, maxUses: 0 })
  await rest(ub.token, 'POST', `/invites/${inv.code}`)
  const a = await launch('pc-a') // shares a real window, no mic
  const b = await launch('pc-b', { wav: sig.tone })
  const fails = []
  const expect = (name, ok, detail) => (log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(detail)), ok || fails.push(name))
  const view = async (i) => {
    const s = await S(i)
    const mls = await ev(i, async () => (await window.alga.e2ee.status()).call)
    return { conn: s.connection.state, e2ee: s.e2ee.state, members: s.e2ee.members.length, peers: Object.keys(s.participants).length, sharing: s.screen.active, muted: s.self.muted, mls: mls?.state ?? null }
  }
  const until = async (pred, ms = 25_000) => {
    const t0 = Date.now()
    let v
    while (Date.now() - t0 < ms) {
      v = await Promise.all([view(a), view(b)])
      if (v.every((x, i) => pred(x, i))) return { ok: true, ms: Date.now() - t0, a: v[0], b: v[1] }
      await sleep(200)
    }
    return { ok: false, ms, a: v[0], b: v[1] }
  }
  // a hears b's tone and b gets a picture of a's share (decrypted, under E2EE).
  const flows = async () => {
    const heard = await ev(a, ([id]) => window.__mediaLab.firstAudio(id, -40, 10_000), [b.id]).catch(() => null)
    await ev(b, (id) => window.__mediaLab.media.watch(id, 'auto'), a.id)
    const f = await firstFrame(b, a.id, 15_000)
    return { heard: heard !== null, frameMs: f.ms }
  }
  try {
    await signIn(a, ua)
    await signIn(b, ub)
    await ev(b, () => (window.__mediaLab.media.setProcessing('off'), window.__mediaLab.media.setInputMode('ptt'), window.__mediaLab.media.pttDown()))
    await joinCall(b, voice.id)
    await joinCall(a, voice.id, { publishMic: false })
    await ev(a, () => window.__mediaLab.media.setMuted(true))
    let r = await until((v) => v.conn === 'connected' && v.peers === 1)
    expect('space voice, Space.e2ee off: connected, plain, no MLS call', r.ok && r.a.e2ee === 'off' && r.b.e2ee === 'off' && r.a.mls === null && r.b.mls === null, r)
    const attr = await ev(b, (id) => window.__mediaLab.media.debug.room?.remoteParticipants.get(id)?.attributes['alga.decode'] ?? null, a.id)
    expect('alga.decode attribute in the token', typeof attr === 'string' && attr.includes('h264'), { attr })
    await patternWindow(960, 540)
    await share(a, { quality: '720p30' })
    let m = await flows()
    expect('plain media flows', m.heard && m.frameMs !== null, m)

    await rest(ua.token, 'PATCH', `/spaces/${space.id}`, { e2ee: true })
    // i 0 = a, the sharer: its share is captured again right after the rejoin
    r = await until((v, i) => v.conn === 'connected' && v.e2ee === 'active' && v.members === 2 && v.peers === 1 && (i === 1 || v.sharing))
    expect('Space.e2ee on: both rejoined with E2EE active', r.ok, r)
    expect('share and mute kept across the switch', r.a.sharing && r.a.muted, r.a)
    m = await flows()
    expect('encrypted media flows', m.heard && m.frameMs !== null, m)

    await rest(ua.token, 'PATCH', `/spaces/${space.id}`, { e2ee: false })
    r = await until((v, i) => v.conn === 'connected' && v.e2ee === 'off' && v.mls === null && v.peers === 1 && (i === 1 || v.sharing))
    expect('Space.e2ee off again: both back to plain, share kept', r.ok, r)
    m = await flows()
    expect('plain media flows again', m.heard && m.frameMs !== null, m)

    await ev(a, () => window.__mediaLab.media.stopScreenShare())
    await leave(a)
    await leave(b)
    await joinCall(b, acc.channelId)
    await joinCall(a, acc.channelId, { publishMic: false })
    r = await until((v) => v.conn === 'connected' && v.e2ee === 'active' && v.members === 2)
    expect('DM call: E2EE active', r.ok, r)
    const heard = await ev(a, ([id]) => window.__mediaLab.firstAudio(id, -40, 10_000), [b.id]).catch(() => null)
    expect('DM: encrypted audio flows', heard !== null, { heard })
  } finally {
    stopPattern()
    await close(a)
    await close(b)
  }
  if (fails.length) throw new Error(`percall: ${fails.length} check(s) failed: ${fails.join('; ')}`)
}

async function phaseCodec(sig, acc) {
  const out = (results.codec = { when: new Date().toISOString(), runs: [] })
  const a = await launch('a')
  const b = await launch('b', { wav: sig.silence })
  const c = await launch('c', { wav: sig.silence, noHevc: true })
  try {
    await signIn(a, acc.users.a)
    await signIn(b, acc.users.b)
    await signIn(c, acc.users.c)
    out.decodeCaps = { b: await ev(b, () => window.__mediaLab.media.debug.decodeCaps), c: await ev(c, () => window.__mediaLab.media.debug.decodeCaps) }
    await patternWindow(1280, 720)
    for (let i = 0; i < Math.min(REPS, 3); i++) {
      await joinCall(b, acc.channelId)
      await joinCall(a, acc.channelId, { publishMic: false })
      await share(a, { quality: '720p60' })
      await sleep(1000)
      await ev(b, (id) => window.__mediaLab.media.watch(id, 'auto'), a.id)
      const fb = await firstFrame(b, a.id)
      const before = { sent: await sendCodec(a), b: fb.stats?.codec, bFirstFrameMs: fb.ms }
      const tJoin = Date.now()
      await joinCall(c, acc.channelId)
      await ev(c, (id) => window.__mediaLab.media.watch(id, 'auto'), a.id)
      const fc = await firstFrame(c, a.id, 20_000)
      await sleep(3000)
      const mixed = { sent: await sendCodec(a), b: (await S(b)).viewers[a.id]?.stats?.codec, c: (await S(c)).viewers[a.id]?.stats?.codec, cFirstFrameAfterJoinMs: fc.ms === null ? null : Date.now() - tJoin - 3000 }
      await leave(c)
      await sleep(4000)
      const after = { sent: await sendCodec(a), b: (await S(b)).viewers[a.id]?.stats?.codec, bFrames: (await firstFrame(b, a.id, 5000)).ms !== null }
      const run = { i, before, mixed, afterCLeft: after, e2ee: (await S(a)).e2ee?.state }
      out.runs.push(run)
      log('codec', JSON.stringify(run))
      save()
      await ev(a, () => window.__mediaLab.media.stopScreenShare())
      await leave(a)
      await leave(b)
      await sleep(1500)
    }
  } finally {
    stopPattern()
    for (const i of [a, b, c]) await close(i)
  }
}

/** A client in the SFU room with no MLS keys (straight LiveKit token, as the SFU operator could): decodes nothing; members see the mismatch. */
async function phaseNoKey(sig, acc) {
  const out = (results.nokey = { when: new Date().toISOString() })
  const a = await launch('a')
  const b = await launch('b', { wav: sig.tone })
  const d = await launch('d', { wav: sig.silence })
  try {
    await signIn(a, acc.users.a)
    await signIn(b, acc.users.b)
    await ev(b, () => (window.__mediaLab.media.setProcessing('off'), window.__mediaLab.media.setInputMode('ptt'), window.__mediaLab.media.pttDown()))
    await joinCall(b, acc.channelId)
    await joinCall(a, acc.channelId, { publishMic: false })
    await patternWindow(1280, 720)
    await share(a, { quality: '720p60' })
    const at = new AccessToken('devkey', secret, { identity: 'intruder', name: 'intruder', ttl: '1h' })
    at.addGrant({ roomJoin: true, room: `ch_${acc.channelId}`, canPublish: false, canSubscribe: true })
    await ev(d, async (t) => {
      window.__mediaLab.media.labNoE2ee = true
      await window.__mediaLab.media.join({ url: t.url, token: t.token, publishMic: false })
    }, { url: LK_WS, token: await at.toJwt() })
    await ev(b, (id) => window.__mediaLab.media.watch(id, 'auto'), a.id)
    await firstFrame(b, a.id)
    await ev(d, (id) => window.__mediaLab.media.watch(id, 'source'), a.id)
    await sleep(12_000)
    const video = await ev(d, async (id) => {
      const st = await window.__mediaLab.rawStats({ remote: id, source: 'screen' })
      const s = st.find((x) => x.type === 'inbound-rtp')
      return s && { bytesReceived: s.bytesReceived, framesReceived: s.framesReceived, framesDecoded: s.framesDecoded, keyFramesDecoded: s.keyFramesDecoded }
    }, a.id)
    const audio = await ev(d, async (id) => {
      const st = await window.__mediaLab.rawStats({ remote: id, source: 'mic' })
      const s = st.find((x) => x.type === 'inbound-rtp')
      return s && { packetsReceived: s.packetsReceived, totalAudioEnergy: s.totalAudioEnergy, totalSamplesDuration: s.totalSamplesDuration }
    }, b.id)
    const bAudio = await ev(b, () => 0)
    out.intruder = { video, audio, audioMeanPowerDb: audio?.totalSamplesDuration ? r1(10 * Math.log10(audio.totalAudioEnergy / audio.totalSamplesDuration)) : null }
    out.mismatch = { a: (await S(a)).e2ee?.mismatch, b: (await S(b)).e2ee?.mismatch }
    out.members = (await S(a)).e2ee?.members?.length
    void bAudio
    log('nokey', JSON.stringify(out))
    save()
  } finally {
    stopPattern()
    for (const i of [a, b, d]) await close(i)
  }
}

// ─────────────── main ───────────────
export async function main() {
  try {
    if (!argv.includes('--no-build')) build()
    const sig = signals()
    await startStack()
    results.env = { when: new Date().toISOString(), machine: 'i5-13600KF + RTX 3070, Windows 11 Pro 10.0.26300', sfu: `LiveKit 1.13.11 :${LK_PORT}, ICE-lite UDP mux ${SFU_IP}:${UDP_PORT} atrás do proxy ${PROXY_IP}`, api: `${API} (PGlite em ${WORK})` }
    if (phases.includes('bugs')) await phaseBugs(sig)
    const e2eePhases = ['join', 'cpu', 'loss', 'codec', 'nokey', 'percall'].filter((p) => phases.includes(p))
    if (e2eePhases.length) {
      const acc = await accounts()
      if (phases.includes('percall')) await phasePerCall(sig, acc)
      if (phases.includes('join')) await phaseJoin(sig, acc)
      if (phases.includes('codec')) await phaseCodec(sig, acc)
      if (phases.includes('nokey')) await phaseNoKey(sig, acc)
      if (phases.includes('cpu')) await phaseCpu(sig, acc)
      if (phases.includes('loss')) await phaseLoss(sig, acc)
    }
    save()
    log('done →', outJson)
  } catch (e) {
    console.error(e)
    process.exitCode = 1
  } finally {
    stopPattern()
    await cleanup()
  }
}
if (process.argv[1]?.endsWith('media-e2ee.mjs')) await main()
