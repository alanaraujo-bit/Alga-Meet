// Measurement helpers for MediaLab / scripts/media-lab.mjs (dev only; not part of the UI contract).
import { Track } from 'livekit-client'
import { setApiToken } from '@/lib/api'
import { voiceJoin } from '@/store/actions'
import { useSession } from '@/store/session'
import { media } from './engine'
import { useMedia } from './store'

// ── E2EE lab (scripts/media-e2ee.mjs): a signed-in instance joining like the app does ──

/** Session token in (main starts its E2EE device on it), gateway up, READY received, E2EE device ready. */
export async function signIn(token: string): Promise<void> {
  await window.alga.auth.setToken(token)
  setApiToken(token)
  await useSession.getState().boot()
  const t0 = performance.now()
  while (!useSession.getState().hydrated || (await window.alga.e2ee.status()).state !== 'ready') {
    if (performance.now() - t0 > 20_000) throw new Error(`not ready: gateway ${useSession.getState().gateway}, e2ee ${(await window.alga.e2ee.status()).state}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

/** POST /voice/join + media.join (features/voice does the same). `e2ee: false` = baseline with E2EE off. */
export async function joinChannel(channelId: string, o: { e2ee?: boolean; publishMic?: boolean; red?: boolean } = {}) {
  media.labNoE2ee = o.e2ee === false
  const t0 = performance.now()
  let e2eeMs: number | null = null
  const off = useMedia.subscribe((s) => {
    if (e2eeMs === null && s.e2ee.state === 'active') e2eeMs = Math.round(performance.now() - t0)
  })
  try {
    const res = await voiceJoin(channelId)
    await media.join({ ...res, channelId, publishMic: o.publishMic, red: o.red, refresh: () => voiceJoin(channelId) })
  } finally {
    off()
  }
  return { joinMs: useMedia.getState().connection.joinMs, e2eeMs }
}

/** epochNow() of the first received audio of `identity` above `thresholdDb` (waits for the track), null on timeout. */
export async function firstAudio(identity: string, thresholdDb: number, timeoutMs: number): Promise<number | null> {
  const t0 = performance.now()
  let track: MediaStreamTrack | undefined
  while (!(track = remoteMic(identity))) {
    if (performance.now() - t0 > timeoutMs) return null
    await new Promise((r) => setTimeout(r, 2))
  }
  const ctx = new AudioContext({ sinkId: { type: 'none' } } as AudioContextOptions)
  const an = ctx.createAnalyser()
  an.fftSize = 256
  ctx.createMediaStreamSource(new MediaStream([track])).connect(an)
  const buf = new Float32Array(an.fftSize)
  try {
    while (performance.now() - t0 < timeoutMs) {
      an.getFloatTimeDomainData(buf)
      let peak = 0
      for (const v of buf) peak = Math.max(peak, Math.abs(v))
      if (20 * Math.log10(peak || 1e-9) > thresholdDb) return epochNow()
      await new Promise((r) => setTimeout(r, 2))
    }
    return null
  } finally {
    void ctx.close()
  }
}

/** Frames per second the live screen capture delivers (before the encoder), over `ms`. */
export async function captureFps(ms = 2000): Promise<number | null> {
  const t = media.debug.screen?.video.track?.mediaStreamTrack
  const P = (window as unknown as { MediaStreamTrackProcessor?: new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<{ close(): void }> } }).MediaStreamTrackProcessor
  if (!t || !P) return null
  const clone = t.clone()
  const rd = new P({ track: clone }).readable.getReader()
  let n = 0
  const t0 = performance.now()
  try {
    while (performance.now() - t0 < ms) {
      const r = await Promise.race([rd.read(), new Promise<null>((res) => setTimeout(() => res(null), 500))])
      if (r?.value) (r.value.close(), n++)
    }
  } finally {
    void rd.cancel().catch(() => undefined)
    clone.stop()
  }
  return Math.round((n * 1000) / (performance.now() - t0))
}

/**
 * Pace of the live screen capture over `ms` (scripts/media-game.mjs): frames delivered, distinct source frames (the
 * test game draws its frame index as 16 64-px blocks at the top-left of a `srcWidth`-px wide source) and intervals.
 */
export async function capturePace(ms: number, srcWidth: number) {
  type Frame = { displayWidth: number; codedWidth: number; format: string; close(): void; copyTo(b: Uint8Array, o: object): Promise<{ offset: number }[]> }
  const t = media.debug.screen?.video.track?.mediaStreamTrack
  const P = (window as unknown as { MediaStreamTrackProcessor?: new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<Frame> } }).MediaStreamTrackProcessor
  if (!t || !P) return null
  const clone = t.clone()
  const rd = new P({ track: clone }).readable.getReader()
  const ts: number[] = []
  const ids: number[] = []
  const t0 = performance.now()
  try {
    while (performance.now() - t0 < ms) {
      const r = await Promise.race([rd.read(), new Promise<null>((res) => setTimeout(() => res(null), 500))])
      const f = r?.value
      if (!f) continue
      ts.push(performance.now())
      const sc = f.displayWidth / srcWidth
      const w = Math.min(f.codedWidth, (Math.round(1024 * sc) + 1) & ~1)
      const buf = new Uint8Array(w * 16)
      const bpp = /^(I4|NV)/.test(f.format) ? 1 : 4
      const lay = await f.copyTo(buf, { rect: { x: 0, y: Math.round(32 * sc) & ~1, width: w, height: 2 } }).catch(() => null)
      let id = 0
      for (let i = 0; lay && i < 16; i++) if ((buf[lay[0]!.offset + Math.round((32 + 64 * i) * sc) * bpp + (bpp === 4 ? 1 : 0)] ?? 0) > 128) id |= 1 << i
      ids.push(id)
      f.close()
    }
  } finally {
    void rd.cancel().catch(() => undefined)
    clone.stop()
  }
  const dt = ts.slice(1).map((x, i) => x - ts[i]!)
  const s = (ts.at(-1)! - ts[0]!) / 1000 || 1
  const sorted = [...dt].sort((a, b) => a - b)
  return {
    fps: Math.round((10 * dt.length) / s) / 10,
    uniqueFps: Math.round((10 * ids.slice(1).filter((v, i) => v !== ids[i]).length) / s) / 10,
    intervalMs: { p50: sorted[Math.floor(sorted.length / 2)] ?? null, p95: sorted[Math.floor(sorted.length * 0.95)] ?? null },
    settings: t.getSettings(),
  }
}

/** Is `identity`'s screen track subscribed with adaptive stream (resolution follows the element)? */
export const screenAdaptive = (identity: string): boolean | null => {
  const pub = [...(media.debug.room?.remoteParticipants.get(identity)?.trackPublications.values() ?? [])].filter((p) => p.source === Track.Source.ScreenShare).pop()
  return pub?.track ? (pub.track as unknown as { isAdaptiveStream: boolean }).isAdaptiveStream : null
}

/** Wall-clock ms with sub-ms resolution, comparable across processes on the same machine. */
export const epochNow = (): number => performance.timeOrigin + performance.now()

// Leak accounting: weak registries of every capture track, AudioContext and PeerConnection the page creates.
// Installed when MediaLab loads (before any join), so engine and LiveKit objects are all seen.
const reg = { tracks: new Set<WeakRef<MediaStreamTrack>>(), ctxs: new Set<WeakRef<BaseAudioContext>>(), pcs: new Set<WeakRef<RTCPeerConnection>>() }
const keep = <T extends object>(set: Set<WeakRef<T>>, o: T): T => (set.add(new WeakRef(o)), o)
const keepStream = (s: MediaStream): MediaStream => (s.getTracks().forEach((t) => keep(reg.tracks, t)), s)
export function instrument(): void {
  const w = window as unknown as { __labInstrumented?: boolean }
  if (w.__labInstrumented) return
  w.__labInstrumented = true
  const md = MediaDevices.prototype
  const gum = md.getUserMedia
  md.getUserMedia = async function (c) {
    return keepStream(await gum.call(this, c))
  }
  const gdm = md.getDisplayMedia
  md.getDisplayMedia = async function (c) {
    return keepStream(await gdm.call(this, c))
  }
  const dest = AudioContext.prototype.createMediaStreamDestination
  AudioContext.prototype.createMediaStreamDestination = function () {
    const d = dest.call(this)
    keepStream(d.stream)
    return d
  }
  const clone = MediaStreamTrack.prototype.clone
  MediaStreamTrack.prototype.clone = function () {
    return keep(reg.tracks, clone.call(this))
  }
  const cap = HTMLCanvasElement.prototype.captureStream
  HTMLCanvasElement.prototype.captureStream = function (fps) {
    return keepStream(cap.call(this, fps))
  }
  const AC = window.AudioContext
  window.AudioContext = class extends AC {
    constructor(o?: AudioContextOptions) {
      super(o)
      keep(reg.ctxs, this)
    }
  }
  const PC = window.RTCPeerConnection
  window.RTCPeerConnection = class extends PC {
    constructor(c?: RTCConfiguration) {
      super(c)
      keep(reg.pcs, this)
    }
  } as typeof RTCPeerConnection
  // FEC A/B (scripts/media-net.mjs): rewrite the SFU's answer to our publisher offer. RED can't be done this
  // way (the SFU drops plain Opus on a track published as RED: measured), so it goes through JoinParams.red.
  const srd = PC.prototype.setRemoteDescription as (this: RTCPeerConnection, d?: RTCSessionDescriptionInit) => Promise<void>
  PC.prototype.setRemoteDescription = function (this: RTCPeerConnection, d?: RTCSessionDescriptionInit) {
    const noFec = labSdp?.fec === false && d?.type === 'answer' && d.sdp
    return srd.call(this, noFec ? { type: d.type, sdp: d.sdp!.replace(/useinbandfec=1/g, 'useinbandfec=0') } : d)
  } as typeof PC.prototype.setRemoteDescription
}

/** Lab-only: fec:false answers useinbandfec=0 (Opus encoder FEC off) at the next publisher negotiation. */
let labSdp: { fec?: boolean } | null = null
export const setLabSdp = (f: { fec?: boolean } | null): void => void (labSdp = f)

/** Open RTCPeerConnections of this page (publisher + subscriber), for transceiver/stats inspection. */
export const peerConnections = (): RTCPeerConnection[] => [...reg.pcs].map((r) => r.deref()).filter((p): p is RTCPeerConnection => !!p && p.connectionState !== 'closed')

/** Every video outbound-rtp the page's PCs still report (a live send stream = an encoder that still exists). */
export async function videoSendStreams() {
  const out: Array<{ ssrc: unknown; rid: unknown; mid: unknown; encoder: unknown; frames: unknown; active: unknown }> = []
  for (const pc of peerConnections()) {
    ;(await pc.getStats()).forEach((s: Record<string, unknown>) => {
      if (s.type === 'outbound-rtp' && s.kind === 'video') out.push({ ssrc: s.ssrc, rid: s.rid, mid: s.mid, encoder: s.encoderImplementation, frames: s.framesEncoded, active: s.active })
    })
  }
  return out
}

/** Live (not stopped / closed / collected) media objects right now. Call after gc() for a fair count. */
export function counters() {
  const live = <T extends object>(set: Set<WeakRef<T>>, alive: (o: T) => boolean) => {
    let n = 0
    for (const r of set) {
      const o = r.deref()
      if (!o) set.delete(r)
      else if (alive(o)) n++
    }
    return n
  }
  const pcs = peerConnections()
  return {
    liveTracks: live(reg.tracks, (t) => t.readyState === 'live'),
    liveTracksByKind: [...reg.tracks].map((r) => r.deref()).filter((t) => t?.readyState === 'live').map((t) => `${t!.kind}:${t!.label.slice(0, 24)}`),
    audioContexts: live(reg.ctxs, (c) => c.state !== 'closed'),
    peerConnections: pcs.length,
    transceivers: pcs.reduce((n, p) => n + p.getTransceivers().length, 0),
    sendersWithTrack: pcs.reduce((n, p) => n + p.getSenders().filter((s) => s.track).length, 0),
    mediaElements: document.querySelectorAll('video, audio').length,
    attachedVideoTracks: [...document.querySelectorAll('video')].filter((v) => v.srcObject).length,
  }
}

/**
 * Detects sound onsets on a track: first sample above `thresholdDb` after >= `quietMs` of quiet.
 * The analyser window lets us locate the onset sample inside it, so precision is ~1 render quantum, not the poll period.
 */
export class OnsetProbe {
  readonly onsets: number[] = []
  private ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive', sinkId: { type: 'none' } } as AudioContextOptions)
  private analyser = this.ctx.createAnalyser()
  private buf: Float32Array<ArrayBuffer>
  private timer: ReturnType<typeof setInterval> | null = null
  private armed = true
  private quietSince = 0
  private src: MediaStreamAudioSourceNode

  constructor(track: MediaStreamTrack, private thresholdDb = -30, private quietMs = 250) {
    this.analyser.fftSize = 2048
    this.buf = new Float32Array(this.analyser.fftSize)
    this.src = this.ctx.createMediaStreamSource(new MediaStream([track]))
    this.src.connect(this.analyser)
  }

  start(): this {
    void this.ctx.resume()
    const thr = 10 ** (this.thresholdDb / 20)
    this.timer = setInterval(() => {
      const now = epochNow()
      this.analyser.getFloatTimeDomainData(this.buf)
      const n = this.buf.length
      let first = -1
      let peak = 0
      for (let i = 0; i < n; i++) {
        const a = Math.abs(this.buf[i]!)
        if (a > peak) peak = a
        if (first < 0 && a > thr) first = i
      }
      if (peak < thr) {
        if (this.quietSince === 0) this.quietSince = now
        if (now - this.quietSince >= this.quietMs) this.armed = true
        return
      }
      this.quietSince = 0
      if (!this.armed) return
      this.armed = false
      this.onsets.push(now - ((n - first) / this.ctx.sampleRate) * 1000)
    }, 2)
    return this
  }

  stop(): number[] {
    if (this.timer) clearInterval(this.timer)
    this.src.disconnect()
    void this.ctx.close()
    return this.onsets
  }
}

/** Frame pacing on the receiving <video>, via requestVideoFrameCallback. */
export function frameTimes(el: HTMLVideoElement, ms: number) {
  return new Promise<{ frames: number; fps: number; meanMs: number; stdevMs: number; p95Ms: number; p99Ms: number; maxMs: number; skipped: number; width: number; height: number }>((resolve) => {
    const deltas: number[] = []
    let last = 0
    let lastPresented = 0
    let skipped = 0
    const t0 = performance.now()
    const step = (now: number, meta: VideoFrameCallbackMetadata) => {
      if (last) deltas.push(now - last)
      if (lastPresented && meta.presentedFrames - lastPresented > 1) skipped += meta.presentedFrames - lastPresented - 1
      last = now
      lastPresented = meta.presentedFrames
      if (performance.now() - t0 < ms) el.requestVideoFrameCallback(step)
      else {
        const s = [...deltas].sort((a, b) => a - b)
        const mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)
        const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, s.length))
        const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0
        resolve({ frames: s.length + 1, fps: 1000 / mean, meanMs: mean, stdevMs: sd, p95Ms: q(0.95), p99Ms: q(0.99), maxMs: s[s.length - 1] ?? 0, skipped, width: el.videoWidth, height: el.videoHeight })
      }
    }
    el.requestVideoFrameCallback(step)
  })
}

/** What the WebRTC stack says it can encode/decode, and whether it's hardware (powerEfficient). */
export async function codecProbe() {
  const sizes = [
    { width: 1920, height: 1080, framerate: 60 },
    { width: 2560, height: 1440, framerate: 60 },
    { width: 3840, height: 2160, framerate: 30 },
  ]
  const out: Record<string, unknown> = {
    send: RTCRtpSender.getCapabilities('video')?.codecs.map((c) => `${c.mimeType} ${c.sdpFmtpLine ?? ''}`.trim()),
    recv: RTCRtpReceiver.getCapabilities('video')?.codecs.map((c) => `${c.mimeType} ${c.sdpFmtpLine ?? ''}`.trim()),
  }
  for (const mime of ['video/H264', 'video/VP8', 'video/VP9', 'video/AV1', 'video/H265']) {
    for (const s of sizes) {
      const key = `${mime} ${s.width}x${s.height}@${s.framerate}`
      try {
        const e = await navigator.mediaCapabilities.encodingInfo({ type: 'webrtc', video: { contentType: mime, ...s, bitrate: 10_000_000 } })
        const d = await navigator.mediaCapabilities.decodingInfo({ type: 'webrtc', video: { contentType: mime, ...s, bitrate: 10_000_000 } })
        out[key] = { encode: { supported: e.supported, smooth: e.smooth, powerEfficient: e.powerEfficient }, decode: { supported: d.supported, smooth: d.smooth, powerEfficient: d.powerEfficient } }
      } catch (err) {
        out[key] = String(err)
      }
    }
  }
  return out
}

export const localRawMic = (): MediaStreamTrack | undefined => media.debug.mic?.mediaStreamTrack
export const remoteMic = (identity: string): MediaStreamTrack | undefined =>
  media.debug.room?.remoteParticipants.get(identity)?.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack

/** Negotiated Opus/RED parameters straight from the RTP sender (what the SDP agreed on). */
export function micSenderParams() {
  const p = media.debug.mic?.sender?.getParameters()
  return p ? { codecs: p.codecs?.map((c) => ({ mimeType: c.mimeType, clockRate: c.clockRate, channels: c.channels, sdpFmtpLine: c.sdpFmtpLine })), encodings: p.encodings } : null
}

/** Opus/RED lines of the publisher offer (ours) and answer (SFU): what was really negotiated. */
export function publisherSdpAudio() {
  const pub = (media.debug.room as unknown as { engine?: { pcManager?: { publisher?: { getLocalDescription(): RTCSessionDescription | undefined; getRemoteDescription(): RTCSessionDescription | undefined } } } })?.engine?.pcManager?.publisher
  const pick = (sdp?: string) => {
    const lines = sdp?.split(/\r?\n/) ?? []
    const pts = [...new Set(lines.map((l) => /^a=rtpmap:(\d+) (opus|red)\//i.exec(l)?.[1]).filter(Boolean))]
    return lines.filter((l) => pts.some((pt) => l.startsWith(`a=rtpmap:${pt} `) || l.startsWith(`a=fmtp:${pt} `)))
  }
  return { offer: pick(pub?.getLocalDescription()?.sdp), answer: pick(pub?.getRemoteDescription()?.sdp) }
}

export async function rawStats(kind: 'mic' | 'screen' | { remote: string; source: 'mic' | 'screen' }) {
  const d = media.debug
  const track =
    kind === 'mic'
      ? d.mic
      : kind === 'screen'
        ? d.screen?.video.track
        : d.room?.remoteParticipants.get(kind.remote)?.getTrackPublication(kind.source === 'mic' ? Track.Source.Microphone : Track.Source.ScreenShare)?.track
  const r = await track?.getRTCStatsReport()
  const list: Record<string, unknown>[] = []
  r?.forEach((s: Record<string, unknown>) => list.push(s))
  return list
}

/**
 * Moving synthetic "game-like" pattern at an exact size/fps (the monitor here is 1080p, so 1440p/4K
 * encoder tests need a source larger than the screen). Scrolling gradient + moving blocks + noise tile.
 */
export function syntheticScreen(width: number, height: number, fps: number): MediaStream {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const g = c.getContext('2d', { alpha: false })!
  // Pre-rendered noise tiles drawn with drawImage (GPU); per-frame putImageData would cap the source at ~30 fps.
  const tiles = Array.from({ length: 4 }, () => {
    const t = document.createElement('canvas')
    t.width = t.height = 256
    const tg = t.getContext('2d')!
    const img = tg.createImageData(256, 256)
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = img.data[i + 1] = img.data[i + 2] = (Math.random() * 255) | 0
      img.data[i + 3] = 255
    }
    tg.putImageData(img, 0, 0)
    return t
  })
  let f = 0
  let last = 0
  const draw = (now: number) => {
    if (now - last >= 1000 / fps - 1) {
      last = now
      f++
      const grad = g.createLinearGradient((f * 8) % width, 0, ((f * 8) % width) + width, height)
      grad.addColorStop(0, `hsl(${f % 360} 70% 45%)`)
      grad.addColorStop(1, `hsl(${(f + 180) % 360} 70% 25%)`)
      g.fillStyle = grad
      g.fillRect(0, 0, width, height)
      for (let i = 0; i < 48; i++) {
        g.fillStyle = `hsl(${(i * 37 + f * 3) % 360} 80% 60%)`
        const x = (i * 211 + f * (4 + (i % 7))) % width
        const y = (i * 97 + f * (2 + (i % 5))) % height
        g.fillRect(x, y, width / 16, height / 12)
      }
      for (let i = 0; i < 4; i++) g.drawImage(tiles[(f + i) % 4]!, ((f * 13 + i * 400) % (width - 256)) | 0, ((i * 300 + f * 5) % (height - 256)) | 0)
      g.fillStyle = '#fff'
      g.font = `${height / 10}px monospace`
      g.fillText(String(f), width / 20, height / 6)
    }
    if (track.readyState === 'live') requestAnimationFrame(draw)
  }
  const stream = c.captureStream(fps)
  const track = stream.getVideoTracks()[0]!
  requestAnimationFrame(draw) // stops redrawing once the track is stopped (no orphan rAF loop per run)
  return stream
}
