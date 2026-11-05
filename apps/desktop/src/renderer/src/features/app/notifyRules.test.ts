import { describe, expect, it } from 'vitest'
import { defaultLevel, FOREVER, isMutedIn, levelIn, shouldNotify, SMALL_SPACE } from './notifyRules'

describe('notification prefs', () => {
  it('defaults adapt to the size of the space', () => {
    expect(defaultLevel(3)).toBe('all')
    expect(defaultLevel(SMALL_SPACE)).toBe('all')
    expect(defaultLevel(SMALL_SPACE + 1)).toBe('mentions')
  })

  it('a timed silence wins over the chosen level and ends on time', () => {
    const p = { levels: { s: 'all' as const }, muted: { s: 1_000 } }
    expect(levelIn(p, 's', 3, 999)).toBe('none')
    expect(levelIn(p, 's', 3, 1_000)).toBe('all')
    expect(levelIn({ levels: {}, muted: {} }, 's', 50, 0)).toBe('mentions')
    expect(isMutedIn({ muted: { c: FOREVER } }, 'c', Date.now())).toBe(true)
    expect(isMutedIn({ muted: {} }, 'c')).toBe(false)
  })

  it('decides who interrupts you', () => {
    const base = { dm: false, mentioned: false, channelMuted: false }
    expect(shouldNotify({ ...base, level: 'all' })).toBe(true)
    expect(shouldNotify({ ...base, level: 'mentions' })).toBe(false)
    expect(shouldNotify({ ...base, level: 'mentions', mentioned: true })).toBe(true)
    expect(shouldNotify({ ...base, level: 'none', mentioned: true })).toBe(false)
    expect(shouldNotify({ ...base, dm: true, level: 'none' })).toBe(true)
    expect(shouldNotify({ ...base, dm: true, level: 'all', channelMuted: true })).toBe(false)
    expect(shouldNotify({ ...base, level: 'all', channelMuted: true })).toBe(false)
  })
})
