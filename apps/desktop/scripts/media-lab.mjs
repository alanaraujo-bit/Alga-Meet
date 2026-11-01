#!/usr/bin/env node
// Media benchmark harness: two real Electron instances (separate profiles) talking through the local
// LiveKit SFU, driven by Playwright, measuring with Chromium fake devices + real screen capture.
//
//   node apps/desktop/scripts/media-lab.mjs [--no-build] [--phase=voice,speech,codecs,screen,synthetic,reconnect]
//     [--codec=h265|h264] [--proposed-csp] [--flags=<chromium switch>] [--screen-seconds=60]
//
// Runs its own LiveKit (same pinned binary as scripts/livekit.mjs, ports 7890/7891/50300-50400).
// Results are merged into docs/benchmarks/media-baseline.json; screenshots go to docs/screenshots/.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import electronPath from 'electron'
import { AccessToken } from 'livekit-server-sdk'
import { _electron } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const desktop = resolve(here, '..')
const repo = resolve(desktop, '../..')
const work = join(tmpdir(), 'alga-media-lab')
const outJson = join(repo, 'docs/benchmarks/media-baseline.json')
const shots = join(repo, 'docs/screenshots')
const DAY = '2026-11-01'
const ROOM = 'media-lab'
// Own SFU on separate ports: never collides with (or kills) the team's dev SFU on :7880.
const LK_PORT = 7890
const LK_URL = `ws://localhost:${LK_PORT}`
const argv = process.argv.slice(2)
const phases = (argv.find((a) => a.startsWith('--phase='))?.split('=')[1] ?? 'voice,speech,codecs,screen,synthetic,reconnect').split(',')
const SCREEN_CODEC = argv.find((a) => a.startsWith('--codec='))?.split('=')[1] ?? 'h264'
/** Extra Chromium switches for the screen phase, e.g. --flags=--enable-features=PlatformH264CbpEncoding */
const flagArgs = () => argv.filter((a) => a.startsWith('--flags=')).map((a) => a.slice('--flags='.length))
const SCREEN_SECONDS = Number(argv.find((a) => a.startsWith('--screen-seconds='))?.split('=')[1] ?? 60)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(`[media-lab ${new Date().toISOString().slice(11, 19)}]`, ...a)
const q = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null
}
const median = (a) => q(a, 0.5)
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
const r1 = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)
const summary = (a) => ({ n: a.length, median: r1(median(a)), p95: r1(q(a, 0.95)), min: r1(q(a, 0)), max: r1(q(a, 1)), mean: r1(mean(a)) })

const results = existsSync(outJson) ? JSON.parse(readFileSync(outJson, 'utf8')) : {}
const save = () => {
  mkdirSync(dirname(outJson), { recursive: true })
  writeFileSync(outJson, JSON.stringify(results, null, 2) + '\n')
}
const children = new Set()
const apps = new Set()
async function cleanup() {
  for (const a of apps) await a.close().catch(() => undefined)
  for (const c of children) killTree(c.pid)
  unpatchCsp()
}
process.on('SIGINT', () => void cleanup().then(() => process.exit(130)))

function killTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  else process.kill(pid, 'SIGKILL')
}

function portOpen(port) {
  return new Promise((res) => {
    const s = createConnection({ port, host: '127.0.0.1' })
    s.once('connect', () => (s.destroy(), res(true)))
    s.once('error', () => res(false))
  })
}
async function waitPort(port, ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await portOpen(port)) return Date.now()
    await sleep(50)
  }
  throw new Error(`port ${port} not up after ${ms} ms`)
}

// ─────────────── LiveKit ───────────────
let livekit = null
function liveKitConfig() {
  const exe = join(repo, 'infra/livekit/bin', process.platform === 'win32' ? 'livekit-server.exe' : 'livekit-server')
  if (!existsSync(exe)) throw new Error('LiveKit binary missing: run `node scripts/livekit.mjs` once (downloads + verifies it)')
  const yaml = readFileSync(join(repo, 'infra/livekit/livekit.dev.yaml'), 'utf8')
    .replace(/^port: \d+/m, `port: ${LK_PORT}`)
    .replace(/tcp_port: \d+/, 'tcp_port: 7891')
    .replace(/port_range_start: \d+/, 'port_range_start: 50300')
    .replace(/port_range_end: \d+/, 'port_range_end: 50400')
    .replace(/^webhook:[\s\S]*?(?=^room:)/m, '') // no API server in the lab
  const cfg = join(work, 'livekit.lab.yaml')
  writeFileSync(cfg, yaml)
  return { exe, cfg }
}
async function startLiveKit() {
  if (await portOpen(LK_PORT)) throw new Error(`:${LK_PORT} busy — another media-lab running?`)
  const { exe, cfg } = liveKitConfig()
  const out = openSync(join(work, 'livekit.log'), 'a')
  livekit = spawn(exe, ['--config', cfg], { cwd: repo, stdio: ['ignore', out, out] })
  children.add(livekit)
  await waitPort(LK_PORT, 30_000)
  log('LiveKit up on', LK_PORT, '(pid', livekit.pid, ')')
  return true
}
function stopLiveKit() {
  if (!livekit) return
  killTree(livekit.pid)
  children.delete(livekit)
  livekit = null
}

// ─────────────── test signals ───────────────
function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`)
}
function makeSignals() {
  mkdirSync(work, { recursive: true })
  const beeps = join(work, 'beeps.wav')
  const silence = join(work, 'silence.wav')
  const speech = join(work, 'speech.wav')
  // 40 ms 1 kHz bursts every 750 ms over digital silence: unambiguous onsets for latency pairing.
  ffmpeg(['-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,0.75),0.04),0.3*sin(2*PI*1000*t),0)':s=48000:d=30", '-ac', '1', '-c:a', 'pcm_s16le', beeps])
  ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '10', '-c:a', 'pcm_s16le', silence])
  if (!existsSync(speech)) {
    // Windows SAPI TTS: real speech (consonant onsets, sibilants) for the processing-mode tests.
    const raw = join(work, 'speech-raw.wav')
    const ps = `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'pt-BR' } | Select-Object -First 1
if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }
$s.SetOutputToWaveFile('${raw.replace(/'/g, "''")}')
$p = New-Object System.Speech.Synthesis.PromptBuilder
foreach ($t in @('Testando o microfone.', 'Sete pratos de trigo para tres tigres.', 'O sapo nao lava o pe.', 'Chegou a hora de jogar.', 'Fala, pessoal, tudo certo?', 'Sinto cheiro de cafe.', 'Pode compartilhar a tela?', 'Tchau, ate amanha.')) { $p.AppendText($t); $p.AppendBreak([TimeSpan]::FromMilliseconds(900)) }
$s.Speak($p)
$s.Dispose()`
    const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
    if (r.status !== 0 || !existsSync(raw)) throw new Error(`TTS failed: ${r.stderr}`)
    ffmpeg(['-i', raw, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', speech])
  }
  return { beeps, silence, speech }
}

// ─────────────── proposed CSP (build output only) ───────────────
// RNNoise needs WebAssembly; the shipped CSP (script-src 'self') forbids it. With --proposed-csp the lab
// measures the fix it asks for by adding 'wasm-unsafe-eval' to the *built* index.html (never the source).
const builtIndex = join(desktop, 'out/renderer/index.html')
let cspPatched = false
function patchCsp() {
  const s = readFileSync(builtIndex, 'utf8')
  if (s.includes("'wasm-unsafe-eval'")) return
  writeFileSync(builtIndex, s.replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'"))
  cspPatched = true
}
function unpatchCsp() {
  if (!cspPatched || !existsSync(builtIndex)) return
  writeFileSync(builtIndex, readFileSync(builtIndex, 'utf8').replace(" 'wasm-unsafe-eval'", ''))
  cspPatched = false
}

// ─────────────── tokens ───────────────
const secret = /devkey:\s*(\S+)/.exec(readFileSync(join(repo, 'infra/livekit/livekit.dev.yaml'), 'utf8'))[1]
async function token(identity) {
  const at = new AccessToken('devkey', secret, { identity, name: identity.replace('lab-', 'Lab ').toUpperCase(), ttl: '2h' })
  at.addGrant({ roomJoin: true, room: ROOM, canPublish: true, canSubscribe: true })
  return at.toJwt()
}

// ─────────────── Electron ───────────────
async function launch(profile, wav, extra = [], fake = true) {
  const env = { ...process.env }
  delete env.ELECTRON_RENDERER_URL
  const app = await _electron.launch({
    executablePath: electronPath,
    cwd: desktop,
    env,
    args: [
      desktop,
      `--profile=${profile}`,
      // Fake mic fed from a WAV (loops). NB: this flag also swaps getDisplayMedia for Chromium's fake
      // 20 fps desktop source (id screen:-3:0), so screen phases run without it and without a mic.
      ...(fake ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] : []),
      // Harness only: keep both windows rendering even when covered by the test pattern.
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      ...extra,
    ],
  })
  apps.add(app)
  const page = await app.firstWindow()
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('default device')) log(`${profile} console.${m.type()}:`, m.text().slice(0, 300))
  })
  page.on('pageerror', (e) => log(`${profile} pageerror:`, e.message))
  await page.waitForLoadState('domcontentloaded')
  return { app, page, profile, identity: profile }
}
async function close(inst) {
  apps.delete(inst.app)
  await inst.app.close().catch(() => undefined)
}
async function gotoLab(inst) {
  const qs = new URLSearchParams({ url: LK_URL, token: await token(inst.identity) })
  const href = pathToFileURL(join(desktop, 'out/renderer/index.html')).href + `?${qs}#media-lab`
  await inst.page.goto(href)
  await inst.page.waitForSelector('[data-testid=media-lab]', { timeout: 20_000 })
}
const ev = (inst, fn, arg) => inst.page.evaluate(fn, arg)
const join_ = (inst, publishMic = true) =>
  ev(inst, async ({ url, token, publishMic }) => {
    await window.__mediaLab.media.join({ url, token, bitrateKbps: 64, channelId: 'lab', publishMic })
    return window.__mediaLab.useMedia.getState().connection.joinMs
  }, { url: LK_URL, token: inst.token, publishMic })
const leave = (inst) => ev(inst, () => window.__mediaLab.media.leave())
const state = (inst) => ev(inst, () => window.__mediaLab.useMedia.getState())
async function shot(inst, name) {
  mkdirSync(shots, { recursive: true })
  await inst.page.screenshot({ path: join(shots, `${DAY}-media-lab-${name}.png`) }).catch((e) => log('screenshot failed', e.message))
}

/** Electron app.getAppMetrics() summed over all processes of one instance. */
async function metrics(inst) {
  return inst.app.evaluate(({ app }) =>
    app.getAppMetrics().map((m) => ({ type: m.type, cpu: m.cpu.percentCPUUsage, ws: m.memory.workingSetSize, priv: m.memory.privateBytes ?? 0 })),
  )
}
function sampler(insts, everyMs = 1000) {
  const data = Object.fromEntries(insts.map((i) => [i.profile, []]))
  let on = true
  const loop = (async () => {
    for (const i of insts) await metrics(i) // prime: first cpu reading is since-start
    while (on) {
      await sleep(everyMs)
      for (const i of insts) {
        const m = await metrics(i).catch(() => null)
        if (!m) continue
        const byType = {}
        for (const p of m) {
          byType[p.type] ??= { cpu: 0, privMB: 0 }
          byType[p.type].cpu += p.cpu
          byType[p.type].privMB += p.priv / 1024
        }
        data[i.profile].push({ cpu: m.reduce((t, p) => t + p.cpu, 0), wsMB: m.reduce((t, p) => t + p.ws, 0) / 1024, privMB: m.reduce((t, p) => t + p.priv, 0) / 1024, byType })
      }
    }
  })()
  return async () => {
    on = false
    await loop
    return Object.fromEntries(
      Object.entries(data).map(([k, v]) => {
        const types = [...new Set(v.flatMap((s) => Object.keys(s.byType)))]
        return [
          k,
          {
            samples: v.length,
            // Electron normalizes percentCPUUsage by logical CPUs (calibrated: one busy thread = 4.9 % on 20 threads).
            cpuPctMachine: summary(v.map((s) => s.cpu)),
            privateMB: summary(v.map((s) => s.privMB)),
            workingSetMB: summary(v.map((s) => s.wsMB)),
            byType: Object.fromEntries(types.map((t) => [t, { cpuMedian: r1(median(v.map((s) => s.byType[t]?.cpu ?? 0))), privMBMedian: r1(median(v.map((s) => s.byType[t]?.privMB ?? 0))) }])),
          },
        ]
      }),
    )
  }
}

async function clockOffset(a, b) {
  let best = { rtt: Infinity, offset: 0 }
  for (let i = 0; i < 25; i++) {
    const a1 = await ev(a, () => window.__mediaLab.epochNow())
    const bt = await ev(b, () => window.__mediaLab.epochNow())
    const a2 = await ev(a, () => window.__mediaLab.epochNow())
    if (a2 - a1 < best.rtt) best = { rtt: a2 - a1, offset: bt - (a1 + a2) / 2 }
  }
  return best // offset = clock(B) - clock(A)
}

/** A's raw mic onsets vs B's received onsets of A's track: one-way latency on the shared machine clock. */
async function latency(a, b, seconds, thresholdDb, quietMs, offset) {
  await ev(a, ({ t, qm }) => (window.__probe = new window.__mediaLab.OnsetProbe(window.__mediaLab.localRawMic(), t, qm).start()), { t: thresholdDb, qm: quietMs })
  await ev(b, ({ t, qm }) => (window.__probe = new window.__mediaLab.OnsetProbe(window.__mediaLab.remoteMic('lab-a'), t, qm).start()), { t: thresholdDb, qm: quietMs })
  await sleep(seconds * 1000)
  const sent = await ev(a, () => window.__probe.stop())
  const recv = (await ev(b, () => window.__probe.stop())).map((t) => t - offset)
  const lat = []
  let missed = 0
  for (const t of sent) {
    const m = recv.find((r) => r > t && r - t < 400)
    if (m === undefined) missed++
    else lat.push(m - t)
  }
  return { sent: sent.length, received: recv.length, missed, latencyMs: summary(lat) }
}

/** Mean received audio power of A's track at B (dBFS) from inbound-rtp totalAudioEnergy. */
async function receivedEnergy(b, seconds) {
  const read = () => ev(b, async () => (await window.__mediaLab.rawStats({ remote: 'lab-a', source: 'mic' })).find((s) => s.type === 'inbound-rtp'))
  const s0 = await read()
  await sleep(seconds * 1000)
  const s1 = await read()
  if (typeof s1?.totalAudioEnergy !== 'number') return { unavailable: Object.keys(s1 ?? {}) }
  const e = s1.totalAudioEnergy - s0.totalAudioEnergy
  const d = s1.totalSamplesDuration - s0.totalSamplesDuration
  return { meanPowerDb: r1(10 * Math.log10(e / d)), concealedPct: r1((100 * (s1.concealedSamples - s0.concealedSamples)) / (s1.totalSamplesReceived - s0.totalSamplesReceived)) }
}

async function micRates(a, seconds) {
  const read = () => ev(a, async () => (await window.__mediaLab.rawStats('mic')).find((s) => s.type === 'outbound-rtp'))
  const s0 = await read()
  await sleep(seconds * 1000)
  const s1 = await read()
  const dt = (s1.timestamp - s0.timestamp) / 1000
  return { packetsPerSec: r1((s1.packetsSent - s0.packetsSent) / dt), kbps: r1(((s1.bytesSent - s0.bytesSent) * 8) / dt / 1000), targetBitrate: s1.targetBitrate ?? null }
}

// ─────────────── phases ───────────────
async function phaseVoice(sig) {
  const a = await launch('lab-a', sig.beeps)
  const b = await launch('lab-b', sig.silence)
  a.token = await token('lab-a')
  b.token = await token('lab-b')
  log('idle (default route) metrics…')
  await sleep(8000)
  let stop = sampler([a, b])
  await sleep(20_000)
  results.idle = { route: 'default (#/)', ...(await stop()) }
  save()

  await Promise.all([gotoLab(a), gotoLab(b)])
  results.codecProbe = await ev(a, () => window.__mediaLab.codecProbe())
  results.enumerateDevices = await ev(a, async () => (await navigator.mediaDevices.enumerateDevices()).map((d) => ({ kind: d.kind, hasId: !!d.deviceId, label: d.label })))
  results.env = await ev(a, () => ({ ua: navigator.userAgent, cores: navigator.hardwareConcurrency, dpr: devicePixelRatio, screen: [screen.width, screen.height] }))
  results.env.electron = await a.app.evaluate(({ app }) => ({ electron: process.versions.electron, chrome: process.versions.chrome, gpu: app.getGPUFeatureStatus() }))
  save()

  log('join timings…')
  const cold = [await join_(b)]
  const warm = []
  for (let i = 0; i < 8; i++) {
    const ms = await join_(a)
    if (i === 0) cold.push(ms)
    else warm.push(ms)
    await leave(a)
    await sleep(500)
  }
  await join_(a)
  results.joinMs = { firstJoinOfProcess: cold, subsequent: summary(warm) }
  log('join', results.joinMs)
  await sleep(3000)

  const clk = await clockOffset(a, b)
  results.clock = { offsetMsBminusA: r1(clk.offset), evalRoundTripMs: r1(clk.rtt) }
  log('clock', results.clock)

  results.opus = {
    sdp: await ev(a, () => window.__mediaLab.publisherSdpAudio()),
    sender: await ev(a, () => window.__mediaLab.micSenderParams()),
    silentMicB: await micRates(b, 10),
    receiverCodec: await ev(b, async () => {
      const st = await window.__mediaLab.rawStats({ remote: 'lab-a', source: 'mic' })
      const inb = st.find((s) => s.type === 'inbound-rtp')
      return st.find((s) => s.id === inb?.codecId) ?? null
    }),
    playoutContext: await ev(b, () => {
      const c = window.__mediaLab.media.debug.room?.audioContext
      return c ? { sampleRate: c.sampleRate, baseLatencyMs: c.baseLatency * 1000, outputLatencyMs: c.outputLatency * 1000 } : null
    }),
  }
  save()

  results.latency = {}
  for (const mode of ['off', 'standard', 'advanced']) {
    await ev(a, (m) => window.__mediaLab.media.setProcessing(m), mode)
    await sleep(2500)
    const active = (await state(a)).self.processingActive
    log(`latency mode=${mode} (active ${active})…`)
    stop = mode === 'off' ? sampler([a, b]) : null
    const [lat, rates] = await Promise.all([latency(a, b, 30, -30, 250, clk.offset), micRates(a, 30)])
    results.latency[mode] = { active, ...lat, micSend: rates }
    if (stop) results.inCallAudio = await stop()
    log(mode, JSON.stringify(results.latency[mode]))
    save()
  }
  if (!cspPatched) {
    // CSP as shipped: "advanced" must fall back to standard with a notice, mic still live.
    const st = await state(a)
    results.rnnoiseFallback = { processing: st.self.processing, active: st.self.processingActive, notice: st.notice?.text ?? null, micLive: await ev(a, () => window.__mediaLab.media.debug.mic?.mediaStreamTrack.readyState) }
  }
  await ev(a, () => window.__mediaLab.media.setProcessing('standard'))
  await sleep(1500)
  await shot(a, 'voice-a')
  await shot(b, 'voice-b')
  results.voiceStateB = (await state(b)).participants
  save()
  await close(a)
  await close(b)
}

async function phaseSpeech(sig) {
  const a = await launch('lab-a', sig.speech)
  const b = await launch('lab-b', sig.silence)
  a.token = await token('lab-a')
  b.token = await token('lab-b')
  await Promise.all([gotoLab(a), gotoLab(b)])
  await join_(b)
  await join_(a)
  await sleep(3000)
  const clk = await clockOffset(a, b)
  results.speech = { note: 'Windows SAPI TTS, 8 frases com pausas de 900 ms (WAV em loop)', clock: r1(clk.offset), modes: {} }
  for (const mode of ['off', 'standard', 'advanced']) {
    await ev(a, (m) => window.__mediaLab.media.setProcessing(m), mode)
    await sleep(2500)
    const active = (await state(a)).self.processingActive
    log(`speech mode=${mode} (active ${active})…`)
    const [lat, energy, rates] = await Promise.all([latency(a, b, 40, -40, 400, clk.offset), receivedEnergy(b, 40), micRates(a, 40)])
    results.speech.modes[mode] = { active, ...lat, rx: energy, micSend: rates }
    log(mode, JSON.stringify(results.speech.modes[mode]))
    save()
  }
  await ev(a, () => window.__mediaLab.media.setProcessing('advanced'))
  await sleep(1500)
  await shot(a, 'speech-advanced-a')
  await close(a)
  await close(b)
}

let pattern = null
function startPattern() {
  // Moving test pattern, full screen, on top: what the screen capture sees.
  pattern = spawn('ffplay', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=60', '-fs', '-alwaysontop', '-an', '-window_title', 'AlgaPattern'], { stdio: 'ignore' })
  children.add(pattern)
}
function stopPattern() {
  if (!pattern) return
  killTree(pattern.pid)
  children.delete(pattern)
  pattern = null
}

async function screenRun(a, b, { quality, codec, seconds, contentType = 'motion', tag, synthetic = null }) {
  const sourceId = synthetic ? null : await ev(a, async () => (await window.__mediaLab.media.getScreenSources()).find((s) => s.kind === 'screen')?.id ?? null)
  let sourceFps = null
  if (synthetic) {
    // A's window must be on top or its rAF-driven canvas slows down (B's window covers it otherwise).
    await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus())
    await a.page.bringToFront()
    await sleep(500)
    sourceFps = await ev(a, async (o) => {
      const t = window.__mediaLab.syntheticScreen(o.w, o.h, o.fps).getVideoTracks()[0]
      const rd = new MediaStreamTrackProcessor({ track: t }).readable.getReader()
      let n = 0
      const t0 = performance.now()
      while (performance.now() - t0 < 3000) (await rd.read()).value?.close(), n++
      t.stop()
      return Math.round(n / 3)
    }, synthetic)
  }
  await ev(
    a,
    ({ synthetic, ...o }) => window.__mediaLab.media.startScreenShare({ ...o, ...(synthetic && { stream: window.__mediaLab.syntheticScreen(synthetic.w, synthetic.h, synthetic.fps) }) }),
    { sourceId, audio: false, quality, contentType, codec, synthetic },
  )
  const label = await ev(a, () => {
    const t = window.__mediaLab.media.debug.screen?.video.track?.mediaStreamTrack
    return t ? { label: t.label, settings: t.getSettings(), contentHint: t.contentHint } : null
  })
  await sleep(1500)
  await ev(b, () => window.__mediaLab.media.watch('lab-a', 'source'))
  await b.page.waitForFunction(() => {
    const v = document.querySelector('[data-testid="video-lab-a"]')
    return v && v.videoWidth > 0
  }, null, { timeout: 20_000 })
  await sleep(12_000) // let the bandwidth estimate ramp up before measuring
  const stop = sampler([a, b])
  const sendS = []
  const recvS = []
  const poll = setInterval(async () => {
    const [sa, sb] = await Promise.all([state(a).catch(() => null), state(b).catch(() => null)])
    if (sa?.screen.stats) sendS.push(sa.screen.stats)
    if (sb?.viewers['lab-a']?.stats) recvS.push(sb.viewers['lab-a'].stats)
  }, 1000)
  const frames = await ev(b, (ms) => window.__mediaLab.frameTimes(document.querySelector('[data-testid="video-lab-a"]'), ms), seconds * 1000)
  clearInterval(poll)
  const sdpCodec = await ev(a, async () => {
    const st = await window.__mediaLab.rawStats('screen')
    const out = st.filter((s) => s.type === 'outbound-rtp')
    return [...new Set(out.map((o) => st.find((s) => s.id === o.codecId)).filter(Boolean).map((c) => `${c.mimeType} ${c.sdpFmtpLine ?? ''}`.trim()))]
  })
  const cpu = await stop()
  if (tag) {
    await shot(b, `${tag}-viewer`)
    await shot(a, `${tag}-sender`)
  }
  await ev(b, () => window.__mediaLab.media.unwatch('lab-a'))
  await ev(a, () => window.__mediaLab.media.stopScreenShare())
  await sleep(2000)
  const top = sendS.map((s) => s.layers[0]).filter(Boolean)
  const reasons = {}
  for (const l of top) reasons[l.qualityLimitationReason] = (reasons[l.qualityLimitationReason] ?? 0) + 1
  const last = recvS[recvS.length - 1] ?? {}
  return {
    quality,
    codec,
    contentType,
    source: synthetic ? `canvas sintético ${synthetic.w}x${synthetic.h}@${synthetic.fps} (renderizado no processo do A)` : 'captura real da tela 1920x1080 (ffplay testsrc2 @60 em tela cheia; captura crua medida ~52 fps)',
    negotiated: sdpCodec,
    sourceFps,
    capture: label,
    send: {
      layers: sendS[sendS.length - 1]?.layers.map((l) => ({ rid: l.rid, res: `${l.width}x${l.height}`, fps: r1(l.fps), kbps: Math.round(l.bitrateKbps), encoder: l.encoderImplementation, powerEfficient: l.powerEfficientEncoder, scalabilityMode: l.scalabilityMode })),
      topFps: summary(top.map((l) => l.fps)),
      topRes: [...new Set(top.map((l) => `${l.width}x${l.height}`))],
      totalKbps: summary(sendS.map((s) => s.bitrateKbps)),
      encoder: [...new Set(top.map((l) => l.encoderImplementation))],
      powerEfficient: [...new Set(top.map((l) => l.powerEfficientEncoder))],
      qualityLimitation: reasons,
      codec: sendS[sendS.length - 1]?.codec ?? null,
    },
    recv: {
      fps: summary(recvS.map((s) => s.fps)),
      res: [...new Set(recvS.map((s) => `${s.width}x${s.height}`))],
      kbps: summary(recvS.map((s) => s.bitrateKbps)),
      decoder: [...new Set(recvS.map((s) => s.decoderImplementation))],
      powerEfficient: [...new Set(recvS.map((s) => s.powerEfficientDecoder))],
      codec: last.codec ?? null,
      freezeCount: last.freezeCount ?? null,
      totalFreezesMs: r1(last.totalFreezesMs ?? null),
      framesDropped: last.framesDropped ?? null,
      jitterBufferMs: summary(recvS.map((s) => s.jitterBufferMs).filter((v) => v !== null)),
    },
    frameTimes: Object.fromEntries(Object.entries(frames).map(([k, v]) => [k, r1(v)])),
    cpu,
  }
}

async function withPair(sig, extra, fn, synthetic = false) {
  // A: real screen capture needs no fake devices, so A joins listen-only (no real mic is opened).
  //    Synthetic (canvas) runs keep fake devices + a silent mic on A instead.
  // B: fake silent mic — Chromium only exposes encoder/decoderImplementation to pages that are capturing.
  const aFake = synthetic && !argv.includes('--syn-nofake')
  const a = await launch('lab-a', sig.silence, extra, aFake)
  const b = await launch('lab-b', sig.silence, extra, true)
  a.token = await token('lab-a')
  b.token = await token('lab-b')
  await Promise.all([gotoLab(a), gotoLab(b)])
  await join_(b, true)
  await join_(a, aFake)
  // The full-screen pattern is only for real capture; on top of A it would throttle A's canvas (rAF).
  if (!synthetic) startPattern()
  await sleep(3000)
  try {
    return await fn(a, b)
  } finally {
    stopPattern()
    await close(a)
    await close(b)
  }
}

const brief = (r) => JSON.stringify({ src: r.sourceFps, neg: r.negotiated, send: { fps: r.send.topFps.median, res: r.send.topRes, enc: r.send.encoder, hw: r.send.powerEfficient, ql: r.send.qualityLimitation, kbps: r.send.totalKbps.median }, recv: { fps: r.recv.fps.median, dec: r.recv.decoder }, ft: r.frameTimes, cpuA: r.cpu['lab-a'].cpuPctMachine.median, cpuB: r.cpu['lab-b'].cpuPctMachine.median })

async function phaseScreen(sig) {
  const extra = flagArgs()
  results.screen = { ...results.screen, flags: extra }
  const go = (runs) => async (a, b) => {
    for (const r of runs) {
      const key = `${SCREEN_CODEC}:${r.key}`
      log(`screen ${key} ${r.seconds}s…`)
      results.screen[key] = await screenRun(a, b, { ...r, codec: SCREEN_CODEC, tag: `screen-${SCREEN_CODEC}-${r.key}` })
      log(key, brief(results.screen[key]))
      save()
    }
  }
  if (phases.includes('screen')) await withPair(sig, extra, go([{ key: '1080p60', quality: '1080p60', seconds: SCREEN_SECONDS }]))
  if (phases.includes('synthetic')) await withPair(
    sig,
    extra,
    go([
      { key: '1080p60-synthetic', quality: '1080p60', seconds: 30, synthetic: { w: 1920, h: 1080, fps: 60 } },
      { key: '1440p60-synthetic', quality: '1440p60', seconds: SCREEN_SECONDS, synthetic: { w: 2560, h: 1440, fps: 60 } },
      { key: '2160p30-synthetic', quality: '2160p30', seconds: 25, synthetic: { w: 3840, h: 2160, fps: 30 } },
    ]),
    true,
  )
}

async function phaseCodecs(sig) {
  results.codecs = {}
  const variants = [
    { name: 'default', extra: [], codecs: ['h264', 'h265', 'vp8', 'vp9', 'av1'] },
    { name: 'PlatformH264CbpEncoding', extra: ['--enable-features=PlatformH264CbpEncoding'], codecs: ['h264'] },
  ]
  for (const v of variants) {
    await withPair(sig, v.extra, async (a, b) => {
      for (const codec of v.codecs) {
        const key = `${v.name}:${codec}`
        log(`codec ${key} 1080p60 25s…`)
        results.codecs[key] = await screenRun(a, b, { quality: '1080p60', codec, seconds: 25 })
        log(key, brief(results.codecs[key]))
        save()
      }
      if (v.name === 'default') {
        log('detail content 1080p60 h264 25s…')
        results.codecs['default:h264-detail'] = await screenRun(a, b, { quality: '1080p60', codec: 'h264', seconds: 25, contentType: 'detail' })
        save()
      }
    })
  }
}

async function phaseReconnect(sig) {
  const a = await launch('lab-a', sig.beeps)
  const b = await launch('lab-b', sig.silence)
  a.token = await token('lab-a')
  b.token = await token('lab-b')
  await Promise.all([gotoLab(a), gotoLab(b)])
  await join_(b)
  await join_(a)
  await sleep(4000)
  const runs = []
  for (let i = 0; i < 3; i++) {
    const track = async (inst) => {
      const seen = []
      let last = null
      const t0 = Date.now()
      while (Date.now() - t0 < 70_000) {
        const s = await state(inst).catch(() => null)
        const mic = await ev(inst, () => window.__mediaLab.media.debug.mic?.mediaStreamTrack.readyState ?? 'none').catch(() => '?')
        const key = `${s?.connection.state}|${mic}`
        if (key !== last) seen.push({ t: Date.now(), state: s?.connection.state, reason: s?.connection.reason, mic })
        last = key
        if (seen.length > 1 && s?.connection.state === 'connected' && Object.keys(s.participants).length > 0) break
        await sleep(100)
      }
      return seen
    }
    log(`reconnect run ${i + 1}: killing LiveKit…`)
    const tKill = Date.now()
    const watchers = [track(a), track(b)]
    stopLiveKit()
    await sleep(3000)
    const tStart = Date.now()
    await startLiveKit()
    const tUp = Date.now()
    const [sa, sb] = await Promise.all(watchers)
    const done = (seen) => seen.findLast((x) => x.state === 'connected')?.t ?? null
    const rel = (seen) => seen.map((x) => ({ ...x, t: x.t - tKill }))
    runs.push({
      downMs: tStart - tKill,
      serverStartMs: tUp - tStart,
      a: { recoveredAfterServerUpMs: done(sa) && done(sa) - tUp, timeline: rel(sa) },
      b: { recoveredAfterServerUpMs: done(sb) && done(sb) - tUp, timeline: rel(sb) },
      lastReconnectMs: { a: (await state(a)).connection.lastReconnectMs, b: (await state(b)).connection.lastReconnectMs },
    })
    log(JSON.stringify(runs[runs.length - 1]).slice(0, 600))
    await sleep(5000)
  }
  results.reconnect = runs
  await shot(a, 'reconnect-a')
  save()
  await close(a)
  await close(b)
}

// ─────────────── main ───────────────
try {
  mkdirSync(work, { recursive: true })
  if (!argv.includes('--no-build')) {
    log('building…')
    const r = spawnSync('npm', ['run', 'build', '-w', 'apps/desktop'], { cwd: repo, stdio: 'inherit', shell: true })
    if (r.status !== 0) throw new Error('build failed')
  }
  const sig = makeSignals()
  await startLiveKit()
  results.when = new Date().toISOString()
  if (argv.includes('--proposed-csp')) patchCsp()
  const csp = argv.includes('--proposed-csp') ? "script-src 'self' 'wasm-unsafe-eval' (proposta, só no build do lab)" : "script-src 'self' (como enviado)"
  results.cspByPhase = { ...results.cspByPhase, ...Object.fromEntries(phases.map((p) => [p, csp])) }
  if (phases.includes('voice')) await phaseVoice(sig)
  if (phases.includes('speech')) await phaseSpeech(sig)
  if (phases.includes('codecs')) await phaseCodecs(sig)
  if (phases.includes('screen') || phases.includes('synthetic')) await phaseScreen(sig)
  if (phases.includes('reconnect')) await phaseReconnect(sig)
  save()
  log('done →', outJson)
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await cleanup()
}
