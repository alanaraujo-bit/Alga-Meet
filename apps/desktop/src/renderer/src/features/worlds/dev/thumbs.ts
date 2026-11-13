/*
 * Dev only: draws the picture of every placeable item of the worlds catalog, with the same loaders and materials the
 * room uses, on a transparent ground. apps/desktop/scripts/worlds-thumbs.mjs opens the lab with ?thumbs=1, calls
 * window.__thumbs() and writes the results to features/worlds/thumbs/<sku>.webp (they ship with the Ateliê screen).
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { STARTER_ROOM, worldEntries } from '@alga/shared'
import { Assets } from '../assets/loaders'
import type { AssetPack } from '../assets/pack'
import { buildItems } from '../engine/items'

export async function renderThumbs(pack: AssetPack, size = 320, only?: string[]): Promise<Record<string, string>> {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(size, size, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.AgXToneMapping
  renderer.toneMappingExposure = 1.25
  renderer.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04)
  scene.environment = env.texture
  scene.environmentIntensity = 0.85
  const key = new THREE.DirectionalLight(0xfff2e2, 2.4)
  key.position.set(2.5, 4.5, 3)
  const rim = new THREE.DirectionalLight(0xbfd0ff, 0.9)
  rim.position.set(-3, 2, -2.5)
  scene.add(key, rim)
  const camera = new THREE.PerspectiveCamera(26, 1, 0.02, 60)
  const assets = new Assets(pack, 1024, 8)
  const out: Record<string, string> = {}
  const box = new THREE.Box3(), part = new THREE.Box3(), centre = new THREE.Vector3(), dims = new THREE.Vector3()
  for (const def of worldEntries('item')) {
    if (only && !only.includes(def.sku)) continue
    const built = await buildItems(assets, {
      shell: 'loft', finish: STARTER_ROOM.finish,
      items: [{ id: 't', sku: def.sku, x: 0, y: 0, z: 0, rot: 0, ...(def.variants ? { variant: def.variants[0]!.id } : {}) }],
    })
    if (built.failed.length) {
      console.warn('[thumbs] skipped', def.sku, built.failed[0]?.[1])
      continue
    }
    scene.add(built.group)
    built.group.updateMatrixWorld(true)
    box.makeEmpty()
    built.group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh || mesh.name === 'contact') return
      mesh.geometry.computeBoundingBox()
      box.union(part.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld))
    })
    box.getCenter(centre)
    box.getSize(dims)
    const dir = def.place === 'wall' ? new THREE.Vector3(0.42, 0.12, 1)
      : def.place === 'rug' ? new THREE.Vector3(0.5, 0.95, 1)
        : def.place === 'ceiling' ? new THREE.Vector3(0.8, -0.12, 1.2)
          : new THREE.Vector3(0.85, 0.5, 1.25)
    dir.normalize()
    const radius = dims.length() / 2
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.02
    camera.position.copy(centre).addScaledVector(dir, dist)
    camera.near = Math.max(0.02, dist - radius * 2)
    camera.far = dist + radius * 3
    camera.updateProjectionMatrix()
    camera.lookAt(centre)
    renderer.render(scene, camera)
    out[def.sku] = canvas.toDataURL('image/webp', 0.9)
    scene.remove(built.group)
  }
  assets.dispose()
  env.dispose()
  pmrem.dispose()
  renderer.dispose()
  renderer.forceContextLoss()
  return out
}
