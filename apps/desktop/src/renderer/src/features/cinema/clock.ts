/** Samples kept; the offset comes from the one with the smallest round trip (spec §6.6, NTP-style). */
const MAX_SAMPLES = 16
/** Ping fast until this many samples, then slowly. */
const WARM_SAMPLES = 8
const FAST_PING_MS = 1_000
const SLOW_PING_MS = 15_000
/** Wall clock and performance.now disagreeing by more than this means the wall clock jumped (sleep, OS time change). */
const JUMP_MS = 1_000

/**
 * Server clock estimate from `cinema_time {c}` → CINEMA_PONG {c, s} round trips. All client times are wall clock
 * (Date.now) ms; `jumped` tells the caller when that clock moved under us so it can reset and ping fast again.
 */
export class ClockEstimator {
  private samples: { offset: number; rtt: number }[] = []
  /** The estimate in use while there is no sample (after reset): the last one, shifted across clock jumps. */
  private fallback: number | null = null
  private wall: number | null = null
  private perf = 0

  /** c = client send, s = server time, r = client receive (ms). */
  add(sample: { c: number; s: number; r: number }): void {
    const rtt = sample.r - sample.c
    if (!(rtt >= 0)) return // the wall clock went back mid-flight: useless sample
    this.samples.push({ offset: sample.s - (sample.c + sample.r) / 2, rtt })
    if (this.samples.length > MAX_SAMPLES) this.samples.shift()
  }

  /** server − client (ms), from the min-RTT sample of the last 16; after reset(), the last estimate; null before any. */
  offsetMs(): number | null {
    let best: { offset: number; rtt: number } | null = null
    for (const x of this.samples) if (!best || x.rtt < best.rtt) best = x
    return best ? best.offset : this.fallback
  }

  /** False until the first sample (and again after reset()): commands should not be applied on a guessed clock. */
  hasSample(): boolean {
    return this.samples.length > 0
  }

  serverNow(clientNow = Date.now()): number {
    return clientNow + (this.offsetMs() ?? 0)
  }

  nextPingDelayMs(): number {
    return this.samples.length < WARM_SAMPLES ? FAST_PING_MS : SLOW_PING_MS
  }

  /**
   * True when the wall clock moved > 1 s more (or less) than performance.now since the last call. The estimate is
   * shifted by that drift right away, so serverNow stays right while the caller resets and pings fast.
   */
  jumped(clientNow: number, perfNow: number): boolean {
    const drift = this.wall === null ? 0 : clientNow - this.wall - (perfNow - this.perf)
    this.wall = clientNow
    this.perf = perfNow
    if (Math.abs(drift) <= JUMP_MS) return false
    for (const x of this.samples) x.offset -= drift
    if (this.fallback !== null) this.fallback -= drift
    return true
  }

  /** Drops the samples (ping fast again) but keeps the current estimate until a new sample arrives. */
  reset(): void {
    this.fallback = this.offsetMs()
    this.samples = []
    this.wall = null
  }
}
