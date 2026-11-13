/**
 * The furniture of a room: every placed item of the layout becomes an object in the scene, plus what the rest of the
 * engine needs to know about it (where people cannot walk, where they can sit, which glass shows the shared screen,
 * which lamps light). One item that fails to load (a file missing from the pack, an id from a newer app) is skipped and
 * reported; the room is still built.
 */
import * as THREE from 'three'
import { seatPlace, worldItem, type WorldItemDef, type WorldPlacedItem, type WorldRoomLayout } from '@alga/shared'
import type { Assets } from '../assets/loaders'
import type { Box } from './collision'
import { buildPiece, type Piece } from './furniture'
import type { LampSource } from './lighting'
import { contactShadow, kelvin } from './materials'

export interface SeatSpot {
  /** `<item id>:<n>` */
  id: string
  x: number
  y: number
  z: number
  yaw: number
}

export interface BuiltItem {
  placed: WorldPlacedItem
  def: WorldItemDef
  object: THREE.Group
  screen?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
}

export interface RoomItems {
  group: THREE.Group
  items: Map<string, BuiltItem>
  boxes: Box[]
  seats: SeatSpot[]
  lamps: LampSource[]
  glows: { material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial; base: number }[]
  /** Items that could not be built: [sku, why]. */
  failed: [string, string][]
}

/** A lamp model of the pack has no part that glows by itself: its bulb is a small bright sphere at the source. */
function bulb(assets: Assets, def: WorldItemDef): { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial } {
  const [k, , h] = def.light!
  const material = assets.own(new THREE.MeshBasicMaterial({ color: kelvin(k), toneMapped: false }))
  const r = Math.max(0.03, Math.min(def.size[0], def.size[2]) * 0.16)
  const mesh = new THREE.Mesh(assets.own(new THREE.SphereGeometry(r, 16, 12)), material)
  mesh.position.set(0, h, 0)
  return { mesh, material }
}

async function build(assets: Assets, placed: WorldPlacedItem, def: WorldItemDef): Promise<{ object: THREE.Group; piece: Piece | null }> {
  const holder = new THREE.Group()
  holder.name = `item:${placed.id}`
  let piece: Piece | null = null
  if ('proc' in def.model) {
    piece = await buildPiece(assets, def, def.model.proc, placed.variant)
    holder.add(piece.object)
  } else {
    const template = await assets.model(def.model.glb)
    const inst = template.clone()
    if (def.model.scale) inst.scale.setScalar(def.model.scale)
    if (def.model.yaw) inst.rotation.y = def.model.yaw
    holder.add(inst)
  }
  return { object: holder, piece }
}

export async function buildItems(assets: Assets, layout: WorldRoomLayout, signal?: { aborted: boolean }): Promise<RoomItems> {
  const out: RoomItems = { group: new THREE.Group(), items: new Map(), boxes: [], seats: [], lamps: [], glows: [], failed: [] }
  out.group.name = 'items'
  await Promise.all(layout.items.map(async (placed) => {
    const def = worldItem(placed.sku)
    if (!def) return void out.failed.push([placed.sku, 'unknown item'])
    try {
      const { object, piece } = await build(assets, placed, def)
      if (signal?.aborted) return
      addItem(assets, out, placed, def, object, piece)
    } catch (err) {
      out.failed.push([placed.sku, (err as Error).message])
    }
  }))
  rebuildDerived(out, layout)
  return out
}

function addItem(assets: Assets, out: RoomItems, placed: WorldPlacedItem, def: WorldItemDef, object: THREE.Group, piece: Piece | null): void {
  object.position.set(placed.x, placed.y, placed.z)
  object.rotation.y = placed.rot
  // Rugs and things on the ceiling never shadow the room; small decor is not worth a shadow pass either.
  const casts = def.place === 'floor' || def.place === 'surface'
  object.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    if (!casts) mesh.castShadow = false
  })
  object.userData.itemId = placed.id
  // Standing furniture darkens the floor it stands on (above a rug, if there is one under it).
  if (def.place === 'floor') {
    const contact = contactShadow(assets, def.size[0], def.size[2])
    contact.position.y = 0.021
    object.add(contact)
  }
  out.group.add(object)
  const built: BuiltItem = { placed, def, object }
  if (piece?.screen) built.screen = piece.screen
  if (piece?.glows) out.glows.push(...piece.glows)
  else if (def.light) {
    const b = bulb(assets, def)
    object.add(b.mesh)
    out.glows.push({ material: b.material, base: 1.4 })
  }
  out.items.set(placed.id, built)
}

/** Colliders, seats and lamps follow the placed items: recomputed whenever one moves. */
export function rebuildDerived(out: RoomItems, layout: Pick<WorldRoomLayout, 'items'>): void {
  out.boxes = []
  out.seats = []
  out.lamps = []
  for (const built of out.items.values()) {
    const { placed, def } = built
    const solid = def.solid ?? def.place === 'floor'
    if (solid) out.boxes.push({ x: placed.x, z: placed.z, hw: def.size[0] / 2, hd: def.size[2] / 2, rot: placed.rot })
    for (let i = 0; i < (def.seats?.length ?? 0); i++) {
      const id = `${placed.id}:${i}`
      const s = seatPlace(layout, id)
      if (s) out.seats.push({ id, ...s })
    }
    if (def.light) out.lamps.push({ position: new THREE.Vector3(placed.x, placed.y + def.light[2], placed.z), kelvin: def.light[0], strength: def.light[1] })
  }
}

/** Adds one item to a built room (the editor placing something). */
export async function addBuiltItem(assets: Assets, out: RoomItems, placed: WorldPlacedItem): Promise<BuiltItem | null> {
  const def = worldItem(placed.sku)
  if (!def) return null
  const { object, piece } = await build(assets, placed, def)
  addItem(assets, out, placed, def, object, piece)
  return out.items.get(placed.id) ?? null
}

export function removeBuiltItem(out: RoomItems, id: string): void {
  const built = out.items.get(id)
  if (!built) return
  out.group.remove(built.object)
  out.items.delete(id)
}
