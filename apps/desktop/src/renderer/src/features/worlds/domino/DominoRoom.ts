/**
 * Dominoes in a room: every domino table of the layout, what the server says about each, and the person at the
 * keyboard playing at the one they sit at. Sitting on a chair of a table is being at its game; the 3D engine hands this
 * its input and its camera for as long as they sit there.
 *
 * Playing, as the person does it: the tiles that fit glow. Drag one to an end of the line, or click it (when it fits
 * both ends, click the end). With the keys: left and right choose a tile, Enter plays it. Drag anywhere else to look
 * round the table, the wheel moves in and out, V looks from above.
 */
import * as THREE from 'three'
import { DOMINO_BOT, DOMINO_SEATS, dominoEnds, dominoPlace, dominoViewMoves, worldItem, type DominoView } from '@alga/shared'
import type { Assets } from '../assets/loaders'
import type { BuiltItem } from '../engine/items'
import { DominoTable } from './DominoTable'
import { RACK_D, SEAT_DIRS, TOP_Y, chainArms, chainNext } from './layout'
import { DominoSound } from './sound'

export interface DominoUi {
  /** The table I sit at. */
  table: string | null
  /** My chair there. */
  seat: number
  /** A tile of mine is picked up and waits for me to say which end. */
  choosing: boolean
  /** The tile under the pointer or the keys. */
  focus: number | null
  top: boolean
}

export interface DominoHooks {
  onPlay?(table: string, seq: number, tile: number, end: 0 | 1): void
  onUi?(ui: DominoUi): void
  /** What a bot on chair `seat` is called. */
  botName?(seat: number): string
  /** What is said over whoever passes. */
  passText?(): string
}

export interface DominoHost {
  assets: Assets
  camera: THREE.PerspectiveCamera
  meId(): string | null
  /** The seat I sit on (`<item id>:<n>`), or null. */
  mySeat(): string | null
  /** Keeps a camera position inside the walls. */
  inRoom(p: THREE.Vector3): THREE.Vector3
  /** A name tag in the overlay, for a chair nobody's figure sits on. */
  tag(): HTMLElement
  /** A short line over someone's figure. */
  say(userId: string, text: string): void
  cursor(kind: 'pointer' | 'grabbing' | ''): void
  reducedMotion(): boolean
  hooks: DominoHooks
}

interface Mine {
  table: DominoTable
  seat: number
}

const UP = new THREE.Vector3(0, 1, 0)
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3()
const clamp = THREE.MathUtils.clamp

/** The game after I play `tile`, as far as this app can tell before the server says. */
function played(v: DominoView, seat: number, tile: number, end: 0 | 1): DominoView {
  const counts = v.counts.slice()
  counts[seat] = Math.max(0, (counts[seat] ?? 1) - 1)
  let turn = seat
  for (let d = 1; d <= DOMINO_SEATS; d++) {
    if (v.playing[(seat + d) % DOMINO_SEATS]) {
      turn = (seat + d) % DOMINO_SEATS
      break
    }
  }
  return {
    ...v, ...dominoPlace(v.line, v.origin, tile, end), hand: (v.hand ?? []).filter((t) => t !== tile), counts, turn, seq: v.seq + 1, must: null,
    last: { k: 'play', seat, tile, end }, auto: null,
  }
}

export class DominoRoom {
  private readonly tables = new Map<string, DominoTable>()
  /** The server's word on each table, and what is shown (mine may be one play ahead of the server). */
  private server = new Map<string, DominoView>()
  private shown = new Map<string, DominoView>()
  private rev = -1
  private readonly sound = new DominoSound()
  private readonly raycaster = new THREE.Raycaster()
  private readonly tags = new Map<string, HTMLElement>()
  private mine: Mine | null = null
  /** A tile picked up that fits both ends: which it could go to, and which the keys are on. */
  private sel: { tile: number; end: 0 | 1 } | null = null
  private focus: number | null = null
  private drag: { tile: number | null; x: number; y: number; moved: boolean } | null = null
  private ui = ''
  private turnMine = false
  // Camera: elevation, distance, a turn round the table, and the look from above.
  private pitch = 0.88
  private dist = 1.06
  private yaw = 0
  private top = false
  private camReady = false
  private readonly camPos = new THREE.Vector3()
  private readonly camAt = new THREE.Vector3()

  constructor(private readonly host: DominoHost) {}

  // ---- tables --------------------------------------------------------------------------------------------------------

  /** The room was built: one view per domino table in it. */
  setItems(items: Iterable<BuiltItem>): void {
    const list = [...items].filter((it) => worldItem(it.placed.sku)?.game === 'domino')
    // Called again whenever a piece moves in the editor: the same tables keep their views.
    if (list.length === this.tables.size && list.every((it) => this.tables.get(it.placed.id)?.root.parent === it.object)) return
    for (const t of this.tables.values()) t.dispose()
    this.tables.clear()
    this.mine = null
    for (const it of list) {
      const t = new DominoTable(it.placed.id, it.object, this.host.assets, this.sound)
      t.reducedMotion = this.host.reducedMotion()
      t.apply(this.shown.get(t.id) ?? null, this.seatAt(t.id), true)
      this.tables.set(t.id, t)
    }
    this.sync()
  }

  /**
   * What the server says about the tables of this room (a table it does not mention has nobody at it). `rev` changes
   * when everything has to be shown again as the server has it (a play of mine was refused).
   */
  setViews(views: readonly DominoView[], rev = 0): void {
    const next = new Map(views.map((v) => [v.table, v]))
    const again = rev !== this.rev
    this.rev = rev
    for (const id of new Set([...this.server.keys(), ...next.keys()])) {
      const v = next.get(id) ?? null
      // The same word as before: what is shown stays (it may be my own play, one step ahead).
      if (!again && v === (this.server.get(id) ?? null)) continue
      this.show(id, v)
    }
    this.server = next
  }

  private show(id: string, v: DominoView | null): void {
    const before = this.shown.get(id)
    if (v) this.shown.set(id, v)
    else this.shown.delete(id)
    const t = this.tables.get(id)
    if (!t) return
    t.reducedMotion = this.host.reducedMotion()
    t.apply(v, this.seatAt(id))
    // Someone passed: a word over their head (a bot has no figure, its name tag says it).
    if (v && before && v.seq > before.seq && v.last?.k === 'pass') {
      const who = v.seats[v.last.seat]
      const text = this.host.hooks.passText?.() ?? ''
      if (who && who !== DOMINO_BOT && text) this.host.say(who, text)
    }
    if (this.mine?.table === t && this.sel && !this.movesOf(this.sel.tile).length) this.sel = null
  }

  /** My chair at table `id` (-1: I do not sit there). */
  private seatAt(id: string): number {
    const seat = this.host.mySeat()
    return seat?.startsWith(`${id}:`) ? Number(seat.slice(id.length + 1)) : -1
  }

  /** Finds the table I sit at (or that I sit at none). */
  private sync(): void {
    let mine: Mine | null = null
    for (const t of this.tables.values()) {
      const seat = this.seatAt(t.id)
      if (seat >= 0) mine = { table: t, seat }
    }
    if (mine?.table === this.mine?.table && mine?.seat === this.mine?.seat) return
    this.mine?.table.setLampVisible(true)
    this.mine?.table.setGhosts([])
    for (const t of this.tables.values()) {
      const seat = t === mine?.table ? mine.seat : -1
      // The tiles of the chair I took (or left) turn to face me (or stop doing so).
      if (t.mySeat !== seat) t.apply(this.shown.get(t.id) ?? null, seat)
    }
    this.mine = mine
    mine?.table.setLampVisible(false)
    this.sel = null
    this.focus = null
    this.drag = null
    this.top = false
    this.pitch = 0.88
    this.dist = 1.06
    this.yaw = 0
    this.camReady = false
    this.host.cursor('')
  }

  private view(): DominoView | null {
    return this.mine ? this.shown.get(this.mine.table.id) ?? null : null
  }

  /** The ends `tile` of my hand could be played on right now. */
  private movesOf(tile: number): (0 | 1)[] {
    const v = this.view()
    if (!v || !this.mine) return []
    return dominoViewMoves(v, this.mine.seat).filter((m) => m[0] === tile).map((m) => m[1])
  }

  private playable(): number[] {
    const v = this.view()
    if (!v || !this.mine) return []
    const can = new Set(dominoViewMoves(v, this.mine.seat).map((m) => m[0]))
    return (v.hand ?? []).filter((t) => can.has(t))
  }

  // ---- what the engine asks ------------------------------------------------------------------------------------------

  /** I sit at a table (the camera and the pointer are the game's). */
  get seated(): boolean {
    return this.mine !== null
  }

  /** I am in a round: the keys that walk do not stand me up. */
  get capturing(): boolean {
    const v = this.view()
    return !!v && !!this.mine && v.phase === 'play' && !!v.playing[this.mine.seat]
  }

  get digest(): string {
    const v = this.view()
    const mine = this.mine && v ? `|${this.mine.seat}:${v.turn}:${this.playable().length}:${this.sel ? 1 : 0}` : ''
    return [...this.tables.values()].map((t) => t.digest).join(',') + mine
  }

  toggleTop(): void {
    if (!this.mine) return
    this.top = !this.top
    this.yaw = 0
  }

  // ---- playing --------------------------------------------------------------------------------------------------------

  private play(tile: number, end: 0 | 1): void {
    const v = this.view()
    if (!v || !this.mine || !this.movesOf(tile).includes(end)) return
    this.host.hooks.onPlay?.(v.table, v.seq, tile, end)
    // Shown at once; the server's word replaces it when it comes (and puts the tile back if it says no).
    this.sel = null
    this.focus = null
    this.show(v.table, played(v, this.mine.seat, tile, end))
  }

  /** A tile of mine was clicked or chosen with the keys. */
  private choose(tile: number): void {
    const v = this.view()
    const ends = this.movesOf(tile)
    if (!v || !ends.length) return
    const open = dominoEnds(v.line)
    if (ends.length === 1 || !open) return this.play(tile, ends[0]!)
    // The same number on both ends: it makes no difference to the game, so the shorter side takes it.
    if (open[0] === open[1]) {
      const [left, right] = chainArms(v.line, v.origin)
      return this.play(tile, left < right ? 0 : 1)
    }
    this.sel = this.sel?.tile === tile ? null : { tile, end: 1 }
  }

  private ray(ndc: THREE.Vector2): THREE.Ray {
    this.raycaster.setFromCamera(ndc, this.host.camera)
    return this.raycaster.ray
  }

  pointerDown(e: PointerEvent, ndc: THREE.Vector2): boolean {
    if (!this.mine) return false
    const tile = e.button === 0 ? this.mine.table.pickHand(this.ray(ndc)) : null
    this.drag = { tile: tile !== null && this.movesOf(tile).length ? tile : null, x: e.clientX, y: e.clientY, moved: false }
    return true
  }

  pointerMove(e: PointerEvent, ndc: THREE.Vector2): boolean {
    const mine = this.mine
    if (!mine) return false
    const d = this.drag
    if (!d) {
      const tile = mine.table.pickHand(this.ray(ndc))
      const can = tile !== null && this.movesOf(tile).length > 0
      if (can) this.focus = tile
      this.host.cursor(can || (this.sel && mine.table.pickGhost(this.ray(ndc)) !== null) ? 'pointer' : '')
      return false
    }
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 6) return true
    d.moved = true
    if (d.tile === null) {
      // Looking round the table.
      d.x = e.clientX
      d.y = e.clientY
      this.top = false
      this.yaw = clamp(this.yaw - dx * 0.005, -1.35, 1.35)
      this.pitch = clamp(this.pitch + dy * 0.004, 0.45, 1.45)
      return true
    }
    // Carrying a tile over the table.
    const at = mine.table.tablePoint(this.ray(ndc), TOP_Y + 0.045, v1)
    if (at) {
      at.x = clamp(at.x, -0.46, 0.46)
      at.z = clamp(at.z, -0.46, 0.46)
      mine.table.hold(d.tile, at)
    }
    this.sel = { tile: d.tile, end: this.nearestEnd(d.tile, at) }
    this.host.cursor('grabbing')
    return true
  }

  pointerUp(ndc: THREE.Vector2): boolean {
    const mine = this.mine, d = this.drag
    this.drag = null
    if (!mine || !d) return false
    this.host.cursor('')
    if (d.tile !== null && d.moved) {
      const at = mine.table.tablePoint(this.ray(ndc), TOP_Y + 0.045, v1)
      const [sx, sz] = SEAT_DIRS[mine.seat]!
      // Let go over the table (not back over my own tiles): it goes to the nearer end it fits.
      const over = !!at && at.x * sx + at.z * sz < RACK_D - 0.07
      const end = this.nearestEnd(d.tile, at)
      this.sel = null
      if (over) this.play(d.tile, end)
      else mine.table.hold(null)
      return true
    }
    if (d.tile !== null) {
      this.choose(d.tile)
    } else if (!d.moved && this.sel) {
      // Choosing an end: a click on one of the outlines plays there, a click anywhere else puts the tile back.
      const hit = mine.table.pickGhost(this.ray(ndc))
      const ends = this.movesOf(this.sel.tile)
      if (hit !== null && ends[hit] !== undefined) this.play(this.sel.tile, ends[hit])
      else this.sel = null
    }
    return true
  }

  /** The end `tile` fits that is nearer to a point of the table (the right end when it cannot be told). */
  private nearestEnd(tile: number, at: THREE.Vector3 | null): 0 | 1 {
    const v = this.view()
    const ends = this.movesOf(tile)
    if (!v || ends.length < 2 || !at) return ends[0] ?? 1
    const d = (end: 0 | 1): number => {
      const s = chainNext(v.line, v.origin, tile, end)
      return Math.hypot(s.x - at.x, s.z - at.z)
    }
    return d(0) < d(1) ? 0 : 1
  }

  wheel(e: WheelEvent): boolean {
    if (!this.mine) return false
    this.top = false
    this.dist = clamp(this.dist * Math.exp(e.deltaY * 0.001), 0.7, 1.9)
    return true
  }

  keyDown(e: KeyboardEvent): boolean {
    if (!this.mine) return false
    const k = e.code
    if (k === 'KeyV' && !e.repeat) {
      this.toggleTop()
      return true
    }
    if (k === 'Escape' && this.sel) {
      this.sel = null
      return true
    }
    if (!this.capturing) return false
    const can = this.playable()
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'KeyA' || k === 'KeyD') {
      const step = k === 'ArrowLeft' || k === 'KeyA' ? -1 : 1
      if (this.sel) this.sel = { tile: this.sel.tile, end: this.sel.end === 0 ? 1 : 0 }
      else if (can.length) {
        const i = this.focus === null ? -1 : can.indexOf(this.focus)
        this.focus = can[i < 0 ? (step > 0 ? 0 : can.length - 1) : (i + step + can.length) % can.length]!
      }
      return true
    }
    if (k === 'Enter' || k === 'Space') {
      if (e.repeat) return true
      if (this.sel) this.play(this.sel.tile, this.sel.end)
      else if (can.length) this.choose(this.focus !== null && can.includes(this.focus) ? this.focus : can[0]!)
      return true
    }
    // In a round the keys that walk do nothing: getting up is E, on purpose.
    return k === 'KeyW' || k === 'KeyS' || k === 'ArrowUp' || k === 'ArrowDown'
  }

  blur(): void {
    if (this.drag?.tile != null) this.mine?.table.hold(null)
    this.drag = null
  }

  // ---- frame ---------------------------------------------------------------------------------------------------------

  update(dt: number): void {
    this.sync()
    const mine = this.mine
    const v = this.view()
    if (mine) {
      const can = v && v.turn === mine.seat && v.phase === 'play' ? new Set(this.playable()) : null
      if (this.focus !== null && !can?.has(this.focus)) this.focus = null
      mine.table.setLook({ playable: can, focus: this.focus, selected: this.sel?.tile ?? null })
      // Where the picked-up tile could go.
      const ends = this.sel && v ? this.movesOf(this.sel.tile) : []
      mine.table.setGhosts(this.sel && v ? ends.map((end) => ({ spot: chainNext(v.line, v.origin, this.sel!.tile, end), hot: ends.length === 1 || end === this.sel!.end })) : [])
      // My tiles lean back enough to face the camera wherever it is.
      mine.table.lean = clamp((this.top ? 1.45 : this.pitch) * 0.85 - 0.12, 0.2, 1)
      const myTurn = !!can && can.size > 0
      if (myTurn && !this.turnMine) this.sound.turn()
      this.turnMine = myTurn
    } else {
      this.turnMine = false
    }
    for (const t of this.tables.values()) {
      // Louder next to the table, down to a murmur across the room.
      const far = t.toRoom(0, TOP_Y, 0, v1).distanceTo(this.host.camera.position)
      t.near = t === mine?.table ? 1 : clamp(1.6 / Math.max(1.6, far), 0.12, 1) * 0.8
      t.update(dt)
    }
    this.updateTags()
    const ui: DominoUi = { table: mine?.table.id ?? null, seat: mine?.seat ?? -1, choosing: !!this.sel && !this.drag, focus: this.sel?.tile ?? this.focus, top: this.top }
    const key = JSON.stringify(ui)
    if (key !== this.ui) {
      this.ui = key
      this.host.hooks.onUi?.(ui)
    }
  }

  /** A name over each chair a bot plays on. */
  private updateTags(): void {
    const seen = new Set<string>()
    const w = this.host.camera.aspect, cam = this.host.camera
    for (const t of this.tables.values()) {
      const v = this.shown.get(t.id)
      for (let seat = 0; seat < DOMINO_SEATS; seat++) {
        if (v?.seats[seat] !== DOMINO_BOT) continue
        const id = `${t.id}:${seat}`
        seen.add(id)
        let el = this.tags.get(id)
        if (!el) {
          el = this.host.tag()
          el.textContent = this.host.hooks.botName?.(seat) ?? 'Bot'
          this.tags.set(id, el)
        }
        const [dx, dz] = SEAT_DIRS[seat]!
        const p = t.toRoom(dx * 0.84, 1.08, dz * 0.84, v1)
        const dist = p.distanceTo(cam.position)
        p.project(cam)
        const box = el.parentElement
        if (!box || p.z > 1 || p.z < -1 || dist > 16 || !w) {
          el.style.display = 'none'
          continue
        }
        el.style.display = ''
        el.style.transform = `translate(-50%, -100%) translate(${((p.x + 1) / 2) * box.clientWidth}px, ${((1 - p.y) / 2) * box.clientHeight}px)`
      }
    }
    for (const [id, el] of this.tags) {
      if (seen.has(id)) continue
      el.remove()
      this.tags.delete(id)
    }
  }

  /** Puts the camera over my place at the table. False when I sit at none (the engine's own camera is used). */
  camera(dt: number): boolean {
    const mine = this.mine
    if (!mine) return false
    const cam = this.host.camera
    const [sx, sz] = SEAT_DIRS[mine.seat]!
    const pitch = this.top ? 1.5 : this.pitch
    const dist = this.top ? 1.42 : this.dist
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw)
    // From my side of the table, turned by however much I looked round.
    const bx = sx * cos + sz * sin, bz = -sx * sin + sz * cos
    const flat = Math.cos(pitch) * dist
    // A little towards me from the middle, so my own tiles are in the picture.
    const lead = this.top ? 0.02 : 0.13
    const at = mine.table.toRoom(sx * lead, TOP_Y, sz * lead, v1)
    const pos = mine.table.toRoom(sx * lead + bx * flat, TOP_Y + Math.sin(pitch) * dist, sz * lead + bz * flat, v2)
    this.host.inRoom(pos)
    if (!this.camReady) {
      this.camReady = true
      this.camPos.copy(cam.position)
      this.camAt.copy(cam.position).add(cam.getWorldDirection(v3).multiplyScalar(2))
    }
    const k = 1 - Math.exp(-dt * 7)
    this.camPos.lerp(pos, k)
    this.camAt.lerp(at, k)
    cam.position.copy(this.camPos)
    // Straight down there is no "up" but the far side of the table.
    const s = THREE.MathUtils.smoothstep(pitch, 1.2, 1.5)
    const far = mine.table.toRoom(-bx, 0, -bz, v3).sub(mine.table.toRoom(0, 0, 0, v2)).normalize()
    cam.up.copy(UP).multiplyScalar(1 - s).addScaledVector(far, s).normalize()
    cam.lookAt(this.camAt)
    return true
  }

  dispose(): void {
    for (const t of this.tables.values()) t.dispose()
    this.tables.clear()
    for (const el of this.tags.values()) el.remove()
    this.tags.clear()
    this.mine = null
  }
}
