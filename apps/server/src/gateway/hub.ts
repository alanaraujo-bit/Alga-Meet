import { liveStatus, sameActivity, type Activity, type CustomStatus, type RecentActivity, type DispatchOf, type DispatchType, type Presence, type PresenceStatus, type StatusPreference } from '@alga/shared'
import { eq, inArray } from 'drizzle-orm'
import { blockedWith, presenceAudience } from '../access.js'
import type { Db } from '../db/index.js'
import { users } from '../db/schema.js'
import { metrics } from '../metrics.js'

/** One identified gateway socket. `send` receives an already-serialized ServerFrame. */
export interface Conn {
  userId: string
  sessionId: string
  send(data: string): void
  close(code: number, reason: string): void
  /** E2EE device this socket speaks for (set by a valid e2ee_join): E2EE_* dispatches go only to its sockets. */
  e2eeDevice?: string
}

type Payload<T extends DispatchType> = DispatchOf<T> | ((userId: string) => DispatchOf<T> | undefined)

const RECENT_WINDOW_MS = 14 * 24 * 3600_000
const RECENT_MAX = 6
/** A recent entry plus what it takes to count a session once: its startedAt and the total before it. */
type Recent = RecentActivity & { since: number; base: number }
/** Shorter than this is a glance, not something they did. */
const RECENT_MIN_MS = 60_000

/** In-process connection registry and fan-out. shortcut: single instance only; add Redis pub/sub to scale out. */
export class Hub {
  private readonly byUser = new Map<string, Set<Conn>>()
  /** Rich presence per user, owned by the socket that set it (last writer wins across devices). Memory only. */
  private readonly activities = new Map<string, { activity: Activity; conn: Conn }>()
  /** Custom status per user, kept until their last socket closes (the client sends it again on every READY). */
  private readonly customs = new Map<string, CustomStatus>()
  /**
   * Finished activities per user (ProfileExtras.recent). shortcut: memory only, so a restart forgets them; move to
   * a table if "Atividade recente" proves worth keeping across deploys.
   */
  private readonly recent = new Map<string, Recent[]>()
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
    this.customs.delete(conn.userId)
    return true
  }

  /** Sets (or clears, with null) the user's activity. Returns whether what others see changed. */
  setActivity(conn: Conn, activity: Activity | null): boolean {
    const prev = this.activities.get(conn.userId)
    // Another device saying "nothing here" does not end what this one is doing.
    if (!activity && prev && prev.conn !== conn) return false
    if (prev && !(activity && activity.name === prev.activity.name && activity.startedAt === prev.activity.startedAt)) this.remember(conn.userId, prev.activity)
    if (activity) this.activities.set(conn.userId, { activity, conn })
    else this.activities.delete(conn.userId)
    return !sameActivity(prev?.activity, activity)
  }

  /** Clears the activity if `conn` set it (its socket is closing). Returns whether it did. */
  dropActivity(conn: Conn): boolean {
    const prev = this.activities.get(conn.userId)
    if (prev?.conn !== conn) return false
    this.remember(conn.userId, prev.activity)
    this.activities.delete(conn.userId)
    return true
  }

  /** Returns whether it changed. */
  setCustom(userId: string, status: CustomStatus | null): boolean {
    const prev = JSON.stringify(this.customs.get(userId) ?? null)
    if (status) this.customs.set(userId, status)
    else this.customs.delete(userId)
    return prev !== JSON.stringify(status)
  }

  /** Recent finished activities, newest first, without anything older than the window. */
  recentOf(userId: string, now = Date.now()): RecentActivity[] {
    return this.liveRecent(userId, now).map(({ since: _s, base: _b, ...r }) => r)
  }

  private liveRecent(userId: string, now: number): Recent[] {
    return (this.recent.get(userId) ?? []).filter((r) => now - r.lastAt < RECENT_WINDOW_MS)
  }

  /** Drops what aged out of the window (call periodically): memory stays bounded by the active users. */
  pruneRecent(now = Date.now()): void {
    for (const userId of this.recent.keys()) {
      const live = this.liveRecent(userId, now)
      if (live.length) this.recent.set(userId, live)
      else this.recent.delete(userId)
    }
  }

  private remember(userId: string, a: Activity, now = Date.now()): void {
    const spent = now - a.startedAt
    if (spent < RECENT_MIN_MS) return
    const list = this.liveRecent(userId, now)
    const old = list.find((r) => r.name === a.name && r.kind === a.kind)
    // The same session seen twice (a reconnect resends it) replaces its share instead of adding it again.
    const base = old && old.since === a.startedAt ? old.base : (old?.totalMs ?? 0)
    const entry: Recent = {
      kind: a.kind, name: a.name, lastAt: now, totalMs: Math.min(RECENT_WINDOW_MS, base + spent), since: a.startedAt, base,
      ...(a.icon && { icon: a.icon }), ...(a.steamAppId && { steamAppId: a.steamAppId }),
    }
    this.recent.set(userId, [entry, ...list.filter((r) => r !== old)].slice(0, RECENT_MAX))
  }

  activityOf(userId: string): Activity | undefined {
    return this.activities.get(userId)?.activity
  }

  /** The Presence others see: the activity rides along only while the user is visible. */
  presence(userId: string, status: PresenceStatus): Presence {
    if (status === 'offline') return { userId, status }
    const activity = this.activityOf(userId)
    const custom = liveStatus(this.customs.get(userId))
    return { userId, status, ...(activity && { activity }), ...(custom && { custom }) }
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

  /** Sends a dispatch only to the sockets bound to one E2EE device. Returns whether any socket got it. */
  toDevice<T extends DispatchType>(userId: string, deviceId: string, t: T, d: DispatchOf<T>): boolean {
    let frames = 0
    let data: string | undefined
    for (const c of this.byUser.get(userId) ?? []) {
      if (c.e2eeDevice !== deviceId) continue
      c.send(data ??= JSON.stringify({ op: 'dispatch', t, d }))
      frames++
    }
    if (!frames) return false
    metrics.dispatches.inc({ type: t })
    metrics.framesSent.inc({ type: t }, frames)
    return true
  }

  deviceOnline(userId: string, deviceId: string): boolean {
    for (const c of this.byUser.get(userId) ?? []) if (c.e2eeDevice === deviceId) return true
    return false
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
  hub.dispatch(await presenceAudience(db, userId), 'PRESENCE_UPDATE', hub.presence(userId, status))
}

/** Makes `a` and `b` see each other's current presence (after a friendship or a shared space begins). */
export async function exchangePresence(db: Db, hub: Hub, a: string, bs0: string[]): Promise<void> {
  const blocks = await blockedWith(db, a)
  const bs = bs0.filter((b) => !blocks.has(b))
  const ids = [a, ...bs]
  const rows = await db.select({ id: users.id, pref: users.statusPreference }).from(users).where(inArray(users.id, ids))
  const prefs = new Map(rows.map((r) => [r.id, r.pref]))
  const statusOf = (id: string) => effectiveStatus(prefs.get(id) ?? 'online', hub.isOnline(id))
  const aStatus = statusOf(a)
  if (aStatus !== 'offline') hub.dispatch(bs, 'PRESENCE_UPDATE', hub.presence(a, aStatus))
  for (const b of bs) {
    const s = statusOf(b)
    if (s !== 'offline') hub.dispatch([a], 'PRESENCE_UPDATE', hub.presence(b, s))
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
