/**
 * The sixteen balls and the cue. Balls are polished phenolic: a painted sphere under a clear coat, so they pick up the
 * lamp and the room. The cue ball carries six red dots like a training ball, which is what lets you see its spin.
 */
import * as THREE from 'three'
import { POOL_BALL_R } from '@alga/shared'
import type { Assets } from '../assets/loaders'

/** Paint of each number (9-15 wear the colour of 1-7 as a stripe). */
const PAINT = ['#f3efe2', '#f1bf12', '#1c49b8', '#cf2a1e', '#5a2a8a', '#ee7616', '#12733f', '#7c2222', '#0e0e0f']
const IVORY = '#f3efe2'
export const ballColour = (n: number): string => PAINT[n === 0 ? 0 : n === 8 ? 8 : ((n - 1) % 8) + 1]!

function ballTexture(assets: Assets, n: number): THREE.Texture {
  const W = 512, H = 256
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  const paint = ballColour(n)
  ctx.fillStyle = n > 8 ? IVORY : paint
  ctx.fillRect(0, 0, W, H)
  if (n === 0) {
    // Dots on the six axes; the two at the poles are bands across the top and bottom of the map.
    ctx.fillStyle = '#c8231c'
    for (const x of [0, W / 4, W / 2, (3 * W) / 4, W]) {
      ctx.beginPath()
      ctx.arc(x, H / 2, 11, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillRect(0, 0, W, 11)
    ctx.fillRect(0, H - 11, W, 11)
  } else {
    if (n > 8) {
      ctx.fillStyle = paint
      ctx.fillRect(0, H * 0.27, W, H * 0.46)
    }
    for (const x of [W / 4, (3 * W) / 4]) {
      ctx.fillStyle = IVORY
      ctx.beginPath()
      ctx.arc(x, H / 2, 31, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#111112'
      ctx.font = `700 ${n > 9 ? 34 : 40}px "Inter Variable", Inter, Arial, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(n), x, H / 2 + 2)
      // 6 and 9 are told apart by a bar under the digit.
      if (n === 6 || n === 9) ctx.fillRect(x - 10, H / 2 + 19, 20, 3)
    }
  }
  const t = assets.own(new THREE.CanvasTexture(c))
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

export function buildBalls(assets: Assets): THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhysicalMaterial>[] {
  const g = assets.own(new THREE.SphereGeometry(POOL_BALL_R, 40, 28))
  return Array.from({ length: 16 }, (_, n) => {
    const m = assets.own(new THREE.MeshPhysicalMaterial({ map: ballTexture(assets, n), roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.25 }))
    const mesh = new THREE.Mesh(g, m)
    mesh.name = `pool:ball:${n}`
    mesh.receiveShadow = true
    return mesh
  })
}

export const CUE_LENGTH = 1.47
const TIP_R = 0.0064
const BUTT_R = 0.0145

/**
 * A two-piece cue with its tip at the origin and the butt down -z: leather tip, white ferrule, maple shaft, a dark
 * forearm with a ring of the player's colour, linen wrap and a rubber bumper.
 */
export function buildCue(assets: Assets, accent: THREE.ColorRepresentation): THREE.Group {
  const cue = new THREE.Group()
  cue.name = 'pool:cue'
  const radius = (at: number): number => TIP_R + (BUTT_R - TIP_R) * (at / CUE_LENGTH)
  const part = (from: number, to: number, material: THREE.Material): void => {
    const g = assets.own(new THREE.CylinderGeometry(radius(from), radius(to), to - from, 20).rotateX(Math.PI / 2))
    const m = new THREE.Mesh(g, material)
    m.position.z = -(from + to) / 2
    m.castShadow = true
    cue.add(m)
  }
  const mat = (color: THREE.ColorRepresentation, roughness: number, metalness = 0): THREE.MeshStandardMaterial => assets.own(new THREE.MeshStandardMaterial({ color, roughness, metalness }))
  part(0, 0.007, mat(0x3b6fb3, 0.95))
  part(0.007, 0.03, mat(0xf2efe6, 0.35))
  part(0.03, 0.74, mat(0xdcc08f, 0.42))
  part(0.74, 0.752, mat(0xb08d4f, 0.3, 1))
  part(0.752, 1.02, mat(0x2a1a12, 0.38))
  part(1.02, 1.035, mat(accent, 0.4))
  part(1.035, 1.36, mat(0x17171a, 0.85))
  part(1.36, 1.375, mat(accent, 0.4))
  part(1.375, 1.45, mat(0x2a1a12, 0.38))
  part(1.45, CUE_LENGTH, mat(0x0c0c0d, 0.9))
  return cue
}

/** Radius of the cue at a distance from its tip. */
export const cueRadius = (at: number): number => TIP_R + (BUTT_R - TIP_R) * Math.min(1, Math.max(0, at / CUE_LENGTH))
