import { parseWav } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { applyEdits, clampWindow, encodeWav, loudnessGainDb, peaks } from './audio-edit'

const R = 48000
const sine = (ms: number, amp = 0.5, f = 440) => Float32Array.from({ length: Math.round((R * ms) / 1000) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / R))
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
const base = { fadeInMs: 0, fadeOutMs: 0, gainDb: 0, normalize: false }

describe('clampWindow', () => {
  it('never exceeds 5000 ms nor leaves [0, total]', () => {
    expect(clampWindow({ start: 0, end: 9000 }, 20000)).toEqual({ start: 0, end: 5000 })
    expect(clampWindow({ start: -100, end: 1000 }, 20000)).toEqual({ start: 0, end: 1000 })
    expect(clampWindow({ start: 19000, end: 21000 }, 20000)).toEqual({ start: 19000, end: 20000 })
    expect(clampWindow({ start: 3000, end: 1000 }, 20000)).toEqual({ start: 1000, end: 3000 })
    expect(clampWindow({ start: 0, end: 3000 }, 1200)).toEqual({ start: 0, end: 1200 })
  })
  it('keeps at least 50 ms', () => {
    const w = clampWindow({ start: 1000, end: 1000 }, 20000)
    expect(w.end - w.start).toBe(50)
  })
})

describe('loudnessGainDb', () => {
  it('silence is 0 (no NaN), loud is negative, quiet positive, all clamped', () => {
    expect(loudnessGainDb(new Float32Array(48000))).toBe(0)
    expect(loudnessGainDb(sine(500, 0.99))).toBeLessThan(0)
    expect(loudnessGainDb(sine(500, 0.01))).toBeGreaterThan(0)
    expect(loudnessGainDb(sine(500, 0.0001))).toBeLessThanOrEqual(18)
    expect(Number.isFinite(loudnessGainDb(sine(500, 0.0001)))).toBe(true)
  })
})

describe('applyEdits', () => {
  it('cuts the window and leaves the middle untouched without fades', () => {
    const src = sine(2000)
    const out = applyEdits(src, R, { ...base, startMs: 500, endMs: 1500 })
    expect(out.length).toBe(48000)
    expect(out[24000]).toBeCloseTo(src[24000 + 24000]!, 6)
  })
  it('fades start and end at 0 and the peak stays ≤ −1 dBFS', () => {
    const out = applyEdits(sine(1000, 1), R, { ...base, startMs: 0, endMs: 1000, fadeInMs: 100, fadeOutMs: 100, gainDb: 12 })
    expect(Math.abs(out[0]!)).toBeLessThan(1e-3)
    expect(Math.abs(out[out.length - 1]!)).toBeLessThan(1e-2)
    expect(peak(out)).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-6)
  })
  it('resamples to 48 kHz', () => {
    const src44 = Float32Array.from({ length: 44100 }, (_, i) => Math.sin(i / 10))
    expect(applyEdits(src44, 44100, { ...base, startMs: 0, endMs: 1000 }).length).toBe(48000)
  })
  it('normalize on silence stays silent', () => {
    const out = applyEdits(new Float32Array(48000), R, { ...base, startMs: 0, endMs: 1000, normalize: true })
    expect(peak(out)).toBe(0)
    expect(out.every(Number.isFinite)).toBe(true)
  })
})

describe('encodeWav', () => {
  it('produces what the server accepts, with the right duration', () => {
    const r = parseWav(encodeWav(sine(4999)))
    expect(r).toMatchObject({ ok: true, durationMs: 4999 })
  })
})

describe('peaks', () => {
  it('one max-abs per bucket', () => {
    const p = peaks(Float32Array.from([0.1, -0.9, 0.2, 0.3]), 2)
    expect(Array.from(p).map((v) => +v.toFixed(2))).toEqual([0.9, 0.3])
    expect(peaks(new Float32Array(0), 4)).toHaveLength(4)
  })
})

describe('firstWindow', () => {
  it('starts at the first loud sample, or at 0 for a quiet recording (never a 50 ms tail)', async () => {
    const { firstWindow } = await import('./audio-edit')
    const loud = new Float32Array(48000 * 8); loud.fill(0.3, 48000 * 2)
    expect(firstWindow(loud).start).toBeGreaterThan(1900)
    const quiet = sine(8000, 0.01)
    expect(firstWindow(quiet)).toEqual({ start: 0, end: 5000 })
  })
})

describe('checkInput', () => {
  it('refuses big files and anything over 10 minutes before decoding', async () => {
    const { checkInput } = await import('./audio-edit')
    expect(checkInput(1_000_000, 30)).toBeNull()
    expect(checkInput(21 * 1024 * 1024, 30)).toBe('tooBig')
    expect(checkInput(1_000_000, 11 * 60)).toBe('tooLong')
    expect(checkInput(1_000_000, Number.NaN)).toBeNull() // unknown duration: the decode check still applies
  })
})
