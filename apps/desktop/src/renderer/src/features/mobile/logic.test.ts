import { describe, expect, it } from 'vitest'
import { depthOf, placeFor } from './logic'

const home = { kind: 'home' } as const
const space = (channelId: string | null) => ({ kind: 'space', spaceId: 's1', channelId }) as const
const dm = { kind: 'dm', channelId: 'd1' } as const

describe('depthOf', () => {
  it('spaces: list, channels, conversation', () => {
    expect(depthOf('spaces', home, false)).toBe(0)
    expect(depthOf('spaces', space(null), false)).toBe(1)
    expect(depthOf('spaces', space('c1'), false)).toBe(1)
    expect(depthOf('spaces', space('c1'), true)).toBe(2)
  })
  it('dms: list, conversation; other tabs are flat', () => {
    expect(depthOf('dms', home, true)).toBe(0)
    expect(depthOf('dms', dm, true)).toBe(1)
    expect(depthOf('friends', dm, true)).toBe(0)
  })
})

describe('placeFor', () => {
  it('a DM or a new channel opens it in its tab', () => {
    expect(placeFor(dm, home)).toEqual({ tab: 'dms', open: true })
    expect(placeFor(space('c1'), home)).toEqual({ tab: 'spaces', open: true })
    expect(placeFor(space('c2'), space('c1'))).toEqual({ tab: 'spaces', open: true })
  })
  it('a space without a channel shows its channel list; home changes nothing', () => {
    expect(placeFor(space(null), home)).toEqual({ tab: 'spaces', open: false })
    expect(placeFor(home, dm)).toBeNull()
    expect(placeFor(space('c1'), space('c1'))).toBeNull()
  })
})
