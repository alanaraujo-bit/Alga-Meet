/** Pure time math over voice sessions (BRT days, overlaps, concurrency, event attendance). No I/O. */
import { RECAP_EVENT_MINUTES, addLocalDays, nextStart, zonedDay, zonedToUtc, type EventSchedule } from '@alga/shared'

export const MIN_MS = 60_000

/** A voice session clipped to a window, in ms. */
export interface Span {
  userId: string
  channelId: string
  spaceId: string | null
  from: number
  to: number
}

/** 'YYYY-MM-DD' + n days. */
export const addDays = (day: string, n: number) => addLocalDays(`${day}T00:00`, n).slice(0, 10)
/** Start of a BRT day as an instant (ms). */
export const dayStart = (day: string) => zonedToUtc(`${day}T00:00`)!.getTime()
/** Monday of the BRT week containing `day`. */
export function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return addDays(day, -((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7))
}

export function clip(rows: { userId: string; channelId: string; spaceId: string | null; joinedAt: Date; leftAt: Date }[], from: number, to: number): Span[] {
  const out: Span[] = []
  for (const r of rows) {
    const a = Math.max(r.joinedAt.getTime(), from)
    const b = Math.min(r.leftAt.getTime(), to)
    if (b > a) out.push({ userId: r.userId, channelId: r.channelId, spaceId: r.spaceId, from: a, to: b })
  }
  return out
}

/** ms of each span per BRT day. */
export function msByDay(s: Span): Map<string, number> {
  const out = new Map<string, number>()
  for (let a = s.from; a < s.to;) {
    const day = zonedDay(a)
    const b = Math.min(s.to, dayStart(addDays(day, 1)))
    out.set(day, (out.get(day) ?? 0) + b - a)
    a = b
  }
  return out
}

export const groupBy = <T>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, T[]>()
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x])
  return m
}

/** ms each pair of users spent in the same channel at the same time (both directions). */
export function pairMs(spans: Span[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  const add = (a: string, b: string, ms: number) => {
    let m = out.get(a)
    if (!m) out.set(a, m = new Map())
    m.set(b, (m.get(b) ?? 0) + ms)
  }
  // shortcut: quadratic per channel and window; fine for friend groups, revisit for channels with hundreds of sessions.
  for (const list of groupBy(spans, (s) => s.channelId).values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const x = list[i]!, y = list[j]!
        if (x.userId === y.userId) continue
        const ms = Math.min(x.to, y.to) - Math.max(x.from, y.from)
        if (ms > 0) { add(x.userId, y.userId, ms); add(y.userId, x.userId, ms) }
      }
    }
  }
  return out
}

/** ms during which at least `min` distinct users were together, within one channel's spans. */
export function concurrentMs(spans: Span[], min: number): number {
  const points = spans.flatMap((s) => [[s.from, 1], [s.to, -1]] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let n = 0
  let since = 0
  let total = 0
  for (const [t, d] of points) {
    if (n >= min) total += t - since
    n += d
    since = t
  }
  return total
}

export interface Attendance {
  startsAt: Date
  userIds: string[]
}

/** Occurrences of `ev` starting in [from, to) and who spent RECAP_EVENT_MINUTES+ in its channel during each. */
export function attendance(ev: EventSchedule & { channelId: string | null }, spans: Span[], from: number, to: number): Attendance[] {
  if (!ev.channelId) return []
  const inChannel = spans.filter((s) => s.channelId === ev.channelId)
  const out: Attendance[] = []
  for (let s = nextStart(ev, from - 1); s && s.getTime() < to; s = ev.weekly ? nextStart(ev, s) : null) {
    const a = s.getTime()
    const b = a + ev.durationMinutes * MIN_MS
    const per = new Map<string, number>()
    for (const x of inChannel) {
      const ms = Math.min(x.to, b) - Math.max(x.from, a)
      if (ms > 0) per.set(x.userId, (per.get(x.userId) ?? 0) + ms)
    }
    out.push({ startsAt: s, userIds: [...per].filter(([, ms]) => ms >= RECAP_EVENT_MINUTES * MIN_MS).map(([id]) => id) })
  }
  return out
}
