/**
 * Surfaces. Everything in a room is a physically based material lit by the same lights, so a sofa built in code and a
 * scanned armchair sit in the same picture. Tiling texture sets are measured in metres: a surface says how big it is
 * and gets the right repeat, whatever its shape.
 */
import * as THREE from 'three'
import type { Assets, TextureSet } from '../assets/loaders'

export interface SurfaceOptions {
  /** Texture set of the asset pack; when it cannot be loaded the surface is a plain colour (the room still works). */
  set?: string
  /** Multiplies the texture (or is the colour, without one). */
  tint?: THREE.ColorRepresentation
  /** Scales the roughness of the set (1 = as scanned), or is the roughness without a set. */
  roughness?: number
  metalness?: number
  /** Strength of the relief. */
  bump?: number
  /** Size in metres of the surface along U and V, for sets used on a plain UV 0..1 mesh. Omit for meshes mapped in metres. */
  size?: [number, number]
  /** Makes one repeat cover more or fewer metres than the scan (a larger weave reads better from afar). */
  scale?: number
  side?: THREE.Side
}

/** A standard material for a surface, with the set's maps when the pack has them. */
export async function surface(assets: Assets, o: SurfaceOptions): Promise<THREE.MeshStandardMaterial> {
  const set: TextureSet | null = o.set ? await assets.textureSet(o.set).catch(() => null) : null
  const m = assets.own(new THREE.MeshStandardMaterial({
    color: new THREE.Color(o.tint ?? 0xffffff),
    roughness: set ? (o.roughness ?? 1) : (o.roughness ?? 0.8),
    metalness: o.metalness ?? (set ? 1 : 0),
    side: o.side ?? THREE.FrontSide,
  }))
  if (!set) {
    m.metalness = o.metalness ?? 0
    return m
  }
  const tile = set.tileMeters * (o.scale ?? 1)
  const rx = o.size ? o.size[0] / tile : 1 / tile
  const ry = o.size ? o.size[1] / tile : 1 / tile
  const tex = (t: THREE.Texture): THREE.Texture => {
    const c = assets.own(t.clone())
    c.repeat.set(rx, ry)
    c.needsUpdate = true
    return c
  }
  m.map = tex(set.map)
  m.normalMap = tex(set.normalMap)
  const arm = tex(set.armMap)
  m.aoMap = arm
  m.roughnessMap = arm
  m.metalnessMap = arm
  m.normalScale.setScalar(o.bump ?? 1)
  return m
}

/** A plain painted or metal surface. */
export function plain(assets: Assets, color: THREE.ColorRepresentation, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return assets.own(new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }))
}

/**
 * Replaces a mesh's UVs with a box projection in metres: every face is mapped by its two larger axes, so a texture set
 * keeps its real scale on any block-shaped piece (cushions, table tops, rugs) whatever its proportions.
 */
export function boxUv(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal')
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i))
    if (ay >= ax && ay >= az) { uv[i * 2] = x; uv[i * 2 + 1] = z } else if (ax >= az) { uv[i * 2] = z; uv[i * 2 + 1] = y } else { uv[i * 2] = x; uv[i * 2 + 1] = y }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return g
}

/** Colour of a light source from its temperature in kelvin (1500–8000), close enough for lamps. */
export function kelvin(k: number): THREE.Color {
  const t = Math.min(8000, Math.max(1500, k)) / 100
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592)
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace)
}

/** A soft round shadow to lay under something that casts none (people, in the lighter quality tiers). */
export function blobTexture(assets: Assets): THREE.Texture {
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(0,0,0,0.55)')
  g.addColorStop(0.45, 'rgba(0,0,0,0.28)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  const t = assets.own(new THREE.CanvasTexture(c))
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** A band that fades from full to nothing, for washes of light on a wall or ceiling. */
export function fadeTexture(assets: Assets): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 4
  c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 128)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.5)')
  g.addColorStop(0.6, 'rgba(255,255,255,0.14)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 128)
  const t = assets.own(new THREE.CanvasTexture(c))
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const CONTACT = new WeakMap<Assets, { texture: THREE.Texture; geometry: THREE.PlaneGeometry; material: THREE.MeshBasicMaterial }>()

/**
 * The darkening under a piece of furniture where it meets the floor: a soft-edged rectangle the size of its footprint.
 * Real-time lights do not give this for free, and without it furniture floats. One texture and one material for all.
 */
export function contactShadow(assets: Assets, width: number, depth: number): THREE.Mesh {
  let c = CONTACT.get(assets)
  if (!c) {
    const s = 128
    const cv = document.createElement('canvas')
    cv.width = cv.height = s
    const ctx = cv.getContext('2d')!
    ctx.filter = 'blur(13px)'
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.roundRect(30, 30, s - 60, s - 60, 10)
    ctx.fill()
    const texture = assets.own(new THREE.CanvasTexture(cv))
    const material = assets.own(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0.62, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))
    const geometry = assets.own(new THREE.PlaneGeometry(1, 1))
    c = { texture, geometry, material }
    CONTACT.set(assets, c)
  }
  const mesh = new THREE.Mesh(c.geometry, c.material)
  mesh.rotation.x = -Math.PI / 2
  // The soft edge is part of the texture: the plane is larger than the footprint by that margin.
  mesh.scale.set(width * 1.75 + 0.2, depth * 1.75 + 0.2, 1)
  mesh.renderOrder = 1
  mesh.name = 'contact'
  return mesh
}
