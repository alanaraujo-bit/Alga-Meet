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
  /** Frames per second the capture delivered to WebRTC (`media-source`), before any encoder drop. */
  sourceFps: number | null
}

export type SendLimit = 'none' | 'capture' | 'cpu' | 'bandwidth' | 'encoder'
/** Why the share leaves below its frame rate, for the streamer (media/README.md, `screen.send`). */
export interface SendDiagnosis {
  /** fps of the best layer going out (what viewers in "Original" get). */
  fps: number
  /** What that layer should carry (the preset's fps for the top layer). */
  targetFps: number
  /** fps the capture delivered (Windows → Chromium), null = unknown. */
  sourceFps: number | null
  encoder: string | null
  hardware: boolean | null
  limit: SendLimit
  /** pt-BR, ready to show; null when nothing is limiting. */
  reason: string | null
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
  // Invented samples only: comfort noise while the other side is silent (DTX) is not a glitch.
  const concealed = num(s.concealedSamples) - num(s.silentConcealedSamples) - (num(p?.concealedSamples) - num(p?.silentConcealedSamples))
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
  const src = [...cur.values()].find((v) => v.type === 'media-source' && v.kind === 'video')
  const sourceFps = src ? num(src.framesPerSecond) || rate(src, prev.get(src.id as string), 'frames') : null
  return { codec: codecOf(cur, outs[0]!).codec, bitrateKbps: layers.reduce((t, l) => t + l.bitrateKbps, 0), layers, rttMs: rttOf(cur, 'video'), sourceFps }
}

/**
 * Diagnose the last few seconds of a share (≥ 3 one-second samples, medians so one slow second doesn't flap).
 * `caps`: max fps per simulcast rid (sender encodings), `presetFps` for a layer without one. The best layer still
 * sending (dynacast pauses the ones nobody watches) is compared with its own cap. Order of blame: the encoder's own
 * limitation (cpu, bandwidth), then the capture (below the cap while the content is `motion`: a game or video is
 * expected to move; still text/code legitimately sends few frames, and a capture under 10 fps is a still image), then
 * frames the capture delivered but the encoder dropped. docs/benchmarks/game-capture.md.
 */
export function diagnoseSend(recent: VideoOutStats[], caps: Record<string, number>, presetFps: number, motion: boolean, surface: 'screen' | 'window' | null): SendDiagnosis | null {
  const samples = recent.flatMap((s) => {
    const l = s.layers.find((x) => x.fps > 0)
    return l ? [{ l, cap: Math.min(presetFps, caps[l.rid ?? ''] ?? presetFps), src: s.sourceFps }] : []
  })
  if (samples.length < 3) return null
  const mid = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!
  const fps = Math.round(mid(samples.map((s) => s.l.fps)))
  const targetFps = Math.round(mid(samples.map((s) => s.cap)))
  const srcs = samples.flatMap((s) => (s.src === null ? [] : [s.src]))
  const sourceFps = srcs.length ? Math.round(mid(srcs)) : null
  const reasons = samples.map((s) => s.l.qualityLimitationReason)
  const ql = (['cpu', 'bandwidth'] as const).find((r) => reasons.filter((x) => x === r).length * 2 > reasons.length)
  const ok = (v: number) => v >= 0.85 * targetFps
  let limit: SendLimit = 'none'
  if (ok(fps)) limit = 'none'
  else if (ql) limit = ql
  else if (sourceFps !== null && ok(sourceFps)) limit = 'encoder'
  else if (sourceFps !== null && motion && sourceFps >= 10) limit = 'capture'
  const head = `Sua transmissão está em ${fps} fps (meta: ${targetFps})`
  const what = surface === 'window' ? 'desta janela' : 'desta tela'
  const reason = {
    none: null,
    cpu: `${head}: o processador não está dando conta de codificar o vídeo. Feche programas pesados ou escolha uma qualidade menor.`,
    bandwidth: `${head}: sua conexão de envio está no limite. Pause downloads ou envios, ou escolha uma qualidade menor.`,
    capture: `${head}: o Windows está entregando só ${sourceFps} quadros por segundo ${what}. Limite o fps do jogo (ex.: 144) ou feche programas pesados para sobrar processador.`,
    encoder: `${head}: o codificador de vídeo está descartando quadros (processador ou placa de vídeo ocupados). Limite o fps do jogo ou escolha uma qualidade menor.`,
  }[limit]
  const top = samples.at(-1)!.l
  return { fps, targetFps, sourceFps, encoder: top.encoderImplementation, hardware: top.powerEfficientEncoder, limit, reason }
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
