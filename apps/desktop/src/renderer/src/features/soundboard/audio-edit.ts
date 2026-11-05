// Pure audio editing for the sound editor (no DOM): trim window, loudness, fades, peak ceiling, WAV encoding.
import { MAX_SOUND_MS, SOUND_SAMPLE_RATE } from '@alga/shared'

const MIN_WINDOW_MS = 50
/** Shared loudness target for every sound, including the Alga pack (RMS of the non-silent blocks). */
export const TARGET_RMS_DB = -18
const CEILING = 10 ** (-1 / 20) // −1 dBFS
const GAIN_RANGE: [number, number] = [-24, 18]

export interface Edits { startMs: number; endMs: number; fadeInMs: number; fadeOutMs: number; gainDb: number; normalize: boolean }

/** Ordered, inside [0, total], at most `maxMs` long and at least 50 ms (when the file allows it). */
export function clampWindow(w: { start: number; end: number }, totalMs: number, maxMs = MAX_SOUND_MS): { start: number; end: number } {
  let start = Math.max(0, Math.min(w.start, w.end))
  let end = Math.min(totalMs, Math.max(w.start, w.end))
  if (end - start > maxMs) end = start + maxMs
  if (end - start < MIN_WINDOW_MS) {
    end = Math.min(totalMs, start + MIN_WINDOW_MS)
    start = Math.max(0, end - MIN_WINDOW_MS)
  }
  return { start, end }
}

/** Max |sample| per bucket, for the waveform. */
export function peaks(samples: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets)
  if (!samples.length) return out
  const per = samples.length / buckets
  for (let b = 0; b < buckets; b++) {
    let m = 0
    const end = Math.min(samples.length, Math.ceil((b + 1) * per))
    for (let i = Math.floor(b * per); i < end; i++) {
      const v = Math.abs(samples[i]!)
      if (v > m) m = v
    }
    out[b] = m
  }
  return out
}

/** Gain (dB) that brings the sound to TARGET_RMS_DB, ignoring silent 20 ms blocks; 0 for silence, clamped to [−24, +18]. */
export function loudnessGainDb(samples: Float32Array, targetDb = TARGET_RMS_DB, rate = SOUND_SAMPLE_RATE): number {
  const block = Math.max(1, Math.round(rate * 0.02))
  let sum = 0
  let n = 0
  for (let i = 0; i < samples.length; i += block) {
    let s = 0
    const end = Math.min(samples.length, i + block)
    for (let j = i; j < end; j++) s += samples[j]! * samples[j]!
    const ms = s / (end - i)
    if (ms > 1e-6) { sum += s; n += end - i } // −60 dBFS gate
  }
  if (!n) return 0
  const rmsDb = 10 * Math.log10(sum / n)
  return Math.min(GAIN_RANGE[1], Math.max(GAIN_RANGE[0], targetDb - rmsDb))
}

/** Linear resampling to 48 kHz (sources are already mono). */
function resample(x: Float32Array, rate: number): Float32Array {
  if (rate === SOUND_SAMPLE_RATE) return x
  const n = Math.round((x.length * SOUND_SAMPLE_RATE) / rate)
  const out = new Float32Array(n)
  const step = rate / SOUND_SAMPLE_RATE
  for (let i = 0; i < n; i++) {
    const p = i * step
    const k = Math.floor(p)
    const a = x[k] ?? 0
    const b = x[k + 1] ?? a
    out[i] = a + (b - a) * (p - k)
  }
  return out
}

/** Cut → 48 kHz → gain (+ normalization) → scaled under −1 dBFS → linear fades. Returns mono 48 kHz samples. */
export function applyEdits(samples: Float32Array, rate: number, e: Edits): Float32Array {
  const from = Math.max(0, Math.floor((e.startMs / 1000) * rate))
  const to = Math.min(samples.length, Math.ceil((e.endMs / 1000) * rate))
  const out = Float32Array.from(resample(samples.subarray(from, Math.max(from, to)), rate))
  const gainDb = e.gainDb + (e.normalize ? loudnessGainDb(out) : 0)
  const g = 10 ** (gainDb / 20)
  let peak = 0
  for (let i = 0; i < out.length; i++) {
    out[i]! *= g
    const v = Math.abs(out[i]!)
    if (v > peak) peak = v
  }
  if (peak > CEILING) {
    const k = CEILING / peak
    for (let i = 0; i < out.length; i++) out[i]! *= k
  }
  const fin = Math.min(out.length, Math.round((e.fadeInMs / 1000) * SOUND_SAMPLE_RATE))
  for (let i = 0; i < fin; i++) out[i]! *= i / fin
  const fout = Math.min(out.length, Math.round((e.fadeOutMs / 1000) * SOUND_SAMPLE_RATE))
  for (let i = 0; i < fout; i++) out[out.length - 1 - i]! *= i / fout
  return out
}

/** RIFF/WAVE PCM 16-bit mono 48 kHz (what parseWav accepts). */
export function encodeWav(mono48k: Float32Array): Uint8Array {
  const buf = new Uint8Array(44 + mono48k.length * 2)
  const v = new DataView(buf.buffer)
  const tag = (at: number, s: string) => { for (let i = 0; i < 4; i++) v.setUint8(at + i, s.charCodeAt(i)) }
  tag(0, 'RIFF'); v.setUint32(4, buf.length - 8, true); tag(8, 'WAVE')
  tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, SOUND_SAMPLE_RATE, true); v.setUint32(28, SOUND_SAMPLE_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  tag(36, 'data'); v.setUint32(40, mono48k.length * 2, true)
  for (let i = 0; i < mono48k.length; i++) {
    const x = Math.max(-1, Math.min(1, mono48k[i]!))
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true)
  }
  return buf
}

/** Mixes any channel count down to mono. */
export function mixdown(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!
  const out = new Float32Array(channels[0]?.length ?? 0)
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i]! += ch[i]! / channels.length
  return out
}
