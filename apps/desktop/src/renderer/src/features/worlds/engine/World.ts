/**
 * The 3D room: one canvas, one scene, one frame loop. It knows nothing about the network or React: it is told which
 * room to show and who is in it, reports what the person at the keyboard does (walked, wants to sit), and draws.
 * Everything it allocates on the GPU is released by `dispose()`, which also gives the WebGL context back.
 */
import * as THREE from 'three'
import {
  WORLD_GAITS, WORLD_MOVE_HZ, WORLD_RUN_SPEED, WORLD_SHELLS, WORLD_WALK_SPEED, WORLD_WALL_MARGIN, toPose,
  type WorldAvatar, type WorldEmote, type WorldGesture, type WorldPose, type WorldRoomLayout,
} from '@alga/shared'
import { Assets } from '../assets/loaders'
import type { AssetPack } from '../assets/pack'
import { Avatar, prepareTemplate, type AvatarKit } from './avatar/Avatar'
import { PERSON_RADIUS, slide, standBy, turn, type Bounds } from './collision'
import { RoomEditor, type EditorHooks } from './editor'
import { buildItems, type RoomItems, type SeatSpot } from './items'
import { LIVE_LAYER, Lighting } from './lighting'
import { blobTexture } from './materials'
import { PoseSender, PoseTrack } from './net'
import { PostChain } from './post'
import { QualityGovernor, TIERS, frameBudget, type QualityPref, type QualityTier } from './quality'
import { ScreenSurface } from './screen'
import { buildShell, type ShellBuild } from './shell'

export interface WorldPerson {
  userId: string
  name: string
  avatar: WorldAvatar
  k: number
  pose: WorldPose
  seat: string | null
  loop: WorldGesture | null
}

export type EngineStatus =
  | { phase: 'loading'; step: 'room' | 'people' }
  | { phase: 'ready' }
  | { phase: 'error'; reason: 'context_lost' | 'failed'; message: string }

export interface EngineHooks {
  /** My pose changed enough to tell the others (already paced to WORLD_MOVE_HZ). */
  onMove?(pose: WorldPose): void
  onSit?(seat: string): void
  onStand?(pose: WorldPose): void
  /** I started walking while in a looping gesture. */
  onRest?(): void
  onStatus?(s: EngineStatus): void
  /** The seat I could sit on right now (near me or under the pointer), for the hint on screen. */
  onSeatHint?(seat: string | null): void
  onTier?(tier: QualityTier): void
  /** How loud someone is, 0..1. */
  voice?(userId: string): number
}

export interface EngineOptions {
  quality: QualityPref
  reducedMotion: boolean
  /** Where name tags and reactions are drawn (an element laid exactly over the canvas). */
  overlay: HTMLElement
  /** Class of the canvas the engine creates inside its host. */
  canvasClass: string
  /** What a screen reader calls the canvas. */
  label: string
  hooks: EngineHooks
}

interface Remote {
  person: WorldPerson
  avatar: Avatar | null
  track: PoseTrack
  label: HTMLElement
}

const UP = new THREE.Vector3(0, 1, 0)
const tmp = new THREE.Vector3()
const tmp2 = new THREE.Vector3()

export class WorldEngine {
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.08, 220)
  private readonly assets: Assets
  private readonly lighting: Lighting
  private readonly screen: ScreenSurface
  private readonly hooks: EngineHooks
  private readonly overlay: HTMLElement
  private readonly raycaster = new THREE.Raycaster()
  private readonly sender = new PoseSender(WORLD_MOVE_HZ)
  private governor: QualityGovernor | null
  private tier: QualityTier
  private reducedMotion: boolean

  private shell: ShellBuild | null = null
  private room: RoomItems | null = null
  private layout: WorldRoomLayout | null = null
  private bounds: Bounds = { hw: 4, hd: 3 }
  private roomToken = 0
  private blob: THREE.Texture
  private kits = new Map<string, Promise<AvatarKit>>()

  private meId: string | null = null
  private me: { person: WorldPerson; avatar: Avatar | null; x: number; z: number; yaw: number; gait: number; speed: number; label: HTMLElement } | null = null
  private readonly remotes = new Map<string, Remote>()
  private byKey = new Map<number, string>()

  // Input
  private readonly keys = new Set<string>()
  private inputEnabled = true
  private drag: { x: number; y: number; moved: boolean; button: number } | null = null
  private pointer = new THREE.Vector2(9, 9)
  private walkTo: { x: number; z: number; seat: string | null; stuck: number } | null = null
  private hintSeat: string | null = null
  private pendingStand = 0
  private editor: RoomEditor | null = null
  private post: PostChain | null = null
  private figureLight: THREE.SpotLight | null = null

  // Camera
  private camYaw = Math.PI * 0.85
  private camPitch = 0.3
  private camDist = 4.4
  private readonly camTarget = new THREE.Vector3(0, 1.35, 0)
  /** The camera was placed by hand and stays there until the person moves or looks around. */
  private free = false
  private watching = false
  private readonly watchFrom = new THREE.Vector3()
  private readonly watchAt = new THREE.Vector3()

  // Loop
  private raf = 0
  private last = 0
  private lastRaf = 0
  private rafEma = 16
  private workEma = 0
  private frames = 0
  private disposed = false
  private visible = true
  private focused = true
  private status: EngineStatus = { phase: 'loading', step: 'room' }
  private readonly offs: (() => void)[] = []

  /**
   * `host`: the element the room fills. The engine makes its own canvas in it and removes it on dispose: a WebGL
   * context that was given back cannot be used again, so every engine starts from a new canvas.
   */
  constructor(host: HTMLElement, pack: AssetPack, opts: EngineOptions) {
    const canvas = document.createElement('canvas')
    canvas.className = opts.canvasClass
    canvas.tabIndex = 0
    canvas.setAttribute('aria-label', opts.label)
    host.prepend(canvas)
    this.canvas = canvas
    this.hooks = opts.hooks
    this.overlay = opts.overlay
    this.reducedMotion = opts.reducedMotion
    this.governor = opts.quality === 'auto' ? new QualityGovernor('medium') : null
    this.tier = opts.quality === 'auto' ? 'medium' : opts.quality

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false, stencil: false })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    // AgX keeps strong warm lamps from going red and garish, which is what makes an evening interior look filmed, not rendered.
    this.renderer.toneMapping = THREE.AgXToneMapping
    this.renderer.setClearColor(0x0b0b0c)
    // Counted per frame, not per pass: the finishing passes would otherwise hide what the room itself costs.
    this.renderer.info.autoReset = false
    const t = TIERS[this.tier]
    this.assets = new Assets(pack, t.textureSize, Math.min(t.anisotropy, this.renderer.capabilities.getMaxAnisotropy()))
    this.blob = blobTexture(this.assets)
    this.lighting = new Lighting(this.renderer, this.scene, this.assets)
    this.lighting.setTier(t)
    this.screen = new ScreenSurface(this.scene)
    this.camera.layers.enable(LIVE_LAYER)
    this.raycaster.layers.enableAll()
    this.applyPixelRatio()

    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window | Document, type: K | string, fn: (e: never) => void, o?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, o)
      this.offs.push(() => el.removeEventListener(type, fn as EventListener, o))
    }
    on(canvas, 'pointerdown', this.onPointerDown)
    on(window, 'pointermove', this.onPointerMove)
    on(window, 'pointerup', this.onPointerUp)
    on(canvas, 'wheel', this.onWheel, { passive: false })
    on(canvas, 'contextmenu', (e: Event) => e.preventDefault())
    on(window, 'keydown', this.onKeyDown)
    on(window, 'keyup', this.onKeyUp)
    on(window, 'blur', () => { this.keys.clear(); this.focused = false })
    on(window, 'focus', () => { this.focused = true })
    on(document, 'visibilitychange', () => { this.visible = !document.hidden })
    on(canvas, 'webglcontextlost', (e: Event) => {
      e.preventDefault()
      this.setStatus({ phase: 'error', reason: 'context_lost', message: 'the graphics context was lost' })
    })
    this.visible = !document.hidden
    this.focused = document.hasFocus()
    this.raf = requestAnimationFrame(this.frame)
  }

  // ---- room ----------------------------------------------------------------------------------------------------------

  /** Shows a room. Calling it again with a new layout rebuilds it; people stay. */
  async setRoom(source: WorldRoomLayout): Promise<void> {
    // Its own copy: editing moves pieces in place, and the caller's object is not the engine's to change.
    const layout: WorldRoomLayout = { shell: source.shell, finish: { ...source.finish }, items: source.items.map((i) => ({ ...i })) }
    const token = ++this.roomToken
    const first = !this.room
    if (first) this.setStatus({ phase: 'loading', step: 'room' })
    try {
      const spec = WORLD_SHELLS[layout.shell]
      const guard = { aborted: false }
      Object.defineProperty(guard, 'aborted', { get: () => this.disposed || token !== this.roomToken })
      const [shell, items] = await Promise.all([buildShell(this.assets, spec, layout.finish), buildItems(this.assets, layout, guard)])
      if (this.disposed || token !== this.roomToken) return
      this.editor?.select(null)
      if (this.shell) this.scene.remove(this.shell.group)
      if (this.room) this.scene.remove(this.room.group)
      this.shell = shell
      this.room = items
      this.layout = layout
      this.bounds = { hw: spec.width / 2 - WORLD_WALL_MARGIN + PERSON_RADIUS, hd: spec.depth / 2 - WORLD_WALL_MARGIN + PERSON_RADIUS }
      this.scene.add(shell.group, items.group)
      this.screen.setScreens([...items.items.values()].flatMap((i) => (i.screen ? [i.screen] : [])))
      const moodSku = layout.finish.mood.replace(/^m_/, '')
      await this.lighting.setRoom(shell, spec, moodSku, items.lamps)
      if (this.disposed || token !== this.roomToken) return
      this.lighting.setGlows(items.glows)
      // One frame so every material is compiled and lit before the room is photographed for its reflections.
      this.renderer.compile(this.scene, this.camera)
      this.lighting.bake(new THREE.Vector3(0, Math.min(1.5, spec.height * 0.5), 0))
      if (first) {
        this.camYaw = this.me ? this.roomyYaw(this.me.x, this.me.z, this.me.yaw + Math.PI) : Math.PI * 0.82
        this.camTarget.set(this.me?.x ?? 0, 1.35, this.me?.z ?? 0)
      }
      if (items.failed.length) console.warn('[worlds] items not built:', items.failed)
      this.setStatus(this.me || !this.meId ? { phase: 'ready' } : { phase: 'loading', step: 'people' })
    } catch (err) {
      if (this.disposed || token !== this.roomToken) return
      this.setStatus({ phase: 'error', reason: 'failed', message: (err as Error).message })
      throw err
    }
  }

  // ---- people --------------------------------------------------------------------------------------------------------

  /** Who is in the room. `meId` is the person at the keyboard (null: only looking). */
  setPeople(meId: string | null, people: WorldPerson[]): void {
    this.meId = meId
    const seen = new Set<string>()
    this.byKey = new Map(people.map((p) => [p.k, p.userId]))
    for (const p of people) {
      seen.add(p.userId)
      if (p.userId === meId) this.syncMe(p)
      else this.syncRemote(p)
    }
    for (const [id, r] of this.remotes) {
      if (seen.has(id)) continue
      r.avatar?.dispose()
      r.label.remove()
      this.remotes.delete(id)
    }
    if (this.me && !seen.has(this.me.person.userId)) {
      this.me.avatar?.dispose()
      this.me.label.remove()
      this.me = null
    }
    if (!this.lightingLive()) this.lighting.refreshShadows()
  }

  private kit(body: string): Promise<AvatarKit> {
    let k = this.kits.get(body)
    if (!k) {
      k = Promise.all([this.assets.body(body), this.assets.clips()]).then(([b, clips]) => {
        prepareTemplate(b.scene, (g) => this.assets.own(g))
        return { body: b, clips, blob: this.blob }
      })
      this.kits.set(body, k)
      k.catch(() => this.kits.delete(body))
    }
    return k
  }

  private label(name: string, mine: boolean): HTMLElement {
    const el = document.createElement('div')
    el.className = 'world-tag'
    el.textContent = name
    if (mine) el.dataset.me = ''
    this.overlay.append(el)
    return el
  }

  private syncMe(p: WorldPerson): void {
    const [x, z, yaw] = [p.pose[0] / 100, p.pose[1] / 100, (p.pose[2] * Math.PI) / 180]
    if (!this.me) {
      this.me = { person: p, avatar: null, x, z, yaw, gait: 0, speed: 0, label: this.label(p.name, true) }
      this.sender.reset()
      this.camYaw = this.roomyYaw(x, z, yaw + Math.PI)
    } else {
      const prev = this.me.person
      // The server moved me (sat me down, stood me up, a new room): its pose wins. My own walking never comes back.
      if (prev.seat !== p.seat || this.roomChangedSince(prev, p)) {
        this.me.x = x
        this.me.z = z
        if (!p.seat) this.me.yaw = yaw
        this.walkTo = null
      }
      if (prev.avatar.body !== p.avatar.body) {
        this.me.avatar?.dispose()
        this.me.avatar = null
      } else if (prev.avatar !== p.avatar) this.me.avatar?.setSpec(p.avatar)
      this.me.person = p
      this.me.label.textContent = p.name
    }
    if (p.seat) this.pendingStand = 0
    const me = this.me
    if (!me.avatar) {
      void this.kit(p.avatar.body).then((kit) => {
        if (this.disposed || this.me !== me || me.avatar || me.person.avatar.body !== p.avatar.body) return
        me.avatar = new Avatar(kit, me.person.avatar)
        me.avatar.setShadow(this.lightingLive() ? 0.3 : 0.55)
        this.scene.add(me.avatar.root)
        if (this.status.phase === 'loading' && this.room) this.setStatus({ phase: 'ready' })
      }).catch((err: unknown) => console.warn('[worlds] avatar failed:', (err as Error).message))
    }
  }

  /**
   * Where the camera goes when someone arrives: behind them if the room has the space there, else the nearest side
   * that does (a figure that spawned by a wall would otherwise fill the whole view).
   */
  private roomyYaw(x: number, z: number, preferred: number): number {
    const spec = this.layout ? WORLD_SHELLS[this.layout.shell] : null
    if (!spec) return preferred
    const hx = spec.width / 2 - 0.22, hz = spec.depth / 2 - 0.22
    const flat = Math.cos(this.camPitch)
    let best = preferred, bestScore = -Infinity
    for (let i = 0; i < 16; i++) {
      const a = preferred + (i * Math.PI) / 8
      const dx = Math.sin(a) * flat, dz = Math.cos(a) * flat
      let room = this.camDist
      if (dx > 1e-4) room = Math.min(room, (hx - x) / dx)
      else if (dx < -1e-4) room = Math.min(room, (-hx - x) / dx)
      if (dz > 1e-4) room = Math.min(room, (hz - z) / dz)
      else if (dz < -1e-4) room = Math.min(room, (-hz - z) / dz)
      const score = room - Math.abs(turn(preferred, a)) * 0.45
      if (score > bestScore) {
        bestScore = score
        best = a
      }
    }
    return best
  }

  /** A pose far from where I am can only be the server placing me (a spawn after the room changed). */
  private roomChangedSince(prev: WorldPerson, next: WorldPerson): boolean {
    if (!this.me || next.seat) return false
    const dx = next.pose[0] / 100 - this.me.x, dz = next.pose[1] / 100 - this.me.z
    return prev.pose !== next.pose && Math.hypot(dx, dz) > 2.5 && next.pose[3] === 0 && prev.pose[0] !== next.pose[0]
  }

  private syncRemote(p: WorldPerson): void {
    let r = this.remotes.get(p.userId)
    const now = performance.now()
    const [x, z, yaw] = [p.pose[0] / 100, p.pose[1] / 100, (p.pose[2] * Math.PI) / 180]
    if (!r) {
      r = { person: p, avatar: null, track: new PoseTrack(), label: this.label(p.name, false) }
      r.track.snap(now, x, z, yaw)
      this.remotes.set(p.userId, r)
    } else {
      if (r.person.seat !== p.seat) r.track.snap(now, x, z, yaw)
      if (r.person.avatar.body !== p.avatar.body) {
        r.avatar?.dispose()
        r.avatar = null
      } else if (r.person.avatar !== p.avatar) r.avatar?.setSpec(p.avatar)
      r.person = p
      r.label.textContent = p.name
    }
    const remote = r
    if (!remote.avatar) {
      void this.kit(p.avatar.body).then((kit) => {
        if (this.disposed || this.remotes.get(p.userId) !== remote || remote.avatar || remote.person.avatar.body !== p.avatar.body) return
        remote.avatar = new Avatar(kit, remote.person.avatar)
        remote.avatar.setShadow(this.lightingLive() ? 0.3 : 0.55)
        this.scene.add(remote.avatar.root)
      }).catch((err: unknown) => console.warn('[worlds] avatar failed:', (err as Error).message))
    }
  }

  /** Positions of the others, as they arrive: [k, x cm, z cm, yaw°, gait]. */
  applyTick(entries: readonly (readonly [number, number, number, number, number])[]): void {
    const now = performance.now()
    for (const [k, x, z, yaw, gait] of entries) {
      const id = this.byKey.get(k)
      const r = id ? this.remotes.get(id) : undefined
      if (r && !r.person.seat) r.track.push(now, x / 100, z / 100, (yaw * Math.PI) / 180, gait)
    }
  }

  emote(userId: string, emote: WorldEmote): void {
    const who = userId === this.meId ? this.me : this.remotes.get(userId)
    if (!who) return
    if (emote.kind === 'gesture') return void who.avatar?.gesture(emote.id)
    const el = document.createElement('div')
    el.className = 'world-reaction'
    el.textContent = emote.id
    who.label.append(el)
    el.addEventListener('animationend', () => el.remove(), { once: true })
    // If animations are off the element would stay: remove it on a timer too.
    setTimeout(() => el.remove(), 2600)
  }

  // ---- screen --------------------------------------------------------------------------------------------------------

  /** The video shown on the screens of the room (a shared screen), or null for none. */
  setScreenSource(video: HTMLVideoElement | null): void {
    this.screen.setSource(video)
  }

  /** Looks at the screen from where I am (or from the sofa in front of it), filling the view with it. */
  setWatching(on: boolean): void {
    const s = this.screen.primary()
    if (!on || !s) {
      this.watching = false
      return
    }
    s.getWorldPosition(this.watchAt)
    const normal = tmp.set(0, 0, 1).applyQuaternion(s.getWorldQuaternion(new THREE.Quaternion()))
    const w = s.geometry.parameters.width * s.scale.x
    // Far enough for the screen to fill most of the view.
    const dist = Math.min(6, (w / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov * this.camera.aspect) / 2)) * 1.25 + 0.6)
    this.watchFrom.copy(this.watchAt).addScaledVector(normal, Math.max(1.6, dist))
    this.watchFrom.y = Math.max(1.0, this.watchAt.y - 0.15)
    this.watching = true
  }

  get isWatching(): boolean {
    return this.watching
  }

  // ---- settings ------------------------------------------------------------------------------------------------------

  setQuality(pref: QualityPref): void {
    this.governor = pref === 'auto' ? new QualityGovernor(this.tier) : null
    if (pref !== 'auto') this.applyTier(pref)
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on
  }

  /** Keyboard and pointer drive the figure only while the room has the person's attention (not while typing). */
  setInputEnabled(on: boolean): void {
    this.inputEnabled = on
    if (!on) {
      this.keys.clear()
      this.drag = null
    }
  }

  resize(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.post?.resize(w, h, this.renderer.getPixelRatio())
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /** What the renderer is costing, for the settings panel and the benchmarks. */
  stats(): { tier: QualityTier; drawCalls: number; triangles: number; textures: number; geometries: number; rafMs: number; workMs: number } {
    const i = this.renderer.info
    return { tier: this.tier, drawCalls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries, rafMs: this.rafEma, workMs: this.workEma }
  }

  private applyTier(tier: QualityTier): void {
    if (tier === this.tier) return
    this.tier = tier
    const t = TIERS[tier]
    this.assets.setTextureBudget(t.textureSize, Math.min(t.anisotropy, this.renderer.capabilities.getMaxAnisotropy()))
    this.lighting.setTier(t)
    if (this.room && this.shell && this.layout) this.lighting.relight(this.room.lamps, WORLD_SHELLS[this.layout.shell])
    this.applyPixelRatio()
    const shadow = this.lightingLive() ? 0.3 : 0.55
    this.me?.avatar?.setShadow(shadow)
    for (const r of this.remotes.values()) r.avatar?.setShadow(shadow)
    this.hooks.onTier?.(tier)
  }

  private lightingLive(): boolean {
    return TIERS[this.tier].liveShadows
  }

  private applyPixelRatio(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TIERS[this.tier].maxPixelRatio))
    // The finishing passes exist only in the tier that pays for them.
    if (TIERS[this.tier].post && !this.post) {
      try {
        this.post = new PostChain(this.renderer, this.scene, this.camera)
      } catch (err) {
        console.warn('[worlds] no post-processing on this GPU:', (err as Error).message)
      }
    } else if (!TIERS[this.tier].post && this.post) {
      this.post.dispose()
      this.post = null
    }
    this.resize()
  }

  private setStatus(s: EngineStatus): void {
    this.status = s
    this.hooks.onStatus?.(s)
  }

  // ---- input ---------------------------------------------------------------------------------------------------------

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.inputEnabled) return
    this.canvas.setPointerCapture?.(e.pointerId)
    this.setPointer(e)
    // Editing: a press on a piece picks it up; anywhere else looks around as usual.
    if (this.editor && e.button === 0 && this.editor.begin(this.pointer)) return void (this.drag = null)
    this.drag = { x: e.clientX, y: e.clientY, moved: false, button: e.button }
  }

  private setPointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect()
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1))
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    this.setPointer(e)
    if (this.editor?.dragging) return void this.editor.move(this.pointer)
    const d = this.drag
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 5) return
    d.moved = true
    d.x = e.clientX
    d.y = e.clientY
    this.watching = false
    this.free = false
    this.camYaw -= dx * 0.0052
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + dy * 0.004, -0.12, 1.25)
  }

  private readonly onPointerUp = (): void => {
    if (this.editor?.dragging) return void this.editor.end()
    const d = this.drag
    this.drag = null
    if (!d || d.moved || d.button !== 0 || !this.inputEnabled) return
    // Editing: a click on nothing lets go of the selection (walking is on the keys there).
    if (this.editor) return void this.editor.select(null)
    this.click()
  }

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.inputEnabled) return
    e.preventDefault()
    this.watching = false
    this.camDist = THREE.MathUtils.clamp(this.camDist * Math.exp(e.deltaY * 0.0011), 1.5, 8)
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.inputEnabled || e.ctrlKey || e.metaKey || e.altKey) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    const k = e.code
    if (this.editor?.selection && this.editKey(k)) return void e.preventDefault()
    if (k === 'KeyE' && !e.repeat) {
      if (this.me?.person.seat) this.stand()
      else if (this.hintSeat) this.goSit(this.hintSeat)
      return
    }
    if (MOVE_KEYS.has(k)) {
      this.keys.add(k)
      e.preventDefault()
    }
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code)
  }

  /** Keys that act on the selected piece while editing. Returns whether the key was one of them. */
  private editKey(k: string): boolean {
    const ed = this.editor!
    switch (k) {
      case 'KeyQ': ed.rotate(-1); return true
      case 'KeyE': ed.rotate(1); return true
      case 'KeyR': ed.rotate(6); return true
      case 'Delete': case 'Backspace': ed.remove(); return true
      case 'Escape': ed.select(null); return true
      case 'ArrowLeft': ed.nudge(-1, 0); return true
      case 'ArrowRight': ed.nudge(1, 0); return true
      case 'ArrowUp': ed.nudge(0, -1); return true
      case 'ArrowDown': ed.nudge(0, 1); return true
      default: return false
    }
  }

  /** A click that was not a drag: sit on the seat under the pointer, else walk to that spot of the floor. */
  private click(): void {
    if (!this.me || !this.room) return
    const seat = this.seatUnderPointer()
    if (seat) return void this.goSit(seat.id)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const ray = this.raycaster.ray
    if (ray.direction.y >= -0.01) return
    const t = -ray.origin.y / ray.direction.y
    const p = ray.at(t, tmp)
    if (Math.abs(p.x) > this.bounds.hw || Math.abs(p.z) > this.bounds.hd) return
    if (this.me.person.seat) this.stand()
    this.watching = false
    this.walkTo = { x: p.x, z: p.z, seat: null, stuck: 0 }
  }

  private seatUnderPointer(): SeatSpot | null {
    if (!this.room) return null
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const ray = this.raycaster.ray
    let best: SeatSpot | null = null, bestD = 0.42
    for (const s of this.room.seats) {
      if (this.seatTaken(s.id)) continue
      const d = ray.distanceToPoint(tmp.set(s.x, s.y + 0.25, s.z))
      if (d < bestD) { best = s; bestD = d }
    }
    return best
  }

  private seatTaken(id: string): boolean {
    if (this.me?.person.seat === id) return true
    for (const r of this.remotes.values()) if (r.person.seat === id) return true
    return false
  }

  /** Walks to a seat and sits when there (or sits at once when already next to it). */
  private goSit(id: string): void {
    const s = this.room?.seats.find((x) => x.id === id)
    if (!s || !this.me || this.seatTaken(id)) return
    const near = Math.hypot(s.x - this.me.x, s.z - this.me.z) < 1.5
    if (near) return void this.hooks.onSit?.(id)
    const [x, z] = standBy(s.x, s.z, s.yaw, PERSON_RADIUS, this.bounds, this.room!.boxes)
    this.walkTo = { x, z, seat: id, stuck: 0 }
  }

  private stand(): void {
    const me = this.me
    const seat = me && this.room?.seats.find((s) => s.id === me.person.seat)
    if (!me || !seat || !this.room || performance.now() - this.pendingStand < 600) return
    this.pendingStand = performance.now()
    const [x, z] = standBy(seat.x, seat.z, seat.yaw, PERSON_RADIUS, this.bounds, this.room.boxes)
    me.x = x
    me.z = z
    me.yaw = seat.yaw
    this.hooks.onStand?.(toPose(x, z, seat.yaw))
  }

  // ---- frame ---------------------------------------------------------------------------------------------------------

  private readonly frame = (now: number): void => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.frame)
    const rafDt = this.lastRaf ? now - this.lastRaf : 16
    this.lastRaf = now
    this.rafEma = this.rafEma * 0.92 + Math.min(100, rafDt) * 0.08
    const fps = frameBudget(this.tier, { visible: this.visible, focused: this.focused, reducedMotion: this.reducedMotion })
    if (fps === 0 || this.status.phase === 'error') {
      this.last = 0
      return
    }
    const interval = 1000 / fps
    if (!this.last) this.last = now - interval
    // A little tolerance so a 60 Hz display is not cut to 30 by rounding.
    if (now - this.last < interval - 1.5) return
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    const t0 = performance.now()
    this.update(dt, now)
    this.renderer.info.reset()
    if (this.post) this.post.render(dt)
    else this.renderer.render(this.scene, this.camera)
    const work = performance.now() - t0
    this.workEma = this.workEma ? this.workEma * 0.92 + work * 0.08 : work
    // For whoever inspects the page (the e2e, the benchmarks): frames drawn so far and what they cost.
    if (++this.frames % 15 === 0) {
      const d = this.canvas.dataset
      d.frames = String(this.frames)
      d.tier = this.tier
      d.calls = String(this.renderer.info.render.calls)
      d.triangles = String(this.renderer.info.render.triangles)
    }
    if (this.governor && this.focused && this.status.phase === 'ready') {
      // When the display itself cannot be kept up with, that is the cost; otherwise only what the CPU saw.
      const cost = this.rafEma > interval * 1.18 ? this.rafEma : work
      const next = this.governor.frame(cost, now)
      if (next) this.applyTier(next)
    }
  }

  private update(dt: number, now: number): void {
    this.updateMe(dt)
    const voice = this.hooks.voice
    for (const r of this.remotes.values()) {
      if (!r.avatar) continue
      const seat = r.person.seat ? this.room?.seats.find((s) => s.id === r.person.seat) ?? null : null
      const s = r.track.sample(now)
      r.avatar.update(dt, {
        x: s?.x ?? r.person.pose[0] / 100, z: s?.z ?? r.person.pose[1] / 100, yaw: s?.yaw ?? 0, gait: s?.gait ?? 0, speed: s?.speed ?? 0,
        seat, loop: r.person.loop, voice: voice?.(r.person.userId) ?? 0,
      })
    }
    this.updateCamera(dt)
    if (this.figureLight && this.me) {
      // In front of the figure, above eye level and a little to one side.
      const { x, z, yaw } = this.me
      this.figureLight.position.set(x + Math.sin(yaw) * 2.1 + Math.cos(yaw) * 0.9, 2.5, z + Math.cos(yaw) * 2.1 - Math.sin(yaw) * 0.9)
      this.figureLight.target.position.set(x, 1.05, z)
    }
    this.screen.update(dt)
    this.updateLabels()
    this.updateHint()
  }

  private updateMe(dt: number): void {
    const me = this.me
    if (!me || !this.room) return
    const seated = !!me.person.seat
    let mx = 0, mz = 0
    if (this.inputEnabled) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz += 1
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz -= 1
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1
    }
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
    let vx = 0, vz = 0, gait: number = WORLD_GAITS.idle
    if (mx || mz) {
      if (seated) {
        this.stand()
      } else {
        this.walkTo = null
        this.watching = false
        this.free = false
        // Forward is where the camera looks, flattened on the floor.
        const fx = -Math.sin(this.camYaw), fz = -Math.cos(this.camYaw)
        const rx = -fz, rz = fx
        const len = Math.hypot(mx, mz)
        vx = (fx * mz + rx * mx) / len
        vz = (fz * mz + rz * mx) / len
        gait = run ? WORLD_GAITS.run : WORLD_GAITS.walk
      }
    } else if (this.walkTo && !seated) {
      const dx = this.walkTo.x - me.x, dz = this.walkTo.z - me.z
      const d = Math.hypot(dx, dz)
      if (d < 0.07) {
        const seat = this.walkTo.seat
        this.walkTo = null
        if (seat && !this.seatTaken(seat)) this.hooks.onSit?.(seat)
      } else {
        vx = dx / d
        vz = dz / d
        gait = run ? WORLD_GAITS.run : WORLD_GAITS.walk
      }
    }
    const speed = gait === WORLD_GAITS.run ? WORLD_RUN_SPEED : gait === WORLD_GAITS.walk ? WORLD_WALK_SPEED : 0
    if (speed > 0) {
      const [nx, nz] = slide(me.x, me.z, vx * speed * dt, vz * speed * dt, PERSON_RADIUS, this.bounds, this.room.boxes)
      const moved = Math.hypot(nx - me.x, nz - me.z)
      me.x = nx
      me.z = nz
      me.yaw += turn(me.yaw, Math.atan2(vx, vz)) * (1 - Math.exp(-dt * 11))
      if (this.walkTo) {
        // Pushing against a piece of furniture without getting anywhere: stop there.
        this.walkTo.stuck = moved < speed * dt * 0.25 ? this.walkTo.stuck + dt : 0
        if (this.walkTo.stuck > 0.45) {
          const seat = this.walkTo.seat
          this.walkTo = null
          if (seat && !this.seatTaken(seat)) this.hooks.onSit?.(seat)
        }
      }
      if (me.person.loop) this.hooks.onRest?.()
    }
    me.gait = gait
    me.speed = speed
    const seat = seated ? this.room.seats.find((s) => s.id === me.person.seat) ?? null : null
    me.avatar?.update(dt, { x: me.x, z: me.z, yaw: me.yaw, gait, speed, seat, loop: me.person.loop, voice: this.hooks.voice?.(me.person.userId) ?? 0 })
    if (!seated) {
      const pose = this.sender.next(performance.now(), toPose(me.x, me.z, me.yaw, gait as 0 | 1 | 2))
      if (pose) this.hooks.onMove?.(pose as WorldPose)
    }
  }

  private updateCamera(dt: number): void {
    const me = this.me
    const spec = this.layout ? WORLD_SHELLS[this.layout.shell] : null
    if (this.watching) {
      if (me?.avatar) me.avatar.root.visible = true
      const k = 1 - Math.exp(-dt * 4.5)
      this.camera.position.lerp(this.watchFrom, k)
      this.camTarget.lerp(this.watchAt, k)
      this.camera.lookAt(this.camTarget)
      return
    }
    if (!this.free && !me && spec && this.inputEnabled) {
      // Nobody to follow (the room alone): the keys move what the camera looks at.
      const mz = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0)
      const mx = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0)
      if (mx || mz) {
        const fx = -Math.sin(this.camYaw), fz = -Math.cos(this.camYaw)
        const step = 3.2 * dt
        this.camTarget.x = THREE.MathUtils.clamp(this.camTarget.x + (fx * mz - fz * mx) * step, -spec.width / 2 + 0.6, spec.width / 2 - 0.6)
        this.camTarget.z = THREE.MathUtils.clamp(this.camTarget.z + (fz * mz + fx * mx) * step, -spec.depth / 2 + 0.6, spec.depth / 2 - 0.6)
      }
    } else if (!this.free) {
      const seat = me?.person.seat ? this.room?.seats.find((s) => s.id === me.person.seat) : null
      const tx = seat ? seat.x : me ? me.x : 0
      const tz = seat ? seat.z : me ? me.z : 0
      const ty = seat ? seat.y + 0.62 : 1.38
      const k = 1 - Math.exp(-dt * 10)
      this.camTarget.x += (tx - this.camTarget.x) * k
      this.camTarget.z += (tz - this.camTarget.z) * k
      this.camTarget.y += (ty - this.camTarget.y) * k
    }
    const dir = tmp.set(Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch))
    let dist = this.camDist
    if (spec) {
      // The camera stays inside the room: the boom shortens instead of going through a wall or the ceiling.
      const hx = spec.width / 2 - 0.22, hz = spec.depth / 2 - 0.22, top = spec.height - 0.24, bottom = 0.22
      const o = this.camTarget
      if (dir.x > 1e-4) dist = Math.min(dist, (hx - o.x) / dir.x)
      else if (dir.x < -1e-4) dist = Math.min(dist, (-hx - o.x) / dir.x)
      if (dir.z > 1e-4) dist = Math.min(dist, (hz - o.z) / dir.z)
      else if (dir.z < -1e-4) dist = Math.min(dist, (-hz - o.z) / dir.z)
      if (dir.y > 1e-4) dist = Math.min(dist, (top - o.y) / dir.y)
      else if (dir.y < -1e-4) dist = Math.min(dist, (bottom - o.y) / dir.y)
      dist = Math.max(0.6, dist)
    }
    // Squeezed against a wall, the camera would be inside my own figure: it steps out of the picture instead.
    if (me?.avatar) me.avatar.root.visible = this.free || dist > 0.95
    tmp2.copy(this.camTarget).addScaledVector(dir, dist)
    this.camera.position.lerp(tmp2, 1 - Math.exp(-dt * 14))
    this.camera.up.copy(UP)
    this.camera.lookAt(this.camTarget)
  }

  private updateLabels(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight
    const place = (avatar: Avatar | null, el: HTMLElement, hide: boolean) => {
      if (!avatar || hide) return void (el.style.display = 'none')
      const p = avatar.labelPoint(tmp)
      const dist = p.distanceTo(this.camera.position)
      p.project(this.camera)
      if (p.z > 1 || p.z < -1 || dist > 16) return void (el.style.display = 'none')
      el.style.display = ''
      el.style.transform = `translate(-50%, -100%) translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px)`
      el.style.opacity = String(THREE.MathUtils.clamp((16 - dist) / 4, 0, 1))
    }
    for (const r of this.remotes.values()) place(r.avatar, r.label, false)
    // My own name is only an anchor for my reactions.
    if (this.me) place(this.me.avatar, this.me.label, false)
  }

  private updateHint(): void {
    const me = this.me
    let hint: string | null = null
    if (me && this.room && !me.person.seat) {
      const under = this.seatUnderPointer()
      if (under) hint = under.id
      else {
        let best = 1.35
        for (const s of this.room.seats) {
          if (this.seatTaken(s.id)) continue
          const d = Math.hypot(s.x - me.x, s.z - me.z)
          if (d < best) { best = d; hint = s.id }
        }
      }
    }
    if (hint !== this.hintSeat) {
      this.hintSeat = hint
      this.hooks.onSeatHint?.(hint)
    }
  }

  // ---- editing --------------------------------------------------------------------------------------------------------

  /** Turns editing of the room on (with what to tell the screen) or off (null). Returns the editor while it is on. */
  setEditing(hooks: EditorHooks | null): RoomEditor | null {
    this.editor?.dispose()
    this.editor = null
    if (!hooks) return null
    this.walkTo = null
    this.editor = new RoomEditor(this.assets, this.camera, () => this.room, () => this.layout, hooks, (lamps) => {
      const room = this.room, layout = this.layout
      if (!room || !layout) return
      this.screen.setScreens([...room.items.values()].flatMap((i) => (i.screen ? [i.screen] : [])))
      if (lamps) this.lighting.relight(room.lamps, WORLD_SHELLS[layout.shell])
      else this.lighting.refreshShadows()
    })
    return this.editor
  }

  /** A soft light on my own figure, for when it is being dressed (the Ateliê): the room's mood may leave it in shadow. */
  setFigureLight(on: boolean): void {
    if (on && !this.figureLight) {
      this.figureLight = new THREE.SpotLight(0xfff1e0, 26, 8, 0.55, 0.9, 1.5)
      this.figureLight.layers.enableAll()
      this.scene.add(this.figureLight, this.figureLight.target)
    } else if (!on && this.figureLight) {
      this.scene.remove(this.figureLight, this.figureLight.target)
      this.figureLight.dispose()
      this.figureLight = null
    }
  }

  /** The spot of the floor the person is looking at: where a new piece appears. */
  focusPoint(): { x: number; z: number } {
    return { x: this.camTarget.x, z: this.camTarget.z }
  }

  /** The layout as it is now, edits included. */
  currentLayout(): WorldRoomLayout | null {
    return this.layout ? { shell: this.layout.shell, finish: { ...this.layout.finish }, items: this.layout.items.map((i) => ({ ...i })) } : null
  }

  // ---- lab and tests -------------------------------------------------------------------------------------------------

  /** Places the camera by hand (the lab's fixed views and the screenshots of the docs). */
  setView(yaw: number, pitch: number, dist: number, target?: [number, number, number]): void {
    this.camYaw = yaw
    this.camPitch = pitch
    this.camDist = dist
    if (target) this.camTarget.set(...target)
    this.free = !!target
    this.watching = false
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    for (const off of this.offs) off()
    this.me?.avatar?.dispose()
    this.me?.label.remove()
    for (const r of this.remotes.values()) {
      r.avatar?.dispose()
      r.label.remove()
    }
    this.remotes.clear()
    this.post?.dispose()
    this.screen.dispose()
    this.lighting.dispose()
    this.assets.dispose()
    this.renderer.renderLists.dispose()
    this.renderer.dispose()
    // Gives the GPU memory back now instead of whenever the page is collected.
    this.renderer.forceContextLoss()
    this.canvas.remove()
  }
}

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'])
