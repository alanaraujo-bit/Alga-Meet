import { describe, expect, it } from 'vitest'
import { MUSIC_QUEUE_MAX, MusicClientFrameSchema, musicPosition, youtubeId } from './music.js'

const ID = 'dQw4w9WgXcQ'
const chan = '0190f3a2-7b4c-7d00-8000-000000000001'

describe('youtubeId: the links people paste', () => {
  it('watch, short link, shorts, embed, live, music and mobile', () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&list=PL123&index=4&t=42s`,
      `youtube.com/watch?feature=share&v=${ID}`,
      `https://youtu.be/${ID}?si=abc`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
      `https://www.youtube.com/live/${ID}?feature=share`,
      `https://music.youtube.com/watch?v=${ID}&feature=share`,
      `https://m.youtube.com/watch?v=${ID}`,
      `  https://youtu.be/${ID}  `,
    ]) expect(youtubeId(url), url).toBe(ID)
  })

  it('nothing else: other sites, playlists without a video, broken ids, look-alike hosts', () => {
    for (const url of [
      'https://vimeo.com/123456',
      'https://www.youtube.com/playlist?list=PL123',
      'https://www.youtube.com/watch?v=short',
      `https://www.youtube.com.evil.example/watch?v=${ID}`,
      `https://evilyoutube.com/watch?v=${ID}`,
      `javascript:alert('${ID}')`,
      ID,
      '',
    ]) expect(youtubeId(url), url).toBeNull()
  })
})

describe('frames', () => {
  const ok = (f: object) => MusicClientFrameSchema.safeParse(f).success
  it('accepts the commands of a call', () => {
    expect(ok({ op: 'music_hello', channelId: chan })).toBe(true)
    expect(ok({ op: 'music_add', channelId: chan, url: `https://youtu.be/${ID}` })).toBe(true)
    expect(ok({ op: 'music_control', channelId: chan, action: 'seek', position: 30 })).toBe(true)
    expect(ok({ op: 'music_remove', channelId: chan, trackId: chan })).toBe(true)
    expect(ok({ op: 'music_report', channelId: chan, trackId: chan, kind: 'duration', durationS: 213 })).toBe(true)
  })
  it('refuses the rest', () => {
    expect(ok({ op: 'music_add', channelId: chan, url: 'x'.repeat(2049) })).toBe(false)
    expect(ok({ op: 'music_control', channelId: chan, action: 'explode' })).toBe(false)
    expect(ok({ op: 'music_control', channelId: chan, action: 'seek', position: -1 })).toBe(false)
    expect(ok({ op: 'music_report', channelId: chan, trackId: chan, kind: 'duration', durationS: Infinity })).toBe(false)
    expect(MUSIC_QUEUE_MAX).toBe(50)
  })
})

describe('musicPosition: where the shared song is at a moment of the server clock', () => {
  it('moves while playing, stands still while paused, never past the end', () => {
    expect(musicPosition({ playing: true, position: 10, at: 1000, seq: 1 }, 4000, null)).toBe(13)
    expect(musicPosition({ playing: true, position: 10, at: 5000, seq: 1 }, 4000, null)).toBe(10) // before it starts
    expect(musicPosition({ playing: false, position: 10, at: 1000, seq: 1 }, 99_000, null)).toBe(10)
    expect(musicPosition({ playing: true, position: 200, at: 0, seq: 1 }, 60_000, 213)).toBe(213)
  })
})
