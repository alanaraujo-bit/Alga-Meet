/**
 * The finishing of the picture in the highest quality tier only: ambient occlusion (the soft darkening where a sofa
 * meets the floor or a book the shelf), a restrained bloom on what really glows (lamp shades, the line of light, the
 * screen) and smooth edges. It costs roughly as much again as drawing the room, which is why the lighter tiers skip it
 * and the governor turns it off by itself on a machine that is busy with something else.
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

export class PostChain {
  private readonly composer: EffectComposer
  private readonly gtao: GTAOPass
  private readonly bloom: UnrealBloomPass

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    // Colours stay in floating point until the very end, where tone mapping happens once.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 })
    this.composer = new EffectComposer(renderer, target)
    this.composer.addPass(new RenderPass(scene, camera))
    this.gtao = new GTAOPass(scene, camera, size.x, size.y)
    this.gtao.updateGtaoMaterial({ radius: 0.42, distanceExponent: 1.3, thickness: 1.1, scale: 1.15, samples: 12, screenSpaceRadius: false })
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 })
    this.gtao.blendIntensity = 0.85
    this.composer.addPass(this.gtao)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.14, 0.75, 0.92)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
  }

  /** The canvas changed size (or its pixel ratio did). */
  resize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio)
    this.composer.setSize(width, height)
  }

  render(dt: number): void {
    this.composer.render(dt)
  }

  dispose(): void {
    this.gtao.dispose()
    this.bloom.dispose()
    this.composer.dispose()
  }
}
