/**
 * Rearranging a room. The owner picks a piece up with the pointer and puts it somewhere else: on the floor, against a
 * wall, on top of a table, under the ceiling, each kind of piece where it belongs. Nothing here saves anything: it
 * edits the layout the engine is showing and tells the screen what changed.
 */
import * as THREE from 'three'
import { WORLD_ITEM_MAX_COPIES, WORLD_ROOM_MAX_ITEMS, WORLD_SHELLS, worldItem, type WorldItemDef, type WorldPlacedItem, type WorldRoomLayout } from '@alga/shared'
import type { Assets } from '../assets/loaders'
import { addBuiltItem, rebuildDerived, removeBuiltItem, type BuiltItem, type RoomItems } from './items'

export interface EditorHooks {
  onSelect?(item: WorldPlacedItem | null): void
  /** The layout changed (a piece was moved, turned, added, removed or recoloured). */
  onChange?(items: WorldPlacedItem[]): void
}

export type AddResult = { ok: true; id: string } | { ok: false; reason: 'too_many' | 'too_many_copies' | 'unknown' | 'failed' }

const SNAP = 0.05
const TURN = Math.PI / 12
const snap = (v: number) => Math.round(v / SNAP) * SNAP
const round3 = (v: number) => Math.round(v * 1000) / 1000

export class RoomEditor {
  private selected: string | null = null
  private outline: THREE.LineSegments | null = null
  private drag: { id: string; dx: number; dz: number; moved: boolean } | null = null
  private readonly ray = new THREE.Raycaster()
  private readonly hit = new THREE.Vector3()
  private readonly material = new THREE.LineBasicMaterial({ color: 0x8b8ef7, depthTest: false, transparent: true, opacity: 0.95 })

  constructor(
    private readonly assets: Assets,
    private readonly camera: THREE.Camera,
    private readonly room: () => RoomItems | null,
    private readonly layout: () => WorldRoomLayout | null,
    private readonly hooks: EditorHooks,
    /** Colliders, seats and lamps follow the pieces: the engine refreshes what depends on them. */
    private readonly changed: (lamps: boolean) => void,
  ) {
    this.ray.layers.enableAll()
  }

  get selection(): string | null {
    return this.selected
  }

  get dragging(): boolean {
    return !!this.drag
  }

  /** The piece under the pointer, if any. Rugs only when nothing stands on that spot. */
  pick(pointer: THREE.Vector2): BuiltItem | null {
    const room = this.room()
    if (!room) return null
    this.ray.setFromCamera(pointer, this.camera)
    const hits = this.ray.intersectObjects(room.group.children, true)
    let rug: BuiltItem | null = null
    for (const h of hits) {
      if (h.object.name === 'contact') continue
      let o: THREE.Object3D | null = h.object
      while (o && o.userData.itemId === undefined) o = o.parent
      const built = o ? room.items.get(o.userData.itemId as string) : undefined
      if (!built) continue
      if (built.def.place !== 'rug') return built
      rug ??= built
    }
    return rug
  }

  select(id: string | null): void {
    if (this.outline) {
      this.outline.removeFromParent()
      this.outline.geometry.dispose()
      this.outline = null
    }
    const built = id ? this.room()?.items.get(id) : undefined
    this.selected = built ? built.placed.id : null
    if (built) {
      const [w, h, d] = built.def.size
      const wall = built.def.place === 'wall'
      const box = new THREE.BoxGeometry(w + 0.06, h + 0.06, d + 0.06)
      // Pieces stand on their base; wall pieces also have their back on the wall.
      box.translate(0, h / 2, wall ? d / 2 : 0)
      const edges = new THREE.EdgesGeometry(box)
      box.dispose()
      this.outline = new THREE.LineSegments(edges, this.material)
      this.outline.renderOrder = 50
      this.outline.name = 'contact'
      built.object.add(this.outline)
    }
    this.hooks.onSelect?.(built ? { ...built.placed } : null)
  }

  /** Pointer went down on a piece: it is selected and follows the pointer until released. */
  begin(pointer: THREE.Vector2): boolean {
    const built = this.pick(pointer)
    if (!built) return false
    if (this.selected !== built.placed.id) this.select(built.placed.id)
    const p = this.floorPoint(pointer, built.placed.y)
    this.drag = { id: built.placed.id, dx: p ? built.placed.x - p.x : 0, dz: p ? built.placed.z - p.z : 0, moved: false }
    return true
  }

  move(pointer: THREE.Vector2): void {
    const d = this.drag
    const room = this.room(), layout = this.layout()
    const built = d && room?.items.get(d.id)
    if (!d || !built || !layout) return
    d.moved = true
    const shell = WORLD_SHELLS[layout.shell]
    const def = built.def
    const p = built.placed
    if (def.place === 'wall') {
      const w = this.wallPoint(pointer, shell.width, shell.depth)
      if (!w) return
      p.x = round3(w.x)
      p.z = round3(w.z)
      p.rot = w.rot
      p.y = round3(THREE.MathUtils.clamp(snap(w.y - def.size[1] / 2), 0.05, shell.height - def.size[1] - 0.05))
    } else {
      const f = this.floorPoint(pointer, def.place === 'ceiling' ? p.y : 0)
      if (!f) return
      const hx = shell.width / 2 - Math.min(def.size[0], def.size[2]) / 2 - 0.02
      const hz = shell.depth / 2 - Math.min(def.size[0], def.size[2]) / 2 - 0.02
      p.x = round3(THREE.MathUtils.clamp(snap(f.x + (def.place === 'surface' ? 0 : d.dx)), -hx, hx))
      p.z = round3(THREE.MathUtils.clamp(snap(f.z + (def.place === 'surface' ? 0 : d.dz)), -hz, hz))
      if (def.place === 'surface') p.y = round3(this.surfaceUnder(p.x, p.z, p.id))
      else if (def.place === 'ceiling') p.y = round3(shell.height - def.size[1])
      else p.y = 0
    }
    this.apply(built)
  }

  /** Pointer released. Returns whether a piece was actually moved. */
  end(): boolean {
    const d = this.drag
    this.drag = null
    if (!d?.moved) return false
    this.commit(true)
    return true
  }

  /** Turns the selected piece by `steps` × 15°. */
  rotate(steps: number): void {
    const built = this.selectedItem()
    if (!built || built.def.place === 'wall') return
    built.placed.rot = round3(((built.placed.rot + steps * TURN + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
    this.apply(built)
    this.commit(false)
  }

  /** Moves the selected piece by a step along the room's axes (keyboard). */
  nudge(dx: number, dz: number): void {
    const built = this.selectedItem(), layout = this.layout()
    if (!built || !layout || built.def.place === 'wall') return
    const shell = WORLD_SHELLS[layout.shell]
    built.placed.x = round3(THREE.MathUtils.clamp(built.placed.x + dx * SNAP, -shell.width / 2, shell.width / 2))
    built.placed.z = round3(THREE.MathUtils.clamp(built.placed.z + dz * SNAP, -shell.depth / 2, shell.depth / 2))
    if (built.def.place === 'surface') built.placed.y = round3(this.surfaceUnder(built.placed.x, built.placed.z, built.placed.id))
    this.apply(built)
    this.commit(true)
  }

  remove(): void {
    const room = this.room(), layout = this.layout()
    const id = this.selected
    if (!room || !layout || !id) return
    this.select(null)
    removeBuiltItem(room, id)
    layout.items = layout.items.filter((i) => i.id !== id)
    this.commit(true)
  }

  /** Adds a piece near `near` (the middle of what the person is looking at) and selects it. */
  async add(sku: string, near: { x: number; z: number }, variant?: string): Promise<AddResult> {
    const room = this.room(), layout = this.layout()
    const def = worldItem(sku)
    if (!room || !layout || !def) return { ok: false, reason: 'unknown' }
    if (layout.items.length >= WORLD_ROOM_MAX_ITEMS) return { ok: false, reason: 'too_many' }
    if (layout.items.filter((i) => i.sku === sku).length >= WORLD_ITEM_MAX_COPIES) return { ok: false, reason: 'too_many_copies' }
    const shell = WORLD_SHELLS[layout.shell]
    const taken = new Set(layout.items.map((i) => i.id))
    let id = ''
    do id = Math.random().toString(36).slice(2, 8)
    while (!id || taken.has(id))
    const placed: WorldPlacedItem = { id, sku, x: round3(snap(near.x)), y: 0, z: round3(snap(near.z)), rot: 0, ...(variant ?? def.variants?.[0]?.id ? { variant: variant ?? def.variants![0]!.id } : {}) }
    this.settle(placed, def, shell)
    try {
      const built = await addBuiltItem(this.assets, room, placed)
      if (!built) return { ok: false, reason: 'unknown' }
    } catch {
      return { ok: false, reason: 'failed' }
    }
    layout.items = [...layout.items, placed]
    this.select(id)
    this.commit(true)
    return { ok: true, id }
  }

  /** Swaps the colourway of the selected piece (it is rebuilt in place). */
  async setVariant(variant: string): Promise<void> {
    const room = this.room(), layout = this.layout()
    const built = this.selectedItem()
    if (!room || !layout || !built || !built.def.variants?.some((v) => v.id === variant)) return
    const placed: WorldPlacedItem = { ...built.placed, variant }
    removeBuiltItem(room, placed.id)
    this.outline = null
    await addBuiltItem(this.assets, room, placed)
    layout.items = layout.items.map((i) => (i.id === placed.id ? placed : i))
    this.select(placed.id)
    this.commit(false)
  }

  dispose(): void {
    this.select(null)
    this.material.dispose()
  }

  private selectedItem(): BuiltItem | undefined {
    return this.selected ? this.room()?.items.get(this.selected) : undefined
  }

  /** Where a new piece of each kind starts: on the floor, on the nearest wall, under the ceiling. */
  private settle(p: WorldPlacedItem, def: WorldItemDef, shell: { width: number; depth: number; height: number }): void {
    if (def.place === 'wall') {
      // The back wall, at eye level, as near as possible to where the person looks.
      p.z = round3(-shell.depth / 2 + 0.02)
      p.x = round3(THREE.MathUtils.clamp(p.x, -shell.width / 2 + def.size[0] / 2 + 0.1, shell.width / 2 - def.size[0] / 2 - 0.1))
      p.y = round3(Math.max(0.3, 1.5 - def.size[1] / 2))
      p.rot = 0
    } else if (def.place === 'ceiling') {
      p.y = round3(shell.height - def.size[1])
    } else if (def.place === 'surface') {
      p.y = round3(this.surfaceUnder(p.x, p.z, p.id))
    }
  }

  private apply(built: BuiltItem): void {
    const p = built.placed
    built.object.position.set(p.x, p.y, p.z)
    built.object.rotation.y = p.rot
    this.hooks.onSelect?.({ ...p })
  }

  private commit(lamps: boolean): void {
    const room = this.room(), layout = this.layout()
    if (!room || !layout) return
    // The built items hold the live transforms: the layout is rewritten from them.
    layout.items = layout.items.map((i) => room.items.get(i.id)?.placed ?? i)
    rebuildDerived(room, layout)
    this.changed(lamps)
    this.hooks.onChange?.(layout.items.map((i) => ({ ...i })))
  }

  private floorPoint(pointer: THREE.Vector2, y: number): THREE.Vector3 | null {
    this.ray.setFromCamera(pointer, this.camera)
    const r = this.ray.ray
    if (Math.abs(r.direction.y) < 1e-4) return null
    const t = (y - r.origin.y) / r.direction.y
    return t > 0 ? r.at(t, this.hit) : null
  }

  /** The point of the nearest wall under the pointer, and the way a piece hung there faces. */
  private wallPoint(pointer: THREE.Vector2, width: number, depth: number): { x: number; y: number; z: number; rot: number } | null {
    this.ray.setFromCamera(pointer, this.camera)
    const o = this.ray.ray.origin, d = this.ray.ray.direction
    const hw = width / 2, hd = depth / 2
    let best: { x: number; y: number; z: number; rot: number } | null = null
    let bestT = Infinity
    const tryWall = (axis: 'x' | 'z', at: number, rot: number) => {
      const dir = axis === 'x' ? d.x : d.z
      if (Math.abs(dir) < 1e-4) return
      const t = (at - (axis === 'x' ? o.x : o.z)) / dir
      if (t <= 0 || t >= bestT) return
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t
      const along = axis === 'x' ? z : x
      const limit = (axis === 'x' ? hd : hw) - 0.15
      if (Math.abs(along) > limit + 0.6 || y < -0.2) return
      bestT = t
      const a = snap(THREE.MathUtils.clamp(along, -limit, limit))
      best = axis === 'x' ? { x: at, y, z: a, rot } : { x: a, y, z: at, rot }
    }
    // A hair off the wall plane so the piece never fights the plaster for the same pixels.
    tryWall('z', -hd + 0.02, 0)
    tryWall('x', -hw + 0.02, Math.PI / 2)
    tryWall('x', hw - 0.02, -Math.PI / 2)
    return best
  }

  /** Height of the highest surface a small piece at (x, z) can stand on: a table or cabinet top, else the floor. */
  private surfaceUnder(x: number, z: number, self: string): number {
    const room = this.room()
    let top = 0
    if (!room) return top
    for (const b of room.items.values()) {
      if (b.placed.id === self || b.def.top === undefined || b.def.place !== 'floor') continue
      const cos = Math.cos(b.placed.rot), sin = Math.sin(b.placed.rot)
      const dx = x - b.placed.x, dz = z - b.placed.z
      const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos
      if (Math.abs(lx) <= b.def.size[0] / 2 && Math.abs(lz) <= b.def.size[2] / 2) top = Math.max(top, b.placed.y + b.def.top)
    }
    return top
  }
}
