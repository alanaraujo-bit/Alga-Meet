import { describe, expect, it } from 'vitest'
import { DRIFT_S, command, decide, embedUrl, errorText, parsePlayer, refusedHere, unplayable } from './logic'

describe("YouTube's player, by messages only (the app's CSP does not load their script)", () => {
  it('the embed: privacy-enhanced host, API on, no YouTube controls or keyboard, starting where the room is', () => {
    const u = new URL(embedUrl('dQw4w9WgXcQ', 42.7))
    expect(u.origin + u.pathname).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ enablejsapi: '1', autoplay: '1', controls: '0', disablekb: '1', start: '42', rel: '0', playsinline: '1' })
  })

  it('a command is the JSON the player listens for', () => {
    expect(JSON.parse(command('seekTo', [12, true]))).toEqual({ event: 'command', func: 'seekTo', args: [12, true], id: 1, channel: 'widget' })
  })

  it('reads what the player tells: state, time, length, errors; ignores anything else', () => {
    expect(parsePlayer('{"event":"infoDelivery","info":{"playerState":1,"currentTime":8.08,"duration":213.06}}')).toEqual({ state: 1, time: 8.08, duration: 213.06 })
    expect(parsePlayer({ event: 'onStateChange', info: 0 })).toEqual({ state: 0 })
    expect(parsePlayer('{"event":"onError","info":150}')).toEqual({ error: 150 })
    expect(parsePlayer('{"event":"infoDelivery","info":{"volume":50}}')).toEqual({})
    for (const junk of ['nope', '{', 42, null, { event: 'other' }]) expect(parsePlayer(junk)).toEqual({})
  })

  it('which errors mean "this song cannot play here" (skipped for everyone) and which are ours', () => {
    expect([2, 5, 100].every(unplayable)).toBe(true)
    // 101/150 ("embedding forbidden") is checked by the server before a song gets in (oEmbed): at play time it means
    // this app was refused (a bad Referer), and one app's problem must never skip the song for the whole call.
    for (const code of [101, 150, 153]) expect(unplayable(code), String(code)).toBe(false)
    expect([101, 150, 153].every(refusedHere)).toBe(true)
  })
})

describe('keeping in step with the room', () => {
  const at = (o: Partial<Parameters<typeof decide>[0]>) => decide({ shouldPlay: true, target: 60, time: 60, state: 1, ...o })

  it('playing in step: nothing to do', () => {
    expect(at({})).toEqual([])
    expect(at({ time: 60 + DRIFT_S - 0.1 })).toEqual([])
  })

  it('drifted (an ad, a stall, a late join): back to where the room is', () => {
    expect(at({ time: 40 })).toEqual([['seekTo', [60, true]]])
  })

  it('paused by the room, or before the scheduled start: pause, and stand at the right place', () => {
    expect(at({ shouldPlay: false, state: 1, time: 60 })).toEqual([['pauseVideo', []]])
    expect(at({ shouldPlay: false, state: 2, time: 30 })).toEqual([['seekTo', [60, true]]])
    expect(at({ shouldPlay: false, state: 2, time: 60 })).toEqual([])
  })

  it('the room plays but this player stopped (cued, paused by YouTube): play', () => {
    expect(at({ state: 2 })).toEqual([['playVideo', []]])
    expect(at({ state: 5, time: 0, target: 0.4 })).toEqual([['playVideo', []]])
  })

  it('buffering or still unknown: leave it be', () => {
    expect(at({ state: 3, time: 10 })).toEqual([])
    expect(at({ state: -1, time: null })).toEqual([])
  })
})

describe('what the person reads when an add is refused', () => {
  it('one sentence per reason', () => {
    expect(errorText('not_embeddable')).toMatch(/fora do YouTube/)
    expect(errorText('invalid_link')).toMatch(/YouTube/)
    expect(errorText('slow_down')).toMatch(/instante/)
  })
})
