import type { CinemaPieceMeta, CinemaTrackId } from '@alga/shared'
import { CHUNK_BYTES, encode, verOf } from './protocol'

/** Sending to a lane pauses above this many queued bytes and resumes on bufferedamountlow at LOW_WATER (spec §6.4). */
export const HIGH_WATER = 256 * 1024
export const LOW_WATER = 128 * 1024
/** Requests a peer may queue with us; more are answered `none` (bounds upload memory and abuse). */
export const MAX_UPLOAD_QUEUE = 4
/** Prefetch pacing never goes below this fraction of its base rate. */
export const PACE_FLOOR = 1 / 8
/** RTT counts as inflated above max(2 × the lane's baseline, baseline + this): a LAN's 1 ms baseline is noise. */
export const RTT_SLACK_MS = 25
/** The pacing rate changes at most this often (RTT samples come every ~3 s per lane). */
export const PACE_ADJUST_MS = 2_500

/** The part of RTCDataChannel the swarm uses; tests back it with a MessageChannel. */
export interface ChannelLike {
  send(data: ArrayBuffer): void
  readonly bufferedAmount: number
  bufferedAmountLowThreshold: number
  onmessage: ((e: MessageEvent) => void) | null
  onbufferedamountlow: ((e: Event) => void) | null
  close(): void
}

export interface Upload { track: CinemaTrackId; n: number; v: number; urgent: boolean; buf: ArrayBuffer | null; off: number }

export interface UploaderDeps {
  /** The piece's bytes (cache or factory); null when we no longer have it. */
  read(track: CinemaTrackId, n: number): Promise<ArrayBuffer | null>
  meta(track: CinemaTrackId, n: number): CinemaPieceMeta | undefined
  /** The head upload was gone or changed when read: the swarm answers `none` (`gone`: we no longer hold it). */
  refused(u: Upload, gone: boolean): void
  /** Payload bytes handed to a channel (stats). */
  sent(bytes: number): void
}

/**
 * Prefetch pacing toward one peer (uplink protection: the call's voice shares it). A token bucket at `rate` bytes/s
 * that may go into debt by a whole piece: a prefetch piece starts only when the debt is paid, then goes at link speed.
 * Delay-based back-off: when any lane's RTT is inflated (a queue is building, ours or the path's), the rate halves (down
 * to PACE_FLOOR × base); while every lane is back to normal it climbs back by a quarter of the base per step.
 */
export class Pacer {
  private rate: number
  private tokens = 0
  private at: number
  private adjustedAt = -Infinity
  private readonly lanes = new Map<number, { base: number; high: boolean }>()

  /** `baseBps` ≤ 0: no pacing. */
  constructor(private readonly baseBps: number, now = Date.now()) {
    this.rate = baseBps
    this.at = now
  }

  get bps(): number {
    return this.rate
  }

  /** ms until a prefetch piece may start. */
  waitMs(now = Date.now()): number {
    if (this.baseBps <= 0) return 0
    this.refill(now)
    return this.tokens >= 0 ? 0 : Math.ceil((-this.tokens / this.rate) * 1000)
  }

  spend(bytes: number, now = Date.now()): void {
    if (this.baseBps <= 0) return
    this.refill(now)
    this.tokens -= bytes
  }

  rtt(lane: number, ms: number, now = Date.now()): void {
    const l = this.lanes.get(lane) ?? { base: ms, high: false }
    l.base = Math.min(l.base, ms)
    l.high = ms > Math.max(2 * l.base, l.base + RTT_SLACK_MS)
    this.lanes.set(lane, l)
    if (this.baseBps <= 0 || now - this.adjustedAt < PACE_ADJUST_MS) return
    const high = [...this.lanes.values()].some((x) => x.high)
    const next = high ? Math.max(this.baseBps * PACE_FLOOR, this.rate / 2) : Math.min(this.baseBps, this.rate + this.baseBps / 4)
    if (next === this.rate) return
    this.refill(now)
    this.rate = next
    this.adjustedAt = now
  }

  dropLane(lane: number): void {
    this.lanes.delete(lane)
  }

  private refill(now: number): void {
    // at most one chunk of credit after an idle spell: pacing is about the average, not a burst allowance
    this.tokens = Math.min(CHUNK_BYTES, this.tokens + ((now - this.at) * this.rate) / 1000)
    this.at = now
  }
}

/**
 * One peer's upload queue (spec §6.4): one piece in memory at a time, its chunks striped over the peer's lanes (the lane
 * with the least bufferedAmount first, none above HIGH_WATER). Urgent pieces go out at once; prefetch is paced.
 */
export class PeerUploader {
  readonly queue: Upload[] = []
  readonly pacer: Pacer
  private readonly lanes = new Map<number, ChannelLike>()
  private loading = false
  private closed = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly deps: UploaderDeps, paceBps = 0) {
    this.pacer = new Pacer(paceBps)
  }

  addLane(k: number, ch: ChannelLike): void {
    ch.bufferedAmountLowThreshold = LOW_WATER
    ch.onbufferedamountlow = () => this.pump()
    this.lanes.set(k, ch)
    this.pump()
  }

  removeLane(k: number): void {
    const ch = this.lanes.get(k)
    if (ch) ch.onbufferedamountlow = null
    this.lanes.delete(k)
    this.pacer.dropLane(k)
  }

  queued(track: CinemaTrackId, n: number): boolean {
    return this.queue.some((u) => u.track === track && u.n === n)
  }

  get full(): boolean {
    return this.queue.length >= MAX_UPLOAD_QUEUE
  }

  /**
   * Urgent pieces go before queued prefetch, in time order (init segments first; a tie keeps arrival order); a head
   * already being sent keeps going, except for a one-chunk urgent piece (an init segment), which passes it: a seat's
   * audio init waited ~10 s behind 6 MB of its video on a 12 Mbps uplink (Task 16 lab), and no frame shows without it.
   */
  add(track: CinemaTrackId, n: number, v: number, urgent: boolean): void {
    const u: Upload = { track, n, v, urgent, buf: null, off: 0 }
    const q = this.queue
    const start = (x: Upload) => this.deps.meta(x.track, x.n)?.[0] ?? Infinity
    const tiny = urgent && (this.deps.meta(track, n)?.[2] ?? Infinity) <= CHUNK_BYTES
    const from = !tiny && q[0] && (q[0].off > 0 || this.loading) ? 1 : 0
    const at = urgent ? q.findIndex((x, i) => i >= from && (!x.urgent || start(x) > start(u))) : -1
    if (at >= 0) q.splice(at, 0, u)
    else q.push(u)
    this.pump()
  }

  cancel(track: CinemaTrackId, n: number): void {
    const keep = this.queue.filter((u) => u.track !== track || u.n !== n)
    this.queue.splice(0, this.queue.length, ...keep)
    this.pump()
  }

  close(): void {
    this.closed = true
    clearTimeout(this.timer)
    for (const ch of this.lanes.values()) ch.onbufferedamountlow = null
  }

  pump(): void {
    while (!this.closed && this.queue.length) {
      const ch = this.lane()
      if (!ch) return // bufferedamountlow calls again
      const u = this.queue[0]!
      if (!u.buf) {
        // a prefetch piece starts only when the pacer allows it; once started it goes at link speed
        const wait = !u.urgent && u.off === 0 && !this.loading ? this.pacer.waitMs() : 0
        if (wait > 0) return this.wake(wait)
        return this.load(u)
      }
      const total = u.buf.byteLength
      const data = new Uint8Array(u.buf, u.off, Math.min(CHUNK_BYTES, total - u.off))
      try {
        ch.send(encode({ t: 'chunk', track: u.track, n: u.n, v: u.v, offset: u.off, total, data }))
      } catch {
        // lane closing: the mesh removes it
      }
      this.deps.sent(data.byteLength)
      if (!u.urgent) this.pacer.spend(data.byteLength)
      u.off += data.byteLength
      if (u.off >= total) this.queue.shift()
    }
  }

  /** The open lane with the least queued, if any is at or under HIGH_WATER. */
  private lane(): ChannelLike | undefined {
    let best: ChannelLike | undefined
    for (const ch of this.lanes.values()) if (ch.bufferedAmount <= HIGH_WATER && (!best || ch.bufferedAmount < best.bufferedAmount)) best = ch
    return best
  }

  private wake(ms: number): void {
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.pump()
    }, ms)
  }

  /** Reads the head upload's bytes (one piece in memory per peer); gone or changed → `none`. */
  private load(u: Upload): void {
    if (this.loading) return
    this.loading = true
    void this.deps.read(u.track, u.n).then((buf) => {
      this.loading = false
      if (this.closed) return
      if (this.queue[0] === u) {
        const meta = this.deps.meta(u.track, u.n)
        if (buf && meta && buf.byteLength === meta[2] && verOf(meta[3]) === u.v) u.buf = buf
        else {
          this.queue.shift()
          this.deps.refused(u, !buf)
        }
      }
      this.pump()
    })
  }
}
