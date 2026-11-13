/**
 * One person in the room. The body is a clone of the mannequin of the asset pack with its own skeleton; what it does
 * is a blend of a few looping clips (stand, walk, jog, sit, talk, dance…) chosen from how the person is moving, plus
 * small gestures made in code on top (a wave, a nod), so they work standing or seated alike.
 */
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import type { WorldAvatar, WorldGesture } from '@alga/shared'
import type { BodyAsset } from '../../assets/loaders'
import { turn } from '../collision'
import type { SeatSpot } from '../items'
import { LIVE_LAYER } from '../lighting'
import { buildGear, disposeGear, type HeadBox } from './gear'
import { applyLook, bodyMaterial, jointsMaterial, lookOf, prepareBody } from './look'

export interface AvatarKit {
  body: BodyAsset
  clips: Map<string, THREE.AnimationClip>
  blob: THREE.Texture
}

export interface AvatarInput {
  x: number
  z: number
  yaw: number
  /** 0 standing, 1 walking, 2 running. */
  gait: number
  /** Metres per second, for the pace of the stride. */
  speed: number
  seat: SeatSpot | null
  loop: WorldGesture | null
  /** 0..1, how loud the person is right now. */
  voice: number
}

const LOOPS: Partial<Record<WorldGesture, string>> = { dance: 'dance', fold: 'idle_fold', phone: 'idle_phone' }
const WALK_PACE = 1.45
const JOG_PACE = 3.1
/** How far below the hip joint the body ends when seated. */
const SEAT_PAD = 0.1
const ONE_SHOT_S: Partial<Record<WorldGesture, number>> = { wave: 2.3, yes: 1.5, no: 1.6, drink: 2.6, point: 1.9 }

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3()
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion()
const smooth = (t: number) => t * t * (3 - 2 * t)

/**
 * Gets a body of the pack ready to be cloned, once: smooth shading and the panels of the body (look.ts). The larger
 * surface is the body, the other one the joints (the pack names their materials; this also survives a rename).
 */
const READY = new WeakSet<THREE.Object3D>()
export function prepareTemplate(template: THREE.Object3D, own: (g: THREE.BufferGeometry) => THREE.BufferGeometry): void {
  if (READY.has(template)) return
  READY.add(template)
  const skinned: THREE.SkinnedMesh[] = []
  template.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh)
  })
  const size = (m: THREE.SkinnedMesh) => m.geometry.index?.count ?? m.geometry.getAttribute('position').count
  const body = skinned.find((m) => (m.material as THREE.Material).name === 'body') ?? [...skinned].sort((a, b) => size(b) - size(a))[0]
  for (const mesh of skinned) {
    mesh.geometry = own(prepareBody(mesh.geometry, mesh.skeleton, mesh === body))
    mesh.userData.body = mesh === body
  }
}

/** Measures the head of a body in its rest pose, in the figure's upright frame. Once per body. */
const HEADS = new WeakMap<THREE.Object3D, HeadBox>()
function headBox(template: THREE.Object3D): HeadBox {
  let h = HEADS.get(template)
  if (h) return h
  template.updateMatrixWorld(true)
  const box = new THREE.Box3()
  template.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    const pos = mesh.geometry.getAttribute('position')
    const idx = mesh.geometry.getAttribute('skinIndex')
    const wgt = mesh.geometry.getAttribute('skinWeight')
    const isHead = mesh.skeleton.bones.map((b) => b.name === 'Head')
    // Where a vertex really is comes from the skeleton, not from the raw attribute (the pack stores positions packed
    // into integers, and the bind matrices undo that): ask the mesh itself, in its rest pose.
    mesh.skeleton.update()
    for (let i = 0; i < pos.count; i++) {
      let w = 0
      for (let c = 0; c < 4; c++) if (isHead[idx.getComponent(i, c)]) w += wgt.getComponent(i, c)
      if (w > 0.85) box.expandByPoint(mesh.getVertexPosition(i, v1).applyMatrix4(mesh.matrixWorld))
    }
  })
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.09, 1.58, -0.1), new THREE.Vector3(0.09, 1.82, 0.1))
  h = { centre: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()) }
  HEADS.set(template, h)
  return h
}

export class Avatar {
  readonly root = new THREE.Group()
  private readonly model: THREE.Object3D
  private readonly mixer: THREE.AnimationMixer
  private readonly actions = new Map<string, THREE.AnimationAction>()
  private readonly weights = new Map<string, number>()
  private readonly bones = new Map<string, THREE.Bone>()
  private readonly body: THREE.MeshStandardMaterial
  private readonly joints: THREE.MeshStandardMaterial
  private readonly headAnchor = new THREE.Group()
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  private readonly shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private gear: THREE.Group | null = null
  private readonly head: HeadBox
  private spec: WorldAvatar
  private talkFor = 0
  private shot: { id: WorldGesture; t: number; d: number } | null = null
  private sitHip = 0.5
  /** How far behind (or ahead of) the figure's origin the hips are in the seated clip. */
  private sitBack = 0
  private ringLevel = 0
  private placed = false

  constructor(private readonly kit: AvatarKit, spec: WorldAvatar) {
    this.spec = spec
    this.head = headBox(kit.body.scene)
    this.model = cloneSkinned(kit.body.scene)
    this.root.add(this.model)
    const look = lookOf(spec)
    this.body = bodyMaterial(look)
    this.joints = jointsMaterial(look)
    const skinned: THREE.SkinnedMesh[] = []
    this.model.traverse((o) => {
      const b = o as THREE.Bone
      if (b.isBone) this.bones.set(b.name, b)
      const mesh = o as THREE.SkinnedMesh
      if (mesh.isSkinnedMesh) skinned.push(mesh)
    })
    for (const mesh of skinned) {
      if (mesh.userData.body === true) {
        mesh.material = this.body
      } else {
        mesh.material = this.joints
      }
      mesh.castShadow = true
      mesh.receiveShadow = true
      // Bounds of a skinned mesh follow its rest pose, not the animation.
      mesh.frustumCulled = false
    }

    // A frame that follows the head but stays upright like the figure, for what is worn on it.
    const headBone = this.bones.get('Head')
    this.root.updateMatrixWorld(true)
    if (headBone) {
      headBone.add(this.headAnchor)
      this.headAnchor.applyMatrix4(new THREE.Matrix4().copy(headBone.matrixWorld).invert().multiply(this.root.matrixWorld))
    } else {
      this.root.add(this.headAnchor)
    }
    this.wear()

    this.mixer = new THREE.AnimationMixer(this.model)
    for (const [name, clip] of kit.clips) {
      const a = this.mixer.clipAction(clip)
      a.setLoop(THREE.LoopRepeat, Infinity)
      a.enabled = true
      a.setEffectiveWeight(0)
      this.actions.set(name, a)
      this.weights.set(name, 0)
    }
    this.measureSit()
    const idle = this.actions.get('idle')
    if (idle) {
      idle.play()
      idle.setEffectiveWeight(1)
      this.weights.set('idle', 1)
      // Not everyone breathes in step.
      idle.time = Math.random() * idle.getClip().duration
    }

    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), new THREE.MeshBasicMaterial({ map: kit.blob, transparent: true, depthWrite: false, opacity: 0.55 }))
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.y = 0.012
    this.shadow.renderOrder = 1
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.33, 0.36, 48), new THREE.MeshBasicMaterial({ color: look.accent, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }))
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.y = 0.016
    this.ring.renderOrder = 2
    this.root.add(this.shadow, this.ring)
    this.root.traverse((o) => o.layers.set(LIVE_LAYER))
  }

  /** Changes what the figure wears. A different body needs a new Avatar. */
  setSpec(spec: WorldAvatar): void {
    this.spec = spec
    const look = lookOf(spec)
    applyLook(this.body, look)
    this.joints.color.copy(look.accent)
    this.ring.material.color.copy(look.accent)
    this.wear()
  }

  get bodyId(): string {
    return this.spec.body
  }

  /** How strong the contact shadow is (lighter when the room draws real shadows of people). */
  setShadow(opacity: number): void {
    this.shadow.material.opacity = opacity
  }

  private wear(): void {
    if (this.gear) {
      this.headAnchor.remove(this.gear)
      disposeGear(this.gear)
      this.gear = null
    }
    const look = lookOf(this.spec)
    this.gear = buildGear(this.spec.head, this.head, { accent: look.accent, fabric: look.colors[1]! })
    if (this.gear) {
      this.gear.traverse((o) => o.layers.set(LIVE_LAYER))
      this.headAnchor.add(this.gear)
    }
  }

  /**
   * Where the hips are in the seated clip, relative to the figure's origin: their height over the floor, and how far
   * back they sit (the clip was made for someone who stepped back onto a chair). A seat is where the hips go.
   */
  private measureSit(): void {
    const clip = this.kit.clips.get('sit_idle')
    const track = clip?.tracks.find((t) => t.name === 'pelvis.position')
    const rootBone = this.bones.get('root')
    if (!track || track.values.length < 3) return
    v1.set(track.values[0]!, track.values[1]!, track.values[2]!)
    if (rootBone) v1.applyQuaternion(rootBone.quaternion)
    if (v1.y > 0.2 && v1.y < 1) this.sitHip = v1.y
    if (Math.abs(v1.z) < 0.8) this.sitBack = v1.z
  }

  /** One-shot gesture (a wave, a nod). Looping ones come through `update`. */
  gesture(id: WorldGesture): void {
    const d = ONE_SHOT_S[id]
    if (d) this.shot = { id, t: 0, d }
  }

  /** Where a label over the head goes, in world space. */
  labelPoint(target: THREE.Vector3): THREE.Vector3 {
    return this.headAnchor.localToWorld(target.copy(this.head.centre).setY(this.head.centre.y + this.head.size.y / 2 + 0.17))
  }

  update(dt: number, s: AvatarInput): void {
    // Position: people glide to where they are (a seat is a short slide, a walk follows the samples).
    const ty = s.seat ? Math.max(0, s.seat.y - (this.sitHip - SEAT_PAD)) : 0
    const tyaw = s.seat ? s.seat.yaw : s.yaw
    // Seated, the hips (not the origin of the figure) go where the seat is.
    const tx = s.seat ? s.seat.x - Math.sin(tyaw) * this.sitBack : s.x
    const tz = s.seat ? s.seat.z - Math.cos(tyaw) * this.sitBack : s.z
    if (!this.placed) {
      this.root.position.set(tx, ty, tz)
      this.root.rotation.y = tyaw
      this.placed = true
    } else {
      const k = 1 - Math.exp(-dt * (s.seat ? 9 : 18))
      this.root.position.x += (tx - this.root.position.x) * k
      this.root.position.z += (tz - this.root.position.z) * k
      this.root.position.y += (ty - this.root.position.y) * (1 - Math.exp(-dt * 9))
      this.root.rotation.y += turn(this.root.rotation.y, tyaw) * (1 - Math.exp(-dt * 12))
    }

    // Talking has a little hysteresis so a cough does not start a speech.
    this.talkFor = s.voice > 0.07 ? Math.min(0.6, this.talkFor + dt) : Math.max(0, this.talkFor - dt * 0.7)
    const talking = this.talkFor > 0.22
    const loop = s.loop ? LOOPS[s.loop] : undefined
    let base: string
    if (s.seat) base = talking && this.actions.has('sit_talk') ? 'sit_talk' : 'sit_idle'
    else if (s.gait === 2) base = 'jog'
    else if (s.gait === 1) base = 'walk'
    else if (loop && this.actions.has(loop)) base = loop
    else base = talking && this.actions.has('idle_talk') ? 'idle_talk' : 'idle'
    if (!this.actions.has(base)) base = 'idle'

    const walk = this.actions.get('walk'), jog = this.actions.get('jog')
    if (walk) walk.timeScale = THREE.MathUtils.clamp((s.speed || WALK_PACE) / WALK_PACE, 0.65, 1.45)
    if (jog) jog.timeScale = THREE.MathUtils.clamp((s.speed || JOG_PACE) / JOG_PACE, 0.7, 1.3)

    const rate = 1 - Math.exp(-dt * (base.startsWith('sit') ? 6 : 9))
    for (const [name, action] of this.actions) {
      const target = name === base ? 1 : 0
      let w = this.weights.get(name) ?? 0
      if (w === target) continue
      w += (target - w) * rate
      if (Math.abs(target - w) < 0.004) w = target
      this.weights.set(name, w)
      if (w > 0 && !action.isRunning()) action.play()
      action.setEffectiveWeight(w)
      if (w === 0) action.stop()
    }
    this.mixer.update(dt)

    if (this.shot) {
      this.shot.t += dt
      if (this.shot.t >= this.shot.d) this.shot = null
      else this.pose(this.shot.id, this.shot.t, this.shot.d)
    }

    this.ringLevel += (Math.min(1, s.voice * 2.2) - this.ringLevel) * (1 - Math.exp(-dt * (s.voice > this.ringLevel ? 30 : 6)))
    this.ring.material.opacity = this.ringLevel * 0.9
    this.ring.visible = this.ringLevel > 0.01
    this.ring.position.y = 0.016 - this.root.position.y
    this.shadow.position.y = 0.012 - this.root.position.y
  }

  /** A gesture made by aiming the bones of an arm (or turning the head) on top of whatever clip is playing. */
  private pose(id: WorldGesture, t: number, d: number): void {
    const w = smooth(Math.min(1, t / 0.28)) * smooth(Math.min(1, (d - t) / 0.4))
    this.root.updateMatrixWorld(true)
    // The right hand of someone facing +Z is on -X.
    const R = -1
    switch (id) {
      case 'wave':
        this.aim('upperarm_r', 'lowerarm_r', v1.set(R * 0.6, 0.62, 0.22), w)
        this.aim('lowerarm_r', 'hand_r', v1.set(R * (0.12 + 0.36 * Math.sin(t * 9.5)), 1, 0.18), w)
        break
      case 'point':
        this.aim('upperarm_r', 'lowerarm_r', v1.set(R * 0.2, 0.04, 1), w)
        this.aim('lowerarm_r', 'hand_r', v1.set(R * 0.1, 0.08, 1), w)
        break
      case 'drink': {
        const lift = smooth(Math.min(1, t / 0.7)) * smooth(Math.min(1, (d - t) / 0.6))
        this.aim('upperarm_r', 'lowerarm_r', v1.set(R * 0.34, -0.45 + 0.25 * lift, 0.78), w)
        this.aim('lowerarm_r', 'hand_r', v1.set(R * (-0.5 * lift), 0.2 + 0.85 * lift, 0.45), w)
        this.nod('x', -0.2 * lift * w)
        break
      }
      case 'yes':
        this.nod('x', 0.2 * Math.sin(t * 10.5) * w)
        break
      case 'no':
        this.nod('y', 0.34 * Math.sin(t * 8.5) * w)
        break
      default:
        break
    }
  }

  /** Turns `bone` so that it points from itself to `child` along `dir` (in the figure's own frame), by weight `w`. */
  private aim(bone: string, child: string, dir: THREE.Vector3, w: number): void {
    const b = this.bones.get(bone), c = this.bones.get(child)
    if (!b || !c || w <= 0) return
    b.updateWorldMatrix(true, true)
    const want = v2.copy(dir).normalize().applyQuaternion(this.root.getWorldQuaternion(q1))
    const now = v3.subVectors(c.getWorldPosition(new THREE.Vector3()), b.getWorldPosition(new THREE.Vector3())).normalize()
    const delta = q2.setFromUnitVectors(now, want)
    const world = b.getWorldQuaternion(q3)
    const targetWorld = delta.multiply(world)
    const parentWorld = b.parent ? b.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion()
    const local = parentWorld.invert().multiply(targetWorld)
    b.quaternion.slerp(local, w)
    b.updateWorldMatrix(false, true)
  }

  /** Turns the head around one of the figure's own axes. */
  private nod(axis: 'x' | 'y', angle: number): void {
    const h = this.bones.get('Head')
    if (!h || angle === 0) return
    h.updateWorldMatrix(true, false)
    const rootQ = this.root.getWorldQuaternion(q1)
    const ax = (axis === 'x' ? v1.set(1, 0, 0) : v1.set(0, 1, 0)).applyQuaternion(rootQ)
    const world = h.getWorldQuaternion(q3)
    const targetWorld = q2.setFromAxisAngle(ax, angle).multiply(world)
    const parentWorld = h.parent ? h.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion()
    h.quaternion.copy(parentWorld.invert().multiply(targetWorld))
  }

  /** Puts the figure somewhere at once (no glide). */
  teleport(): void {
    this.placed = false
  }

  dispose(): void {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.model)
    this.body.dispose()
    this.joints.dispose()
    if (this.gear) disposeGear(this.gear)
    this.shadow.geometry.dispose()
    this.shadow.material.dispose()
    this.ring.geometry.dispose()
    this.ring.material.dispose()
    this.root.removeFromParent()
  }
}
