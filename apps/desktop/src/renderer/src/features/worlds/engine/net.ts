/**
 * Other people's movement. Their poses arrive about ten times a second and never evenly; drawing the latest one would
 * make them stutter. Each person is drawn a little in the past, between the two poses around that moment.
 */
import { turn } from './collision'

/** How far in the past others are drawn: a bit over one tick plus the usual jitter of the gateway. */
export const RENDER_DELAY_MS = 160
/** With no news for this long the person simply stands where they were last seen. */
const HOLD_MS = 400

export interface Sample {
  x: number
  z: number
  yaw: number
  gait: number
  /** Metres per second over the ground at that moment (for the stride of the walk). */
  speed: number
}

interface Key {
  t: number
  x: number
  z: number
  yaw: number
  gait: number
}

export class PoseTrack {
  private keys: Key[] = []

  /** `t`: local clock (ms) when the pose arrived. */
  push(t: number, x: number, z: number, yaw: number, gait: number): void {
    const last = this.keys[this.keys.length - 1]
    // Clocks never go back; two poses in the same millisecond keep the later one.
    if (last && t <= last.t) t = last.t + 1
    this.keys.push({ t, x, z, yaw, gait })
    if (this.keys.length > 6) this.keys.shift()
  }

  /** Puts the person somewhere at once (arrived, sat down, the room changed). */
  snap(t: number, x: number, z: number, yaw: number): void {
    this.keys = [{ t, x, z, yaw, gait: 0 }]
  }

  sample(now: number): Sample | null {
    const keys = this.keys
    if (!keys.length) return null
    const t = now - RENDER_DELAY_MS
    const last = keys[keys.length - 1]!
    if (t >= last.t) {
      // Past the newest pose: keep walking the same way for a moment, then stand.
      const prev = keys[keys.length - 2]
      const age = t - last.t
      if (!prev || age > HOLD_MS || last.gait === 0) return { x: last.x, z: last.z, yaw: last.yaw, gait: age > HOLD_MS ? 0 : last.gait, speed: 0 }
      const dt = Math.max(1, last.t - prev.t)
      const vx = (last.x - prev.x) / dt, vz = (last.z - prev.z) / dt
      const k = Math.min(age, 120)
      return { x: last.x + vx * k, z: last.z + vz * k, yaw: last.yaw, gait: last.gait, speed: Math.hypot(vx, vz) * 1000 }
    }
    let i = keys.length - 1
    while (i > 0 && keys[i - 1]!.t > t) i--
    const b = keys[i]!
    const a = keys[i - 1]
    if (!a) return { x: b.x, z: b.z, yaw: b.yaw, gait: b.gait, speed: 0 }
    const span = Math.max(1, b.t - a.t)
    const f = Math.min(1, Math.max(0, (t - a.t) / span))
    return {
      x: a.x + (b.x - a.x) * f,
      z: a.z + (b.z - a.z) * f,
      yaw: a.yaw + turn(a.yaw, b.yaw) * f,
      gait: f < 0.5 ? a.gait : b.gait,
      speed: (Math.hypot(b.x - a.x, b.z - a.z) / span) * 1000,
    }
  }
}

/**
 * Decides when my own pose is worth sending: at most `hz` times a second, only when it changed, and once more when I
 * stop (so others see me standing, not frozen mid-stride).
 */
export class PoseSender {
  private lastAt = 0
  private last: readonly [number, number, number, number] | null = null

  constructor(private readonly hz: number) {}

  /** Returns the pose to send now, or null. `pose`: [x cm, z cm, yaw degrees, gait]. */
  next(now: number, pose: readonly [number, number, number, number]): readonly [number, number, number, number] | null {
    if (now - this.lastAt < 1000 / this.hz) return null
    const l = this.last
    if (l && l[0] === pose[0] && l[1] === pose[1] && l[2] === pose[2] && l[3] === pose[3]) return null
    // A turn of a few degrees while standing is not news.
    if (l && l[0] === pose[0] && l[1] === pose[1] && l[3] === pose[3] && Math.abs(l[2] - pose[2]) < 4) return null
    this.lastAt = now
    this.last = pose
    return pose
  }

  reset(): void {
    this.last = null
    this.lastAt = 0
  }
}
