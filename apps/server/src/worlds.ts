/**
 * Alga Worlds, server half (wire contract in packages/shared/src/worlds.ts, the catalog in worlds-catalog.ts). One
 * in-memory session per voice call: the place it is in, who walked in, where each figure is. Positions arrive at up to
 * WORLD_MOVE_HZ per person and fan out together every WORLD_TICK_MS, only to the people inside. Also the stored half:
 * personal rooms and the 3D figure, with the ownership rules. No audio or video passes through here.
 * shortcut: sessions are in memory, single instance (like Voice, Cinema and Music); a restart ends them for everyone.
 */
import {
  LOUNGE_ROOM, STARTER_ROOM, WORLD_EMOTE_RATE, WORLD_LOOP_GESTURES, WORLD_MAX_AVATARS, WORLD_MAX_SPEED, WORLD_PLACE_COOLDOWN_MS,
  WORLD_ROOM_NAME_MAX, WORLD_SHELLS, WORLD_TICK_MS, avatarProblem, clampPose, holdsWorldSku, roomSeats, seatPlace, spawnPose, toPose,
  type DispatchOf, type DispatchType, type WorldAvatar, type WorldClientFrame, type WorldEmote, type WorldErrorReason, type WorldMember,
  type WorldPlace, type WorldPose, type WorldRoomAccess, type WorldRoomLayout, type WorldRoomView, type WorldSession,
} from '@alga/shared'
import { eq } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { isBlockedBetween, isFriend } from './access.js'
import type { Billing } from './billing/billing.js'
import type { Config } from './config.js'
import type { Db } from './db/index.js'
import { entitlements, users, worldRooms, type UserRow, type WorldRoomRow } from './db/schema.js'
import { HttpError, invalid, notFound, safeErr } from './errors.js'
import type { Conn, Hub } from './gateway/hub.js'
import type { Voice } from './voice.js'

/** Jitter allowance of the speed limit: a move may be this far beyond what WORLD_MAX_SPEED covers since the last one. */
const MOVE_SLACK_M = 1

interface Member extends WorldMember {
  /** The socket that walked in (or last asked to): the figure leaves when it closes. */
  conn: Conn
  /** Moved since the last tick. */
  dirty: boolean
  /** When the pose was last set (ms): what the speed limit measures from. */
  movedAt: number
}

/** A room ready to be shown: its name, who may walk in (personal rooms only) and the layout. */
interface Shown {
  name: string
  access?: WorldRoomAccess
  layout: WorldRoomLayout
}

interface Session {
  channelId: string
  place: WorldPlace
  hostId: string
  /** In order of arrival. */
  members: Map<string, Member>
  tv: string | null
  seq: number
  /** What WORLD_ROOM carries, and its seat ids. */
  room: WorldRoomView
  seats: Set<string>
  /** When someone last moved the world to another place (ms). */
  placedAt: number
  /** Gesture and reaction token buckets of the people in the call: they go when the person or the call does. */
  emotes: Map<string, { tokens: number; at: number }>
}

const LOUNGE: Shown = { name: 'Lounge', layout: LOUNGE_ROOM }

const samePlace = (a: WorldPlace, b: WorldPlace) => (a.kind === 'room' ? b.kind === 'room' && a.ownerId === b.ownerId : b.kind === 'lounge')

/** "Sala de <name>", cut at a whole character so it fits WORLD_ROOM_NAME_MAX. */
function starterName(displayName: string): string {
  let out = ''
  for (const ch of `Sala de ${displayName}`) {
    if (out.length + ch.length > WORLD_ROOM_NAME_MAX) break
    out += ch
  }
  return out.trim()
}

/** The layout without what its owner does not hold now: the item goes, a finish gives way to the starter room's. */
export function heldLayout(room: WorldRoomLayout, held: ReadonlySet<string>): WorldRoomLayout {
  const base = STARTER_ROOM.finish
  const keep = <T extends string | null>(sku: T, fallback: T): T => (sku !== null && !holdsWorldSku(sku, held) ? fallback : sku)
  return {
    shell: room.shell,
    finish: {
      floor: keep(room.finish.floor, base.floor), wall: keep(room.finish.wall, base.wall),
      accentWall: keep(room.finish.accentWall, base.accentWall), mood: keep(room.finish.mood, base.mood),
    },
    items: room.items.filter((it) => holdsWorldSku(it.sku, held)),
  }
}

export class Worlds {
  /** Min gap between two changes of place in a call; tests shorten it. */
  placeCooldownMs = WORLD_PLACE_COOLDOWN_MS
  private readonly sessions = new Map<string, Session>()
  /** Sessions where someone moved since the last tick. */
  private readonly moved = new Set<Session>()
  /** Per channel, the tail of the work that reads the database (open, enter, a room saved): one at a time. */
  private readonly queues = new Map<string, Promise<void>>()
  private timer: NodeJS.Timeout | undefined
  private readonly cfg: Config['worlds']

  constructor(
    config: Config, private readonly db: Db, private readonly hub: Hub, private readonly voice: Voice,
    private readonly billing: Billing, private readonly log: FastifyBaseLogger,
  ) {
    this.cfg = config.worlds
    // voice.onLeave / onDrop are single slots others chain onto (e2ee, cinema, music): chain too.
    const prev = voice.onLeave
    voice.onLeave = (userId, channelId) => { prev(userId, channelId); this.left(userId, channelId) }
    const prevDrop = voice.onDrop
    voice.onDrop = (ids) => {
      prevDrop(ids)
      for (const id of ids) {
        const s = this.sessions.get(id)
        if (!s) continue
        this.forget(s)
        this.hub.dispatch(this.inCall(id), 'WORLD_STATE', { channelId: id, session: null })
      }
    }
    // A purchase, a refund or a plan ending changes what the owner's open room may show.
    const prevChange = billing.onEntitlementsChange
    billing.onEntitlementsChange = (userId) => {
      prevChange(userId)
      void this.reshowAll(userId, false).catch((err: unknown) => this.log.error({ err: safeErr(err) }, 'worlds: room refresh failed'))
    }
  }

  /** The one timer of the service: positions of every session go out together. */
  start(intervalMs = WORLD_TICK_MS): void {
    clearInterval(this.timer)
    this.timer = setInterval(() => this.tick(), intervalMs)
    this.timer.unref()
  }

  stop(): void {
    clearInterval(this.timer)
    this.timer = undefined
    this.sessions.clear()
    this.moved.clear()
    this.queues.clear()
  }

  sessionOf(channelId: string): WorldSession | undefined {
    const s = this.sessions.get(channelId)
    return s && this.view(s)
  }

  // ---- gateway ------------------------------------------------------------------------------------------------------

  async handle(conn: Conn, f: WorldClientFrame): Promise<void> {
    if (!this.cfg.enabled) return this.error(conn, f.op, 'disabled')
    if (!this.inChannel(conn.userId, f.channelId)) return this.error(conn, f.op, 'not_in_call')
    switch (f.op) {
      case 'world_hello':
        return this.hello(conn, f.channelId)
      case 'world_open':
        return this.serial(f.channelId, () => this.open(conn, f.channelId, f.place))
      case 'world_enter':
        return this.serial(f.channelId, () => this.enter(conn, f.channelId))
      case 'world_leave': {
        const at = this.inside(conn, f)
        if (!at) return
        at.s.members.delete(conn.userId)
        return this.broadcast(at.s)
      }
      case 'world_move':
        return this.move(conn.userId, f.channelId, f.p)
      case 'world_sit':
        return this.sit(conn, f)
      case 'world_stand': {
        const at = this.inside(conn, f)
        // Nothing to stand up from: a standing figure only changes place through world_move (and its speed limit).
        if (!at || at.m.seat === null) return
        at.m.seat = null
        this.place(at.m, clampPose(f.p, WORLD_SHELLS[at.s.room.shell]))
        return this.broadcast(at.s)
      }
      case 'world_emote':
        return this.emote(conn, f, f.emote)
      case 'world_rest': {
        const at = this.inside(conn, f)
        if (!at || at.m.loop === null) return
        at.m.loop = null
        return this.broadcast(at.s)
      }
      case 'world_tv': {
        const at = this.inside(conn, f)
        if (!at) return
        if (f.userId !== null && !this.inChannel(f.userId, f.channelId)) return this.error(conn, f.op, 'not_found')
        if (at.s.tv === f.userId) return
        at.s.tv = f.userId
        return this.broadcast(at.s)
      }
    }
  }

  /** A socket closed: the figure it walked in with leaves the room. */
  socketClosed(conn: Conn): void {
    // Shutting down: every socket is closing, nobody is left to tell.
    if (this.hub.closing) return
    const channelId = this.voice.stateOf(conn.userId)?.channelId
    const s = channelId ? this.sessions.get(channelId) : undefined
    if (!s || s.members.get(conn.userId)?.conn !== conn) return
    s.members.delete(conn.userId)
    this.broadcast(s)
  }

  /** Fans out who moved since the last tick, to the people inside, never a person's own pose. Driven by the timer. */
  tick(): void {
    if (!this.moved.size) return
    for (const s of this.moved) {
      const entries: [number, ...WorldPose][] = []
      for (const m of s.members.values()) {
        if (!m.dirty) continue
        m.dirty = false
        entries.push([m.k, ...m.pose])
      }
      if (!entries.length) continue
      this.hub.dispatch(s.members.keys(), 'WORLD_TICK', (userId) => {
        const k = s.members.get(userId)?.k
        const e = entries.filter((x) => x[0] !== k)
        return e.length ? { channelId: s.channelId, e } : undefined
      })
    }
    this.moved.clear()
  }

  // ---- ops ----------------------------------------------------------------------------------------------------------

  private hello(conn: Conn, channelId: string): void {
    const s = this.sessions.get(channelId)
    this.reply(conn, 'WORLD_STATE', { channelId, session: s ? this.view(s) : null })
    if (s) this.reply(conn, 'WORLD_ROOM', s.room)
  }

  /** Opens the call's world in a place, or moves it there. Runs alone in its channel (serial). */
  private async open(conn: Conn, channelId: string, place: WorldPlace): Promise<void> {
    const uid = conn.userId
    const fail = (reason: WorldErrorReason) => this.error(conn, 'world_open', reason)
    if (place.kind === 'room' && place.ownerId !== uid) return fail('forbidden')
    const before = this.sessions.get(channelId)
    if (before && samePlace(before.place, place)) return this.hello(conn, channelId)
    if (before && Date.now() - before.placedAt < this.placeCooldownMs) return fail('slow_down')
    const shown = place.kind === 'room' ? await this.shownRoom(uid) : LOUNGE
    const denied = place.kind === 'room' && before ? await this.denied(uid, shown.access, [...before.members.keys()]) : new Map<string, WorldErrorReason>()
    // Leaves are synchronous and ran meanwhile: the caller may be gone, and with the last person the session too.
    if (!this.inChannel(uid, channelId)) return fail('not_in_call')
    const s = this.sessions.get(channelId)
    if (s && samePlace(s.place, place)) return this.hello(conn, channelId)
    if (s) {
      this.moveTo(s, place, shown, denied)
      s.placedAt = Date.now()
    } else {
      const room: WorldRoomView = { channelId, place, name: shown.name, ...(shown.access ? { access: shown.access } : {}), rev: 1, ...shown.layout }
      this.sessions.set(channelId, {
        channelId, place, hostId: uid, members: new Map(), tv: null, seq: 0, room, seats: roomSeats(room), placedAt: Date.now(), emotes: new Map(),
      })
    }
    const now = this.sessions.get(channelId)!
    this.broadcastRoom(now)
    this.broadcast(now)
  }

  /** Walks in. Runs alone in its channel (serial), so the place and its access only change under it through a leave. */
  private async enter(conn: Conn, channelId: string): Promise<void> {
    const uid = conn.userId
    const fail = (reason: WorldErrorReason) => this.error(conn, 'world_enter', reason)
    let s = this.sessions.get(channelId)
    if (!s) return fail('no_session')
    const already = s.members.get(uid)
    if (already) {
      // Entering twice changes nothing; a reconnected app takes the figure over, so the old socket's close leaves it.
      already.conn = conn
      return this.reply(conn, 'WORLD_STATE', { channelId, session: this.view(s) })
    }
    if (s.place.kind === 'room') {
      const { place } = s
      const reason = await this.accessProblem(place.ownerId, s.room.access, uid)
      if (!this.inChannel(uid, channelId)) return fail('not_in_call')
      s = this.sessions.get(channelId)
      if (!s) return fail('no_session')
      // The owner left meanwhile = the world is back in the lounge, where everyone may be.
      if (reason && s.place === place) return fail(reason)
    }
    if (s.members.size >= WORLD_MAX_AVATARS) return fail('full')
    const used = new Set([...s.members.values()].map((m) => m.k))
    let k = 0
    while (used.has(k)) k++
    s.members.set(uid, {
      userId: uid, k, pose: spawnPose(WORLD_SHELLS[s.room.shell], s.members.size), seat: null, loop: null, conn, dirty: false, movedAt: Date.now(),
    })
    this.broadcast(s)
  }

  private move(userId: string, channelId: string, p: WorldPose): void {
    const s = this.sessions.get(channelId)
    const m = s?.members.get(userId)
    if (!s || !m || m.seat !== null) return
    const to = clampPose(p, WORLD_SHELLS[s.room.shell])
    const now = Date.now()
    const metres = Math.hypot(to[0] - m.pose[0], to[1] - m.pose[1]) / 100
    // Faster than anyone walks or runs (a teleport, or a move that predates a change of place): dropped.
    if (metres > (WORLD_MAX_SPEED * (now - m.movedAt)) / 1000 + MOVE_SLACK_M) return
    m.pose = to
    m.movedAt = now
    m.dirty = true
    this.moved.add(s)
    if (to[3] !== 0 && m.loop !== null) {
      m.loop = null
      this.broadcast(s)
    }
  }

  private sit(conn: Conn, f: Extract<WorldClientFrame, { op: 'world_sit' }>): void {
    const at = this.inside(conn, f)
    if (!at) return
    const { s, m } = at
    const spot = s.seats.has(f.seat) ? seatPlace(s.room, f.seat) : null
    if (!spot) return this.error(conn, f.op, 'not_found')
    for (const o of s.members.values()) if (o !== m && o.seat === f.seat) return this.error(conn, f.op, 'seat_taken')
    if (m.seat === f.seat) return
    m.seat = f.seat
    m.loop = null
    this.place(m, toPose(spot.x, spot.z, spot.yaw))
    this.broadcast(s)
  }

  private emote(conn: Conn, f: { op: string; channelId: string }, emote: WorldEmote): void {
    const at = this.inside(conn, f)
    if (!at) return
    const { s, m } = at
    if (!this.take(s, m.userId)) return this.error(conn, f.op, 'slow_down')
    if (emote.kind === 'gesture' && WORLD_LOOP_GESTURES.includes(emote.id)) {
      // Nobody dances sitting down.
      if ((emote.id === 'dance' && m.seat !== null) || m.loop === emote.id) return
      m.loop = emote.id
      return this.broadcast(s)
    }
    this.hub.dispatch(s.members.keys(), 'WORLD_EMOTE', { channelId: s.channelId, userId: m.userId, emote })
  }

  // ---- lifecycle ----------------------------------------------------------------------------------------------------

  /** voice.onLeave: the user left the call (their state is already gone). */
  private left(userId: string, channelId: string): void {
    const s = this.sessions.get(channelId)
    if (!s) return
    if (this.voice.inChannel(channelId).length === 0) return this.forget(s)
    s.emotes.delete(userId)
    let changed = s.members.delete(userId)
    if (s.tv === userId) {
      s.tv = null
      changed = true
    }
    // A personal room is open only while its owner is in the call: back to the lounge, with everyone still inside.
    if (s.place.kind === 'room' && s.place.ownerId === userId) {
      this.moveTo(s, { kind: 'lounge' }, LOUNGE, new Map())
      this.broadcastRoom(s)
      changed = true
    }
    if (changed) this.broadcast(s)
  }

  /**
   * PUT /worlds/rooms/@me saved `ownerId`'s room: a call showing it gets the new layout, whoever sat on a seat that is
   * gone stands up and whoever the new access leaves out is taken out (never the owner).
   */
  roomSaved(ownerId: string): Promise<void> {
    return this.reshowAll(ownerId, true)
  }

  private async reshowAll(ownerId: string, saved: boolean): Promise<void> {
    for (const s of [...this.sessions.values()]) {
      if (s.place.kind === 'room' && s.place.ownerId === ownerId) await this.serial(s.channelId, () => this.reshow(s.channelId, ownerId, saved))
    }
  }

  /** `saved`: the owner saved the room (always announced, access applied); otherwise only what they hold changed. */
  private async reshow(channelId: string, ownerId: string, saved: boolean): Promise<void> {
    const showing = () => {
      const s = this.sessions.get(channelId)
      return s && s.place.kind === 'room' && s.place.ownerId === ownerId ? s : undefined
    }
    const before = showing()
    if (!before) return
    const shown = await this.shownRoom(ownerId)
    const denied = saved ? await this.denied(ownerId, shown.access, [...before.members.keys()]) : new Map<string, WorldErrorReason>()
    const s = showing()
    if (!s) return
    const next = this.roomView(s, s.place, shown, s.room.rev + 1)
    if (!saved && JSON.stringify({ ...next, rev: 0 }) === JSON.stringify({ ...s.room, rev: 0 })) return
    this.remove(s, denied)
    s.room = next
    s.seats = roomSeats(next)
    const shell = WORLD_SHELLS[next.shell]
    for (const m of s.members.values()) {
      if (m.seat === null) continue
      const spot = s.seats.has(m.seat) ? seatPlace(next, m.seat) : null
      if (spot) {
        this.place(m, toPose(spot.x, spot.z, spot.yaw))
      } else {
        m.seat = null
        this.place(m, clampPose(m.pose, shell))
      }
    }
    this.broadcastRoom(s)
    this.broadcast(s)
  }

  // ---- rooms and figures (REST) -------------------------------------------------------------------------------------

  /** The room of an account as stored, created from STARTER_ROOM on first need. */
  async roomOf(ownerId: string): Promise<WorldRoomRow> {
    const stored = () => this.db.select().from(worldRooms).where(eq(worldRooms.ownerId, ownerId))
    const [row] = await stored()
    if (row) return row
    const [u] = await this.db.select({ displayName: users.displayName }).from(users).where(eq(users.id, ownerId))
    if (!u) throw notFound('Usuário não encontrado.')
    await this.db.insert(worldRooms)
      .values({ ownerId, name: starterName(u.displayName), shell: STARTER_ROOM.shell, finish: STARTER_ROOM.finish, items: STARTER_ROOM.items })
      .onConflictDoNothing()
    return (await stored())[0]!
  }

  /** SKUs the account can use right now: bought, received, or included in its plan while it lasts. */
  async held(userId: string, now = Date.now()): Promise<Set<string>> {
    const { items } = await this.billing.entitlementsOf(userId)
    return new Set(items.filter((i) => !i.expiresAt || new Date(i.expiresAt).getTime() > now).map((i) => i.sku))
  }

  /**
   * PUT /worlds/avatar. Under the user-row lock Billing.recompute takes, so a part cannot be put on while it lapses.
   * 400 for a part that does not exist, 403 for one the account does not hold.
   */
  async setAvatar(userId: string, avatar: WorldAvatar | null, now = new Date()): Promise<{ before: UserRow; after: UserRow }> {
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(users).where(eq(users.id, userId)).for('update')
      if (!before) throw notFound()
      if (avatar) {
        const rows = await tx.select({ sku: entitlements.sku, expiresAt: entitlements.expiresAt }).from(entitlements).where(eq(entitlements.userId, userId))
        const problem = avatarProblem(avatar, new Set(rows.filter((e) => !e.expiresAt || e.expiresAt > now).map((e) => e.sku)))
        if (problem?.reason === 'unknown') throw invalid({ [`avatar.${problem.field}`]: problem.reason })
        if (problem) throw new HttpError('forbidden', 'Você não tem esta peça.', { [`avatar.${problem.field}`]: problem.reason })
      }
      const [after] = await tx.update(users).set({ worldAvatar: avatar }).where(eq(users.id, userId)).returning()
      return { before, after: after! }
    })
  }

  // ---- plumbing -----------------------------------------------------------------------------------------------------

  /** The owner's room as a call sees it: what they saved, minus what they do not hold now. */
  private async shownRoom(ownerId: string): Promise<Shown & { access: WorldRoomAccess }> {
    const [row, held] = await Promise.all([this.roomOf(ownerId), this.held(ownerId)])
    return { name: row.name, access: row.access, layout: heldLayout(row, held) }
  }

  /** Why `userId` may not be in `ownerId`'s room, or null. */
  private async accessProblem(ownerId: string, access: WorldRoomAccess | undefined, userId: string): Promise<WorldErrorReason | null> {
    if (userId === ownerId) return null
    if (access === 'locked') return 'locked'
    if (await isBlockedBetween(this.db, userId, ownerId)) return 'forbidden'
    if (access === 'friends' && !await isFriend(this.db, userId, ownerId)) return 'friends_only'
    return null
  }

  private async denied(ownerId: string, access: WorldRoomAccess | undefined, userIds: string[]): Promise<Map<string, WorldErrorReason>> {
    const out = new Map<string, WorldErrorReason>()
    for (const userId of userIds) {
      const reason = await this.accessProblem(ownerId, access, userId)
      if (reason) out.set(userId, reason)
    }
    return out
  }

  /** Takes people out of the room, telling each why. */
  private remove(s: Session, denied: Map<string, WorldErrorReason>): void {
    for (const [userId, reason] of denied) {
      if (s.members.delete(userId)) this.hub.dispatch([userId], 'WORLD_REMOVED', { channelId: s.channelId, reason })
    }
  }

  /** The world goes to another place: who may not be there leaves, the others arrive again, standing and at rest. */
  private moveTo(s: Session, place: WorldPlace, shown: Shown, denied: Map<string, WorldErrorReason>): void {
    this.remove(s, denied)
    s.place = place
    s.room = this.roomView(s, place, shown, s.room.rev + 1)
    s.seats = roomSeats(s.room)
    const shell = WORLD_SHELLS[s.room.shell]
    let i = 0
    for (const m of s.members.values()) {
      m.seat = null
      m.loop = null
      this.place(m, spawnPose(shell, i++))
    }
  }

  /** Puts a figure somewhere by decision of the server: the speed limit starts again from there. */
  private place(m: Member, pose: WorldPose): void {
    m.pose = pose
    m.movedAt = Date.now()
    m.dirty = false
  }

  private roomView(s: Pick<Session, 'channelId'>, place: WorldPlace, shown: Shown, rev: number): WorldRoomView {
    return { channelId: s.channelId, place, name: shown.name, ...(shown.access ? { access: shown.access } : {}), rev, ...shown.layout }
  }

  private forget(s: Session): void {
    this.sessions.delete(s.channelId)
    this.moved.delete(s)
  }

  /** The caller's session and figure; answers `not_inside` itself. */
  private inside(conn: Conn, f: { op: string; channelId: string }): { s: Session; m: Member } | undefined {
    const s = this.sessions.get(f.channelId)
    const m = s?.members.get(conn.userId)
    if (s && m) return { s, m }
    this.error(conn, f.op, 'not_inside')
    return undefined
  }

  private take(s: Session, userId: string): boolean {
    const { perSecond, burst } = WORLD_EMOTE_RATE
    const now = Date.now()
    const b = s.emotes.get(userId)
    const tokens = Math.min(burst, (b?.tokens ?? burst) + (b ? ((now - b.at) / 1000) * perSecond : 0))
    s.emotes.set(userId, { tokens: tokens < 1 ? tokens : tokens - 1, at: now })
    return tokens >= 1
  }

  /** Runs `fn` after whatever is already queued for the channel, so two database-backed changes never interleave. */
  private serial(channelId: string, fn: () => Promise<void>): Promise<void> {
    const run = (this.queues.get(channelId) ?? Promise.resolve()).then(fn)
    const tail = run.catch(() => {})
    this.queues.set(channelId, tail)
    void tail.then(() => { if (this.queues.get(channelId) === tail) this.queues.delete(channelId) })
    return run
  }

  private inChannel(userId: string, channelId: string): boolean {
    return this.voice.stateOf(userId)?.channelId === channelId
  }

  private inCall(channelId: string): string[] {
    return this.voice.inChannel(channelId).map((v) => v.userId)
  }

  private view(s: Session): WorldSession {
    return {
      channelId: s.channelId, place: s.place, hostId: s.hostId, tv: s.tv, seq: s.seq,
      members: [...s.members.values()].map(({ userId, k, pose, seat, loop }) => ({ userId, k, pose, seat, loop })),
    }
  }

  /** WORLD_STATE to everyone in the call; every one of them is one step of `seq`. */
  private broadcast(s: Session): void {
    s.seq++
    this.hub.dispatch(this.inCall(s.channelId), 'WORLD_STATE', { channelId: s.channelId, session: this.view(s) })
  }

  private broadcastRoom(s: Session): void {
    this.hub.dispatch(this.inCall(s.channelId), 'WORLD_ROOM', s.room)
  }

  private reply<T extends DispatchType>(conn: Conn, t: T, d: DispatchOf<T>): void {
    conn.send(JSON.stringify({ op: 'dispatch', t, d }))
  }

  private error(conn: Conn, op: string, reason: WorldErrorReason): void {
    this.reply(conn, 'WORLD_ERROR', { op, reason })
  }
}
