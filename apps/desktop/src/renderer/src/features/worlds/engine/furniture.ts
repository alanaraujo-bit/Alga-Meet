/**
 * Pieces the app builds itself. Contemporary furniture is mostly soft blocks, slabs and thin metal, which is exactly
 * what geometry made in code is good at; what sells it is the fabric, the proportions and the edges. Every piece has
 * its origin on the floor at the centre of its footprint and faces +Z. Wall pieces have their back on z = 0.
 *
 * Upholstery and rugs take a colour variant, so one sofa is five; a new colourway is a line here, not a new asset.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { WorldItemDef } from '@alga/shared'
import type { Assets } from '../assets/loaders'
import { boxUv, kelvin, plain, surface } from './materials'

export interface Piece {
  object: THREE.Object3D
  /** The glass of a screen: the engine puts the shared screen on it. */
  screen?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  /** Parts that glow with the lamps of the room. */
  glows?: { material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial; base: number }[]
}

const FABRIC_TINT: Record<string, string> = { areia: '#d3c8b4', grafite: '#44454b', musgo: '#66735a', terracota: '#b2644a', indigo: '#474c8a' }
const RUG_TINT: Record<string, string> = { marfim: '#e9e2d3', cinza: '#a3a3a1', carvao: '#38393d' }

class Kit {
  readonly group = new THREE.Group()
  constructor(readonly assets: Assets) {}

  /** A block with softened edges, mapped in metres. */
  soft(w: number, h: number, d: number, r: number, m: THREE.Material, x: number, y: number, z: number, seg = 4): THREE.Mesh {
    const g = this.assets.own(boxUv(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001))))
    return this.add(new THREE.Mesh(g, m), x, y, z)
  }

  box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    return this.add(new THREE.Mesh(this.assets.own(boxUv(new THREE.BoxGeometry(w, h, d))), m), x, y, z)
  }

  cyl(rTop: number, rBottom: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 32, open = false): THREE.Mesh {
    return this.add(new THREE.Mesh(this.assets.own(new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open)), m), x, y, z)
  }

  add<T extends THREE.Mesh>(mesh: T, x: number, y: number, z: number): T {
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)
    return mesh
  }
}

async function sofa(k: Kit, variant: string | undefined, width: number, seats: number, chaise: boolean): Promise<void> {
  const D = 0.95
  const tint = FABRIC_TINT[variant ?? 'areia'] ?? FABRIC_TINT.areia!
  const fabric = await surface(k.assets, { set: 'fabric_boucle', tint, scale: 0.55 })
  const dark = plain(k.assets, 0x121213, 0.6, 0.2)
  // With a chaise the run of seats sits at the back of a deeper footprint.
  const zc = chaise ? -(1.75 - D) / 2 : 0
  const runW = chaise ? width - 0.95 : width
  const runX = chaise ? -0.95 / 2 : 0
  const arm = 0.2
  // A recessed plinth: the piece floats a hand above the floor.
  k.box(runW - 0.18, 0.07, D - 0.18, dark, runX, 0.035, zc)
  k.soft(runW, 0.2, D, 0.05, fabric, runX, 0.17, zc)
  k.soft(arm, 0.36, D, 0.075, fabric, runX - runW / 2 + arm / 2, 0.45, zc)
  if (!chaise) k.soft(arm, 0.36, D, 0.075, fabric, runX + runW / 2 - arm / 2, 0.45, zc)
  const inner = runW - arm * (chaise ? 1 : 2)
  const innerX = runX + (chaise ? arm / 2 : 0)
  k.soft(inner + (chaise ? 0.95 : 0), 0.44, 0.22, 0.08, fabric, innerX + (chaise ? 0.95 / 2 : 0), 0.49, zc - D / 2 + 0.11)
  const cw = inner / seats
  for (let i = 0; i < seats; i++) {
    const x = innerX - inner / 2 + cw * (i + 0.5)
    k.soft(cw - 0.014, 0.17, D - 0.27, 0.06, fabric, x, 0.355, zc + 0.115)
    const back = k.soft(cw - 0.03, 0.36, 0.17, 0.075, fabric, x, 0.63, zc - D / 2 + 0.31)
    back.rotation.x = -0.17
  }
  if (chaise) {
    const cx = width / 2 - 0.95 / 2
    k.box(0.95 - 0.18, 0.07, 1.75 - 0.18, dark, cx, 0.035, 0)
    k.soft(0.95, 0.2, 1.75, 0.05, fabric, cx, 0.17, 0)
    k.soft(0.95 - 0.014, 0.17, 1.75 - 0.27, 0.06, fabric, cx, 0.355, 0.115)
    const back = k.soft(0.95 - 0.03, 0.36, 0.17, 0.075, fabric, cx, 0.63, -1.75 / 2 + 0.31)
    back.rotation.x = -0.17
  }
}

async function bed(k: Kit, variant: string | undefined): Promise<void> {
  const tint = FABRIC_TINT[variant ?? 'areia'] ?? FABRIC_TINT.areia!
  const [wood, linen, cover, head] = await Promise.all([
    surface(k.assets, { set: 'wall_wood', tint: '#a88566' }),
    surface(k.assets, { set: 'fabric_linen', tint: '#f3f0ea', scale: 0.7 }),
    surface(k.assets, { set: 'fabric_linen', tint, scale: 0.7 }),
    surface(k.assets, { set: 'fabric_boucle', tint, scale: 0.55 }),
  ])
  const dark = plain(k.assets, 0x121213, 0.6, 0.2)
  k.box(1.7, 0.08, 2.0, dark, 0, 0.04, 0)
  k.soft(1.9, 0.16, 2.2, 0.02, wood, 0, 0.16, 0)
  k.soft(1.7, 0.2, 2.0, 0.07, linen, 0, 0.34, 0.04)
  k.soft(1.76, 0.1, 1.42, 0.05, cover, 0, 0.455, 0.33)
  for (const x of [-0.42, 0.42]) {
    const p = k.soft(0.7, 0.15, 0.42, 0.075, linen, x, 0.5, -0.7)
    p.rotation.x = 0.18
  }
  k.soft(1.9, 0.86, 0.1, 0.04, head, 0, 0.47, -1.05)
}

async function diningTable(k: Kit): Promise<void> {
  const wood = await surface(k.assets, { set: 'floor_oak', tint: '#e7d3b6', scale: 1.4 })
  const steel = plain(k.assets, 0x151516, 0.45, 0.8)
  k.soft(2.2, 0.04, 1.0, 0.012, wood, 0, 0.73, 0, 2)
  for (const x of [-0.82, 0.82]) {
    k.box(0.05, 0.05, 0.82, steel, x, 0.685, 0)
    k.box(0.05, 0.66, 0.05, steel, x, 0.33, -0.385)
    k.box(0.05, 0.66, 0.05, steel, x, 0.33, 0.385)
    k.box(0.05, 0.02, 0.82, steel, x, 0.01, 0)
  }
}

async function floorLamp(k: Kit, piece: Piece): Promise<void> {
  const metal = plain(k.assets, 0x1a1a1b, 0.4, 0.85)
  const linen = await surface(k.assets, { set: 'fabric_linen', tint: '#efe6d4', side: THREE.DoubleSide, scale: 0.5 })
  linen.emissive = kelvin(2700)
  linen.emissiveIntensity = 0.5
  linen.emissiveMap = linen.map
  k.cyl(0.16, 0.17, 0.025, metal, 0, 0.0125, 0, 40)
  k.cyl(0.011, 0.011, 1.34, metal, 0, 0.69, 0, 12)
  const shade = k.cyl(0.19, 0.21, 0.32, linen, 0, 1.5, 0, 48, true)
  shade.castShadow = false
  const bulbM = k.assets.own(new THREE.MeshBasicMaterial({ color: 0xffe6c4, toneMapped: false }))
  const bulb = new THREE.Mesh(k.assets.own(new THREE.SphereGeometry(0.05, 16, 12)), bulbM)
  bulb.position.set(0, 1.48, 0)
  k.group.add(bulb)
  piece.glows = [{ material: linen, base: 0.5 }, { material: bulbM, base: 1.6 }]
}

function linearPendant(k: Kit, piece: Piece): void {
  const metal = plain(k.assets, 0x161617, 0.4, 0.85)
  k.soft(1.6, 0.045, 0.08, 0.01, metal, 0, 0.0225, 0, 2)
  const stripM = k.assets.own(new THREE.MeshBasicMaterial({ color: 0xffe2bd, toneMapped: false }))
  const strip = new THREE.Mesh(k.assets.own(new THREE.PlaneGeometry(1.54, 0.05)), stripM)
  strip.rotation.x = Math.PI / 2
  strip.position.set(0, -0.001, 0)
  k.group.add(strip)
  for (const x of [-0.7, 0.7]) k.cyl(0.003, 0.003, 0.66, metal, x, 0.37, 0, 6).castShadow = false
  piece.glows = [{ material: stripM, base: 2.2 }]
}

async function rug(k: Kit, set: string, tint: string, w: number, d: number, round: boolean): Promise<void> {
  const m = await surface(k.assets, { set, tint, scale: 1.3 })
  if (round) {
    const g = k.assets.own(boxUv(new THREE.CylinderGeometry(w / 2, w / 2, 0.014, 72)))
    const mesh = k.add(new THREE.Mesh(g, m), 0, 0.008, 0)
    mesh.castShadow = false
  } else {
    k.soft(w, 0.016, d, 0.006, m, 0, 0.009, 0, 2).castShadow = false
  }
}

/** A frameless dark slab with the glass a hair in front of it. `sh` is its height. */
function screenSlab(k: Kit, piece: Piece, def: WorldItemDef, w: number, h: number, baseY: number): void {
  const [sw, sh, sy, sz] = def.screen!
  const body = plain(k.assets, 0x0b0b0c, 0.35, 0.6)
  k.soft(w, h, sz - 0.002, 0.008, body, 0, baseY + h / 2, (sz - 0.002) / 2, 2)
  const glass = k.assets.own(new THREE.MeshBasicMaterial({ color: 0x050506, toneMapped: false }))
  const screen = new THREE.Mesh(k.assets.own(new THREE.PlaneGeometry(sw, sh)), glass)
  screen.position.set(0, sy, sz)
  screen.name = 'screen'
  k.group.add(screen)
  piece.screen = screen
}

function tvStand(k: Kit, piece: Piece, def: WorldItemDef): void {
  const metal = plain(k.assets, 0x141415, 0.4, 0.8)
  k.soft(0.62, 0.02, 0.36, 0.008, metal, 0, 0.01, 0.02, 2)
  k.box(0.07, 0.62, 0.035, metal, 0, 0.33, -0.02)
  const [, sh, sy] = def.screen!
  screenSlab(k, piece, def, 1.24, sh + 0.035, sy - (sh + 0.035) / 2)
}

const PALETTES: Record<string, string[]> = {
  mare: ['#e9e4d8', '#1f3a5f', '#3f7f93', '#c9b28a', '#0f1c2e'],
  duna: ['#efe7d6', '#c98e52', '#8a5a3a', '#e0c9a0', '#3a2c22'],
  noturno: ['#14162a', '#2e3258', '#8b8ef7', '#e6e2d6', '#0a0b14'],
  brasa: ['#eee6da', '#b4674b', '#2a2422', '#d9a577', '#6b2f22'],
}

/** A small deterministic generator, so a canvas looks the same on every screen. */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * Paints an abstract composition: a ground, two or three large soft shapes, one thin line and paper grain. Simple on
 * purpose: it has to read as a print someone chose for the wall, from across the room.
 */
function paintCanvas(assets: Assets, variant: string, aspect: number): THREE.Texture {
  const pal = PALETTES[variant] ?? PALETTES.mare!
  const H = 512, W = Math.round(H * aspect)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  const rnd = seeded([...variant].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7))
  ctx.fillStyle = pal[0]!
  ctx.fillRect(0, 0, W, H)
  // A horizon band.
  const hy = H * (0.52 + rnd() * 0.16)
  const band = ctx.createLinearGradient(0, hy - H * 0.3, 0, H)
  band.addColorStop(0, `${pal[0]}00`)
  band.addColorStop(0.45, pal[3]!)
  band.addColorStop(1, pal[1]!)
  ctx.fillStyle = band
  ctx.fillRect(0, hy - H * 0.3, W, H)
  // Large soft shapes.
  ctx.filter = `blur(${Math.round(H * 0.012)}px)`
  const cx = W * (0.3 + rnd() * 0.4), r = H * (0.2 + rnd() * 0.1)
  ctx.fillStyle = pal[2]!
  ctx.beginPath()
  ctx.arc(cx, hy - r * 0.35, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = pal[4]!
  ctx.beginPath()
  ctx.moveTo(0, H)
  ctx.bezierCurveTo(W * 0.25, hy + H * 0.02, W * 0.55, hy + H * 0.3, W, hy + H * 0.08)
  ctx.lineTo(W, H)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 0.85
  ctx.fillStyle = pal[1]!
  ctx.beginPath()
  ctx.ellipse(W * (0.62 + rnd() * 0.2), hy + H * 0.16, W * 0.3, H * 0.09, -0.08, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  // One thin line across.
  ctx.strokeStyle = pal[3]!
  ctx.lineWidth = Math.max(1.5, H * 0.004)
  ctx.beginPath()
  ctx.moveTo(W * 0.08, hy - H * 0.01)
  ctx.lineTo(W * 0.92, hy - H * 0.035)
  ctx.stroke()
  // Paper grain.
  const img = ctx.getImageData(0, 0, W, H)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 16
    img.data[i] = Math.max(0, Math.min(255, img.data[i]! + n))
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + n))
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + n))
  }
  ctx.putImageData(img, 0, 0)
  const t = assets.own(new THREE.CanvasTexture(c))
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function canvasArt(k: Kit, variant: string | undefined, w: number, h: number): void {
  const v = variant ?? 'mare'
  const frame = plain(k.assets, v === 'noturno' ? 0xc8b48c : 0x1a1a1b, 0.45, v === 'noturno' ? 0.9 : 0.4)
  const mat = plain(k.assets, 0xf4f1ea, 0.9)
  const fw = 0.022, depth = 0.035
  k.box(w, fw, depth, frame, 0, fw / 2, depth / 2)
  k.box(w, fw, depth, frame, 0, h - fw / 2, depth / 2)
  k.box(fw, h - fw * 2, depth, frame, -w / 2 + fw / 2, h / 2, depth / 2)
  k.box(fw, h - fw * 2, depth, frame, w / 2 - fw / 2, h / 2, depth / 2)
  k.box(w - fw * 2, h - fw * 2, 0.012, mat, 0, h / 2, 0.008).castShadow = false
  const margin = Math.min(w, h) * 0.09
  const aw = w - fw * 2 - margin * 2, ah = h - fw * 2 - margin * 2
  const art = new THREE.Mesh(
    k.assets.own(new THREE.PlaneGeometry(aw, ah)),
    k.assets.own(new THREE.MeshStandardMaterial({ map: paintCanvas(k.assets, v, aw / ah), roughness: 0.92 })),
  )
  art.position.set(0, h / 2, 0.0155)
  art.receiveShadow = true
  k.group.add(art)
}

/** Builds a generated piece. Throws for an id this version of the app does not know. */
export async function buildPiece(assets: Assets, def: WorldItemDef, id: string, variant: string | undefined): Promise<Piece> {
  const k = new Kit(assets)
  const piece: Piece = { object: k.group }
  switch (id) {
    case 'sofa_2': await sofa(k, variant, def.size[0], 2, false); break
    case 'sofa_3': await sofa(k, variant, def.size[0], 3, false); break
    case 'sofa_corner': await sofa(k, variant, def.size[0], 3, true); break
    case 'bed': await bed(k, variant); break
    case 'dining_table': await diningTable(k); break
    case 'floor_lamp': await floorLamp(k, piece); break
    case 'linear_pendant': linearPendant(k, piece); break
    case 'rug_wool': await rug(k, 'rug_wool', RUG_TINT[variant ?? 'marfim'] ?? RUG_TINT.marfim!, def.size[0], def.size[2], false); break
    case 'rug_wool_large': await rug(k, 'rug_wool', RUG_TINT[variant ?? 'marfim'] ?? RUG_TINT.marfim!, def.size[0], def.size[2], false); break
    case 'rug_jute': await rug(k, 'rug_jute', '#d8c7a4', def.size[0], def.size[2], true); break
    case 'tv_wall': screenSlab(k, piece, def, def.size[0], def.size[1], 0); break
    case 'tv_cinema': screenSlab(k, piece, def, def.size[0], def.size[1], 0); break
    case 'tv_stand': tvStand(k, piece, def); break
    case 'canvas': canvasArt(k, variant, def.size[0], def.size[1]); break
    case 'canvas_large': canvasArt(k, variant, def.size[0], def.size[1]); break
    default: throw new Error(`unknown generated piece "${id}"`)
  }
  return piece
}
