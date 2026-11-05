import type { CinemaPieceMeta, CinemaTrackId } from '@alga/shared'
import { Assembler } from './assembler'
import type { PieceCache } from './cache'
import { CHUNK_BYTES, bitsOf, decode, encode, setOf, verOf, type WireMsg } from './protocol'
import { hostShouldSend, isCritical, isLate, nextRequests, pieceKey, type SwarmView } from './scheduler'

/** Sending pauses above this many queued bytes and resumes on bufferedamountlow at LOW_WATER (spec §6.4). */
export const HIGH_WATER = 256 * 1024
export const LOW_WATER = 128 * 1024
/** Pieces downloading at once (bounds assembly memory). */
const MAX_INFLIGHT = 12
/** Requests a peer may queue with us; more are answered `none` (bounds upload memory and abuse). */
const MAX_UPLOAD_QUEUE = 4
/** A download times out when its source sent no byte at all for this long (a strike against the source)… */
const REQ_TIMEOUT_MS = 15_000
/** …or when the source keeps sending other pieces but nothing of this one for this long (no strike). */
const STALE_MS = 60_000
/** A whole piece still being verified or written after this long is dropped (a stuck OPFS write). */
const DONE_TIMEOUT_MS = 30_000
/** close() waits this long at most for a write in progress. */
const CLOSE_WAIT_MS = 1_000
/** A `none` keeps us from asking that peer for that piece this long (or until it announces it again). */
const REFUSED_MS = 5_000
/** Host: a piece turned down for super-seed is served if the same peer asks again this soon (it can't reach the holder). */
const REPEAT_MS = 10_000
/** This many timeouts or bans within STRIKE_WINDOW_MS put a peer in back-off for BACKOFF_MS. */
const STRIKES = 3
const STRIKE_WINDOW_MS = 60_000
const BACKOFF_MS = 60_000
const TICK_MS = 1_000
/** Default cache budget: 10 min ahead of a 40 Mbps remux (3 GB) plus slack; the app may pass its OPFS quota. */
const DEFAULT_CAP_BYTES = 4 * 1024 ** 3
/** When space runs short, pieces more than this far behind the playhead go first. */
const BEHIND_S = 600

/** The part of RTCDataChannel the swarm uses; tests back it with a MessageChannel. */
export interface ChannelLike {
  send(data: ArrayBuffer): void
  readonly bufferedAmount: number
  bufferedAmountLowThreshold: number
  onmessage: ((e: MessageEvent) => void) | null
  onbufferedamountlow: ((e: Event) => void) | null
  close(): void
}

type Source = (track: CinemaTrackId, n: number) => Promise<ArrayBuffer | null>
interface Upload { track: CinemaTrackId; n: number; v: number; urgent: boolean; buf: ArrayBuffer | null; off: number }
/** `at` = last accepted chunk (request time before); `done` = every byte is in (being verified/stored): later chunks are ignored. */
interface Flight { peer: string; track: CinemaTrackId; n: number; start: number; at: number; got: number; done: boolean }
interface Peer {
  id: string; ch: ChannelLike; has: Map<CinemaTrackId, Set<number>>
  /** Sent bytes with a wrong hash for this piece version: never asked again for it. */
  banned: Set<string>
  /** Answered `none` (key → when): skipped for REFUSED_MS, until it announces the piece, or until a peer leaves. */
  refused: Map<string, number>
  /** Host side: pieces turned down for this peer (super-seed), key -> when. */
  declined: Map<string, number>
  /** Host side: pieces sent or queued to this peer (also in `has`) that it has not confirmed with got/have yet. */
  sending: Map<CinemaTrackId, Set<number>>
  strikes: number[]; backoffUntil: number
  /** When it last sent us a byte we took. */
  lastByte: number
  queue: Upload[]; loading: boolean; bytesIn: number; mbps: number
}

const setIn = <K, V>(m: Map<K, Set<V>>, k: K): Set<V> => {
  let s = m.get(k)
  if (!s) m.set(k, (s = new Set()))
  return s
}
const hexOf = (d: ArrayBuffer) => Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('')

/**
 * The film as a small torrent between the seated peers (spec §6.4): pieces are requested by the scheduler, sent in
 * chunks with data-channel backpressure, verified by SHA-256 against the host's index (§6.8) and cached. The host
 * serves from `source` (its piece factory) and super-seeds; friends serve from the cache.
 */
export class Swarm {
  private readonly peers = new Map<string, Peer>()
  private readonly index = new Map<CinemaTrackId, CinemaPieceMeta[]>()
  private readonly mine = new Map<CinemaTrackId, Set<number>>()
  private readonly inflight = new Map<string, Flight>()
  private readonly asm = new Assembler()
  /** Critical pieces already moved once from a late source (never moved again: no ping-pong). */
  private readonly moved = new Set<string>()
  private readonly cbs = new Set<(track: CinemaTrackId, n: number) => void>()
  private readonly timer: ReturnType<typeof setInterval>
  private tracks: CinemaTrackId[] = []
  private playheadS = 0
  private queued = false
  private closed = false
  private fromHost = 0
  private fromPeers = 0
  private down = 0
  private up = 0
  private downMbps = 0
  private upMbps = 0
  private cap: number
  /** Stores run one at a time so eviction and the byte count stay in step. */
  private storing: Promise<unknown> = Promise.resolve()

  constructor(private readonly opts: { sessionId: string; isHost: boolean; cache: PieceCache; source?: Source; hostId?: string; capBytes?: number }) {
    this.cap = opts.capBytes ?? DEFAULT_CAP_BYTES
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  addPeer(id: string, ch: ChannelLike): void {
    this.removePeer(id)
    const p: Peer = {
      id, ch, has: new Map(), banned: new Set(), refused: new Map(), declined: new Map(), sending: new Map(), strikes: [],
      backoffUntil: 0, lastByte: 0, queue: [], loading: false, bytesIn: 0, mbps: 0,
    }
    this.peers.set(id, p)
    ch.bufferedAmountLowThreshold = LOW_WATER
    ch.onbufferedamountlow = () => this.pump(p)
    ch.onmessage = (e) => {
      const m = e.data instanceof ArrayBuffer ? decode(e.data) : null // text or malformed: dropped
      if (m && this.peers.get(id) === p) this.onMessage(p, m)
    }
    for (const [track, set] of this.mine) if (set.size) this.ctl(p, { t: 'have', track, bits: bitsOf(set) })
    this.schedule()
  }

  removePeer(id: string): void {
    const p = this.peers.get(id)
    if (!p) return
    this.peers.delete(id)
    p.ch.onmessage = null
    p.ch.onbufferedamountlow = null
    p.ch.close()
    this.asm.dropPeer(id)
    for (const [k, f] of this.inflight) if (f.peer === id) this.dropFlight(k)
    for (const q of this.peers.values()) q.refused.clear() // whoever turned us down (super-seed) may serve now
    this.schedule()
  }

  /** Index entries from `from` on (may overwrite: a changed entry is a new version and drops the old bytes, R4). */
  setIndex(track: CinemaTrackId, from: number, items: CinemaPieceMeta[]): void {
    let list = this.index.get(track)
    if (!list) this.index.set(track, (list = []))
    const host = this.opts.hostId === undefined ? undefined : this.peers.get(this.opts.hostId)
    items.forEach((m, i) => {
      const n = from + i
      const old = list[n]
      list[n] = m
      if (old && old.some((x, j) => x !== m[j])) this.invalidate(track, n)
      if (this.opts.isHost && !setIn(this.mine, track).has(n)) this.gotPiece(track, n)
      // the index comes from the host's factory, so the host has what it lists (until it answers `none`)
      if (host) {
        setIn(host.has, track).add(n)
        host.refused.delete(pieceKey(track, n))
      }
    })
    this.schedule()
  }

  setPlayhead(s: number): void {
    this.playheadS = s
    this.schedule()
  }

  setTracks(t: CinemaTrackId[]): void {
    this.tracks = [...t]
    this.schedule()
  }

  async get(track: CinemaTrackId, n: number): Promise<ArrayBuffer | null> {
    if (this.opts.isHost) return this.opts.source ? this.opts.source(track, n).catch(() => null) : null
    return this.mine.get(track)?.has(n) ? this.opts.cache.get(pieceKey(track, n)).catch(() => null) : null
  }

  /** Init segment = piece 0 (R5). */
  init(track: CinemaTrackId): Promise<ArrayBuffer | null> {
    return this.get(track, 0)
  }

  /** The track's index: position = n, generation order (look pieces up by startS for time order, R4). */
  pieces(track: CinemaTrackId): readonly CinemaPieceMeta[] {
    return this.index.get(track) ?? []
  }

  /** Seconds held contiguously from the playhead on (pieces ordered by startS, R4). */
  aheadS(track: CinemaTrackId): number {
    const mine = this.mine.get(track)
    const media = (this.index.get(track) ?? []).flatMap((m, n) => (m[1] > 0 ? [[m[0], m[1], n] as const] : [])).sort((a, b) => a[0] - b[0])
    let end = this.playheadS
    for (const [s, d, n] of media) {
      if (s + d <= end) continue
      if (s > end + 0.05 || !mine?.has(n)) break
      end = s + d
    }
    return end - this.playheadS
  }

  stats(): { fromHostPct: number; fromPeersPct: number; downMbps: number; upMbps: number; peers: number } {
    const total = this.fromHost + this.fromPeers
    return {
      fromHostPct: total ? (100 * this.fromHost) / total : 0,
      fromPeersPct: total ? (100 * this.fromPeers) / total : 0,
      downMbps: this.downMbps, upMbps: this.upMbps, peers: this.peers.size,
    }
  }

  onPiece(cb: (track: CinemaTrackId, n: number) => void): () => void {
    this.cbs.add(cb)
    return () => this.cbs.delete(cb)
  }

  /** Detaches every peer and clears the session's cache (its OPFS dir). */
  async close(): Promise<void> {
    this.closed = true
    clearInterval(this.timer)
    for (const id of [...this.peers.keys()]) this.removePeer(id)
    this.cbs.clear()
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([this.storing, new Promise((r) => { timer = setTimeout(r, CLOSE_WAIT_MS) })]) // a stuck write can't hold close
    clearTimeout(timer)
    await this.opts.cache.clear()
  }

  // ---- wire ---------------------------------------------------------------------------------------------------------

  private onMessage(p: Peer, m: WireMsg): void {
    if (!this.index.has(m.track)) return // only this film's tracks: bounds what a peer can make us keep
    if (m.t === 'have') {
      const held = setOf(m.bits)
      // the host's marks for pieces still on their way to this peer stay until it confirms or cancels them
      const sent = p.sending.get(m.track)
      for (const n of sent ?? []) {
        if (held.has(n)) sent?.delete(n)
        else held.add(n)
      }
      p.has.set(m.track, held)
    } else if (m.t === 'got') {
      setIn(p.has, m.track).add(m.n)
      p.sending.get(m.track)?.delete(m.n)
      p.refused.delete(pieceKey(m.track, m.n))
    } else if (m.t === 'none') {
      const k = pieceKey(m.track, m.n)
      p.refused.set(k, Date.now())
      if (this.inflight.get(k)?.peer === p.id) this.dropFlight(k)
    } else if (m.t === 'req') return this.serve(p, m.track, m.n, m.v, m.urgent)
    else if (m.t === 'cancel') {
      p.queue = p.queue.filter((u) => u.track !== m.track || u.n !== m.n)
      if (this.opts.isHost) this.unmark(p, m.track, m.n)
      return this.pump(p)
    } else return this.onChunk(p, m)
    this.schedule()
  }

  private serve(p: Peer, track: CinemaTrackId, n: number, v: number, urgent: boolean): void {
    if (p.queue.some((u) => u.track === track && u.n === n)) return
    const meta = this.index.get(track)?.[n]
    if (!meta || verOf(meta[3]) !== v || !this.mine.get(track)?.has(n) || p.queue.length >= MAX_UPLOAD_QUEUE) return this.ctl(p, { t: 'none', track, n })
    if (this.opts.isHost) {
      // already sent to them (or theirs): no pulling the same piece twice until a cancel, have or reconnect clears it
      if (p.has.get(track)?.has(n)) return this.ctl(p, { t: 'none', track, n })
      const k = pieceKey(track, n)
      const now = Date.now()
      // super-seed, unless it is urgent for them, or a repeat once another friend has confirmed the piece: a requester
      // that could reach that friend asks it instead, so the repeat means it can't
      const repeat = now - (p.declined.get(k) ?? -Infinity) < REPEAT_MS && this.confirmedElsewhere(p, track, n)
      if (!urgent && !repeat && !hostShouldSend(this.view(), p.id, track, n)) {
        p.declined.set(k, now)
        return this.ctl(p, { t: 'none', track, n })
      }
      p.declined.delete(k)
      setIn(p.has, track).add(n) // count it as theirs from now on
      setIn(p.sending, track).add(n)
    }
    // urgent pieces go before queued prefetch; a head already being sent keeps going
    const u: Upload = { track, n, v, urgent, buf: null, off: 0 }
    const from = p.queue[0] && (p.queue[0].off > 0 || p.loading) ? 1 : 0
    const at = urgent ? p.queue.findIndex((x, i) => i >= from && !x.urgent) : -1
    if (at >= 0) p.queue.splice(at, 0, u)
    else p.queue.push(u)
    this.pump(p)
  }

  private pump(p: Peer): void {
    while (p.queue.length && p.ch.bufferedAmount <= HIGH_WATER && this.peers.get(p.id) === p) {
      const u = p.queue[0]!
      if (!u.buf) return this.load(p, u)
      const total = u.buf.byteLength
      const data = new Uint8Array(u.buf, u.off, Math.min(CHUNK_BYTES, total - u.off))
      this.ctl(p, { t: 'chunk', track: u.track, n: u.n, v: u.v, offset: u.off, total, data })
      this.up += data.byteLength
      u.off += data.byteLength
      if (u.off >= total) p.queue.shift()
    }
  }

  /** Reads the head upload's bytes (one piece in memory per peer); gone or changed → `none`. */
  private load(p: Peer, u: Upload): void {
    if (p.loading) return
    p.loading = true
    void this.get(u.track, u.n).then((buf) => {
      p.loading = false
      if (p.queue[0] === u) {
        const meta = this.index.get(u.track)?.[u.n]
        if (buf && meta && buf.byteLength === meta[2] && verOf(meta[3]) === u.v) u.buf = buf
        else {
          p.queue.shift()
          this.ctl(p, { t: 'none', track: u.track, n: u.n })
          if (!buf && this.mine.get(u.track)?.delete(u.n)) this.announce(u.track) // evicted (host: the factory dropped it)
          if (this.opts.isHost) this.unmark(p, u.track, u.n)
        }
      }
      this.pump(p)
    })
  }

  private onChunk(p: Peer, m: Extract<WireMsg, { t: 'chunk' }>): void {
    const k = pieceKey(m.track, m.n)
    const f = this.inflight.get(k)
    const meta = this.index.get(m.track)?.[m.n]
    // unsolicited, already whole, or an old version still in the pipe
    if (!f || f.peer !== p.id || f.done || !meta || m.v !== verOf(meta[3])) return
    if (m.total !== meta[2]) return this.reject(p, f, 'size')
    const whole = this.asm.add(p.id, k, m.offset, m.total, m.data)
    if (whole === false) return // a repeated chunk is not progress
    const len = m.data.byteLength
    f.at = p.lastByte = Date.now()
    f.got += len
    p.bytesIn += len
    this.down += len
    if (p.id === this.opts.hostId) this.fromHost += len
    else this.fromPeers += len
    if (whole === true) return
    f.done = true
    void this.complete(p, f, meta, whole) // handles its own failures
  }

  private async complete(p: Peer, f: Flight, meta: CinemaPieceMeta, whole: Uint8Array<ArrayBuffer>): Promise<void> {
    const k = pieceKey(f.track, f.n)
    let stage: 'verify' | 'cache' = 'verify'
    try {
      const hex = hexOf(await crypto.subtle.digest('SHA-256', whole))
      if (this.closed || this.inflight.get(k) !== f) return // cancelled or superseded meanwhile
      if (hex !== meta[3]) return this.reject(p, f, 'hash')
      stage = 'cache'
      const step = this.storing.then(() => this.store(f, whole))
      this.storing = step.catch(() => {})
      await step
    } catch (e) {
      console.warn(`[cinema] could not ${stage} ${k}`, e)
      if (stage === 'cache') this.cap = Math.min(this.cap, this.opts.cache.bytes()) // storage is smaller than planned
      if (this.inflight.get(k) === f) this.cancelFlight(k) // the cancel undoes the uploader's "they have it" mark
      this.schedule()
    }
  }

  /** Runs one at a time (eviction and the byte count stay in step); commits only if the flight is still current. */
  private async store(f: Flight, whole: Uint8Array<ArrayBuffer>): Promise<void> {
    const k = pieceKey(f.track, f.n)
    if (this.closed || this.inflight.get(k) !== f) return
    await this.makeRoom(whole.byteLength)
    await this.opts.cache.put(k, whole.buffer)
    if (this.closed) return
    if (this.inflight.get(k) !== f) {
      // overwritten while writing; nothing newer is stored yet since stores are serialized
      if (!this.mine.get(f.track)?.has(f.n)) await this.opts.cache.delete(k)
      return
    }
    this.inflight.delete(k)
    this.gotPiece(f.track, f.n)
    this.schedule()
  }

  private gotPiece(track: CinemaTrackId, n: number): void {
    this.moved.delete(pieceKey(track, n))
    setIn(this.mine, track).add(n)
    for (const q of this.peers.values()) this.ctl(q, { t: 'got', track, n })
    for (const cb of this.cbs) cb(track, n)
  }

  private reject(p: Peer, f: Flight, why: 'hash' | 'size'): void {
    const k = pieceKey(f.track, f.n)
    console.warn(`[cinema] ${why} mismatch for ${k} from ${p.id}: banned for this piece`)
    p.banned.add(k)
    this.strike(p)
    this.cancelFlight(k)
    this.schedule()
  }

  /** Timeouts and bans add up: STRIKES of them within STRIKE_WINDOW_MS put the peer in back-off. */
  private strike(p: Peer, now = Date.now()): void {
    p.strikes = [...p.strikes.filter((t) => now - t < STRIKE_WINDOW_MS), now]
    if (p.strikes.length >= STRIKES) p.backoffUntil = now + BACKOFF_MS
  }

  private dropFlight(k: string): Flight | undefined {
    const f = this.inflight.get(k)
    this.inflight.delete(k)
    this.asm.drop(k)
    return f
  }

  /** Drops the download and tells its source to stop (the host then stops counting the piece as ours). */
  private cancelFlight(k: string): void {
    const f = this.dropFlight(k)
    const p = f && this.peers.get(f.peer)
    if (f && p) this.ctl(p, { t: 'cancel', track: f.track, n: f.n })
  }

  /** Host: forgets that `p` has (or is getting) piece n. */
  private unmark(p: Peer, track: CinemaTrackId, n: number): void {
    p.has.get(track)?.delete(n)
    p.sending.get(track)?.delete(n)
  }

  /** Host: a friend other than `p` has confirmed (got/have) that it holds piece n. */
  private confirmedElsewhere(p: Peer, track: CinemaTrackId, n: number): boolean {
    for (const q of this.peers.values()) if (q !== p && q.has.get(track)?.has(n) && !q.sending.get(track)?.has(n)) return true
    return false
  }

  /** Tells every peer what we hold for `track` now (after dropping pieces). */
  private announce(track: CinemaTrackId): void {
    const bits = bitsOf(this.mine.get(track) ?? [])
    for (const q of this.peers.values()) this.ctl(q, { t: 'have', track, bits })
  }

  /** A changed index entry: drop our copy, the download in progress and per-piece verdicts about the old version. */
  private invalidate(track: CinemaTrackId, n: number): void {
    const k = pieceKey(track, n)
    if (this.mine.get(track)?.delete(n) && !this.opts.isHost) void this.opts.cache.delete(k)
    this.cancelFlight(k)
    this.moved.delete(k)
    for (const p of this.peers.values()) {
      p.banned.delete(k)
      p.refused.delete(k)
      // the host knows nobody has the new version yet; a friend's old `has` is fixed by a `none` and its next `got`
      if (this.opts.isHost) this.unmark(p, track, n)
    }
  }

  /** Evicts until `bytes` fit: > 10 min behind the playhead first, then other pieces behind, then the farthest ahead. */
  private async makeRoom(bytes: number): Promise<void> {
    let over = this.opts.cache.bytes() + bytes - this.cap
    if (over <= 0) return
    const victims: [number, CinemaTrackId, number, number][] = []
    for (const [track, set] of this.mine) {
      for (const n of set) {
        const m = this.index.get(track)?.[n]
        if (!m || isCritical(m, this.playheadS)) continue
        const behind = this.playheadS - m[0] - m[1]
        victims.push([behind > BEHIND_S ? 2e9 + behind : behind >= 0 ? 1e9 + behind : m[0], track, n, m[2]])
      }
    }
    victims.sort((a, b) => b[0] - a[0])
    const touched = new Set<CinemaTrackId>()
    try {
      for (const [, track, n, size] of victims) {
        if (over <= 0) break
        this.mine.get(track)?.delete(n)
        touched.add(track)
        await this.opts.cache.delete(pieceKey(track, n))
        over -= size
      }
    } finally {
      for (const track of touched) this.announce(track)
    }
  }

  private ctl(p: Peer, m: WireMsg): void {
    try {
      p.ch.send(encode(m))
    } catch {
      // channel closing: the mesh removes the peer
    }
  }

  // ---- scheduling ---------------------------------------------------------------------------------------------------

  private view(): SwarmView {
    const now = Date.now()
    const load = new Map<string, number>()
    const inflight = new Map<string, string>()
    for (const [k, f] of this.inflight) {
      // a whole piece being verified no longer takes its source's slot and is not worth preempting
      inflight.set(k, f.done ? '' : f.peer)
      if (!f.done) load.set(f.peer, (load.get(f.peer) ?? 0) + 1)
    }
    return {
      now, playheadS: this.playheadS, tracks: this.tracks, index: this.index, mine: this.mine,
      peers: [...this.peers.values()].map((p) => ({
        id: p.id, isHost: p.id === this.opts.hostId, has: p.has, inflight: load.get(p.id) ?? 0,
        mbps: p.backoffUntil > now ? -1 : p.mbps,
        bannedFor: p.refused.size ? new Set([...p.banned, ...p.refused.keys()]) : p.banned,
      })),
      inflight,
      budgetPieces: this.opts.isHost ? 0 : this.budget(),
    }
  }

  /** Media pieces that still fit in the cache (counting what may be evicted from far behind), at the average size. */
  private budget(): number {
    let free = this.cap - this.opts.cache.bytes()
    let sum = 0
    let count = 0
    for (const track of this.tracks) {
      ;(this.index.get(track) ?? []).forEach((m, n) => {
        if (m[1] === 0) return
        sum += m[2]
        count++
        if (this.mine.get(track)?.has(n) && this.playheadS - m[0] - m[1] > BEHIND_S) free += m[2]
        if (this.inflight.has(pieceKey(track, n))) free -= m[2]
      })
    }
    return count ? Math.max(0, Math.floor(free / (sum / count))) : 0
  }

  private schedule(): void {
    if (this.queued || this.closed || this.opts.isHost) return
    this.queued = true
    queueMicrotask(() => {
      this.queued = false
      if (this.closed) return
      for (const r of nextRequests(this.view(), MAX_INFLIGHT - this.inflight.size)) {
        if (r.preempt) this.cancelFlight(r.preempt)
        const meta = this.index.get(r.track)?.[r.n]
        const p = this.peers.get(r.peer)
        if (!meta || !p) continue
        const now = Date.now()
        this.inflight.set(pieceKey(r.track, r.n), { peer: r.peer, track: r.track, n: r.n, start: now, at: now, got: 0, done: false })
        this.ctl(p, { t: 'req', track: r.track, n: r.n, v: verOf(meta[3]), urgent: r.urgent })
      }
    })
  }

  private tick(): void {
    const now = Date.now()
    const ewma = (prev: number, bytes: number) => prev / 2 + (bytes * 8) / 1e6 / 2 // bytes per TICK_MS (1 s) → Mbps
    for (const p of this.peers.values()) {
      p.mbps = ewma(p.mbps, p.bytesIn)
      p.bytesIn = 0
      for (const [k, at] of p.refused) if (now - at > REFUSED_MS) p.refused.delete(k)
      for (const [k, at] of p.declined) if (now - at >= REPEAT_MS) p.declined.delete(k)
    }
    this.downMbps = ewma(this.downMbps, this.down)
    this.upMbps = ewma(this.upMbps, this.up)
    this.down = this.up = 0
    for (const [k, f] of this.inflight) {
      if (f.done) {
        if (now - f.at < DONE_TIMEOUT_MS) continue
        console.warn(`[cinema] ${k} stuck verifying or writing: dropped`)
        this.cancelFlight(k)
        this.storing = Promise.resolve() // later pieces stop waiting behind the stuck write
        continue
      }
      const p = this.peers.get(f.peer)
      const m = this.index.get(f.track)?.[f.n]
      if (!p || !m) continue
      const silent = now - Math.max(f.start, p.lastByte) >= REQ_TIMEOUT_MS // nothing at all from that peer
      const stale = now - f.at >= STALE_MS // busy with other pieces, never this one
      // a critical download that will miss the playhead moves (once) to another holder
      const late = !silent && !stale && !this.moved.has(k) && isCritical(m, this.playheadS) &&
        isLate(m, f.got, (now - f.start) / 1000, this.playheadS) && this.otherHolder(p, f.track, f.n)
      if (!silent && !stale && !late) continue
      this.cancelFlight(k)
      p.refused.set(k, now)
      if (silent) this.strike(p, now)
      else if (late) this.moved.add(k)
    }
    this.schedule()
  }

  private otherHolder(p: Peer, track: CinemaTrackId, n: number): boolean {
    const k = pieceKey(track, n)
    for (const q of this.peers.values()) if (q !== p && q.has.get(track)?.has(n) && !q.banned.has(k) && !q.refused.has(k)) return true
    return false
  }
}
