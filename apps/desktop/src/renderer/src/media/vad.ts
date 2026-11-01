// Voice-activity gate: pure, sample-rate agnostic logic shared by the AudioWorklet and the unit tests.
// Input is the level (dBFS) of consecutive analysis frames; output is whether the mic gate is open.

export interface GateConfig {
  /** Manual open threshold in dBFS (e.g. -50). null = automatic (noise floor + margin). */
  thresholdDb: number | null
  /** Keep the gate open this long after the level falls below the close threshold, so word endings survive. */
  hangoverMs: number
}

export const DEFAULT_HANGOVER_MS = 300
/** Auto threshold = tracked noise floor + this margin. */
export const AUTO_MARGIN_DB = 12
export const AUTO_MIN_DB = -62
export const AUTO_MAX_DB = -30
/** Close threshold sits below the open threshold so a level hovering at the edge doesn't chatter. */
export const HYSTERESIS_DB = 4
/** Noise floor rises slowly (dB per second) and falls instantly: pauses between words pull it back down,
 * so speech can't raise its own threshold, while a noisier room is learned within seconds. */
export const FLOOR_RISE_DB_PER_S = 3

export function rmsDb(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!
  const rms = Math.sqrt(sum / Math.max(1, samples.length))
  return rms > 1e-6 ? 20 * Math.log10(rms) : -120
}

/** Speaking level for meters/glow: −50 dBFS → 0 … −20 dBFS → 1 (normal speech after AGC sits around −35…−20). */
export function perceptualLevel(db: number): number {
  return Math.max(0, Math.min(1, (db + 50) / 30))
}

export class VadGate {
  config: GateConfig
  open = false
  /** Tracked noise floor in dBFS (auto mode); seeded by the first frame. */
  floorDb: number | null = null
  private holdLeftMs = 0

  constructor(config: Partial<GateConfig> = {}) {
    this.config = { thresholdDb: null, hangoverMs: DEFAULT_HANGOVER_MS, ...config }
  }

  get thresholdDb(): number {
    const t = this.config.thresholdDb
    if (t !== null) return t
    return Math.min(AUTO_MAX_DB, Math.max(AUTO_MIN_DB, (this.floorDb ?? -70) + AUTO_MARGIN_DB))
  }

  /** Feed one analysis frame. Returns the gate state after it. */
  process(levelDb: number, frameMs: number): boolean {
    if (this.config.thresholdDb === null) {
      if (this.floorDb === null || levelDb < this.floorDb) this.floorDb = Math.max(-100, levelDb)
      else this.floorDb += (FLOOR_RISE_DB_PER_S * frameMs) / 1000
    }
    const openAt = this.thresholdDb
    const closeAt = openAt - HYSTERESIS_DB
    if (levelDb >= openAt || (this.open && levelDb >= closeAt)) {
      this.open = true
      this.holdLeftMs = this.config.hangoverMs
    } else if (this.open) {
      this.holdLeftMs -= frameMs
      if (this.holdLeftMs <= 0) this.open = false
    }
    return this.open
  }
}

/** Push-to-talk release: the key going up closes the mic only after `delayMs` (word endings survive). */
export class PttLatch {
  pressed = false
  private releaseAt: number | null = null
  constructor(public delayMs = 150) {}

  down(): void {
    this.pressed = true
    this.releaseAt = null
  }
  up(now: number): void {
    this.releaseAt = now + this.delayMs
  }
  /** Is the mic open at time `now` (ms)? */
  isOpen(now: number): boolean {
    if (this.releaseAt !== null && now >= this.releaseAt) {
      this.pressed = false
      this.releaseAt = null
    }
    return this.pressed
  }
}
