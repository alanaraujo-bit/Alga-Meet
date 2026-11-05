/** Frames in the median window (spec §6.6). */
const WINDOW = 10
/** Below this the error is left alone. */
const DEAD_MS = 20
/** Above this a rate nudge would take too long: seek. */
const SEEK_MS = 500
/** rate = 1 ∓ min(|err| / NUDGE_MS, MAX_NUDGE). */
const NUDGE_MS = 3_000
const MAX_NUDGE = 0.05
/** A rate correction that has not brought the error under DEAD_MS by then gives way to a seek. */
const CONVERGE_MS = 5_000
/** Weight of a new seek-latency measurement after the first. */
const LATENCY_ALPHA = 0.3

export type SyncAction = { kind: 'none' } | { kind: 'rate'; rate: number } | { kind: 'seek'; toS: number }

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/**
 * Turns per-frame sync errors (rVFC mediaTime − expected position, ms; positive = ahead of the room) into a playback
 * correction, with the thresholds of spec §6.6.
 */
export class SyncController {
  private errs: number[] = []
  /** When the current out-of-deadband episode started (ms), null while in sync. */
  private since: number | null = null
  private latencyMs: number
  private learned = false

  constructor(opts?: { seekLatencyMs?: number }) {
    this.latencyMs = opts?.seekLatencyMs ?? 0
  }

  get seekLatencyMs(): number {
    return this.latencyMs
  }

  /**
   * Feeds one frame. `targetS` is the room position the frame was measured against; a seek goes there plus the learned
   * seek latency (the room keeps moving while the seek completes).
   */
  frame(errMs: number, nowMs: number, targetS = 0): SyncAction {
    this.errs.push(errMs)
    if (this.errs.length > WINDOW) this.errs.shift()
    if (this.errs.length < WINDOW) return { kind: 'none' }
    const err = median(this.errs)
    const abs = Math.abs(err)
    if (abs < DEAD_MS) {
      this.since = null
      return { kind: 'none' }
    }
    this.since ??= nowMs
    if (abs > SEEK_MS || nowMs - this.since >= CONVERGE_MS) {
      this.reset()
      return { kind: 'seek', toS: targetS + this.latencyMs / 1000 }
    }
    return { kind: 'rate', rate: 1 - Math.sign(err) * Math.min(abs / NUDGE_MS, MAX_NUDGE) }
  }

  /** Time from setting currentTime to 'seeked' (ms), for a seek inside the buffered range. */
  learnSeekLatency(ms: number): void {
    this.latencyMs = this.learned ? this.latencyMs + (ms - this.latencyMs) * LATENCY_ALPHA : ms
    this.learned = true
  }

  /** Forgets the window (after a seek, a new command, or a hidden window); keeps the learned latency. */
  reset(): void {
    this.errs = []
    this.since = null
  }
}
