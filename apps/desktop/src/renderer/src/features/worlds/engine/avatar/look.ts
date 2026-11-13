/**
 * How a figure looks: an articulated atelier mannequin. One sculpted body (two silhouettes), finished like an object
 * (porcelain, clay, graphite, bronze), with joints in the person's own colour. Clothes are not extra meshes: an outfit
 * says which parts of the body are fabric (torso and upper arms for a T-shirt, down to the ankle for trousers) and the
 * seams fall on the joints the body already has. Everything is drawn by one material per figure.
 */
import * as THREE from 'three'
import { WORLD_FABRICS, type WorldAvatar } from '@alga/shared'

/** Parts of the body a vertex can belong to (by the bone that moves it most). */
export const REGIONS = ['head', 'torso', 'upperArm', 'forearm', 'hand', 'hips', 'thigh', 'shin', 'foot'] as const
export type Region = (typeof REGIONS)[number]

export function regionOfBone(name: string): Region {
  const n = name.toLowerCase()
  if (n === 'head' || n.startsWith('neck')) return 'head'
  if (n.startsWith('spine') || n.startsWith('clavicle')) return 'torso'
  if (n.startsWith('upperarm')) return 'upperArm'
  if (n.startsWith('lowerarm')) return 'forearm'
  if (n.startsWith('hand') || /^(index|middle|ring|pinky|thumb)/.test(n)) return 'hand'
  if (n === 'pelvis' || n === 'root') return 'hips'
  if (n.startsWith('thigh')) return 'thigh'
  if (n.startsWith('calf')) return 'shin'
  if (n.startsWith('foot') || n.startsWith('ball')) return 'foot'
  return 'torso'
}

/** What covers a region: the body's own finish, or one of the outfit's three fabrics. */
const SKIN = 0, TOP = 1, BOTTOM = 2, SHOES = 3
type Slot = typeof SKIN | typeof TOP | typeof BOTTOM | typeof SHOES

interface Outfit {
  cover: Partial<Record<Region, Slot>>
  /** Roughness of the fabric, and how much it darkens (velvet drinks light, satin gives it back). */
  roughness: number
  shade: number
}
const TEE: Outfit['cover'] = { torso: TOP, upperArm: TOP }
const LONG: Outfit['cover'] = { ...TEE, forearm: TOP }
const TROUSERS: Outfit['cover'] = { hips: BOTTOM, thigh: BOTTOM, shin: BOTTOM, foot: SHOES }
const OUTFITS: Record<string, Outfit> = {
  o_nenhum: { cover: {}, roughness: 0.9, shade: 1 },
  o_basico: { cover: { ...TEE, ...TROUSERS }, roughness: 0.92, shade: 1 },
  o_manga: { cover: { ...LONG, ...TROUSERS }, roughness: 0.92, shade: 1 },
  o_verao: { cover: { ...TEE, hips: BOTTOM, thigh: BOTTOM, foot: SHOES }, roughness: 0.92, shade: 1 },
  o_macacao: { cover: { ...LONG, hips: TOP, thigh: TOP, shin: TOP, foot: SHOES }, roughness: 0.88, shade: 1 },
  o_alfaiataria: { cover: { ...LONG, ...TROUSERS }, roughness: 0.4, shade: 0.92 },
  o_veludo: { cover: { ...LONG, ...TROUSERS }, roughness: 1, shade: 0.72 },
}

interface Finish {
  color: string
  roughness: number
  metalness: number
}
const FINISHES: Record<string, Finish> = {
  a_porcelana: { color: '#ece7de', roughness: 0.3, metalness: 0 },
  a_areia: { color: '#cbbba3', roughness: 0.52, metalness: 0 },
  a_argila: { color: '#b46d4f', roughness: 0.62, metalness: 0 },
  a_grafite: { color: '#3b3c41', roughness: 0.46, metalness: 0.1 },
  a_bronze: { color: '#a8743f', roughness: 0.34, metalness: 1 },
  a_obsidiana: { color: '#0e0e10', roughness: 0.07, metalness: 0.25 },
  a_perola: { color: '#f3ece6', roughness: 0.16, metalness: 0.35 },
}

/** The four surfaces of a figure, ready for the shader: [skin, top, bottom, shoes]. */
export interface LookUniforms {
  colors: THREE.Color[]
  roughness: number[]
  metalness: number[]
  /** Slot of each region, in REGIONS order. */
  regionSlot: number[]
  accent: THREE.Color
}

export function lookOf(a: WorldAvatar): LookUniforms {
  const fin = FINISHES[a.finish] ?? FINISHES.a_porcelana!
  const outfit = OUTFITS[a.outfit] ?? OUTFITS.o_basico!
  const fabric = (i: number) => new THREE.Color(WORLD_FABRICS[i] ?? WORLD_FABRICS[0]).multiplyScalar(outfit.shade)
  return {
    colors: [new THREE.Color(fin.color), fabric(a.top), fabric(a.bottom), fabric(a.shoes)],
    roughness: [fin.roughness, outfit.roughness, outfit.roughness, Math.min(0.7, outfit.roughness)],
    metalness: [fin.metalness, 0, 0, 0],
    regionSlot: REGIONS.map((r) => outfit.cover[r] ?? SKIN),
    accent: new THREE.Color(a.accent),
  }
}

/** Edges sharper than this stay sharp (the panel lines of the sculpt); everything softer is smoothed. */
const CREASE_COS = Math.cos((62 * Math.PI) / 180)

/**
 * Prepares a body mesh of the pack for drawing, once: smooths its shading (the source is modelled with faceted
 * normals) and, for the body surface, says which part of the body each triangle belongs to. The sculpt is made of
 * separate panels with the joints between them, so a panel is one connected piece: it gets the part most of its
 * vertices move with, and the edge of a sleeve or a trouser leg always falls on a joint, never across a surface.
 * Returns a new geometry (the source is disposed).
 */
export function prepareBody(source: THREE.BufferGeometry, skeleton: THREE.Skeleton, regions: boolean): THREE.BufferGeometry {
  const g = source.index ? source.toNonIndexed() : source.clone()
  source.dispose()
  const pos = g.getAttribute('position')
  const idx = g.getAttribute('skinIndex')
  const wgt = g.getAttribute('skinWeight')
  const n = pos.count
  // Vertices at the same place are one point of the surface.
  const weld = new Int32Array(n)
  const seen = new Map<string, number>()
  let points = 0
  for (let i = 0; i < n; i++) {
    const key = [Math.round(pos.getX(i) * 20000), Math.round(pos.getY(i) * 20000), Math.round(pos.getZ(i) * 20000)].join(',')
    let p = seen.get(key)
    if (p === undefined) {
      p = points++
      seen.set(key, p)
    }
    weld[i] = p
  }
  const tris = n / 3
  const faceN = new Float32Array(tris * 3)
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const facesOf: number[][] = Array.from({ length: points }, () => [])
  for (let t = 0; t < tris; t++) {
    a.fromBufferAttribute(pos, t * 3)
    b.fromBufferAttribute(pos, t * 3 + 1).sub(a)
    c.fromBufferAttribute(pos, t * 3 + 2).sub(a)
    // Not normalised: larger faces weigh more in the average.
    b.cross(c)
    faceN[t * 3] = b.x
    faceN[t * 3 + 1] = b.y
    faceN[t * 3 + 2] = b.z
    for (let k = 0; k < 3; k++) facesOf[weld[t * 3 + k]!]!.push(t)
  }
  const normals = new Float32Array(n * 3)
  for (let t = 0; t < tris; t++) {
    const nx = faceN[t * 3]!, ny = faceN[t * 3 + 1]!, nz = faceN[t * 3 + 2]!
    const nl = Math.hypot(nx, ny, nz) || 1
    for (let k = 0; k < 3; k++) {
      let sx = 0, sy = 0, sz = 0
      for (const f of facesOf[weld[t * 3 + k]!]!) {
        const fx = faceN[f * 3]!, fy = faceN[f * 3 + 1]!, fz = faceN[f * 3 + 2]!
        const fl = Math.hypot(fx, fy, fz) || 1
        if ((fx * nx + fy * ny + fz * nz) / (fl * nl) >= CREASE_COS) {
          sx += fx
          sy += fy
          sz += fz
        }
      }
      const sl = Math.hypot(sx, sy, sz) || 1
      const o = (t * 3 + k) * 3
      normals[o] = sx / sl
      normals[o + 1] = sy / sl
      normals[o + 2] = sz / sl
    }
  }
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  if (!regions) return g

  // Panels: connected pieces of the surface.
  const parent = new Int32Array(points)
  for (let i = 0; i < points; i++) parent[i] = i
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!
      x = parent[x]!
    }
    return x
  }
  for (let t = 0; t < tris; t++) {
    const r0 = find(weld[t * 3]!)
    for (let k = 1; k < 3; k++) {
      const r = find(weld[t * 3 + k]!)
      if (r !== r0) parent[r] = r0
    }
  }
  const regionOf = skeleton.bones.map((bone) => REGIONS.indexOf(regionOfBone(bone.name)))
  const votes = new Map<number, Float32Array>()
  for (let i = 0; i < n; i++) {
    let best = 0, bw = -1
    for (let k = 0; k < 4; k++) {
      const w = wgt.getComponent(i, k)
      if (w > bw) {
        bw = w
        best = idx.getComponent(i, k)
      }
    }
    const root = find(weld[i]!)
    let v = votes.get(root)
    if (!v) {
      v = new Float32Array(REGIONS.length)
      votes.set(root, v)
    }
    v[regionOf[best] ?? 1]! += 1
  }
  const panel = new Map<number, number>()
  for (const [root, v] of votes) {
    let best = 0
    for (let r = 1; r < v.length; r++) if (v[r]! > v[best]!) best = r
    panel.set(root, best)
  }
  // A sculpt also has small loose pieces (a seam, a detail on the chest) that happen to move with a neighbouring bone.
  // Left alone they would be a patch of trousers on a shirt: each takes the part of the large panel nearest to it.
  const stat = new Map<number, { n: number; x: number; y: number; z: number }>()
  for (let i = 0; i < n; i++) {
    const root = find(weld[i]!)
    let s = stat.get(root)
    if (!s) {
      s = { n: 0, x: 0, y: 0, z: 0 }
      stat.set(root, s)
    }
    s.n++
    s.x += pos.getX(i)
    s.y += pos.getY(i)
    s.z += pos.getZ(i)
  }
  for (const s of stat.values()) {
    s.x /= s.n
    s.y /= s.n
    s.z /= s.n
  }
  const large = [...stat].filter(([, s]) => s.n >= n * 0.02)
  for (const [root, s] of stat) {
    if (s.n >= n * 0.02 || !large.length) continue
    let near = large[0]![0], best = Infinity
    for (const [r, l] of large) {
      const d = (l.x - s.x) ** 2 + (l.y - s.y) ** 2 + (l.z - s.z) ** 2
      if (d < best) {
        best = d
        near = r
      }
    }
    panel.set(root, panel.get(near) ?? 1)
  }
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = panel.get(find(weld[i]!)) ?? 1
  g.setAttribute('aRegion', new THREE.BufferAttribute(out, 1))
  return g
}

/**
 * The material of the body: a standard material whose colour, roughness and metalness come from the region of each
 * triangle. All figures share one compiled program; each has its own uniforms.
 */
export function bodyMaterial(look: LookUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1 })
  const uniforms = {
    uSlotColor: { value: look.colors },
    uSlotRough: { value: look.roughness },
    uSlotMetal: { value: look.metalness },
    uRegionSlot: { value: look.regionSlot },
  }
  m.userData.look = uniforms
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRegion;\nflat varying float vRegion;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = aRegion;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nflat varying float vRegion;\nuniform vec3 uSlotColor[4];\nuniform float uSlotRough[4];\nuniform float uSlotMetal[4];\nuniform float uRegionSlot[9];')
      .replace('#include <color_fragment>', '#include <color_fragment>\nint aSlot = int(uRegionSlot[int(vRegion + 0.5)] + 0.5);\ndiffuseColor.rgb = uSlotColor[aSlot];')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = uSlotRough[aSlot];')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = uSlotMetal[aSlot];')
  }
  m.customProgramCacheKey = () => 'alga-world-body'
  return m
}

export function applyLook(m: THREE.MeshStandardMaterial, look: LookUniforms): void {
  const u = m.userData.look as { uSlotColor: { value: THREE.Color[] }; uSlotRough: { value: number[] }; uSlotMetal: { value: number[] }; uRegionSlot: { value: number[] } }
  u.uSlotColor.value = look.colors
  u.uSlotRough.value = look.roughness
  u.uSlotMetal.value = look.metalness
  u.uRegionSlot.value = look.regionSlot
}

export function jointsMaterial(look: LookUniforms): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: look.accent.clone(), roughness: 0.42, metalness: 0.15 })
}
