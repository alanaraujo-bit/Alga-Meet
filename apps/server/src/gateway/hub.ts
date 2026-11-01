import type { DispatchOf, DispatchType, PresenceStatus, StatusPreference } from '@alga/shared'
import { eq, inArray } from 'drizzle-orm'
import { presenceAudience } from '../access.js'
import type { Db } from '../db/index.js'
import { users } from '../db/schema.js'

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

  /** Sends a dispatch to every socket of every listed user. A function payload is evaluated per recipient. */
  dispatch<T extends DispatchType>(userIds: Iterable<string>, t: T, d: Payload<T>): void {
    for (const userId of new Set(userIds)) {
      const conns = this.byUser.get(userId)
      if (!conns) continue
      const payload = typeof d === 'function' ? (d as (u: string) => DispatchOf<T> | undefined)(userId) : d
      if (payload === undefined) continue
      const data = JSON.stringify({ op: 'dispatch', t, d: payload })
      for (const c of conns) c.send(data)
    }
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
