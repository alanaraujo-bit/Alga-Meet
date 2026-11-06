import { CINEMA_MAX_FRAME_BYTES, CinemaClientFrameSchema, type CinemaFilm } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { fitFilmFrame } from './frame'

const film: CinemaFilm = {
  title: 'Filme', durationS: 6000, width: 1920, height: 1080, hdr: 'sdr', videoCodec: 'h264', videoMime: 'video/mp4; codecs="avc1.640028"',
  bitrateKbps: 4000, audio: [], episode: null,
  subtitles: Array.from({ length: 30 }, (_, id) => ({ id, lang: 'por', title: 's'.repeat(100), format: 'vtt' as const, external: false })),
  chapters: Array.from({ length: 100 }, (_, i) => ({ startS: i * 10, title: 'x'.repeat(120) })),
}
const open = (f: CinemaFilm) => ({ op: 'cinema_open' as const, channelId: '0190a0a0-0000-7000-8000-00000000c0c0', film: f, startS: 0 })

describe('fitFilmFrame', () => {
  it('leaves a small frame untouched', () => {
    const f = open({ ...film, chapters: [{ startS: 0, title: 'Início' }] })
    expect(fitFilmFrame(f)).toBe(f)
  })

  it('100 long chapter titles: trimmed under the limit, still valid, chapters kept when titles suffice', () => {
    const f = open(film)
    expect(JSON.stringify(f).length).toBeGreaterThan(CINEMA_MAX_FRAME_BYTES)
    const out = fitFilmFrame(f)
    expect(JSON.stringify(out).length).toBeLessThan(CINEMA_MAX_FRAME_BYTES)
    expect(out.film.chapters.length).toBeGreaterThan(50)
    expect(CinemaClientFrameSchema.safeParse(out).success).toBe(true)
  })

  it('drops chapters from the end, then track titles, when titles alone do not fit', () => {
    const audio = Array.from({ length: 32 }, (_, id) => ({ id, lang: 'por', title: 'a'.repeat(120), sourceCodec: 'aac', channels: 2, out: 'copy' as const, mime: 'audio/mp4; codecs="mp4a.40.2"', default: id === 0 }))
    const subtitles = Array.from({ length: 64 }, (_, id) => ({ id, lang: 'por', title: 's'.repeat(120), format: 'vtt' as const, external: false }))
    const out = fitFilmFrame(open({ ...film, audio, subtitles, chapters: film.chapters.map((c) => ({ ...c, title: 'c'.repeat(120) })) }))
    expect(JSON.stringify(out).length).toBeLessThan(CINEMA_MAX_FRAME_BYTES)
    expect(out.film.audio[0]!.title).toBeNull()
    expect(CinemaClientFrameSchema.safeParse(out).success).toBe(true)
  })
})
