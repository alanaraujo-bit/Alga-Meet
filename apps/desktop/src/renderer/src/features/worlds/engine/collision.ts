/**
 * Walking in a room: a person is a circle on the floor, furniture is a set of boxes, the room is a rectangle. Pure
 * numbers (no three.js), so it runs the same in tests.
 */

/** A box on the floor: centre, half sizes and yaw (radians, same convention as the room: 0 = facing +Z). */
export interface Box {
  x: number
  z: number
  hw: number
  hd: number
  rot: number
}
/** Half size of the walkable rectangle, centred on the origin. */
export interface Bounds {
  hw: number
  hd: number
}

export const PERSON_RADIUS = 0.26

/** The point of the room a circle of radius `r` at (x, z) is pushed to so that it overlaps no box and no wall. */
export function resolve(x: number, z: number, r: number, bounds: Bounds, boxes: readonly Box[]): [number, number] {
  // Two rounds: being pushed out of one box may push into its neighbour.
  for (let pass = 0; pass < 3; pass++) {
    let moved = false
    for (const b of boxes) {
      const cos = Math.cos(b.rot), sin = Math.sin(b.rot)
      // Into the box's own space (inverse of a yaw rotation).
      const dx = x - b.x, dz = z - b.z
      const lx = dx * cos - dz * sin
      const lz = dx * sin + dz * cos
      const cx = Math.max(-b.hw, Math.min(b.hw, lx))
      const cz = Math.max(-b.hd, Math.min(b.hd, lz))
      let ox = lx - cx, oz = lz - cz
      const d2 = ox * ox + oz * oz
      if (d2 >= r * r) continue
      let nx: number, nz: number, push: number
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2)
        nx = ox / d
        nz = oz / d
        push = r - d
      } else {
        // The centre is inside the box: leave through the nearest face.
        const px = b.hw - Math.abs(lx), pz = b.hd - Math.abs(lz)
        if (px < pz) { nx = lx < 0 ? -1 : 1; nz = 0; push = px + r } else { nx = 0; nz = lz < 0 ? -1 : 1; push = pz + r }
        ox = oz = 0
      }
      const wx = lx + nx * push, wz = lz + nz * push
      x = b.x + wx * cos + wz * sin
      z = b.z - wx * sin + wz * cos
      moved = true
    }
    const bx = Math.max(-bounds.hw + r, Math.min(bounds.hw - r, x))
    const bz = Math.max(-bounds.hd + r, Math.min(bounds.hd - r, z))
    if (bx !== x || bz !== z) moved = true
    x = bx
    z = bz
    if (!moved) break
  }
  return [x, z]
}

/**
 * One step of a walk from (x, z) by (dx, dz): the person slides along what they touch instead of stopping dead. Long
 * steps are cut into short ones so a fast frame cannot jump through a thin piece.
 */
export function slide(x: number, z: number, dx: number, dz: number, r: number, bounds: Bounds, boxes: readonly Box[]): [number, number] {
  const len = Math.hypot(dx, dz)
  const steps = Math.max(1, Math.ceil(len / (r * 0.75)))
  for (let i = 0; i < steps; i++) [x, z] = resolve(x + dx / steps, z + dz / steps, r, bounds, boxes)
  return [x, z]
}

/** Whether a circle at (x, z) is free of boxes and walls. */
export function isFree(x: number, z: number, r: number, bounds: Bounds, boxes: readonly Box[]): boolean {
  const [rx, rz] = resolve(x, z, r, bounds, boxes)
  return Math.abs(rx - x) < 1e-6 && Math.abs(rz - z) < 1e-6
}

/**
 * Where to stand to use something at (x, z) facing `yaw` (a seat): the first free spot in front of it, then to its
 * sides, else the spot itself resolved out of the furniture.
 */
export function standBy(x: number, z: number, yaw: number, r: number, bounds: Bounds, boxes: readonly Box[]): [number, number] {
  for (const [a, d] of [[0, 0.62], [0, 0.85], [0.7, 0.75], [-0.7, 0.75], [1.5, 0.7], [-1.5, 0.7]] as const) {
    const px = x + Math.sin(yaw + a) * d, pz = z + Math.cos(yaw + a) * d
    if (isFree(px, pz, r, bounds, boxes)) return [px, pz]
  }
  return resolve(x + Math.sin(yaw) * 0.62, z + Math.cos(yaw) * 0.62, r, bounds, boxes)
}

/** The shortest signed turn from yaw `a` to yaw `b`, in (-π, π]. */
export function turn(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d <= -Math.PI) d += Math.PI * 2
  return d
}
