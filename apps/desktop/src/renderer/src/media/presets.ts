// Screen-share presets and which of them this machine may offer. Pure: unit-tested.
// Bitrates/limits are justified in docs/decisions/0001-media-engine.md (measured in docs/benchmarks/media-baseline.md).

export type ScreenPresetId = '720p30' | '1080p30' | '1080p60' | '1440p60' | '2160p30'
export type ContentType = 'motion' | 'detail'
export type VideoCodecId = 'h264' | 'h265' | 'vp8' | 'vp9' | 'av1'

export interface Layer {
  width: number
  height: number
  fps: number
  maxBitrate: number
}

export interface ScreenPreset extends Layer {
  id: ScreenPresetId
  label: string
  /** Lower simulcast layers (lowest first) for viewers that can't take the top one. */
  simulcast: Layer[]
}

const L360: Layer = { width: 640, height: 360, fps: 15, maxBitrate: 400_000 }
const L720: Layer = { width: 1280, height: 720, fps: 30, maxBitrate: 1_700_000 }

export const SCREEN_PRESETS: readonly ScreenPreset[] = [
  { id: '720p30', label: '720p 30 fps', width: 1280, height: 720, fps: 30, maxBitrate: 2_500_000, simulcast: [L360] },
  { id: '1080p30', label: '1080p 30 fps', width: 1920, height: 1080, fps: 30, maxBitrate: 4_500_000, simulcast: [L360, L720] },
  { id: '1080p60', label: '1080p 60 fps', width: 1920, height: 1080, fps: 60, maxBitrate: 8_000_000, simulcast: [L360, L720] },
  { id: '1440p60', label: '1440p 60 fps', width: 2560, height: 1440, fps: 60, maxBitrate: 14_000_000, simulcast: [L360, L720] },
  { id: '2160p30', label: '4K 30 fps', width: 3840, height: 2160, fps: 30, maxBitrate: 18_000_000, simulcast: [L360, L720] },
]

export function getPreset(id: ScreenPresetId): ScreenPreset {
  return SCREEN_PRESETS.find((p) => p.id === id) ?? SCREEN_PRESETS[2]!
}

/**
 * Lower layers for what will really be sent. A window is often below the preset (1280x720 window, 1080p
 * preset): the preset's 720p layer would duplicate the top one, and with only two layers LiveKit's backup-codec
 * regression (H.264 for viewers that can't decode HEVC) delivered nothing (measured, media-baseline.md §4).
 * When the preset's ladder doesn't fit (a layer above 80 % of the source's short side), use quarter and half of
 * the source instead: always 3 distinct layers, exact /4 and /2 scales (even sizes for the HW encoder).
 */
export function simulcastFor(preset: ScreenPreset, sourceWidth?: number, sourceHeight?: number): Layer[] {
  // The capture is already capped to the preset (getDisplayMedia max), so these are the sizes really sent.
  const w = sourceWidth || preset.width
  const h = sourceHeight || preset.height
  const short = Math.min(w, h)
  if (preset.simulcast.every((l) => Math.min(l.width, l.height) <= 0.8 * short)) return preset.simulcast
  const [low, mid] = [L360, L720]
  const scaled = (base: Layer, div: number, ref: number): Layer => {
    const k = short / div / ref
    return { width: Math.round(w / div), height: Math.round(h / div), fps: base.fps, maxBitrate: Math.max(100_000, Math.round(base.maxBitrate * k * k)) }
  }
  return [scaled(low, 4, 360), scaled(mid, 2, 720)].filter((l) => Math.min(l.width, l.height) >= 90)
}

export const pixelRate = (l: Pick<Layer, 'width' | 'height' | 'fps'>): number => l.width * l.height * l.fps

export interface EncoderCapability {
  /** A hardware (power-efficient) encoder exists for the chosen codec at 1080p60. */
  hardware: boolean
  /** Native size of the source/monitor; presets above it are pointless (upscaling). */
  sourceWidth?: number
  sourceHeight?: number
}

/** Per-preset outcome of real streams on this machine: did the encoder hold >= 90% of the target fps? */
export type SustainRecord = Partial<Record<ScreenPresetId, { ok: number; bad: number }>>

/** Software encoders top out around 1080p30 on a desktop CPU without starving the game being streamed. */
const SOFTWARE_CEILING = pixelRate({ width: 1920, height: 1080, fps: 30 })
const HARDWARE_CEILING = pixelRate({ width: 2560, height: 1440, fps: 60 })

/**
 * Presets we offer: within the encoder ceiling, not larger than the source, and not proven unsustainable
 * (a preset that failed more often than it held, with at least 2 samples, is hidden).
 */
export function availablePresets(cap: EncoderCapability, record: SustainRecord = {}): ScreenPreset[] {
  const ceiling = cap.hardware ? HARDWARE_CEILING : SOFTWARE_CEILING
  const list = SCREEN_PRESETS.filter((p) => {
    if (pixelRate(p) > ceiling) return false
    if (cap.sourceWidth && cap.sourceHeight && p.width * p.height > cap.sourceWidth * cap.sourceHeight * 1.05) return false
    const r = record[p.id]
    if (r && r.bad + r.ok >= 2 && r.bad > r.ok) return false
    return true
  })
  return list.length ? list : [SCREEN_PRESETS[0]!]
}

/** Default pick: 1080p60 when offered (central scenario), else the best offered. */
export function defaultPreset(offered: ScreenPreset[]): ScreenPreset {
  return offered.find((p) => p.id === '1080p60') ?? offered[offered.length - 1]!
}

/** Update the sustain record after a stream: `achievedFps` is the median send fps over the session. */
export function recordSustain(record: SustainRecord, id: ScreenPresetId, targetFps: number, achievedFps: number): SustainRecord {
  const prev = record[id] ?? { ok: 0, bad: 0 }
  const ok = achievedFps >= targetFps * 0.9
  return { ...record, [id]: { ok: prev.ok + (ok ? 1 : 0), bad: prev.bad + (ok ? 0 : 1) } }
}

/**
 * Automatic codec: a hardware encoder first (HEVC, then H.264), else software H.264 (half of VP8's CPU here,
 * hardware-decoded by every viewer). VP9/AV1 in software could not hold 1080p at all (decision 0001).
 */
export function pickCodec(hw: Partial<Record<VideoCodecId, boolean>>): VideoCodecId {
  if (hw.h265) return 'h265'
  return 'h264'
}

export function contentSettings(type: ContentType): { hint: 'motion' | 'detail'; degradation: RTCDegradationPreference } {
  return type === 'motion'
    ? { hint: 'motion', degradation: 'maintain-framerate' }
    : { hint: 'detail', degradation: 'maintain-resolution' }
}
