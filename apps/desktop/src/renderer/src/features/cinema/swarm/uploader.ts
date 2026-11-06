import type { CinemaPieceMeta, CinemaTrackId } from '@alga/shared'
import { CHUNK_BYTES, encode, verOf } from './protocol'

/** Sending pauses above this many queued bytes and resumes on bufferedamountlow at LOW_WATER (spec §6.4). */
export const HIGH_WATER = 256 * 1024
export const LOW_WATER = 128 * 1024
/** Requests a peer may queue with us; more are answered `none` (bounds upload memory and abuse). */
export const MAX_UPLOAD_QUEUE = 4

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

/** One peer's upload queue: one piece in memory at a time, sent in chunks with data-channel backpressure (spec §6.4). */
export class PeerUploader {
  readonly queue: Upload[] = []
  private loading = false
  private closed = false

  constructor(private readonly ch: ChannelLike, private readonly deps: UploaderDeps) {
    ch.bufferedAmountLowThreshold = LOW_WATER
    ch.onbufferedamountlow = () => this.pump()
  }

  queued(track: CinemaTrackId, n: number): boolean {
    return this.queue.some((u) => u.track === track && u.n === n)
  }

  get full(): boolean {
    return this.queue.length >= MAX_UPLOAD_QUEUE
  }

  /** Urgent pieces go before queued prefetch; a head already being sent keeps going. */
  add(track: CinemaTrackId, n: number, v: number, urgent: boolean): void {
    const u: Upload = { track, n, v, urgent, buf: null, off: 0 }
    const q = this.queue
    const from = q[0] && (q[0].off > 0 || this.loading) ? 1 : 0
    const at = urgent ? q.findIndex((x, i) => i >= from && !x.urgent) : -1
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
    this.ch.onbufferedamountlow = null
  }

  pump(): void {
    while (!this.closed && this.queue.length && this.ch.bufferedAmount <= HIGH_WATER) {
      const u = this.queue[0]!
      if (!u.buf) return this.load(u)
      const total = u.buf.byteLength
      const data = new Uint8Array(u.buf, u.off, Math.min(CHUNK_BYTES, total - u.off))
      try {
        this.ch.send(encode({ t: 'chunk', track: u.track, n: u.n, v: u.v, offset: u.off, total, data }))
      } catch {
        // channel closing: the mesh removes the peer
      }
      this.deps.sent(data.byteLength)
      u.off += data.byteLength
      if (u.off >= total) this.queue.shift()
    }
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
