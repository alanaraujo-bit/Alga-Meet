// WebRTC getStats() parsing into the numbers the UI/benchmarks need. Deltas need the previous report.
type Report = Map<string, Record<string, unknown>>

export interface AudioOutStats {
  bitrateKbps: number
  packetsPerSec: number
  rttMs: number | null
  codec: string | null
  fmtp: string | null
}
export interface AudioInStats {
  bitrateKbps: number
  jitterMs: number
  packetLossPct: number
  audioLevel: number
  concealedPct: number
  jitterBufferMs: number | null
  codec: string | null
  fmtp: string | null
}
export interface VideoLayerStats {
  rid: string | null
  width: number
  height: number
  fps: number
  bitrateKbps: number
  encoderImplementation: string | null
  powerEfficientEncoder: boolean | null
  qualityLimitationReason: string | null
  scalabilityMode: string | null
}
export interface VideoOutStats {
  codec: string | null
  bitrateKbps: number
  layers: VideoLayerStats[]
  rttMs: number | null
}
export interface VideoInStats {
  codec: string | null
  width: number
  height: number
  fps: number
  bitrateKbps: number
  decoderImplementation: string | null
  powerEfficientDecoder: boolean | null
  freezeCount: number
  totalFreezesMs: number
  framesDropped: number
  jitterBufferMs: number | null
  packetLossPct: number
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function toMap(r: RTCStatsReport | undefined): Report {
  const m: Report = new Map()
  r?.forEach((v: Record<string, unknown>) => m.set(v.id as string, v))
  return m
}

/** Holds the previous report of one track so bitrates/fps are computed over the polling interval. */
export class StatsDelta {
  private prev: Report = new Map()
  next(report: RTCStatsReport | undefined): { cur: Report; prev: Report } {
    const cur = toMap(report)
    const prev = this.prev
    this.prev = cur
    return { cur, prev }
  }
}

function rate(cur: Record<string, unknown>, prev: Record<string, unknown> | undefined, key: string): number {
  if (!prev) return 0
  const dt = (num(cur.timestamp) - num(prev.timestamp)) / 1000
  return dt > 0 ? Math.max(0, (num(cur[key]) - num(prev[key])) / dt) : 0
}

function codecOf(cur: Report, s: Record<string, unknown>): { codec: string | null; fmtp: string | null } {
  const c = cur.get(str(s.codecId) ?? '')
  return { codec: str(c?.mimeType), fmtp: str(c?.sdpFmtpLine) }
}

function rttOf(cur: Report, kind: 'audio' | 'video'): number | null {
  for (const s of cur.values()) if (s.type === 'remote-inbound-rtp' && s.kind === kind && typeof s.roundTripTime === 'number') return s.roundTripTime * 1000
  for (const s of cur.values()) if (s.type === 'candidate-pair' && s.nominated && typeof s.currentRoundTripTime === 'number') return s.currentRoundTripTime * 1000
  return null
}

export function audioOut({ cur, prev }: { cur: Report; prev: Report }): AudioOutStats | null {
  const s = [...cur.values()].find((v) => v.type === 'outbound-rtp' && v.kind === 'audio')
  if (!s) return null
  const p = prev.get(s.id as string)
  return { bitrateKbps: (rate(s, p, 'bytesSent') * 8) / 1000, packetsPerSec: rate(s, p, 'packetsSent'), rttMs: rttOf(cur, 'audio'), ...codecOf(cur, s) }
}

export function audioIn({ cur, prev }: { cur: Report; prev: Report }): AudioInStats | null {
  const s = [...cur.values()].find((v) => v.type === 'inbound-rtp' && v.kind === 'audio')
  if (!s) return null
  const p = prev.get(s.id as string)
  const lost = num(s.packetsLost) - num(p?.packetsLost)
  const recv = num(s.packetsReceived) - num(p?.packetsReceived)
  const samples = num(s.totalSamplesReceived) - num(p?.totalSamplesReceived)
  const concealed = num(s.concealedSamples) - num(p?.concealedSamples)
  const emitted = num(s.jitterBufferEmittedCount) - num(p?.jitterBufferEmittedCount)
  const jbDelay = num(s.jitterBufferDelay) - num(p?.jitterBufferDelay)
  return {
    bitrateKbps: (rate(s, p, 'bytesReceived') * 8) / 1000,
    jitterMs: num(s.jitter) * 1000,
    packetLossPct: lost + recv > 0 ? (100 * Math.max(0, lost)) / (lost + recv) : 0,
    audioLevel: num(s.audioLevel),
    concealedPct: samples > 0 ? (100 * concealed) / samples : 0,
    jitterBufferMs: emitted > 0 ? (1000 * jbDelay) / emitted : null,
    ...codecOf(cur, s),
  }
}

export function videoOut({ cur, prev }: { cur: Report; prev: Report }): VideoOutStats | null {
  const outs = [...cur.values()].filter((v) => v.type === 'outbound-rtp' && v.kind === 'video')
  if (!outs.length) return null
  const layers = outs
    .map((s): VideoLayerStats => {
      const p = prev.get(s.id as string)
      return {
        rid: str(s.rid),
        width: num(s.frameWidth),
        height: num(s.frameHeight),
        fps: num(s.framesPerSecond) || rate(s, p, 'framesEncoded'),
        bitrateKbps: (rate(s, p, 'bytesSent') * 8) / 1000,
        encoderImplementation: str(s.encoderImplementation),
        powerEfficientEncoder: typeof s.powerEfficientEncoder === 'boolean' ? s.powerEfficientEncoder : null,
        qualityLimitationReason: str(s.qualityLimitationReason),
        scalabilityMode: str(s.scalabilityMode),
      }
    })
    .sort((a, b) => b.width * b.height - a.width * a.height)
  return { codec: codecOf(cur, outs[0]!).codec, bitrateKbps: layers.reduce((t, l) => t + l.bitrateKbps, 0), layers, rttMs: rttOf(cur, 'video') }
}

export function videoIn({ cur, prev }: { cur: Report; prev: Report }): VideoInStats | null {
  const s = [...cur.values()].find((v) => v.type === 'inbound-rtp' && v.kind === 'video')
  if (!s) return null
  const p = prev.get(s.id as string)
  const lost = num(s.packetsLost) - num(p?.packetsLost)
  const recv = num(s.packetsReceived) - num(p?.packetsReceived)
  const emitted = num(s.jitterBufferEmittedCount) - num(p?.jitterBufferEmittedCount)
  const jbDelay = num(s.jitterBufferDelay) - num(p?.jitterBufferDelay)
  return {
    codec: codecOf(cur, s).codec,
    width: num(s.frameWidth),
    height: num(s.frameHeight),
    fps: num(s.framesPerSecond) || rate(s, p, 'framesDecoded'),
    bitrateKbps: (rate(s, p, 'bytesReceived') * 8) / 1000,
    decoderImplementation: str(s.decoderImplementation),
    powerEfficientDecoder: typeof s.powerEfficientDecoder === 'boolean' ? s.powerEfficientDecoder : null,
    freezeCount: num(s.freezeCount),
    totalFreezesMs: num(s.totalFreezesDuration) * 1000,
    framesDropped: num(s.framesDropped),
    jitterBufferMs: emitted > 0 ? (1000 * jbDelay) / emitted : null,
    packetLossPct: lost + recv > 0 ? (100 * Math.max(0, lost)) / (lost + recv) : 0,
  }
}
