#!/usr/bin/env node
// Degraded-network lab: the lab SFU runs ICE-lite, UDP only, on a single mux port, advertising the proxy's
// address (node_ip). scripts/netem/udp-impair.mjs listens there and relays to the SFU's own address, so every
// media packet of both Electron instances crosses the impairment proxy. Signalling (WebSocket) is not impaired.
//
//   node apps/desktop/scripts/media-net.mjs [--no-build] [--phase=voice,protection,screen,uplink,rejoin,presets] [--seconds=25] [--reps=2] [--fresh]
//
// Results: docs/benchmarks/media-network.json (numbers quoted in media-network.md).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import * as L from './media-lab.mjs'
import { createImpairProxy } from '../../../scripts/netem/udp-impair.mjs'

const { arg, ev, gotoLab, join_, launch, close, leave, log, sleep, state, token, r1, median, q, repo, cleanup } = L
const UDP_PORT = 7892
// Windows only delivers UDP between local sockets bound to the same address (a socket bound to one IP can't
// reach another local IP, loopback included: measured), and pion's UDP mux never binds loopback. So the proxy
// listens on the LAN address Chromium uses for its host candidates (it ignored a link-local one) and the SFU
// binds a second local IPv4 (link-local preferred: not routable off this machine); the proxy's per-client
// sockets are bound to that one. Both only for the few minutes of the run.
const [PROXY_IP, SFU_IP] = (() => {
  const v4 = Object.values(networkInterfaces()).flat().filter((x) => x && x.family === 'IPv4' && !x.internal).map((x) => x.address)
  const proxyIp = v4.find((x) => /^(192.168|10)./.test(x)) ?? v4[0]
  const sfuIp = v4.find((x) => x !== proxyIp && x.startsWith('169.254.')) ?? v4.find((x) => x !== proxyIp)
  if (!proxyIp || !sfuIp) throw new Error('the netem lab needs two non-loopback IPv4 addresses on this machine')
  return [proxyIp, sfuIp]
})()
const SECONDS = Number(arg('seconds', 25))
const phases = arg('phase', 'voice,protection,screen').split(',')
const outJson = join(repo, 'docs/benchmarks/media-network.json')
const results = existsSync(outJson) ? JSON.parse(readFileSync(outJson, 'utf8')) : {}
const save = () => writeFileSync(outJson, JSON.stringify(results, null, 2) + '\n')

// ICE-lite: the SFU only answers checks (to the proxy's per-client socket), never probes clients directly,
// so media can't bypass the proxy. tcp_port 0 + no TURN = no TCP fallback.
L.liveKitOverride.edit = (yaml) =>
  yaml
    .replace(/^\s*port_range_start:.*\r?\n/m, '')
    .replace(/^\s*port_range_end:.*\r?\n/m, '')
    .replace(/tcp_port: \d+/, `tcp_port: 0\n  udp_port: ${UDP_PORT}\n  use_ice_lite: true\n  ips:\n    includes: [${SFU_IP}/32]`)
    .replace(/node_ip: [\d.]+/, `node_ip: ${PROXY_IP}`)

let proxy = null
const profile = (up, down = {}) => {
  proxy.reset()
  proxy.set('up', up)
  proxy.set('down', down)
}

/** Which path media really takes (must be udp to the proxy). */
const path = (inst) =>
  ev(inst, async () => {
    const out = []
    for (const pc of window.__mediaLab.peerConnections()) {
      const st = await pc.getStats()
      st.forEach((s) => {
        if (s.type !== 'candidate-pair' || !s.nominated || s.state !== 'succeeded') return
        const lc = st.get(s.localCandidateId)
        const rc = st.get(s.remoteCandidateId)
        out.push({ local: `${lc?.protocol} ${lc?.candidateType}`, remote: `${rc?.protocol} ${rc?.address}:${rc?.port} ${rc?.candidateType}`, rttMs: s.currentRoundTripTime * 1000 })
      })
    }
    return out
  })

// ─────────────── voice ───────────────
const VOICE_KEYS = ['packetsReceived', 'packetsLost', 'concealedSamples', 'silentConcealedSamples', 'totalSamplesReceived', 'concealmentEvents', 'jitterBufferDelay', 'jitterBufferTargetDelay', 'jitterBufferEmittedCount', 'fecPacketsReceived', 'fecPacketsDiscarded', 'packetsDiscarded', 'insertedSamplesForDeceleration', 'removedSamplesForAcceleration', 'totalSamplesDuration']
const inbound = (b) =>
  ev(b, async (keys) => {
    const st = await window.__mediaLab.rawStats({ remote: 'lab-a', source: 'mic' })
    const s = st.find((x) => x.type === 'inbound-rtp')
    const codec = st.find((x) => x.id === s?.codecId)
    return s ? { ...Object.fromEntries(keys.map((k) => [k, s[k] ?? 0])), codec: codec?.mimeType ?? null } : null
  }, VOICE_KEYS)
const sender = (a) =>
  ev(a, async () => {
    const st = await window.__mediaLab.rawStats('mic')
    const o = st.find((x) => x.type === 'outbound-rtp')
    const r = st.find((x) => x.type === 'remote-inbound-rtp')
    const p = window.__mediaLab.micSenderParams()
    return { bytesSent: o?.bytesSent ?? 0, packetsSent: o?.packetsSent ?? 0, t: o?.timestamp ?? 0, rttMs: r?.roundTripTime != null ? r.roundTripTime * 1000 : null, fractionLost: r?.fractionLost ?? null, codecs: p?.codecs?.map((c) => `${c.mimeType} ${c.sdpFmtpLine ?? ''}`.trim()) }
  })

/** Over `seconds`: what B's jitter buffer did with A's voice. Concealment excludes DTX comfort noise. */
async function voiceWindow(a, b, seconds) {
  const [i0, s0, p0] = [await inbound(b), await sender(a), proxy.stats()]
  await sleep(seconds * 1000)
  const [i1, s1, p1] = [await inbound(b), await sender(a), proxy.stats()]
  const d = Object.fromEntries(VOICE_KEYS.map((k) => [k, (i1?.[k] ?? 0) - (i0?.[k] ?? 0)]))
  const expected = d.packetsReceived + d.packetsLost
  const upIn = p1.up.in - p0.up.in
  return {
    codec: i1?.codec,
    sendCodecs: s1.codecs,
    netLossUpPct: r1((100 * (p1.up.lost - p0.up.lost)) / Math.max(1, upIn)),
    rtpLossPct: r1((100 * Math.max(0, d.packetsLost)) / Math.max(1, expected)),
    concealedPct: r1((100 * (d.concealedSamples - d.silentConcealedSamples)) / Math.max(1, d.totalSamplesReceived)),
    concealmentEventsPerMin: r1((d.concealmentEvents * 60) / seconds),
    jitterBufferMs: r1((1000 * d.jitterBufferDelay) / Math.max(1, d.jitterBufferEmittedCount)),
    jitterBufferTargetMs: r1((1000 * d.jitterBufferTargetDelay) / Math.max(1, d.jitterBufferEmittedCount)),
    fecPacketsReceived: d.fecPacketsReceived,
    fecPacketsDiscarded: d.fecPacketsDiscarded,
    stretchPct: r1((100 * (d.insertedSamplesForDeceleration + d.removedSamplesForAcceleration)) / Math.max(1, d.totalSamplesReceived)),
    sendKbps: r1(((s1.bytesSent - s0.bytesSent) * 8) / Math.max(1, s1.t - s0.t)),
    senderRttMs: r1(s1.rttMs),
  }
}

async function voicePair(sig) {
  const a = await launch('lab-a', sig.speech)
  const b = await launch('lab-b', sig.silence)
  a.token = await token('lab-a')
  b.token = await token('lab-b')
  await Promise.all([gotoLab(a), gotoLab(b)])
  await join_(b)
  await join_(a)
  await sleep(3000)
  return { a, b }
}

async function phaseVoice(sig) {
  const { a, b } = await voicePair(sig)
  results.voice = { when: new Date().toISOString(), signal: 'TTS pt-BR em loop (8 frases, pausas de 900 ms), modo Padrão, VAD automático', seconds: SECONDS, path: { a: await path(a), b: await path(b) }, runs: [] }
  if (!results.voice.path.a.every((p) => p.remote.startsWith(`udp ${PROXY_IP}:${UDP_PORT}`))) throw new Error(`media not via proxy: ${JSON.stringify(results.voice.path.a)}`)
  try {
    for (const rtt of [50, 150, 300]) {
      for (const loss of [0, 2, 5, 10, 20]) {
        // Each direction carries half the RTT ± 15 ms (A→SFU→B = RTT ± 30 ms); loss only on uplinks (A's voice).
        profile({ delay: rtt / 2, jitter: 15, loss }, { delay: rtt / 2, jitter: 15 })
        await sleep(6000)
        const m = await voiceWindow(a, b, SECONDS)
        results.voice.runs.push({ rttMs: rtt, jitterMs: 30, lossPct: loss, ...m })
        log(`voice rtt=${rtt} loss=${loss}`, JSON.stringify(m))
        save()
      }
    }
  } finally {
    proxy.reset()
    await close(a)
    await close(b)
  }
}

async function phaseProtection(sig) {
  const { a, b } = await voicePair(sig)
  // --configs=red+fec,red,fec,none  --losses=5,10,5b3 (b = mean burst)  --reps=N  --protection-key=protection
  const configs = arg('configs', 'red+fec,fec,red,none').split(',').map((c) => ({ red: c.includes('red'), fec: c.includes('fec') }))
  const losses = arg('losses', '5,10,5b3').split(',').map((x) => x.split('b').map(Number)).map(([l, b]) => [l, b || 1])
  const reps = Number(arg('reps', 1))
  const key = arg('protection-key', 'protection')
  results[key] = { when: new Date().toISOString(), note: 'RTT 50 ms sem jitter; perda só no uplink; A sai e entra para renegociar', seconds: SECONDS, runs: [] }
  try {
    for (let rep = 0; rep < reps; rep++) for (const cfg of configs) {
      // RED goes through the engine (the SFU must know the track's codec); FEC through the SFU's answer.
      await ev(a, (f) => window.__mediaLab.setLabSdp(f), { fec: cfg.fec })
      // A quick leave+join with the same identity sometimes comes back with the SFU answering the mic as
      // "stereo=1" without usedtx (measured, intermittent). DTX changes the jitter buffer, so retry until the
      // product's negotiation (usedtx=1) is in place and record how many joins it took.
      let codecs = []
      let joins = 0
      do {
        await leave(a)
        await sleep(1500)
        await ev(a, ({ url, token, red }) => window.__mediaLab.media.join({ url, token, bitrateKbps: 64, channelId: 'lab', red }), { url: L.LK_URL, token: a.token, red: cfg.red })
        joins++
        await sleep(3000)
        codecs = (await sender(a)).codecs ?? []
      } while (!codecs.some((c) => /opus/i.test(c) && /usedtx=1/.test(c)) && joins < 5)
      cfg.joins = joins
      const hasRed = /audio\/red/i.test(codecs[0] ?? '') // the send codec is the first negotiated one
      const fecOn = codecs.some((c) => /opus/i.test(c) && /useinbandfec=1/.test(c))
      // Assert the munging took effect before measuring anything.
      const flowing = (await inbound(b))?.packetsReceived > 0
      if (hasRed !== cfg.red || fecOn !== cfg.fec || !flowing) throw new Error(`protection override not applied: ${JSON.stringify({ cfg, codecs })}`)
      for (const [loss, burst] of losses) {
        profile({ delay: 25, loss, burst }, { delay: 25 })
        await sleep(6000)
        const m = await voiceWindow(a, b, SECONDS)
        results[key].runs.push({ ...cfg, rep, lossPct: loss, burst, ...m })
        log(`protection red=${cfg.red} fec=${cfg.fec} loss=${loss} burst=${burst}`, JSON.stringify(m))
        save()
      }
    }
  } finally {
    await ev(a, () => window.__mediaLab.setLabSdp(null)).catch(() => undefined)
    proxy.reset()
    await close(a)
    await close(b)
  }
}

// ─────────────── screen share ───────────────
let patternWin = null
/** 1920x1080 moving pattern in a normal window pushed to the bottom of the z-order (owner's screen stays usable). */
async function startPattern1080() {
  const { spawn } = await import('node:child_process')
  patternWin = spawn('ffplay', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=60', '-x', '1920', '-y', '1080', '-left', '0', '-top', '0', '-noborder', '-an', '-window_title', 'AlgaPattern1080'], { stdio: 'ignore' })
  L.children.add(patternWin)
  await sleep(1500)
  const ps = `Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr h, System.IntPtr a, int x, int y, int cx, int cy, uint f);'
$p = Get-Process -Id ${patternWin.pid} -ErrorAction SilentlyContinue
if ($p) { [W.U]::SetWindowPos($p.MainWindowHandle, [System.IntPtr]1, 0, 0, 0, 0, 0x13) | Out-Null }`
  spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' })
}
function stopPattern1080() {
  if (!patternWin) return
  L.killTree(patternWin.pid)
  L.children.delete(patternWin)
  patternWin = null
}

/** B's decoded frames of A's screen, sampled every 200 ms; plus A's top-layer view. */
async function screenTimeline(a, b, ms, onTick) {
  const out = []
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const t = Date.now() - t0
    const [rb, sa] = await Promise.all([
      ev(b, async () => (await window.__mediaLab.rawStats({ remote: 'lab-a', source: 'screen' })).find((s) => s.type === 'inbound-rtp')),
      state(a).then((s) => s.screen.stats).catch(() => null),
    ])
    out.push({ t, framesDecoded: rb?.framesDecoded ?? 0, w: rb?.frameWidth ?? 0, h: rb?.frameHeight ?? 0, bytes: rb?.bytesReceived ?? 0, freezes: rb?.freezeCount ?? 0, freezeMs: (rb?.totalFreezesDuration ?? 0) * 1000, top: sa?.layers?.[0] ? `${sa.layers[0].width}x${sa.layers[0].height}@${Math.round(sa.layers[0].fps)}` : null, limit: sa?.layers?.[0]?.qualityLimitationReason ?? null, sendKbps: Math.round(sa?.bitrateKbps ?? 0) })
    await onTick?.(t)
    await sleep(200)
  }
  return out
}
function summarize(tl) {
  if (tl.length < 3) return null
  const span = (tl.at(-1).t - tl[0].t) / 1000
  const fps = (tl.at(-1).framesDecoded - tl[0].framesDecoded) / span
  const kbps = ((tl.at(-1).bytes - tl[0].bytes) * 8) / span / 1000
  const res = Object.entries(tl.reduce((m, s) => ((m[`${s.w}x${s.h}`] = (m[`${s.w}x${s.h}`] ?? 0) + 1), m), {})).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} (${Math.round((100 * n) / tl.length)} %)`)
  return { fps: r1(fps), kbps: Math.round(kbps), res, freezes: tl.at(-1).freezes - tl[0].freezes, freezeMs: Math.round(tl.at(-1).freezeMs - tl[0].freezeMs), senderTop: [...new Set(tl.map((s) => s.top))].slice(0, 6), limitation: [...new Set(tl.map((s) => s.limit))] }
}
/** First moment after `from` (ms) where the decoded fps over 400 ms is back to >= 80 % of `refFps` for 1 s. */
function recovery(tl, from, refFps) {
  for (let i = 0; i < tl.length; i++) {
    if (tl[i].t < from) continue
    const win = (j) => {
      const k = tl.findIndex((s) => s.t >= tl[j].t + 400)
      return k < 0 ? null : ((tl[k].framesDecoded - tl[j].framesDecoded) * 1000) / (tl[k].t - tl[j].t)
    }
    const ok = (j) => (win(j) ?? 0) >= 0.8 * refFps
    const end = tl.findIndex((s) => s.t >= tl[i].t + 1000)
    if (end < 0) return null
    let all = true
    for (let j = i; j <= end; j++) if (!ok(j)) all = false
    if (all) return tl[i].t - from
  }
  return null
}

async function phaseScreen(sig) {
  await startPattern1080()
  const a = await launch('lab-a', sig.silence, [], false)
  const b = await launch('lab-b', sig.silence, [], true)
  a.token = await token('lab-a')
  b.token = await token('lab-b')
  results.screen = { when: new Date().toISOString(), source: 'janela ffplay testsrc2 1920x1080@60 (atrás das outras janelas), codec automático, espectador em Original (camada alta)', runs: [] }
  try {
    await Promise.all([gotoLab(a), gotoLab(b)])
    await join_(b)
    await join_(a, false)
    await sleep(2000)
    const sourceId = await ev(a, async () => (await window.__mediaLab.media.getScreenSources()).find((s) => s.kind === 'window' && s.name.includes('AlgaPattern1080'))?.id ?? null)
    if (!sourceId) throw new Error('1080p pattern window not found')
    for (const quality of ['1080p30', '1080p60']) {
      await ev(a, (o) => window.__mediaLab.media.startScreenShare(o), { sourceId, audio: false, quality })
      await sleep(800)
      // 'source' pins the top layer: what a full-screen viewer asks for, and where adaptation shows.
      await ev(b, () => window.__mediaLab.media.watch('lab-a', 'source'))
      const conditions = [
        { name: 'limpo (RTT 0)', up: {}, down: {} },
        { name: 'RTT 150 ± 30 ms, 2 % perda', up: { delay: 75, jitter: 15, loss: 2 }, down: { delay: 75, jitter: 15, loss: 2 } },
        { name: 'uplink do transmissor limitado a 3 Mbit/s (RTT 50)', up: { delay: 25, rate: 3000, queue: 300 }, down: { delay: 25 } },
      ]
      for (const c of conditions) {
        profile(c.up, c.down)
        await sleep(c.name.startsWith('limpo') ? 10_000 : 8000) // estimator ramp / adaptation
        const tl = await screenTimeline(a, b, 20_000)
        const s = summarize(tl)
        results.screen.runs.push({ quality, condition: c.name, ...s })
        log(`screen ${quality} ${c.name}`, JSON.stringify(s))
        save()
      }
      // 3 s of 100 % loss both ways (RTT 50), then measure how long until B decodes at >= 80 % of the fps before.
      profile({ delay: 25 }, { delay: 25 })
      await sleep(8000)
      const outageAt = 5000
      const tl = await screenTimeline(a, b, 25_000, async (t) => {
        if (t >= outageAt && t < outageAt + 3000 && !proxy.profiles.up.outage) proxy.set('both', { outage: true })
        if (t >= outageAt + 3000 && proxy.profiles.up.outage) proxy.set('both', { outage: false })
      })
      const before = summarize(tl.filter((s) => s.t < outageAt))
      const rec = recovery(tl, outageAt + 3000, before?.fps ?? 0)
      const after = summarize(tl.filter((s) => s.t > outageAt + 3000 + (rec ?? 0)))
      results.screen.runs.push({ quality, condition: 'queda de 3 s (100 % perda nos dois sentidos), RTT 50', fpsBefore: before?.fps, recoveryMsAfterOutage: rec, freezesInWindow: tl.at(-1).freezes - tl[0].freezes, after, timeline: tl.map((s) => [s.t, s.framesDecoded, s.w]) })
      log(`screen ${quality} outage: recovery ${rec} ms after the link came back (fps before ${before?.fps})`)
      save()
      proxy.reset()
      await ev(b, () => window.__mediaLab.media.unwatch('lab-a'))
      await ev(a, () => window.__mediaLab.media.stopScreenShare())
      await sleep(1500)
    }
  } finally {
    proxy.reset()
    stopPattern1080()
    await close(a)
    await close(b)
  }
}

// ─────────────── uplink cap: the downswitch freeze, stall guard off vs on ───────────────
/** Longest run (ms) without a new decoded frame in a 200 ms timeline, and when it started. */
function longestGap(tl) {
  let best = { ms: 0, at: null }
  let since = tl[0]
  for (const s of tl) {
    if (s.framesDecoded > since.framesDecoded) since = s
    else if (s.t - since.t > best.ms) best = { ms: s.t - since.t, at: since.t }
  }
  return best
}
async function phaseUplink(sig) {
  const REPS = Number(arg('reps', 2))
  await startPattern1080()
  const a = await launch('lab-a', sig.silence, [], false)
  const b = await launch('lab-b', sig.silence, [], true)
  a.token = await token('lab-a')
  b.token = await token('lab-b')
  // Appends (--fresh to restart): repetitions of this phase accumulate across runs.
  if (!results.uplink?.runs || process.argv.includes('--fresh')) results.uplink = { method: 'janela 1920x1080@60, B em Original; 6 s de rede limpa, depois a subida de A cai para 3 Mbit/s (RTT 50, fila 300 ms) e B é medido por 30 s', runs: [] }
  results.uplink.when = new Date().toISOString()
  const rep0 = Math.max(-1, ...results.uplink.runs.map((r) => r.rep)) + 1
  try {
    await Promise.all([gotoLab(a), gotoLab(b)])
    await join_(b)
    await join_(a, false)
    await sleep(2000)
    const sourceId = await ev(a, async () => (await window.__mediaLab.media.getScreenSources()).find((s) => s.kind === 'window' && s.name.includes('AlgaPattern1080'))?.id ?? null)
    if (!sourceId) throw new Error('1080p pattern window not found')
    for (let rep = rep0; rep < rep0 + REPS; rep++) {
      for (const guard of [false, true]) {
        for (const quality of ['1080p30', '1080p60']) {
          proxy.reset()
          await ev(b, (on) => { window.__mediaLab.media.stallGuard = on }, guard)
          await ev(a, (o) => window.__mediaLab.media.startScreenShare(o), { sourceId, audio: false, quality })
          await sleep(800)
          await ev(b, () => window.__mediaLab.media.watch('lab-a', 'source'))
          await sleep(6000)
          profile({ delay: 25, rate: 3000, queue: 300 }, { delay: 25 })
          const tl = await screenTimeline(a, b, 30_000)
          const s = summarize(tl)
          const gap = longestGap(tl)
          const run = { rep, guard, quality, ...s, longestGapMs: gap.ms, longestGapAt: gap.at, timeline: tl.map((x) => [x.t, x.framesDecoded, x.w, x.top, x.limit]) }
          results.uplink.runs.push(run)
          log(`uplink ${quality} guard=${guard} rep ${rep}`, JSON.stringify({ fps: s.fps, res: s.res, freezes: s.freezes, freezeMs: s.freezeMs, longestGapMs: gap.ms, at: gap.at }))
          save()
          await ev(b, () => window.__mediaLab.media.unwatch('lab-a'))
          await ev(a, () => window.__mediaLab.media.stopScreenShare())
          proxy.reset()
          await sleep(3000)
        }
      }
    }
  } finally {
    proxy.reset()
    stopPattern1080()
    await close(a)
    await close(b)
  }
}

// ─────────────── preset viability (720p60 among its neighbours), HW HEVC vs software H.264 ───────────────
async function phasePresets(sig) {
  await startPattern1080()
  const a = await launch('lab-a', sig.silence, [], false)
  const b = await launch('lab-b', sig.silence, [], true)
  a.token = await token('lab-a')
  b.token = await token('lab-b')
  results.presets = { note: 'h265 = NVENC (HW); h264 = OpenH264 (software)', when: new Date().toISOString(), method: 'janela 1920x1080@60 (ffplay atrás das outras), rede limpa pelo proxy, B em Original; 10 s de rampa e 15 s de medição (1 amostra/s)', runs: [] }
  try {
    await Promise.all([gotoLab(a), gotoLab(b)])
    await join_(b)
    await join_(a, false)
    await sleep(2000)
    const sourceId = await ev(a, async () => (await window.__mediaLab.media.getScreenSources()).find((s) => s.kind === 'window' && s.name.includes('AlgaPattern1080'))?.id ?? null)
    if (!sourceId) throw new Error('1080p pattern window not found')
    for (const codec of ['h265', 'h264']) {
      // Measure the encoder, not the gate: empty sustain record, and the probe answers for the codec under test.
      await ev(a, (c) => {
        window.__mediaLab.media.debug.prefs.set({ encoderSustain: {} })
        window.__mediaLab.media.setScreenDefaults({ codec: c })
      }, codec)
      await sleep(1000)
      for (const quality of ['720p30', '720p60', '1080p30', '1080p60']) {
        proxy.reset()
        await ev(a, (o) => window.__mediaLab.media.startScreenShare(o), { sourceId, audio: false, quality, codec, contentType: 'motion' })
        await sleep(800)
        await ev(b, () => window.__mediaLab.media.watch('lab-a', 'source'))
        await sleep(10_000)
        const stop = L.sampler([a, b])
        const send = []
        const recv = []
        for (let i = 0; i < 15; i++) {
          const [sa, sb] = await Promise.all([state(a), state(b)])
          const top = sa.screen.stats?.layers?.slice().sort((x, y) => y.width - x.width)[0]
          if (top) send.push(top)
          const v = sb.viewers['lab-a']?.stats
          if (v) recv.push(v)
          await sleep(1000)
        }
        const cpu = await stop()
        const st = await state(a)
        const med = (xs) => r1(L.median(xs))
        const run = {
          codec, quality, published: st.screen.preset,
          sendTop: { res: [...new Set(send.map((l) => `${l.width}x${l.height}`))], fps: med(send.map((l) => l.fps)), kbps: Math.round(L.median(send.map((l) => l.bitrateKbps))), encoder: [...new Set(send.map((l) => l.encoderImplementation))], hw: [...new Set(send.map((l) => l.powerEfficientEncoder))], limitation: [...new Set(send.map((l) => l.qualityLimitationReason))] },
          recv: { res: [...new Set(recv.map((v) => `${v.width}x${v.height}`))], fps: med(recv.map((v) => v.fps)), freezes: recv.at(-1)?.freezeCount ?? null },
          cpu,
        }
        results.presets.runs.push(run)
        log(`preset ${codec} ${quality}`, JSON.stringify({ sendTop: run.sendTop, recv: run.recv }))
        save()
        await ev(b, () => window.__mediaLab.media.unwatch('lab-a'))
        await ev(a, () => window.__mediaLab.media.stopScreenShare())
        await sleep(2000)
      }
    }
    await ev(a, () => window.__mediaLab.media.setScreenDefaults({ codec: null }))
  } finally {
    stopPattern1080()
    await close(a)
    await close(b)
  }
}

// ─────────────── leave + join right away: does the mic keep DTX? ───────────────
async function phaseRejoin(sig) {
  const N = Number(arg('reps', 12))
  // --red=false: plain Opus, the configuration of the cell where the SFU once answered stereo=1 without usedtx (§2).
  const red = arg('red', 'true') !== 'false'
  const joinA = () => ev(a, ({ url, token, red }) => window.__mediaLab.media.join({ url, token, bitrateKbps: 64, channelId: 'lab', red }), { url: L.LK_URL, token: a.token, red })
  const a = await launch('lab-a', sig.silence)
  const b = await launch('lab-b', sig.silence)
  a.token = await token('lab-a')
  b.token = await token('lab-b')
  results.rejoin ??= { method: 'A (microfone em silêncio) sai e entra na mesma sala; 2,5 s depois, pacotes/s do microfone por 2 s (DTX ≈ 5/s, sem DTX 50/s) e a linha fmtp do Opus na resposta do SFU', runs: [] }
  results.rejoin.when = new Date().toISOString()
  try {
    await Promise.all([gotoLab(a), gotoLab(b)])
    await join_(b)
    await joinA()
    await sleep(3000)
    for (const pause of [0, 1500]) {
      for (let i = 0; i < N; i++) {
        await leave(a)
        if (pause) await sleep(pause)
        await joinA()
        await sleep(Number(arg('settle', 2500)))
        const [s0, i0] = [await sender(a), await inbound(b)]
        await sleep(2000)
        const [s1, i1] = [await sender(a), await inbound(b)]
        const heardPps = r1(((i1?.packetsReceived ?? 0) - (i0?.packetsReceived ?? 0)) / 2)
        const pps = r1(((s1.packetsSent - s0.packetsSent) * 1000) / Math.max(1, s1.t - s0.t))
        const sdp = await ev(a, () => window.__mediaLab.publisherSdpAudio())
        const answerOpus = sdp.answer.filter((l) => /^a=fmtp:/.test(l))
        const repairs = await ev(a, () => window.__mediaLab.media.debug.dtxRepairs ?? null)
        const run = { red, pause, i, pps, heardPps, dtx: pps < 20, repairs, sendFmtp: s1.codecs, answerFmtp: [...new Set(answerOpus)] }
        results.rejoin.runs.push(run)
        log(`rejoin red=${red} pause=${pause} #${i}: ${pps} pkt/s sent, ${heardPps} heard by B, repairs so far ${repairs}`, JSON.stringify([...new Set(answerOpus)]))
        save()
      }
    }
  } finally {
    await close(a)
    await close(b)
  }
}

// ─────────────── main ───────────────
try {
  if (!process.argv.includes('--no-build')) {
    const r = spawnSync('npm', ['run', 'build', '-w', 'apps/desktop'], { cwd: repo, stdio: 'inherit', shell: true })
    if (r.status !== 0) throw new Error('build failed')
  }
  const sig = L.makeSignals()
  proxy = await createImpairProxy({ listen: { host: PROXY_IP, port: UDP_PORT }, target: { host: SFU_IP, port: UDP_PORT }, upstreamHost: SFU_IP, seed: 42 })
  await L.startLiveKit()
  results.env = { proxy: 'scripts/netem/udp-impair.mjs (Node dgram, por cliente, sem reordenação)', sfu: `LiveKit lab, ICE-lite, UDP mux ${SFU_IP}:${UDP_PORT} (só essa IP), node_ip ${PROXY_IP} (o proxy), tcp_port 0`, when: new Date().toISOString() }
  if (phases.includes('voice')) await phaseVoice(sig)
  if (phases.includes('protection')) await phaseProtection(sig)
  if (phases.includes('screen')) await phaseScreen(sig)
  if (phases.includes('uplink')) await phaseUplink(sig)
  if (phases.includes('rejoin')) await phaseRejoin(sig)
  if (phases.includes('presets')) await phasePresets(sig)
  results.proxyTotals = proxy.stats()
  save()
  log('done →', outJson)
} catch (e) {
  log("proxy at failure", JSON.stringify(proxy?.stats()))
  console.error(e)
  process.exitCode = 1
} finally {
  stopPattern1080()
  await proxy?.close()
  await cleanup()
}
