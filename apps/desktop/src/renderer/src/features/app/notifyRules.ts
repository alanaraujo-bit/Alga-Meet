/** Pure notification rules (no store, no DOM), tested in notifyRules.test.ts. The why lives in notifyPrefs.ts. */

export type NotifyLevel = 'all' | 'mentions' | 'none'

/** Spaces up to this many members default to every message. */
export const SMALL_SPACE = 10
/** "Until I turn it back on" (the largest Date). */
export const FOREVER = 8_640_000_000_000_000
export const HOUR = 60 * 60 * 1000

export interface Prefs {
  /** Explicit level per space; absent = the adaptive default. */
  levels: Record<string, NotifyLevel>
  /** Silenced until (epoch ms) per space, channel or DM id. */
  muted: Record<string, number>
  /** Bumped when a timed silence ends, so selectors re-read the clock. */
  tick: number
}

export const defaultLevel = (members: number): NotifyLevel => (members <= SMALL_SPACE ? 'all' : 'mentions')

export const isMutedIn = (p: Pick<Prefs, 'muted'>, id: string, now = Date.now()): boolean => (p.muted[id] ?? 0) > now

/** The level that applies now: an active timed silence wins over the chosen level. */
export function levelIn(p: Pick<Prefs, 'levels' | 'muted'>, spaceId: string, members: number, now = Date.now()): NotifyLevel {
  if (isMutedIn(p, spaceId, now)) return 'none'
  return p.levels[spaceId] ?? defaultLevel(members)
}

/** Whether a new message interrupts you (desktop notification). DMs always do, unless that conversation is silenced. */
export function shouldNotify(o: { dm: boolean; mentioned: boolean; channelMuted: boolean; level: NotifyLevel }): boolean {
  if (o.channelMuted) return false
  if (o.dm) return true
  return o.level === 'all' || (o.level === 'mentions' && o.mentioned)
}
