/**
 * Sala de Cinema, server half (docs/superpowers/specs/2026-11-05-sala-de-cinema-design.md §6.2, §6.6; wire contract in
 * packages/shared/src/cinema.ts). One in-memory session per voice call: seats, the shared playback clock, scheduled
 * play/pause/seek commands and the wait-for-stalled logic. The server never sees media bytes.
 * shortcut: sessions are in memory, single instance (like Voice and Hub); a restart ends them for everyone.
 */
import {
  CINEMA_COUNTDOWN_AFTER_PAUSE_MS, CINEMA_COUNTDOWN_MS, CINEMA_HOST_AWAY_MS, CINEMA_LEAD_MS, CINEMA_MAX_SEATS,
  CINEMA_READY_TIMEOUT_MS, CINEMA_STATUS_INTERVAL_MS, Permission, hasPermission, positionAt, uuidv7,
  type CinemaClientFrame, type CinemaEndReason, type CinemaErrorReason, type CinemaFilm, type CinemaPlayback, type CinemaSeat,
  type CinemaSessionView, type DispatchOf, type DispatchType,
} from '@alga/shared'
import type { FastifyBaseLogger } from 'fastify'
import { PRIVATE_CHANNEL_PERMISSIONS, memberPermissions } from './access.js'
import type { Config } from './config.js'
import type { Db } from './db/index.js'
import type { Conn, Hub } from './gateway/hub.js'
import type { Voice } from './voice.js'
import { loadChannel } from './views.js'

/** Defaults are the shared constants; tests shrink them through `Cinema.timings`. */
export interface CinemaTimings {
  leadMs: number; readyTimeoutMs: number; hostAwayMs: number
  countdownAfterPauseMs: number; countdownMs: number; statusIntervalMs: number
}

interface Seat {
  userId: string
  status: CinemaSeat['status']
  aheadS: number
  /** Socket that sat (or last said hello): session-only dispatches go to it. Null while the user has no socket. */
  conn: Conn | null
  lastStatusAt: number
}

interface Session {
  id: string
  channelId: string
  hostId: string
  film: CinemaFilm
  playback: CinemaPlayback
  options: { controlLock: boolean; waitForStalled: boolean }
  seats: Map<string, Seat>
  createdAt: number
  everSeated: Set<string>
  /** When the timeline last froze (server clock): decides whether `play` counts down. */
  pausedAt: number
  /** Dropped from waitingFor (timeout / continue_without): does not pause the room again until they send `ready`. */
  noWait: Set<string>
  hostAway: boolean
  /** buffering → playing after CINEMA_READY_TIMEOUT_MS; waiting → playing likewise. */
  holdTimer?: NodeJS.Timeout
  hostTimer?: NodeJS.Timeout
}

export class Cinema {
  readonly timings: CinemaTimings = {
    leadMs: CINEMA_LEAD_MS, readyTimeoutMs: CINEMA_READY_TIMEOUT_MS, hostAwayMs: CINEMA_HOST_AWAY_MS,
    countdownAfterPauseMs: CINEMA_COUNTDOWN_AFTER_PAUSE_MS, countdownMs: CINEMA_COUNTDOWN_MS, statusIntervalMs: CINEMA_STATUS_INTERVAL_MS,
  }
  private readonly sessions = new Map<string, Session>()
  private readonly enabled: boolean

  constructor(config: Config, private readonly db: Db, private readonly hub: Hub, private readonly voice: Voice, private readonly log: FastifyBaseLogger) {
    this.enabled = config.cinema.enabled
    // voice.onLeave is a single slot (E2ee set it first): chain onto it.
    const prev = voice.onLeave
    voice.onLeave = (userId, channelId) => { prev(userId, channelId); this.left(userId, channelId) }
  }

  stop(): void {
    for (const s of this.sessions.values()) this.clearTimers(s)
    this.sessions.clear()
  }

  sessionOf(channelId: string): CinemaSessionView | undefined {
    const s = this.sessions.get(channelId)
    return s && this.view(s)
  }

  // ---- gateway ------------------------------------------------------------------------------------------------------

  async handle(conn: Conn, frame: CinemaClientFrame): Promise<void> {
    switch (frame.op) {
      case 'cinema_time':
        return this.reply(conn, 'CINEMA_PONG', { c: frame.c, s: Date.now() })
      case 'cinema_hello':
        return this.hello(conn)
      case 'cinema_open':
        return this.open(conn, frame)
      case 'cinema_seat':
        return this.seat(conn, frame)
      case 'cinema_status':
        return this.status(conn, frame)
      case 'cinema_control':
        return this.control(conn, frame)
      case 'cinema_options':
        return this.setOptions(conn, frame)
      default:
        // cinema_pieces / film / signal / react / end: next task.
    }
  }

  /** A socket closed. A seat keeps its place without a socket; the host losing every socket sends the room to host_away. */
  socketClosed(conn: Conn): void {
    for (const s of this.sessions.values()) {
      const seat = s.seats.get(conn.userId)
      if (seat?.conn !== conn) continue
      seat.conn = null
      if (conn.userId === s.hostId && this.hub.connections(conn.userId) === 0) this.hostGone(s)
    }
  }

  /** voice.onLeave: the user left the call (state already removed). */
  left(userId: string, channelId: string): void {
    const s = this.sessions.get(channelId)
    if (!s) return
    if (this.voice.inChannel(channelId).length === 0) return this.end(s, 'call_empty')
    if (s.seats.has(userId) || userId === s.hostId) this.unseat(s, userId)
  }

  // ---- ops ----------------------------------------------------------------------------------------------------------

  private hello(conn: Conn): void {
    const s = this.sessionIn(conn.userId)
    if (!s) return
    const seat = s.seats.get(conn.userId)
    if (seat) seat.conn = conn
    else if (conn.userId === s.hostId && s.hostAway) this.sit(s, conn)
    if (conn.userId === s.hostId && s.hostAway) return this.hostBack(s)
    this.reply(conn, 'CINEMA_STATE', this.view(s))
  }

  private async open(conn: Conn, f: Extract<CinemaClientFrame, { op: 'cinema_open' }>): Promise<void> {
    const fail = (reason: CinemaErrorReason) => this.error(conn, f.op, reason)
    if (!this.enabled) return fail('disabled')
    if (this.voice.stateOf(conn.userId)?.channelId !== f.channelId) return fail('not_in_call')
    const found = await loadChannel(this.db, f.channelId)
    if (!found) return fail('not_found')
    const permissions = found.row.spaceId ? (await memberPermissions(this.db, found.row.spaceId, conn.userId)).get(conn.userId) ?? 0 : PRIVATE_CHANNEL_PERMISSIONS
    if (found.row.spaceId && !hasPermission(permissions, Permission.STREAM)) return fail('forbidden')
    // The awaits above may have let another open or a leave through: check again.
    if (this.sessions.has(f.channelId)) return fail('exists')
    if (this.voice.stateOf(conn.userId)?.channelId !== f.channelId) return fail('not_in_call')
    const now = Date.now()
    const s: Session = {
      id: uuidv7(), channelId: f.channelId, hostId: conn.userId, film: f.film,
      playback: { playing: false, position: Math.min(f.startS, f.film.durationS), at: now, seq: 0, by: null, reason: 'foyer', waitingFor: [], countdown: false },
      options: { controlLock: false, waitForStalled: true },
      seats: new Map(), createdAt: now, everSeated: new Set(), pausedAt: now, noWait: new Set(), hostAway: false,
    }
    this.sessions.set(f.channelId, s)
    this.sit(s, conn)
    this.broadcast(s)
  }

  private seat(conn: Conn, f: Extract<CinemaClientFrame, { op: 'cinema_seat' }>): void {
    const s = this.byId(conn, f)
    if (!s) return
    if (!f.seated) return this.unseat(s, conn.userId)
    if (this.voice.stateOf(conn.userId)?.channelId !== s.channelId) return this.error(conn, f.op, 'not_in_call', s.id)
    const had = s.seats.has(conn.userId)
    if (!had && s.seats.size >= CINEMA_MAX_SEATS) return this.error(conn, f.op, 'full', s.id)
    this.sit(s, conn)
    if (conn.userId === s.hostId && s.hostAway) return this.hostBack(s)
    if (!had) this.broadcast(s)
  }

  private status(conn: Conn, f: Extract<CinemaClientFrame, { op: 'cinema_status' }>): void {
    const s = this.byId(conn, f)
    if (!s) return
    const seat = s.seats.get(conn.userId)
    if (!seat) return this.error(conn, f.op, 'not_seated', s.id)
    const now = Date.now()
    // The throttle is for refreshes of the same status; a change is always applied.
    if (f.status === seat.status && now - seat.lastStatusAt < this.timings.statusIntervalMs) return
    seat.status = f.status
    seat.aheadS = f.aheadS
    seat.lastStatusAt = now
    seat.conn = conn
    const p = s.playback
    if (f.status === 'ready') {
      s.noWait.delete(seat.userId)
      if (p.reason === 'waiting' && p.waitingFor.includes(seat.userId)) {
        const waitingFor = p.waitingFor.filter((u) => u !== seat.userId)
        if (waitingFor.length === 0) return this.play(s, true)
        s.playback = { ...p, waitingFor }
        return this.broadcast(s)
      }
      if (p.reason === 'buffering' && !p.playing && this.allReady(s)) return this.play(s, false)
    } else if (f.status === 'stalled' && p.playing && s.options.waitForStalled && !s.noWait.has(seat.userId) && !s.hostAway) {
      return this.pause(s, 'waiting', [seat.userId])
    }
    this.broadcast(s)
  }

  private control(conn: Conn, f: Extract<CinemaClientFrame, { op: 'cinema_control' }>): void {
    const s = this.byId(conn, f)
    if (!s) return
    const fail = (reason: CinemaErrorReason) => this.error(conn, f.op, reason, s.id)
    if (!s.seats.has(conn.userId)) return fail('not_seated')
    const isHost = conn.userId === s.hostId
    if (s.options.controlLock && !isHost) return fail('locked')
    if ((f.action === 'start') && !isHost) return fail('forbidden')
    if (f.seq < s.playback.seq) {
      this.error(conn, f.op, 'stale', s.id)
      return this.reply(conn, 'CINEMA_STATE', this.view(s))
    }
    const p = s.playback
    const by = conn.userId
    switch (f.action) {
      case 'start':
      case 'seek':
        return this.buffer(s, by, Math.min(f.position ?? (f.action === 'start' ? p.position : 0), s.film.durationS))
      case 'pause':
        return this.pause(s, 'user', [], by)
      case 'play':
        if (p.playing || p.reason === 'buffering') return
        // Whoever was holding the room is overridden: nobody is waited for after an explicit play.
        for (const u of p.waitingFor) s.noWait.add(u)
        return this.play(s, Date.now() - s.pausedAt > this.timings.countdownAfterPauseMs, by)
      case 'continue_without': {
        if (!f.target) return fail('invalid')
        s.noWait.add(f.target)
        const waitingFor = p.waitingFor.filter((u) => u !== f.target)
        if (p.reason === 'waiting' && waitingFor.length === 0) return this.play(s, false, by)
        s.playback = { ...p, waitingFor, by, seq: p.seq + 1 }
        return this.broadcast(s)
      }
    }
  }

  private setOptions(conn: Conn, f: Extract<CinemaClientFrame, { op: 'cinema_options' }>): void {
    const s = this.byId(conn, f)
    if (!s) return
    if (conn.userId !== s.hostId) return this.error(conn, f.op, 'forbidden', s.id)
    if (f.controlLock !== undefined) s.options.controlLock = f.controlLock
    if (f.waitForStalled !== undefined) s.options.waitForStalled = f.waitForStalled
    this.broadcast(s)
  }

  // ---- playback transitions -----------------------------------------------------------------------------------------

  /** start/seek: freeze at the target; everyone prepares, then `play` fires (all ready, or after the ready timeout). */
  private buffer(s: Session, by: string, position: number): void {
    this.clearHold(s)
    for (const seat of s.seats.values()) if (seat.status !== 'unsupported') seat.status = 'preparing'
    s.playback = { ...s.playback, playing: false, position, at: Date.now(), reason: 'buffering', by, waitingFor: [], countdown: false, seq: s.playback.seq + 1 }
    s.pausedAt = Date.now()
    this.hold(s, () => this.play(s, false))
    this.broadcast(s)
  }

  /** Freezes everyone at the exact position the timeline reaches at the stamped instant. */
  private pause(s: Session, reason: 'user' | 'waiting' | 'host_away', waitingFor: string[], by: string | null = null): void {
    this.clearHold(s)
    const p = s.playback
    const at = Date.now() + this.timings.leadMs
    if (p.playing) s.pausedAt = at
    s.playback = {
      ...p, playing: false, position: positionAt(p, at, s.film.durationS), at, reason, by,
      waitingFor: reason === 'waiting' ? [...new Set([...p.waitingFor, ...waitingFor])] : [], countdown: false, seq: p.seq + 1,
    }
    if (reason === 'waiting') this.hold(s, () => {
      // Whoever is still holding the room is let go (and not waited for again until their next `ready`).
      for (const u of s.playback.waitingFor) s.noWait.add(u)
      this.play(s, false)
    })
    this.broadcast(s)
  }

  private play(s: Session, countdown: boolean, by: string | null = s.playback.by): void {
    this.clearHold(s)
    const at = Date.now() + (countdown ? this.timings.countdownMs : this.timings.leadMs)
    s.playback = { ...s.playback, playing: true, at, reason: 'user', by, waitingFor: [], countdown, seq: s.playback.seq + 1 }
    this.broadcast(s)
  }

  private allReady(s: Session): boolean {
    return [...s.seats.values()].every((x) => x.status === 'ready' || x.status === 'unsupported')
  }

  // ---- seats and host presence --------------------------------------------------------------------------------------

  private sit(s: Session, conn: Conn): void {
    const seat = s.seats.get(conn.userId)
    if (seat) { seat.conn = conn; return }
    s.seats.set(conn.userId, { userId: conn.userId, status: 'preparing', aheadS: 0, conn, lastStatusAt: 0 })
    s.everSeated.add(conn.userId)
  }

  private unseat(s: Session, userId: string): void {
    const had = s.seats.delete(userId)
    s.noWait.delete(userId)
    if (userId === s.hostId) return this.hostGone(s)
    if (!had) return
    const p = s.playback
    if (p.reason === 'waiting' && p.waitingFor.includes(userId)) {
      const waitingFor = p.waitingFor.filter((u) => u !== userId)
      if (waitingFor.length === 0) return this.play(s, true)
      s.playback = { ...p, waitingFor }
    } else if (p.reason === 'buffering' && !p.playing && this.allReady(s)) {
      return this.play(s, false)
    }
    this.broadcast(s)
  }

  /** The host left their seat, the call, or lost every socket: pause and wait for them. */
  private hostGone(s: Session): void {
    if (s.hostAway) return
    s.hostAway = true
    s.hostTimer = setTimeout(() => this.end(s, 'host_left'), this.timings.hostAwayMs)
    this.pause(s, 'host_away', [])
  }

  private hostBack(s: Session): void {
    clearTimeout(s.hostTimer)
    s.hostAway = false
    s.playback = { ...s.playback, playing: false, reason: 'user', by: s.hostId, waitingFor: [], countdown: false, seq: s.playback.seq + 1 }
    this.broadcast(s)
  }

  private end(s: Session, reason: CinemaEndReason): void {
    this.clearTimers(s)
    this.sessions.delete(s.channelId)
    const d = {
      channelId: s.channelId, sessionId: s.id, ended: true as const, reason,
      summary: { watchedS: positionAt(s.playback, Date.now(), s.film.durationS), seats: [...s.everSeated], reactions: 0, peak: null },
    }
    this.hub.dispatch(this.voice.inChannel(s.channelId).map((v) => v.userId), 'CINEMA_STATE', d)
  }

  // ---- plumbing -----------------------------------------------------------------------------------------------------

  private hold(s: Session, fn: () => void): void {
    s.holdTimer = setTimeout(fn, this.timings.readyTimeoutMs)
  }

  private clearHold(s: Session): void {
    clearTimeout(s.holdTimer)
    s.holdTimer = undefined
  }

  private clearTimers(s: Session): void {
    this.clearHold(s)
    clearTimeout(s.hostTimer)
  }

  /** The session of the call the user is in. */
  private sessionIn(userId: string): Session | undefined {
    const channelId = this.voice.stateOf(userId)?.channelId
    return channelId ? this.sessions.get(channelId) : undefined
  }

  /** Session by id for a frame; answers `not_found` itself. */
  private byId(conn: Conn, f: { op: string; sessionId: string }): Session | undefined {
    for (const s of this.sessions.values()) if (s.id === f.sessionId) return s
    this.error(conn, f.op, 'not_found', f.sessionId)
    return undefined
  }

  private view(s: Session): CinemaSessionView {
    return {
      sessionId: s.id, channelId: s.channelId, hostId: s.hostId, film: s.film, playback: s.playback, options: s.options,
      seats: [...s.seats.values()].map((x) => ({ userId: x.userId, status: x.status, aheadS: x.aheadS, direct: true })),
      iceServers: [], createdAt: s.createdAt,
    }
  }

  private broadcast(s: Session): void {
    const view = this.view(s)
    this.hub.dispatch(this.voice.inChannel(s.channelId).map((v) => v.userId), 'CINEMA_STATE', () => view)
  }

  private reply<T extends DispatchType>(conn: Conn, t: T, d: DispatchOf<T>): void {
    conn.send(JSON.stringify({ op: 'dispatch', t, d }))
  }

  private error(conn: Conn, op: string, reason: CinemaErrorReason, sessionId?: string): void {
    this.reply(conn, 'CINEMA_ERROR', { op, reason, ...(sessionId ? { sessionId } : {}) })
  }
}
