// The room's lock ("cadeado"): hold Space (or the lock badge) for 3 s and the room stops answering clicks and keys,
// so a bumped keyboard, a cat or a hand reaching for the popcorn cannot pause or seek the film for everyone. Holding
// again for 3 s unlocks. Only for this person; the film, the voices and the chat keep going.
import { create } from 'zustand'

export const LOCK_HOLD_MS = 3_000
/** Released before this, Space is a tap (play/pause); held longer, it is a try at the lock (the ring shows up). */
export const TAP_MS = 350

export interface Hold { since: number; fired: boolean }

/**
 * What letting go of Space (or the badge) means. Play/pause happens on release, never on press: pressing would pause
 * the whole room before anyone knew the person meant to hold.
 */
export function onRelease(hold: Hold, now: number, locked: boolean): 'toggle' | 'hint' | null {
  if (hold.fired) return null
  if (locked) return 'hint'
  return now - hold.since < TAP_MS ? 'toggle' : null
}

interface LockState {
  locked: boolean
  /** A hold in progress (Date.now() of the press), for the ring. */
  holdSince: number | null
  /** Last time the lock was told about (a click or key while locked, a lock/unlock): the badge shows for a moment. */
  pokedAt: number
  /** Last lock/unlock, for the brief confirmation. */
  changedAt: number
}

export const useLock = create<LockState>(() => ({ locked: false, holdSince: null, pokedAt: 0, changedAt: 0 }))

let hold: Hold | null = null
let timer: ReturnType<typeof setTimeout> | undefined

/** Space went down (not an auto-repeat) or the badge was pressed. A press during a hold does not restart it. */
export function startHold(): void {
  if (hold) return
  const now = Date.now()
  hold = { since: now, fired: false }
  useLock.setState({ holdSince: now })
  timer = setTimeout(() => {
    if (!hold) return
    hold.fired = true
    const now = Date.now()
    useLock.setState((s) => ({ locked: !s.locked, holdSince: null, pokedAt: now, changedAt: now }))
  }, LOCK_HOLD_MS)
}

/** Space came up or the badge was released: 'toggle' = play/pause, 'hint' = show how to unlock. */
export function endHold(): 'toggle' | 'hint' | null {
  if (!hold) return null
  const h = hold
  hold = null
  clearTimeout(timer)
  const r = onRelease(h, Date.now(), useLock.getState().locked)
  useLock.setState({ holdSince: null, ...(r === 'hint' ? { pokedAt: Date.now() } : {}) })
  return r
}

/** The window lost focus mid-hold: its keyup will never come. */
export function cancelHold(): void {
  hold = null
  clearTimeout(timer)
  useLock.setState({ holdSince: null })
}

/** "Travar a tela" in the ⋯ menu: the same lock, for whoever finds it there first. */
export function lockNow(): void {
  cancelHold()
  const now = Date.now()
  useLock.setState({ locked: true, pokedAt: now, changedAt: now })
}

/** A click or a key while locked: show the badge. */
export const pokeLock = (): void => useLock.setState({ pokedAt: Date.now() })

/** Leaving the room: never come back to a locked one. */
export function resetLock(): void {
  cancelHold()
  useLock.setState({ locked: false, pokedAt: 0, changedAt: 0 })
}

export const isLocked = (): boolean => useLock.getState().locked
