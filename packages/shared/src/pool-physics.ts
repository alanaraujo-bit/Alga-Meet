/**
 * Pool physics: one table, sixteen balls, one cue. Shared by the server (which decides what a shot did) and the desktop
 * (which draws it), and both must get the same numbers, so this file is deterministic by construction: only + - * /
 * and Math.sqrt on doubles (all exactly rounded by IEEE 754), no trigonometry, no Math.random, fixed iteration order.
 * A direction travels as a vector and an elevation as its sine for that reason.
 *
 * The model (Marlow, "The Physics of Pocket Billiards"; Alciatore's technical proofs; Han 2005 for the cushion):
 *  - a struck ball slides (cloth friction turns its spin and its speed into each other along a parabola: this is where
 *    follow, draw, stun and the swerve of a masse come from), then rolls (slow steady loss), while side spin decays on
 *    its own;
 *  - ball against ball: normal impulse with restitution plus Coulomb friction at the contact, which is what throws an
 *    object ball off the geometric line and hands spin over;
 *  - ball against cushion: the nose touches above the centre, so the impulse has a downward part; friction at the nose
 *    makes side spin change the rebound angle (running and reverse english) and rolling balls come off slower;
 *  - pockets are a hole in the slate behind angled jaws: a ball drops when its centre is over the hole, and can rattle
 *    in the jaws first.
 * Not modelled: balls leaving the bed (jump shots, balls flying off the table).
 *
 * Frame: metres, origin at the centre of the playing surface, x along the table, y across, z up (right-handed). The
 * rack is at +x, the kitchen at -x. Time advances in steps of POOL_DT; inside a step the motion is exact up to each
 * event (a contact, a ball starting to roll or coming to rest).
 */

export const POOL_BALL_R = 0.028575
/** Half length and half width of the playing surface, cushion nose to cushion nose (an 8 ft table). */
export const POOL_HL = 1.12
export const POOL_HW = 0.56
/** Simulation step in seconds. Everyone who must agree on a shot advances by exactly this. */
export const POOL_DT = 0.001
/** Cue speed at impact, m/s: the softest touch and a hard break. */
export const POOL_MIN_CUE_SPEED = 0.05
export const POOL_MAX_CUE_SPEED = 8
/** How far from the centre of the ball the tip may hit, in ball radii, before it would miscue. */
export const POOL_MAX_TIP_OFFSET = 0.55
/** Largest sine of the cue's elevation (about 64 degrees: a full masse). */
export const POOL_MAX_ELEVATION = 0.9
/** A shot is over by then, whatever happens (a real one lasts 3 to 12 s). */
export const POOL_MAX_SHOT_S = 40

const R = POOL_BALL_R
const G = 9.81
const MU_SLIDE = 0.2
const MU_ROLL = 0.0105
/** Friction of the spot of cloth a spinning ball turns on. */
const MU_SPIN = 0.0127
const E_BALL = 0.95
const E_CUSHION = 0.85
const MU_CUSHION = 0.2
/** The nose of the cushion is at 63.5% of the ball's height: the contact is this far above the centre, as a sine. */
const NOSE_SIN = 0.27
const NOSE_COS = Math.sqrt(1 - NOSE_SIN * NOSE_SIN)
/** Ball over cue mass (170 g against 540 g) and how lively a leather tip is. */
const MASS_RATIO = 0.17 / 0.54
const TIP_RESTITUTION = 0.75
/** Sideways deflection of the cue ball per radius of side offset (radians, small): hit on the right, it leaves a little to the left. */
const SQUIRT = 0.035

const A_SLIDE = MU_SLIDE * G
const A_ROLL = MU_ROLL * G
const A_SPIN = (5 * MU_SPIN * G) / (2 * R)
const K_SPIN = 5 / (2 * R)
const EPS_SLIP = 1e-4
const EPS_SPEED = 1e-3
const EPS_SPINZ = 0.02

// ---- table -----------------------------------------------------------------------------------------------------------

/** Mouth of a corner pocket between the two cushion points, and of a side pocket (metres). */
const CORNER_MOUTH = 0.12
const SIDE_MOUTH = 0.133
/** A corner mouth is cut across the corner: its points are this far from it along each rail. */
export const POOL_CORNER_CUT = CORNER_MOUTH * Math.SQRT1_2
export const POOL_SIDE_HALF = SIDE_MOUTH / 2
/** Unit directions of the pocket facings, from the point into the pocket: 142 degrees to the rail at a corner, 104 at a side. */
const CORNER_FACE: readonly [number, number] = [0.7880107536, 0.6156614753]
const SIDE_FACE: readonly [number, number] = [0.2419218956, 0.9702957263]
const FACE_LEN = 0.075

/** Where a ball falls: the hole in the slate. Index order: -x-y, side -y, +x-y, -x+y, side +y, +x+y. */
export interface PoolPocket {
  x: number
  y: number
  r: number
}

interface Seg {
  ax: number; ay: number
  /** Unit direction and length. */
  tx: number; ty: number; len: number
  /** Unit normal into the playable side. */
  nx: number; ny: number
}

function seg(ax: number, ay: number, bx: number, by: number, insideX: number, insideY: number): Seg {
  const dx = bx - ax, dy = by - ay
  const len = Math.sqrt(dx * dx + dy * dy)
  const tx = dx / len, ty = dy / len
  let nx = -ty, ny = tx
  if ((insideX - ax) * nx + (insideY - ay) * ny < 0) { nx = -nx; ny = -ny }
  return { ax, ay, tx, ty, len, nx, ny }
}

const POCKETS: PoolPocket[] = []
const SEGS: Seg[] = []
/** The cushion points (where a nose meets a pocket facing): a ball can hit them like a post. */
const POINTS: [number, number][] = []

for (const sy of [-1, 1]) {
  for (const sx of [-1, 0, 1]) {
    if (sx === 0) {
      POCKETS.push({ x: 0, y: sy * (POOL_HW + 0.066), r: 0.062 })
      for (const side of [-1, 1]) {
        const px = side * POOL_SIDE_HALF, py = sy * POOL_HW
        POINTS.push([px, py])
        SEGS.push(seg(px, py, px - side * SIDE_FACE[0] * FACE_LEN, py + sy * SIDE_FACE[1] * FACE_LEN, 0, py))
      }
    } else {
      POCKETS.push({ x: sx * (POOL_HL + 0.0396), y: sy * (POOL_HW + 0.0396), r: 0.068 })
      const mx = sx * (POOL_HL - POOL_CORNER_CUT / 2), my = sy * (POOL_HW - POOL_CORNER_CUT / 2)
      // The point on the long rail and the one on the end rail, each with its facing.
      const ax = sx * (POOL_HL - POOL_CORNER_CUT), ay = sy * POOL_HW
      const bx = sx * POOL_HL, by = sy * (POOL_HW - POOL_CORNER_CUT)
      POINTS.push([ax, ay], [bx, by])
      SEGS.push(seg(ax, ay, ax + sx * CORNER_FACE[0] * FACE_LEN, ay + sy * CORNER_FACE[1] * FACE_LEN, mx, my))
      SEGS.push(seg(bx, by, bx + sx * CORNER_FACE[1] * FACE_LEN, by + sy * CORNER_FACE[0] * FACE_LEN, mx, my))
    }
  }
  // The two noses of this long rail.
  SEGS.push(seg(-(POOL_HL - POOL_CORNER_CUT), sy * POOL_HW, -POOL_SIDE_HALF, sy * POOL_HW, 0, 0))
  SEGS.push(seg(POOL_SIDE_HALF, sy * POOL_HW, POOL_HL - POOL_CORNER_CUT, sy * POOL_HW, 0, 0))
}
for (const sx of [-1, 1]) SEGS.push(seg(sx * POOL_HL, -(POOL_HW - POOL_CORNER_CUT), sx * POOL_HL, POOL_HW - POOL_CORNER_CUT, 0, 0))

export const POOL_POCKETS: readonly PoolPocket[] = POCKETS
/** The cushion as line segments [ax, ay, bx, by] (noses and pocket facings), for whoever draws the table. */
export const POOL_CUSHION_LINES: readonly (readonly [number, number, number, number])[] =
  SEGS.map((s) => [s.ax, s.ay, s.ax + s.tx * s.len, s.ay + s.ty * s.len] as const)

/** Inside this rectangle a ball touches no cushion and no pocket. */
const SAFE_X = POOL_HL - R
const SAFE_Y = POOL_HW - R
/** Past this a ball is in a pocket whatever the jaws did. */
const OUT = 0.03

// ---- shots and what happens ------------------------------------------------------------------------------------------

/** One stroke of the cue on the cue ball. */
export interface PoolShot {
  /** Where the cue points on the table. Any length; only the direction counts. */
  dx: number
  dy: number
  /** Speed of the cue at impact, m/s (POOL_MIN_CUE_SPEED..POOL_MAX_CUE_SPEED). */
  v: number
  /** Where the tip hits, in ball radii from the centre as the player sees the ball: a to the right, b upwards. */
  a: number
  b: number
  /** Sine of how far the butt of the cue is raised (0 = level). */
  e: number
}

/** A position on the table, or null for a ball that is not on it (pocketed). Index = ball number, 0 is the cue ball. */
export type PoolBalls = (readonly [number, number] | null)[]

export type PoolEvent =
  /** The cue hit the cue ball, which left at `v` m/s. */
  | { t: number; k: 'strike'; v: number }
  /** Balls `a` < `b` hit each other, closing at `v` m/s. */
  | { t: number; k: 'ball'; a: number; b: number; v: number }
  /** Ball `a` hit a cushion at `v` m/s into it. */
  | { t: number; k: 'rail'; a: number; v: number }
  /** Ball `a` dropped into pocket `p`, moving at `v` m/s. */
  | { t: number; k: 'pot'; a: number; p: number; v: number }

const REST = 0, SLIDE = 1, ROLL = 2, SPIN = 3, GONE = 4
const N = 16
const MAX_EVENTS_PER_STEP = 96

export class PoolSim {
  readonly x = new Float64Array(N)
  readonly y = new Float64Array(N)
  readonly vx = new Float64Array(N)
  readonly vy = new Float64Array(N)
  readonly wx = new Float64Array(N)
  readonly wy = new Float64Array(N)
  readonly wz = new Float64Array(N)
  /** 0 at rest, 1 sliding, 2 rolling, 3 spinning in place, 4 not on the table. */
  readonly st = new Uint8Array(N)
  /** Pocket each ball fell into during this simulation, or -1. */
  readonly pocket = new Int8Array(N).fill(-1)
  /** Seconds simulated. */
  time = 0
  /** Everything that made a sound or matters to the rules, in order. */
  events: PoolEvent[] = []
  // Scratch, per substep.
  private readonly ax = new Float64Array(N)
  private readonly ay = new Float64Array(N)
  private readonly lx = new Float64Array(N)
  private readonly ly = new Float64Array(N)
  private readonly tt = new Float64Array(N)

  constructor(balls: PoolBalls) {
    for (let i = 0; i < N; i++) {
      const b = balls[i]
      if (b) {
        this.x[i] = b[0]
        this.y[i] = b[1]
      } else {
        this.st[i] = GONE
      }
    }
  }

  /** Whether anything is still moving. */
  get busy(): boolean {
    for (let i = 0; i < N; i++) if (this.st[i] !== REST && this.st[i] !== GONE) return true
    return false
  }

  balls(): PoolBalls {
    const out: PoolBalls = []
    for (let i = 0; i < N; i++) out.push(this.st[i] === GONE ? null : [this.x[i]!, this.y[i]!])
    return out
  }

  /** The cue hits the cue ball. Values out of range are brought into it. */
  strike(shot: PoolShot): void {
    if (this.st[0] === GONE) return
    const len = Math.sqrt(shot.dx * shot.dx + shot.dy * shot.dy)
    if (!(len > 1e-9)) return
    const dx = shot.dx / len, dy = shot.dy / len
    let a = shot.a, b = shot.b
    const off = Math.sqrt(a * a + b * b)
    if (off > POOL_MAX_TIP_OFFSET) {
      a = (a / off) * POOL_MAX_TIP_OFFSET
      b = (b / off) * POOL_MAX_TIP_OFFSET
    }
    const sin = Math.min(POOL_MAX_ELEVATION, Math.max(0, shot.e))
    const cos = Math.sqrt(1 - sin * sin)
    const v0 = Math.min(POOL_MAX_CUE_SPEED, Math.max(POOL_MIN_CUE_SPEED, shot.v))
    // Impulse per unit of ball mass: an off-centre hit spends part of the stroke on spin.
    const j = ((1 + TIP_RESTITUTION) * v0) / (1 + MASS_RATIO + 2.5 * (a * a + b * b))
    const speed = j * cos
    // Squirt: the ball leaves a little to the other side of the offset. (-dy, dx) is the player's left.
    const sq = SQUIRT * a
    const sc = Math.sqrt(1 - sq * sq)
    this.vx[0] = speed * (dx * sc - dy * sq)
    this.vy[0] = speed * (dy * sc + dx * sq)
    const k = j * K_SPIN
    this.wx[0] = k * (a * sin * dx - b * dy)
    this.wy[0] = k * (a * sin * dy + b * dx)
    this.wz[0] = k * a * cos
    this.classify(0)
    this.events.push({ t: this.time, k: 'strike', v: speed })
  }

  /** Advances the table by POOL_DT. */
  step(): void {
    let left = POOL_DT
    for (let n = 0; n < MAX_EVENTS_PER_STEP && left > 0; n++) left -= this.substep(left)
    this.time += POOL_DT
  }

  /** Sets the state of a ball from its velocities, after something hit it. */
  private classify(i: number): void {
    const ux = this.vx[i]! - R * this.wy[i]!, uy = this.vy[i]! + R * this.wx[i]!
    if (ux * ux + uy * uy > EPS_SLIP * EPS_SLIP) {
      this.st[i] = SLIDE
    } else if (this.vx[i]! * this.vx[i]! + this.vy[i]! * this.vy[i]! > EPS_SPEED * EPS_SPEED) {
      this.st[i] = ROLL
      this.wx[i] = -this.vy[i]! / R
      this.wy[i] = this.vx[i]! / R
    } else {
      this.halt(i)
    }
  }

  private halt(i: number): void {
    this.vx[i] = 0
    this.vy[i] = 0
    this.wx[i] = 0
    this.wy[i] = 0
    if (Math.abs(this.wz[i]!) > EPS_SPINZ) {
      this.st[i] = SPIN
    } else {
      this.wz[i] = 0
      this.st[i] = REST
    }
  }

  /** Moves everything up to the next event within `h` seconds, handles that event, and returns the time used. */
  private substep(h: number): number {
    const { x, y, vx, vy, wx, wy, wz, st, ax, ay, lx, ly, tt } = this
    // Accelerations, and the first ball to change state (start rolling, stop) bounds the interval: within it every
    // acceleration is constant.
    for (let i = 0; i < N; i++) {
      const s = st[i]!
      ax[i] = 0
      ay[i] = 0
      tt[i] = Infinity
      if (s === SLIDE) {
        const ux = vx[i]! - R * wy[i]!, uy = vy[i]! + R * wx[i]!
        const u = Math.sqrt(ux * ux + uy * uy)
        // No slip left to divide by: the change of state is now.
        if (u < 1e-9) {
          tt[i] = 0
        } else {
          ax[i] = (-A_SLIDE * ux) / u
          ay[i] = (-A_SLIDE * uy) / u
          tt[i] = (2 * u) / (7 * A_SLIDE)
        }
      } else if (s === ROLL) {
        const sp = Math.sqrt(vx[i]! * vx[i]! + vy[i]! * vy[i]!)
        if (sp < 1e-9) {
          tt[i] = 0
        } else {
          ax[i] = (-A_ROLL * vx[i]!) / sp
          ay[i] = (-A_ROLL * vy[i]!) / sp
          tt[i] = sp / A_ROLL
        }
      }
      if (tt[i]! < h) h = tt[i]!
    }
    // Over so short a time each path is its chord: the mean velocity of the interval.
    for (let i = 0; i < N; i++) {
      lx[i] = vx[i]! + 0.5 * ax[i]! * h
      ly[i] = vy[i]! + 0.5 * ay[i]! * h
    }

    // The earliest contact. kind: 1 ball-ball (a, b), 2 ball-cushion (a, normal). Two things only touch when they close
    // in by the chord and, by their velocity right now, faster than about a nanometre a second: below that it is two
    // balls lying against each other, and finding that contact again and again would never let time pass.
    let tc = h, kind = 0, ca = 0, cb = 0, cnx = 0, cny = 0
    for (let i = 0; i < N; i++) {
      const si = st[i]!
      if (si === GONE) continue
      const moving = si === SLIDE || si === ROLL
      for (let j = i + 1; j < N; j++) {
        const sj = st[j]!
        if (sj === GONE || (!moving && sj !== SLIDE && sj !== ROLL)) continue
        const px = x[j]! - x[i]!, py = y[j]! - y[i]!
        const qx = lx[j]! - lx[i]!, qy = ly[j]! - ly[i]!
        const b = px * qx + py * qy
        if (b >= 0 || px * (vx[j]! - vx[i]!) + py * (vy[j]! - vy[i]!) > -1e-10) continue
        const c = px * px + py * py - 4 * R * R
        let t = 0
        if (c > 0) {
          const a = qx * qx + qy * qy
          const disc = b * b - a * c
          if (disc < 0) continue
          t = (-b - Math.sqrt(disc)) / a
        }
        if (t < tc) { tc = t; kind = 1; ca = i; cb = j }
      }
      if (!moving) continue
      const ex = x[i]! + lx[i]! * h, ey = y[i]! + ly[i]! * h
      if (Math.abs(x[i]!) <= SAFE_X && Math.abs(y[i]!) <= SAFE_Y && Math.abs(ex) <= SAFE_X && Math.abs(ey) <= SAFE_Y) continue
      for (let k = 0; k < SEGS.length; k++) {
        const s = SEGS[k]!
        const vn = lx[i]! * s.nx + ly[i]! * s.ny
        if (vn >= 0 || vx[i]! * s.nx + vy[i]! * s.ny > -1e-9) continue
        const d = (x[i]! - s.ax) * s.nx + (y[i]! - s.ay) * s.ny
        if (d < -R) continue
        const t = d > R ? (d - R) / -vn : 0
        if (t >= tc) continue
        const along = (x[i]! + lx[i]! * t - s.ax) * s.tx + (y[i]! + ly[i]! * t - s.ay) * s.ty
        if (along < 0 || along > s.len) continue
        tc = t; kind = 2; ca = i; cnx = -s.nx; cny = -s.ny
      }
      for (let k = 0; k < POINTS.length; k++) {
        const p = POINTS[k]!
        const px = x[i]! - p[0], py = y[i]! - p[1]
        const b = px * lx[i]! + py * ly[i]!
        if (b >= 0 || px * vx[i]! + py * vy[i]! > -1e-10) continue
        const c = px * px + py * py - R * R
        let t = 0
        if (c > 0) {
          const a = lx[i]! * lx[i]! + ly[i]! * ly[i]!
          const disc = b * b - a * c
          if (disc < 0) continue
          t = (-b - Math.sqrt(disc)) / a
        }
        if (t >= tc) continue
        const nx = p[0] - (x[i]! + lx[i]! * t), ny = p[1] - (y[i]! + ly[i]! * t)
        const nl = Math.sqrt(nx * nx + ny * ny)
        if (!(nl > 1e-12)) continue
        tc = t; kind = 2; ca = i; cnx = nx / nl; cny = ny / nl
      }
    }

    // Move to that moment.
    for (let i = 0; i < N; i++) {
      const s = st[i]!
      if (s === GONE || s === REST) continue
      if (s === SPIN) {
        this.spinDown(i, tc)
        continue
      }
      x[i] = x[i]! + lx[i]! * tc
      y[i] = y[i]! + ly[i]! * tc
      vx[i] = vx[i]! + ax[i]! * tc
      vy[i] = vy[i]! + ay[i]! * tc
      if (s === SLIDE) {
        wx[i] = wx[i]! + K_SPIN * ay[i]! * tc
        wy[i] = wy[i]! - K_SPIN * ax[i]! * tc
      }
      this.spinDown(i, tc)
      if (tt[i]! <= tc) {
        // Sliding has just become rolling, or rolling has just ended.
        if (s === SLIDE && vx[i]! * vx[i]! + vy[i]! * vy[i]! > EPS_SPEED * EPS_SPEED) {
          st[i] = ROLL
          wx[i] = -vy[i]! / R
          wy[i] = vx[i]! / R
        } else {
          this.halt(i)
        }
      } else if (s === ROLL) {
        wx[i] = -vy[i]! / R
        wy[i] = vx[i]! / R
      }
      if (Math.abs(x[i]!) > SAFE_X || Math.abs(y[i]!) > SAFE_Y) this.drop(i)
    }

    if (kind === 1 && st[ca] !== GONE && st[cb] !== GONE) this.hitBall(ca, cb)
    else if (kind === 2 && st[ca] !== GONE) this.hitCushion(ca, cnx, cny)
    return tc
  }

  private spinDown(i: number, t: number): void {
    const w = this.wz[i]!
    if (w === 0) return
    const d = A_SPIN * t
    this.wz[i] = w > d ? w - d : w < -d ? w + d : 0
    if (this.st[i] === SPIN && this.wz[i] === 0) this.st[i] = REST
  }

  /** A ball whose centre is over a hole falls in. */
  private drop(i: number): void {
    const px = this.x[i]!, py = this.y[i]!
    let into = -1
    for (let p = 0; p < POCKETS.length; p++) {
      const k = POCKETS[p]!
      const dx = px - k.x, dy = py - k.y
      if (dx * dx + dy * dy < k.r * k.r) { into = p; break }
    }
    if (into < 0) {
      if (Math.abs(px) <= POOL_HL + OUT && Math.abs(py) <= POOL_HW + OUT) return
      let best = Infinity
      for (let p = 0; p < POCKETS.length; p++) {
        const k = POCKETS[p]!
        const d = (px - k.x) * (px - k.x) + (py - k.y) * (py - k.y)
        if (d < best) { best = d; into = p }
      }
    }
    this.st[i] = GONE
    this.pocket[i] = into
    this.events.push({ t: this.time, k: 'pot', a: i, p: into, v: Math.sqrt(this.vx[i]! * this.vx[i]! + this.vy[i]! * this.vy[i]!) })
  }

  private hitBall(i: number, j: number): void {
    const { x, y, vx, vy, wx, wy, wz } = this
    let nx = x[j]! - x[i]!, ny = y[j]! - y[i]!
    const d = Math.sqrt(nx * nx + ny * ny)
    nx /= d
    ny /= d
    // Velocity of i's surface against j's at the contact: the centres, plus both spins.
    const un = (vx[i]! - vx[j]!) * nx + (vy[i]! - vy[j]!) * ny
    if (un <= 0) return
    const sx = wx[i]! + wx[j]!, sy = wy[i]! + wy[j]!, sz = wz[i]! + wz[j]!
    const ux = vx[i]! - vx[j]! - R * sz * ny
    const uy = vy[i]! - vy[j]! + R * sz * nx
    const tx = ux - un * nx, ty = uy - un * ny, tz = R * (sx * ny - sy * nx)
    const slip = Math.sqrt(tx * tx + ty * ty + tz * tz)
    const jn = ((1 + E_BALL) * un) / 2
    let fx = 0, fy = 0, fz = 0
    if (slip > 1e-9) {
      // Ball-to-ball friction falls as the surfaces rub faster (Alciatore's fit, as a rational function).
      const mu = 0.01 + 0.108 / (1 + 1.088 * slip + 0.592 * slip * slip)
      const jt = Math.min(mu * jn, slip / 7)
      fx = (jt * tx) / slip
      fy = (jt * ty) / slip
      fz = (jt * tz) / slip
    }
    vx[i] = vx[i]! - jn * nx - fx
    vy[i] = vy[i]! - jn * ny - fy
    vx[j] = vx[j]! + jn * nx + fx
    vy[j] = vy[j]! + jn * ny + fy
    // The same turn for both: -(R n) x f on one, (-R n) x f on the other.
    const rx = -K_SPIN * (ny * fz), ry = -K_SPIN * (-nx * fz), rz = -K_SPIN * (nx * fy - ny * fx)
    wx[i] = wx[i]! + rx; wy[i] = wy[i]! + ry; wz[i] = wz[i]! + rz
    wx[j] = wx[j]! + rx; wy[j] = wy[j]! + ry; wz[j] = wz[j]! + rz
    this.classify(i)
    this.classify(j)
    // A ball pressed against one that will not move touches it several times in the same instant: that is one hit.
    const last = this.events[this.events.length - 1]
    if (!(last && last.k === 'ball' && last.a === i && last.b === j && last.t === this.time)) this.events.push({ t: this.time, k: 'ball', a: i, b: j, v: un })
  }

  /** (nx, ny): unit vector from the ball towards the cushion. */
  private hitCushion(i: number, nx: number, ny: number): void {
    const { vx, vy, wx, wy, wz } = this
    const tx = -ny, ty = nx
    let vn = vx[i]! * nx + vy[i]! * ny
    if (vn <= 0) return
    const hit = vn
    let vt = vx[i]! * tx + vy[i]! * ty
    let wn = wx[i]! * nx + wy[i]! * ny
    let wt = wx[i]! * tx + wy[i]! * ty
    // Slip of the ball's surface on the nose: down its face, and along the rail.
    const sx = vn * NOSE_SIN + R * wt
    const sy = -vt - R * wz[i]! * NOSE_COS + R * wn * NOSE_SIN
    const pn = (1 + E_CUSHION) * vn * NOSE_COS
    const slip = Math.sqrt(sx * sx + sy * sy)
    let fx = sx * (2 / 7), fy = sy * (2 / 7)
    if (slip * (2 / 7) > MU_CUSHION * pn) {
      fx = (MU_CUSHION * pn * sx) / slip
      fy = (MU_CUSHION * pn * sy) / slip
    }
    vn += -fx * NOSE_SIN - pn * NOSE_COS
    vt += fy
    wn += -K_SPIN * fy * NOSE_SIN
    wt += -K_SPIN * fx
    wz[i] = wz[i]! + K_SPIN * fy * NOSE_COS
    vx[i] = vn * nx + vt * tx
    vy[i] = vn * ny + vt * ty
    wx[i] = wn * nx + wt * tx
    wy[i] = wn * ny + wt * ty
    this.classify(i)
    this.events.push({ t: this.time, k: 'rail', a: i, v: hit })
  }
}

/** Plays a whole shot: what happened, where every ball ended and how long it took (seconds). */
export function simulateShot(balls: PoolBalls, shot: PoolShot): { events: PoolEvent[]; balls: PoolBalls; seconds: number } {
  const sim = new PoolSim(balls)
  sim.strike(shot)
  const max = POOL_MAX_SHOT_S / POOL_DT
  for (let n = 0; n < max && sim.busy; n++) sim.step()
  return { events: sim.events, balls: sim.balls(), seconds: sim.time }
}
