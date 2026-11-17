/**
 * One pool table as it is seen: the balls on its cloth, the cues, the line that shows where a shot would go, and the
 * playing out of a shot. A shot is played by running the shared simulation here in step with the clock; the state the
 * server sent for after the shot is shown when the balls stop (the two agree, the simulation is deterministic).
 * Everything is in the table's own frame (table.ts), as a child of the table's item.
 */
import * as THREE from 'three'
import {
  POOL_BALL_R, POOL_DT, POOL_POCKETS, PoolSim, rackBalls, type PoolAim, type PoolBalls, type PoolShot, type PoolState,
} from '@alga/shared'
import type { Assets } from '../assets/loaders'
import { LIVE_LAYER } from '../engine/lighting'
import { CUE_LENGTH, buildBalls, buildCue } from './balls'
import type { PoolSound } from './sound'
import { BALL_Y, BED_Y, LAMP_Y, onTable } from './table'

const R = POOL_BALL_R
/** The forward stroke, from the pull to the ball. */
const STROKE_S = 0.11
/** How far the tip rests from the ball while aiming, and how far a full pull takes it back. */
const TIP_GAP = 0.014
const PULL_M = 0.24
const GUIDE_AFTER_RAIL_M = 0.3
const GUIDE_AFTER_HIT_M = 0.42

export interface PoolGuide {
  /** The cue ball's way to its first ball (or to where the line is cut): x, y pairs. */
  path: number[]
  /** Where the cue ball is when it touches that ball, and which ball. */
  ghost: [number, number] | null
  hit: number
  /** Where the cue ball and the ball it hit go right after. */
  after: number[]
  object: number[]
}

/** What a shot would do, as far as an honest aiming line shows: up to the first ball, or a little past the first rail. */
export function predict(balls: PoolBalls, shot: PoolShot): PoolGuide {
  const sim = new PoolSim(balls)
  sim.strike(shot)
  const out: PoolGuide = { path: [sim.x[0]!, sim.y[0]!], ghost: null, hit: -1, after: [], object: [] }
  let seen = sim.events.length, railAt = -1, travelled = 0
  let px = sim.x[0]!, py = sim.y[0]!
  for (let n = 0; n < 9000 && sim.busy && sim.st[0] !== 4; n++) {
    sim.step()
    const x = sim.x[0]!, y = sim.y[0]!
    travelled += Math.hypot(x - px, y - py)
    px = x
    py = y
    let corner = false
    for (; seen < sim.events.length; seen++) {
      const e = sim.events[seen]!
      if (e.k === 'ball' && e.a === 0 && out.hit < 0) out.hit = e.b
      else if (e.k === 'rail' && e.a === 0) {
        corner = true
        if (railAt < 0) railAt = travelled
      }
    }
    if (out.hit >= 0) {
      out.ghost = [x, y]
      break
    }
    if (corner || n % 5 === 4) out.path.push(x, y)
    if (railAt >= 0 && travelled - railAt > GUIDE_AFTER_RAIL_M) break
  }
  out.path.push(px, py)
  if (out.hit < 0) return out
  const h = out.hit
  out.after.push(px, py)
  out.object.push(sim.x[h]!, sim.y[h]!)
  let da = 0, dob = 0, ax = px, ay = py, ox = sim.x[h]!, oy = sim.y[h]!
  for (let n = 0; n < 1500 && (da < GUIDE_AFTER_HIT_M || dob < GUIDE_AFTER_HIT_M) && sim.busy; n++) {
    sim.step()
    if (sim.st[0] !== 4 && da < GUIDE_AFTER_HIT_M) {
      da += Math.hypot(sim.x[0]! - ax, sim.y[0]! - ay)
      ax = sim.x[0]!
      ay = sim.y[0]!
      if (n % 5 === 4) out.after.push(ax, ay)
    }
    if (sim.st[h] !== 4 && dob < GUIDE_AFTER_HIT_M) {
      dob += Math.hypot(sim.x[h]! - ox, sim.y[h]! - oy)
      ox = sim.x[h]!
      oy = sim.y[h]!
      if (n % 5 === 4) out.object.push(ox, oy)
    }
  }
  out.after.push(ax, ay)
  out.object.push(ox, oy)
  return out
}

/** A flat band along a line on the cloth. */
class Ribbon {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  private readonly pos: THREE.BufferAttribute
  private static readonly MAX = 512

  constructor(opacity: number) {
    const g = new THREE.BufferGeometry()
    this.pos = new THREE.BufferAttribute(new Float32Array(Ribbon.MAX * 2 * 3), 3)
    this.pos.setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('position', this.pos)
    const index: number[] = []
    for (let i = 0; i < Ribbon.MAX - 1; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
    g.setIndex(index)
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }))
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 3
    this.mesh.visible = false
  }

  /** `points`: x, y pairs on the table; `skip`: metres left out at the start (the ball itself). */
  set(points: number[], width: number, skip = 0): void {
    const n = Math.min(Ribbon.MAX, points.length >> 1)
    if (n < 2) return void (this.mesh.visible = false)
    const a = this.pos.array as Float32Array
    const y = BED_Y + 0.0016
    let m = 0, run = 0
    for (let i = 0; i < n; i++) {
      const x = points[i * 2]!, z = points[i * 2 + 1]!
      const bx = points[Math.min(n - 1, i + 1) * 2]! - points[Math.max(0, i - 1) * 2]!
      const by = points[Math.min(n - 1, i + 1) * 2 + 1]! - points[Math.max(0, i - 1) * 2 + 1]!
      if (i > 0) run += Math.hypot(x - points[i * 2 - 2]!, z - points[i * 2 - 1]!)
      if (run < skip && i < n - 1) continue
      const l = Math.hypot(bx, by) || 1
      const nx = (-by / l) * width * 0.5, ny = (bx / l) * width * 0.5
      a.set([x + nx, y, -(z + ny), x - nx, y, -(z - ny)], m * 6)
      m++
    }
    this.pos.needsUpdate = true
    this.mesh.geometry.setDrawRange(0, Math.max(0, m - 1) * 6)
    this.mesh.visible = m >= 2
  }

  hide(): void {
    this.mesh.visible = false
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}

/** Where a cue is: its tip and the unit direction it points, in the table's frame. */
export interface CuePose {
  tip: THREE.Vector3
  dir: THREE.Vector3
}

export interface PoolViewHooks {
  /** The balls of shot number `shot` (PoolState.shot after it) have stopped. */
  onSettled?(table: string, shot: number): void
}

interface Run {
  sim: PoolSim
  /** PoolState.shot once this shot is counted. */
  shotNo: number
  shot: PoolShot
  /** Seconds since the cue started forward; the ball is hit at STROKE_S. */
  t: number
  struck: boolean
  steps: number
  seen: number
  final: PoolState | null
  /** Seconds the balls have been still without a final state to show. */
  idle: number
}

const q1 = new THREE.Quaternion()
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3()
const Z = new THREE.Vector3(0, 0, 1)

export class PoolView {
  readonly root = new THREE.Group()
  /** The last state shown at rest (null: nobody has played here, a rack is waiting). */
  state: PoolState | null = null
  /** Whoever listens, in world space: sounds fade with the distance to the table. */
  listener: THREE.Vector3 | null = null
  private readonly balls: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhysicalMaterial>[]
  private readonly shadows: THREE.Mesh[] = []
  private readonly cues: THREE.Group[]
  private readonly path = new Ribbon(0.62)
  private readonly after = new Ribbon(0.4)
  private readonly object = new Ribbon(0.5)
  private readonly ghost: THREE.Group
  private readonly lamp: THREE.Object3D | null
  private shown: PoolBalls = rackBalls(1)
  private run: Run | null = null
  private readonly falls: { i: number; t: number; x: number; y: number; p: number }[] = []
  /** The cue ball while someone holds it in hand. */
  private held: [number, number] | null = null

  constructor(readonly id: string, item: THREE.Object3D, private readonly assets: Assets, blob: THREE.Texture, private readonly sound: PoolSound, private readonly hooks: PoolViewHooks) {
    this.root.name = `pool:${id}`
    this.balls = buildBalls(assets)
    const shadowG = assets.own(new THREE.PlaneGeometry(R * 4.6, R * 4.6).rotateX(-Math.PI / 2))
    const shadowM = assets.own(new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, opacity: 0.85 }))
    for (const ball of this.balls) {
      const sh = new THREE.Mesh(shadowG, shadowM)
      sh.renderOrder = 1
      this.shadows.push(sh)
      this.root.add(sh, ball)
    }
    this.cues = [buildCue(assets, 0x8b8ef7), buildCue(assets, 0xc98e52)]
    for (const c of this.cues) {
      c.visible = false
      this.root.add(c)
    }
    this.ghost = new THREE.Group()
    const ghostM = assets.own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false }))
    const ringM = assets.own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false }))
    const sphere = new THREE.Mesh(assets.own(new THREE.SphereGeometry(R, 28, 18)), ghostM)
    sphere.position.y = R
    const ring = new THREE.Mesh(assets.own(new THREE.RingGeometry(R - 0.003, R, 48).rotateX(-Math.PI / 2)), ringM)
    ring.position.y = 0.0018
    this.ghost.add(sphere, ring)
    this.ghost.visible = false
    this.ghost.renderOrder = 3
    this.root.add(this.path.mesh, this.after.mesh, this.object.mesh, this.ghost)
    // Balls move, so the room's reflection is taken without them (and they are lit like the people are).
    this.root.traverse((o) => o.layers.set(LIVE_LAYER))
    this.lamp = item.getObjectByName('pool:lamp') ?? null
    item.add(this.root)
    this.scatter()
    this.place()
  }

  /** Whether a shot is being played. */
  get rolling(): boolean {
    return this.run !== null
  }

  /** For whoever inspects the page (the e2e): shots played, and a fingerprint of where the balls lie (or that they roll). */
  get digest(): string {
    if (this.run) return `${this.id}:rolling`
    let h = 0x811c9dc5
    for (const ch of JSON.stringify(this.shown)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193)
    return `${this.id}:${this.state?.shot ?? 0}:${(h >>> 0).toString(16)}`
  }

  /** The balls as they lie now (with the cue ball where it is held, if it is in hand). */
  get lie(): PoolBalls {
    if (!this.held) return this.shown
    const b = this.shown.slice()
    b[0] = this.held
    return b
  }

  /** Shows a state at rest, at once. Null: a rack nobody has touched. */
  show(state: PoolState | null): void {
    const racked = !state || state.breaking
    if (racked && (this.state?.rack !== state?.rack || (this.state?.shot ?? 0) > 0)) this.scatter()
    this.state = state
    this.run = null
    this.falls.length = 0
    this.held = null
    this.shown = state ? state.balls : rackBalls(1)
    this.place()
  }

  /**
   * Plays a shot from the table it was taken on. `final`: the state to show when the balls stop, if it is already
   * known. `age`: seconds the shot is already old (someone arriving in the middle of it).
   */
  play(from: PoolBalls, shot: PoolShot, shotNo: number, final: PoolState | null, age = 0): void {
    this.falls.length = 0
    this.held = null
    this.shown = from
    this.place()
    this.run = { sim: new PoolSim(from), shotNo, shot, t: age, struck: false, steps: 0, seen: 0, final, idle: 0 }
    this.guide(null)
  }

  /** The server's word on the shot being played here: what to show when it ends. Returns whether it was that shot. */
  settle(final: PoolState): boolean {
    if (!this.run || this.run.shotNo !== final.shot) return false
    this.run.final = final
    return true
  }

  /** Puts the cue ball somewhere while it is in hand (null: back where the state has it). */
  hold(at: readonly [number, number] | null): void {
    this.held = at ? [at[0], at[1]] : null
    if (!this.run) this.place()
  }

  /** The line of a shot that has not been taken (null: none). */
  guide(g: PoolGuide | null): void {
    if (!g) {
      this.path.hide()
      this.after.hide()
      this.object.hide()
      this.ghost.visible = false
      return
    }
    this.path.set(g.path, 0.006, R * 1.25)
    this.after.set(g.after, 0.005)
    this.object.set(g.object, 0.005, R)
    this.ghost.visible = !!g.ghost
    if (g.ghost) this.ghost.position.set(g.ghost[0], BED_Y, -g.ghost[1])
  }

  /** The pose of a cue aimed as `aim` says, `pull` 0..1 drawn back (negative: past the ball, the follow-through). */
  aimPose(aim: PoolAim, pull = aim[2], target: CuePose = { tip: new THREE.Vector3(), dir: new THREE.Vector3() }): CuePose {
    const l = Math.hypot(aim[0], aim[1]) || 1
    const dx = aim[0] / l, dy = aim[1] / l
    const sin = aim[5], cos = Math.sqrt(1 - sin * sin)
    // Along the cue, to the player's right, and up across the cue.
    target.dir.set(dx * cos, -sin, -dy * cos)
    const right = v1.set(dy, 0, dx)
    const up = v2.set(dx * sin, cos, -dy * sin)
    const a = aim[3] * R, b = aim[4] * R
    const depth = Math.sqrt(Math.max(0, R * R - a * a - b * b))
    target.tip.set(aim[6], BALL_Y, -aim[7]).addScaledVector(right, a).addScaledVector(up, b).addScaledVector(target.dir, -(depth + TIP_GAP + pull * PULL_M))
    return target
  }

  /** Puts a player's cue somewhere (null: out of sight). */
  cue(slot: number, pose: CuePose | null): void {
    const c = this.cues[slot]
    if (!c) return
    c.visible = !!pose
    if (!pose) return
    c.position.copy(pose.tip)
    c.quaternion.setFromUnitVectors(Z, pose.dir)
  }

  /** The cue of whoever is shooting while the stroke goes forward: 1 at the start of it, 0 at the ball, below 0 after. */
  get stroke(): number | null {
    const r = this.run
    if (!r) return null
    if (r.t < STROKE_S) {
      const k = r.t / STROKE_S
      return 1 - k * k
    }
    const after = r.t - STROKE_S
    return after < 0.5 ? -0.22 * Math.min(1, after / 0.06) : null
  }

  /** A point of the table's frame in the room. */
  toWorld(local: THREE.Vector3, target = new THREE.Vector3()): THREE.Vector3 {
    return this.root.localToWorld(target.copy(local))
  }

  /** The lamp gets out of the way of a camera that looks down from above it. */
  setLampVisible(on: boolean): void {
    if (this.lamp) this.lamp.visible = on
  }

  update(dt: number): void {
    const r = this.run
    if (r) this.advance(r, dt)
    for (let n = this.falls.length - 1; n >= 0; n--) {
      const f = this.falls[n]!
      f.t += dt
      const ball = this.balls[f.i]!
      const k = Math.min(1, f.t / 0.16)
      const p = POOL_POCKETS[f.p]!
      ball.position.set(f.x + (p.x - f.x) * k * 0.7, BALL_Y - Math.min(0.075, 4.9 * f.t * f.t), -(f.y + (p.y - f.y) * k * 0.7))
      this.shadows[f.i]!.visible = false
      if (f.t > 0.34) {
        ball.visible = false
        this.falls.splice(n, 1)
      }
    }
  }

  private advance(r: Run, dt: number): void {
    r.t += dt
    if (r.t < STROKE_S) return
    const near = this.nearness()
    if (!r.struck) {
      r.struck = true
      r.sim.strike(r.shot)
    }
    const want = Math.floor((r.t - STROKE_S) / POOL_DT)
    const from = r.steps
    // A hidden window comes back seconds late: catch up, a few seconds of table per frame.
    const to = Math.min(want, from + 6000)
    const { sim } = r
    const rot = new Float32Array(48)
    for (let s = from; s < to && sim.busy; s++) {
      sim.step()
      for (let i = 0; i < 16; i++) {
        rot[i * 3] = rot[i * 3]! + sim.wx[i]! * POOL_DT
        rot[i * 3 + 1] = rot[i * 3 + 1]! + sim.wz[i]! * POOL_DT
        rot[i * 3 + 2] = rot[i * 3 + 2]! - sim.wy[i]! * POOL_DT
      }
    }
    r.steps = to
    const quiet = to - from > 400
    for (; r.seen < sim.events.length; r.seen++) {
      const e = sim.events[r.seen]!
      if (e.k === 'pot') this.falls.push({ i: e.a, t: 0, x: sim.x[e.a]!, y: sim.y[e.a]!, p: e.p })
      if (quiet) continue
      if (e.k === 'strike') this.sound.strike(e.v, near)
      else if (e.k === 'ball') this.sound.ball(e.v, near)
      else if (e.k === 'rail') this.sound.rail(e.v, near)
      else this.sound.pot(e.v, near)
    }
    for (let i = 0; i < 16; i++) {
      if (sim.st[i] === 4) continue
      const ball = this.balls[i]!
      ball.visible = true
      ball.position.set(sim.x[i]!, BALL_Y, -sim.y[i]!)
      const ax = rot[i * 3]!, ay = rot[i * 3 + 1]!, az = rot[i * 3 + 2]!
      const angle = Math.hypot(ax, ay, az)
      if (angle > 1e-6) ball.quaternion.premultiply(q1.setFromAxisAngle(v1.set(ax / angle, ay / angle, az / angle), angle))
      this.shade(i)
    }
    if (sim.busy) return
    if (r.final) {
      const final = r.final
      this.state = final
      this.shown = final.balls
      this.run = null
      this.place(true)
      this.hooks.onSettled?.(this.id, final.shot)
    } else if ((r.idle += dt) > 2.5) {
      // Nobody confirmed this shot (the connection dropped, or it was refused): back to what is known.
      this.show(this.state)
      this.hooks.onSettled?.(this.id, this.state?.shot ?? 0)
    }
  }

  private nearness(): number {
    if (!this.listener) return 1
    const d = this.root.getWorldPosition(v1).setY(BED_Y).distanceTo(this.listener)
    return 1 / (1 + (d / 4.5) * (d / 4.5))
  }

  /** New rack: every ball turned its own way, as when they are put on the cloth by hand. */
  private scatter(): void {
    let s = 0x2545f491
    const rnd = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      return s / 4294967296
    }
    for (const ball of this.balls) {
      const u = rnd(), v = rnd(), w = rnd()
      ball.quaternion.set(Math.sqrt(1 - u) * Math.sin(2 * Math.PI * v), Math.sqrt(1 - u) * Math.cos(2 * Math.PI * v), Math.sqrt(u) * Math.sin(2 * Math.PI * w), Math.sqrt(u) * Math.cos(2 * Math.PI * w))
    }
  }

  /** Puts every ball where the shown state has it. `keepFalling`: balls on their way down a pocket finish the fall. */
  private place(keepFalling = false): void {
    const lie = this.lie
    for (let i = 0; i < 16; i++) {
      const b = lie[i], ball = this.balls[i]!
      if (b) {
        ball.visible = true
        ball.position.set(b[0], BALL_Y, -b[1])
        this.shade(i)
      } else if (!keepFalling || !this.falls.some((f) => f.i === i)) {
        ball.visible = false
        this.shadows[i]!.visible = false
      }
    }
  }

  /** The soft shadow under a ball, pushed a little away from the lamp over the middle of the table. */
  private shade(i: number): void {
    const ball = this.balls[i]!, sh = this.shadows[i]!
    const k = R / (LAMP_Y - BALL_Y)
    sh.visible = true
    sh.position.set(ball.position.x * (1 + k), BED_Y + 0.0009, ball.position.z * (1 + k))
  }

  /** The length of a cue, for whoever holds one. */
  static readonly cueLength = CUE_LENGTH

  dispose(): void {
    this.path.dispose()
    this.after.dispose()
    this.object.dispose()
    this.root.removeFromParent()
  }
}

/** A point of the cloth as physics coordinates, from a point of the table's frame. */
export const fromTable = (local: THREE.Vector3): [number, number] => [local.x, -local.z]
export { onTable }
