import { describe, expect, it } from 'vitest'
import { DEFAULT_EVERYONE_PERMISSIONS, Permission } from './permissions.js'
import { SoundMetaBody, parseWav } from './soundboard.js'

/** Builds a WAV: PCM16 mono 48 kHz by default; `extra` chunks go between fmt and data. */
function wav({ ms = 1000, channels = 1, rate = 48000, bits = 16, format = 1, extra = [] as Array<[string, number]>, dataSizeOverride }: {
  ms?: number; channels?: number; rate?: number; bits?: number; format?: number; extra?: Array<[string, number]>; dataSizeOverride?: number
} = {}): Uint8Array {
  const frames = Math.round((rate * ms) / 1000)
  const dataSize = frames * channels * (bits / 8)
  const extraSize = extra.reduce((n, [, len]) => n + 8 + len + (len & 1), 0)
  const buf = new Uint8Array(44 + extraSize + dataSize)
  const v = new DataView(buf.buffer)
  const tag = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  tag(0, 'RIFF'); v.setUint32(4, buf.length - 8, true); tag(8, 'WAVE')
  tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, format, true); v.setUint16(22, channels, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * channels * (bits / 8), true); v.setUint16(32, channels * (bits / 8), true); v.setUint16(34, bits, true)
  let at = 36
  for (const [id, len] of extra) { tag(at, id); v.setUint32(at + 4, len, true); at += 8 + len + (len & 1) }
  tag(at, 'data'); v.setUint32(at + 4, dataSizeOverride ?? dataSize, true)
  return buf
}

describe('parseWav', () => {
  it('accepts PCM16 mono 48 kHz', () => {
    expect(parseWav(wav())).toEqual({ ok: true, durationMs: 1000, samples: 48000 })
  })
  it('accepts extra chunks before data', () => {
    expect(parseWav(wav({ ms: 500, extra: [['LIST', 27]] }))).toMatchObject({ ok: true, durationMs: 500 })
  })
  it('accepts up to the 5050 ms tolerance', () => {
    expect(parseWav(wav({ ms: 5000 })).ok).toBe(true)
    expect(parseWav(wav({ ms: 5040 })).ok).toBe(true)
  })
  it.each([
    ['stereo', wav({ channels: 2 })],
    ['44.1 kHz', wav({ rate: 44100 })],
    ['8-bit', wav({ bits: 8 })],
    ['float', wav({ format: 3, bits: 32 })],
    ['too long', wav({ ms: 5100 })],
    ['data larger than the file', wav({ dataSizeOverride: 10_000_000 })],
    ['empty data', wav({ ms: 0 })],
    ['tiny buffer', new Uint8Array(20)],
    ['RIFF without WAVE', (() => { const b = wav(); b[8] = 0x41; return b })()],
    ['random bytes', Uint8Array.from({ length: 4000 }, (_, i) => (i * 7919) & 255)],
  ])('rejects %s', (_name, buf) => {
    const r = parseWav(buf)
    expect(r.ok).toBe(false)
  })
})

describe('soundboard permissions and meta', () => {
  it('everyone can use, not manage', () => {
    expect(DEFAULT_EVERYONE_PERMISSIONS & Permission.USE_SOUNDBOARD).toBe(Permission.USE_SOUNDBOARD)
    expect(DEFAULT_EVERYONE_PERMISSIONS & Permission.MANAGE_SOUNDBOARD).toBe(0)
    expect(Permission.USE_SOUNDBOARD).toBe(1 << 21)
    expect(Permission.MANAGE_SOUNDBOARD).toBe(1 << 22)
  })
  it('validates name and emoji', () => {
    expect(SoundMetaBody.safeParse({ name: 'Corneta', emoji: '📯' }).success).toBe(true)
    expect(SoundMetaBody.safeParse({ name: '  Corneta  ' }).data?.name).toBe('Corneta')
    expect(SoundMetaBody.safeParse({ name: '' }).success).toBe(false)
    expect(SoundMetaBody.safeParse({ name: '   ' }).success).toBe(false)
    expect(SoundMetaBody.safeParse({ name: 'x'.repeat(33) }).success).toBe(false)
    expect(SoundMetaBody.safeParse({ name: 'ok', emoji: '📯📯' }).success).toBe(false)
    expect(SoundMetaBody.safeParse({ name: 'ok', emoji: '👍🏽' }).success).toBe(true)
    expect(SoundMetaBody.safeParse({ name: 'ok', emoji: null }).success).toBe(true)
  })
})
