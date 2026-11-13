/**
 * The architecture of a room: an apartment on a high floor. Three plastered walls, a wall of glass from floor to
 * ceiling on +Z with slim dark frames and linen curtains at its ends, a dropped ceiling border that hides a line of
 * light, a flush door where people arrive, and a balcony outside so the view starts at a railing, not at the ground.
 * Proportions are real (door 2.10 m, railing 1.05 m, baseboard 8 cm): the furniture and the people are too.
 */
import * as THREE from 'three'
import { worldEntry, type WorldRoomFinish, type WorldShell } from '@alga/shared'
import type { Assets } from '../assets/loaders'
import { fadeTexture, plain, surface } from './materials'

export interface ShellBuild {
  group: THREE.Group
  /** Emissive pieces whose glow follows the mood (the line of light of the ceiling, the downlights). */
  glows: { material: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial; base: number }[]
  /** Where the ceiling spots are and what they aim at. */
  spots: { from: THREE.Vector3; to: THREE.Vector3 }[]
  /** The glass wall, for the light that comes through it: centre, width and height. */
  window: { centre: THREE.Vector3; width: number; height: number }
}

const WALL_T = 0.2
const FRAME = 0x17181a

function finish(sku: string, kind: 'floor' | 'wall'): { texture: string; tint: string } {
  const e = worldEntry(sku)
  if (e && e.kind === kind) return { texture: e.texture, tint: e.tint }
  return kind === 'floor' ? { texture: 'floor_oak', tint: '#ffffff' } : { texture: 'wall_plaster', tint: '#efebe3' }
}

export async function buildShell(assets: Assets, shell: WorldShell, f: WorldRoomFinish): Promise<ShellBuild> {
  const { width: W, depth: D, height: H } = shell
  const group = new THREE.Group()
  group.name = 'shell'
  const glows: ShellBuild['glows'] = []
  const add = (mesh: THREE.Mesh, cast = false, receive = true): THREE.Mesh => {
    mesh.castShadow = cast
    mesh.receiveShadow = receive
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    group.add(mesh)
    return mesh
  }
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, cast = false): THREE.Mesh => {
    const mesh = new THREE.Mesh(assets.own(new THREE.BoxGeometry(w, h, d)), m)
    mesh.position.set(x, y, z)
    return add(mesh, cast)
  }

  const floorF = finish(f.floor, 'floor')
  const wallF = finish(f.wall, 'wall')
  const accentF = finish(f.accentWall ?? f.wall, 'wall')
  const wood = wallF.texture === 'wall_wood'

  const [floorM, wallXM, wallZM, accentM, ceilM, balconyM, curtainM] = await Promise.all([
    surface(assets, { set: floorF.texture, tint: floorF.tint, size: [W, D] }),
    surface(assets, { set: wallF.texture, tint: wallF.tint, size: [D, H], bump: wood ? 1 : 0.55 }),
    surface(assets, { set: wallF.texture, tint: wallF.tint, size: [W, H], bump: wood ? 1 : 0.55 }),
    surface(assets, { set: accentF.texture, tint: accentF.tint, size: [D, H], bump: accentF.texture === 'wall_wood' ? 1 : 0.55 }),
    surface(assets, { set: 'wall_plaster', tint: '#f1eee8', size: [W, D], bump: 0.35 }),
    surface(assets, { set: 'floor_concrete', tint: '#b9b7b2', size: [W + 2, 2] }),
    surface(assets, { set: 'fabric_linen', tint: '#e9e3d6', side: THREE.DoubleSide, scale: 0.6 }),
  ])
  const frameM = plain(assets, FRAME, 0.42, 0.7)
  const trimM = plain(assets, new THREE.Color(wallF.tint).lerp(new THREE.Color(0xffffff), 0.25), 0.55)

  // Floor.
  const floor = new THREE.Mesh(assets.own(new THREE.PlaneGeometry(W, D)), floorM)
  floor.rotation.x = -Math.PI / 2
  floor.name = 'floor'
  add(floor)

  // Solid walls: back (-Z), left (-X) and right (+X, the one behind the screen).
  const back = new THREE.Mesh(assets.own(new THREE.PlaneGeometry(W, H)), wallZM)
  back.position.set(0, H / 2, -D / 2)
  add(back)
  const left = new THREE.Mesh(assets.own(new THREE.PlaneGeometry(D, H)), wallXM)
  left.position.set(-W / 2, H / 2, 0)
  left.rotation.y = Math.PI / 2
  add(left)
  const right = new THREE.Mesh(assets.own(new THREE.PlaneGeometry(D, H)), accentM)
  right.position.set(W / 2, H / 2, 0)
  right.rotation.y = -Math.PI / 2
  add(right)
  // Their thickness, seen from the balcony and from above.
  const outerM = plain(assets, 0x2a2a2c, 0.9)
  box(W + WALL_T * 2, H + 0.3, WALL_T, 0, H / 2, -D / 2 - WALL_T / 2 - 0.001, outerM, true)
  box(WALL_T, H + 0.3, D + 2.2, -W / 2 - WALL_T / 2 - 0.001, H / 2, 1.1, outerM, true)
  box(WALL_T, H + 0.3, D + 2.2, W / 2 + WALL_T / 2 + 0.001, H / 2, 1.1, outerM, true)

  // Ceiling, and the slab above it (so the sun does not come in from the top).
  const ceil = new THREE.Mesh(assets.own(new THREE.PlaneGeometry(W, D)), ceilM)
  ceil.rotation.x = Math.PI / 2
  ceil.position.y = H
  add(ceil, false, false)
  box(W + WALL_T * 2, 0.25, D + 2.4, 0, H + 0.13, 1.0, outerM, true)

  // Dropped border along the three solid walls, with a line of light on its inner edge.
  const SOFFIT_W = 0.55, SOFFIT_H = 0.16
  const soffitM = ceilM
  box(W, SOFFIT_H, SOFFIT_W, 0, H - SOFFIT_H / 2, -D / 2 + SOFFIT_W / 2, soffitM)
  box(SOFFIT_W, SOFFIT_H, D - SOFFIT_W, -W / 2 + SOFFIT_W / 2, H - SOFFIT_H / 2, SOFFIT_W / 2, soffitM)
  box(SOFFIT_W, SOFFIT_H, D - SOFFIT_W, W / 2 - SOFFIT_W / 2, H - SOFFIT_H / 2, SOFFIT_W / 2, soffitM)
  const lineM = assets.own(new THREE.MeshBasicMaterial({ color: 0xffd9a8, toneMapped: false }))
  glows.push({ material: lineM, base: 1.6 })
  const line = (w: number, d: number, x: number, z: number) => {
    const mesh = new THREE.Mesh(assets.own(new THREE.BoxGeometry(w, 0.012, d)), lineM)
    mesh.position.set(x, H - SOFFIT_H + 0.02, z)
    add(mesh, false, false)
  }
  line(W - SOFFIT_W * 2, 0.02, 0, -D / 2 + SOFFIT_W + 0.012)
  line(0.02, D - SOFFIT_W - 0.1, -W / 2 + SOFFIT_W + 0.012, SOFFIT_W / 2)
  line(0.02, D - SOFFIT_W - 0.1, W / 2 - SOFFIT_W - 0.012, SOFFIT_W / 2)
  // The wash that line leaves on the ceiling: drawn, not computed.
  const washT = fadeTexture(assets)
  const washM = assets.own(new THREE.MeshBasicMaterial({ map: washT, color: 0xffd3a1, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.22 }))
  glows.push({ material: washM, base: 0.22 })
  const wash = (len: number, x: number, z: number, rotY: number) => {
    const mesh = new THREE.Mesh(assets.own(new THREE.PlaneGeometry(len, 1.5)), washM)
    mesh.rotation.set(Math.PI / 2, 0, rotY, 'YXZ')
    mesh.position.set(x, H - 0.004, z)
    mesh.renderOrder = 2
    add(mesh, false, false)
  }
  wash(W - SOFFIT_W * 2, 0, -D / 2 + SOFFIT_W + 0.75, Math.PI)
  wash(D - SOFFIT_W, -W / 2 + SOFFIT_W + 0.75, SOFFIT_W / 2, -Math.PI / 2)
  wash(D - SOFFIT_W, W / 2 - SOFFIT_W - 0.75, SOFFIT_W / 2, Math.PI / 2)

  // Recessed downlights: a small bright disc each; a few of them are real spots (lighting.ts decides how many).
  const discM = assets.own(new THREE.MeshBasicMaterial({ color: 0xffe2bd, toneMapped: false }))
  glows.push({ material: discM, base: 2.2 })
  const discG = assets.own(new THREE.CircleGeometry(0.045, 20))
  const ringM = plain(assets, 0xdedad2, 0.5)
  const ringG = assets.own(new THREE.RingGeometry(0.045, 0.062, 24))
  const spots: ShellBuild['spots'] = []
  const cols = Math.max(2, Math.round(W / 3.4)), rows = Math.max(2, Math.round(D / 3.2))
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = -W / 2 + SOFFIT_W + 0.9 + (i * (W - SOFFIT_W * 2 - 1.8)) / (cols - 1)
      const z = -D / 2 + SOFFIT_W + 0.9 + (j * (D - SOFFIT_W - 2.3)) / (rows - 1)
      for (const [g, m] of [[discG, discM], [ringG, ringM]] as const) {
        const mesh = new THREE.Mesh(g, m)
        mesh.rotation.x = Math.PI / 2
        mesh.position.set(x, H - 0.003, z)
        add(mesh, false, false)
      }
      spots.push({ from: new THREE.Vector3(x, H - 0.02, z), to: new THREE.Vector3(x, 0, z) })
    }
  }

  // Baseboards.
  const BB = 0.08
  box(W, BB, 0.014, 0, BB / 2, -D / 2 + 0.007, trimM)
  box(0.014, BB, D, -W / 2 + 0.007, BB / 2, 0, trimM)
  box(0.014, BB, D, W / 2 - 0.007, BB / 2, 0, trimM)

  // The door people arrive through, on the back wall next to where they appear.
  const doorX = -W / 2 + 1.35
  const doorM = await surface(assets, { set: 'wall_wood', tint: '#8a6a4c', size: [0.92, 2.1] })
  box(0.92, 2.1, 0.03, doorX, 1.05, -D / 2 + 0.016, doorM)
  box(1.04, 0.06, 0.05, doorX, 2.13, -D / 2 + 0.025, frameM)
  box(0.06, 2.16, 0.05, doorX - 0.49, 1.08, -D / 2 + 0.025, frameM)
  box(0.06, 2.16, 0.05, doorX + 0.49, 1.08, -D / 2 + 0.025, frameM)
  const handle = new THREE.Mesh(assets.own(new THREE.CylinderGeometry(0.009, 0.009, 0.13, 12)), plain(assets, 0xb9a27a, 0.3, 1))
  handle.rotation.z = Math.PI / 2
  handle.position.set(doorX + 0.33, 1.02, -D / 2 + 0.07)
  add(handle)

  // The wall of glass: end piers, slim frames, one pane.
  const zw = D / 2
  const PIER = 0.32
  box(PIER, H, WALL_T, -W / 2 + PIER / 2, H / 2, zw + WALL_T / 2 - 0.02, wallZM, true)
  box(PIER, H, WALL_T, W / 2 - PIER / 2, H / 2, zw + WALL_T / 2 - 0.02, wallZM, true)
  const span = W - PIER * 2
  const bays = Math.max(3, Math.round(span / 1.7))
  const MW = 0.05, MD = 0.09
  for (let i = 0; i <= bays; i++) box(MW, H, MD, -span / 2 + (i * span) / bays, H / 2, zw + 0.03, frameM, true)
  box(span, 0.07, MD, 0, 0.035, zw + 0.03, frameM, true)
  box(span, 0.09, MD, 0, H - 0.045, zw + 0.03, frameM, true)
  box(span, 0.045, MD, 0, 2.38, zw + 0.03, frameM, true)
  const glassM = assets.own(new THREE.MeshStandardMaterial({ color: 0xcfd8e6, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.1, depthWrite: false }))
  const glass = new THREE.Mesh(assets.own(new THREE.PlaneGeometry(span, H)), glassM)
  glass.position.set(0, H / 2, zw + 0.03)
  glass.rotation.y = Math.PI
  glass.renderOrder = 3
  add(glass, false, false)

  // Linen curtains gathered at both ends: a pleated sheet.
  const pleats = (width: number): THREE.BufferGeometry => {
    const g = new THREE.PlaneGeometry(width, H - 0.14, 48, 1)
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i)
      p.setZ(i, Math.sin((x / width) * Math.PI * 11) * 0.045 + Math.sin((x / width) * Math.PI * 5 + 1) * 0.02)
    }
    g.computeVertexNormals()
    // Mapped in metres so the weave does not stretch with the folds.
    const uv = g.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * width * 1.6, uv.getY(i) * (H - 0.14))
    return assets.own(g)
  }
  for (const side of [-1, 1]) {
    const cw = 0.95
    const c = new THREE.Mesh(pleats(cw), curtainM)
    c.position.set(side * (W / 2 - PIER - cw / 2 + 0.12), (H - 0.14) / 2 + 0.02, zw - 0.14)
    add(c, true)
  }
  // The rail they hang from.
  box(span + 0.2, 0.025, 0.025, 0, H - 0.1, zw - 0.14, frameM)

  // Outside: balcony slab, glass balustrade and its rail.
  const BAL = 1.9
  box(W + WALL_T * 2, 0.2, BAL, 0, -0.1, zw + BAL / 2 + 0.08, balconyM, true)
  const railM = plain(assets, FRAME, 0.4, 0.8)
  box(W + WALL_T * 2, 0.045, 0.06, 0, 1.06, zw + BAL, railM, true)
  for (let i = 0; i <= 6; i++) box(0.03, 1.06, 0.03, -W / 2 - WALL_T + ((W + WALL_T * 2) * i) / 6, 0.53, zw + BAL, railM, true)
  const balGlass = new THREE.Mesh(assets.own(new THREE.PlaneGeometry(W + WALL_T * 2, 0.95)), glassM)
  balGlass.position.set(0, 0.52, zw + BAL)
  balGlass.renderOrder = 3
  add(balGlass, false, false)

  return { group, glows, spots, window: { centre: new THREE.Vector3(0, H / 2, zw), width: span, height: H } }
}
