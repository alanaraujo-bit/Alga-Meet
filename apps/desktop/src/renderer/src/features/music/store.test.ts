import type { Dispatch, MusicState } from '@alga/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listeners: Array<(d: Dispatch) => void> = []
const sent: unknown[] = []
const session = { music: true, send: (f: unknown) => (sent.push(f), true) }
vi.mock('@/store/session', () => ({
  onDispatch: (fn: (d: Dispatch) => void) => {
    listeners.push(fn)
    return () => listeners.splice(listeners.indexOf(fn), 1)
  },
  useSession: { getState: () => session },
}))
const store = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
})

const { useData } = await import('@/store/data')
const m = await import('./store')
const { useMusic } = m

const CH = '0190f3a2-7b4c-7d00-8000-0000000000aa'
const OTHER = '0190f3a2-7b4c-7d00-8000-0000000000bb'
const dispatch = (d: Dispatch) => {
  for (const l of [...listeners]) l(d)
}
const inCall = (channelId: string | null) =>
  useData.setState((st) => ({ voiceStates: channelId ? { me: { userId: 'me', channelId } } : {}, me: { ...(st.me ?? {}), id: 'me' } }) as never)
const state = (o: Partial<MusicState> = {}): MusicState => ({
  channelId: CH, now: { id: 't1', videoId: 'dQw4w9WgXcQ', title: 'Song', author: 'A', durationS: null, addedBy: 'u2' },
  queue: [], playback: { playing: true, position: 0, at: 1000, seq: 1 }, serverNow: 1000, last: null, ...o,
})

let stop: () => void = () => {}
beforeEach(() => {
  stop()
  sent.length = 0
  session.music = true
  inCall(null)
  stop = m.startMusic()
})

describe('following my call', () => {
  it('asks for the music of the call I enter, forgets it when I leave', () => {
    inCall(CH)
    expect(sent).toEqual([{ op: 'music_hello', channelId: CH }])
    dispatch({ t: 'MUSIC_STATE', d: state() })
    expect(useMusic.getState().state?.now?.videoId).toBe('dQw4w9WgXcQ')
    inCall(null)
    expect(useMusic.getState().state).toBeNull()
  })

  it('ignores the music of another call, and never sends on a server without music', () => {
    inCall(CH)
    dispatch({ t: 'MUSIC_STATE', d: state({ channelId: OTHER }) })
    expect(useMusic.getState().state).toBeNull()
    stop()
    session.music = false
    sent.length = 0
    stop = m.startMusic()
    inCall(OTHER)
    expect(sent).toEqual([])
    expect(m.addLink('https://youtu.be/dQw4w9WgXcQ')).toBe('disabled')
  })

  it('a new gateway session (READY) asks again', () => {
    inCall(CH)
    sent.length = 0
    dispatch({ t: 'READY', d: { music: true } } as Dispatch)
    expect(sent).toEqual([{ op: 'music_hello', channelId: CH }])
  })

  it('keeps the offset to the server clock', () => {
    inCall(CH)
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    dispatch({ t: 'MUSIC_STATE', d: state({ serverNow: 12_500 }) })
    expect(m.serverTime()).toBe(12_500)
    vi.setSystemTime(11_000)
    expect(m.serverTime()).toBe(13_500)
    vi.useRealTimers()
  })
})

describe('adding a song', () => {
  it('a YouTube link goes to the server; anything else is answered here, at once', () => {
    inCall(CH)
    sent.length = 0
    expect(m.addLink('  https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3 ')).toBe('sent')
    expect(sent).toEqual([{ op: 'music_add', channelId: CH, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3' }])
    expect(m.addLink('https://vimeo.com/1')).toBe('invalid')
    expect(useMusic.getState().error).toMatch(/YouTube/)
    expect(sent).toHaveLength(1)
  })

  it('outside a call there is nobody to play for', () => {
    expect(m.addLink('https://youtu.be/dQw4w9WgXcQ')).toBe('no_call')
    expect(sent).toEqual([])
  })

  it("the server's refusal becomes one sentence; the next state clears it", () => {
    inCall(CH)
    dispatch({ t: 'MUSIC_ERROR', d: { op: 'music_add', reason: 'not_embeddable' } })
    expect(useMusic.getState().error).toMatch(/fora do YouTube/)
    dispatch({ t: 'MUSIC_STATE', d: state({ last: { kind: 'add', by: 'me', title: 'Song' } }) })
    expect(useMusic.getState().error).toBeNull()
  })
})

describe('controls and reports', () => {
  it('go to my call, about the song playing', () => {
    inCall(CH)
    dispatch({ t: 'MUSIC_STATE', d: state() })
    sent.length = 0
    m.control('pause')
    m.control('seek', 30)
    m.remove('t9')
    m.report('ended')
    m.report('duration', 213)
    expect(sent).toEqual([
      { op: 'music_control', channelId: CH, action: 'pause' },
      { op: 'music_control', channelId: CH, action: 'seek', position: 30 },
      { op: 'music_remove', channelId: CH, trackId: 't9' },
      { op: 'music_report', channelId: CH, trackId: 't1', kind: 'ended' },
      { op: 'music_report', channelId: CH, trackId: 't1', kind: 'duration', durationS: 213 },
    ])
  })

  it('my volume is mine and stays between sessions', () => {
    m.setVolume(0.3)
    expect(useMusic.getState().volume).toBe(0.3)
    m.setVolume(4)
    expect(useMusic.getState().volume).toBe(1)
    expect(JSON.parse(store.get('alga.music.v1')!)).toMatchObject({ volume: 1 })
  })
})
