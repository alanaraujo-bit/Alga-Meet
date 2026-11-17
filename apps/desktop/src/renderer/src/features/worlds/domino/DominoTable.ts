/**
 * One domino table in the room: its 28 tiles, wherever the game has them. It is told the game as this app may see it
 * (a DominoView) and moves the tiles to match: shuffled and dealt, flown from a hand to the line, slid from the stock,
 * turned face up when the round ends. A tile whose numbers this app was not told shows a blank face, so nothing of
 * another hand is ever in the scene.
 *
 * Everything here is in the table's own frame (layout.ts); the group is a child of the table's item.
 */
import * as THREE from 'three'
import { DOMINO_SEATS, dominoSide, type DominoLast, type DominoView } from '@alga/shared'
import type { Assets } from '../assets/loaders'
import { LIVE_LAYER } from '../engine/lighting'
import { SEAT_DIRS, TILE_L, TILE_T, TILE_W, TOP_Y, chainLayout, handSpots, pileSpot, stockSpot, type Spot } from './layout'
import type { DominoSound } from './sound'
import { TileSet, type TileMesh } from './tiles'

interface Pose {
  p: THREE.Vector3
  q: THREE.Quaternion
}

/** One leg of a tile's way to where it belongs. */
interface Seg extends Pose {
  dur: number
  delay: number
  /** How high over the straight line the tile flies. */
  arc: number
  sound: 'clack' | 'tick' | null
  /** The face shown from the start of the leg, or from its end (undefined: as it is). */
  face?: number | null
  faceAfter?: number | null
}

/** Where a tile belongs. */
interface Slot {
  /** `line`, `stock`, `pile` (the set waiting for a game) or `hand:<chair>`. */
  zone: string
  seat: number
  index: number
  count: number
  tile: number | null
  spot: Spot | null
  /** A hand lying face up (the round is over). */
  open: boolean
}

interface Piece {
  mesh: TileMesh
  tile: number | null
  slot: Slot
  segs: Seg[]
  /** Progress of the first leg; -1 before it starts. */
  t: number
  from: Pose
  rest: Pose
  lift: number
  glow: number
  shade: number
}

/** What the hand of the person at the keyboard should look like. */
export interface HandLook {
  /** Tiles that can be played now; null when it is not my turn. */
  playable: ReadonlySet<number> | null
  focus: number | null
  selected: number | null
}

const UP = new THREE.Vector3(0, 1, 0)
/** Face down: half a turn about the tile's long axis. */
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)
const m4 = new THREE.Matrix4()
const vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3()
const tmp = new THREE.Vector3()
const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const pose = (): Pose => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() })
/** How far back the tiles of the other hands lean. */
const LEAN = 0.14
/** My own tiles are drawn larger than life while they stand in my hand: they are what I read and what I pick up. */
const MY_SCALE = 1.3

export class DominoTable {
  readonly root = new THREE.Group()
  /** The game as last shown. */
  view: DominoView | null = null
  /** The chair of the person at the keyboard at this table, or -1. */
  mySeat = -1
  /** How far back my own tiles lean, so that they face the camera. */
  lean = 0.5
  /** 0..1: how loud this table is for whoever listens. */
  near = 1
  reducedMotion = false
  private readonly tiles: TileSet
  private readonly pieces: Piece[] = []
  private readonly ghosts: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = []
  private readonly lamp: THREE.Object3D | null
  private readonly raycaster = new THREE.Raycaster()
  private look: HandLook = { playable: null, focus: null, selected: null }
  private held: { tile: number; at: THREE.Vector3 } | null = null
  private clock = 0

  constructor(readonly id: string, item: THREE.Object3D, assets: Assets, private readonly sound: DominoSound) {
    this.root.name = `domino:${id}`
    this.tiles = new TileSet(assets)
    for (let i = 0; i < 28; i++) {
      const mesh = this.tiles.make()
      mesh.name = 'domino:tile'
      const slot: Slot = { zone: 'pile', seat: -1, index: i, count: 28, tile: null, spot: pileSpot(i), open: false }
      const pc: Piece = { mesh, tile: null, slot, segs: [], t: -1, from: pose(), rest: pose(), lift: 0, glow: 0, shade: 1 }
      this.restPose(slot, pc.rest)
      mesh.position.copy(pc.rest.p)
      mesh.quaternion.copy(pc.rest.q)
      this.pieces.push(pc)
      this.root.add(mesh)
    }
    const ghostG = assets.own(new THREE.BoxGeometry(TILE_L, TILE_T * 0.6, TILE_W))
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Mesh(ghostG, assets.own(new THREE.MeshBasicMaterial({ color: 0x9aa0ff, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false })))
      g.visible = false
      g.renderOrder = 3
      g.name = 'domino:ghost'
      this.ghosts.push(g)
      this.root.add(g)
    }
    // Tiles move, so the room's reflection is taken without them (and they are lit like the people are).
    this.root.traverse((o) => o.layers.set(LIVE_LAYER))
    this.raycaster.layers.enableAll()
    this.lamp = item.getObjectByName('domino:lamp') ?? null
    item.add(this.root)
  }

  // ---- where things go ------------------------------------------------------------------------------------------------

  private restPose(s: Slot, out: Pose): void {
    if (s.spot) {
      out.p.set(s.spot.x, TOP_Y + TILE_T / 2, s.spot.z)
      out.q.setFromAxisAngle(UP, s.spot.rot)
      if (s.zone !== 'line') out.q.multiply(FLIP)
      return
    }
    const [dx, dz] = SEAT_DIRS[s.seat]!
    const big = s.seat === this.mySeat && !s.open ? MY_SCALE : 1
    const at = handSpots(s.seat, s.count, big)[s.index]!
    if (s.open) {
      // Face up in front of the chair, its length pointing at the middle of the table.
      out.p.set(at.x - dx * (TILE_L / 2 - 0.006), TOP_Y + TILE_T / 2, at.z - dz * (TILE_L / 2 - 0.006))
      out.q.setFromAxisAngle(UP, Math.atan2(-dz, dx))
      return
    }
    // Standing on its short edge, the face towards the chair, leaning back a little.
    const a = s.seat === this.mySeat ? this.lean : LEAN
    const sin = Math.sin(a), cos = Math.cos(a)
    vx.set(-dx * sin, cos, -dz * sin)
    vy.set(dx * cos, sin, dz * cos)
    vz.crossVectors(vx, vy)
    out.q.setFromRotationMatrix(m4.makeBasis(vx, vy, vz))
    out.p.set(at.x, TOP_Y + (TILE_T / 2) * sin * big, at.z).addScaledVector(vx, (TILE_L / 2) * big)
  }

  private slotsOf(v: DominoView | null): Slot[] {
    const out: Slot[] = []
    if (v && v.phase !== 'lobby') {
      const spots = chainLayout(v.line, v.origin)
      v.line.forEach((p, i) => out.push({ zone: 'line', seat: -1, index: i, count: v.line.length, tile: p[0], spot: spots[i]!, open: true }))
      for (let seat = 0; seat < DOMINO_SEATS; seat++) {
        const n = v.counts[seat] ?? 0
        const known = v.shown?.[seat] ?? (seat === this.mySeat ? v.hand : null)
        for (let i = 0; i < n; i++) out.push({ zone: `hand:${seat}`, seat, index: i, count: n, tile: known?.[i] ?? null, spot: null, open: v.phase === 'done' })
      }
      for (let i = 0; i < v.stock; i++) out.push({ zone: 'stock', seat: -1, index: i, count: v.stock, tile: null, spot: stockSpot(i), open: false })
    }
    // Whatever the game does not account for waits face down in the middle (all of it, before the first deal).
    const rest = 28 - out.length
    for (let i = 0; i < rest; i++) out.push({ zone: 'pile', seat: -1, index: i, count: rest, tile: null, spot: pileSpot(i), open: false })
    return out.slice(0, 28)
  }

  /** Gives every slot a tile: the same tile when its numbers are known, else one from where the move came from. */
  private assign(slots: Slot[], last: DominoLast | null): Map<Slot, Piece> {
    const free = new Set(this.pieces)
    const out = new Map<Slot, Piece>()
    const byTile = new Map<number, Piece>()
    for (const pc of this.pieces) if (pc.tile !== null) byTile.set(pc.tile, pc)
    const take = (s: Slot, pc: Piece): void => {
      out.set(s, pc)
      free.delete(pc)
    }
    for (const s of slots) {
      const pc = s.tile === null ? undefined : byTile.get(s.tile)
      if (pc && free.has(pc)) take(s, pc)
    }
    const from = (zone: string, blank: boolean): Piece | undefined => {
      let best: Piece | undefined
      for (const pc of free) {
        if (pc.slot.zone !== zone || (blank && pc.tile !== null)) continue
        if (!best || pc.slot.index < best.slot.index) best = pc
      }
      return best
    }
    const any = (): Piece => from('pile', false) ?? from('stock', false) ?? [...free][0]!
    // Tiles that just became known: played from someone's hand, drawn into mine, or turned up at the end.
    for (const s of slots) {
      if (out.has(s) || s.tile === null) continue
      const hint = s.zone === 'line' && last?.k === 'play' ? `hand:${last.seat}` : s.zone !== 'line' && last?.k === 'draw' && last.seat === s.seat ? 'stock' : null
      take(s, (hint && from(hint, true)) || from(s.zone, true) || from(s.zone, false) || any())
    }
    for (const s of slots) {
      if (out.has(s)) continue
      const hint = last?.k === 'draw' && s.zone === `hand:${last.seat}` ? 'stock' : null
      take(s, from(s.zone, true) || (hint && from(hint, true)) || from(s.zone, false) || any())
    }
    return out
  }

  // ---- the game -------------------------------------------------------------------------------------------------------

  /**
   * Shows the game. `mySeat`: the chair of the person at the keyboard here (-1: none). The tiles move to it the way
   * the last change calls for; `instant` puts them there at once.
   */
  apply(v: DominoView | null, mySeat: number, instant = false): void {
    const before = this.view
    this.mySeat = mySeat
    this.view = v
    const moved = !!before && !!v && v.seq > before.seq
    const last = moved ? v.last : null
    const snap = instant || this.reducedMotion || !before || !v || v.seq < before.seq
    const deal = last?.k === 'deal'
    const slots = this.slotsOf(v)
    const taken = this.assign(slots, last)
    const target = pose()
    let order = 0
    // Dealt round the table, a tile at a time; the stock is laid out last.
    const dealOrder = (s: Slot): number => (s.zone === 'stock' ? 28 + s.index : s.seat >= 0 ? s.index * DOMINO_SEATS + s.seat : s.index)
    const sorted = deal ? [...slots].sort((a, b) => dealOrder(a) - dealOrder(b)) : slots
    for (const s of sorted) {
      const pc = taken.get(s)!
      const was = pc.slot
      pc.slot = s
      this.restPose(s, target)
      const same = pc.rest.p.distanceToSquared(target.p) < 1e-10 && Math.abs(pc.rest.q.dot(target.q)) > 0.99999
      pc.rest.p.copy(target.p)
      pc.rest.q.copy(target.q)
      const face = s.tile
      if (snap) {
        pc.segs.length = 0
        pc.t = -1
        this.show(pc, face)
        pc.mesh.position.copy(target.p)
        pc.mesh.quaternion.copy(target.q)
        continue
      }
      if (deal) {
        pc.segs.length = 0
        pc.t = -1
        // Gathered face down in the middle, stirred, and dealt. A tile changes its numbers while nobody can see them.
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2, r = 0.02 + Math.random() * 0.1
          const q = new THREE.Quaternion().setFromAxisAngle(UP, Math.random() * Math.PI * 2).multiply(FLIP)
          pc.segs.push({ p: new THREE.Vector3(Math.cos(a) * r, TOP_Y + TILE_T / 2 + (i === 0 ? 0 : Math.random() * 0.004), Math.sin(a) * r), q, dur: i === 0 ? 0.34 : 0.27, delay: i === 0 ? Math.random() * 0.1 : 0, arc: i === 0 ? 0.03 : 0, sound: null, ...(i === 0 ? { faceAfter: face } : {}) })
        }
        pc.segs.push({ p: target.p.clone(), q: target.q.clone(), dur: 0.34, delay: order++ * 0.045, arc: 0.05, sound: 'tick' })
        continue
      }
      if (same && pc.tile === face) continue
      if (same) {
        this.show(pc, face)
        continue
      }
      const seg: Seg = { p: target.p.clone(), q: target.q.clone(), dur: 0.3, delay: 0, arc: 0, sound: null }
      if (pc.tile !== face) seg.face = face
      if (s.zone === 'line' && was.zone !== 'line') {
        seg.dur = 0.44
        seg.arc = 0.075
        seg.sound = 'clack'
      } else if (was.zone === 'stock' && s.zone !== 'stock') {
        seg.dur = 0.42
        seg.arc = 0.05
        seg.sound = 'tick'
      } else if (s.open && !was.open) {
        seg.dur = 0.36
        seg.delay = s.index * 0.035
        seg.arc = 0.02
      } else if (s.zone === was.zone) {
        seg.dur = 0.22
      }
      // A tile I was dragging is already over the table: it only has to drop.
      if (this.held && pc.tile === this.held.tile) {
        seg.dur = 0.16
        seg.arc = 0
      }
      pc.segs.length = 0
      pc.t = -1
      pc.segs.push(seg)
    }
    this.held = null
    if (snap || !last) return
    if (deal) this.sound.shuffle(0.9, this.near)
    else if (last.k === 'pass') this.sound.knock(this.near)
    if (v && v.phase === 'done' && before?.phase === 'play' && v.result) {
      this.sound.over(mySeat >= 0 && v.result.side === dominoSide(v, mySeat), this.near)
    }
  }

  private show(pc: Piece, tile: number | null): void {
    if (pc.tile === tile) return
    pc.tile = tile
    this.tiles.show(pc.mesh, tile)
  }

  /** Whether tiles are still on their way. */
  get busy(): boolean {
    return this.pieces.some((pc) => pc.segs.length > 0)
  }

  setLook(look: HandLook): void {
    this.look = look
  }

  /** A tile of my hand is carried over the table at `at` (the table's frame); null puts it back. */
  hold(tile: number | null, at?: THREE.Vector3): void {
    this.held = tile !== null && at ? { tile, at: (this.held?.at ?? new THREE.Vector3()).copy(at) } : null
  }

  /** Where a tile could be put, shown as a soft outline: up to two. `hot`: the one the keys or the pointer are on. */
  setGhosts(list: readonly { spot: Spot; hot: boolean }[]): void {
    this.ghosts.forEach((g, i) => {
      const it = list[i]
      g.visible = !!it
      if (!it) return
      g.position.set(it.spot.x, TOP_Y + TILE_T * 0.3 + 0.0006, it.spot.z)
      g.rotation.set(0, it.spot.rot, 0)
      g.userData.hot = it.hot
    })
  }

  setLampVisible(visible: boolean): void {
    if (this.lamp) this.lamp.visible = visible
  }

  // ---- pointing -------------------------------------------------------------------------------------------------------

  /** The tile of my hand a ray of the room hits, if any. */
  pickHand(ray: THREE.Ray): number | null {
    if (this.mySeat < 0) return null
    const zone = `hand:${this.mySeat}`
    const mine = this.pieces.filter((pc) => pc.slot.zone === zone && pc.tile !== null).map((pc) => pc.mesh)
    this.raycaster.ray.copy(ray)
    const hit = this.raycaster.intersectObjects(mine, false)[0]
    return hit ? this.pieces.find((pc) => pc.mesh === hit.object)?.tile ?? null : null
  }

  /** The outline (0 or 1, in the order given to setGhosts) a ray of the room hits, a little generously. */
  pickGhost(ray: THREE.Ray): number | null {
    const at = this.tablePoint(ray, TOP_Y)
    if (!at) return null
    let best: number | null = null, bestD = 0.06
    this.ghosts.forEach((g, i) => {
      const d = Math.hypot(g.position.x - at.x, g.position.z - at.z)
      if (g.visible && d < bestD) {
        best = i
        bestD = d
      }
    })
    return best
  }

  /** Where a ray of the room crosses the height `y` over the table, in the table's frame. */
  tablePoint(ray: THREE.Ray, y: number, target = new THREE.Vector3()): THREE.Vector3 | null {
    this.root.updateWorldMatrix(true, false)
    const local = this.raycaster.ray.copy(ray).applyMatrix4(m4.copy(this.root.matrixWorld).invert())
    if (Math.abs(local.direction.y) < 1e-6) return null
    const t = (y - local.origin.y) / local.direction.y
    return t > 0 ? local.at(t, target) : null
  }

  /** A point of the table's frame, in the room. */
  toRoom(x: number, y: number, z: number, target = new THREE.Vector3()): THREE.Vector3 {
    this.root.updateWorldMatrix(true, false)
    return target.set(x, y, z).applyMatrix4(this.root.matrixWorld)
  }

  // ---- frame ----------------------------------------------------------------------------------------------------------

  update(dt: number): void {
    this.clock += dt
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 4.2)
    const zone = this.mySeat >= 0 ? `hand:${this.mySeat}` : ''
    const { playable, focus, selected } = this.look
    for (const pc of this.pieces) {
      const mine = pc.slot.zone === zone && !pc.slot.open && pc.tile !== null
      const can = mine && !!playable?.has(pc.tile!)
      // My tiles: the ones that fit glow, the others step back while it is my turn.
      const glow = can ? 0.1 + 0.1 * pulse : 0
      const shade = mine && playable && !can ? 0.6 : 1
      const k = 1 - Math.exp(-dt * 12)
      const size = pc.slot.seat === this.mySeat && this.mySeat >= 0 && !pc.slot.open ? MY_SCALE : 1
      if (Math.abs(pc.mesh.scale.x - size) > 0.001) pc.mesh.scale.setScalar(this.reducedMotion ? size : pc.mesh.scale.x + (size - pc.mesh.scale.x) * k)
      if (Math.abs(pc.glow - glow) > 0.002 || Math.abs(pc.shade - shade) > 0.002) {
        pc.glow += (glow - pc.glow) * k
        pc.shade += (shade - pc.shade) * k
        pc.mesh.material.emissiveIntensity = pc.glow
        pc.mesh.material.color.setScalar(pc.shade)
      }
      const seg = pc.segs[0]
      if (seg) {
        if (seg.delay > 0) {
          seg.delay -= dt
          continue
        }
        if (pc.t < 0) {
          pc.t = 0
          pc.from.p.copy(pc.mesh.position)
          pc.from.q.copy(pc.mesh.quaternion)
          if (seg.face !== undefined) this.show(pc, seg.face)
        }
        pc.t = Math.min(1, pc.t + dt / seg.dur)
        const e = ease(pc.t)
        pc.mesh.position.lerpVectors(pc.from.p, seg.p, e)
        pc.mesh.position.y += seg.arc * Math.sin(Math.PI * pc.t)
        pc.mesh.quaternion.slerpQuaternions(pc.from.q, seg.q, e)
        if (pc.t >= 1) {
          if (seg.faceAfter !== undefined) this.show(pc, seg.faceAfter)
          if (seg.sound === 'clack') this.sound.clack(0.75, this.near)
          else if (seg.sound === 'tick') this.sound.tick(this.near)
          pc.segs.shift()
          pc.t = -1
          pc.lift = 0
        }
        continue
      }
      if (this.held && pc.tile === this.held.tile) {
        // Carried: lying face up under the pointer, its length towards the middle of the table.
        const [dx, dz] = SEAT_DIRS[Math.max(0, this.mySeat)]!
        tmp.copy(this.held.at)
        pc.mesh.position.lerp(tmp, 1 - Math.exp(-dt * 26))
        pc.mesh.quaternion.slerp(pc.from.q.setFromAxisAngle(UP, Math.atan2(-dz, dx)), 1 - Math.exp(-dt * 18))
        continue
      }
      if (!mine) continue
      // My hand follows the camera (so the faces stay readable) and answers the pointer and the keys.
      this.restPose(pc.slot, pc.rest)
      const lift = pc.tile === selected ? 0.02 : pc.tile === focus && can ? 0.011 : 0
      pc.lift += (lift - pc.lift) * (1 - Math.exp(-dt * 18))
      pc.mesh.position.lerp(tmp.copy(pc.rest.p).addScaledVector(UP, pc.lift), 1 - Math.exp(-dt * 20))
      pc.mesh.quaternion.slerp(pc.rest.q, 1 - Math.exp(-dt * 20))
    }
    for (const g of this.ghosts) if (g.visible) g.material.opacity = (g.userData.hot ? 0.5 : 0.24) + 0.14 * pulse
  }

  /**
   * For whoever inspects the page (the e2e): what is shown, whether tiles are still moving, and how many tiles in the
   * scene have numbers on them (the line and what this app was told of the hands, never more).
   */
  get digest(): string {
    const v = this.view
    const known = this.pieces.filter((pc) => pc.tile !== null).length
    return v ? `${this.id}:${v.seq}:${v.phase}:${v.line.length}:${this.busy ? 'moving' : 'still'}:${known}` : `${this.id}:-`
  }

  dispose(): void {
    this.root.removeFromParent()
    this.setLampVisible(true)
  }
}
