/**
 * Sala de Cinema, server half (docs/superpowers/specs/2026-11-05-sala-de-cinema-design.md §6.2, §6.6; wire contract in
 * packages/shared/src/cinema.ts). One in-memory session per voice call: seats, the shared playback clock, scheduled
 * play/pause/seek commands, the wait-for-stalled logic, the signaling relay, the piece index, reactions and the summary.
 * The server never sees media bytes.
 * shortcut: sessions are in memory, single instance (like Voice and Hub); a restart ends them for everyone.
 */
import { createHmac } from 'node:crypto'
import {
  CINEMA_COUNTDOWN_AFTER_PAUSE_MS, CINEMA_COUNTDOWN_MS, CINEMA_HOST_AWAY_MS, CINEMA_ITEMS_PER_FRAME, CINEMA_LEAD_MS, CINEMA_MAX_SEATS,
  CINEMA_READY_TIMEOUT_MS, CINEMA_REACTION_RATE, CINEMA_STATUS_INTERVAL_MS, CINEMA_TURN_TTL_S, Permission, hasPermission, positionAt, uuidv7,
  type CinemaClientFrame, type CinemaEndReason, type CinemaErrorReason, type CinemaFilm, type CinemaIceServer, type CinemaPieceMeta,
  type CinemaPlayback, type CinemaSeat, type CinemaSessionView, type CinemaTrackId, type DispatchOf, type DispatchType,
} from '@alga/shared'
import type { FastifyBaseLogger } from 'fastify'
import { PRIVATE_CHANNEL_PERMISSIONS, blockedWith, memberPermissions } from './access.js'
import type { Config } from './config.js'
import type { Db } from './db/index.js'
import type { Conn, Hub } from './gateway/hub.js'
import { metrics } from './metrics.js'
import type { Voice } from './voice.js'
import { loadChannel } from './views.js'

/** Defaults are the shared constants; tests shrink them through `Cinema.timings`. */
export interface CinemaTimings {
  leadMs: number; readyTimeoutMs: number; hostAwayMs: number
  countdownAfterPauseMs: number; countdownMs: number; statusIntervalMs: number
}

/** Bounds on what a host can make the server keep in memory. */
const MAX_TRACKS = 128
const MAX_PIECES_PER_TRACK = 20_000
/** Stored piece items per session across tracks (a 2 h film at 4 s is about 1,800 pieces per track). */
const MAX_PIECES_PER_SESSION = 50_000
const MAX_SUBTITLES = 64
/** Reactions are bucketed by media position into windows of this many seconds for the summary's peak. */
const PEAK_BUCKET_S = 10
const CONTROL_CHARS = /[\p{Cc}\u2028\u2029]/gu

/** Untrusted text kept and re-broadcast by the server: no control characters, trimmed (HTML stays plain text for clients). */
const cleanText = (v: string): string => v.replace(CONTROL_CHARS, '').trim()
const cleanNullable = (v: string | null): string | null => (v === null ? null : cleanText(v) || null)

/** The film with every free-text field cleaned; null when the title is empty after cleaning. */
function cleanFilm(f: CinemaFilm): CinemaFilm | null {
  const title = cleanText(f.title)
  if (!title) return null
  return {
    ...f, title,
    audio: f.audio.map((a) => ({ ...a, lang: cleanNullable(a.lang), title: cleanNullable(a.title) })),
    subtitles: f.subtitles.map((x) => ({ ...x, lang: cleanNullable(x.lang), title: cleanNullable(x.title) })),
    chapters: f.chapters.map((c) => ({ ...c, title: cleanText(c.title) })),
  }
}
interface Seat {
  userId: string
  status: CinemaSeat['status']
  aheadS: number
  /** Socket that sat (or last said hello): seat-scoped dispatches go to it. Null while it has none (they then go to every socket of the user). */
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
  /** When the timeline last froze (server clock): decides whether a resume counts down. */
  pausedAt: number
  /** Dropped from waitingFor (continue_without / explicit play): does not pause the room again until they send `ready`. */
  noWait: Set<string>
  hostAway: boolean
  /** The host left while the room was still in the foyer: it returns to the foyer, not to a paused film. */
  awayFromFoyer: boolean
  /** buffering → playing after CINEMA_READY_TIMEOUT_MS (start/seek only; a stall wait has no timeout). */
  holdTimer?: NodeJS.Timeout
  hostTimer?: NodeJS.Timeout
  /** Piece index per track, in memory: late joiners get it replayed. */
  pieces: Map<CinemaTrackId, CinemaPieceMeta[]>
  /** Who blocked or was blocked by each user who sat, as of their last seat/hello (decides `direct`). */
  blocks: Map<string, Set<string>>
  /** Reaction token buckets. */
  rate: Map<string, { tokens: number; at: number }>
  /** Summary counters. */
  watchedS: number
  reactions: number
  peaks: Map<number, number>
}

export class Cinema {
  readonly timings: CinemaTimings = {
    leadMs: CINEMA_LEAD_MS, readyTimeoutMs: CINEMA_READY_TIMEOUT_MS, hostAwayMs: CINEMA_HOST_AWAY_MS,
    countdownAfterPauseMs: CINEMA_COUNTDOWN_AFTER_PAUSE_MS, countdownMs: CINEMA_COUNTDOWN_MS, statusIntervalMs: CINEMA_STATUS_INTERVAL_MS,
  }
  private readonly sessions = new Map<string, Session>()
  private readonly cfg: Config['cinema']

  constructor(config: Config, private readonly db: Db, private readonly hub: Hub, private readonly voice: Voice, private readonly log: FastifyBaseLogger) {
    this.cfg = config.cinema
    // voice.onLeave / onDrop are single slots (E2ee set onLeave first): chain onto them.
    const prev = voice.onLeave
    voice.onLeave = (userId, channelId) => { prev(userId, channelId); this.left(userId, channelId) }
    const prevDrop = voice.onDrop
    voice.onDrop = (ids) => {
      prevDrop(ids)
      for (const id of ids) { const s = this.sessions.get(id); if (s) this.end(s, 'channel_gone') }
    }
  }

  stop(): void {
    for (const s of this.sessions.values()) this.clearTimers(s)
    this.sessions.clear()
  }

  sessionOf(channelId: string): CinemaSessionView | undefined {
    const s = this.sessions.get(channelId)
    return s && this.view(s)
  }

  /** Seated users across live sessions (metrics gauge). */
  seatCount(): number {
    let n = 0
    for (const s of this.sessions.values()) n += s.seats.size
    return n
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
      case 'cinema_pieces':
        return this.pieces(conn, frame)
      case 'cinema_film':
        return this.film(conn, frame)
      case 'cinema_signal':
        return this.signal(conn, frame)
      case 'cinema_react':
        return this.react(conn, frame)
      case 'cinema_end':
        return this.endBy(conn, frame)
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

  private async hello(conn: Conn): Promise<void> {
    const uid = conn.userId
    let s = this.sessionIn(uid)
    if (!s) return
    if (s.seats.has(uid) || (uid === s.hostId && s.hostAway)) {
      await this.loadBlocks(s, uid)
      s = this.sessionIn(uid)
      if (!s) return
    }
    const seat = s.seats.get(uid)
    if (seat) seat.conn = conn
    else if (uid === s.hostId && s.hostAway) this.sit(s, conn)
    if (uid === s.hostId && s.hostAway) return this.hostBack(s)
    if (seat) this.sendIndex(s, uid)
    this.reply(conn, 'CINEMA_STATE', this.view(s, uid))
  }

  private async open(conn: Conn, f: Extract<CinemaClientFrame, { op: 'cinema_open' }>): Promise<void> {
    const fail = (reason: CinemaErrorReason) => { metrics.cinemaSessions.inc({ result: reason }); this.error(conn, f.op, reason) }
    if (!this.cfg.enabled) return fail('disabled')
    if (this.voice.stateOf(conn.userId)?.channelId !== f.channelId) return fail('not_in_call')
    const found = await loadChannel(this.db, f.channelId)
    if (!found) return fail('not_found')
    const permissions = found.row.spaceId ? (await memberPermissions(this.db, found.row.spaceId, conn.userId)).get(conn.userId) ?? 0 : PRIVATE_CHANNEL_PERMISSIONS
    if (found.row.spaceId && !hasPermission(permissions, Permission.STREAM)) return fail('forbidden')
    // The awaits above may have let another open or a leave through: check again.
    if (this.sessions.has(f.channelId)) return fail('exists')
    if (this.voice.stateOf(conn.userId)?.channelId !== f.channelId) return fail('not_in_call')
    const film = cleanFilm(f.film)
    if (!film) return fail('invalid')
    const now = Date.now()
    const s: Session = {
      id: uuidv7(), channelId: f.channelId, hostId: conn.userId, film,
      playback: { playing: false, position: Math.min(f.startS, f.film.durationS), at: now, seq: 0, by: null, reason: 'foyer', waitingFor: [], countdown: false },
      options: { controlLock: false, waitForStalled: true },
      seats: new Map(), createdAt: now, everSeated: new Set(), pausedAt: now, noWait: new Set(), hostAway: false, awayFromFoyer: false,
      pieces: new Map(), blocks: new Map(), rate: new Map(), watchedS: 0, reactions: 0, peaks: new Map(),
    }
    this.sessions.set(f.channelId, s)
    metrics.cinemaSessions.inc({ result: 'opened' })
    this.sit(s, conn)
    this.broadcast(s)
  }

  private async seat(conn: Conn, f: Extract<CinemaClientFrame, { op: 'cinema_seat' }>): Promise<void> {
    const s = this.byId(conn, f)
    if (!s) return
    const uid = conn.userId
    if (!f.seated) return this.unseat(s, uid)
    const check = (): CinemaErrorReason | null => {
      if (this.voice.stateOf(uid)?.channelId !== s.channelId) return 'not_in_call'
      // The host always gets their seat back, whoever took the free one meanwhile.
      if (!s.seats.has(uid) && uid !== s.hostId && s.seats.size >= CINEMA_MAX_SEATS) return 'full'
      return null
    }
    const before = check()
    if (before) return this.error(conn, f.op, before, s.id)
    await this.loadBlocks(s, uid)
    if (this.sessions.get(s.channelId) !== s) return
    const after = check()
    if (after) return this.error(conn, f.op, after, s.id)
    const had = s.seats.has(uid)
    this.sit(s, conn)
    if (uid === s.hostId && s.hostAway) return this.hostBack(s)
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
    const uid = seat.userId
    if (f.status === 'ready') {
      s.noWait.delete(uid)
      if (p.reason === 'waiting' && p.waitingFor.includes(uid)) {
        const waitingFor = p.waitingFor.filter((u) => u !== uid)
        if (waitingFor.length === 0) return this.resume(s)
        this.change(s, { waitingFor })
        return this.broadcast(s)
      }
      if (p.reason === 'buffering' && !p.playing && this.allReady(s)) return this.play(s, false)
    } else if (f.status === 'stalled' && s.options.waitForStalled && !s.noWait.has(uid) && !s.hostAway
      && (p.playing || (p.reason === 'waiting' && !p.waitingFor.includes(uid)))) {
      return this.pause(s, 'waiting', [uid])
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
      return this.reply(conn, 'CINEMA_STATE', this.view(s, conn.userId))
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
        // Only the host's `start` leaves the foyer; nobody resumes a room whose host is away.
        if (p.reason === 'foyer' || p.reason === 'host_away') return fail('invalid')
        if (p.playing || p.reason === 'buffering') return
        // Whoever was holding the room is overridden: nobody is waited for after an explicit play.
        for (const u of p.waitingFor) s.noWait.add(u)
        return this.resume(s, by)
      case 'continue_without': {
        if (!f.target || !p.waitingFor.includes(f.target)) return fail('invalid')
        s.noWait.add(f.target)
        const waitingFor = p.waitingFor.filter((u) => u !== f.target)
        if (waitingFor.length === 0) return this.resume(s, by)
        this.change(s, { waitingFor, by })
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

  /** The host's per-track piece index: contiguous appends, or overwrites from an earlier `from` (regeneration). */
  private pieces(conn: Conn, f: Extract<CinemaClientFrame, { op: 'cinema_pieces' }>): void {
    const s = this.byId(conn, f)
    if (!s) return
    if (conn.userId !== s.hostId) return this.error(conn, f.op, 'forbidden', s.id)
    const list = s.pieces.get(f.track) ?? []
    if (f.from > list.length || f.from + f.items.length > MAX_PIECES_PER_TRACK || (!s.pieces.has(f.track) && s.pieces.size >= MAX_TRACKS)) {
      return this.error(conn, f.op, 'invalid', s.id)
    }
    const total = [...s.pieces.values()].reduce((n, l) => n + l.length, 0) + Math.max(0, f.from + f.items.length - list.length)
    if (total > MAX_PIECES_PER_SESSION) return this.error(conn, f.op, 'invalid', s.id)
    list.splice(f.from, f.items.length, ...f.items)
    s.pieces.set(f.track, list)
    if (!f.items.length) return
    for (const userId of s.seats.keys()) {
      if (userId !== conn.userId) this.toSeat(s, userId, 'CINEMA_PIECES', { sessionId: s.id, track: f.track, from: f.from, items: f.items })
    }
  }

  private film(conn: Conn, f: Extract<CinemaClientFrame, { op: 'cinema_film' }>): void {
    const s = this.byId(conn, f)
    if (!s) return
    if (conn.userId !== s.hostId) return this.error(conn, f.op, 'forbidden', s.id)
    if (f.title === undefined && !f.addSubtitle) return this.error(conn, f.op, 'invalid', s.id)
    let film = s.film
    if (f.title !== undefined) {
      // The title is plain text for the clients to render; HTML in it stays text.
      const title = cleanText(f.title)
      if (!title) return this.error(conn, f.op, 'invalid', s.id)
      film = { ...film, title }
    }
    const sub = f.addSubtitle
    if (sub) {
      if (film.subtitles.length >= MAX_SUBTITLES || film.subtitles.some((x) => x.id === sub.id)) return this.error(conn, f.op, 'invalid', s.id)
      film = { ...film, subtitles: [...film.subtitles, { ...sub, lang: cleanNullable(sub.lang), title: cleanNullable(sub.title), external: true }] }
    }
    s.film = film
    this.broadcast(s)
  }

  /** WebRTC signaling relay between two seats that are allowed to connect (no block either way). */
  private async signal(conn: Conn, f: Extract<CinemaClientFrame, { op: 'cinema_signal' }>): Promise<void> {
    const s = this.byId(conn, f)
    if (!s) return
    const from = conn.userId
    const ok = () => this.sessions.get(s.channelId) === s && from !== f.to && s.seats.has(from) && s.seats.has(f.to)
    if (!ok() || (await blockedWith(this.db, from)).has(f.to) || !ok()) return this.error(conn, f.op, 'forbidden', s.id)
    this.toSeat(s, f.to, 'CINEMA_SIGNAL', { sessionId: s.id, from, signal: f.signal })
  }

  private react(conn: Conn, f: Extract<CinemaClientFrame, { op: 'cinema_react' }>): void {
    const s = this.byId(conn, f)
    if (!s) return
    const uid = conn.userId
    if (!s.seats.has(uid)) return this.error(conn, f.op, 'not_seated', s.id)
    const now = Date.now()
    const { perSecond, burst } = CINEMA_REACTION_RATE
    const b = s.rate.get(uid)
    const tokens = Math.min(burst, (b?.tokens ?? burst) + (b ? ((now - b.at) / 1000) * perSecond : 0))
    // Over the limit: ignored in silence (a flood of emoji is not worth an error per frame).
    if (tokens < 1) return void s.rate.set(uid, { tokens, at: now })
    s.rate.set(uid, { tokens: tokens - 1, at: now })
    const position = positionAt(s.playback, now, s.film.durationS)
    const bucket = Math.floor(position / PEAK_BUCKET_S)
    s.reactions++
    s.peaks.set(bucket, (s.peaks.get(bucket) ?? 0) + 1)
    for (const userId of s.seats.keys()) this.toSeat(s, userId, 'CINEMA_REACTION', { sessionId: s.id, userId: uid, emoji: f.emoji, position, at: now })
  }

  /** The host ends it; in a space, so may whoever can mute or move members. */
  private async endBy(conn: Conn, f: Extract<CinemaClientFrame, { op: 'cinema_end' }>): Promise<void> {
    const s = this.byId(conn, f)
    if (!s) return
    if (conn.userId === s.hostId) return this.end(s, 'host_ended')
    if (this.voice.stateOf(conn.userId)?.channelId === s.channelId) {
      const found = await loadChannel(this.db, s.channelId)
      if (found?.row.spaceId) {
        const p = (await memberPermissions(this.db, found.row.spaceId, conn.userId)).get(conn.userId) ?? 0
        if (hasPermission(p, Permission.MUTE_MEMBERS) || hasPermission(p, Permission.MOVE_MEMBERS)) {
          if (this.sessions.get(s.channelId) === s) this.end(s, 'moderator')
          return
        }
      }
    }
    this.error(conn, f.op, 'forbidden', s.id)
  }

  // ---- playback transitions -----------------------------------------------------------------------------------------

  /** Applies a playback change; every change bumps `seq`. */
  private change(s: Session, patch: Partial<CinemaPlayback>): void {
    s.playback = { ...s.playback, ...patch, seq: s.playback.seq + 1 }
  }

  /** Banks the media time played since the last play stamp (until `until`, server ms) before the timeline changes. */
  private bank(s: Session, until: number): void {
    const p = s.playback
    if (p.playing) s.watchedS += positionAt(p, until, s.film.durationS) - p.position
  }

  /** start/seek: freeze at the target; everyone prepares, then `play` fires (all ready, or after the ready timeout). */
  private buffer(s: Session, by: string, position: number): void {
    this.clearHold(s)
    const now = Date.now()
    this.bank(s, now)
    for (const seat of s.seats.values()) if (seat.status !== 'unsupported') seat.status = 'preparing'
    this.change(s, { playing: false, position, at: now, reason: 'buffering', by, waitingFor: [], countdown: false })
    s.pausedAt = now
    this.hold(s, () => this.play(s, false))
    this.broadcast(s)
  }

  /** Freezes everyone at the exact position the timeline reaches at the stamped instant. */
  private pause(s: Session, reason: 'user' | 'waiting' | 'host_away', waitingFor: string[], by: string | null = null): void {
    this.clearHold(s)
    const p = s.playback
    const at = Date.now() + this.timings.leadMs
    this.bank(s, at)
    if (p.playing) s.pausedAt = at
    this.change(s, {
      playing: false, position: positionAt(p, at, s.film.durationS), at, reason, by,
      waitingFor: reason === 'waiting' ? [...new Set([...p.waitingFor, ...waitingFor])] : [], countdown: false,
    })
    this.broadcast(s)
  }

  /** One rule for every resume (play, ready-gated, continue_without): count down after a pause longer than the threshold. */
  private resume(s: Session, by: string | null = s.playback.by): void {
    this.play(s, Date.now() - s.pausedAt > this.timings.countdownAfterPauseMs, by)
  }

  private play(s: Session, countdown: boolean, by: string | null = s.playback.by): void {
    this.clearHold(s)
    const at = Date.now() + (countdown ? this.timings.countdownMs : this.timings.leadMs)
    this.change(s, { playing: true, at, reason: 'user', by, waitingFor: [], countdown })
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
    this.sendIndex(s, conn.userId)
  }

  private unseat(s: Session, userId: string): void {
    const had = s.seats.delete(userId)
    s.noWait.delete(userId)
    s.blocks.delete(userId)
    if (userId === s.hostId) return this.hostGone(s)
    if (!had) return
    const p = s.playback
    if (p.reason === 'waiting' && p.waitingFor.includes(userId)) {
      const waitingFor = p.waitingFor.filter((u) => u !== userId)
      if (waitingFor.length === 0) return this.resume(s)
      this.change(s, { waitingFor })
    } else if (p.reason === 'buffering' && !p.playing && this.allReady(s)) {
      return this.play(s, false)
    }
    this.broadcast(s)
  }

  /** The host left their seat, the call, or lost every socket: pause and wait for them. */
  private hostGone(s: Session): void {
    if (s.hostAway) return
    s.hostAway = true
    s.awayFromFoyer = s.playback.reason === 'foyer'
    s.hostTimer = setTimeout(() => this.end(s, 'host_left'), this.timings.hostAwayMs)
    if (s.awayFromFoyer) return this.broadcast(s)
    this.pause(s, 'host_away', [])
  }

  private hostBack(s: Session): void {
    clearTimeout(s.hostTimer)
    s.hostAway = false
    this.change(s, { playing: false, reason: s.awayFromFoyer ? 'foyer' : 'user', by: s.awayFromFoyer ? null : s.hostId, waitingFor: [], countdown: false })
    s.awayFromFoyer = false
    this.broadcast(s)
  }

  private end(s: Session, reason: CinemaEndReason): void {
    this.clearTimers(s)
    this.bank(s, Date.now())
    this.sessions.delete(s.channelId)
    metrics.cinemaEnded.inc({ reason })
    // Earliest bucket wins a tie.
    const best = [...s.peaks].reduce<[number, number] | null>((m, e) => (!m || e[1] > m[1] || (e[1] === m[1] && e[0] < m[0]) ? e : m), null)
    const d = {
      channelId: s.channelId, sessionId: s.id, ended: true as const, reason,
      summary: {
        watchedS: s.watchedS, seats: [...s.everSeated], reactions: s.reactions,
        peak: best && { position: best[0] * PEAK_BUCKET_S, count: best[1] },
      },
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

  // shortcut: blocks are read when a user sits or says hello, so a block made while seated shows in `direct` only at their next hello; signals check the database live.
  private async loadBlocks(s: Session, userId: string): Promise<void> {
    s.blocks.set(userId, await blockedWith(this.db, userId))
  }

  private direct(s: Session, a: string, b: string): boolean {
    return !(s.blocks.get(a)?.has(b) || s.blocks.get(b)?.has(a))
  }

  /** STUN plus TURN with a temporary credential (TURN REST: HMAC-SHA1 of `expiry:userId` with the shared secret). */
  private iceServers(userId: string): CinemaIceServer[] {
    const { stunUrls, turnUrls, turnSecret } = this.cfg
    const out: CinemaIceServer[] = []
    if (stunUrls.length) out.push({ urls: stunUrls })
    if (turnUrls.length && turnSecret) {
      const username = `${Math.floor(Date.now() / 1000) + CINEMA_TURN_TTL_S}:${userId}`
      out.push({ urls: turnUrls, username, credential: createHmac('sha1', turnSecret).update(username).digest('base64') })
    }
    return out
  }

  /** The state as `forUser` sees it: `direct` and `iceServers` are per recipient (ICE only for seated ones). */
  private view(s: Session, forUser?: string): CinemaSessionView {
    return {
      sessionId: s.id, channelId: s.channelId, hostId: s.hostId, film: s.film, playback: s.playback, options: s.options,
      seats: [...s.seats.values()].map((x) => ({
        userId: x.userId, status: x.status, aheadS: x.aheadS, direct: forUser === undefined || this.direct(s, forUser, x.userId),
      })),
      iceServers: forUser !== undefined && s.seats.has(forUser) ? this.iceServers(forUser) : [], createdAt: s.createdAt,
    }
  }

  private broadcast(s: Session): void {
    this.hub.dispatch(this.voice.inChannel(s.channelId).map((v) => v.userId), 'CINEMA_STATE', (u) => this.view(s, u))
  }

  /** The piece index, replayed in frames of CINEMA_ITEMS_PER_FRAME items (a new seat gets it before its first state). */
  private sendIndex(s: Session, userId: string): void {
    if (userId === s.hostId) return
    for (const [track, list] of s.pieces) {
      for (let from = 0; from < list.length; from += CINEMA_ITEMS_PER_FRAME) {
        this.toSeat(s, userId, 'CINEMA_PIECES', { sessionId: s.id, track, from, items: list.slice(from, from + CINEMA_ITEMS_PER_FRAME) })
      }
    }
  }

  /** To the seat's own socket; while it has none, to every socket of the user. */
  private toSeat<T extends DispatchType>(s: Session, userId: string, t: T, d: DispatchOf<T>): void {
    const conn = s.seats.get(userId)?.conn
    if (conn) this.reply(conn, t, d)
    else this.hub.dispatch([userId], t, d as never) // generic payload: Hub's own Payload<T> cannot be matched by inference
  }

  private reply<T extends DispatchType>(conn: Conn, t: T, d: DispatchOf<T>): void {
    conn.send(JSON.stringify({ op: 'dispatch', t, d }))
  }

  private error(conn: Conn, op: string, reason: CinemaErrorReason, sessionId?: string): void {
    this.reply(conn, 'CINEMA_ERROR', { op, reason, ...(sessionId ? { sessionId } : {}) })
  }
}
