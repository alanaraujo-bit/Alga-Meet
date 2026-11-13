/**
 * Turns files of the asset pack into three.js objects, once each. The engine clones or shares what comes out of here
 * and calls `dispose()` when the world closes, which frees every geometry and texture this module created.
 */
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import type { AssetPack } from './pack'

export interface TextureSet {
  map: THREE.Texture
  normalMap: THREE.Texture
  /** Ambient occlusion (R), roughness (G), metalness (B). */
  armMap: THREE.Texture
  /** Metres one repeat of the texture covers. */
  tileMeters: number
}

export interface Sky {
  /** Equirectangular picture of the sky, for the dome seen through the windows. */
  image: THREE.Texture
}

export interface BodyAsset {
  /** Template to clone with SkeletonUtils (a skinned mesh per material plus its bones). */
  scene: THREE.Object3D
}

async function bitmap(bytes: ArrayBuffer, type: string, maxSide: number): Promise<ImageBitmap> {
  const blob = new Blob([bytes], { type })
  const full = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const side = Math.max(full.width, full.height)
  if (side <= maxSide) return full
  const k = maxSide / side
  const small = await createImageBitmap(full, { resizeWidth: Math.round(full.width * k), resizeHeight: Math.round(full.height * k), resizeQuality: 'high' })
  full.close()
  return small
}

export class Assets {
  private readonly gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  private readonly models = new Map<string, Promise<THREE.Group>>()
  private readonly sets = new Map<string, Promise<TextureSet>>()
  private readonly skies = new Map<string, Promise<Sky>>()
  private readonly bodies = new Map<string, Promise<BodyAsset>>()
  private clipsPromise: Promise<Map<string, THREE.AnimationClip>> | null = null
  private readonly owned = new Set<{ dispose(): void }>()
  private disposed = false

  constructor(readonly pack: AssetPack, private maxTexture: number, private anisotropy: number) {}

  /** A lower quality tier keeps smaller textures; what is already on the GPU stays as it is until the next room. */
  setTextureBudget(maxTexture: number, anisotropy: number): void {
    this.maxTexture = maxTexture
    this.anisotropy = anisotropy
  }

  /** A furniture model of the pack. The result is a template: clone it (`.clone()` shares geometry and materials). */
  model(id: string): Promise<THREE.Group> {
    let p = this.models.get(id)
    if (!p) {
      p = this.loadModel(id)
      this.models.set(id, p)
      p.catch(() => this.models.delete(id))
    }
    return p
  }

  private async loadModel(id: string): Promise<THREE.Group> {
    const meta = this.pack.manifest.models[id]
    if (!meta) throw new Error(`no model "${id}" in the asset pack`)
    const gltf = await this.parse(await this.pack.file(meta.file))
    const root = gltf.scene
    const cap = this.maxTexture
    const jobs: Promise<void>[] = []
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.owned.add(mesh.geometry)
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        this.owned.add(m)
        const std = m as THREE.MeshStandardMaterial
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const) {
          const t = std[key]
          if (!t || this.owned.has(t)) continue
          this.owned.add(t)
          t.anisotropy = this.anisotropy
          jobs.push(this.shrink(t, cap))
        }
        // Foliage cards: no blending (it would sort badly), a crisp cut-out instead.
        if (std.alphaTest > 0 || std.transparent) {
          std.transparent = false
          std.alphaTest = Math.max(std.alphaTest, 0.4)
          std.side = THREE.DoubleSide
        }
      }
    })
    await Promise.all(jobs)
    return root
  }

  /** Scales a texture that came out of a GLB down to the budget of the current tier. */
  private async shrink(t: THREE.Texture, cap: number): Promise<void> {
    const img = t.image as ImageBitmap | undefined
    if (!img || typeof img.width !== 'number' || !(img instanceof ImageBitmap)) return
    const side = Math.max(img.width, img.height)
    if (side <= cap) return
    const k = cap / side
    const small = await createImageBitmap(img, { resizeWidth: Math.round(img.width * k), resizeHeight: Math.round(img.height * k), resizeQuality: 'high' })
    img.close()
    t.image = small
    t.needsUpdate = true
  }

  /** A tiling PBR set (floors, walls, fabrics). Shared: do not change its repeat, clone the textures to do that. */
  textureSet(id: string): Promise<TextureSet> {
    let p = this.sets.get(id)
    if (!p) {
      p = this.loadSet(id)
      this.sets.set(id, p)
      p.catch(() => this.sets.delete(id))
    }
    return p
  }

  private async loadSet(id: string): Promise<TextureSet> {
    const meta = this.pack.manifest.textures[id]
    if (!meta) throw new Error(`no texture set "${id}" in the asset pack`)
    const make = async (path: string, color: boolean): Promise<THREE.Texture> => {
      const t = new THREE.Texture(await bitmap(await this.pack.file(path), 'image/webp', this.maxTexture))
      t.flipY = false
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
      t.anisotropy = this.anisotropy
      t.needsUpdate = true
      this.owned.add(t)
      return t
    }
    const [map, normalMap, armMap] = await Promise.all([make(meta.color, true), make(meta.normal, false), make(meta.arm, false)])
    return { map, normalMap, armMap, tileMeters: meta.tileMeters }
  }

  sky(id: string): Promise<Sky> {
    let p = this.skies.get(id)
    if (!p) {
      p = (async () => {
        const meta = this.pack.manifest.skies[id]
        if (!meta) throw new Error(`no sky "${id}" in the asset pack`)
        const image = new THREE.Texture(await bitmap(await this.pack.file(meta.image), 'image/webp', 4096))
        image.flipY = false
        image.colorSpace = THREE.SRGBColorSpace
        image.wrapS = THREE.RepeatWrapping
        image.minFilter = THREE.LinearFilter
        image.generateMipmaps = false
        image.needsUpdate = true
        this.owned.add(image)
        return { image }
      })()
      this.skies.set(id, p)
      p.catch(() => this.skies.delete(id))
    }
    return p
  }

  body(id: string): Promise<BodyAsset> {
    let p = this.bodies.get(id)
    if (!p) {
      p = (async () => {
        const file = this.pack.manifest.avatar.bodies[id]
        if (!file) throw new Error(`no body "${id}" in the asset pack`)
        const gltf = await this.parse(await this.pack.file(file))
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.SkinnedMesh
          if (!mesh.isMesh) return
          this.owned.add(mesh.geometry)
          for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) this.owned.add(m)
        })
        return { scene: gltf.scene }
      })()
      this.bodies.set(id, p)
      p.catch(() => this.bodies.delete(id))
    }
    return p
  }

  /** Every animation clip of the mannequin, by id (walk, sit_idle, …). */
  clips(): Promise<Map<string, THREE.AnimationClip>> {
    this.clipsPromise ??= (async () => {
      const gltf = await this.parse(await this.pack.file(this.pack.manifest.avatar.animations))
      return new Map(gltf.animations.map((c) => [c.name, c]))
    })()
    this.clipsPromise.catch(() => { this.clipsPromise = null })
    return this.clipsPromise
  }

  /** For things the engine builds itself (generated furniture, the shell): they are freed with everything else. */
  own<T extends { dispose(): void }>(thing: T): T {
    if (this.disposed) thing.dispose()
    else this.owned.add(thing)
    return thing
  }

  dispose(): void {
    this.disposed = true
    for (const t of this.owned) {
      const img = (t as THREE.Texture).image as unknown
      if (img instanceof ImageBitmap) img.close()
      t.dispose()
    }
    this.owned.clear()
    this.models.clear()
    this.sets.clear()
    this.skies.clear()
    this.bodies.clear()
    this.clipsPromise = null
    this.pack.release()
  }

  private parse(bytes: ArrayBuffer): Promise<GLTF> {
    return this.gltf.parseAsync(bytes, '')
  }
}
