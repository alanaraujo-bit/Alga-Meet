// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CinemaFilmSchema } from '@alga/shared'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() } }))

import { setFfmpegBinsForTest } from './ffmpeg'
import { filmFromProbe, probeFile } from './probe'

const fixtures = join(__dirname, '__fixtures__')
const fx = (name: string): any => JSON.parse(readFileSync(join(fixtures, `${name}.json`), 'utf8'))
const ok = (name: string, fileName = 'movie.mkv', probe: unknown = fx(name)) => {
  const r = filmFromProbe(probe, fileName)
  if ('error' in r) throw new Error(`${name}: unexpected ${r.error}`)
  return r
}
const err = (probe: unknown) => {
  const r = filmFromProbe(probe, 'movie.mkv')
  return 'error' in r ? r.error : null
}
const A = (r: ReturnType<typeof ok>) => r.film.audio.map((a) => [a.id, a.out, a.channels, a.mime])

const AAC = 'audio/mp4; codecs="mp4a.40.2"'
const OPUS = 'audio/mp4; codecs="opus"'
const FLAC = 'audio/mp4; codecs="flac"'

describe('filmFromProbe: real fixtures', () => {
  it('H.264 + AC-3 5.1: video copy, audio to AAC', () => {
    const { film, warnings } = ok('h264-ac3-51', 'Duna.Parte.Dois.2024.2160p.WEB-DL.mkv')
    expect(film).toMatchObject({
      title: 'Duna Parte Dois (2024)', durationS: 20, width: 1920, height: 1080, hdr: 'sdr', videoCodec: 'h264',
      videoMime: 'video/mp4; codecs="avc1.640028"', episode: null, subtitles: [], chapters: [],
    })
    expect(film.bitrateKbps).toBe(5812)
    expect(A({ film, warnings })).toEqual([[0, 'aac', 6, AAC]])
    expect(film.audio[0]).toMatchObject({ sourceCodec: 'ac3', default: true, lang: null, title: null })
    expect(warnings).toEqual(['audio_converted'])
  })
  it('HEVC Main10 HDR10 + E-AC-3 5.1', () => {
    const r = ok('hevc10-hdr10-eac3-51')
    expect(r.film).toMatchObject({ hdr: 'hdr10', videoCodec: 'hevc', videoMime: 'video/mp4; codecs="hvc1.2.4.L120.B0"' })
    expect(A(r)).toEqual([[0, 'aac', 6, AAC]])
  })
  it('AV1 + Opus 5.1: all copy, no warnings', () => {
    const r = ok('av1-opus-51')
    expect(r.film).toMatchObject({ videoCodec: 'av1', videoMime: 'video/mp4; codecs="av01.0.08M.08"' })
    expect(A(r)).toEqual([[0, 'copy', 6, OPUS]])
    expect(r.warnings).toEqual([])
  })
  it('H.264 + AAC + SRT + ASS (attachment ignored)', () => {
    const r = ok('h264-aac-srt-ass')
    expect(A(r)).toEqual([[0, 'copy', 6, AAC]])
    expect(r.film.subtitles).toEqual([
      { id: 0, lang: 'por', title: null, format: 'vtt', external: false },
      { id: 1, lang: 'eng', title: null, format: 'ass', external: false },
    ])
    expect(r.warnings).toEqual([])
  })
  it('DTS core 5.1 is lossy: AAC', () => {
    const r = ok('h264-dts-51')
    expect(A(r)).toEqual([[0, 'aac', 6, AAC]])
    expect(r.film.audio[0]!.sourceCodec).toBe('dts')
  })
  it('TrueHD (5.1 in the fixture) is lossless: FLAC with the source channels', () => {
    const r = ok('hevc10-truehd-71')
    expect(A(r)).toEqual([[0, 'flac', 6, FLAC]])
    expect(r.warnings).toEqual(['audio_converted'])
  })
  it('long 1080p fixture maps', () => {
    expect(ok('long-h264-1080p-10min').film.durationS).toBeGreaterThan(500)
  })
  it('ffprobe-provided mime_codec_string agrees with ours', () => {
    for (const n of readdirSync(fixtures).filter((f) => /^(h264|hevc10|av1)-/.test(f))) {
      const j = fx(n.replace(/\.json$/, ''))
      const v = j.streams.find((s: any) => s.codec_type === 'video')
      if (v?.mime_codec_string) expect(ok(n.replace(/\.json$/, '')).film.videoMime).toBe(`video/mp4; codecs="${v.mime_codec_string}"`)
    }
  })
})

describe('filmFromProbe: audio policy (hand-edited fixtures)', () => {
  it('TrueHD 7.1 -> FLAC 8, no Atmos warning', () => {
    const r = ok('hevc-truehd-71-edit')
    expect(A(r)).toEqual([[0, 'flac', 8, FLAC]])
    expect(r.warnings).not.toContain('atmos_dropped')
  })
  it('TrueHD Atmos 7.1 -> FLAC 8 + atmos_dropped', () => {
    const r = ok('hevc-truehd-atmos')
    expect(A(r)).toEqual([[0, 'flac', 8, FLAC]])
    expect(r.warnings).toEqual(expect.arrayContaining(['audio_converted', 'atmos_dropped']))
  })
  it('DTS-HD MA (by profile) -> FLAC with the source channels', () => {
    const r = ok('h264-dtshd-ma-71')
    expect(A(r)).toEqual([[0, 'flac', 8, FLAC]])
    expect(r.film.audio[0]!.sourceCodec).toBe('dts-hd ma')
  })
  it('lossy 7.1 (E-AC-3) -> Opus 8', () => {
    expect(A(ok('hevc-eac3-71'))).toEqual([[0, 'opus', 8, OPUS]])
  })
  it('more than 8 channels downmix to 8', () => {
    expect(A(ok('h264-truehd-16ch'))).toEqual([[0, 'flac', 8, FLAC]])
  })
  it('misc matrix: aac 7.1, mp3, flac, opus, HE-AAC, opus 12ch, pcm, vorbis', () => {
    const r = ok('misc-audio-subs')
    expect(A(r)).toEqual([
      [0, 'opus', 8, OPUS], // AAC > 6 ch does not attach in MSE
      [1, 'aac', 2, AAC], // MP3 in fMP4 is refused by Chromium (docs/benchmarks/cinema-spike.md)
      [2, 'copy', 2, FLAC],
      [3, 'copy', 2, OPUS],
      [4, 'copy', 2, 'audio/mp4; codecs="mp4a.40.5"'],
      [5, 'opus', 8, OPUS], // would be copy, but > 8 channels
      [6, 'flac', 2, FLAC],
      [7, 'aac', 2, AAC],
    ])
    expect(r.film.audio.filter((a) => a.default).map((a) => a.id)).toEqual([0]) // none flagged -> first
  })
  it('subtitles: bitmap formats are ignored but keep their ordinals', () => {
    const r = ok('misc-audio-subs')
    expect(r.film.subtitles.map((s) => [s.id, s.format, s.lang])).toEqual([[0, 'vtt', 'por'], [1, 'ass', 'eng'], [4, 'vtt', null]])
    expect(r.warnings).toEqual(expect.arrayContaining(['pgs_ignored', 'audio_converted']))
  })
})

describe('filmFromProbe: HDR / Dolby Vision / mime derivation', () => {
  it('DV profile 8 -> dv8, still hvc1 (Chromium has no dvh1)', () => {
    const r = ok('hevc-dv-profile8')
    expect(r.film.hdr).toBe('dv8')
    expect(r.film.videoMime).toBe('video/mp4; codecs="hvc1.2.4.L120.B0"')
    expect(r.warnings).not.toContain('dv_profile5')
  })
  it('DV profile 5 -> warning, not dv8', () => {
    const r = ok('hevc-dv-profile5')
    expect(r.warnings).toContain('dv_profile5')
    expect(r.film.hdr).toBe('sdr')
  })
  it('HLG', () => expect(ok('hevc-hlg').film.hdr).toBe('hlg'))
  it('HEVC Main 8-bit, "Main 10" spelling and interlaced', () => {
    const p = fx('hevc10-hdr10-eac3-51')
    const v = p.streams[0]
    v.profile = 'Main'; v.pix_fmt = 'yuv420p'; v.level = 93
    expect(ok('x', 'a.mkv', p).film.videoMime).toBe('video/mp4; codecs="hvc1.1.6.L93.B0"')
    v.profile = 'Main 10'; v.level = 153; v.field_order = 'tt'
    expect(ok('x', 'a.mkv', p).film.videoMime).toBe('video/mp4; codecs="hvc1.2.4.L153.40"')
  })
  it('H.264 profiles', () => {
    const mime = (profile: string, level: number) => {
      const p = fx('h264-ac3-51'); p.streams[0].profile = profile; p.streams[0].level = level
      return ok('x', 'a.mkv', p).film.videoMime
    }
    expect(mime('Constrained Baseline', 31)).toBe('video/mp4; codecs="avc1.42C01F"')
    expect(mime('Baseline', 30)).toBe('video/mp4; codecs="avc1.42001E"')
    expect(mime('Main', 40)).toBe('video/mp4; codecs="avc1.4D0028"')
    expect(mime('High 10', 51)).toBe('video/mp4; codecs="avc1.6E0033"')
    expect(mime('High 4:2:2', 41)).toBe('video/mp4; codecs="avc1.7A0029"')
  })
  it('VP9 and AV1 fallbacks (no usable level)', () => {
    const p = fx('av1-opus-51')
    p.streams[0].codec_name = 'vp9'; p.streams[0].profile = 'Profile 2'; p.streams[0].pix_fmt = 'yuv420p10le'; p.streams[0].level = -99
    expect(ok('x', 'a.mkv', p).film).toMatchObject({ videoCodec: 'vp9', videoMime: 'video/mp4; codecs="vp09.02.40.10"' })
    const q = fx('av1-opus-51')
    q.streams[0].level = -99; q.streams[0].pix_fmt = 'yuv420p10le'
    expect(ok('x', 'a.mkv', q).film.videoMime).toBe('video/mp4; codecs="av01.0.08M.10"')
    q.streams[0].width = 3840; q.streams[0].height = 2160
    expect(ok('x', 'a.mkv', q).film.videoMime).toBe('video/mp4; codecs="av01.0.12M.10"')
  })
  it('high bitrate warning above 60 Mbps', () => {
    const p = fx('h264-ac3-51'); p.format.bit_rate = '61000000'
    const r = ok('x', 'a.mkv', p)
    expect(r.film.bitrateKbps).toBe(61000)
    expect(r.warnings).toContain('high_bitrate')
  })
  it('bitrate falls back to size/duration', () => {
    const p = fx('h264-ac3-51'); delete p.format.bit_rate
    expect(ok('x', 'a.mkv', p).film.bitrateKbps).toBe(5812) // size * 8 / duration
  })
})

describe('filmFromProbe: hostile / broken input', () => {
  it('no video stream', () => expect(err(fx('no-video'))).toBe('no_video'))
  it('cover art alone is not a video', () => {
    const p = fx('no-video')
    p.streams.push({ index: 5, codec_type: 'video', codec_name: 'mjpeg', width: 600, height: 600, disposition: { attached_pic: 1 } })
    expect(err(p)).toBe('no_video')
  })
  it('mpeg2video -> unsupported_video', () => expect(err(fx('mpeg2-mp2'))).toBe('unsupported_video'))
  it('absurd dimensions -> unsupported_video', () => {
    const p = fx('h264-ac3-51'); p.streams[0].width = 70000
    expect(err(p)).toBe('unsupported_video')
  })
  it('missing or zero duration', () => {
    expect(err(fx('no-duration'))).toBe('no_duration')
    expect(err(fx('zero-duration'))).toBe('no_duration')
  })
  it('garbage -> unreadable (never throws)', () => {
    for (const bad of [null, undefined, 42, 'x', [], {}, { streams: 'no' }, { streams: [null, 3], format: [] }, { streams: [], format: {} }]) {
      expect(() => filmFromProbe(bad, 'a.mkv')).not.toThrow()
      expect(['unreadable', 'no_video']).toContain(err(bad))
    }
  })
  it('a string (e.g. truncated JSON text) is unreadable', () => {
    expect(err('{"streams":[')).toBe('unreadable')
  })
  it('control chars stripped, everything else intact (escaping is the UI job)', () => {
    const { film } = ok('hostile-titles')
    const a = film.audio[0]!
    expect(a.lang).toBe('eng')
    expect(a.title).toBe('Dub <script>alert(1)</script> ‮evil‬ עברית العربية')
    expect(film.subtitles[0]!.title).toBe('x'.repeat(120))
    expect(film.chapters.map((c) => c.title)).toEqual(['Cap 1 <b>bold</b>', 'y'.repeat(120), ''])
    // eslint-disable-next-line no-control-regex
    expect(JSON.stringify(film)).not.toMatch(/\\u00[01][0-9a-f]|\\u007f/)
  })
  it('title is never empty and never has control chars', () => {
    expect(ok('h264-ac3-51', '\u0000\u0001.mkv').film.title.length).toBeGreaterThan(0)
    expect(ok('h264-ac3-51', '....mkv').film.title.length).toBeGreaterThan(0)
    expect(ok('h264-ac3-51', `${'a'.repeat(300)}.mkv`).film.title.length).toBeLessThanOrEqual(120)
  })
})

describe('filmFromProbe: caps (R11)', () => {
  it('40 audio tracks: all mapped, no throw; keeps 32 with the default first; 64 subs; 100 chapters', () => {
    const r = ok('many-tracks')
    expect(r.film.audio).toHaveLength(32)
    expect(r.film.audio[0]).toMatchObject({ id: 36, default: true })
    expect(r.film.audio.filter((a) => a.default)).toHaveLength(1)
    expect(r.film.audio.slice(1).map((a) => a.id)).toEqual(Array.from({ length: 31 }, (_, i) => i)) // source order after the default
    expect(r.film.subtitles).toHaveLength(64)
    expect(r.film.chapters).toHaveLength(100)
    expect(r.warnings).toContain('tracks_truncated')
  })
  it('no truncation warning under the caps', () => expect(ok('h264-ac3-51').warnings).not.toContain('tracks_truncated'))
  it('every fixture satisfies CinemaFilmSchema', () => {
    let n = 0
    for (const f of readdirSync(fixtures).filter((x) => x.endsWith('.json'))) {
      const r = filmFromProbe(JSON.parse(readFileSync(join(fixtures, f), 'utf8')), 'Show.Name.S01E02.1080p.mkv')
      if ('error' in r) continue
      n++
      const parsed = CinemaFilmSchema.safeParse(r.film)
      expect(parsed.success, `${f}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true)
    }
    expect(n).toBeGreaterThanOrEqual(15)
  })
  it('episode is filled from the file name', () => {
    expect(ok('h264-ac3-51', 'The.Office.US.S02E03.720p.mkv').film).toMatchObject({ title: 'The Office US', episode: { season: 2, episode: 3 } })
  })
})

const ffprobeBin = join(process.cwd(), 'build', 'ffmpeg', 'ffprobe.exe')
const realFile = join(process.cwd(), 'test-fixtures', 'cinema', 'h264-aac-srt-ass.mkv')
describe('probeFile', () => {
  it('rejects non-absolute paths (no protocol injection) as unreadable', async () => {
    expect(await probeFile('http://example.com/x.mkv')).toEqual({ error: 'unreadable' })
    expect(await probeFile('-version')).toEqual({ error: 'unreadable' })
  })
  it('missing binary or file is unreadable', async () => {
    setFfmpegBinsForTest({ ffmpeg: 'x', ffprobe: join(process.cwd(), 'nope', 'ffprobe.exe') })
    expect(await probeFile(realFile)).toEqual({ error: 'unreadable' })
  })
  it.skipIf(!existsSync(ffprobeBin) || !existsSync(realFile))('runs the bundled ffprobe on a real fixture', async () => {
    setFfmpegBinsForTest({ ffmpeg: 'x', ffprobe: ffprobeBin })
    const r = await probeFile(realFile)
    expect('film' in r && r.film.audio[0]).toMatchObject({ out: 'copy', channels: 6 })
    expect(await probeFile(join(process.cwd(), 'test-fixtures', 'cinema', 'no-such-file.mkv'))).toEqual({ error: 'unreadable' })
  })
})
