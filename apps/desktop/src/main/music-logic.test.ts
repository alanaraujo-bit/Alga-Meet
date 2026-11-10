import { describe, expect, it } from 'vitest'
import { embedReferer, isYoutubeEmbed } from './music-logic'

describe("YouTube's embedded player in a file:// app", () => {
  it('is identified by our own API origin (YouTube refuses an embed without a Referer: error 153)', () => {
    expect(embedReferer('https://api-staging-b3ea.up.railway.app')).toBe('https://api-staging-b3ea.up.railway.app/')
    expect(embedReferer('http://localhost:4000')).toBe('http://localhost:4000/')
    // YouTube refuses an IP (error 150): a local API by IP is named localhost.
    expect(embedReferer('http://127.0.0.1:4390')).toBe('http://localhost:4390/')
  })

  it('only the embed document gets it, nothing else from YouTube or anywhere', () => {
    expect(isYoutubeEmbed('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1')).toBe(true)
    for (const url of [
      'https://www.youtube-nocookie.com/s/player/base.js',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'http://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com.evil.example/embed/x',
      'https://api.example.com/embed/x',
    ]) expect(isYoutubeEmbed(url), url).toBe(false)
  })
})
