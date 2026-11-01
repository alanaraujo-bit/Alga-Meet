import type { DispatchOf, DispatchType, PresenceStatus, StatusPreference } from '@alga/shared'
import { eq, inArray } from 'drizzle-orm'
import { presenceAudience } from '../access.js'
import type { Db } from '../db/index.js'
import { users } from '../db/schema.js'
import { metrics } from '../metrics.js'

/** One identified gateway socket. `send` receives an already-serialized ServerFrame. */
export interface Conn {
  userId: string
  sessionId: string
  send(data: string): void
  close(code: number, reason: string): void
}

type Payload<T extends DispatchType> = DispatchOf<T> | ((userId: string) => DispatchOf<T> | undefined)

/** In-process connection registry and fan-out. shortcut: single instance only; add Redis pub/sub to scale out. */
export class Hub {
  private readonly byUser = new Map<string, Set<Conn>>()
  /** Set during shutdown: sockets are going away because of us, not because users left. */
  closing = false

  /** Returns true when this is the user's first socket (they just came online). */
  add(conn: Conn): boolean {
    let set = this.byUser.get(conn.userId)
    const first = !set
    if (!set) this.byUser.set(conn.userId, (set = new Set()))
    set.add(conn)
    return first
  }

  /** Returns true when this was the user's last socket (they just went offline). */
  remove(conn: Conn): boolean {
    const set = this.byUser.get(conn.userId)
    if (!set?.delete(conn)) return false
    if (set.size) return false
    this.byUser.delete(conn.userId)
    return true
  }

  isOnline(userId: string): boolean {
    return this.byUser.has(userId)
  }

  connections(userId: string): number {
    return this.byUser.get(userId)?.size ?? 0
  }

  userCount(): number {
    return this.byUser.size
  }

  socketCount(): number {
    let n = 0
    for (const set of this.byUser.values()) n += set.size
    return n
  }

  /** Sends a dispatch to every socket of every listed user. A function payload is evaluated per recipient. */
  dispatch<T extends DispatchType>(userIds: Iterable<string>, t: T, d: Payload<T>): void {
    let frames = 0
    for (const userId of new Set(userIds)) {
      const conns = this.byUser.get(userId)
      if (!conns) continue
      const payload = typeof d === 'function' ? (d as (u: string) => DispatchOf<T> | undefined)(userId) : d
      if (payload === undefined) continue
      const data = JSON.stringify({ op: 'dispatch', t, d: payload })
      for (const c of conns) c.send(data)
      frames += conns.size
    }
    if (!frames) return
    metrics.dispatches.inc({ type: t })
    metrics.framesSent.inc({ type: t }, frames)
  }

  closeSession(sessionId: string, code: number, reason: string): void {
    for (const set of this.byUser.values()) {
      for (const c of set) if (c.sessionId === sessionId) c.close(code, reason)
    }
  }

  closeAll(code: number, reason: string): void {
    for (const set of this.byUser.values()) for (const c of set) c.close(code, reason)
  }
}

export function effectiveStatus(pref: StatusPreference, online: boolean): PresenceStatus {
  if (!online || pref === 'invisible') return 'offline'
  return pref
}

/** Broadcasts a user's current effective presence to friends + co-members. */
export async function broadcastPresence(db: Db, hub: Hub, userId: string, status?: PresenceStatus): Promise<void> {
  if (status === undefined) {
    const [u] = await db.select({ pref: users.statusPreference }).from(users).where(eq(users.id, userId))
    if (!u) return
    status = effectiveStatus(u.pref, hub.isOnline(userId))
  }
  hub.dispatch(await presenceAudience(db, userId), 'PRESENCE_UPDATE', { userId, status })
}

/** Makes `a` and `b` see each other's current presence (after a friendship or a shared space begins). */
export async function exchangePresence(db: Db, hub: Hub, a: string, bs: string[]): Promise<void> {
  const ids = [a, ...bs]
  const rows = await db.select({ id: users.id, pref: users.statusPreference }).from(users).where(inArray(users.id, ids))
  const prefs = new Map(rows.map((r) => [r.id, r.pref]))
  const statusOf = (id: string) => effectiveStatus(prefs.get(id) ?? 'online', hub.isOnline(id))
  const aStatus = statusOf(a)
  if (aStatus !== 'offline') hub.dispatch(bs, 'PRESENCE_UPDATE', { userId: a, status: aStatus })
  for (const b of bs) {
    const s = statusOf(b)
    if (s !== 'offline') hub.dispatch([a], 'PRESENCE_UPDATE', { userId: b, status: s })
  }
}

/** Trailing throttle: `fn` runs at most once per `ms` per key; calls in between collapse into the latest one. */
export class Throttle {
  private readonly slots = new Map<string, { last: number; timer?: NodeJS.Timeout; next?: () => Promise<void> }>()

  constructor(private readonly ms: number, private readonly onError: (err: unknown) => void) {}

  run(key: string, fn: () => Promise<void>): Promise<void> | undefined {
    const now = Date.now()
    let slot = this.slots.get(key)
    if (!slot || (!slot.timer && now - slot.last >= this.ms)) {
      this.slots.set(key, { last: now })
      return fn()
    }
    slot.next = fn
    slot.timer ??= setTimeout(() => {
      const next = slot!.next!
      // Re-arms the window: the slot is replaced, so a call right after this one waits again.
      this.slots.set(key, { last: Date.now() })
      next().catch(this.onError)
    }, slot.last + this.ms - now)
    return undefined
  }

  /** Drops idle slots (call periodically) and pending timers (on shutdown). */
  prune(all = false): void {
    const cutoff = Date.now() - this.ms
    for (const [k, s] of this.slots) {
      if (all) clearTimeout(s.timer)
      if (all || (!s.timer && s.last < cutoff)) this.slots.delete(k)
    }
  }
}
