/**
 * The tiles: thick two-tone resin, an ivory face with engraved black pips and a brass pin in the middle, a dark back.
 * One geometry for all, one material each: a tile's whole skin (face, sides, back) is one small canvas, so a tile is a
 * single draw call and showing another face is swapping the texture.
 *
 * A tile's own frame: long axis x (the lower number on the -x half), the face looks up +y.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { DOMINO_TILES } from '@alga/shared'
import type { Assets } from '../assets/loaders'
import { TILE_L, TILE_T, TILE_W } from './layout'

const IVORY = '#f3eee1'
const BACK = '#17181d'
const PIP = '#141518'

/** Where the pips of each number sit on a half, on a 3 x 3 grid (-1, 0, 1). */
const PIPS: readonly (readonly [number, number])[][] = [
  [],
  [[0, 0]],
  [[-1, -1], [1, 1]],
  [[-1, -1], [0, 0], [1, 1]],
  [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
]

/**
 * The skin of a tile: the top half of the canvas is the face (the lower number on the left), the bottom half is the
 * plain colour of the sides (left) and of the back (right). `tile` null: a face with nothing on it, for a tile whose
 * numbers this app was never told.
 */
function skin(assets: Assets, tile: number | null): THREE.Texture {
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const ctx = c.getContext('2d')!
  ctx.fillStyle = IVORY
  ctx.fillRect(0, 0, S, S)
  ctx.fillStyle = BACK
  ctx.fillRect(S / 2, S / 2, S / 2, S / 2)
  // A face is never quite flat white: a little warmer towards the edges.
  const shade = ctx.createRadialGradient(S / 2, S / 4, 10, S / 2, S / 4, S * 0.62)
  shade.addColorStop(0, 'rgba(255,255,255,0.0)')
  shade.addColorStop(1, 'rgba(150,120,70,0.16)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, S, S / 2)
  // The groove across the middle and the brass pin on it.
  ctx.fillStyle = 'rgba(40,34,26,0.75)'
  ctx.fillRect(S / 2 - 1.5, 16, 3, S / 2 - 32)
  const pin = ctx.createRadialGradient(S / 2 - 2, S / 4 - 2, 1, S / 2, S / 4, 8)
  pin.addColorStop(0, '#f6e3a8')
  pin.addColorStop(0.6, '#b98f3f')
  pin.addColorStop(1, '#6f5320')
  ctx.fillStyle = pin
  ctx.beginPath()
  ctx.arc(S / 2, S / 4, 7.5, 0, Math.PI * 2)
  ctx.fill()
  if (tile !== null) {
    const [a, b] = DOMINO_TILES[tile]!
    const half = (n: number, cx: number): void => {
      for (const [gx, gy] of PIPS[n]!) {
        const x = cx + gx * 33, y = S / 4 + gy * 33
        // Drilled into the resin: darker at the top edge of the hole, a glint at the bottom.
        ctx.fillStyle = 'rgba(255,255,255,0.55)'
        ctx.beginPath()
        ctx.arc(x, y + 1.6, 12.5, 0, Math.PI * 2)
        ctx.fill()
        const g = ctx.createRadialGradient(x, y + 3, 2, x, y, 12.5)
        g.addColorStop(0, '#2b2d33')
        g.addColorStop(1, PIP)
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(x, y, 12.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    half(a, S / 4)
    half(b, (3 * S) / 4)
  }
  const t = assets.own(new THREE.CanvasTexture(c))
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** The one geometry: a block with soft edges whose top face reads the top half of the skin. */
function tileGeometry(assets: Assets): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(TILE_L, TILE_T, TILE_W, 3, 0.0024)
  const pos = g.getAttribute('position'), uv = g.getAttribute('uv')
  // The addon lists the six faces one after the other: +x, -x, +y, -y, +z, -z.
  const perFace = pos.count / 6
  for (let i = 0; i < pos.count; i++) {
    const face = Math.floor(i / perFace)
    if (face === 2) uv.setXY(i, pos.getX(i) / TILE_L + 0.5, 0.75 - (pos.getZ(i) / TILE_W) * 0.5)
    else if (face === 3) uv.setXY(i, 0.75, 0.25)
    else uv.setXY(i, 0.25, 0.25)
  }
  uv.needsUpdate = true
  return assets.own(g)
}

export type TileMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>

/** Makes tiles and the faces they can show. */
export class TileSet {
  private readonly geometry: THREE.BufferGeometry
  private readonly faces = new Map<number | null, THREE.Texture>()

  constructor(private readonly assets: Assets) {
    this.geometry = tileGeometry(assets)
  }

  face(tile: number | null): THREE.Texture {
    let t = this.faces.get(tile)
    if (!t) {
      t = skin(this.assets, tile)
      this.faces.set(tile, t)
    }
    return t
  }

  /** A tile showing no numbers. */
  make(): TileMesh {
    const material = this.assets.own(new THREE.MeshPhysicalMaterial({
      map: this.face(null), roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.18, emissive: 0xffffff, emissiveMap: this.face(null), emissiveIntensity: 0,
    }))
    const mesh = new THREE.Mesh(this.geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }

  /** Shows the numbers of `tile` on a tile made here (null: none). */
  show(mesh: TileMesh, tile: number | null): void {
    const t = this.face(tile)
    mesh.material.map = t
    mesh.material.emissiveMap = t
  }
}
