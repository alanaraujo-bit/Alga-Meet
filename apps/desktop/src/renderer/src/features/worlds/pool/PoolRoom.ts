/**
 * Pool in a room: every table of the layout, what the server says about each, and the person at the keyboard playing
 * on one of them. The 3D engine hands this its input and its camera while it is that person's shot, and asks it where
 * their figure stands and what each player's hands are doing with a cue.
 *
 * Playing, as the person does it: drag to aim (Shift: fine), or click the cloth to aim there; hold the right button
 * (or Space) and pull back for power, let go to shoot; the wheel moves the camera in and out and V looks from above.
 * With the cue ball in hand, drag it. The line on the cloth is the real shot, simulated, up to the first ball.
 */
import * as THREE from 'three'
import {
  POOL_AIM_HZ, POOL_BALL_R, POOL_HL, POOL_HW, POOL_MAX_CUE_SPEED, POOL_MAX_ELEVATION, POOL_MAX_TIP_OFFSET, POOL_MIN_CUE_SPEED, cueSpot, cueSpotFree,
  poolGroupOf, worldItem, type PoolAim, type PoolShot, type PoolState,
} from '@alga/shared'
import type { Assets } from '../assets/loaders'
import type { BuiltItem } from '../engine/items'
import { cueRadius } from './balls'
import { PoolView, predict, type CuePose } from './PoolView'
import { PoolSound } from './sound'
import { BALL_Y, BED_Y, CUSHION_W, OUTER_HL, OUTER_HW, RAIL_TOP } from './table'

const R = POOL_BALL_R
const SPEED_CURVE = 1.7
/** How far behind the cue ball the wrist of the guiding hand rests, and where on the cue the other hand holds it. */
const BRIDGE_M = 0.38
const GRIP_M = 0.9
/** How far behind the cue ball a figure stands to shoot. */
const STAND_M = 0.97

/** What a figure does with a cue: where each hand goes (room space) and how far it bends over the table. */
export interface CueHold {
  /** Where the hand that guides the cue rests. */
  bridge: THREE.Vector3
  /** Where the other hand holds the cue. */
  grip: THREE.Vector3
  /** 0..1. */
  lean: number
}

export interface PoolUi {
  /** A table I am next to and could take a cue at. */
  near: string | null
  /** The table I am playing at. */
  table: string | null
  /** The cue is mine to aim right now. */
  aiming: boolean
  rolling: boolean
  /** 0..1: how far the cue is drawn back. */
  pull: number
  /** Where the tip hits, in ball radii: right and up. */
  spin: [number, number]
  top: boolean
  /** I may put the cue ball where I like (drag it). */
  hand: boolean
}

export interface PoolHooks {
  onJoin?(table: string): void
  onLeave?(table: string): void
  onAim?(table: string, aim: PoolAim): void
  onShot?(table: string, seq: number, shot: PoolShot, cue: [number, number] | undefined): void
  /** The balls of a shot stopped here: the screen may now say what it did. */
  onSettled?(table: string, shot: number): void
  onUi?(ui: PoolUi): void
}

export interface PoolHost {
  assets: Assets
  camera: THREE.PerspectiveCamera
  blob: THREE.Texture
  meId(): string | null
  /** Where my figure is. */
  me(): { x: number; z: number } | null
  /** The right hand of someone's figure, in the room; null while it is not drawn. */
  hand(userId: string, target: THREE.Vector3): THREE.Vector3 | null
  /** Keeps a camera position inside the walls. */
  inRoom(p: THREE.Vector3): THREE.Vector3
  hooks: PoolHooks
}

/** Cue speed for a pull of 0..1: most of the travel is for soft and medium shots, the end of it for the break. */
export const cueSpeed = (pull: number): number => POOL_MIN_CUE_SPEED + (POOL_MAX_CUE_SPEED - POOL_MIN_CUE_SPEED) * Math.pow(Math.min(1, Math.max(0, pull)), SPEED_CURVE)
const pullOf = (speed: number): number => Math.pow(Math.min(1, Math.max(0, (speed - POOL_MIN_CUE_SPEED) / (POOL_MAX_CUE_SPEED - POOL_MIN_CUE_SPEED))), 1 / SPEED_CURVE)

/** How far back along the cue (from a ball at cx, cy, cue pointing dx, dy) a rectangle of half sizes hx, hy ends. */
function backTo(cx: number, cy: number, dx: number, dy: number, hx: number, hy: number): number {
  let s = Infinity
  if (dx > 1e-6) s = Math.min(s, (cx + hx) / dx)
  else if (dx < -1e-6) s = Math.min(s, (cx - hx) / dx)
  if (dy > 1e-6) s = Math.min(s, (cy + hy) / dy)
  else if (dy < -1e-6) s = Math.min(s, (cy - hy) / dy)
  return s
}

/**
 * The least the butt must be raised for the cue to clear the rail behind the cue ball (as a sine). Against a cushion
 * that is a lot, and hitting higher on the ball needs less: as on a real table.
 */
export function cueElevation(cx: number, cy: number, dx: number, dy: number, b: number): number {
  const s = backTo(cx, cy, dx, dy, POOL_HL, POOL_HW)
  let tan = 0.05
  if (s < 1.6) tan = Math.max(tan, (RAIL_TOP + 0.005 + cueRadius(s + CUSHION_W) - R * (1 + b)) / Math.max(0.02, s + CUSHION_W * 0.4))
  return Math.min(POOL_MAX_ELEVATION, tan / Math.sqrt(1 + tan * tan))
}

interface Seat {
  view: PoolView
  /** Direction of the cue on the table, radians. */
  yaw: number
  pull: number
  a: number
  b: number
  /** Where I hold the cue ball while it is in hand. */
  ball: [number, number] | null
  /** Camera: elevation, distance, and the look from above. */
  pitch: number
  dist: number
  top: boolean
  /** The shot being played is mine: the camera steps back to watch it. */
  watching: boolean
  /** What the last guide was drawn for, and what the others were last told. */
  guideKey: string
  sentKey: string
  sentAt: number
  /** The shot number my turn was last set up for. */
  turnOf: number
}

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3()
const inverse = new THREE.Matrix4()
const pose: CuePose = { tip: new THREE.Vector3(), dir: new THREE.Vector3() }
const AIM_KEYS = new Set(['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'])

export class PoolRoom {
  private readonly views = new Map<string, PoolView>()
  private states = new Map<string, PoolState>()
  private readonly sound = new PoolSound()
  private readonly raycaster = new THREE.Raycaster()
  /** Aim of whoever is shooting at each table, as relayed: where it is going and where it is drawn. */
  private readonly remote = new Map<string, { userId: string; to: PoolAim; now: PoolAim }>()
  /** The stroke being played at each table: whose cue goes forward, from which aim. */
  private readonly strokes = new Map<string, { userId: string; aim: PoolAim }>()
  /** Hands of each figure that is aiming, for the engine to pose them. */
  private readonly holds = new Map<string, CueHold>()
  private seat: Seat | null = null
  private drag: { kind: 'aim' | 'ball' | 'pull'; x: number; y: number; moved: boolean; pull0: number } | null = null
  private readonly keys = new Set<string>()
  private space = false
  private near: string | null = null
  private standing: { x: number; z: number; yaw: number } | null = null
  private ui: PoolUi = { near: null, table: null, aiming: false, rolling: false, pull: 0, spin: [0, 0], top: false, hand: false }
  private camReady = false
  private readonly camPos = new THREE.Vector3()
  private readonly camAt = new THREE.Vector3()

  constructor(private readonly host: PoolHost) {}

  // ---- tables --------------------------------------------------------------------------------------------------------

  /** The room was built: one view per pool table in it. */
  setItems(items: Iterable<BuiltItem>): void {
    const tables = [...items].filter((it) => worldItem(it.placed.sku)?.game === 'pool')
    // Called again whenever a piece moves in the editor: the same tables keep their views.
    if (tables.length === this.views.size && tables.every((it) => this.views.get(it.placed.id)?.root.parent === it.object)) return
    for (const v of this.views.values()) v.dispose()
    this.views.clear()
    this.strokes.clear()
    this.seat = null
    for (const it of tables) {
      const view = new PoolView(it.placed.id, it.object, this.host.assets, this.host.blob, this.sound, { onSettled: (t, n) => this.host.hooks.onSettled?.(t, n) })
      view.show(this.states.get(view.id) ?? null)
      this.views.set(view.id, view)
    }
    this.sync()
  }

  /** What the server says about the tables of this room (a table it does not mention is waiting with a fresh rack). */
  setStates(states: readonly PoolState[]): void {
    this.states = new Map(states.map((s) => [s.table, s]))
    for (const view of this.views.values()) {
      const s = this.states.get(view.id) ?? null
      const shown = view.state
      // The same state again, or the server's word on the shot already being played here (mine).
      if (s === shown || (s && view.settle(s))) continue
      const last = s?.last
      const age = last?.age ?? 0
      if (s && last && age < last.ms && (!shown || s.shot === shown.shot + 1)) {
        // A shot someone took: their cue goes forward and the balls are played from where they are by now.
        const c = last.from[0] ?? [0, 0]
        this.strokes.set(view.id, { userId: last.by, aim: [last.shot.dx, last.shot.dy, pullOf(last.shot.v), last.shot.a, last.shot.b, last.shot.e, c[0], c[1]] })
        view.play(last.from, last.shot, s.shot, s, age / 1000)
      } else {
        view.show(s)
      }
    }
    for (const [table, r] of this.remote) {
      const s = this.states.get(table)
      if (!s || s.players[s.turn] !== r.userId) this.remote.delete(table)
    }
    this.sync()
  }

  /** Someone else's cue moved. */
  aim(table: string, userId: string, aim: PoolAim): void {
    const r = this.remote.get(table)
    if (r && r.userId === userId) r.to = aim
    else this.remote.set(table, { userId, to: aim, now: [...aim] })
  }

  /** Finds my table (or that I have none) from the states. */
  private sync(): void {
    const me = this.host.meId()
    let mine: PoolView | null = null
    if (me) for (const s of this.states.values()) if (s.players.includes(me)) mine = this.views.get(s.table) ?? mine
    if (mine === (this.seat?.view ?? null)) return
    if (this.seat) {
      this.seat.view.guide(null)
      this.seat.view.hold(null)
      this.seat.view.setLampVisible(true)
    }
    this.seat = mine ? { view: mine, yaw: 0, pull: 0, a: 0, b: 0, ball: null, pitch: 0.44, dist: 2, top: false, watching: false, guideKey: '', sentKey: '', sentAt: 0, turnOf: -1 } : null
    this.drag = null
    this.space = false
    this.camReady = false
  }

  private stateOf(seat: Seat): PoolState | null {
    return this.states.get(seat.view.id) ?? null
  }

  /** Whether the cue is mine to aim right now. */
  private myShot(seat: Seat | null): boolean {
    if (!seat || seat.view.rolling) return false
    const s = this.stateOf(seat)
    return !!s && s.phase === 'play' && s.players[s.turn] === this.host.meId()
  }

  /** The keyboard and the pointer are playing pool, not walking. */
  get capturing(): boolean {
    return this.myShot(this.seat) || !!this.seat?.top
  }

  /** The table I am playing at, if any. */
  get table(): string | null {
    return this.seat?.view.id ?? null
  }

  /** The table I am next to and could take a cue at, if any. */
  get nearTable(): string | null {
    return this.near
  }

  /**
   * A click on a table with a free cue: which table, and where to walk to stand beside it (in the room). Null when
   * the ray misses every such table, or I am already playing.
   */
  pick(ray: THREE.Ray): { table: string; x: number; z: number } | null {
    if (this.seat || !this.host.meId()) return null
    for (const view of this.views.values()) {
      if ((this.states.get(view.id)?.players.length ?? 0) >= 2) continue
      inverse.copy(view.root.matrixWorld).invert()
      const o = v1.copy(ray.origin).applyMatrix4(inverse), d = v2.copy(ray.direction).transformDirection(inverse)
      // The table as a box: where the ray enters it, if it does.
      let t0 = 0, t1 = Infinity
      for (const [p, q, lo, hi] of [[o.x, d.x, -OUTER_HL, OUTER_HL], [o.y, d.y, 0.3, BED_Y + RAIL_TOP], [o.z, d.z, -OUTER_HW, OUTER_HW]] as const) {
        if (Math.abs(q) < 1e-9) {
          if (p < lo || p > hi) t1 = -1
          continue
        }
        const a = (lo - p) / q, b = (hi - p) / q
        t0 = Math.max(t0, Math.min(a, b))
        t1 = Math.min(t1, Math.max(a, b))
      }
      if (t0 > t1) continue
      // Beside the table, on the side that was clicked.
      let x = o.x + d.x * t0, z = o.z + d.z * t0
      if (OUTER_HL - Math.abs(x) < OUTER_HW - Math.abs(z)) x = (x < 0 ? -1 : 1) * (OUTER_HL + 0.5)
      else z = (z < 0 ? -1 : 1) * (OUTER_HW + 0.5)
      const at = view.toWorld(v3.set(x, 0, z), v3)
      return { table: view.id, x: at.x, z: at.z }
    }
    return null
  }

  /** Every table's fingerprint (PoolView.digest), for whoever inspects the page. */
  get digest(): string {
    return [...this.views.values()].map((v) => v.digest).join(' ')
  }

  // ---- commands from the screen --------------------------------------------------------------------------------------

  setSpin(a: number, b: number): void {
    const seat = this.seat
    if (!seat) return
    const l = Math.hypot(a, b), max = POOL_MAX_TIP_OFFSET - 0.03
    const k = l > max ? max / l : 1
    seat.a = a * k
    seat.b = b * k
  }

  /** The power control on screen is being dragged. */
  setPull(pull: number): void {
    const seat = this.seat
    if (seat && this.myShot(seat)) seat.pull = Math.min(1, Math.max(0, pull))
  }

  /** Lets the cue go. */
  release(): void {
    const seat = this.seat
    if (!seat || !this.myShot(seat)) return
    if (seat.pull < 0.03) return void (seat.pull = 0)
    const s = this.stateOf(seat)!
    const me = this.host.meId()!
    const aim = this.myAim(seat, s)
    const shot: PoolShot = { dx: aim[0], dy: aim[1], v: cueSpeed(seat.pull), a: aim[3], b: aim[4], e: aim[5] }
    const cue: [number, number] | undefined = s.hand ? [aim[6], aim[7]] : undefined
    const from = seat.view.lie
    this.strokes.set(seat.view.id, { userId: me, aim })
    // Played here at once; the server's state for after it arrives while the balls roll.
    seat.view.play(from, shot, s.shot + 1, null)
    seat.pull = 0
    seat.ball = null
    seat.watching = true
    this.host.hooks.onShot?.(seat.view.id, s.shot, shot, cue)
  }

  toggleTop(): void {
    if (this.seat) this.seat.top = !this.seat.top
  }

  /** Takes a cue at the table I am next to. Returns whether there was one. */
  join(): boolean {
    if (this.seat || !this.near) return false
    this.host.hooks.onJoin?.(this.near)
    return true
  }

  leave(): void {
    if (this.seat) this.host.hooks.onLeave?.(this.seat.view.id)
  }

  // ---- input (true: taken, the engine does nothing with it) ----------------------------------------------------------

  pointerDown(e: PointerEvent, ndc: THREE.Vector2): boolean {
    const seat = this.seat
    if (!seat || !this.capturing) return false
    const mine = this.myShot(seat)
    if (e.button === 2) {
      if (mine) this.drag = { kind: 'pull', x: e.clientX, y: e.clientY, moved: false, pull0: seat.pull }
      return true
    }
    if (e.button !== 0) return true
    let kind: 'aim' | 'ball' = 'aim'
    const s = this.stateOf(seat)
    if (mine && s?.hand) {
      const p = this.onCloth(seat.view, ndc)
      const ball = this.cueBall(seat)
      if (p && ball && Math.hypot(p[0] - ball[0], p[1] - ball[1]) < R * 2.4) kind = 'ball'
    }
    this.drag = { kind, x: e.clientX, y: e.clientY, moved: false, pull0: 0 }
    return true
  }

  pointerMove(e: PointerEvent, ndc: THREE.Vector2): boolean {
    const d = this.drag, seat = this.seat
    if (!d || !seat) return false
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 4) return true
    d.moved = true
    if (d.kind === 'pull') {
      seat.pull = Math.min(1, Math.max(0, d.pull0 + dy / 260))
      return true
    }
    d.x = e.clientX
    d.y = e.clientY
    if (d.kind === 'ball') {
      const s = this.stateOf(seat)
      const p = this.onCloth(seat.view, ndc)
      if (s?.hand && p) {
        const x = Math.min(POOL_HL - R - 0.002, Math.max(-POOL_HL + R + 0.002, p[0]))
        const y = Math.min(POOL_HW - R - 0.002, Math.max(-POOL_HW + R + 0.002, p[1]))
        if (cueSpotFree(s.balls, x, y, s.hand)) seat.ball = [x, y]
      }
      return true
    }
    if (this.myShot(seat)) {
      const p = seat.top && !e.shiftKey ? this.onCloth(seat.view, ndc) : null
      const c = this.cueBall(seat)
      // From above the cue follows the pointer. Behind the ball, dragging right swings it to the right, and closer in
      // the same drag turns it less.
      if (p && c && Math.hypot(p[0] - c[0], p[1] - c[1]) > R) seat.yaw = Math.atan2(p[1] - c[1], p[0] - c[0])
      else if (!seat.top || e.shiftKey) seat.yaw -= dx * 0.0042 * (e.shiftKey ? 0.1 : 1) * Math.min(1.4, Math.max(0.45, seat.dist / 1.9))
    }
    if (!seat.top) seat.pitch = Math.min(1.5, Math.max(0.1, seat.pitch + dy * 0.004))
    return true
  }

  pointerUp(ndc: THREE.Vector2): boolean {
    const d = this.drag, seat = this.seat
    this.drag = null
    if (!d || !seat) return false
    if (d.kind === 'pull') {
      this.release()
    } else if (d.kind === 'aim' && !d.moved && this.myShot(seat)) {
      // A click on the cloth: aim through that point.
      const p = this.onCloth(seat.view, ndc)
      const c = this.cueBall(seat)
      if (p && c && Math.hypot(p[0] - c[0], p[1] - c[1]) > R) seat.yaw = Math.atan2(p[1] - c[1], p[0] - c[0])
    }
    return true
  }

  wheel(e: WheelEvent): boolean {
    const seat = this.seat
    if (!seat || !this.capturing) return false
    seat.dist = Math.min(4.4, Math.max(0.8, seat.dist * Math.exp(e.deltaY * 0.0011)))
    return true
  }

  keyDown(e: KeyboardEvent): boolean {
    const seat = this.seat
    if (!seat) return false
    if (e.code === 'KeyV') {
      if (!e.repeat) seat.top = !seat.top
      return true
    }
    if (e.code === 'Escape') {
      if (e.repeat) return true
      if (seat.pull > 0 || this.drag?.kind === 'pull') {
        seat.pull = 0
        this.space = false
        this.drag = null
      } else if (seat.top) seat.top = false
      else this.leave()
      return true
    }
    if (!this.myShot(seat)) return false
    if (e.code === 'Space') {
      this.space = true
      return true
    }
    if (AIM_KEYS.has(e.code)) {
      this.keys.add(e.code)
      return true
    }
    // Walking keys do nothing while the cue is in my hands.
    return e.code === 'KeyW' || e.code === 'KeyS' || e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'KeyE'
  }

  keyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code)
    if (e.code === 'Space' && this.space) {
      this.space = false
      this.release()
    }
  }

  /** The window lost the keyboard: nothing stays held. */
  blur(): void {
    this.keys.clear()
    this.space = false
    this.drag = null
    if (this.seat) this.seat.pull = 0
  }

  /** The point of the cloth under the pointer, in table coordinates. */
  private onCloth(view: PoolView, ndc: THREE.Vector2): [number, number] | null {
    this.raycaster.setFromCamera(ndc, this.host.camera)
    const ray = this.raycaster.ray
    inverse.copy(view.root.matrixWorld).invert()
    const o = v1.copy(ray.origin).applyMatrix4(inverse)
    const d = v2.copy(ray.direction).transformDirection(inverse)
    if (Math.abs(d.y) < 1e-5) return null
    const t = (BALL_Y - o.y) / d.y
    return t > 0 ? [o.x + d.x * t, -(o.z + d.z * t)] : null
  }

  private cueBall(seat: Seat): readonly [number, number] | null {
    return seat.ball ?? this.stateOf(seat)?.balls[0] ?? null
  }

  private myAim(seat: Seat, s: PoolState): PoolAim {
    const c = this.cueBall(seat) ?? cueSpot(s.balls)
    const dx = Math.cos(seat.yaw), dy = Math.sin(seat.yaw)
    return [dx, dy, seat.pull, seat.a, seat.b, cueElevation(c[0], c[1], dx, dy, seat.b), c[0], c[1]]
  }

  // ---- every frame ---------------------------------------------------------------------------------------------------

  /** Where my figure should be standing to shoot, in the room; null when the cue is not mine to aim. */
  stance(): { x: number; z: number; yaw: number } | null {
    return this.standing
  }

  /**
   * The next point to walk to on the way from `from` to where my shot is taken: straight there, or round the corner
   * of my table when the table is in between.
   */
  route(from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number } {
    const view = this.seat?.view
    if (!view) return to
    inverse.copy(view.root.matrixWorld).invert()
    const a = v1.set(from.x, 0, from.z).applyMatrix4(inverse), b = v2.set(to.x, 0, to.z).applyMatrix4(inverse)
    const hx = OUTER_HL + 0.27, hz = OUTER_HW + 0.27
    // Whether the walk from (px, pz) to (qx, qz) goes through the table (with room for a person beside it).
    const through = (px: number, pz: number, qx: number, qz: number): boolean => {
      let t0 = 0, t1 = 1
      for (const [p, d, h] of [[px, qx - px, hx], [pz, qz - pz, hz]] as const) {
        if (Math.abs(d) < 1e-9) {
          if (Math.abs(p) >= h) return false
          continue
        }
        const u = (-h - p) / d, w = (h - p) / d
        t0 = Math.max(t0, Math.min(u, w))
        t1 = Math.min(t1, Math.max(u, w))
        if (t0 >= t1) return false
      }
      return true
    }
    if (!through(a.x, a.z, b.x, b.z)) return to
    let best: [number, number] | null = null, cost = Infinity
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const cx = sx * (hx + 0.2), cz = sz * (hz + 0.2)
      if (through(a.x, a.z, cx, cz)) continue
      const c = Math.hypot(cx - a.x, cz - a.z) + Math.hypot(b.x - cx, b.z - cz) + (through(cx, cz, b.x, b.z) ? 3 : 0)
      if (c < cost) {
        cost = c
        best = [cx, cz]
      }
    }
    if (!best) return to
    const p = view.toWorld(v3.set(best[0], 0, best[1]), v3)
    return { x: p.x, z: p.z }
  }

  /** What `userId`'s hands do with a cue this frame (null: nothing special). */
  hold(userId: string): CueHold | null {
    return this.holds.get(userId) ?? null
  }

  update(dt: number, now: number): void {
    const me = this.host.meId(), at = this.host.me()
    this.holds.clear()
    this.standing = null
    this.near = null
    for (const view of this.views.values()) {
      view.listener = this.host.camera.position
      view.update(dt)
      const s = this.states.get(view.id) ?? null
      // Next to a table with a free cue: the hint to take it.
      if (at && me && !this.seat && (s?.players.length ?? 0) < 2) {
        const p = v1.set(at.x, 0, at.z).applyMatrix4(inverse.copy(view.root.matrixWorld).invert())
        if (Math.hypot(Math.max(0, Math.abs(p.x) - OUTER_HL), Math.max(0, Math.abs(p.z) - OUTER_HW)) < 1.1) this.near = view.id
      }
    }
    const seat = this.seat
    if (seat) this.play(seat, dt, now)
    for (const view of this.views.values()) this.cues(view, this.states.get(view.id) ?? null, me, dt)
    this.emit()
  }

  /** My turn at my table: the keys, the cue ball in hand, the aim that goes out, the line on the cloth. */
  private play(seat: Seat, dt: number, now: number): void {
    const s = this.stateOf(seat)
    const view = seat.view
    if (!view.rolling) seat.watching = false
    if (!s || !this.myShot(seat)) {
      view.guide(null)
      seat.guideKey = ''
      seat.pull = 0
      return
    }
    if (seat.turnOf !== s.shot) {
      // A new turn: the cue ball where it may go, and the cue pointing at the nearest ball I may hit.
      seat.turnOf = s.shot
      const b0 = s.balls[0]
      seat.ball = s.hand ? (b0 && cueSpotFree(s.balls, b0[0], b0[1], s.hand) ? [b0[0], b0[1]] : cueSpot(s.balls)) : null
      const c = seat.ball ?? b0
      const group = s.groups?.[s.turn] ?? null
      const left = group !== null && s.balls.some((b, i) => b && poolGroupOf(i) === group)
      let best = Infinity
      for (let i = 1; c && i < 16; i++) {
        const b = s.balls[i]
        if (!b || (group !== null && (left ? poolGroupOf(i) !== group : i !== 8)) || (group === null && i === 8 && !s.breaking)) continue
        const d = Math.hypot(b[0] - c[0], b[1] - c[1])
        if (d < best) {
          best = d
          seat.yaw = Math.atan2(b[1] - c[1], b[0] - c[0])
        }
      }
    }
    view.hold(s.hand ? seat.ball : null)
    const fine = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 0.08 : 1
    const turn = (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) - (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0)
    if (turn) seat.yaw += turn * 0.55 * fine * dt
    if (this.space) seat.pull = Math.min(1, seat.pull + dt * 0.8)

    const aim = this.myAim(seat, s)
    // The line is the shot as it would be played now; before the cue is drawn back, at a medium pace.
    const key = aim.map((n, i) => (i === 2 ? (n > 0.03 ? n.toFixed(2) : 'x') : n.toFixed(5))).join()
    if (key !== seat.guideKey) {
      seat.guideKey = key
      view.guide(predict(view.lie, { dx: aim[0], dy: aim[1], v: cueSpeed(seat.pull > 0.03 ? seat.pull : 0.5), a: aim[3], b: aim[4], e: aim[5] }))
    }
    const sendKey = aim.map((n) => n.toFixed(3)).join()
    if (sendKey !== seat.sentKey && now - seat.sentAt >= 1000 / POOL_AIM_HZ) {
      seat.sentKey = sendKey
      seat.sentAt = now
      this.host.hooks.onAim?.(view.id, aim)
    }
  }

  /** Puts the two cues of a table where they are: aimed by whoever shoots, carried by whoever waits. */
  private cues(view: PoolView, s: PoolState | null, me: string | null, dt: number): void {
    const stroke = view.stroke
    const going = stroke !== null ? this.strokes.get(view.id) : undefined
    if (stroke === null) this.strokes.delete(view.id)
    const shooter = s && s.phase === 'play' && !view.rolling ? s.players[s.turn] ?? null : null
    for (let slot = 0; slot < 2; slot++) {
      const userId = s?.players[slot]
      if (!userId) {
        view.cue(slot, null)
        continue
      }
      let aim: PoolAim | null = null
      let pull = 0
      if (going && going.userId === userId) {
        // The stroke: forward from the pull to the ball, and a little through it.
        aim = going.aim
        pull = stroke! > 0 ? stroke! * aim[2] : stroke!
      } else if (userId === shooter) {
        if (userId === me && this.seat?.view === view) {
          aim = this.myAim(this.seat, s!)
        } else {
          const r = this.remote.get(view.id)
          if (r && r.userId === userId) {
            const k = 1 - Math.exp(-dt * 14)
            for (let i = 0; i < 8; i++) r.now[i] = r.now[i]! + (r.to[i]! - r.now[i]!) * k
            aim = r.now
          }
        }
        pull = aim ? aim[2] : 0
      }
      if (aim) {
        view.aimPose(aim, pull, pose)
        view.cue(slot, pose)
        const st = this.stand(view, aim)
        if (userId === me) this.standing = st
        this.holds.set(userId, this.hands(view, aim, pose, st))
        continue
      }
      // Carried upright in the right hand, the butt off the floor.
      const hand = this.host.hand(userId, v1)
      if (!hand) {
        view.cue(slot, null)
        continue
      }
      hand.applyMatrix4(inverse.copy(view.root.matrixWorld).invert())
      pose.dir.set(0.05, 0.998, 0.03).normalize()
      pose.tip.copy(hand).addScaledVector(pose.dir, 0.93)
      view.cue(slot, pose)
    }
  }

  /** Where a figure stands to play a shot: behind the cue ball, a little to the left of the cue, clear of the table. */
  private stand(view: PoolView, aim: PoolAim): { x: number; z: number; yaw: number } {
    const l = Math.hypot(aim[0], aim[1]) || 1
    const dx = aim[0] / l, dy = aim[1] / l
    const mx = OUTER_HL + 0.3, my = OUTER_HW + 0.3
    // Straight back along the cue until the table ends, when that is within a long reach.
    const clear = backTo(aim[6], aim[7], dx, dy, mx, my)
    const back = Math.max(STAND_M, clear)
    let x = aim[6] - dx * back - dy * 0.19, y = aim[7] - dy * back + dx * 0.19
    if (back > 1.8) {
      // Too far to reach from behind: from the nearest side of the table instead.
      x = aim[6] - dx * STAND_M
      y = aim[7] - dy * STAND_M
      if (mx - Math.abs(x) < my - Math.abs(y)) x = (x < 0 ? -1 : 1) * mx
      else y = (y < 0 ? -1 : 1) * my
    } else if (Math.abs(x) < mx && Math.abs(y) < my) {
      // The step to the left put a foot back under the rail.
      if (mx - Math.abs(x) < my - Math.abs(y)) x = (x < 0 ? -1 : 1) * mx
      else y = (y < 0 ? -1 : 1) * my
    }
    const p = view.toWorld(v2.set(x, 0, -y), v2)
    const d = v3.set(dx, 0, -dy).transformDirection(view.root.matrixWorld)
    return { x: p.x, z: p.z, yaw: Math.atan2(d.x, d.z) }
  }

  /** Where the hands of whoever aims go: one resting under the cue behind the ball, one on the butt. */
  private hands(view: PoolView, aim: PoolAim, cue: CuePose, st: { x: number; z: number }): CueHold {
    const l = Math.hypot(aim[0], aim[1]) || 1
    const bx = aim[6] - (aim[0] / l) * BRIDGE_M, by = aim[7] - (aim[1] / l) * BRIDGE_M
    const onRail = Math.abs(bx) > POOL_HL - 0.01 || Math.abs(by) > POOL_HW - 0.01
    const bridge = new THREE.Vector3(bx, (onRail ? BED_Y + RAIL_TOP : BED_Y) + 0.03, -by)
    // The cue runs over that hand: where the cue is higher (raised, or over a rail) the hand comes up under it.
    const flat = Math.hypot(cue.dir.x, cue.dir.z) || 1
    const behind = Math.hypot(bridge.x - cue.tip.x, bridge.z - cue.tip.z)
    bridge.y = Math.max(bridge.y, cue.tip.y - cue.dir.y * (behind / flat) - 0.028)
    // The wrist is over the cue, the palm closed round it.
    const grip = new THREE.Vector3().copy(cue.tip).addScaledVector(cue.dir, -GRIP_M)
    grip.y += 0.06
    view.toWorld(bridge, bridge)
    view.toWorld(grip, grip)
    const reach = Math.hypot(bridge.x - st.x, bridge.z - st.z)
    return { bridge, grip, lean: Math.min(1, Math.max(0.3, (reach - 0.25) / 0.6)) }
  }

  /** Drives the camera while I play. Returns false when the engine's own camera applies. */
  camera(dt: number): boolean {
    const seat = this.seat
    const cam = this.host.camera
    const mine = this.myShot(seat)
    if (!seat || !(mine || seat.top || (seat.watching && seat.view.rolling))) {
      seat?.view.setLampVisible(true)
      this.camReady = false
      return false
    }
    const view = seat.view
    const up = v3.set(0, 1, 0)
    const pos = v1, at = v2
    const dx = Math.cos(seat.yaw), dy = Math.sin(seat.yaw)
    if (seat.top) {
      // Straight down, the table lying across the screen.
      const half = THREE.MathUtils.degToRad(cam.fov) / 2
      pos.set(0, BED_Y + Math.max((OUTER_HW + 0.28) / Math.tan(half), (OUTER_HL + 0.3) / (Math.tan(half) * cam.aspect)), 0)
      at.set(0, BED_Y, 0)
      up.set(0, 0, -1)
    } else if (mine) {
      // Behind the cue ball, looking down the line of the shot.
      const c = this.cueBall(seat) ?? [0, 0]
      const flat = Math.cos(seat.pitch) * seat.dist, ahead = 0.22 * seat.dist
      at.set(c[0] + dx * ahead, BALL_Y, -(c[1] + dy * ahead))
      pos.set(c[0] - dx * (flat - ahead), BALL_Y + Math.sin(seat.pitch) * seat.dist, -(c[1] - dy * (flat - ahead)))
    } else {
      // My balls are rolling: back and up, to watch the whole table from where the shot was taken.
      at.set(0, BED_Y, 0)
      pos.set(-dx * 1.7, BED_Y + 2.05, dy * 1.7)
    }
    view.toWorld(pos, pos)
    view.toWorld(at, at)
    up.transformDirection(view.root.matrixWorld)
    this.host.inRoom(pos)
    view.setLampVisible(pos.y < 1.75)
    if (!this.camReady) {
      // Coming from the room's own camera: travel from where it is instead of jumping.
      this.camPos.copy(cam.position)
      this.camAt.copy(at)
      this.camReady = true
    }
    const k = 1 - Math.exp(-dt * (seat.top || !mine ? 5 : 16))
    this.camPos.lerp(pos, k)
    this.camAt.lerp(at, k)
    cam.position.copy(this.camPos)
    cam.up.lerp(up, 1 - Math.exp(-dt * 8)).normalize()
    cam.lookAt(this.camAt)
    return true
  }

  /** Whether my own figure would be in the way of the camera (it steps out of the picture, the cue stays). */
  get hidesMe(): boolean {
    const seat = this.seat
    return !!seat && this.myShot(seat) && !seat.top && (seat.dist < 2.15 || seat.pitch < 0.42)
  }

  private emit(): void {
    const seat = this.seat
    const s = seat ? this.stateOf(seat) : null
    const mine = this.myShot(seat)
    const next: PoolUi = {
      near: this.near, table: seat?.view.id ?? null, aiming: mine, rolling: !!seat?.view.rolling,
      pull: seat ? Math.round(seat.pull * 100) / 100 : 0, spin: seat ? [seat.a, seat.b] : [0, 0], top: !!seat?.top, hand: mine && !!s?.hand,
    }
    const u = this.ui
    if (u.near === next.near && u.table === next.table && u.aiming === next.aiming && u.rolling === next.rolling && u.pull === next.pull && u.spin[0] === next.spin[0] && u.spin[1] === next.spin[1] && u.top === next.top && u.hand === next.hand) return
    this.ui = next
    this.host.hooks.onUi?.(next)
  }

  dispose(): void {
    for (const v of this.views.values()) v.dispose()
    this.views.clear()
  }
}
