#!/usr/bin/env node
// "Sala de Cinema" spike: codec support in Electron 45 (MSE), ffmpeg LGPL speed, data-channel throughput and
// gateway RTT. Measure-first script; nothing here ships. Results: docs/benchmarks/cinema-spike.md.
//
//   node apps/desktop/scripts/cinema-fixtures.mjs [--long]          # once
//   node apps/desktop/scripts/cinema-spike.mjs --ffmpeg=<dir with ffmpeg.exe+ffprobe.exe (LGPL build)>
//     [--phase=ffmpeg,mse,dc,gateway] [--out=<results.json>] [--mse-seconds=10] [--dc-seconds=10]
//
// Needs no app build: it opens plain Electron windows on a page served from a local HTTP server. Windows are
// small and visible on purpose (MSE needs real rendering); audio is analysed in WebAudio and never routed to
// the speakers (the graph ends in a gain-0 node), so nothing plays out loud.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, createReadStream, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const desktop = resolve(here, '..')
const repo = resolve(desktop, '../..')
const fixtures = join(desktop, 'test-fixtures/cinema')
const work = join(tmpdir(), 'alga-cinema-spike')
mkdirSync(work, { recursive: true })
const argv = process.argv.slice(2)
const arg = (n, d) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d
const phases = arg('phase', 'ffmpeg,mse,dc,gateway').split(',')
const ffDir = arg('ffmpeg', '')
const outJson = arg('out', join(work, 'results.json'))
const MSE_SECONDS = Number(arg('mse-seconds', 10))
const DC_SECONDS = Number(arg('dc-seconds', 10))
const bin = (n) => (ffDir ? join(ffDir, `${n}.exe`) : n)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(`[cinema ${new Date().toISOString().slice(11, 19)}]`, ...a)
const q = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null
}
const r2 = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)
const results = existsSync(outJson) ? JSON.parse(readFileSync(outJson, 'utf8')) : {}
const save = () => writeFileSync(outJson, JSON.stringify(results, null, 2) + '\n')
const run = (exe, args) => spawnSync(bin(exe), args, { encoding: 'utf8', maxBuffer: 1 << 28 })
const timed = (exe, args) => {
  const t0 = performance.now()
  const r = run(exe, args)
  return { s: (performance.now() - t0) / 1000, ok: r.status === 0, err: r.status === 0 ? '' : r.stderr.trim().split('\n').slice(-1)[0] }
}
const probe = (file) => JSON.parse(run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]).stdout)
const duration = (file) => Number(probe(file).format.duration)

// ───────────── Step 4: ffmpeg LGPL speed ─────────────
function phaseFfmpeg() {
  const files = readdirSync(fixtures).filter((f) => !f.startsWith('.') && (f.endsWith('.mkv') || f.endsWith('.mp4'))).sort()
  const tmp = join(work, 'hls')
  const rows = []
  for (const f of files) {
    const file = join(fixtures, f)
    const dur = duration(file)
    const row = { file: f, durationS: r2(dur), sizeMB: r2(statSync(file).size / 1e6) }
    // Keyframe list (what the seek index needs).
    const t0 = performance.now()
    const kf = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv', file])
    row.keyframesS = r2((performance.now() - t0) / 1000)
    row.keyframes = kf.stdout.split('\n').filter((l) => /,K/.test(l)).length
    row.keyframesX = r2(dur / row.keyframesS)
    // Video remux: copy into HLS fMP4, 4 s segments.
    rmSync(tmp, { recursive: true, force: true })
    mkdirSync(tmp, { recursive: true })
    const hls = (extra, name) => [...extra, '-f', 'hls', '-hls_time', '4', '-hls_segment_type', 'fmp4', '-hls_playlist_type', 'vod', '-hls_segment_filename', join(tmp, `${name}%d.m4s`), join(tmp, `${name}.m3u8`)]
    const vcodec = probe(file).streams.find((s) => s.codec_type === 'video')?.codec_name
    const tag = vcodec === 'hevc' ? ['-tag:v', 'hvc1'] : []
    const v = timed('ffmpeg', ['-y', '-v', 'error', '-i', file, '-map', '0:v:0', '-c:v', 'copy', ...tag, '-an', '-sn', ...hls([], 'v')])
    row.remuxVideoS = r2(v.s)
    row.remuxVideoX = v.ok ? r2(dur / v.s) : null
    row.remuxVideoErr = v.err
    // Audio conversion, first audio stream, each target codec.
    const ch = probe(file).streams.find((s) => s.codec_type === 'audio')?.channels ?? 2
    const targets = { aac640: ['-c:a', 'aac', '-b:a', '640k', '-ac', String(Math.min(ch, 6))], // libopus rejects 5.1(side)/7.1(wide) layouts: relabel to the plain ones first.
      opus: [...(ch > 2 ? ['-af', `aformat=channel_layouts=${ch > 6 ? '7.1' : '5.1'}`] : []), '-c:a', 'libopus', '-b:a', ch > 2 ? '510k' : '128k', '-mapping_family', '1'], flac: ['-c:a', 'flac'] }
    for (const [name, enc] of Object.entries(targets)) {
      const a = timed('ffmpeg', ['-y', '-v', 'error', '-i', file, '-map', '0:a:0', '-vn', '-sn', ...enc, ...hls([], `a-${name}`)])
      row[`audio_${name}_s`] = r2(a.s)
      row[`audio_${name}_x`] = a.ok ? r2(dur / a.s) : null
      if (!a.ok) row[`audio_${name}_err`] = a.err
    }
    rows.push(row)
    log(f, JSON.stringify({ kf: row.keyframesS, remux: row.remuxVideoS, aac: row.audio_aac640_s }))
  }
  rmSync(tmp, { recursive: true, force: true })
  results.ffmpeg = { version: run('ffmpeg', ['-version']).stdout.split('\n')[0], rows }
  save()
}

// ───────────── shared: HTTP server + Electron windows ─────────────
// Serves the page and the work dir (with Range support: <video>/MSE fetches) from 127.0.0.1.
const PAGE = readFileSync(join(here, 'cinema-spike-page.html'), 'utf8')
function startServer() {
  const srv = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/page.html') return void res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE)
    const file = join(work, 'media', decodeURIComponent(url.pathname))
    if (!file.startsWith(join(work, 'media')) || !existsSync(file)) return void res.writeHead(404).end()
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': statSync(file).size })
    createReadStream(file).pipe(res)
  })
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, base: `http://127.0.0.1:${srv.address().port}` })))
}
const MAIN = join(work, 'main.cjs')
writeFileSync(MAIN, `const { app, BrowserWindow } = require('electron')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns,CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.setPath('userData', process.env.SPIKE_UD)
app.whenReady().then(() => { const w = new BrowserWindow({ width: 640, height: 360, webPreferences: { backgroundThrottling: false } }); w.loadURL(process.env.SPIKE_URL) })
`)
async function launch(base, name) {
  const env = { ...process.env, SPIKE_URL: `${base}/page.html`, SPIKE_UD: join(work, 'ud-' + name) }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({ executablePath: electronPath, args: [MAIN], env })
  const page = await app.firstWindow()
  page.on('console', (m) => m.type() === 'error' && log(name, 'console.error:', m.text().slice(0, 200)))
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

// ───────────── Step 3: MSE matrix ─────────────
// delay_moov: AC-3/E-AC-3 only get a valid moov once the first packet is seen.
const mp4 = ['-movflags', 'frag_keyframe+empty_moov+default_base_moof+delay_moov']
function mkfmp4(src, out, args) {
  const r = run('ffmpeg', ['-y', '-v', 'error', '-i', src, ...args, ...mp4, join(work, 'media', out)])
  if (r.status !== 0) log('fmp4 failed', out, r.stderr.trim().split('\n').slice(-1)[0])
  return r.status === 0
}
const pad2 = (n) => String(n).padStart(2, '0')
function avc1(file) {
  const b = readFileSync(file)
  const i = b.indexOf('avcC')
  return `avc1.${[b[i + 5], b[i + 6], b[i + 7]].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}
async function phaseMse() {
  mkdirSync(join(work, 'media'), { recursive: true })
  const fx = (n) => join(fixtures, n)
  const info = (n) => probe(fx(n)).streams
  // Video tracks (copied, never re-encoded).
  mkfmp4(fx('h264-ac3-51.mkv'), 'v-h264.mp4', ['-map', '0:v:0', '-c:v', 'copy', '-an'])
  mkfmp4(fx('hevc10-hdr10-eac3-51.mkv'), 'v-hevc10.mp4', ['-map', '0:v:0', '-c:v', 'copy', '-tag:v', 'hvc1', '-an'])
  mkfmp4(fx('av1-opus-51.mkv'), 'v-av1.mp4', ['-map', '0:v:0', '-c:v', 'copy', '-an'])
  const hv = info('hevc10-hdr10-eac3-51.mkv').find((s) => s.codec_type === 'video')
  const av = info('av1-opus-51.mkv').find((s) => s.codec_type === 'video')
  const video = {
    h264: { file: 'v-h264.mp4', type: `video/mp4; codecs="${avc1(join(work, 'media/v-h264.mp4'))}"` },
    'hevc10 (hvc1)': { file: 'v-hevc10.mp4', type: `video/mp4; codecs="hvc1.2.4.L${hv.level}.B0"` },
    av1: { file: 'v-av1.mp4', type: `video/mp4; codecs="av01.0.${pad2(av.level)}M.08"` },
  }
  // Audio tracks: 5.1 from the AC-3 fixture, 7.1 from the TrueHD one (decoded, then re-encoded).
  const A = (name, src, enc) => mkfmp4(fx(src), `a-${name}.mp4`, ['-map', '0:a:0', '-vn', ...enc, '-strict', '-2'])
  const ok = {
    aac51: A('aac51', 'h264-ac3-51.mkv', ['-c:a', 'aac', '-b:a', '640k', '-ac', '6']),
    opus51: A('opus51', 'h264-ac3-51.mkv', ['-af', 'aformat=channel_layouts=5.1', '-c:a', 'libopus', '-b:a', '510k', '-mapping_family', '1']),
    flac51: A('flac51', 'h264-ac3-51.mkv', ['-c:a', 'flac']),
    aac71: A('aac71', 'hevc10-truehd-71.mkv', ['-c:a', 'aac', '-b:a', '960k', '-ac', '8']),
    opus71: A('opus71', 'hevc10-truehd-71.mkv', ['-af', 'aformat=channel_layouts=7.1', '-c:a', 'libopus', '-b:a', '768k', '-mapping_family', '1']),
    flac71: A('flac71', 'hevc10-truehd-71.mkv', ['-c:a', 'flac']),
    ac3: A('ac3', 'h264-ac3-51.mkv', ['-c:a', 'copy']),
    eac3: A('eac3', 'hevc10-hdr10-eac3-51.mkv', ['-c:a', 'copy', '-tag:a', 'ec-3']),
    aacCopy51: A('aacCopy51', 'h264-aac-srt-ass.mkv', ['-c:a', 'copy']),
  }
  log('fmp4 prepared', JSON.stringify(ok))
  const audio = {
    'aac 5.1 (mp4a.40.2)': { file: 'a-aac51.mp4', type: 'audio/mp4; codecs="mp4a.40.2"', n: 6 },
    'aac 5.1 (copy of source)': { file: 'a-aacCopy51.mp4', type: 'audio/mp4; codecs="mp4a.40.2"', n: 6 },
    'opus 5.1': { file: 'a-opus51.mp4', type: 'audio/mp4; codecs="opus"', n: 6 },
    'flac 5.1': { file: 'a-flac51.mp4', type: 'audio/mp4; codecs="flac"', n: 6 },
    'aac 7.1': { file: 'a-aac71.mp4', type: 'audio/mp4; codecs="mp4a.40.2"', n: 8 },
    'opus 7.1': { file: 'a-opus71.mp4', type: 'audio/mp4; codecs="opus"', n: 8 },
    'flac 7.1': { file: 'a-flac71.mp4', type: 'audio/mp4; codecs="flac"', n: 8 },
    'ac-3 5.1 (passthrough)': { file: 'a-ac3.mp4', type: 'audio/mp4; codecs="ac-3"', n: 6 },
    'e-ac-3 5.1 (passthrough)': { file: 'a-eac3.mp4', type: 'audio/mp4; codecs="ec-3"', n: 6 },
  }
  const { srv, base } = await startServer()
  const { app, page } = await launch(base, 'mse')
  try {
    const env = await page.evaluate(() => ({ ua: navigator.userAgent, maxCh: new AudioContext().destination.maxChannelCount }))
    // isTypeSupported over everything a film might carry, including what cannot sit in MP4/MSE at all.
    const types = [
      'video/mp4; codecs="avc1.640028"', 'video/mp4; codecs="hvc1.1.6.L120.B0"', 'video/mp4; codecs="hvc1.2.4.L120.B0"', 'video/mp4; codecs="hev1.2.4.L150.B0"',
      'video/mp4; codecs="av01.0.08M.08"', 'video/mp4; codecs="av01.0.12M.10"', 'video/mp4; codecs="vp09.00.40.08"', 'video/mp4; codecs="dvh1.05.06"', 'video/mp4; codecs="dvhe.08.06"',
      'video/mp4; codecs="mp4v.20.9"', 'video/webm; codecs="vp9"',
      'audio/mp4; codecs="mp4a.40.2"', 'audio/mp4; codecs="mp4a.40.5"', 'audio/mp4; codecs="opus"', 'audio/mp4; codecs="flac"', 'audio/mp4; codecs="ac-3"', 'audio/mp4; codecs="ec-3"',
      'audio/mp4; codecs="mp4a.a5"', 'audio/mp4; codecs="mp4a.a6"', 'audio/mp4; codecs="dtsc"', 'audio/mp4; codecs="dtsh"', 'audio/mp4; codecs="mlpa"', 'audio/mp4; codecs="mp3"', 'audio/mp4; codecs="mp4a.69"',
      'audio/webm; codecs="opus"', 'audio/webm; codecs="vorbis"', 'audio/flac', 'audio/ogg; codecs="flac"',
    ]
    const supported = await page.evaluate((t) => t.map((x) => [x, MediaSource.isTypeSupported(x)]), types)
    const play = async (v, a) => {
      const r = await page.evaluate(({ spec, base, seconds }) => window.cinemaPlay({ ...spec, base, seconds }), {
        spec: { vFile: v?.file, vType: v?.type, aFile: a.file, aType: a.type, channels: a.n, tones: window_tones(a.n) },
        base,
        seconds: MSE_SECONDS,
      })
      return r
    }
    const baseAudio = audio['aac 5.1 (mp4a.40.2)']
    const rows = []
    for (const [name, v] of Object.entries(video)) {
      log('play video', name)
      rows.push({ kind: 'video', name, type: v.type, supportedByIsType: supported.find(([t]) => t === v.type)?.[1], ...(await play(v, baseAudio)) })
    }
    for (const [name, a] of Object.entries(audio)) {
      log('play audio', name)
      rows.push({ kind: 'audio', name, type: a.type, supportedByIsType: supported.find(([t]) => t === a.type)?.[1], ...(await play(video.h264, a)) })
    }
    results.mse = { env, supported, rows }
    save()
  } finally {
    await app.close().catch(() => {})
    srv.close()
  }
}
const TONES = { 6: [440, 550, 660, 60, 770, 880], 8: [440, 550, 660, 60, 770, 880, 990, 1100] }
const window_tones = (n) => TONES[n]

// ───────────── Step 5: data channel ─────────────
async function phaseDc() {
  const { srv, base } = await startServer()
  const A = await launch(base, 'dc-a')
  const B = await launch(base, 'dc-b')
  const out = { chunkKiB: 224, seconds: DC_SECONDS, runs: [] }
  try {
    for (const pcs of [1, 2]) {
      const ids = Array.from({ length: pcs }, (_, i) => `${pcs}-${i}`)
      for (const id of ids) {
        const offer = await A.page.evaluate((id) => window.dcOffer(id), id)
        const answer = await B.page.evaluate(([id, sdp]) => window.dcAnswer(id, sdp), [id, offer])
        await A.page.evaluate(([id, sdp]) => window.dcAccept(id, sdp), [id, answer])
      }
      await Promise.all([A.page.evaluate((ids) => window.dcWaitOpen(ids), ids), B.page.evaluate((ids) => window.dcWaitOpen(ids), ids)])
      const path = await A.page.evaluate((id) => window.dcPath(id), ids[0])
      // Pump for DC_SECONDS; B counts bytes (ignore the first second: SCTP slow start).
      await A.page.evaluate(([ids, s]) => window.dcPump(ids, s), [ids, DC_SECONDS])
      await sleep(1000)
      const b0 = await B.page.evaluate(() => window.dcRx())
      await sleep((DC_SECONDS - 2) * 1000)
      const b1 = await B.page.evaluate(() => window.dcRx())
      const mbps = ((b1.bytes - b0.bytes) * 8) / ((b1.t - b0.t) / 1000) / 1e6
      await sleep(1500)
      out.runs.push({ pcs, mbps: r2(mbps), mbpsPerPc: r2(mbps / pcs), selectedPath: path })
      log('dc', JSON.stringify(out.runs.at(-1)))
      await A.page.evaluate(() => window.dcReset())
      await B.page.evaluate(() => window.dcReset())
    }
    results.dataChannel = out
    save()
  } finally {
    await A.app.close().catch(() => {})
    await B.app.close().catch(() => {})
    srv.close()
  }
}

// ───────────── Step 6: gateway RTT ─────────────
const portOpen = (port) => new Promise((res) => { const s = createConnection({ port, host: '127.0.0.1' }); s.once('connect', () => (s.destroy(), res(true))); s.once('error', () => res(false)) })
async function phaseGateway() {
  const PORT = 4010
  if (await portOpen(PORT)) throw new Error(`:${PORT} busy`)
  const server = join(repo, 'apps/server')
  // Own throwaway server (in-memory PGlite), never the team's dev stack on :4000.
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', '--dev'], {
    cwd: server, stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'development', PORT: String(PORT), HOST: '127.0.0.1', PGLITE_DIR: 'memory://cinema-spike' },
  })
  try {
    for (let i = 0; i < 300 && !(await portOpen(PORT)); i++) await sleep(100)
    const api = `http://127.0.0.1:${PORT}/api/v1`
    const legal = await (await fetch(`${api}/legal`)).json()
    const mk = async (name) => {
      const r = await fetch(`${api}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${name}@spike.alga.test`, username: name, displayName: name, password: `Sp1ke-${Math.random().toString(36).slice(2)}-Zq9!`, birthDate: '1990-03-03', termsVersion: legal.termsVersion }) })
      if (!r.ok) throw new Error(`register ${name}: ${r.status} ${await r.text()}`)
      return (await r.json()).token
    }
    const tokens = [await mk('spike_a'), await mk('spike_b')]
    const N = 100 // 120 frames/min/socket is the gateway's limit: identify + 100 heartbeats fits
    const client = (token) => new Promise((res, rej) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/gateway`)
      const rtts = []
      let sentAt = 0
      ws.onerror = () => rej(new Error('ws error'))
      ws.onopen = () => ws.send(JSON.stringify({ op: 'identify', token }))
      ws.onmessage = (m) => {
        const f = JSON.parse(m.data)
        if (f.op === 'dispatch' && f.t === 'READY') beat()
        if (f.op === 'heartbeat_ack') {
          rtts.push(performance.now() - sentAt)
          if (rtts.length >= N) { ws.close(); res(rtts) } else setTimeout(beat, 500)
        }
      }
      const beat = () => { sentAt = performance.now(); ws.send(JSON.stringify({ op: 'heartbeat' })) }
    })
    const [ra, rb] = await Promise.all(tokens.map(client))
    const all = [...ra, ...rb]
    const stat = (a) => ({ n: a.length, min: r2(q(a, 0)), median: r2(q(a, 0.5)), p95: r2(q(a, 0.95)), max: r2(q(a, 1)) })
    results.gateway = { target: 'local throwaway server (in-memory PGlite), 2 clients, heartbeat/heartbeat_ack every 500 ms', rttMs: stat(all), perClient: [stat(ra), stat(rb)] }
    // Unauthenticated WAN baseline to the public staging API: keep-alive GET RTT (no account, no credentials).
    const stg = process.env.STG_API ?? 'https://api-staging-b3ea.up.railway.app'
    try {
      const w = []
      for (let i = 0; i < 40; i++) { const t = performance.now(); const r = await fetch(`${stg}/api/v1/legal`); await r.arrayBuffer(); w.push(performance.now() - t); await sleep(200) }
      results.gateway.stagingHttpKeepAliveMs = { note: 'GET /legal on the public staging API, first sample (TLS handshake) dropped', ...stat(w.slice(1)) }
    } catch (e) { results.gateway.stagingHttpKeepAliveMs = { error: String(e).slice(0, 120) } }
    save()
    log('gateway', JSON.stringify(results.gateway))
  } finally {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
    else proc.kill('SIGKILL')
  }
}

results.meta = { electron: process.versions.electron ?? 'see Electron launch', node: process.version, at: new Date().toISOString() }
if (phases.includes('ffmpeg')) phaseFfmpeg()
if (phases.includes('mse')) await phaseMse()
if (phases.includes('dc')) await phaseDc()
if (phases.includes('gateway')) await phaseGateway()
save()
log('done ->', outJson)
