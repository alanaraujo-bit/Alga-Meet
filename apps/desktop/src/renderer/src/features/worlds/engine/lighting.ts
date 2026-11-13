/**
 * Light. A mood is a time of day: which sky is outside, how much of it comes in through the glass, whether there is a
 * sun, and how strongly the lamps of the room burn. The picture people remember is the blue hour: cold light from the
 * window, warm light from the lamps.
 *
 * Indirect light is not free in real time, so it is approximated once per room instead of every frame: after the room
 * is built, the lit room itself is photographed from its centre into a small cube and that becomes what every surface
 * reflects (two rounds, so walls lit by a lamp also light their neighbours). The side of a sofa that faces the window
 * is then brighter than its back, which is what makes an interior read as one space.
 */
import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
import type { Assets } from '../assets/loaders'
import { kelvin } from './materials'
import type { ShellBuild } from './shell'
import type { TierSettings } from './quality'

export interface Mood {
  sky: string
  /** Colour the sky picture is multiplied by (its grade and brightness), and how far the dome is turned so the horizon worth seeing faces the glass. */
  skyTint: [number, number, number]
  skyYaw: number
  /** What is below the horizon: the pictures were taken on the ground, the room is on a high floor, so the land right under the horizon line dissolves into this haze. */
  haze: number
  /** Skylight entering through the glass. */
  window: { color: number; intensity: number }
  /** Direct light with shadows: the sun by day, the last glow of the sky after it. */
  key: { color: number; intensity: number; azimuth: number; elevation: number }
  /** A floor of light so nothing is ever pitch black. */
  fill: { sky: number; ground: number; intensity: number }
  /** Strength of the lamps, the ceiling spots and the line of light (1 = evening). */
  lamps: number
  exposure: number
}

export const MOODS: Readonly<Record<string, Mood>> = {
  hora_azul: {
    sky: 'hora_azul', skyTint: [0.36, 0.5, 0.92], skyYaw: Math.PI * 0.5, haze: 0x101728,
    window: { color: 0x6f8fe0, intensity: 2.2 },
    key: { color: 0x8aa0e8, intensity: 0.6, azimuth: 0.35, elevation: 0.5 },
    fill: { sky: 0x3a4a7c, ground: 0x24211f, intensity: 0.16 },
    lamps: 1, exposure: 1.15,
  },
  tarde: {
    sky: 'tarde', skyTint: [1.05, 1.05, 1.08], skyYaw: Math.PI * 0.5, haze: 0x93a3b8,
    window: { color: 0xdfe9ff, intensity: 2.6 },
    key: { color: 0xfff0dc, intensity: 3.4, azimuth: 0.55, elevation: 0.62 },
    fill: { sky: 0xb9c8e6, ground: 0x6b5f52, intensity: 0.3 },
    lamps: 0.2, exposure: 0.9,
  },
  noite: {
    sky: 'noite', skyTint: [0.8, 0.9, 1.25], skyYaw: Math.PI * 0.5, haze: 0x070a14,
    window: { color: 0x3f55a0, intensity: 0.6 },
    key: { color: 0x5a6cab, intensity: 0.22, azimuth: -0.3, elevation: 0.6 },
    fill: { sky: 0x202a4c, ground: 0x1c1816, intensity: 0.1 },
    lamps: 1.1, exposure: 1.08,
  },
}

const SKY_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
// v = 0.5 is the horizon of the picture. A sliver of land under it stays (far hills, a line of lights); the rest is haze.
const SKY_FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float hasMap;
uniform vec3 tint;
uniform vec3 haze;
varying vec2 vUv;
void main() {
  vec3 sky = mix(vec3(1.0), texture2D(map, vUv).rgb, hasMap) * tint;
  float below = smoothstep(0.496, 0.468, vUv.y);
  vec3 ground = haze * (1.0 - 0.45 * smoothstep(0.47, 0.2, vUv.y));
  gl_FragColor = vec4(mix(sky, ground, below), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

/** A lamp of the room (an item with a light). */
export interface LampSource {
  position: THREE.Vector3
  kelvin: number
  strength: number
}

/** People and anything else that moves live on this layer: the room's reflection is taken without them. */
export const LIVE_LAYER = 1

export class Lighting {
  readonly group = new THREE.Group()
  private readonly dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  private readonly key = new THREE.DirectionalLight()
  private readonly windowLight = new THREE.RectAreaLight(0xffffff, 1, 1, 1)
  private readonly hemi = new THREE.HemisphereLight()
  private readonly lampLights: THREE.PointLight[] = []
  private readonly spotLights: THREE.SpotLight[] = []
  private pmrem: THREE.PMREMGenerator | null = null
  private envTarget: THREE.WebGLRenderTarget | null = null
  private mood: Mood = MOODS.hora_azul!
  private shell: ShellBuild | null = null
  private tier!: TierSettings

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene, private readonly assets: Assets) {
    RectAreaLightUniformsLib.init()
    this.group.name = 'lighting'
    // Seen from inside: the sphere is mirrored so the picture is not.
    const domeG = assets.own(new THREE.SphereGeometry(90, 48, 24).scale(-1, 1, 1))
    const domeM = assets.own(new THREE.ShaderMaterial({
      depthWrite: false,
      uniforms: { map: { value: null }, hasMap: { value: 0 }, tint: { value: new THREE.Color(0x1a2440) }, haze: { value: new THREE.Color(0x141a2e) } },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
    }))
    this.dome = new THREE.Mesh(domeG, domeM)
    // The horizon a little below eye level, as seen from a high floor.
    this.dome.position.y = -6
    this.dome.renderOrder = -10
    this.dome.frustumCulled = false
    this.key.castShadow = true
    this.key.shadow.bias = -0.0004
    this.key.shadow.normalBias = 0.03
    this.key.shadow.radius = 5
    this.key.shadow.blurSamples = 12
    this.group.add(this.dome, this.key, this.key.target, this.windowLight, this.hemi)
    for (const l of [this.key, this.windowLight, this.hemi]) l.layers.enableAll()
    scene.add(this.group)
  }

  /** Applies a quality tier: how sharp the shadows are and how many lamps really light. */
  setTier(tier: TierSettings): void {
    this.tier = tier
    const on = tier.shadowMap > 0
    this.renderer.shadowMap.enabled = on
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.key.castShadow = on
    if (on && this.key.shadow.mapSize.x !== tier.shadowMap) {
      this.key.shadow.mapSize.setScalar(tier.shadowMap)
      this.key.shadow.map?.dispose()
      this.key.shadow.map = null
    }
    this.renderer.shadowMap.autoUpdate = tier.liveShadows
    this.renderer.shadowMap.needsUpdate = true
    // The glass light is an area light: the lightest tier trades it for the plain fill.
    this.windowLight.visible = tier.lamps > 2
  }

  /** The room changed (or the mood): rebuild the lights that belong to it. */
  async setRoom(shell: ShellBuild, size: { width: number; depth: number; height: number }, moodId: string, lamps: LampSource[]): Promise<void> {
    this.shell = shell
    this.mood = MOODS[moodId] ?? MOODS.hora_azul!
    const m = this.mood
    const sky = await this.assets.sky(m.sky).catch(() => null)
    const du = this.dome.material.uniforms
    du.map!.value = sky?.image ?? null
    du.hasMap!.value = sky ? 1 : 0
    ;(du.tint!.value as THREE.Color).setRGB(...m.skyTint)
    if (!sky) (du.tint!.value as THREE.Color).set(m.window.color).multiplyScalar(0.4)
    ;(du.haze!.value as THREE.Color).set(m.haze)
    this.dome.rotation.y = m.skyYaw
    this.renderer.toneMappingExposure = m.exposure

    // Skylight through the glass: an area light the size of the window wall, facing in.
    const w = shell.window
    this.windowLight.width = w.width
    this.windowLight.height = w.height
    this.windowLight.color.set(m.window.color)
    this.windowLight.intensity = m.window.intensity
    this.windowLight.position.copy(w.centre).add(new THREE.Vector3(0, 0, 0.12))
    this.windowLight.lookAt(w.centre.x, w.centre.y, 0)

    // Key light from outside the glass, with a shadow box that covers the room.
    const dir = new THREE.Vector3(Math.sin(m.key.azimuth) * Math.cos(m.key.elevation), Math.sin(m.key.elevation), Math.cos(m.key.azimuth) * Math.cos(m.key.elevation))
    this.key.color.set(m.key.color)
    this.key.intensity = m.key.intensity
    this.key.position.copy(dir).multiplyScalar(22)
    this.key.target.position.set(0, 0.6, 0)
    const half = Math.hypot(size.width, size.depth) / 2 + 1.5
    const cam = this.key.shadow.camera
    cam.left = -half
    cam.right = half
    cam.top = half
    cam.bottom = -half
    cam.near = 4
    cam.far = 46
    cam.updateProjectionMatrix()

    this.hemi.color.set(m.fill.sky)
    this.hemi.groundColor.set(m.fill.ground)
    this.hemi.intensity = m.fill.intensity

    for (const g of shell.glows) {
      const k = g.base * Math.min(1.15, 0.12 + m.lamps)
      if (g.material instanceof THREE.MeshBasicMaterial && g.material.transparent) g.material.opacity = Math.min(1, k)
      else g.material.color.copy(kelvin(2900)).multiplyScalar(k)
    }

    this.setLamps(lamps, size)
    this.renderer.shadowMap.needsUpdate = true
  }

  private setLamps(lamps: LampSource[], size: { width: number; depth: number; height: number }): void {
    for (const l of [...this.lampLights, ...this.spotLights]) {
      this.group.remove(l)
      if ((l as THREE.SpotLight).isSpotLight) this.group.remove((l as THREE.SpotLight).target)
      l.dispose()
    }
    this.lampLights.length = 0
    this.spotLights.length = 0
    const m = this.mood
    const budget = this.tier.lamps
    // The strongest lamps get a real light; the others keep their glow only.
    const ranked = [...lamps].sort((a, b) => b.strength - a.strength).slice(0, budget)
    for (const src of ranked) {
      const p = new THREE.PointLight(kelvin(src.kelvin), 5.5 * src.strength * m.lamps, 7.5, 1.8)
      p.position.copy(src.position)
      p.layers.enableAll()
      this.lampLights.push(p)
      this.group.add(p)
    }
    // Ceiling spots: two of them are real from the middle tier up, aimed at where people sit.
    const spots = this.shell?.spots ?? []
    const real = budget >= 4 ? Math.min(2, spots.length) : 0
    const byCentre = [...spots].sort((a, b) => a.from.lengthSq() - b.from.lengthSq())
    for (let i = 0; i < real; i++) {
      const s = byCentre[i]!
      const spot = new THREE.SpotLight(kelvin(3300), 15 * m.lamps, size.height + 1.5, 0.62, 0.8, 1.6)
      spot.position.copy(s.from)
      spot.target.position.copy(s.to)
      spot.layers.enableAll()
      this.spotLights.push(spot)
      this.group.add(spot, spot.target)
    }
  }

  /**
   * Photographs the lit room from its centre and uses that as what surfaces reflect. Call after the room and its lamps
   * are in the scene and the materials have compiled; cheap enough to repeat when the layout or the mood changes.
   */
  bake(centre: THREE.Vector3): void {
    this.pmrem ??= new THREE.PMREMGenerator(this.renderer)
    const scene = this.scene
    const fill = this.hemi.intensity
    // First round with a stronger fill (there is no bounce yet), second with the first as the room's own light.
    scene.environment = null
    this.hemi.intensity = fill * 2.2
    const first = this.pmrem.fromScene(scene, 0.03, 0.1, 120, { position: centre })
    scene.environment = first.texture
    scene.environmentIntensity = 0.7
    this.hemi.intensity = fill
    const second = this.pmrem.fromScene(scene, 0.02, 0.1, 120, { position: centre })
    scene.environment = second.texture
    first.dispose()
    this.envTarget?.dispose()
    this.envTarget = second
    this.renderer.shadowMap.needsUpdate = true
  }

  /** Glowing parts of the furniture (lamp shades, bulbs): they follow the mood like the lamps do. */
  setGlows(glows: { material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial; base: number }[]): void {
    const k = Math.min(1.15, 0.1 + this.mood.lamps)
    for (const g of glows) {
      if (g.material instanceof THREE.MeshStandardMaterial) g.material.emissiveIntensity = g.base * k
      else g.material.color.copy(kelvin(2800)).multiplyScalar(g.base * k)
    }
  }

  /** The lamps changed (a new quality tier, a lamp moved): light them again and refresh what the room reflects. */
  relight(lamps: LampSource[], size: { width: number; depth: number; height: number }): void {
    this.setLamps(lamps, size)
    this.bake(new THREE.Vector3(0, Math.min(1.5, size.height * 0.5), 0))
  }

  /** Something that casts a shadow moved while shadows are drawn once per layout. */
  refreshShadows(): void {
    this.renderer.shadowMap.needsUpdate = true
  }

  dispose(): void {
    this.scene.environment = null
    this.envTarget?.dispose()
    this.pmrem?.dispose()
    this.key.shadow.map?.dispose()
    for (const l of [...this.lampLights, ...this.spotLights]) l.dispose()
    this.scene.remove(this.group)
  }
}
