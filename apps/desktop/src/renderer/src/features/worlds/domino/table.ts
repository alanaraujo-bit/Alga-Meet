/**
 * The domino table, built in code: a square of felt inside a raised wooden rim (so nothing slides off), on four
 * tapered legs, with its four chairs and a lamp hanging over the middle. The chairs are the pack's dining chair, one
 * on each seat of the catalog entry. What is played on it (layout.ts) is measured from the middle of the felt.
 */
import * as THREE from 'three'
import type { WorldItemDef } from '@alga/shared'
import type { Kit, Piece } from '../engine/furniture'
import { plain, surface } from '../engine/materials'
import { feltTexture } from '../pool/table'
import { FELT_HALF, TOP_Y } from './layout'

/** Half the side of the table, rim included, and how far the rim stands over the felt. */
const OUTER = 0.5
const RIM_TOP = 0.014
/** Height of the lamp's light over the floor (the catalog entry's `light`). */
const LAMP_Y = 1.72
/** The felt sits right under its lamp, so its colours are deeper than the pool table's of the same names. */
const FELTS: Record<string, string> = { verde: '#0a5233', azul: '#11397a', vinho: '#4f0d1b', grafite: '#2c3036' }

function roundedSquare(half: number, r: number): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(-half + r, -half)
  s.lineTo(half - r, -half)
  s.absarc(half - r, -half + r, r, -Math.PI / 2, 0, false)
  s.lineTo(half, half - r)
  s.absarc(half - r, half - r, r, 0, Math.PI / 2, false)
  s.lineTo(-half + r, half)
  s.absarc(-half + r, half - r, r, Math.PI / 2, Math.PI, false)
  s.lineTo(-half, -half + r)
  s.absarc(-half + r, -half + r, r, Math.PI, Math.PI * 1.5, false)
  return s
}

/** Bright under the lamp, fading to nothing at the rim. */
function lampPool(k: Kit): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.55, '#8a8a8a')
  g.addColorStop(1, '#000000')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const t = k.assets.own(new THREE.CanvasTexture(c))
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Builds the table into `k`. `variant`: the colour of the felt. */
export async function dominoTable(k: Kit, piece: Piece, variant: string | undefined, def: WorldItemDef): Promise<void> {
  const tint = FELTS[variant ?? 'vinho'] ?? FELTS.vinho!
  const felt = feltTexture(k)
  const cloth = k.assets.own(new THREE.MeshPhysicalMaterial({
    emissive: tint, emissiveMap: lampPool(k), emissiveIntensity: 0.26,
    color: tint, map: felt, bumpMap: felt, bumpScale: 0.35, roughness: 0.94, sheen: 0.3, sheenRoughness: 0.6, sheenColor: new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.25),
  }))
  const [wood, dark, chair] = await Promise.all([
    surface(k.assets, { set: 'wall_wood', tint: '#6b4630', roughness: 0.7, scale: 0.9 }),
    surface(k.assets, { set: 'wall_wood', tint: '#3d281d', roughness: 0.85, scale: 0.9 }),
    k.assets.model('dining_chair_02'),
  ])
  const brass = plain(k.assets, 0xb08d4f, 0.32, 1)

  // The top: a slab, the felt on it, and the rim round the felt.
  k.soft(2 * OUTER - 0.012, 0.04, 2 * OUTER - 0.012, 0.008, dark, 0, TOP_Y - 0.021, 0, 2)
  const bed = k.add(new THREE.Mesh(k.assets.own(new THREE.PlaneGeometry(2 * FELT_HALF + 0.01, 2 * FELT_HALF + 0.01).rotateX(-Math.PI / 2)), cloth), 0, TOP_Y, 0)
  bed.castShadow = false
  bed.name = 'domino:felt'
  const rim = roundedSquare(OUTER, 0.035)
  rim.holes.push(roundedSquare(FELT_HALF, 0.012))
  const bevel = 0.004, thick = 0.036
  const rimG = k.assets.own(new THREE.ExtrudeGeometry(rim, { depth: thick - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 3, curveSegments: 16 }).rotateX(-Math.PI / 2))
  k.add(new THREE.Mesh(rimG, wood), 0, TOP_Y + RIM_TOP - thick + bevel, 0)
  // A brass stud on each corner of the rim.
  const studG = k.assets.own(new THREE.CylinderGeometry(0.007, 0.007, 0.003, 16))
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(new THREE.Mesh(studG, brass), sx * (OUTER - 0.022), TOP_Y + RIM_TOP + 0.001, sz * (OUTER - 0.022)).castShadow = false

  // Apron and legs.
  k.soft(2 * OUTER - 0.14, 0.065, 2 * OUTER - 0.14, 0.008, dark, 0, TOP_Y - 0.041 - 0.0325, 0, 2)
  const legH = TOP_Y - 0.06
  const legG = k.assets.own(new THREE.CylinderGeometry(0.036, 0.021, legH - 0.03, 4).rotateY(Math.PI / 4))
  const footG = k.assets.own(new THREE.CylinderGeometry(0.023, 0.026, 0.03, 4).rotateY(Math.PI / 4))
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.add(new THREE.Mesh(legG, wood), sx * (OUTER - 0.085), 0.03 + (legH - 0.03) / 2, sz * (OUTER - 0.085))
    k.add(new THREE.Mesh(footG, brass), sx * (OUTER - 0.085), 0.015, sz * (OUTER - 0.085))
  }

  // The chairs: the model is made to be sat on a little in front of its middle, facing its own +z.
  for (const [x, z, yaw] of def.seats ?? []) {
    const c = chair.clone()
    c.position.set(x - Math.sin(yaw) * 0.03, 0, z - Math.cos(yaw) * 0.03)
    c.rotation.y = yaw
    k.group.add(c)
  }

  // The lamp over the middle: a dark dome, warm inside. It hangs from above whatever the ceiling is.
  const lamp = new THREE.Group()
  lamp.name = 'domino:lamp'
  const metal = plain(k.assets, 0x111112, 0.42, 0.85, { side: THREE.DoubleSide })
  const shade = new THREE.Mesh(k.assets.own(new THREE.CylinderGeometry(0.06, 0.23, 0.17, 40, 1, true)), metal)
  shade.position.y = LAMP_Y + 0.1
  shade.castShadow = false
  const cap = new THREE.Mesh(k.assets.own(new THREE.CylinderGeometry(0.03, 0.06, 0.03, 24)), metal)
  cap.position.y = LAMP_Y + 0.2
  cap.castShadow = false
  const glowM = k.assets.own(new THREE.MeshBasicMaterial({ color: 0xffe2bd, toneMapped: false }))
  const glow = new THREE.Mesh(k.assets.own(new THREE.CircleGeometry(0.2, 40).rotateX(Math.PI / 2)), glowM)
  glow.position.y = LAMP_Y + 0.04
  const wire = new THREE.Mesh(k.assets.own(new THREE.CylinderGeometry(0.0035, 0.0035, 2, 6)), metal)
  wire.position.y = LAMP_Y + 0.21 + 1
  wire.castShadow = false
  lamp.add(shade, cap, glow, wire)
  k.group.add(lamp)
  piece.glows = [{ material: glowM, base: 2.2 }, { material: cloth, base: 0.26 }]
}
