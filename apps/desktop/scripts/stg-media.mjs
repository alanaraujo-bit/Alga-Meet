#!/usr/bin/env node
// Staging media run: two REAL app instances (profiles stg-a / stg-b, own build in node_modules/.alga-stg) against the
// staging API on Railway and the home LiveKit SFU (wss://example-sfu.duckdns.org). Measures join time, the ICE path,
// RTT, jitter, loss, concealment, A→B audio latency (impulse onsets, as media-lab.mjs), a real window share at 1080p30
// and 720p60, the LiveKit webhook (VOICE_STATE_UPDATE seen by B's account on the gateway), ICE over TCP 7881 and the
// SFU container's CPU/RAM over SSH (read-only: docker stats/logs). Report: docs/benchmarks/staging-home-sfu.md.
//
//   STG_WORK=<dir outside the repo> node apps/desktop/scripts/stg-media.mjs [--no-build]
//     [--phase=setup,ui,voice,share,tcp,cleanup] [--voice-min=10] [--share-sec=180] [--tcp-sec=60]
//
// Test accounts are generated; credentials and tokens live only in STG_WORK/secrets.json (refused inside the repo),
// results in STG_WORK/results.json. Never touches the dev stack (:4000/:7880, profiles default/bob, apps/desktop/out);
// every process it starts is closed at the end. E2EE: ALGA_E2EE=0 (packaged-mode behaviour: main reports E2EE "off",
// the client asks for a plain call, which is what a space voice channel with Space.e2ee=false is).
// Harness-only instrumentation (not product code): desktopCapturer lists only the test window, the sharer gets a
// synthetic WebAudio mic instead of fake devices (they replace real capture), shell/notifications are no-ops, an init
// script keeps a registry of RTCPeerConnections for getStats, and the tcp phase gathers no UDP and drops the SFU's
// UDP ICE candidates (a client on a network that blocks UDP).
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import electronPath from 'electron'
import { _electron } from 'playwright'
import { desktop, killTree, r1, repo, sleep, summary } from './media-lab.mjs'

const argv = process.argv.slice(2)
const arg = (n, d) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d
const API = process.env.STG_API ?? 'https://api-staging-b3ea.up.railway.app'
const SSH = ['-i', join(homedir(), '.ssh', 'alga_homeserver'), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'alanaraujo@192.168.1.110']
const WORK = resolve(process.env.STG_WORK ?? join(tmpdir(), 'alga-stg'))
const rel = relative(repo, WORK)
if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error('STG_WORK must be outside the repo: it holds the test credentials')
const APP = join(desktop, 'node_modules', '.alga-stg')
const SECRETS = join(WORK, 'secrets.json')
const OUT = join(WORK, 'results.json')
const phases = arg('phase', 'setup,ui,voice,share,tcp,cleanup').split(',')
const VOICE_MIN = Number(arg('voice-min', 10))
const SHARE_SEC = Number(arg('share-sec', 180))
const TCP_SEC = Number(arg('tcp-sec', 60))
const SPACE_NAME = 'Mídia staging'
const WIN = 'AlgaStgShare'
const log = (...a) => console.log(`[stg ${new Date().toISOString().slice(11, 19)}]`, ...a)
mkdirSync(WORK, { recursive: true })
const load = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d)
const secrets = load(SECRETS, {})
const results = load(OUT, {})
const save = () => {
  writeFileSync(SECRETS, JSON.stringify(secrets, null, 2))
  writeFileSync(OUT, JSON.stringify(results, null, 2))
}

// ─────────────── REST, gateway, SSH ───────────────
async function rest(token, method, path, body) {
  for (let i = 0; ; i++) {
    const res = await fetch(`${API}/api/v1${path}`, {
      method,
      headers: { ...(token && { authorization: `Bearer ${token}` }), ...(body && { 'content-type': 'application/json' }) },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 429 && i < 6) {
      await sleep(10_000)
      continue
    }
    const text = await res.text()
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : null
  }
}

/** A gateway session of `token`'s account, recording every VOICE_* dispatch (B's account: proof the webhook arrived). */
function watchGateway(token) {
  const events = []
  let ws = null
  let closed = false
  const open = () => {
    ws = new WebSocket(`${API.replace(/^http/, 'ws')}/gateway`)
    ws.onopen = () => ws.send(JSON.stringify({ op: 'identify', token }))
    ws.onmessage = (e) => {
      const f = JSON.parse(String(e.data))
      if (f.op === 'dispatch' && (f.t === 'READY' || f.t.startsWith('VOICE_'))) events.push({ at: Date.now(), t: f.t, ...(f.t === 'READY' ? {} : { d: f.d }) })
    }
    ws.onerror = () => undefined
    ws.onclose = () => void (!closed && setTimeout(open, 2000))
  }
  open()
  const hb = setInterval(() => ws?.readyState === 1 && ws.send(JSON.stringify({ op: 'heartbeat' })), 20_000)
  return { events, close: () => ((closed = true), clearInterval(hb), ws?.close()) }
}

const run = (cmd, args, ms = 30_000) =>
  new Promise((res) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    const t = setTimeout(() => killTree(p.pid), ms)
    p.on('close', (code) => (clearTimeout(t), res({ code, out, err })))
  })
/** CPU/RAM of the SFU containers (docker stats CPU % = % of ONE core; the server has 16 threads). Read-only. */
async function sfuSample(tag) {
  const r = await run('ssh', [...SSH, 'docker stats --no-stream --format "{{json .}}" alga-sfu-livekit-1 alga-sfu-caddy-1'])
  if (r.code !== 0) return { tag, error: r.err.trim().slice(0, 200) }
  const rows = r.out.trim().split(/\r?\n/).map((l) => JSON.parse(l)).map((j) => ({ name: j.Name, cpu: j.CPUPerc, mem: j.MemUsage, net: j.NetIO }))
  return { tag, at: new Date().toISOString(), rows }
}

// ─────────────── accounts, space ───────────────
async function setup() {
  if (secrets.users?.a && secrets.users?.b) {
    for (const u of Object.values(secrets.users)) {
      const r = await rest(null, 'POST', '/auth/login', { login: u.username, password: u.password })
      Object.assign(u, { token: r.token, id: r.user.id })
    }
    save()
    return log('accounts reused (logged in again)')
  }
  const legal = await rest(null, 'GET', '/legal')
  const tag = randomBytes(3).toString('hex')
  secrets.users = {}
  for (const k of ['a', 'b']) {
    const username = `stg${k}${tag}`
    const password = randomBytes(18).toString('base64url')
    const r = await rest(null, 'POST', '/auth/register', { email: `${username}@stg.alga.test`, username, displayName: `Stg ${k.toUpperCase()}`, password, birthDate: '1990-03-03', termsVersion: legal.termsVersion })
    secrets.users[k] = { username, password, token: r.token, id: r.user.id }
    save()
    // Same as screenshot.mjs settleLegal: age declared and Termos accepted (the signup already sent both).
    if (r.user.ageBracket === 'unknown') await rest(r.token, 'PATCH', '/users/@me/birth-date', { birthDate: '1990-03-03' })
    if (r.user.needsTermsAcceptance) await rest(r.token, 'POST', '/users/@me/accept-terms', { termsVersion: legal.termsVersion })
  }
  const { a, b } = secrets.users
  await rest(a.token, 'POST', '/relationships', { username: b.username })
  await rest(b.token, 'PUT', `/relationships/${a.id}`, { type: 'friend' })
  const rels = await rest(b.token, 'GET', '/relationships')
  const space = await rest(a.token, 'POST', '/spaces', { name: SPACE_NAME })
  const voice = space.channels.find((c) => c.type === 'voice')
  const inv = await rest(a.token, 'POST', `/spaces/${space.id}/invites`, {})
  await rest(b.token, 'POST', `/invites/${inv.code}`)
  Object.assign(secrets, { spaceId: space.id, voiceId: voice.id })
  // What /voice/join answers for this channel (the app sends the same body with ALGA_E2EE=0). Token not kept.
  const vj = await rest(a.token, 'POST', '/voice/join', { channelId: voice.id, capabilities: { e2ee: false, decode: ['video/H264'] } })
  results.setup = {
    when: new Date().toISOString(),
    friends: rels.find((r) => r.user.id === a.id)?.type,
    space: { e2ee: space.e2ee ?? null, voiceChannel: voice.name, bitrateKbps: voice.bitrateKbps },
    voiceJoin: { url: vj.url, e2ee: vj.e2ee ?? null, streamPresets: vj.streamPresets ?? null, bitrateKbps: vj.bitrateKbps ?? null },
    ready: await rest(null, 'GET', '/ready'),
  }
  save()
  log('setup', JSON.stringify(results.setup))
}

async function cleanupAccounts() {
  const out = (results.cleanup = { when: new Date().toISOString() })
  if (secrets.spaceId) out.space = await rest(secrets.users.a.token, 'DELETE', `/spaces/${secrets.spaceId}`).then(() => 'deleted', (e) => e.message)
  for (const [k, u] of Object.entries(secrets.users ?? {})) {
    out[k] = await rest(u.token, 'DELETE', '/users/@me', { password: u.password, messages: 'delete' }).then((r) => r ?? 'scheduled', (e) => e.message)
  }
  save()
  log('cleanup', JSON.stringify(out))
}

// ─────────────── app instances ───────────────
const PROFILE = { a: 'stg-a', b: 'stg-b' }
// Apps top-left, the share window bottom-right (always on top): the capture never contains anything else.
const POS = { a: { x: 0, y: 0, width: 960, height: 600 }, b: { x: 40, y: 420, width: 960, height: 600 } }
const apps = new Set()
const children = new Set()
let pattern = null
const PC_REGISTRY = `(() => {
  if (window.__stgPcs) return
  const PC = window.RTCPeerConnection
  const pcs = (window.__stgPcs = [])
  window.RTCPeerConnection = class extends PC { constructor(c) { super(c); pcs.push(new WeakRef(this)) } }
})()`
// ICE over TCP only: the SFU's UDP candidates (SDP and trickle) never reach the ICE agent, so only 7881/tcp is left.
const TCP_ONLY = `(() => {
  const P = RTCPeerConnection.prototype
  const isUdp = (c) => / udp /i.test(c || '')
  window.__stgDroppedUdp = 0
  const srd = P.setRemoteDescription
  P.setRemoteDescription = function (d, ...r) {
    if (d && d.sdp) d = { type: d.type, sdp: d.sdp.split(/\\r?\\n/).filter((l) => !(l.startsWith('a=candidate:') && isUdp(l) && ++window.__stgDroppedUdp)).join('\\r\\n') }
    return srd.call(this, d, ...r)
  }
  const aic = P.addIceCandidate
  P.addIceCandidate = function (c, ...r) {
    if (c && isUdp(c.candidate)) return (window.__stgDroppedUdp++, Promise.resolve())
    return aic.call(this, c, ...r)
  }
})()`
// The sharer runs without fake devices: any getUserMedia gets a silent WebAudio track, never the owner's microphone.
const SYNTHETIC_MIC = `(() => {
  const md = navigator.mediaDevices
  if (!md || md.__stg) return
  md.__stg = true
  md.getUserMedia = async (c) => {
    if (c && c.video) throw new DOMException('stg harness: camera blocked', 'NotAllowedError')
    const ctx = new AudioContext({ sampleRate: 48000 })
    const dst = ctx.createMediaStreamDestination()
    const g = ctx.createGain()
    g.gain.value = 0
    const o = ctx.createOscillator()
    o.connect(g).connect(dst)
    o.start()
    return dst.stream
  }
})()`

function signals() {
  const beeps = join(WORK, 'beeps.wav')
  const silence = join(WORK, 'silence.wav')
  const ff = (a) => run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...a])
  // As media-lab.mjs: 40 ms 1 kHz bursts every 750 ms over digital silence (30 s, loops seamlessly).
  return Promise.all([
    existsSync(beeps) || ff(['-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,0.75),0.04),0.3*sin(2*PI*1000*t),0)':s=48000:d=30", '-ac', '1', '-c:a', 'pcm_s16le', beeps]),
    existsSync(silence) || ff(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '10', '-c:a', 'pcm_s16le', silence]),
  ]).then(() => ({ beeps, silence }))
}

async function launch(k, { wav = null, init = [], noUdp = false } = {}) {
  const env = { ...process.env, ALGA_API_URL: API, ALGA_E2EE: '0' }
  delete env.ELECTRON_RENDERER_URL
  const fake = wav ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] : []
  const app = await _electron.launch({
    executablePath: electronPath,
    cwd: APP,
    env,
    args: [APP, `--profile=${PROFILE[k]}`, ...fake, '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  })
  apps.add(app)
  const page = await app.firstWindow()
  page.on('console', (m) => {
    const t = m.text()
    if ((m.type() === 'error' || m.type() === 'warning') && !/default device/.test(t)) log(`${k} console.${m.type()}:`, t.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<jwt>').slice(0, 240))
  })
  page.on('pageerror', (e) => log(`${k} pageerror:`, e.message))
  await app.evaluate(({ shell, Notification, desktopCapturer, BrowserWindow }, [pos, win, noUdp]) => {
    shell.openExternal = async () => undefined
    Notification.prototype.show = function () {}
    const orig = desktopCapturer.getSources.bind(desktopCapturer)
    desktopCapturer.getSources = async (o) => (await orig(o)).filter((s) => s.name.includes(win))
    const w = BrowserWindow.getAllWindows()[0]
    w?.setBounds(pos)
    // A client network that blocks UDP: Chromium gathers no UDP candidates (TCP only, or UDP through a TURN/TCP proxy).
    if (noUdp) w?.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
  }, [POS[k], WIN, noUdp])
  for (const s of [PC_REGISTRY, ...init]) await page.context().addInitScript(s)
  await page.waitForLoadState('domcontentloaded')
  return { app, page, k, user: secrets.users[k] }
}
async function close(inst) {
  if (!inst) return
  apps.delete(inst.app)
  await inst.app.close().catch(() => undefined)
}
async function closeAll() {
  for (const a of [...apps]) await a.close().catch(() => undefined)
  apps.clear()
}
function startPattern() {
  stopPattern()
  // 1280×720 test pattern at 60 fps, borderless, always on top, bottom-right of the 1920×1080 screen (fully visible).
  pattern = spawn('ffplay', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=60', '-an', '-noborder', '-alwaysontop', '-left', '620', '-top', '330', '-window_title', WIN], { stdio: 'ignore' })
  children.add(pattern)
}
function stopPattern() {
  if (!pattern) return
  killTree(pattern.pid)
  children.delete(pattern)
  pattern = null
}
async function cleanup() {
  await closeAll()
  for (const c of children) killTree(c.pid)
  children.clear()
}
process.on('SIGINT', () => void cleanup().then(() => process.exit(130)))

// ─────────────── in-page probes ───────────────
const S = (inst, pick) => inst.page.evaluate(pick)
/** Selected ICE candidate pair (and RTT) of every live RTCPeerConnection of the page. */
const icePath = (inst) =>
  inst.page.evaluate(async () => {
    const out = []
    for (const ref of window.__stgPcs ?? []) {
      const pc = ref.deref()
      if (!pc || pc.connectionState === 'closed') continue
      const m = new Map()
      ;(await pc.getStats()).forEach((s) => m.set(s.id, s))
      const all = [...m.values()]
      const tr = all.find((s) => s.type === 'transport' && s.selectedCandidatePairId)
      const pair = (tr && m.get(tr.selectedCandidatePairId)) ?? all.find((s) => s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded')
      const c = (id) => {
        const x = m.get(id)
        return x && { type: x.candidateType, protocol: x.protocol, address: x.address, port: x.port, relayProtocol: x.relayProtocol ?? null, tcpType: x.tcpType ?? null, networkType: x.networkType ?? null }
      }
      out.push({
        // One PC can carry both directions (LiveKit single peer connection): name what it really carries.
        role: ['outbound-rtp', 'inbound-rtp'].filter((t) => all.some((s) => s.type === t)).map((t) => t.split('-')[0]).join('+') || 'idle',
        state: pc.connectionState,
        local: pair ? c(pair.localCandidateId) : null,
        remote: pair ? c(pair.remoteCandidateId) : null,
        rttMs: typeof pair?.currentRoundTripTime === 'number' ? pair.currentRoundTripTime * 1000 : null,
        meanRttMs: pair?.responsesReceived ? (pair.totalRoundTripTime / pair.responsesReceived) * 1000 : null,
        remoteCandidates: all.filter((s) => s.type === 'remote-candidate').map((x) => `${x.protocol} ${x.address}:${x.port} ${x.candidateType}${x.tcpType ? ` ${x.tcpType}` : ''}`),
        localCandidates: [...new Set(all.filter((s) => s.type === 'local-candidate').map((x) => `${x.protocol} ${x.candidateType}${x.tcpType ? ` ${x.tcpType}` : ''}`))],
      })
    }
    return out
  })
/** Cumulative inbound-rtp counters of `fromId`'s microphone as heard here. */
const audioIn = (inst, fromId) =>
  inst.page.evaluate(async (id) => {
    const x = (await window.__mediaLab.rawStats({ remote: id, source: 'mic' })).find((s) => s.type === 'inbound-rtp')
    if (!x) return null
    const k = ['packetsReceived', 'packetsLost', 'packetsDiscarded', 'jitter', 'concealedSamples', 'silentConcealedSamples', 'concealmentEvents', 'totalSamplesReceived', 'jitterBufferDelay', 'jitterBufferEmittedCount', 'fecPacketsReceived', 'insertedSamplesForDeceleration', 'removedSamplesForAcceleration', 'nackCount']
    return Object.fromEntries(k.map((n) => [n, x[n] ?? null]))
  }, fromId)
const videoIn = (inst, fromId) =>
  inst.page.evaluate(async (id) => {
    const st = await window.__mediaLab.rawStats({ remote: id, source: 'screen' })
    const x = st.find((s) => s.type === 'inbound-rtp')
    if (!x) return null
    const k = ['frameWidth', 'frameHeight', 'framesPerSecond', 'framesReceived', 'framesDecoded', 'framesDropped', 'keyFramesDecoded', 'freezeCount', 'totalFreezesDuration', 'pauseCount', 'totalPausesDuration', 'packetsReceived', 'packetsLost', 'nackCount', 'pliCount', 'firCount', 'decoderImplementation', 'powerEfficientDecoder', 'jitterBufferDelay', 'jitterBufferEmittedCount', 'totalDecodeTime', 'bytesReceived']
    return { ...Object.fromEntries(k.map((n) => [n, x[n] ?? null])), codec: st.find((s) => s.id === x.codecId)?.mimeType ?? null }
  }, fromId)

async function gotoLab(inst) {
  // The query makes it a new document (a hash-only change would keep the app loaded instead of the lab).
  await inst.page.goto(pathToFileURL(join(APP, 'renderer/index.html')).href + '?lab=stg#media-lab')
  await inst.page.waitForSelector('[data-testid=media-lab]', { timeout: 20_000 })
}
/**
 * lab.signIn waits for main's E2EE device, which never comes with ALGA_E2EE=0: it throws after 20 s, by which time the
 * token is set, the gateway is up and READY is in. Its message says so ("gateway ready, e2ee off"); anything else fails.
 */
async function signIn(inst) {
  const err = await inst.page.evaluate((t) => window.__mediaLab.signIn(t).then(() => null, (e) => e.message), inst.user.token)
  if (err && !/gateway ready, e2ee off/.test(err)) throw new Error(`${inst.k} sign-in: ${err}`)
}
// POST /voice/join allows 10 per minute per user: one join per user every 6.5 s at most.
const lastJoin = {}
async function joinCall(inst, o = {}) {
  await sleep(Math.max(0, (lastJoin[inst.k] ?? 0) + 6500 - Date.now()))
  lastJoin[inst.k] = Date.now()
  const t0 = Date.now()
  const r = await inst.page.evaluate(async ([c, o]) => {
    const t = performance.now()
    const r = await window.__mediaLab.joinChannel(c, o)
    return { ...r, totalMs: Math.round(performance.now() - t) }
  }, [secrets.voiceId, o])
  return { ...r, t0, t1: Date.now() }
}
const leave = (inst) => inst.page.evaluate(() => window.__mediaLab.media.leave())
async function clockOffset(a, b) {
  let best = { rtt: Infinity, offset: 0 }
  for (let i = 0; i < 25; i++) {
    const a1 = await a.page.evaluate(() => window.__mediaLab.epochNow())
    const bt = await b.page.evaluate(() => window.__mediaLab.epochNow())
    const a2 = await a.page.evaluate(() => window.__mediaLab.epochNow())
    if (a2 - a1 < best.rtt) best = { rtt: a2 - a1, offset: bt - (a1 + a2) / 2 }
  }
  return best // offset = clock(B) − clock(A)
}
/** Onset probes: A's raw mic (before processing) and A's track decoded at B; same machine clock (offset removed). */
async function startProbes(a, b) {
  await a.page.evaluate(() => (window.__probe = new window.__mediaLab.OnsetProbe(window.__mediaLab.localRawMic(), -30, 250).start()))
  await b.page.evaluate((id) => (window.__probe = new window.__mediaLab.OnsetProbe(window.__mediaLab.remoteMic(id), -30, 250).start()), a.user.id)
}
const onsets = (inst) => inst.page.evaluate(() => [...(window.__probe?.onsets ?? [])])
const stopProbes = (a, b) => Promise.all([a, b].map((i) => i.page.evaluate(() => window.__probe?.stop())))
function pairOnsets(sent, recv, offset, until = Infinity) {
  const lat = []
  let missed = 0
  for (const t of sent.filter((x) => x < until)) {
    const m = recv.find((r) => r - offset > t && r - offset - t < 400)
    if (m === undefined) missed++
    else lat.push(m - offset - t)
  }
  return { lat, missed }
}
const engineVoice = (a, b) =>
  Promise.all([
    S(a, () => {
      const s = window.__mediaLab.useMedia.getState()
      return { conn: s.connection.state, reconnects: s.connection.reconnects, quality: s.self.quality, local: s.local, e2ee: s.e2ee.state, processing: s.self.processingActive }
    }),
    b.page.evaluate((id) => {
      const s = window.__mediaLab.useMedia.getState()
      return { conn: s.connection.state, reconnects: s.connection.reconnects, quality: s.self.quality, fromA: s.participants[id]?.audio ?? null, aQuality: s.participants[id]?.quality ?? null }
    }, a.user.id),
  ])
function lossOver(i0, i1) {
  if (!i0 || !i1) return null
  const recv = i1.packetsReceived - i0.packetsReceived
  const lost = i1.packetsLost - i0.packetsLost
  const samples = i1.totalSamplesReceived - i0.totalSamplesReceived
  return {
    packetsReceived: recv,
    packetsLost: lost,
    lossPct: r1((100 * lost) / Math.max(1, recv + lost)),
    concealedPct: r1((100 * (i1.concealedSamples - i0.concealedSamples)) / Math.max(1, samples)),
    // DTX silence is "concealed" as comfort noise; this is the part that replaced real (non-silent) audio.
    concealedNonSilentPct: r1((100 * (i1.concealedSamples - i0.concealedSamples - (i1.silentConcealedSamples - i0.silentConcealedSamples))) / Math.max(1, samples)),
    concealmentEvents: i1.concealmentEvents - i0.concealmentEvents,
    jitterBufferMs: r1(((i1.jitterBufferDelay - i0.jitterBufferDelay) / Math.max(1, i1.jitterBufferEmittedCount - i0.jitterBufferEmittedCount)) * 1000),
    fecPackets: (i1.fecPacketsReceived ?? 0) - (i0.fecPacketsReceived ?? 0),
    nack: (i1.nackCount ?? 0) - (i0.nackCount ?? 0),
  }
}

/** The 10-minute (or `ms`) run: probes for the whole window, engine + getStats every 5 s, SFU over SSH a few times. */
async function voiceWindow(a, b, ms, offset, label) {
  const in0 = await audioIn(b, a.user.id)
  const back0 = await audioIn(a, b.user.id)
  await startProbes(a, b)
  const t0 = Date.now()
  const samples = []
  const sfu = []
  const sfuAt = new Set([1, Math.floor(ms / 5000 / 2), Math.floor(ms / 5000) - 2].filter((x) => x > 0))
  let lastIn = in0
  for (let n = 1; Date.now() - t0 < ms; n++) {
    await sleep(Math.max(0, t0 + n * 5000 - Date.now()))
    const [[ea, eb], pa, pb, inb] = await Promise.all([engineVoice(a, b), icePath(a), icePath(b), audioIn(b, a.user.id)])
    samples.push({ t: Date.now() - t0, ea, eb, rttA: pa.map((p) => r1(p.rttMs)), rttB: pb.map((p) => r1(p.rttMs)), jitterMs: inb && r1(inb.jitter * 1000), d: lossOver(lastIn, inb) })
    lastIn = inb
    if (sfuAt.has(n)) sfu.push(await sfuSample(`${label} t=${Math.round((Date.now() - t0) / 1000)}s`))
  }
  const sent = await onsets(a)
  await sleep(1000)
  const recv = await onsets(b)
  await stopProbes(a, b)
  const in1 = await audioIn(b, a.user.id)
  const back1 = await audioIn(a, b.user.id)
  const until = Math.max(...sent, 0) - 500
  const { lat, missed } = pairOnsets(sent, recv, offset, until)
  // Stability: latency median per minute.
  const perMin = []
  for (let m = 0; m * 60_000 < ms; m++) {
    const w0 = sent[0] + m * 60_000
    const p = pairOnsets(sent.filter((x) => x >= w0 && x < w0 + 60_000), recv, offset, until)
    if (p.lat.length) perMin.push(r1(summary(p.lat).median))
  }
  const rtt = samples.flatMap((s) => [...s.rttA, ...s.rttB]).filter((x) => typeof x === 'number')
  return {
    seconds: Math.round((Date.now() - t0) / 1000),
    latencyMs: { ...summary(lat), sent: sent.filter((x) => x < until).length, missed, perMinuteMedian: perMin },
    rttMs: summary(rtt),
    jitterMs: summary(samples.map((s) => s.jitterMs).filter((x) => typeof x === 'number')),
    engineJitterMs: summary(samples.map((s) => s.eb.fromA?.jitterMs).filter((x) => typeof x === 'number')),
    engineLossPct: summary(samples.map((s) => s.eb.fromA?.packetLossPct).filter((x) => typeof x === 'number')),
    engineConcealedPct: summary(samples.map((s) => s.eb.fromA?.concealedPct).filter((x) => typeof x === 'number')),
    engineJitterBufferMs: summary(samples.map((s) => s.eb.fromA?.jitterBufferMs).filter((x) => typeof x === 'number')),
    micSendKbps: summary(samples.map((s) => s.ea.local?.bitrateKbps).filter((x) => typeof x === 'number')),
    engineRttMs: summary(samples.map((s) => s.ea.local?.rttMs).filter((x) => typeof x === 'number')),
    quality: [...new Set(samples.flatMap((s) => [`A:${s.ea.quality}`, `B:${s.eb.quality}`]))],
    reconnects: { a: samples.at(-1)?.ea.reconnects, b: samples.at(-1)?.eb.reconnects },
    disconnectedSamples: samples.filter((s) => s.ea.conn !== 'connected' || s.eb.conn !== 'connected').length,
    totalsAtoB: lossOver(in0, in1),
    totalsBtoA: lossOver(back0, back1),
    worst5s: {
      lossPct: Math.max(...samples.map((s) => s.d?.lossPct ?? 0)),
      concealedNonSilentPct: Math.max(...samples.map((s) => s.d?.concealedNonSilentPct ?? 0)),
      jitterBufferMs: Math.max(...samples.map((s) => s.d?.jitterBufferMs ?? 0)),
    },
    sfu,
    samples,
  }
}

// ─────────────── phases ───────────────
async function phaseUi(sig) {
  // The real UI (login screen, space, click on the voice channel), as a user would: proves the product path.
  const out = (results.ui = { when: new Date().toISOString(), steps: [] })
  const gw = watchGateway(secrets.users.b.token)
  const a = await launch('a', { wav: sig.beeps })
  const b = await launch('b', { wav: sig.silence })
  try {
    for (const i of [a, b]) {
      await i.page.reload()
      const nav = i.page.getByRole('navigation', { name: 'Espaços' })
      await i.page.getByLabel('E-mail ou nome de usuário').or(nav).first().waitFor({ timeout: 30_000 })
      if (!(await nav.isVisible())) {
        await i.page.getByLabel('E-mail ou nome de usuário').fill(i.user.username)
        await i.page.getByLabel('Senha', { exact: true }).fill(i.user.password)
        const t0 = Date.now()
        await i.page.getByRole('button', { name: 'Entrar', exact: true }).click()
        await nav.waitFor({ timeout: 30_000 })
        out.steps.push(`${i.k}: login pela tela ${Date.now() - t0} ms`)
      }
    }
    for (const i of [b, a]) {
      await i.page.getByRole('navigation', { name: 'Espaços' }).getByRole('button', { name: new RegExp(`^${SPACE_NAME}`) }).click()
      const t0 = Date.now()
      await i.page.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: /^(Entrar em |Trocar para )?Geral(, .*)?$/ }).first().click()
      await i.page.getByText('Voz conectada').first().waitFor({ timeout: 30_000 })
      out[`clickToConnectedMs_${i.k}`] = Date.now() - t0
      out[`t_${i.k}`] = t0
      log(`${i.k} UI: clique → "Voz conectada" ${out[`clickToConnectedMs_${i.k}`]} ms`)
    }
    await sleep(8000)
    out.iceA = await icePath(a)
    out.iceB = await icePath(b)
    await a.page.screenshot({ path: join(WORK, 'ui-a.png') })
    await b.page.screenshot({ path: join(WORK, 'ui-b.png') })
  } catch (e) {
    out.error = e.message.split('\n')[0]
    log('UI phase failed:', out.error)
    for (const i of [a, b]) await i.page.screenshot({ path: join(WORK, `ui-fail-${i.k}.png`) }).catch(() => undefined)
  }
  await close(a)
  await close(b)
  await sleep(20_000) // participant_left webhooks → VOICE_STATE_REMOVE
  gw.close()
  const { a: ua } = secrets.users
  const first = (t, uid) => gw.events.find((e) => e.t === t && (e.d?.userId === uid || e.d?.user?.id === uid))
  out.gateway = {
    events: gw.events.map((e) => `${e.t}${e.d ? ` ${e.d.userId === ua.id ? 'A' : 'B'} ${e.d.channelId === secrets.voiceId ? 'Geral' : e.d.channelId}` : ''}`),
    aUpdateAfterClickMs: first('VOICE_STATE_UPDATE', ua.id) && out.t_a ? first('VOICE_STATE_UPDATE', ua.id).at - out.t_a : null,
    aRemoved: !!first('VOICE_STATE_REMOVE', ua.id),
  }
  save()
  log('ui', JSON.stringify({ ...out, iceA: out.iceA?.map((p) => `${p.role} ${p.remote?.protocol} ${p.remote?.address}:${p.remote?.port}`) }))
}

async function phaseVoice(sig) {
  const out = (results.voice = { when: new Date().toISOString() })
  const gw = watchGateway(secrets.users.b.token)
  out.sfuBefore = await sfuSample('antes da chamada')
  const a = await launch('a', { wav: sig.beeps })
  const b = await launch('b', { wav: sig.silence })
  await Promise.all([gotoLab(a), gotoLab(b)])
  await Promise.all([signIn(a), signIn(b)])
  out.env = await a.page.evaluate(() => ({ ua: navigator.userAgent, e2eeMain: null }))
  out.env.e2eeMain = await a.page.evaluate(() => window.alga.e2ee.status().then((s) => s.state))
  out.env.electron = await a.app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome }))
  log('signed in; joining…')
  const jb = await joinCall(b)
  const ja = await joinCall(a)
  out.firstJoin = { b: jb, a: ja }
  log('first joins', JSON.stringify(out.firstJoin))
  // Warm joins of A (B stays): 8 × leave/join, 6.5 s apart (rate limit).
  const warm = []
  for (let i = 0; i < 8; i++) {
    await leave(a)
    await sleep(1000)
    warm.push(await joinCall(a))
  }
  out.warmJoin = { joinMs: summary(warm.map((w) => w.joinMs)), totalMs: summary(warm.map((w) => w.totalMs)) }
  log('warm joins', JSON.stringify(out.warmJoin))
  await sleep(4000)
  out.iceA = await icePath(a)
  out.iceB = await icePath(b)
  out.e2ee = await S(a, () => window.__mediaLab.useMedia.getState().e2ee.state)
  out.screenOffered = await S(a, () => window.__mediaLab.useMedia.getState().screen.offered.map((p) => p.id))
  log('ICE A', JSON.stringify(out.iceA.map((p) => [p.role, p.local, p.remote, r1(p.rttMs)])))
  const clk = await clockOffset(a, b)
  out.clock = { offsetMsBminusA: r1(clk.offset), evalRoundTripMs: r1(clk.rtt) }
  log(`voice run ${VOICE_MIN} min…`)
  out.run = await voiceWindow(a, b, VOICE_MIN * 60_000, clk.offset, 'voz')
  const { samples, ...brief } = out.run
  log('voice', JSON.stringify({ ...brief, sfu: brief.sfu.map((s) => s.rows?.[0]?.cpu) }))
  out.playout = await b.page.evaluate(() => {
    const c = window.__mediaLab.media.debug.room?.audioContext
    return c ? { baseLatencyMs: c.baseLatency * 1000, outputLatencyMs: c.outputLatency * 1000 } : null
  })
  gw.close()
  const { a: ua, b: ub } = secrets.users
  const ev = (uid) => gw.events.find((e) => e.t === 'VOICE_STATE_UPDATE' && e.d?.userId === uid)
  out.webhook = {
    bJoinToUpdateMs: ev(ub.id) ? { afterCall: ev(ub.id).at - jb.t0, afterConnected: ev(ub.id).at - jb.t1 } : null,
    aJoinToUpdateMs: ev(ua.id) ? { afterCall: ev(ua.id).at - ja.t0, afterConnected: ev(ua.id).at - ja.t1 } : null,
    counts: gw.events.reduce((m, e) => ((m[e.t] = (m[e.t] ?? 0) + 1), m), {}),
  }
  save()
  return { a, b }
}

async function phaseShare(prev) {
  const out = (results.share = { when: new Date().toISOString(), runs: [] })
  // B (fake mic, viewer) stays in the call; A comes back as the sharer: real window capture, no microphone.
  let b = prev?.b
  if (prev?.a) await close(prev.a)
  const sig = await signals()
  if (!b) {
    b = await launch('b', { wav: sig.silence })
    await gotoLab(b)
    await signIn(b)
    await joinCall(b)
  }
  startPattern()
  const a = await launch('a', { init: [SYNTHETIC_MIC] })
  try {
    await gotoLab(a)
    await signIn(a)
    out.join = await joinCall(a, { publishMic: false })
    out.offered = await S(a, () => window.__mediaLab.useMedia.getState().screen.offered.map((p) => p.id))
    await sleep(1500)
    const sourceId = await a.page.evaluate(async (w) => (await window.__mediaLab.media.getScreenSources()).find((s) => s.name.includes(w))?.id ?? null, WIN)
    out.sources = await a.page.evaluate(async () => (await window.__mediaLab.media.getScreenSources()).map((s) => `${s.kind}: ${s.name}`))
    if (!sourceId) throw new Error(`test window not among capture sources: ${out.sources.join(', ')}`)
    for (const quality of ['1080p30', '720p60']) {
      const r = { quality }
      await a.page.evaluate((o) => window.__mediaLab.media.startScreenShare(o), { sourceId, audio: false, quality })
      await sleep(1500)
      const tw = Date.now()
      await b.page.evaluate((id) => window.__mediaLab.media.watch(id, 'source'), a.user.id)
      r.firstFrameMs = await b.page
        .waitForFunction((id) => (document.querySelector(`[data-testid="video-${id}"]`)?.videoWidth ?? 0) > 0, a.user.id, { timeout: 20_000, polling: 50 })
        .then(() => Date.now() - tw, () => null)
      r.sender0 = await S(a, () => {
        const s = window.__mediaLab.useMedia.getState().screen
        return { preset: s.preset, contentType: s.contentType, codec: s.codec, hardwareEncoder: s.hardwareEncoder, error: s.error }
      })
      r.captureFps = await a.page.evaluate(() => window.__mediaLab.captureFps(3000))
      const v0 = await videoIn(b, a.user.id)
      const t0 = Date.now()
      const samples = []
      r.sfu = []
      for (let n = 1; Date.now() - t0 < SHARE_SEC * 1000; n++) {
        await sleep(Math.max(0, t0 + n * 5000 - Date.now()))
        const [sa, vb, pb] = await Promise.all([
          S(a, () => window.__mediaLab.useMedia.getState().screen.stats),
          b.page.evaluate((id) => window.__mediaLab.useMedia.getState().viewers[id]?.stats ?? null, a.user.id),
          icePath(b),
        ])
        samples.push({ t: Date.now() - t0, layers: sa?.layers?.map((l) => `${l.rid}:${l.width}x${l.height}@${Math.round(l.fps)} ${Math.round(l.bitrateKbps)}kbps ${l.qualityLimitationReason}`), sendKbps: sa?.bitrateKbps, rx: vb, rtt: pb.map((p) => r1(p.rttMs)) })
        if (n === 6 || n === Math.floor(SHARE_SEC / 5) - 3) r.sfu.push(await sfuSample(`tela ${quality} t=${Math.round((Date.now() - t0) / 1000)}s`))
      }
      r.pacing = await b.page.evaluate((id) => window.__mediaLab.frameTimes(document.querySelector(`[data-testid="video-${id}"]`), 10_000), a.user.id)
      const v1 = await videoIn(b, a.user.id)
      r.sender = await S(a, () => {
        const s = window.__mediaLab.useMedia.getState().screen
        return { preset: s.preset, codec: s.codec, hardwareEncoder: s.hardwareEncoder, stats: s.stats }
      })
      const rx = samples.map((s) => s.rx).filter(Boolean)
      r.receiver = {
        seconds: Math.round((Date.now() - t0) / 1000),
        fps: summary(rx.map((x) => x.fps)),
        resolution: [...new Set(rx.map((x) => `${x.width}x${x.height}`))],
        kbps: summary(rx.map((x) => x.bitrateKbps)),
        decoder: [...new Set(rx.map((x) => `${x.codec} ${x.decoderImplementation} hw=${x.powerEfficientDecoder}`))],
        engineLossPct: summary(rx.map((x) => x.packetLossPct)),
        jitterBufferMs: summary(rx.map((x) => x.jitterBufferMs).filter((x) => typeof x === 'number')),
        rttMs: summary(samples.flatMap((s) => s.rtt).filter((x) => typeof x === 'number')),
        totals: v0 && v1 && {
          framesDecoded: v1.framesDecoded - v0.framesDecoded,
          framesDropped: v1.framesDropped - v0.framesDropped,
          freezeCount: v1.freezeCount - v0.freezeCount,
          freezesMs: Math.round((v1.totalFreezesDuration - v0.totalFreezesDuration) * 1000),
          pauseCount: v1.pauseCount - v0.pauseCount,
          packetsLost: v1.packetsLost - v0.packetsLost,
          packetsReceived: v1.packetsReceived - v0.packetsReceived,
          nack: v1.nackCount - v0.nackCount,
          pli: v1.pliCount - v0.pliCount,
          keyFrames: v1.keyFramesDecoded - v0.keyFramesDecoded,
          meanDecodeMs: r1(((v1.totalDecodeTime - v0.totalDecodeTime) / Math.max(1, v1.framesDecoded - v0.framesDecoded)) * 1000),
          mbit: r1(((v1.bytesReceived - v0.bytesReceived) * 8) / 1e6 / ((Date.now() - t0) / 1000)),
          codec: v1.codec,
          decoder: v1.decoderImplementation,
        },
      }
      r.layersSeen = [...new Set(samples.flatMap((s) => s.layers ?? []).map((l) => l.replace(/ \d+kbps/, '')))]
      r.samples = samples
      out.runs.push(r)
      save()
      log('share', quality, JSON.stringify({ firstFrameMs: r.firstFrameMs, captureFps: r.captureFps, sender0: r.sender0, receiver: r.receiver, pacing: r.pacing }))
      await b.page.evaluate((id) => window.__mediaLab.media.unwatch(id), a.user.id)
      await a.page.evaluate(() => window.__mediaLab.media.stopScreenShare())
      await sleep(3000)
    }
  } finally {
    stopPattern()
    await close(a)
    await close(b)
  }
}

async function phaseTcp(sig) {
  const out = (results.tcp = { when: new Date().toISOString() })
  // Dropping the SFU's UDP candidates alone is not enough (measured: the SFU's own checks reach our UDP host candidate
  // and ICE picks that peer-reflexive pair), so the client also gathers no UDP at all.
  const a = await launch('a', { wav: sig.beeps, init: [TCP_ONLY], noUdp: true })
  const b = await launch('b', { wav: sig.silence, init: [TCP_ONLY], noUdp: true })
  try {
    await Promise.all([gotoLab(a), gotoLab(b)])
    await Promise.all([signIn(a), signIn(b)])
    out.joinB = await joinCall(b).catch((e) => ({ error: e.message.split('\n')[0] }))
    out.joinA = await joinCall(a).catch((e) => ({ error: e.message.split('\n')[0] }))
    log('tcp joins', JSON.stringify({ a: out.joinA, b: out.joinB }))
    if (out.joinA.error || out.joinB.error) return save()
    await sleep(4000)
    out.iceA = await icePath(a)
    out.iceB = await icePath(b)
    out.droppedUdp = { a: await a.page.evaluate(() => window.__stgDroppedUdp), b: await b.page.evaluate(() => window.__stgDroppedUdp) }
    log('tcp ICE A', JSON.stringify(out.iceA.map((p) => [p.role, p.local, p.remote, r1(p.rttMs)])))
    const clk = await clockOffset(a, b)
    out.run = await voiceWindow(a, b, TCP_SEC * 1000, clk.offset, 'tcp')
    const { samples, ...brief } = out.run
    log('tcp', JSON.stringify(brief))
    save()
  } finally {
    await close(a)
    await close(b)
  }
}

// ─────────────── main ───────────────
try {
  if (!argv.includes('--no-build')) {
    log('building into', APP)
    const r = spawnSync(`npx electron-vite build --outDir "${APP}"`, { cwd: desktop, stdio: 'inherit', shell: true })
    if (r.status !== 0) throw new Error('build failed')
    const git = (a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' }).stdout.trim()
    results.build = { when: new Date().toISOString(), head: git(['rev-parse', '--short', 'HEAD']), dirtyFiles: git(['status', '--porcelain']).split('\n').filter(Boolean).length }
    writeFileSync(join(APP, 'package.json'), JSON.stringify({ name: '@alga/desktop', productName: 'Alga Meet', version: '0.1.0', main: './main/index.js' }, null, 2))
    cpSync(join(desktop, 'build', 'runtime'), join(APP, 'build', 'runtime'), { recursive: true })
  }
  const sig = await signals()
  if (phases.includes('setup')) await setup()
  else if (secrets.users) for (const u of Object.values(secrets.users)) u.token = (await rest(null, 'POST', '/auth/login', { login: u.username, password: u.password })).token
  if (phases.includes('ui')) await phaseUi(sig)
  let kept = null
  if (phases.includes('voice')) kept = await phaseVoice(sig)
  if (phases.includes('share')) await phaseShare(kept)
  else if (kept) for (const i of Object.values(kept)) await close(i)
  if (phases.includes('tcp')) await phaseTcp(sig)
  const logs = await run('ssh', [...SSH, 'docker logs --since 60m alga-sfu-livekit-1 2>&1 | tail -200'])
  writeFileSync(join(WORK, 'livekit-tail.log'), logs.out)
  results.sfuAfter = await sfuSample('depois')
  save()
  if (phases.includes('cleanup')) await cleanupAccounts()
  log('done →', OUT)
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  save()
  await cleanup()
}
