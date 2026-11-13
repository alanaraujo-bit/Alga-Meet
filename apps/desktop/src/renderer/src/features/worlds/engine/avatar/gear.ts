/**
 * What a figure wears on its head. Each piece is built around the measured head of the body it goes on (its centre and
 * its size), in the figure's own upright frame: +Y up, +Z the way it faces, so the person's left is +X.
 */
import * as THREE from 'three'

export interface HeadBox {
  centre: THREE.Vector3
  /** Width (ear to ear), height and depth (front to back). */
  size: THREE.Vector3
}

interface GearColors {
  accent: THREE.Color
  /** The outfit's top fabric: caps and beanies match it. */
  fabric: THREE.Color
}

const std = (color: THREE.ColorRepresentation, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra })

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m)
  o.position.set(x, y, z)
  o.castShadow = true
  return o
}

function headset(h: HeadBox, c: GearColors): THREE.Group {
  const g = new THREE.Group()
  const dark = std(0x1b1b1d, 0.5, 0.3)
  const accent = std(c.accent, 0.4, 0.2)
  const rx = h.size.x / 2 + 0.012
  const top = h.size.y / 2 + 0.014
  // The band: half an ellipse over the head, from ear to ear.
  const band = new THREE.TorusGeometry(1, 0.011 / rx, 8, 40, Math.PI)
  const b = mesh(band, dark)
  b.scale.set(rx, top + 0.02, rx)
  b.position.y = -0.02
  g.add(b)
  for (const side of [-1, 1]) {
    const cup = mesh(new THREE.CylinderGeometry(0.043, 0.047, 0.03, 28), dark, side * (rx + 0.006), -0.03, 0)
    cup.rotation.z = Math.PI / 2
    g.add(cup)
    const ring = mesh(new THREE.TorusGeometry(0.043, 0.004, 8, 28), accent, side * (rx + 0.022), -0.03, 0)
    ring.rotation.y = Math.PI / 2
    g.add(ring)
  }
  // The microphone: a thin arm from the left cup towards the mouth.
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(rx + 0.005, -0.045, 0.01),
    new THREE.Vector3(rx - 0.005, -0.085, h.size.z * 0.32),
    new THREE.Vector3(rx * 0.45, -0.1, h.size.z * 0.52),
  ])
  g.add(mesh(new THREE.TubeGeometry(curve, 16, 0.004, 6), dark))
  g.add(mesh(new THREE.SphereGeometry(0.011, 10, 8), dark, rx * 0.45, -0.1, h.size.z * 0.52))
  return g
}

function cap(h: HeadBox, c: GearColors): THREE.Group {
  const g = new THREE.Group()
  const fabric = std(c.fabric, 0.9)
  const crown = mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), fabric, 0, 0.012, -0.004)
  crown.scale.set(h.size.x / 2 + 0.012, h.size.y / 2 + 0.006, h.size.z / 2 + 0.012)
  g.add(crown)
  // The brim: a flattened half disc pushed forward and tipped down a little.
  const brim = mesh(new THREE.CylinderGeometry(h.size.x / 2 + 0.004, h.size.x / 2 + 0.004, 0.008, 32, 1, false, -Math.PI / 2, Math.PI), fabric, 0, 0.02, h.size.z * 0.2)
  brim.scale.z = 1.25
  brim.rotation.x = 0.16
  g.add(brim)
  g.add(mesh(new THREE.SphereGeometry(0.009, 8, 6), fabric, 0, h.size.y / 2 + 0.018, -0.004))
  return g
}

function beanie(h: HeadBox, c: GearColors): THREE.Group {
  const g = new THREE.Group()
  const knit = std(c.fabric, 1)
  const dome = mesh(new THREE.SphereGeometry(1, 32, 18, 0, Math.PI * 2, 0, Math.PI * 0.56), knit, 0, 0.0, -0.004)
  dome.scale.set(h.size.x / 2 + 0.016, h.size.y / 2 + 0.03, h.size.z / 2 + 0.016)
  g.add(dome)
  const cuff = mesh(new THREE.TorusGeometry(1, 0.022, 10, 40), std(c.fabric.clone().multiplyScalar(0.86), 1), 0, -0.012, -0.004)
  cuff.rotation.x = Math.PI / 2
  cuff.scale.set(h.size.x / 2 + 0.006, h.size.z / 2 + 0.006, 1)
  g.add(cuff)
  return g
}

function glasses(h: HeadBox, c: GearColors, dark: boolean): THREE.Group {
  const g = new THREE.Group()
  const frame = std(dark ? 0x101011 : c.accent.clone().multiplyScalar(0.5), 0.35, dark ? 0.2 : 0.7)
  const z = h.size.z / 2 * 0.86
  const y = h.size.y * 0.06
  const eye = h.size.x * 0.21
  const r = h.size.x * 0.155
  for (const side of [-1, 1]) {
    g.add(mesh(new THREE.TorusGeometry(r, 0.0038, 8, 28), frame, side * eye, y, z))
    if (dark) g.add(mesh(new THREE.CircleGeometry(r, 24), std(0x0a0a0c, 0.08, 0.6), side * eye, y, z + 0.001))
    // The temple, back to the ear.
    const temple = mesh(new THREE.BoxGeometry(0.004, 0.004, h.size.z * 0.6), frame, side * (h.size.x / 2 + 0.002), y + 0.004, z - h.size.z * 0.3)
    g.add(temple)
    const hinge = mesh(new THREE.BoxGeometry(h.size.x / 2 + 0.004 - eye - r, 0.004, 0.004), frame, side * (eye + r + (h.size.x / 2 + 0.004 - eye - r) / 2), y + 0.004, z)
    g.add(hinge)
  }
  g.add(mesh(new THREE.BoxGeometry(eye * 2 - r * 2, 0.004, 0.004), frame, 0, y + 0.006, z))
  return g
}

function hat(h: HeadBox, c: GearColors): THREE.Group {
  const g = new THREE.Group()
  const felt = std(0x2a2623, 0.95)
  const rx = h.size.x / 2 + 0.01, rz = h.size.z / 2 + 0.01
  const crown = mesh(new THREE.CylinderGeometry(0.86, 1, 0.1, 40), felt, 0, h.size.y / 2 - 0.012, -0.004)
  crown.scale.set(rx, 1, rz)
  g.add(crown)
  const brim = mesh(new THREE.CylinderGeometry(1, 1, 0.008, 48), felt, 0, h.size.y / 2 - 0.06, -0.004)
  brim.scale.set(rx + 0.095, 1, rz + 0.095)
  g.add(brim)
  const ribbon = mesh(new THREE.CylinderGeometry(1.005, 1.012, 0.022, 40, 1, true), std(c.accent, 0.5), 0, h.size.y / 2 - 0.048, -0.004)
  ribbon.scale.set(rx, 1, rz)
  g.add(ribbon)
  return g
}

/** Builds the head piece for a SKU, or null for none (or one this version does not know). */
export function buildGear(sku: string, head: HeadBox, colors: GearColors): THREE.Group | null {
  let g: THREE.Group | null = null
  switch (sku) {
    case 'h_headset': g = headset(head, colors); break
    case 'h_bone': g = cap(head, colors); break
    case 'h_gorro': g = beanie(head, colors); break
    case 'h_oculos': g = glasses(head, colors, false); break
    case 'h_oculos_sol': g = glasses(head, colors, true); break
    case 'h_chapeu': g = hat(head, colors); break
    default: return null
  }
  g.position.copy(head.centre)
  return g
}

/** Frees a head piece (its geometries and materials are its own). */
export function disposeGear(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.geometry.dispose()
    ;(m.material as THREE.Material).dispose()
  })
}
