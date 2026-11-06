// Sala de Cinema lab (Task 15, spec §8): 2–4 REAL app instances against the isolated QA stack. Every displayed frame of
// every window is logged with requestVideoFrameCallback (wall-clock display instant, mediaTime); the §8 numbers are
// computed offline from those logs (same machine = same clock). Optional network impairment of the P2P mesh: every
// cinema RTCPeerConnection only learns remote candidates rewritten to a per-candidate UDP proxy (a worker thread built
// on scripts/netem/udp-impair.mjs's Link: loss, delay, jitter per direction; one shared token bucket caps the HOST's
// total upload). Signalling (gateway WebSocket) and the LiveKit call are not impaired.
//   QA_WORK=<dir> node scripts/qa-stack.mjs build && QA_WORK=<dir> node scripts/qa-stack.mjs start
//   QA_WORK=<dir> node scripts/cinema-lab.mjs --instances=2 --checks
//   QA_WORK=<dir> node scripts/cinema-lab.mjs --instances=4 --late --play=560 --netem=loss=1,delay=20,jitter=2 --host-cap=12000 --shots
//   QA_WORK=<dir> node scripts/qa-stack.mjs stop
// Flags: --instances=2..4 · --play=<s> of continuous playback · --late (the last instance sits 30 s into the play) ·
// --late-trials=<n> (then stands up and sits again, n in all) · --pauses=<n> · --checks (canPlay per fixture first) ·
// --netem=<profile per direction, udp-impair keys> · --host-cap=<kbit/s, host upload, needs --netem> ·
// --route=webaudio|mediastream · --e2ee (the space's calls are E2EE: meshes tagged) · --film=<path> · --shots · --tag=<name> · --keep
// Output: <QA_WORK>/cinema-lab-<tag>.json (summary + raw logs) and docs/benchmarks/cinema-engine-<tag>.json (summary).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { networkInterfaces } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { _electron as electron } from 'playwright'
import * as Q from './qa-stack.mjs'
import { parseProfile } from '../../../scripts/netem/udp-impair.mjs'

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d
const flag = (k) => process.argv.includes(`--${k}`)
const N = Math.min(4, Math.max(2, Number(arg('instances', 2))))
const PLAY_S = Number(arg('play', 60))
const LATE = flag('late') || Number(arg('late-trials', 0)) > 0
const LATE_TRIALS = Math.max(LATE ? 1 : 0, Number(arg('late-trials', LATE ? 1 : 0)))
const PAUSES = Number(arg('pauses', 3))
const NETEM = arg('netem', '')
const HOST_CAP = Number(arg('host-cap', 0))
const ROUTE = arg('route', 'webaudio')
const TAG = arg('tag', `${N}x${NETEM ? '-netem' : ''}`)
const KEEP = flag('keep')
const E2EE = flag('e2ee')
const SHOTS_ON = flag('shots')
const FPS = 24
const FRAME_MS = 1000 / FPS
const FIX = join(Q.appDir, 'test-fixtures', 'cinema')
const SRC = arg('film', join(FIX, 'long-h264-1080p-8mbps-10min.mkv'))
const SUBS = join(FIX, 'h264-aac-srt-ass.mkv')
const FFMPEG = join(Q.appDir, 'build', 'ffmpeg', 'ffmpeg.exe')
const SHOTS = join(Q.repo, 'docs', 'screenshots')
const PREFIX = '2026-11-05-cinema-lab'
const NAMES = [['ana', 'Ana Cine'], ['bruno', 'Bruno Cine'], ['carla', 'Carla Cine'], ['davi', 'Davi Cine']]
const LAN = Object.values(networkInterfaces()).flat().find((x) => x && x.family === 'IPv4' && !x.internal && /^(192\.168|10)\./.test(x.address))?.address
mkdirSync(Q.WORK, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const electronPath = createRequire(join(Q.appDir, 'package.json'))('electron')
const log = (...a) => console.log(`[cinema-lab ${new Date().toISOString().slice(11, 19)}]`, ...a)
const r1 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10) / 10)
const pct = (xs, p) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]
}
const results = []
const M = {} // measurements
const inst = [] // { k, name, user, app, page, logs }

// ── QA accounts (as cinema-e2e.mjs) ─────────────────────────
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
  const username = `lab${tag}${run}`
  const email = `${username}@qa.alga.test`
  const password = `sessao ${run} poltrona ${tag}`
  const r = await rest(null, 'POST', '/auth/register', { email, username, displayName, password, birthDate: '1995-05-05', termsVersion: legal.termsVersion })
  await rest(null, 'POST', '/auth/verify-email', { token: await mailedToken(email, 'verify') })
  return { username, password, token: r.token, id: r.user.id }
}

/** The lab film: the fixture's video + its audio twice (an audio switch to prove) + the SRT and ASS tracks and font. */
function film() {
  // keyed by the source's path, size and mtime: another --film (or a re-encoded fixture) never reuses a stale remux
  const st = statSync(SRC)
  const key = createHash('sha256').update(`${SRC}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 12)
  const out = join(Q.WORK, `Noite.no.Cinema.Lab.${key}.mkv`)
  if (existsSync(out)) return out
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', SRC, '-i', SUBS, '-map', '0:v', '-map', '0:a:0', '-map', '0:a:0',
    '-map', '1:s:0', '-map', '1:s:1', '-map', '1:t', '-c', 'copy',
    '-metadata:s:a:0', 'language=por', '-metadata:s:a:0', 'title=Dublado', '-metadata:s:a:1', 'language=eng', '-metadata:s:a:1', 'title=Original',
    '-metadata:s:s:0', 'title=SRT', '-metadata:s:s:1', 'title=ASS', '-disposition:a:0', 'default', '-disposition:a:1', '0', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`fixture: ${r.stderr}`)
  return out
}
function linkFfmpeg() {
  const dst = join(Q.QA_APP, 'build', 'ffmpeg')
  if (!existsSync(dst)) symlinkSync(join(Q.appDir, 'build', 'ffmpeg'), dst, 'junction')
}
/** The QA build seen from <repo>/node_modules: main finds the MLS WASM at <app>/../../native/mls/pkg (E2EE works). */
const APP = join(Q.repo, 'node_modules', '.alga-qa-lab')
if (!existsSync(APP)) symlinkSync(Q.QA_APP, APP, 'junction')

// ── network impairment of the mesh (worker thread) ──────────
/** Runs in a worker (eval, CommonJS): one UDP proxy per remote candidate, built on udp-impair's Link. */
function netemWorker() {
  const { parentPort, workerData: W } = require('node:worker_threads')
  const dgram = require('node:dgram')
  return import(W.impairUrl).then(({ Link, rng, DEFAULT_PROFILE }) => {
    const now = () => Number(process.hrtime.bigint()) / 1e6
    const random = rng(7)
    const links = new Set()
    let running = false
    const tick = () => {
      const t = now()
      let next = Infinity
      for (const l of links) next = Math.min(next, l.flush(t))
      if (next === Infinity) return void (running = false)
      if (next - t > 20) setTimeout(tick, next - t - 17)
      else setImmediate(tick)
    }
    const sched = { wake: () => { if (!running) { running = true; setImmediate(tick) } } }
    const base = { ...DEFAULT_PROFILE, ...W.profile }
    const hostProf = { ...base, rate: W.hostCapKbps || 0 }
    const bucket = { busy: 0 } // every host-outbound link shares it: the cap is on the host's total upload
    const share = (l) => Object.defineProperty(l, 'busyUntil', { get: () => bucket.busy, set: (v) => { bucket.busy = v } })
    // what a voice packet leaving the host would wait in its capped uplink right now (ms), every 100 ms
    const queue = []
    if (W.hostCapKbps) setInterval(() => queue.push([Date.now(), Math.round(Math.max(0, bucket.busy - now()))]), 100)
    const proxies = []
    parentPort.on('message', (m) => {
      if (m.type === 'open') {
        const listen = dgram.createSocket('udp4')
        const px = { from: m.from, owner: m.owner, links: [] }
        listen.on('message', (msg, ri) => {
          const key = `${ri.address}:${ri.port}`
          px.clients ??= new Map()
          let c = px.clients.get(key)
          if (!c) {
            const sock = dgram.createSocket('udp4')
            sock.bind(0, W.ip)
            const up = new Link(m.fromHost ? hostProf : base, random, (b) => sock.send(b, m.port, m.ip))
            const down = new Link(m.ownerHost ? hostProf : base, random, (b) => listen.send(b, ri.port, ri.address))
            if (m.fromHost) share(up)
            if (m.ownerHost) share(down)
            c = { sock, up, down }
            sock.on('message', (b) => c.down.push(b, now(), sched))
            sock.on('error', () => undefined)
            links.add(up)
            links.add(down)
            px.links.push({ dir: 'up', sender: m.from, l: up }, { dir: 'down', sender: m.owner, l: down })
            px.clients.set(key, c)
          }
          c.up.push(msg, now(), sched)
        })
        listen.on('error', () => undefined)
        listen.bind(0, W.ip, () => {
          px.listen = listen
          proxies.push(px)
          parentPort.postMessage({ type: 'opened', id: m.id, port: listen.address().port })
        })
      } else if (m.type === 'stats') {
        const bySender = {}
        for (const px of proxies) for (const { sender, l } of px.links) {
          const s = (bySender[sender] ??= { in: 0, sent: 0, lost: 0, queueDrop: 0, bytesIn: 0, bytesSent: 0 })
          for (const k in s) s[k] += l.stats[k] ?? 0
        }
        parentPort.postMessage({ type: 'stats', id: m.id, proxies: proxies.length, bySender })
      } else if (m.type === 'queue') {
        parentPort.postMessage({ type: 'queue', id: m.id, samples: queue })
      } else if (m.type === 'close') {
        for (const px of proxies) {
          px.listen?.close()
          for (const c of px.clients?.values() ?? []) c.sock.close()
        }
        links.clear()
        parentPort.postMessage({ type: 'closed' })
      }
    })
    parentPort.postMessage({ type: 'ready' })
  })
}
let netem = null
async function startNetem() {
  if (!NETEM) return
  if (!LAN) throw new Error('netem needs a LAN IPv4 (192.168.x / 10.x) on this machine')
  const worker = new Worker(`(${netemWorker.toString()})()`, {
    eval: true,
    workerData: { impairUrl: pathToFileURL(join(Q.repo, 'scripts', 'netem', 'udp-impair.mjs')).href, ip: LAN, profile: parseProfile(NETEM), hostCapKbps: HOST_CAP },
  })
  const pending = new Map()
  let seq = 0
  await new Promise((res, rej) => {
    worker.once('error', rej)
    worker.on('message', (m) => (m.type === 'ready' ? res() : pending.get(m.id)?.(m)))
  })
  const call = (m) => new Promise((res) => { const id = ++seq; pending.set(id, res); worker.postMessage({ ...m, id }) })
  const owners = new Map() // local candidate port → instance key
  const proxyOf = new Map()
  netem = {
    worker, owners,
    /** page `from` will send to candidate ip:port: give it the proxy port in front of it. */
    async port(from, ip, port) {
      const key = `${from}|${ip}:${port}`
      if (!proxyOf.has(key)) {
        proxyOf.set(key, (async () => {
          for (let i = 0; i < 40 && !owners.has(port); i++) await sleep(50)
          const owner = owners.get(port) ?? '?'
          const r = await call({ type: 'open', ip, port, from, owner, fromHost: from === 'ana', ownerHost: owner === 'ana' })
          return r.port
        })())
      }
      return proxyOf.get(key)
    },
    stats: () => call({ type: 'stats' }),
    queue: () => call({ type: 'queue' }),
    async close() {
      const done = new Promise((r) => worker.on('message', (m) => m.type === 'closed' && r()))
      worker.postMessage({ type: 'close' })
      await Promise.race([done, sleep(2000)])
      await worker.terminate()
    },
  }
  log('netem', NETEM, HOST_CAP ? `host cap ${HOST_CAP} kbit/s` : '', 'proxies on', LAN)
}

// ── in-page instrumentation (init script; harness only) ─────
const LAB = ({ netem, lan, route }) => {
  const L = (window.__lab = { frames: [], events: [], states: [], sent: [], tags: { tagged: 0, untagged: 0 }, pcs: [], taps: [], index: {}, wire: [] })
  try {
    const k = 'alga.cinema.v1'
    localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) ?? '{}'), route, ipSeen: true, echoSeen: true }))
  } catch {}
  // gateway: cinema_* frames sent (time, op, E2EE tag on offers/answers) and CINEMA_STATE/CINEMA_PIECES received
  const onMsg = (ev) => {
    if (typeof ev.data !== 'string' || ev.data.indexOf('"CINEMA_') < 0) return
    let f
    try { f = JSON.parse(ev.data) } catch { return }
    if (f.t === 'CINEMA_STATE') L.states.push({ r: Date.now(), sessionId: f.d.sessionId, ended: !!f.d.ended, playback: f.d.playback ?? null, seats: (f.d.seats ?? []).map((s) => [s.userId, s.status, s.direct]) })
    else if (f.t === 'CINEMA_PIECES') {
      const tr = (L.index[f.d.track] ??= [])
      f.d.items.forEach((it, i) => { tr[f.d.from + i] = it[2] })
    }
  }
  const send = WebSocket.prototype.send
  WebSocket.prototype.send = function (data) {
    if (!this.__lab) { this.__lab = true; this.addEventListener('message', onMsg) }
    if (typeof data === 'string' && data.startsWith('{"op":"cinema_')) {
      const op = data.slice(7, data.indexOf('"', 7))
      L.sent.push([Date.now(), op])
      if (op === 'cinema_signal' && /"kind":"(offer|answer)"/.test(data)) /"tag":"/.test(data) ? L.tags.tagged++ : L.tags.untagged++
    }
    return send.call(this, data)
  }
  // the stage <video> (MSE: blob: src): every displayed frame and its media events
  let cur = null
  const frame = (v) => (_now, m) => {
    if (v !== cur) return
    L.frames.push([performance.timeOrigin + m.expectedDisplayTime, m.mediaTime, v.playbackRate])
    v.requestVideoFrameCallback(frame(v))
  }
  setInterval(() => {
    const v = [...document.querySelectorAll('video')].find((x) => x.src.startsWith('blob:'))
    if (!v || v === cur) return
    cur = v
    L.events.push([Date.now(), 'attach', v.currentTime, v.readyState])
    for (const e of ['loadeddata', 'playing', 'pause', 'seeking', 'seeked', 'waiting']) v.addEventListener(e, () => L.events.push([Date.now(), e, v.currentTime, v.readyState]))
    v.requestVideoFrameCallback(frame(v))
  }, 20)
  // the cinema's RTCPeerConnections ({ iceServers, iceTransportPolicy } only; LiveKit's carry more keys)
  const PC = window.RTCPeerConnection
  function LabPC(cfg, ...rest) {
    const pc = new PC(cfg, ...rest)
    if (cfg && Object.keys(cfg).sort().join() === 'iceServers,iceTransportPolicy') {
      pc.__cinema = true
      L.pcs.push(pc)
      // swarm wire (protocol.ts): requests sent, and the first/last chunk of every piece received
      const kinds = ['v', 'a', 's', 'poster', 'thumbs']
      const tr = (dv) => (dv.getUint8(1) === 1 || dv.getUint8(1) === 2 ? `${kinds[dv.getUint8(1)]}${dv.getUint16(2, true)}` : kinds[dv.getUint8(1)])
      const tap = (ch) => {
        const send = ch.send.bind(ch)
        ch.send = (d) => {
          if (d instanceof ArrayBuffer && new DataView(d).getUint8(0) === 3) { const dv = new DataView(d); L.wire.push([Date.now(), 'req', tr(dv), dv.getUint32(4, true), dv.getUint8(12)]) }
          return send(d)
        }
        ch.addEventListener('message', (ev) => {
          if (!(ev.data instanceof ArrayBuffer) || new DataView(ev.data).getUint8(0) !== 6) return
          const dv = new DataView(ev.data)
          const off = dv.getUint32(12, true)
          const total = dv.getUint32(16, true)
          if (off === 0) L.wire.push([Date.now(), 'first', tr(dv), dv.getUint32(4, true), total])
          if (off + ev.data.byteLength - 20 >= total) L.wire.push([Date.now(), 'done', tr(dv), dv.getUint32(4, true), total])
        })
      }
      const cdc = pc.createDataChannel.bind(pc)
      pc.createDataChannel = (...a) => { const ch = cdc(...a); tap(ch); return ch }
      pc.addEventListener('datachannel', (e) => tap(e.channel))
      if (netem) pc.addEventListener('icecandidate', (e) => { if (e.candidate?.candidate) void window.__labLocal(e.candidate.candidate) })
    }
    return pc
  }
  LabPC.prototype = PC.prototype
  Object.setPrototypeOf(LabPC, PC)
  window.RTCPeerConnection = LabPC
  if (netem) {
    // remote candidates → the impairment proxy in front of them (udp host candidates on the LAN address only)
    const rewrite = async (cand) => {
      const p = cand.replace(/^a=/, '').trim().split(/\s+/)
      if (p.length < 8 || p[2].toLowerCase() !== 'udp' || p[7] !== 'host') return null
      const ip = p[4].endsWith('.local') ? lan : p[4]
      if (ip !== lan) return null
      p[4] = lan
      p[5] = String(await window.__labPort(ip, Number(p[5])))
      return p.join(' ')
    }
    const add = PC.prototype.addIceCandidate
    PC.prototype.addIceCandidate = async function (c, ...rest) {
      if (!this.__cinema || !c?.candidate) return add.call(this, c, ...rest)
      const r = await rewrite(c.candidate)
      if (!r) return
      return add.call(this, { candidate: r, sdpMLineIndex: c.sdpMLineIndex ?? 0, sdpMid: c.sdpMid ?? null }, ...rest)
    }
    const setRemote = PC.prototype.setRemoteDescription
    PC.prototype.setRemoteDescription = async function (d, ...rest) {
      if (!this.__cinema || !d?.sdp || !d.sdp.includes('a=candidate:')) return setRemote.call(this, d, ...rest)
      const lines = []
      for (const line of d.sdp.split('\r\n')) {
        if (!line.startsWith('a=candidate:')) { lines.push(line); continue }
        const r = await rewrite(line)
        if (r) lines.push(`a=${r}`)
      }
      return setRemote.call(this, { type: d.type, sdp: lines.join('\r\n') }, ...rest)
    }
  }
  // data-channel bytes of the cinema mesh (closed connections keep their last reading)
  L.dc = async () => {
    const out = { sent: 0, recv: 0, pairs: [] }
    for (const pc of L.pcs) {
      if (pc.connectionState !== 'closed') {
        try {
          const st = await pc.getStats()
          let sent = 0
          let recv = 0
          let pair = null
          st.forEach((s) => {
            if (s.type === 'data-channel' && s.label === 'cinema') { sent += s.bytesSent ?? 0; recv += s.bytesReceived ?? 0 }
            if (s.type === 'transport' && s.selectedCandidatePairId) pair = st.get(s.selectedCandidatePairId)
          })
          const lc = pair && st.get(pair.localCandidateId)
          const rc = pair && st.get(pair.remoteCandidateId)
          pc.__last = { sent, recv, pair: pair ? `${lc?.candidateType}→${rc?.candidateType} ${rc?.address === lan ? '<LAN>' : '<addr>'}:${rc?.port} rtt ${Math.round((pair.currentRoundTripTime ?? 0) * 1000)} ms` : null }
        } catch {}
      }
      if (pc.__last) { out.sent += pc.__last.sent; out.recv += pc.__last.recv; out.pairs.push(pc.__last.pair) }
    }
    return out
  }
  // film audio: an AnalyserNode beside every connection of the film's graph to its output (both routes)
  const film = new WeakSet()
  const mes = AudioContext.prototype.createMediaElementSource
  AudioContext.prototype.createMediaElementSource = function (el) {
    film.add(this)
    L.filmCtx = this
    return mes.call(this, el)
  }
  const connect = AudioNode.prototype.connect
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = connect.call(this, dest, ...rest)
    try {
      const toDevice = dest instanceof AudioDestinationNode
      if (film.has(this.context) && this instanceof GainNode && (toDevice || dest instanceof MediaStreamAudioDestinationNode)) {
        const an = this.context.createAnalyser()
        an.fftSize = 2048
        connect.call(this, an)
        L.taps.push({ route: toDevice ? 'webaudio' : 'mediastream (graph)', an })
        if (!toDevice) {
          // what the hidden <audio> plays: the destination's stream itself, read back in a second context
          const c2 = new AudioContext()
          const an2 = c2.createAnalyser()
          an2.fftSize = 2048
          connect.call(c2.createMediaStreamSource(dest.stream), an2)
          L.taps.push({ route: 'mediastream (stream)', an: an2 })
        }
      }
    } catch {}
    return r
  }
  L.levels = () => L.taps.map(({ route, an }) => {
    const b = new Float32Array(an.fftSize)
    an.getFloatTimeDomainData(b)
    let s = 0
    for (const x of b) s += x * x
    const rms = Math.sqrt(s / b.length)
    return { route, dbfs: rms > 0 ? Math.round(20 * Math.log10(rms) * 10) / 10 : -999 }
  })
  L.latencyMs = () => (L.filmCtx ? ((L.filmCtx.outputLatency || 0) + L.filmCtx.baseLatency) * 1000 : 0)
  // wall clock vs the rVFC timeline (performance.timeOrigin + now): bounds the error when windows are compared
  L.bias = () => Date.now() - (performance.timeOrigin + performance.now())
  L.lanes = () => L.pcs.filter((pc) => pc.connectionState === 'connected').length
}

// ── windows ─────────────────────────────────────────────────
const W = 1280
const H = 760
const POS = [[0, 0], [640, 0], [0, 300], [640, 300]]
async function launch(i) {
  const [k, displayName] = NAMES[i]
  rmSync(join(process.env.APPDATA ?? '', 'Alga Meet Dev', 'profiles', `qa-lab-${k}`), { recursive: true, force: true })
  const env = { ...process.env, ALGA_API_URL: Q.API, ALGA_E2E: '1', ALGA_E2EE: '1' }
  delete env.ELECTRON_RENDERER_URL
  const app = await electron.launch({
    executablePath: electronPath, cwd: Q.appDir, env,
    args: [APP, `--profile=qa-lab-${k}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
      '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.log(`[${k}] pageerror`, e.message))
  page.on('console', (m) => {
    const tx = m.text()
    if (m.type() === 'error' || tx.includes('[cinema')) console.log(`[${k}] ${m.type()}`, tx.slice(0, 240))
  })
  await app.evaluate(({ BrowserWindow }, o) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(o.w, o.h)
    win.setPosition(o.x, o.y)
  }, { x: POS[i][0], y: POS[i][1], w: W, h: H })
  if (NETEM) {
    await page.context().exposeBinding('__labLocal', (_s, cand) => {
      const p = cand.split(/\s+/)
      if (p[2]?.toLowerCase() === 'udp') netem.owners.set(Number(p[5]), k)
    })
    await page.context().exposeBinding('__labPort', (_s, ip, port) => netem.port(k, ip, port))
  }
  await page.context().addInitScript(LAB, { netem: !!NETEM, lan: LAN, route: ROUTE })
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  const me = { k, name: displayName, app, page, logs: { frames: [], events: [], states: [], sent: [], wire: [] } }
  inst[i] = me
  return me
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
    log(`OK   ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)}` : ''}`)
    return detail
  } catch (e) {
    results.push({ name, pass: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 600) })
    log(`FAIL ${name} — ${e?.message ?? e}`)
    for (const x of inst) await x?.page.screenshot({ path: join(Q.WORK, `lab-fail-${results.length}-${x.k}.png`) }).catch(() => undefined)
    return null
  }
}
const until = async (fn, what, timeout = 15_000, every = 100) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const v = await fn().catch(() => null)
    if (v) return v
    await sleep(every)
  }
  throw new Error(`timeout: ${what}`)
}
const video = (page) => page.evaluate(() => {
  const v = [...document.querySelectorAll('video')].find((x) => x.src.startsWith('blob:'))
  return v && { t: v.currentTime, paused: v.paused, ready: v.readyState, rate: v.playbackRate }
})
const statsText = (page) => page.evaluate(() => [...document.querySelectorAll('[aria-label="Estatísticas"]')].map((e) => e.textContent).find((x) => x?.includes('Relógio')) ?? '')
const seatsText = (page) => page.evaluate(() => document.querySelector('[aria-label="Poltronas"]')?.textContent ?? '')
const dock = (page) => page.getByRole('toolbar', { name: 'Controles da chamada' })
const closeNotices = async (page) => {
  const close = page.getByRole('status').getByRole('button', { name: 'Fechar' })
  for (let i = 0; i < 5 && (await close.count()) > 0; i++) await close.first().click({ timeout: 2000 }).catch(() => undefined)
}
/** Moves what each page logged since the last drain into the harness (the pages keep nothing). */
async function drain() {
  for (const x of inst) {
    if (!x) continue
    const d = await x.page.evaluate(() => {
      const L = window.__lab
      return { frames: L.frames.splice(0), events: L.events.splice(0), states: L.states.splice(0), sent: L.sent.splice(0), wire: L.wire.splice(0) }
    }).catch(() => null)
    if (!d) continue
    for (const key of Object.keys(d)) x.logs[key].push(...d[key])
  }
}
let memTimer = null
const mem = Object.fromEntries(NAMES.slice(0, N).map(([k]) => [k, []]))
async function sampleMemory() {
  for (const x of inst) {
    if (!x) continue
    const m = await x.app.evaluate(({ app }) => app.getAppMetrics().map((p) => ({ type: p.type, ws: p.memory.workingSetSize, priv: p.memory.privateBytes ?? 0 }))).catch(() => null)
    if (m) mem[x.k].push({ t: Date.now(), m })
  }
}
function startMemory() {
  memTimer = setInterval(() => void sampleMemory(), 10_000)
}
async function shot(x, name) {
  const p = join(SHOTS, `${PREFIX}-${name}-${x.k}.png`)
  await x.page.screenshot({ path: p })
  return p
}
function ff(args) {
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`)
}
/** 2×2 grid (side by side for two) of same-size window shots, and a ~1440 px JPG of every PNG. */
function grid(name, files) {
  const out = join(SHOTS, `${PREFIX}-${name}.png`)
  const inputs = files.flatMap((f) => ['-i', f])
  // three windows: the fourth tile is the stage's dark surround
  const fill = files.length === 3 ? ['-f', 'lavfi', '-i', `color=c=0x0b0b0c:s=${W}x${H}`] : []
  if (files.length >= 3) ff([...inputs, ...fill, '-filter_complex', '[0][1][2][3]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0', '-frames:v', '1', out])
  else ff([...inputs, '-filter_complex', `${files.map((_, i) => `[${i}]`).join('')}hstack=inputs=${files.length}`, out])
  return out
}
/** Repo-relative (committed summaries carry no local paths). */
const rel = (p) => p.replace(Q.repo, '<repo>').replace(/\\/g, '/')
const jpg = (png) => (ff(['-i', png, '-vf', 'scale=1440:-2:flags=lanczos', '-q:v', '3', png.replace(/\.png$/, '.jpg')]), png.replace(/\.png$/, '.jpg'))

// ── offline analysis ────────────────────────────────────────
const BIN_MS = 250
/** Per instance, per 250 ms bin: median of (mediaTime − display time) in ms (removes the 24p-on-60 Hz cadence). */
function offsetBins(x, from, to) {
  const bins = new Map()
  for (const [t, m] of x.logs.frames) {
    if (t < from || t >= to) continue
    const b = Math.floor(t / BIN_MS)
    if (!bins.has(b)) bins.set(b, [])
    bins.get(b).push(m * 1000 - t)
  }
  const out = new Map()
  for (const [b, xs] of bins) if (xs.length >= 3) out.set(b, pct(xs, 0.5))
  return out
}
/** Error of `x` against `ref` (ms, + = ahead) per common bin, over [from, to). */
function pairErrors(x, ref, from, to) {
  const a = offsetBins(x, from, to)
  const b = offsetBins(ref, from, to)
  const out = []
  for (const [bin, v] of a) if (b.has(bin)) out.push([bin * BIN_MS, v - b.get(bin)])
  return out.sort((p, q) => p[0] - q[0])
}
function syncSummary(errs) {
  const abs = errs.map(([, e]) => Math.abs(e))
  // longest run of consecutive bins above 3 frames (125 ms)
  let run = 0
  let worst = 0
  let prev = null
  for (const [t, e] of errs) {
    if (Math.abs(e) > 125 && prev !== null && t - prev === BIN_MS) run += BIN_MS
    else run = Math.abs(e) > 125 ? BIN_MS : 0
    worst = Math.max(worst, run)
    prev = t
  }
  return { bins: errs.length, p50AbsMs: r1(pct(abs, 0.5)), p95AbsMs: r1(pct(abs, 0.95)), maxAbsMs: r1(abs.length ? Math.max(...abs) : null), over125LongestMs: worst }
}
/** First display instant ≥ `from` after which |err| ≤ 1 frame for 1 s (4 bins in a row). */
function syncedAt(errs, from) {
  const xs = errs.filter(([t]) => t >= from)
  for (let i = 0; i + 4 <= xs.length; i++) {
    const w = xs.slice(i, i + 4)
    if (w.every(([, e]) => Math.abs(e) <= FRAME_MS) && w[3][0] - w[0][0] === 3 * BIN_MS) return w[0][0]
  }
  return null
}

// ── run ─────────────────────────────────────────────────────
if (!(await fetch(`${Q.API}/api/v1/health`).then((r) => r.ok, () => false))) throw new Error('QA stack down: node scripts/qa-stack.mjs start')
linkFfmpeg()
const FILM = film()
const filmBytes = readFileSync(FILM).length
log('film', FILM, `${(filmBytes / 1048576).toFixed(1)} MiB`, `instances ${N}`, LATE ? `late ×${LATE_TRIALS}` : '', NETEM ? `netem ${NETEM}` : 'no netem')
await startNetem()
const users = []
for (let i = 0; i < N; i++) users.push(await account(NAMES[i][0].slice(0, 3), NAMES[i][1]))
const space = await rest(users[0].token, 'POST', '/spaces', { name: `Lab ${Date.now() % 10000}` })
if (E2EE) await rest(users[0].token, 'PATCH', `/spaces/${space.id}`, { e2ee: true }) // calls in this space are MLS E2EE
const invite = await rest(users[0].token, 'POST', `/spaces/${space.id}/invites`, {})
for (const u of users.slice(1)) await rest(u.token, 'POST', `/invites/${invite.code}`)
const voiceCh = space.channels.find((c) => c.type === 'voice')
for (let i = 0; i < N; i++) await launch(i)
for (let i = 0; i < N; i++) await login(inst[i].page, users[i])
const [A] = inst
const late = LATE ? inst[N - 1] : null
const early = inst.filter((x) => x !== late)
startMemory()

async function joinVoice(page) {
  await page.getByRole('navigation', { name: 'Espaços' }).getByRole('button', { name: new RegExp(`^${space.name}`) }).click()
  await page.getByRole('complementary', { name: 'Canais' }).getByRole('button', { name: new RegExp(`^(Entrar em |Trocar para )?${voiceCh.name}(, .*)?$`) }).first().click()
  const pill = page.getByRole('toolbar', { name: 'Antes de entrar' }).getByRole('button', { name: /^Entrar/ })
  if (await pill.isVisible().catch(() => false)) await pill.click()
  await page.getByText('Voz conectada').first().waitFor({ timeout: 30_000 })
}
await check(`${N} instâncias entram na call`, async () => {
  for (const x of inst) await joinVoice(x.page)
  await dock(A.page).getByRole('button', { name: 'Cinema' }).waitFor()
  if (E2EE) for (const x of inst) await x.page.getByText('Criptografia de ponta a ponta').first().waitFor({ timeout: 30_000 })
  return E2EE ? 'chamada E2EE (MLS) em todas' : 'chamada sem E2EE'
})

/** Host: answers the native dialog with `file`, Cinema → sheet (or the probe's refusal). */
async function pick(file) {
  await A.app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }) }, file)
  await dock(A.page).getByRole('button', { name: 'Cinema' }).click()
  const sheet = A.page.getByRole('dialog', { name: 'Projetar para a chamada' })
  const error = A.page.getByRole('status').filter({ hasText: /não é suportado|Não deu para/ })
  await sheet.or(error).first().waitFor({ timeout: 60_000 })
  if (await error.isVisible().catch(() => false)) return { refused: (await error.textContent())?.trim() }
  return { sheet, noDecode: (await sheet.getByText('não decodifica', { exact: false }).count()) > 0 }
}
const endSession = async () => {
  await A.page.getByRole('button', { name: 'Encerrar sessão' }).first().click()
  await until(async () => !(await video(A.page)), 'stage gone', 15_000)
  for (const x of inst) await x.page.getByRole('status').getByRole('button', { name: 'Fechar' }).first().click({ timeout: 2000 }).catch(() => undefined)
}

if (flag('checks')) {
  M.canPlay = {}
  for (const f of ['h264-ac3-51', 'hevc10-hdr10-eac3-51', 'hevc10-truehd-71', 'av1-opus-51', 'h264-dts-51', 'h264-aac-srt-ass', 'mpeg2-mp2']) {
    await check(`canPlay: ${f}`, async () => {
      const r = await pick(join(FIX, `${f}.mkv`))
      if (r.refused) {
        M.canPlay[f] = { refusedAtProbe: r.refused }
        await A.page.getByRole('status').getByRole('button', { name: 'Fechar' }).first().click().catch(() => undefined)
        if (f !== 'mpeg2-mp2') throw new Error(`refused: ${r.refused}`)
        return M.canPlay[f]
      }
      if (f === 'mpeg2-mp2') throw new Error('mpeg2 reached the sheet')
      await r.sheet.getByRole('button', { name: 'Abrir sessão' }).click()
      const out = await until(async () => {
        const v = await video(A.page)
        const banner = await A.page.getByText('Seu PC não', { exact: false }).count()
        return banner ? { decodes: false } : v && v.ready >= 2 ? { decodes: true } : null
      }, `${f} decoded or refused`, 60_000)
      M.canPlay[f] = { sheetNoDecodeWarning: r.noDecode, ...out, seat: await seatsText(A.page) }
      await endSession()
      if (!out.decodes) throw new Error(JSON.stringify(M.canPlay[f]))
      return M.canPlay[f]
    })
  }
  for (const x of inst) await x.page.evaluate(() => window.__lab.events.splice(0)) // the checks' events are not the run's
}

let T = {} // instants (ms, wall clock)
await sampleMemory() // baseline: in the call, no session yet
await check('Abrir sessão → primeiro frame em todas as poltronas sentadas', async () => {
  const r = await pick(FILM)
  if (r.refused) throw new Error(r.refused)
  T.open = Date.now()
  await r.sheet.getByRole('button', { name: 'Abrir sessão' }).click()
  // the others sit as soon as the card shows (no human delay)
  await Promise.all(early.slice(1).map(async (x) => {
    const sit = x.page.getByRole('button', { name: 'Sentar', exact: true })
    await sit.waitFor({ timeout: 15_000 })
    T[`sit_${x.k}`] = Date.now()
    await sit.click()
  }))
  const first = {}
  await until(async () => {
    for (const x of early) if (!first[x.k] && (await video(x.page))?.ready >= 2) first[x.k] = Date.now() - T.open
    return early.every((x) => first[x.k])
  }, 'first frame everywhere', 60_000, 50)
  M.firstFrameMs = first
  M.firstFrameAllMs = Math.max(...Object.values(first))
  await until(async () => ((await seatsText(A.page)).match(/pronto/g)?.length ?? 0) >= early.length, 'all seats ready', 180_000) // a poor network pre-rolls 30 s (adaptive pre-roll)
  M.allReadyMs = Date.now() - T.open
  for (const x of inst) await closeNotices(x.page)
  if (M.firstFrameAllMs > 10_000) throw new Error(`first frame ${M.firstFrameAllMs} ms > 10 s`)
  return { firstFrameMs: first, allReadyMs: M.allReadyMs }
})

await check('Começar: as poltronas tocam; play agendado em ±1 frame de `at`', async () => {
  T.start = Date.now()
  await A.page.getByRole('button', { name: 'Começar', exact: true }).first().click()
  await until(async () => {
    for (const x of early) {
      const v = await video(x.page)
      if (!v || v.paused || v.t < 1) return false
    }
    return true
  }, 'all playing', 30_000)
  for (const x of early) await x.page.keyboard.press('s') // stats panels (fromHost/fromPeers, relay); they cover the start button
})

// ── continuous play (late joiner, memory, swarm) ────────────
const swarmTexts = []
async function sampleSwarm(label) {
  const row = { t: Date.now(), label }
  for (const x of inst) {
    row[x.k] = { stats: (await statsText(x.page).catch(() => '')).replace(/\s+/g, ' ').slice(0, 900), dc: await x.page.evaluate(() => window.__lab.dc()).catch(() => null), levels: await x.page.evaluate(() => window.__lab.levels()).catch(() => null), latencyMs: await x.page.evaluate(() => window.__lab.latencyMs()).catch(() => null), biasMs: await x.page.evaluate(() => window.__lab.bias()).catch(() => null), lanes: await x.page.evaluate(() => window.__lab.lanes()).catch(() => null) }
  }
  if (netem) row.netem = await netem.stats()
  swarmTexts.push(row)
  return row
}
M.lateTrials = []
await check(`Tocando ${PLAY_S} s${LATE ? ` (${late.k} entra no meio${LATE_TRIALS > 1 ? `, ${LATE_TRIALS}×` : ''})` : ''}`, async () => {
  const end = T.start + PLAY_S * 1000
  let nextSample = Date.now() + 15_000
  let trial = 0
  let lateAt = LATE ? T.start + 30_000 : Infinity
  while (Date.now() < end) {
    if (Date.now() >= nextSample) {
      await drain()
      await sampleSwarm(`t+${Math.round((Date.now() - T.start) / 1000)}s`)
      nextSample = Date.now() + 30_000
    }
    if (Date.now() >= lateAt && trial < LATE_TRIALS) {
      const x = late
      const sit = x.page.getByRole('button', { name: 'Sentar', exact: true })
      await sit.waitFor({ timeout: 15_000 })
      const at = Date.now()
      await sit.click()
      await until(async () => (await video(x.page))?.ready >= 2, 'late first frame', 30_000, 50)
      const ff = Date.now() - at
      await until(async () => { const v = await video(x.page); return v && !v.paused }, 'late playing', 30_000, 50)
      if (trial === 0) await x.page.keyboard.press('s')
      await sleep(14_000)
      await drain()
      M.lateTrials.push({ sitAt: at, firstFrameMs: ff })
      trial++
      if (trial < LATE_TRIALS) {
        await x.page.getByRole('button', { name: 'Sair da sessão' }).first().click() // the stage header's (the dock has another)
        await sleep(3000)
        lateAt = Date.now() + 2000
      } else lateAt = Infinity
    }
    await sleep(500)
  }
  await drain()
  return { trials: M.lateTrials.length }
})
T.playEnd = Date.now()
await sampleSwarm('end of play')

// ── pause ───────────────────────────────────────────────────
M.pauses = []
const seated = () => inst.filter((x) => x !== late || M.lateTrials.length)
for (let i = 0; i < PAUSES; i++) {
  await check(`Pausa ${i + 1}: todos no mesmo frame em ≤ 300 ms`, async () => {
    // only a pause of a playing room counts (a room waiting for a stalled seat is already paused)
    await until(async () => {
      for (const x of seated()) if ((await video(x.page))?.paused !== false) return false
      return true
    }, 'room playing before the pause', 60_000, 200)
    await drain()
    const click = Date.now()
    await A.page.getByRole('button', { name: 'Pausar', exact: true }).click()
    await until(async () => {
      for (const x of seated()) {
        const v = await video(x.page)
        if (!v?.paused) return false
      }
      return true
    }, 'all paused', 10_000, 50)
    await sleep(1500)
    await drain()
    const st = A.logs.states.find((s) => s.r >= click && s.playback && !s.playback.playing && s.playback.reason === 'user' && s.playback.at >= click)
    if (!st) throw new Error('no paused state')
    const { at, position } = st.playback
    const per = {}
    for (const x of seated()) {
      const ev = x.logs.events.filter(([t]) => t >= click)
      const p = ev.find(([, e]) => e === 'pause')
      const seeked = ev.filter(([, e]) => e === 'seeked').at(-1)
      const v = await video(x.page)
      if (!p) throw new Error(`${x.k}: no pause event`)
      const settled = Math.max(p[0], seeked?.[0] ?? 0)
      // the frame on screen: the last one rVFC presented (a seek while paused presents one too)
      const shown = x.logs.frames.at(-1)?.[1] ?? null
      per[x.k] = {
        settledAfterAtMs: settled - at, settledAfterClickMs: settled - click, shownMediaS: shown,
        shownVsPositionFrames: shown === null ? null : r1((shown - position) * FPS), currentTimeDelta: r1((v.t - position) * FPS), seekedBack: !!seeked,
      }
    }
    if (i === 0 && SHOTS_ON) {
      const files = []
      for (const x of seated()) files.push(await shot(x, 'paused'))
      M.sameFrameShot = rel(grid('same-frame', files))
    }
    const row = { position, atAfterClickMs: at - click, per, maxSettledAfterAtMs: Math.max(...Object.values(per).map((p) => p.settledAfterAtMs)), maxSettledAfterClickMs: Math.max(...Object.values(per).map((p) => p.settledAfterClickMs)), sameFrame: Object.values(per).every((p) => p.shownMediaS !== null) && new Set(Object.values(per).map((p) => Math.round(p.shownMediaS * 1000))).size === 1 }
    M.pauses.push(row)
    await A.page.getByRole('button', { name: 'Tocar', exact: true }).click()
    await until(async () => !(await video(A.page))?.paused, 'resumed', 10_000)
    await sleep(6000)
    if (!row.sameFrame || row.maxSettledAfterAtMs > 300) throw new Error(JSON.stringify(row))
    return row
  })
}

// ── audio switch on one viewer ──────────────────────────────
await check('setAudio: Bruno troca a faixa e o frame de vídeo não muda', async () => {
  const x = inst[1]
  await drain()
  const t0 = Date.now()
  await x.page.getByLabel('Faixa de áudio').selectOption({ index: 1 })
  await until(async () => /Faixa de áudio\s*a1(?!\s*→)/.test(await statsText(x.page)), 'on a1', 30_000)
  const t1 = Date.now()
  await sleep(4000)
  await drain()
  const seeks = x.logs.events.filter(([t, e]) => t >= t0 && e === 'seeking').length
  const fr = x.logs.frames.filter(([t]) => t >= t0 - 1000 && t <= t1 + 3000)
  let jump = 0
  for (let j = 1; j < fr.length; j++) jump = Math.max(jump, Math.abs((fr[j][1] - fr[j - 1][1]) * 1000 - (fr[j][0] - fr[j - 1][0]) * fr[j][2]))
  const errs = pairErrors(x, A, t0, t1 + 3000)
  M.audioSwitch = { switchMs: t1 - t0, seeksDuringSwitch: seeks, maxFrameJumpMs: r1(jump), vsHost: syncSummary(errs) }
  if (seeks || jump > FRAME_MS + 17) throw new Error(JSON.stringify(M.audioSwitch))
  return M.audioSwitch
})

await check('Painel de estatísticas: peças de amigos (screenshot)', async () => {
  const row = await sampleSwarm('stats shot')
  if (SHOTS_ON) {
    const files = []
    for (const x of seated()) files.push(await shot(x, 'stats'))
    M.statsShot = rel(grid('stats', files))
  }
  return Object.fromEntries(seated().map((x) => [x.k, /Peças\s*([^R]*)Relay/.exec(row[x.k].stats)?.[1]?.trim() ?? row[x.k].stats.slice(0, 120)]))
})

await check('ASS: Bruno liga a legenda ASS e ela aparece (JASSUB)', async () => {
  const x = inst[1]
  const sel = x.page.getByLabel('Legenda')
  const labels = await sel.locator('option').allTextContents()
  const idx = labels.findIndex((l) => l.includes('ASS'))
  if (idx < 0) throw new Error(`no ASS option: ${labels}`)
  await sel.selectOption({ index: idx })
  // back to the start: the cue is at 1–5 s
  await A.page.locator('[role="slider"][aria-label="Linha do tempo"]').click({ position: { x: 1, y: 3 } })
  await until(async () => { const v = await video(x.page); return v && !v.paused && v.t > 1.3 && v.t < 4.5 }, 'B inside the ASS cue', 30_000)
  // JASSUB draws into its own canvas (worker, OffscreenCanvas) in a .JASSUB wrapper next to the <video>
  const canvas = await until(() => x.page.evaluate(() => {
    const c = document.querySelector('canvas.JASSUB')
    return c && c.getBoundingClientRect().width > 300 ? { w: Math.round(c.getBoundingClientRect().width), h: Math.round(c.getBoundingClientRect().height) } : null
  }), 'JASSUB canvas', 10_000).catch(async (e) => {
    log('ASS debug', JSON.stringify(await x.page.evaluate(() => ({
      canvases: [...document.querySelectorAll('canvas')].map((c) => [c.className, Math.round(c.getBoundingClientRect().width), c.parentElement?.className]),
      sub: document.querySelector('select[aria-label], label select') && [...document.querySelectorAll('select')].map((el) => [el.value, [...el.options].map((o) => o.text).join('|')]),
    }))))
    throw e
  })
  await sleep(600)
  if (SHOTS_ON) M.assShot = rel(await shot(x, 'ass'))
  M.ass = { canvas }
  return M.ass
})

M.levels = swarmTexts.at(-1)
await check('Encerrar', async () => {
  await sampleSwarm('before end')
  await endSession()
})
clearInterval(memTimer)
await drain()

// ── numbers ─────────────────────────────────────────────────
const host = A
const startState = host.logs.states.find((s) => s.r >= T.start && s.playback?.playing)
M.start = {}
if (startState) {
  const { at, position } = startState.playback
  for (const x of early) {
    const f = x.logs.frames.find(([t]) => t >= at)
    const lat = swarmTexts.find((r) => r[x.k]?.latencyMs !== null)?.[x.k]?.latencyMs ?? 0
    // the picture runs ahead of the room by the film audio's output latency (R28): compare against now + latency
    if (f) M.start[x.k] = { firstFrameAfterAtMs: r1(f[0] - at), errMs: r1((f[1] - (position + (f[0] + lat - at) / 1000)) * 1000), leadMs: r1(lat) }
  }
}
// room pauses for a stalled seat (waitForStalled) after the room first played: episodes of playback.reason
// waiting/buffering (the sync filter below uses them)
const firstPlay = host.logs.states.find((s) => s.r >= T.start && s.playback?.playing)?.r ?? T.start
M.roomWaits = []
for (const st of host.logs.states.filter((s) => s.r > firstPlay && s.r < T.playEnd && s.playback)) {
  const waiting = ['waiting', 'buffering'].includes(st.playback.reason)
  const open = M.roomWaits.at(-1)
  if (waiting && (!open || open.endS !== null)) M.roomWaits.push({ atS: r1((st.r - T.start) / 1000), reason: st.playback.reason, waitingFor: st.playback.waitingFor, endS: null })
  else if (!waiting && open && open.endS === null) open.endS = r1((st.r - T.start) / 1000)
}
M.roomPausedS = r1(M.roomWaits.reduce((a, w) => a + (w.endS ?? PLAY_S) - w.atS, 0))
M.runAfterFirstPlayS = r1((T.playEnd - firstPlay) / 1000)
M.roomPausedPct = r1((100 * M.roomPausedS) / M.runAfterFirstPlayS)
// sync: EVERY pair of seated windows (the late joiner without the first 15 s of each of its joins), from 10 s after
// the start. Frozen seats show no frames (rVFC), so a pair has no bins while either side is frozen: a blind spot; the
// error built up meanwhile shows once it moves again. `syncOutsideWaits` = the same bins minus room waits ± 3 s.
const syncFrom = T.start + 10_000
const waitSpans = M.roomWaits.map((w) => [T.start + w.atS * 1000 - 3000, (w.endS === null ? T.playEnd : T.start + w.endS * 1000) + 3000])
const joinSpans = M.lateTrials.map((tr) => [tr.sitAt, tr.sitAt + 15_000])
const outside = (errs, spans) => errs.filter(([t]) => !spans.some(([a, b]) => t >= a && t < b))
const seatedAll = inst.filter((x) => x !== late || M.lateTrials.length)
M.sync = {}
M.syncOutsideWaits = {}
for (let i = 0; i < seatedAll.length; i++) {
  for (let j = i + 1; j < seatedAll.length; j++) {
    const [a, b] = [seatedAll[i], seatedAll[j]]
    const errs = outside(pairErrors(b, a, syncFrom, T.playEnd), a === late || b === late ? joinSpans : [])
    M.sync[`${b.k}-vs-${a.k}`] = syncSummary(errs)
    M.syncOutsideWaits[`${b.k}-vs-${a.k}`] = syncSummary(outside(errs, waitSpans))
  }
}
const worst = (o, k) => Math.max(...Object.values(o).map((s) => s[k] ?? -Infinity))
M.syncAllP95 = worst(M.sync, 'p95AbsMs')
M.syncLongestOver125 = worst(M.sync, 'over125LongestMs')
M.syncOutsideWaitsP95 = worst(M.syncOutsideWaits, 'p95AbsMs')
for (const tr of M.lateTrials) {
  const errs = pairErrors(late, host, tr.sitAt, tr.sitAt + 15_000)
  const at = syncedAt(errs, tr.sitAt)
  const ev = late.logs.events.filter(([t]) => t >= tr.sitAt && t <= tr.sitAt + 15_000)
  tr.syncedMs = at === null ? null : at - tr.sitAt
  tr.seeks = ev.filter(([, e]) => e === 'seeking').map(([t, , ct]) => [t - tr.sitAt, r1(ct)])
  tr.trajectory = errs.filter((_, i) => i % 2 === 0).map(([t, e]) => [t - tr.sitAt, r1(e)])
  tr.after = syncSummary(errs.filter(([t]) => at !== null && t >= at))
}
// stalls: 'waiting' while the room plays, and room pauses for a stalled seat
M.stalls = {}
// (a late joiner's own first seconds after sitting are its start, not a stall)
const joining = (x, t) => x === late && M.lateTrials.some((tr) => t >= tr.sitAt && t < tr.sitAt + 5000)
for (const x of inst) {
  const ev = x.logs.events.filter(([t]) => t > T.start + 2000 && t < T.playEnd && !joining(x, t))
  const waits = []
  for (const [t, e] of ev) {
    if (e === 'waiting' && !(waits.length && waits.at(-1)[1] === null)) waits.push([t, null]) // one open stall at a time
    else if (e === 'playing' && waits.length && waits.at(-1)[1] === null) waits.at(-1)[1] = t
  }
  const durs = waits.map(([a, b]) => (b ?? T.playEnd) - a)
  M.stalls[x.k] = { waitingEvents: waits.length, over2s: durs.filter((d) => d > 2000).length, totalS: r1(durs.reduce((s, d) => s + d, 0) / 1000), longestS: r1(durs.length ? Math.max(...durs) / 1000 : 0) }
}
// upload: data-channel bytes of the cinema mesh
const last = swarmTexts.at(-1)
const viewers = inst.slice(1).filter((x) => last[x.k]?.dc)
// the film as pieces (video + the default audio track), from the index a viewer received
const index = await inst[1].page.evaluate(() => window.__lab.index).catch(() => ({}))
const trackMiB = (tr) => r1((index[tr] ?? []).reduce((s, b) => s + (b ?? 0), 0) / 1048576)
M.upload = {
  filmPiecesMiB: { v: trackMiB('v'), a0: trackMiB('a0'), a1: trackMiB('a1') },
  hostSentMiB: r1(last[host.k].dc.sent / 1048576),
  viewersRecvMiB: Object.fromEntries(viewers.map((x) => [x.k, r1(last[x.k].dc.recv / 1048576)])),
  viewersSentMiB: Object.fromEntries(viewers.map((x) => [x.k, r1(last[x.k].dc.sent / 1048576)])),
  pairs: Object.fromEntries(inst.map((x) => [x.k, last[x.k]?.dc?.pairs ?? []])),
}
const meanRecv = viewers.reduce((s, x) => s + last[x.k].dc.recv, 0) / Math.max(1, viewers.length)
M.upload.hostOverMeanViewer = r1(last[host.k].dc.sent / meanRecv)
M.upload.hostOverFilm = r1(last[host.k].dc.sent / 1048576 / ((M.upload.filmPiecesMiB.v ?? 0) + (M.upload.filmPiecesMiB.a0 ?? 0)))
M.upload.netem = last.netem ?? null
// super-seed: what the host sent against the union of distinct pieces any viewer received (wire log of the last chunk)
const union = new Map()
for (const x of viewers) for (const [, kind, tr, n, total] of x.logs.wire) if (kind === 'done') union.set(`${tr}:${n}`, total)
const unionBytes = [...union.values()].reduce((a, b) => a + b, 0)
M.upload.unionPieces = union.size
M.upload.unionMiB = r1(unionBytes / 1048576)
M.upload.hostOverUnion = unionBytes ? Math.round((100 * last[host.k].dc.sent) / unionBytes) / 100 : null
// the host's capped uplink: queueing delay a voice packet would see while the film is seeded (sampled every 100 ms)
if (netem && HOST_CAP) {
  const q = (await netem.queue()).samples.filter(([t]) => t >= firstPlay && t <= T.playEnd).map(([, d]) => d)
  M.hostUplinkQueueMs = { samples: q.length, p50: pct(q, 0.5), p95: pct(q, 0.95), max: q.length ? Math.max(...q) : null, over150msPct: q.length ? r1((100 * q.filter((d) => d > 150).length) / q.length) : null }
}
// each window's wall clock against its rVFC timeline (bounds the cross-window error), and its connected cinema lanes
M.clockBiasMs = Object.fromEntries(inst.map((x) => {
  const b = swarmTexts.map((r) => r[x.k]?.biasMs).filter((v) => typeof v === 'number')
  return [x.k, b.length ? { min: r1(Math.min(...b)), max: r1(Math.max(...b)) } : null]
}))
M.lanes = Object.fromEntries(inst.map((x) => [x.k, swarmTexts.map((r) => r[x.k]?.lanes ?? null)]))
// memory: peak working set per process type (MiB)
M.memory = {}
const mib = (m, ty) => r1(m.filter((p) => !ty || p.type === ty).reduce((a, p) => a + p.ws, 0) / 1024)
for (const [k, samples] of Object.entries(mem)) {
  const base = samples.filter((x) => x.t < T.open).at(-1)
  const during = samples.filter((x) => x.t >= T.open)
  const peak = (ty) => Math.max(...during.map((x) => mib(x.m, ty)))
  const types = ['Browser', 'Tab', 'GPU', 'Utility']
  M.memory[k] = {
    samples: during.length,
    baselineMiB: base ? Object.fromEntries([['total', mib(base.m)], ...types.map((ty) => [ty, mib(base.m, ty)])]) : null,
    peakMiB: Object.fromEntries([['total', peak()], ...types.map((ty) => [ty, peak(ty)])]),
    cinemaDeltaMiB: base ? r1(peak() - mib(base.m)) : null,
  }
}
M.e2ee = Object.fromEntries(await Promise.all(inst.map(async (x) => [x.k, await x.page.evaluate(() => window.__lab.tags).catch(() => null)])))
M.frameLoad = Object.fromEntries(inst.map((x) => {
  const xs = x.logs.sent
  let max = 0
  for (let i = 0, j = 0; i < xs.length; i++) {
    while (xs[i][0] - xs[j][0] >= 60_000) j++
    max = Math.max(max, i - j + 1)
  }
  return [x.k, { total: xs.length, max60s: max }]
}))

const jpgs = []
if (SHOTS_ON) for (const f of readdirSync(SHOTS).filter((x) => x.startsWith(PREFIX) && x.endsWith('.png'))) jpgs.push(jpg(join(SHOTS, f)))
const summary = { at: new Date().toISOString(), tag: TAG, instances: N, e2ee: E2EE, playS: PLAY_S, netem: NETEM || null, hostCapKbps: HOST_CAP || null, route: ROUTE, film: { path: `<QA_WORK>/${basename(FILM)}`, MiB: r1(filmBytes / 1048576) }, results, M, jpgs: jpgs.map((p) => p.replace(Q.repo, '').replace(/\\/g, '/')) }
writeFileSync(join(Q.WORK, `cinema-lab-${TAG}.json`), JSON.stringify({ ...summary, swarm: swarmTexts, mem, logs: Object.fromEntries(inst.map((x) => [x.k, x.logs])) }) + '\n')
writeFileSync(join(Q.repo, 'docs', 'benchmarks', `cinema-engine-${TAG}.json`), JSON.stringify(summary, null, 2) + '\n')
const failed = results.filter((r) => !r.pass)
log(`${results.length - failed.length}/${results.length} ok; summary docs/benchmarks/cinema-engine-${TAG}.json`)
log(JSON.stringify({ firstFrameAllMs: M.firstFrameAllMs, start: M.start, syncAllP95: M.syncAllP95, syncLongestOver125: M.syncLongestOver125, pauses: M.pauses.map((p) => [p.maxSettledAfterAtMs, p.sameFrame]), late: M.lateTrials.map((t) => [t.firstFrameMs, t.syncedMs]), upload: M.upload.hostOverMeanViewer, hostOverUnion: M.upload.hostOverUnion, stalls: M.stalls, roomWaits: M.roomWaits.length, roomPausedS: M.roomPausedS, roomPausedPct: M.roomPausedPct, syncOutsideWaitsP95: M.syncOutsideWaitsP95, queue: M.hostUplinkQueueMs ?? null, frames60: Object.fromEntries(Object.entries(M.frameLoad).map(([k, v]) => [k, v.max60s])), lanes: Object.fromEntries(Object.entries(M.lanes).map(([k, v]) => [k, v.at(-1)])), allReadyMs: M.allReadyMs ?? null }))
if (!KEEP) for (const x of inst) await x?.app.close().catch(() => undefined)
await netem?.close()
process.exit(failed.length ? 1 : 0)
