// Opt-in call-quality telemetry: one aggregate CallQualityReport per voice session (packages/shared/src/telemetry.ts),
// built only from numbers the engine already shows in useMedia. No content, names or ids ever leave: every field is
// a number, a bucket or a version. Sent only while the user opted in (Me.telemetryOptIn), fire-and-forget.
import type { CallQualityReport } from '@alga/shared'
import { api } from '../lib/api'
import { useMedia, type MediaState } from './store'

type Fps = NonNullable<CallQualityReport['stream']>['fps']
type Res = NonNullable<CallQualityReport['stream']>['resolution']
export type Environment = Pick<CallQualityReport, 'os' | 'osVersion' | 'appVersion' | 'cpuVendor' | 'gpuVendor'>

const fpsBucket = (fps: number): Fps => (fps < 15 ? '0-14' : fps < 30 ? '15-29' : fps < 60 ? '30-59' : '60+')
const resBucket = (short: number): Res => (short < 720 ? 'sd' : short < 1080 ? '720p' : short < 1440 ? '1080p' : short < 2160 ? '1440p' : '2160p')
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const p95 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(0.95 * xs.length))]! : null)
const round = (v: number | null, max: number) => (v === null ? null : Math.min(max, Math.round(v * 10) / 10))
const mostUsed = <K extends string>(m: Map<K, number>): K | null => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

/**
 * One voice session, fed with useMedia snapshots (pure: unit-tested). It starts at the first `connected` after idle
 * and ends at `idle` (left, switched rooms) or at a `disconnected` with no retry left (terminal / gave up).
 * Automatic rejoins in between belong to the same session and count as reconnections.
 */
export class CallSession {
  private connectedAt: number | null = null
  private connectedMs = 0
  private joinMs: number | null = null
  private baseReconnects = 0
  private reconnects = 0
  private rejoins = 0
  private retrying = false
  private rtt: number[] = []
  private jitter: number[] = []
  private loss: number[] = []
  private conceal: number[] = []
  private audioCodec: CallQualityReport['audioCodec'] = null
  private videoCodec: CallQualityReport['videoCodec'] = null
  private hw: boolean | null = null
  private streamBuckets = new Map<string, number>()
  started = false

  /** Feed every state change; returns true when the session just ended (then call report()). */
  update(s: MediaState, prev: MediaState, now: number): boolean {
    const c = s.connection
    if (c.state === 'connected' && prev.connection.state !== 'connected') {
      if (!this.started) {
        this.started = true
        this.baseReconnects = c.reconnects
        this.joinMs = c.joinMs
      } else if (prev.connection.state === 'disconnected' || prev.connection.state === 'connecting') this.rejoins++
      this.connectedAt = now
    }
    if (c.state !== 'connected' && prev.connection.state === 'connected' && this.connectedAt !== null) {
      this.connectedMs += now - this.connectedAt
      this.connectedAt = null
    }
    if (!this.started) return false
    this.reconnects = Math.max(0, c.reconnects - this.baseReconnects)
    if (prev.connection.willRetry) this.retrying = true
    if (c.state === 'connected') this.retrying = false
    if (s.local !== prev.local) this.sample(s)
    return c.state === 'idle' || (c.state === 'disconnected' && !c.willRetry)
  }

  private sample(s: MediaState): void {
    if (s.local?.rttMs != null) this.rtt.push(s.local.rttMs)
    if (s.local?.codec) this.audioCodec = /red/i.test(s.local.codec) ? 'red' : /opus/i.test(s.local.codec) ? 'opus' : 'other'
    const ins = Object.values(s.participants).map((p) => p.audio).filter((a) => !!a)
    if (ins.length) {
      this.jitter.push(mean(ins.map((a) => a.jitterMs))!)
      this.loss.push(mean(ins.map((a) => a.packetLossPct))!)
      this.conceal.push(mean(ins.map((a) => a.concealedPct))!)
    }
    const top = s.screen.active ? s.screen.stats?.layers.filter((l) => l.fps > 0).sort((a, b) => b.width - a.width)[0] : undefined
    if (top) {
      this.videoCodec = (['vp8', 'vp9', 'h264', 'h265', 'av1'] as const).find((c) => c === s.screen.codec) ?? 'other'
      this.hw = top.powerEfficientEncoder ?? s.screen.hardwareEncoder ?? this.hw
      const key = `${fpsBucket(top.fps)}|${resBucket(Math.min(top.width, top.height))}`
      this.streamBuckets.set(key, (this.streamBuckets.get(key) ?? 0) + 1)
    }
  }

  report(env: Environment, now: number, endedBy: MediaState['connection']): CallQualityReport {
    const ms = this.connectedMs + (this.connectedAt !== null ? now - this.connectedAt : 0)
    const stream = mostUsed(this.streamBuckets)?.split('|') as [Fps, Res] | undefined
    return {
      sessionDurationS: Math.min(48 * 3600, Math.round(ms / 1000)),
      joinMs: this.joinMs === null ? null : Math.min(120_000, Math.round(this.joinMs)),
      reconnects: Math.min(1000, this.reconnects + this.rejoins),
      reconnectFailed: endedBy.state === 'disconnected' && this.retrying,
      rttAvgMs: round(mean(this.rtt), 10_000),
      rttP95Ms: round(p95(this.rtt), 10_000),
      jitterMs: round(mean(this.jitter), 10_000),
      packetLossPct: round(mean(this.loss), 100),
      concealmentPct: round(mean(this.conceal), 100),
      audioCodec: this.audioCodec,
      videoCodec: this.videoCodec,
      encoderHardware: this.videoCodec ? this.hw : null,
      stream: stream ? { fps: stream[0], resolution: stream[1] } : null,
      ...env,
    }
  }
}

/** GPU vendor from the WebGL renderer string ("ANGLE (NVIDIA, …)"); the renderer process can't see the CPU's. */
export function gpuVendorOf(renderer: string | null | undefined): CallQualityReport['gpuVendor'] {
  if (!renderer) return 'unknown'
  if (/nvidia|geforce|quadro/i.test(renderer)) return 'nvidia'
  if (/\bamd\b|radeon|\bati\b/i.test(renderer)) return 'amd'
  if (/intel/i.test(renderer)) return 'intel'
  if (/apple/i.test(renderer)) return 'apple'
  if (/qualcomm|adreno/i.test(renderer)) return 'qualcomm'
  return 'other'
}

async function environment(): Promise<Environment> {
  const cfg = window.alga?.config
  const os: Environment['os'] = cfg?.platform === 'win32' ? 'windows' : cfg?.platform === 'darwin' ? 'macos' : cfg?.platform === 'linux' ? 'linux' : 'other'
  // UA-CH platformVersion (Windows 11 reports 13+, not the NT build); "0" when unavailable.
  const ua = (navigator as Navigator & { userAgentData?: { getHighEntropyValues(h: string[]): Promise<{ platformVersion?: string }> } }).userAgentData
  const pv = (await ua?.getHighEntropyValues(['platformVersion']).catch(() => null))?.platformVersion
  let renderer: string | null = null
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    renderer = ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    // no WebGL: unknown
  }
  const version = /^\d{1,4}\.\d{1,4}\.\d{1,6}(-[0-9a-z.]{1,16})?$/.test(cfg?.version ?? '') ? cfg!.version : '0.0.0'
  return { os, osVersion: pv && /^\d{1,5}(\.\d{1,6}){0,3}$/.test(pv) ? pv : '0', appVersion: version, cpuVendor: 'unknown', gpuVendor: gpuVendorOf(renderer) }
}

const SEND_TIMEOUT_MS = 5000

/**
 * Watch useMedia and send one report per session while `optedIn()` (Me.telemetryOptIn === true). Never blocks
 * leaving (the report is built after the state already moved on); 403 (not opted in), 429 and network errors are
 * dropped silently. Returns the cleanup. App quit: best effort (pagehide ends the session; the request may not
 * make it out before the renderer goes away).
 */
export function startCallTelemetry(optedIn: () => boolean): () => void {
  let session = new CallSession()
  const finish = (endedBy: MediaState['connection']) => {
    const done = session
    session = new CallSession()
    if (!done.started || !optedIn()) return
    void environment()
      .then((env) => Promise.race([api<void>('POST', '/telemetry/call-quality', done.report(env, Date.now(), endedBy)), new Promise((r) => setTimeout(r, SEND_TIMEOUT_MS))]))
      .catch(() => undefined)
  }
  const off = useMedia.subscribe((s, prev) => {
    if (session.update(s, prev, Date.now())) finish(s.connection)
  })
  const onHide = () => finish(useMedia.getState().connection)
  window.addEventListener('pagehide', onHide)
  return () => {
    off()
    window.removeEventListener('pagehide', onHide)
  }
}
