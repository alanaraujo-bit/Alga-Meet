/**
 * The pool table, built in code like the rest of the generated furniture: slate bed under cloth, six cushions cut at
 * the pocket angles, a wooden rail frame that wraps the pockets, leather-lined drops, sights on the rails, a cabinet on
 * four tapered legs, and its own lamp hanging over the middle. Every measure that matters to play comes from the
 * physics (pool-physics.ts), so what is drawn is exactly what the balls collide with.
 *
 * The table's own frame: x along the table, y up, z across; a point (px, py) of the physics is (px, BED_Y, -py) here.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { POOL_BALL_R, POOL_CORNER_CUT, POOL_FOOT_X, POOL_HL, POOL_HW, POOL_POCKETS, POOL_SIDE_HALF } from '@alga/shared'
import type { Kit, Piece } from '../engine/furniture'
import { boxUv, plain, surface } from '../engine/materials'

/** Height of the cloth over the floor. */
export const BED_Y = 0.8
/** Top of the rails over the cloth. */
export const RAIL_TOP = 0.043
/** From the nose of a cushion to the wood behind it, and the wood itself. */
export const CUSHION_W = 0.05
export const RAIL_W = 0.115
export const OUTER_HL = POOL_HL + CUSHION_W + RAIL_W
export const OUTER_HW = POOL_HW + CUSHION_W + RAIL_W
/** Height of the lamp's light over the floor. */
export const LAMP_Y = 1.92

export const CLOTHS: Record<string, string> = { verde: '#0b7a45', azul: '#1552a8', vinho: '#7d1a2c', grafite: '#3f434a' }

/** Turns physics coordinates into the table's frame. */
export const onTable = (px: number, py: number, y = BED_Y, target = new THREE.Vector3()): THREE.Vector3 => target.set(px, y, -py)

/** Fine woven noise, tiled: enough for the cloth to catch the lamp like felt instead of looking painted. */
export function feltTexture(k: Kit): THREE.Texture {
  const s = 256
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(s, s)
  let seed = 9173
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let i = 0; i < s * s; i++) {
    const v = 226 + (rnd() - 0.5) * 34 + (rnd() < 0.06 ? -22 : 0)
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const t = k.assets.own(new THREE.CanvasTexture(c))
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(5, 5)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** Bright in the middle of the bed, fading to nothing at the cushions. Mapped over the table in metres (as the cloth's UVs are). */
function poolOfLight(k: Kit): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 256, 128)
  ctx.translate(128, 64)
  ctx.scale(1, 0.56)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 128)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.45, '#9a9a9a')
  g.addColorStop(1, '#000000')
  ctx.fillStyle = g
  ctx.fillRect(-128, -128, 256, 256)
  const t = k.assets.own(new THREE.CanvasTexture(c))
  const w = 2 * (POOL_HL + CUSHION_W), h = 2 * (POOL_HW + CUSHION_W)
  t.repeat.set(1 / w, 1 / h)
  t.offset.set(0.5, 0.5)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

interface PocketArc {
  x: number
  y: number
  /** Angle towards the middle of the table, and half the angle of the arc that faces it. */
  inward: number
  half: number
}

/** The arc of each pocket's circle (radius scaled from the hole by `grow`) that lies inside the rectangle hx x hy. */
function pocketArcs(hx: number, hy: number, grow: number): (PocketArc & { r: number })[] {
  return POOL_POCKETS.map((p) => {
    const r = p.r + grow
    const side = p.x === 0
    const inward = Math.atan2(-Math.sign(p.y), side ? 0 : -Math.sign(p.x))
    if (side) {
      const d = Math.abs(p.y) - hy
      return { x: p.x, y: p.y, r, inward, half: Math.atan2(Math.sqrt(r * r - d * d), d) }
    }
    const d = Math.abs(p.x) - hx
    const h = Math.sqrt(r * r - d * d)
    return { x: p.x, y: p.y, r, inward, half: Math.acos(((h + d) * Math.SQRT1_2) / r) }
  })
}
/** Pockets in the order the outline meets them going anticlockwise from the -x-y corner. */
const AROUND = [0, 1, 2, 5, 4, 3]

/** The cloth: the bed out to the back of the cushions, bitten by the six holes. */
function clothShape(): THREE.Shape {
  const arcs = pocketArcs(POOL_HL + CUSHION_W, POOL_HW + CUSHION_W, 0)
  const shape = new THREE.Shape()
  AROUND.forEach((i, n) => {
    const a = arcs[i]!
    const from = a.inward + a.half, to = a.inward - a.half
    if (n === 0) shape.moveTo(a.x + Math.cos(from) * a.r, a.y + Math.sin(from) * a.r)
    shape.absarc(a.x, a.y, a.r, from, to, true)
  })
  shape.closePath()
  return shape
}

/** The wooden frame: a rounded rectangle with the playing field and the pocket openings cut out of it. */
function railShape(open: number): { shape: THREE.Shape; arcs: (PocketArc & { r: number })[] } {
  const arcs = pocketArcs(POOL_HL + CUSHION_W, POOL_HW + CUSHION_W, open)
  const shape = new THREE.Shape()
  const r = 0.075
  shape.moveTo(-OUTER_HL + r, -OUTER_HW)
  shape.lineTo(OUTER_HL - r, -OUTER_HW)
  shape.absarc(OUTER_HL - r, -OUTER_HW + r, r, -Math.PI / 2, 0, false)
  shape.lineTo(OUTER_HL, OUTER_HW - r)
  shape.absarc(OUTER_HL - r, OUTER_HW - r, r, 0, Math.PI / 2, false)
  shape.lineTo(-OUTER_HL + r, OUTER_HW)
  shape.absarc(-OUTER_HL + r, OUTER_HW - r, r, Math.PI / 2, Math.PI, false)
  shape.lineTo(-OUTER_HL, -OUTER_HW + r)
  shape.absarc(-OUTER_HL + r, -OUTER_HW + r, r, Math.PI, Math.PI * 1.5, false)
  const hole = new THREE.Path()
  AROUND.forEach((i, n) => {
    const a = arcs[i]!
    const from = a.inward + a.half, to = a.inward - a.half + Math.PI * 2
    if (n === 0) hole.moveTo(a.x + Math.cos(from) * a.r, a.y + Math.sin(from) * a.r)
    hole.absarc(a.x, a.y, a.r, from, to, false)
  })
  hole.closePath()
  shape.holes.push(hole)
  return { shape, arcs }
}

/** Cross-section of a cushion: [distance behind the nose, height over the cloth], clockwise. */
const CUSHION_PROFILE: readonly (readonly [number, number])[] = [[0, 0.0295], [0, 0.0375], [CUSHION_W, RAIL_TOP - 0.001], [CUSHION_W, -0.004], [0.016, -0.004]]
/** How much longer a cushion is at its back than at its nose, per metre of depth: the angle of the pocket facing. */
const CORNER_SLANT = 0.7880107536 / 0.6156614753
const SIDE_SLANT = 0.2419218956 / 0.9702957263

/** One cushion between two pocket points (p0 to p1 along the nose), `out` pointing at the rail behind it. */
function cushionGeometry(p0: readonly [number, number], p1: readonly [number, number], out: readonly [number, number], slant0: number, slant1: number): THREE.BufferGeometry {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
  const tx = (p1[0] - p0[0]) / len, ty = (p1[1] - p0[1]) / len
  const ring = (p: readonly [number, number], slant: number): THREE.Vector3[] =>
    CUSHION_PROFILE.map(([d, h]) => onTable(p[0] + out[0] * d + tx * slant * d, p[1] + out[1] * d + ty * slant * d, BED_Y + h))
  const a = ring(p0, -slant0), b = ring(p1, slant1)
  const centre = new THREE.Vector3()
  for (const v of [...a, ...b]) centre.addScaledVector(v, 1 / (a.length + b.length))
  const pos: number[] = []
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), mid = new THREE.Vector3()
  // Every face looks away from the middle of the prism, whichever way its corners were listed.
  const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3): void => {
    n.crossVectors(e1.subVectors(q, p), e2.subVectors(r, p))
    mid.copy(p).add(q).add(r).multiplyScalar(1 / 3).sub(centre)
    const [u, v, w] = n.dot(mid) >= 0 ? [p, q, r] : [p, r, q]
    pos.push(u.x, u.y, u.z, v.x, v.y, v.z, w.x, w.y, w.z)
  }
  const m = a.length
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m
    tri(a[i]!, b[i]!, b[j]!)
    tri(a[i]!, b[j]!, a[j]!)
  }
  for (let i = 1; i < m - 1; i++) {
    tri(a[0]!, a[i]!, a[i + 1]!)
    tri(b[0]!, b[i]!, b[i + 1]!)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return boxUv(g)
}

/** Builds the table into `k`. `variant`: the colour of the cloth. */
export async function poolTable(k: Kit, piece: Piece, variant: string | undefined): Promise<void> {
  const tint = CLOTHS[variant ?? 'verde'] ?? CLOTHS.verde!
  const felt = feltTexture(k)
  // Real-time lamps light the cloth evenly; a table under its own lamp is brighter in the middle. The cloth glows a
  // little in its own colour there, as much as the room's lamps are on.
  const pool = poolOfLight(k)
  const cloth = k.assets.own(new THREE.MeshPhysicalMaterial({
    emissive: tint, emissiveMap: pool, emissiveIntensity: 0.5,
    color: tint, map: felt, bumpMap: felt, bumpScale: 0.35, roughness: 0.94, sheen: 0.3, sheenRoughness: 0.6, sheenColor: new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.25),
  }))
  const [wood, dark] = await Promise.all([
    surface(k.assets, { set: 'wall_wood', tint: '#6b4630', roughness: 0.75, scale: 0.9 }),
    surface(k.assets, { set: 'wall_wood', tint: '#3d281d', roughness: 0.85, scale: 0.9 }),
  ])
  const leather = plain(k.assets, 0x0c0c0d, 0.72, 0, { side: THREE.DoubleSide })
  const hole = k.assets.own(new THREE.MeshBasicMaterial({ color: 0x020202 }))
  const brass = plain(k.assets, 0xb08d4f, 0.32, 1)
  const pearl = plain(k.assets, 0xe9e4d6, 0.25, 0.1)

  // Bed.
  const bedG = k.assets.own(new THREE.ShapeGeometry(clothShape(), 20).rotateX(-Math.PI / 2))
  const bed = k.add(new THREE.Mesh(bedG, cloth), 0, BED_Y, 0)
  bed.castShadow = false
  bed.name = 'pool:bed'

  // Cushions: two on each long rail, one on each end.
  const cut = POOL_CORNER_CUT, s = POOL_SIDE_HALF
  for (const sy of [-1, 1]) {
    k.add(new THREE.Mesh(k.assets.own(cushionGeometry([-(POOL_HL - cut), sy * POOL_HW], [-s, sy * POOL_HW], [0, sy], CORNER_SLANT, SIDE_SLANT)), cloth), 0, 0, 0)
    k.add(new THREE.Mesh(k.assets.own(cushionGeometry([s, sy * POOL_HW], [POOL_HL - cut, sy * POOL_HW], [0, sy], SIDE_SLANT, CORNER_SLANT)), cloth), 0, 0, 0)
  }
  for (const sx of [-1, 1]) {
    k.add(new THREE.Mesh(k.assets.own(cushionGeometry([sx * POOL_HL, -(POOL_HW - cut)], [sx * POOL_HL, POOL_HW - cut], [sx, 0], CORNER_SLANT, CORNER_SLANT)), cloth), 0, 0, 0)
  }

  // Rail frame, with soft edges all round (the openings of the pockets too).
  const { shape, arcs } = railShape(0.011)
  const bevel = 0.006, thick = RAIL_TOP + 0.034
  const railG = k.assets.own(new THREE.ExtrudeGeometry(shape, { depth: thick - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 3, curveSegments: 28 }).rotateX(-Math.PI / 2))
  k.add(new THREE.Mesh(railG, wood), 0, BED_Y + RAIL_TOP - thick + bevel, 0)

  // Pockets: a leather wall round the opening, the drop into the slate, and a brass rim on the wood.
  for (const a of arcs) {
    const from = a.inward + a.half, span = Math.PI * 2 - 2 * a.half
    const wall = new THREE.Mesh(k.assets.own(new THREE.CylinderGeometry(a.r - 0.0015, a.r - 0.0015, RAIL_TOP + 0.03, 40, 1, true, from + Math.PI / 2, span)), leather)
    k.add(wall, a.x, BED_Y + (RAIL_TOP - 0.03) / 2, -a.y).castShadow = false
    // The cabinet is right under the slate: the bottom of the drop is plain black, which reads as depth.
    const floor = new THREE.Mesh(k.assets.own(new THREE.CircleGeometry(a.r, 32).rotateX(-Math.PI / 2)), hole)
    k.add(floor, a.x, BED_Y - 0.028, -a.y).castShadow = false
    const lip = new THREE.Mesh(k.assets.own(new THREE.RingGeometry(a.r - 0.014, a.r, 40).rotateX(-Math.PI / 2)), leather)
    k.add(lip, a.x, BED_Y - 0.0012, -a.y).castShadow = false
    const rim = new THREE.Mesh(k.assets.own(new THREE.TorusGeometry(a.r + 0.004, 0.0045, 10, 48, span).rotateX(-Math.PI / 2)), brass)
    rim.rotation.y = from
    k.add(rim, a.x, BED_Y + RAIL_TOP - 0.001, -a.y).castShadow = false
  }

  // Sights: three between each pair of pockets.
  const sights: THREE.BufferGeometry[] = []
  const sight = (px: number, py: number): void => void sights.push(new THREE.CylinderGeometry(0.0065, 0.0065, 0.002, 16).translate(px, 0, -py))
  const back = CUSHION_W + RAIL_W * 0.5
  for (const q of [0.25, 0.5, 0.75]) {
    for (const sy of [-1, 1]) for (const sx of [-1, 1]) sight(sx * POOL_HL * q, sy * (POOL_HW + back))
    for (const sx of [-1, 1]) sight(sx * (POOL_HL + back), (q - 0.5) * 2 * POOL_HW)
  }
  // One mesh for all eighteen.
  k.add(new THREE.Mesh(k.assets.own(mergeGeometries(sights)), pearl), 0, BED_Y + RAIL_TOP + 0.0005, 0).castShadow = false
  for (const g of sights) g.dispose()
  // The foot spot.
  const spot = new THREE.Mesh(k.assets.own(new THREE.CircleGeometry(0.007, 20).rotateX(-Math.PI / 2)), plain(k.assets, 0x0c0c0d, 0.9))
  k.add(spot, POOL_FOOT_X, BED_Y + 0.0006, 0).castShadow = false

  // Cabinet and legs.
  k.soft(2 * OUTER_HL - 0.05, 0.2, 2 * OUTER_HW - 0.05, 0.012, dark, 0, BED_Y - 0.03 - 0.1, 0, 2)
  k.soft(2 * OUTER_HL - 0.3, 0.07, 2 * OUTER_HW - 0.3, 0.01, dark, 0, BED_Y - 0.265, 0, 2)
  const legH = BED_Y - 0.3
  const legG = k.assets.own(new THREE.CylinderGeometry(0.1, 0.066, legH - 0.035, 4).rotateY(Math.PI / 4))
  const footG = k.assets.own(new THREE.CylinderGeometry(0.07, 0.074, 0.035, 4).rotateY(Math.PI / 4))
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.add(new THREE.Mesh(legG, wood), sx * (OUTER_HL - 0.19), 0.035 + (legH - 0.035) / 2, sz * (OUTER_HW - 0.17))
    k.add(new THREE.Mesh(footG, brass), sx * (OUTER_HL - 0.19), 0.0175, sz * (OUTER_HW - 0.17))
  }
  // A cube of chalk left on the rail.
  k.box(0.022, 0.022, 0.022, plain(k.assets, 0x2f6fc4, 0.95), 0.42, BED_Y + RAIL_TOP + 0.011, OUTER_HW - 0.05).rotation.y = 0.5

  // The lamp over the table: a long shade open underneath. It hangs from above whatever the ceiling is.
  const lamp = new THREE.Group()
  lamp.name = 'pool:lamp'
  const metal = plain(k.assets, 0x111112, 0.42, 0.85)
  const inner = plain(k.assets, 0xd9c6a2, 0.6, 0.2)
  const shadeG = k.assets.own(boxUv(new THREE.BoxGeometry(1.5, 0.1, 0.24)))
  const shade = new THREE.Mesh(shadeG, metal)
  shade.position.set(0, LAMP_Y + 0.07, 0)
  shade.castShadow = false
  const glowM = k.assets.own(new THREE.MeshBasicMaterial({ color: 0xffe2bd, toneMapped: false }))
  const glow = new THREE.Mesh(k.assets.own(new THREE.PlaneGeometry(1.42, 0.17).rotateX(Math.PI / 2)), glowM)
  glow.position.set(0, LAMP_Y + 0.018, 0)
  const liner = new THREE.Mesh(k.assets.own(new THREE.PlaneGeometry(1.48, 0.22).rotateX(Math.PI / 2)), inner)
  liner.position.set(0, LAMP_Y + 0.0195, 0)
  lamp.add(shade, liner, glow)
  const wireG = k.assets.own(new THREE.CylinderGeometry(0.0035, 0.0035, 2, 6))
  for (const x of [-0.6, 0.6]) {
    const wire = new THREE.Mesh(wireG, metal)
    wire.position.set(x, LAMP_Y + 0.12 + 1, 0)
    lamp.add(wire)
  }
  k.group.add(lamp)
  piece.glows = [{ material: glowM, base: 2.4 }, { material: cloth, base: 0.5 }]
}

/** Radius of a ball, for whoever places things on the cloth. */
export const BALL_Y = BED_Y + POOL_BALL_R
