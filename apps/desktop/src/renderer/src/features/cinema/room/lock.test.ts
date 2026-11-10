import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCK_HOLD_MS, TAP_MS, onRelease } from './lock'

describe('Space: a tap plays or pauses, a 3 s hold locks or unlocks', () => {
  const at = (since: number) => ({ since, fired: false })

  it('a quick press is play/pause (on release, so a hold never pauses the whole room first)', () => {
    expect(onRelease(at(0), TAP_MS - 1, false)).toBe('toggle')
  })

  it('held past a tap and let go before 3 s: nothing happens (a lock that was not wanted)', () => {
    expect(onRelease(at(0), TAP_MS, false)).toBeNull()
    expect(onRelease(at(0), LOCK_HOLD_MS - 1, false)).toBeNull()
  })

  it('locked, any release short of 3 s only reminds how to unlock', () => {
    expect(onRelease(at(0), 10, true)).toBe('hint')
    expect(onRelease(at(0), LOCK_HOLD_MS - 1, true)).toBe('hint')
  })

  it('once the hold fired, letting go does nothing more', () => {
    expect(onRelease({ since: 0, fired: true }, LOCK_HOLD_MS + 500, false)).toBeNull()
    expect(onRelease({ since: 0, fired: true }, LOCK_HOLD_MS + 500, true)).toBeNull()
  })
})

describe('the lock store', () => {
  beforeEach(() => vi.useFakeTimers())

  it('a hold of 3 s locks, another unlocks; a hold cut short changes nothing', async () => {
    const { useLock, startHold, endHold, resetLock } = await import('./lock')
    resetLock()
    startHold()
    vi.advanceTimersByTime(LOCK_HOLD_MS - 1)
    expect(useLock.getState().locked).toBe(false)
    vi.advanceTimersByTime(1)
    expect(useLock.getState()).toMatchObject({ locked: true, holdSince: null })
    expect(endHold()).toBeNull()

    startHold()
    vi.advanceTimersByTime(1000)
    expect(endHold()).toBe('hint')
    vi.advanceTimersByTime(LOCK_HOLD_MS)
    expect(useLock.getState().locked).toBe(true) // the timer died with the release

    startHold()
    vi.advanceTimersByTime(LOCK_HOLD_MS)
    expect(useLock.getState().locked).toBe(false)
    endHold()
  })

  it('a second press while holding (auto-repeat, two keys) does not restart the count', async () => {
    const { useLock, startHold, endHold, resetLock } = await import('./lock')
    resetLock()
    startHold()
    vi.advanceTimersByTime(2000)
    startHold()
    vi.advanceTimersByTime(1000)
    expect(useLock.getState().locked).toBe(true)
    endHold()
  })

  it('reset (leaving the room, losing focus mid-hold) unlocks and drops a hold in progress', async () => {
    const { useLock, startHold, resetLock, cancelHold } = await import('./lock')
    resetLock()
    startHold()
    cancelHold()
    vi.advanceTimersByTime(LOCK_HOLD_MS)
    expect(useLock.getState().locked).toBe(false)
    startHold()
    vi.advanceTimersByTime(LOCK_HOLD_MS)
    expect(useLock.getState().locked).toBe(true)
    resetLock()
    expect(useLock.getState()).toMatchObject({ locked: false, holdSince: null })
  })
})
