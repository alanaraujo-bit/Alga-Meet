/**
 * The screens of a room. They show one video: someone's screen share, decoded by the call exactly as on the regular
 * call stage (this file only draws the frames it is handed; it starts and stops nothing). The picture keeps its shape
 * inside the frame, is never tone-mapped (a shared screen must look like the screen it came from) and throws a little
 * of its colour on the room, the way a television does in the evening.
 */
import * as THREE from 'three'
import { LIVE_LAYER } from './lighting'

type ScreenMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>

const OFF = 0x050506
const SAMPLE_EVERY_S = 0.4

export class ScreenSurface {
  private screens: ScreenMesh[] = []
  private video: HTMLVideoElement | null = null
  private texture: THREE.VideoTexture | null = null
  private readonly glow = new THREE.PointLight(0xffffff, 0, 6, 1.6)
  private readonly sampler = document.createElement('canvas')
  private readonly ctx: CanvasRenderingContext2D | null
  private since = 0
  private readonly target = new THREE.Color(0, 0, 0)
  private aspect = 0

  constructor(private readonly scene: THREE.Scene) {
    this.sampler.width = 16
    this.sampler.height = 9
    this.ctx = this.sampler.getContext('2d', { willReadFrequently: true })
    this.glow.layers.enable(LIVE_LAYER)
    this.glow.visible = false
    scene.add(this.glow)
  }

  /** The glass meshes of the room that just was built. */
  setScreens(screens: ScreenMesh[]): void {
    this.screens = screens
    this.aspect = 0
    this.apply()
    const first = screens[0]
    if (first) {
      first.updateWorldMatrix(true, false)
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(first.getWorldQuaternion(new THREE.Quaternion()))
      this.glow.position.copy(first.getWorldPosition(new THREE.Vector3())).addScaledVector(normal, 0.7)
    }
  }

  setSource(video: HTMLVideoElement | null): void {
    if (video === this.video) return
    this.texture?.dispose()
    this.texture = null
    this.video = video
    if (video) {
      this.texture = new THREE.VideoTexture(video)
      this.texture.colorSpace = THREE.SRGBColorSpace
      this.texture.generateMipmaps = false
      this.texture.minFilter = THREE.LinearFilter
    }
    this.aspect = 0
    this.apply()
  }

  /** The screen people look at when they ask to watch: the largest one. */
  primary(): ScreenMesh | null {
    let best: ScreenMesh | null = null
    for (const s of this.screens) if (!best || s.geometry.parameters.width > best.geometry.parameters.width) best = s
    return best
  }

  get live(): boolean {
    return !!this.video && this.video.readyState >= 2 && this.video.videoWidth > 0
  }

  private apply(): void {
    for (const s of this.screens) {
      s.material.map = this.texture
      s.material.color.set(this.texture ? 0xffffff : OFF)
      s.material.needsUpdate = true
      if (!this.texture) s.scale.set(1, 1, 1)
    }
  }

  update(dt: number): void {
    const v = this.video
    const live = this.live
    if (v && live) {
      // Keep the shape of what is shared inside the 16:9 glass.
      const a = v.videoWidth / v.videoHeight
      if (Math.abs(a - this.aspect) > 0.001) {
        this.aspect = a
        for (const s of this.screens) {
          const frame = s.geometry.parameters.width / s.geometry.parameters.height
          if (a >= frame) s.scale.set(1, frame / a, 1)
          else s.scale.set(a / frame, 1, 1)
        }
      }
      this.since += dt
      if (this.since >= SAMPLE_EVERY_S && this.ctx && this.screens.length) {
        this.since = 0
        try {
          this.ctx.drawImage(v, 0, 0, 16, 9)
          const d = this.ctx.getImageData(0, 0, 16, 9).data
          let r = 0, g = 0, b = 0
          for (let i = 0; i < d.length; i += 4) { r += d[i]!; g += d[i + 1]!; b += d[i + 2]! }
          const n = d.length / 4
          this.target.setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace)
        } catch {
          // A frame that cannot be read (protected content) just leaves the glow as it was.
        }
      }
    } else {
      this.target.setRGB(0, 0, 0)
    }
    const k = 1 - Math.exp(-dt * 3)
    this.glow.color.lerp(this.target, k)
    const lum = this.glow.color.r * 0.2126 + this.glow.color.g * 0.7152 + this.glow.color.b * 0.0722
    this.glow.intensity = this.screens.length ? 5 * Math.min(1, lum * 1.6 + 0.02) : 0
    this.glow.visible = this.glow.intensity > 0.05 && this.screens.length > 0 && !!this.video
  }

  dispose(): void {
    this.texture?.dispose()
    this.scene.remove(this.glow)
    this.glow.dispose()
    this.screens = []
    this.video = null
  }
}
