import { z } from 'zod'

/**
 * Opt-in call-quality telemetry (POST /telemetry/call-quality, only while Me.telemetryOptIn is true). One report per
 * voice session, sent when it ends. Aggregates only: no message or stream content, no room/channel/space names or ids,
 * no IPs, no free text (every string is an enum or a version number). The server stores the day (not the time) and a
 * user hash whose salt rotates daily, keeps rows 30 days and folds them into Prometheus histograms.
 */

export const AUDIO_CODECS = ['opus', 'red', 'other'] as const
export const VIDEO_CODECS = ['vp8', 'vp9', 'h264', 'h265', 'av1', 'other'] as const
export const STREAM_FPS_BUCKETS = ['0-14', '15-29', '30-59', '60+'] as const
/** Short side of the published stream: sd < 720 ≤ 720p < 1080 ≤ 1080p < 1440 ≤ 1440p < 2160 ≤ 2160p. */
export const STREAM_RESOLUTION_BUCKETS = ['sd', '720p', '1080p', '1440p', '2160p'] as const
export const TELEMETRY_OS = ['windows', 'macos', 'linux', 'other'] as const
export const CPU_VENDORS = ['intel', 'amd', 'apple', 'qualcomm', 'other', 'unknown'] as const
export const GPU_VENDORS = ['nvidia', 'amd', 'intel', 'apple', 'qualcomm', 'other', 'unknown'] as const

const ms = (max: number) => z.number().min(0).max(max)
const pct = z.number().min(0).max(100)

export const CallQualityReport = z.strictObject({
  /** Seconds connected. */
  sessionDurationS: z.number().int().min(0).max(48 * 3600),
  /** POST /voice/join until the room connected; null if it never connected. */
  joinMs: z.number().int().min(0).max(120_000).nullable(),
  /** Successful reconnections during the session. */
  reconnects: z.number().int().min(0).max(1000),
  /** The session ended because a reconnection gave up. */
  reconnectFailed: z.boolean(),
  rttAvgMs: ms(10_000).nullable(),
  rttP95Ms: ms(10_000).nullable(),
  jitterMs: ms(10_000).nullable(),
  /** Inbound audio packets lost, 0–100. */
  packetLossPct: pct.nullable(),
  /** Concealed (synthesized) inbound audio samples, 0–100. */
  concealmentPct: pct.nullable(),
  audioCodec: z.enum(AUDIO_CODECS).nullable(),
  /** Codec of the user's own camera/screen publication, if any. */
  videoCodec: z.enum(VIDEO_CODECS).nullable(),
  /** That publication used a hardware encoder; null if unknown or nothing was published. */
  encoderHardware: z.boolean().nullable(),
  /** Most-used fps/resolution bucket of the user's screen share; null without one. */
  stream: z.strictObject({ fps: z.enum(STREAM_FPS_BUCKETS), resolution: z.enum(STREAM_RESOLUTION_BUCKETS) }).nullable(),
  os: z.enum(TELEMETRY_OS),
  /** e.g. "10.0.26100". */
  osVersion: z.string().regex(/^\d{1,5}(\.\d{1,6}){0,3}$/),
  /** e.g. "0.1.0" or "0.2.0-beta.1". */
  appVersion: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,6}(-[0-9a-z.]{1,16})?$/),
  cpuVendor: z.enum(CPU_VENDORS),
  gpuVendor: z.enum(GPU_VENDORS),
})
export type CallQualityReport = z.infer<typeof CallQualityReport>
