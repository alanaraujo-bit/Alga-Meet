import { describe, expect, it, vi } from 'vitest'

vi.mock('@/store/session', () => ({ onDispatch: () => () => {}, useSession: { getState: () => ({ music: true, musicPlaylists: true, send: () => true }) } }))
vi.mock('../cinema/store', () => ({ useCinema: { getState: () => ({ session: null, mine: { seated: false } }), subscribe: () => () => {} } }))
Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } })

const { parseCommand } = await import('./popout')
const { nearestCorner } = await import('./float')
const { shuffled } = await import('./playlists')

describe('commands from the floating window', () => {
  it('takes only the known, plain shapes', () => {
    expect(parseCommand('{"kind":"control","action":"skip"}')).toEqual({ kind: 'control', action: 'skip' })
    expect(parseCommand('{"kind":"control","action":"seek","position":42}')).toEqual({ kind: 'control', action: 'seek', position: 42 })
    expect(parseCommand('{"kind":"volume","volume":7}')).toEqual({ kind: 'volume', volume: 1 })
    expect(parseCommand('{"kind":"report","trackId":"t1","report":"duration","durationS":213}')).toEqual({ kind: 'report', trackId: 't1', report: 'duration', durationS: 213 })
    expect(parseCommand('{"kind":"popIn"}')).toEqual({ kind: 'popIn' })
    expect(parseCommand('{"kind":"hello"}')).toEqual({ kind: 'hello' })
  })
  it('drops the rest', () => {
    for (const raw of ['nope', 'null', '{"kind":"control","action":"explode"}', '{"kind":"volume","volume":"loud"}', '{"kind":"report","trackId":1}', '{"kind":"eval"}']) {
      expect(parseCommand(raw), raw).toBeNull()
    }
    expect(parseCommand('{"kind":"control","action":"seek","position":-5}')).toEqual({ kind: 'control', action: 'seek' })
  })
})

describe('the mini player springs to the nearest corner', () => {
  it('by where its middle was let go', () => {
    expect(nearestCorner(10, 10, 372, 264, 1600, 900)).toBe('tl')
    expect(nearestCorner(1200, 40, 372, 264, 1600, 900)).toBe('tr')
    expect(nearestCorner(30, 600, 372, 264, 1600, 900)).toBe('bl')
    expect(nearestCorner(1100, 620, 372, 264, 1600, 900)).toBe('br')
  })
})

describe('shuffle', () => {
  it('keeps every song once, leaves the playlist as it was', () => {
    const a = ['a', 'b', 'c', 'd', 'e']
    let i = 0
    const out = shuffled(a, () => [0.1, 0.9, 0.5, 0.3][i++ % 4]!)
    expect([...out].sort()).toEqual(a)
    expect(out).not.toEqual(a)
    expect(a).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})
