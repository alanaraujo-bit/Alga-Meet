// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { findBox, initDelay, initTimescale, segmentStart } from './mp4'

const bin = join(process.cwd(), 'build', 'ffmpeg')
const fixture = join(process.cwd(), 'test-fixtures', 'cinema', 'h264-ac3-51.mkv')
const ready = existsSync(join(bin, 'ffmpeg.exe')) && existsSync(fixture)

const box = (type: string, payload: number[]): number[] => {
  const size = 8 + payload.length
  return [size >>> 24, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, ...[...type].map((c) => c.charCodeAt(0)), ...payload]
}
const u32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]

describe('mp4 box reader (synthetic)', () => {
  it('reads mdhd v0 timescale and tfdt v1', () => {
    const mdhd = box('mdhd', [0, 0, 0, 0, ...u32(0), ...u32(0), ...u32(90000), ...u32(0), 0, 0, 0, 0])
    const init = Uint8Array.from(box('moov', box('trak', box('mdia', mdhd))))
    expect(initTimescale(init)).toBe(90000)
    const tfdt = box('tfdt', [1, 0, 0, 0, ...u32(0), ...u32(900000)])
    expect(segmentStart(Uint8Array.from(box('moof', box('traf', tfdt))), 90000)).toBe(10)
  })
  it('is total on junk: NaN, never an exception', () => {
    for (const junk of [new Uint8Array(0), new Uint8Array([0, 0, 0, 99, 1, 2]), Uint8Array.from(box('moov', [0, 0, 0, 200, 0x6d, 0x64]))]) {
      expect(initTimescale(junk)).toBeNaN()
      expect(segmentStart(junk, 1000)).toBeNaN()
      expect(initDelay(junk)).toBe(0)
      expect(findBox(junk, ['moof'])).toBeNull()
    }
  })
})

describe.skipIf(!ready)('mp4 box reader on real LGPL ffmpeg output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alga-mp4-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  // Forward slashes: with backslashes ffmpeg's HLS muxer writes the init segment to the cwd.
  const out = (f: string) => join(dir, f).replace(/\\/g, '/')
  const hls = (name: string, extra: string[]) => {
    execFileSync(join(bin, 'ffmpeg.exe'), [
      '-v', 'error', '-y', '-copyts', '-start_at_zero', ...extra, '-f', 'hls', '-hls_segment_type', 'fmp4', '-hls_time', '4',
      '-hls_playlist_type', 'event', '-hls_segment_options', 'movflags=+frag_discont', '-hls_fmp4_init_filename', `${name}-init.mp4`,
      '-hls_segment_filename', out(`${name}-%d.m4s`), out(`${name}.m3u8`),
    ], { windowsHide: true })
    return (f: string) => new Uint8Array(readFileSync(join(dir, `${name}${f}`)))
  }

  it('video: 16 kHz timescale, B-frame delay from elst, tfdt = keyframe time even after -ss', () => {
    const v = hls('v', ['-ss', '9', '-i', fixture, '-map', '0:0', '-c:v', 'copy', '-avoid_negative_ts', 'disabled'])
    const ts = initTimescale(v('-init.mp4'))
    expect(ts).toBe(16000)
    expect(initDelay(v('-init.mp4'))).toBeCloseTo(0.083, 3)
    // -ss 9 lands on the keyframe at 8 s (GOP 2 s); 4 s segments.
    expect(segmentStart(v('-0.m4s'), ts)).toBeCloseTo(8, 2)
    expect(segmentStart(v('-1.m4s'), ts)).toBeCloseTo(12, 2)
  })
  it('audio: sample-rate timescale, no delay', () => {
    const a = hls('a', ['-ss', '15', '-i', fixture, '-map', '0:a:0', '-c:a', 'flac'])
    const ts = initTimescale(a('-init.mp4'))
    expect(ts).toBe(48000)
    expect(initDelay(a('-init.mp4'))).toBe(0)
    expect(segmentStart(a('-0.m4s'), ts)).toBeCloseTo(15, 3)
  })
})
