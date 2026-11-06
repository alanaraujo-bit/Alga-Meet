import type { CinemaAudioTrack, CinemaFilm } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { audioRoute, audioRow, cardMeta, resolution, videoLabel, watchOptions } from './film'

const a = (o: Partial<CinemaAudioTrack>): CinemaAudioTrack => ({ id: 0, lang: 'por', title: null, sourceCodec: 'ac3', channels: 6, out: 'aac', mime: '', default: false, ...o })
const film = (o: Partial<CinemaFilm> = {}): CinemaFilm => ({
  title: 'Duna Parte Dois (2024)', durationS: 9960, width: 3840, height: 1606, hdr: 'hdr10', videoCodec: 'hevc', videoMime: '', bitrateKbps: 15000,
  audio: [a({ id: 0, default: true, title: 'Dublado' }), a({ id: 1, lang: 'eng', title: 'Original' })],
  subtitles: [{ id: 0, lang: 'por', title: 'Português (Brasil)', format: 'vtt', external: false }], chapters: [], episode: null, ...o,
})

describe('film labels', () => {
  it('resolution by either side (a 2.39 1080p film is 1920×804)', () => {
    expect(resolution({ width: 3840, height: 1606 })).toBe('4K')
    expect(resolution({ width: 1920, height: 804 })).toBe('1080p')
    expect(resolution({ width: 1280, height: 536 })).toBe('720p')
    expect(resolution({ width: 640, height: 360 })).toBe('360p')
  })

  it('video: short for the card and top bar, full for the sheet', () => {
    expect(videoLabel(film())).toBe('4K HDR')
    expect(videoLabel(film(), true)).toBe('4K · HDR10 · HEVC')
    expect(videoLabel(film({ hdr: 'sdr', videoCodec: 'h264', width: 1920, height: 1080 }), true)).toBe('1080p · H.264')
  })

  it('audio route: converted or as is', () => {
    expect(audioRoute(a({}))).toBe('Dolby Digital → AAC 5.1')
    expect(audioRoute(a({ sourceCodec: 'aac', out: 'copy', channels: 2 }))).toBe('AAC Estéreo')
    expect(audioRow(a({ lang: 'eng', title: 'Original' }))).toEqual({ code: 'EN', name: 'Inglês 5.1', kind: 'Original', route: 'Dolby Digital → AAC 5.1' })
    expect(audioRow(a({ lang: null })).code).toBe('··')
  })

  it('card meta', () => {
    expect(cardMeta(film(), '2h46')).toEqual(['2h46', '4K HDR', 'Áudio 5.1'])
    expect(cardMeta(film({ audio: [] }), '2h46')).toEqual(['2h46', '4K HDR'])
  })

  it('"Você assiste": a foreign track takes the Portuguese subtitle', () => {
    expect(watchOptions(film())).toEqual([
      { audioId: 0, subtitleId: null, label: 'Dublado · Português 5.1' },
      { audioId: 1, subtitleId: 0, label: 'Legendado · Inglês 5.1' },
    ])
    // no Portuguese subtitle: the track's own title, else just the language
    expect(watchOptions(film({ subtitles: [], audio: [a({ id: 1, lang: 'eng', title: null, channels: 2 })] }))).toEqual([{ audioId: 1, subtitleId: null, label: 'Inglês Estéreo' }])
  })
})
