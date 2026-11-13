/**
 * Alga Worlds: an optional 3D place a call can be in (docs/worlds.md). The call stays what it is (LiveKit room, voice,
 * screen share); a world is a layer on top of it, like the Sala de Cinema and the music of a call. Nothing here carries
 * audio or video.
 *
 * Places. A call's world is in one place at a time:
 *  - the lounge: a built-in shared room, the same for everyone (LOUNGE_ROOM in worlds-catalog.ts);
 *  - a personal room: every account owns one, persistent and customizable (GET/PUT /worlds/rooms/@me). Only its owner can
 *    bring a call into it, and it stays open only while the owner is in that call; who may walk in follows WorldRoom.access.
 * Inviting someone to your room is calling them (DM call or a voice channel) and opening your room there.
 *
 * Realtime (gateway, `world_*` ops and `WORLD_*` dispatches). One session per voice channel, in memory, gone when the call
 * empties. WORLD_STATE (session + who is inside) and WORLD_ROOM (the layout being shown) go to everyone in the call, so
 * the call screen can say "3 pessoas no mundo"; positions (WORLD_TICK) and gestures (WORLD_EMOTE) go only to the people
 * inside. Clients send their own position at most WORLD_MOVE_HZ times a second; the server keeps the latest and fans out
 * what changed every WORLD_TICK_MS. Own quota: WORLD_FRAME_LIMIT frames per 60 s per socket, apart from the general 120.
 * Invalid world frames close with 4003 like any other.
 *
 * Units. Metres, Y up, origin on the floor at the centre of the room, yaw in radians (0 = facing +Z, counter-clockwise
 * seen from above). On the wire, positions of people are integers: centimetres and degrees (WorldPose).
 *
 * Ownership. Every placeable item, finish and avatar part has a SKU in the worlds catalog (worlds-catalog.ts) with a tier:
 * `base` belongs to everyone; `store` / `plus` need an Entitlement with that SKU (billing.ts: the same catalog, checkout,
 * verified-webhook grant and refund as every other cosmetic; nothing in this file grants anything). The server refuses
 * to save a room or an avatar that uses a SKU the account does not hold.
 */
import { z } from 'zod'
import { ECO_ACCENTS } from './eco.js'

export const WORLD_MAX_AVATARS = 16
/** Placed objects in one room. */
export const WORLD_ROOM_MAX_ITEMS = 90
/** Copies of the same SKU in one room. */
export const WORLD_ITEM_MAX_COPIES = 8
export const WORLD_ROOM_NAME_MAX = 40
/** How often a client may send its position, and how often the server fans positions out. */
export const WORLD_MOVE_HZ = 12
export const WORLD_TICK_MS = 100
/** world_* frames per socket per 60 s, counted apart from the general gateway quota (12 Hz of moves is 720). */
export const WORLD_FRAME_LIMIT = 1200
/** Gestures and reactions: a few in a row are fine, then one per second. Over it they are dropped. */
export const WORLD_EMOTE_RATE = { perSecond: 1, burst: 5 } as const
/** The place of a call's world changes at most this often (no tug of war). */
export const WORLD_PLACE_COOLDOWN_MS = 5_000
/** Walking speeds (m/s). The server drops moves that would need more than WORLD_MAX_SPEED (plus slack for jitter). */
export const WORLD_WALK_SPEED = 1.5
export const WORLD_RUN_SPEED = 3.4
export const WORLD_MAX_SPEED = 6

// ---- shells (architecture) -------------------------------------------------------------------------------------------

/**
 * A shell is the architecture of a room: its size, where the windows are and where people arrive. The renderer builds
 * the walls; the server only needs the bounds. `spawns`: [x, z, yaw] where people appear, in order.
 */
export interface WorldShell {
  id: WorldShellId
  /** Inner size in metres: x from -width/2 to +width/2, z from -depth/2 to +depth/2. */
  width: number
  depth: number
  height: number
  spawns: readonly (readonly [number, number, number])[]
}
export const WORLD_SHELL_IDS = ['loft', 'lounge'] as const
export type WorldShellId = (typeof WORLD_SHELL_IDS)[number]
export const WORLD_SHELLS: Readonly<Record<WorldShellId, WorldShell>> = {
  // Personal room: one open living space with a window wall on +Z.
  loft: {
    id: 'loft', width: 10, depth: 8, height: 3.2,
    // In front of the door, a few steps into the room (never in a corner: the camera needs room behind people).
    spawns: [[-3.3, -2.4, 0.6], [-2.4, -2.7, 0.5], [-3.7, -1.5, 0.8], [-1.6, -2.8, 0.3], [-2.8, -1.0, 0.9], [-0.9, -2.6, 0.2], [-3.9, -0.4, 1.0], [-1.9, -1.6, 0.5]],
  },
  // Shared room: wider, two seating groups and a long table.
  lounge: {
    id: 'lounge', width: 14, depth: 10, height: 3.6,
    // The open floor between the long table and the sofas.
    spawns: [[-1.2, -3.0, 0.5], [-0.3, -3.3, 0.4], [-2.0, -2.5, 0.7], [0.5, -3.0, 0.2], [-1.6, -1.7, 0.8], [-0.6, -2.2, 0.5], [-2.6, -3.3, 0.7], [0.2, -2.0, 0.3]],
  },
}
/** People and floor items stay this far from the walls. */
export const WORLD_WALL_MARGIN = 0.3

// ---- rooms -----------------------------------------------------------------------------------------------------------

/**
 * Who may walk into a personal room while its owner has it open in a call: everyone in that call, only the owner's
 * friends, or nobody but the owner. People who blocked the owner (or were blocked) never get in.
 */
export const WORLD_ROOM_ACCESS = ['call', 'friends', 'locked'] as const
export type WorldRoomAccess = (typeof WORLD_ROOM_ACCESS)[number]

/** One placed object. `id` is unique inside the room (the seat ids of the room are `<id>:<n>`). */
export interface WorldPlacedItem {
  id: string
  sku: string
  x: number
  /** Height of its base: 0 on the floor; set for things on a wall, on a piece of furniture or hanging. */
  y: number
  z: number
  /** Yaw in radians. */
  rot: number
  /** Material variant of the item (WorldItemDef.variants); absent = its first one. */
  variant?: string
}

/** Finishes and light of a room: SKUs of the worlds catalog (kinds `floor`, `wall`, `mood`). */
export interface WorldRoomFinish {
  floor: string
  wall: string
  /** A second finish for the wall behind the screen, or null for the same as the others. */
  accentWall: string | null
  mood: string
}

export interface WorldRoomLayout {
  shell: WorldShellId
  finish: WorldRoomFinish
  items: WorldPlacedItem[]
}

/** A personal room as its owner gets and saves it. */
export interface WorldRoom extends WorldRoomLayout {
  ownerId: string
  name: string
  access: WorldRoomAccess
  updatedAt: string
}

const sku = z.string().regex(/^[a-z0-9_]{1,48}$/, 'sku')
const metres = (max: number) => z.number().finite().min(-max).max(max)
const PlacedItemSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]{1,12}$/, 'item id'),
  sku,
  x: metres(50), y: z.number().finite().min(0).max(10), z: metres(50),
  rot: z.number().finite().min(-7).max(7),
  variant: z.string().regex(/^[a-z0-9_]{1,24}$/, 'variant').optional(),
})
const FinishSchema = z.strictObject({ floor: sku, wall: sku, accentWall: sku.nullable(), mood: sku })

/**
 * PUT /worlds/rooms/@me. The whole room every time (it is small). The server checks, beyond this shape: every SKU exists,
 * is of the right kind and is held by the caller; item ids are unique; counts are within the limits; everything is
 * inside the shell.
 */
export const PutWorldRoomBody = z.strictObject({
  name: z.string().trim().min(1).max(WORLD_ROOM_NAME_MAX),
  access: z.enum(WORLD_ROOM_ACCESS),
  finish: FinishSchema,
  items: z.array(PlacedItemSchema).max(WORLD_ROOM_MAX_ITEMS),
})
export type PutWorldRoomBody = z.infer<typeof PutWorldRoomBody>

// ---- avatars ---------------------------------------------------------------------------------------------------------

/**
 * The 3D figure a person wears in a world: an articulated atelier mannequin. Bodies, the joint colour and the outfit
 * colours are closed sets drawn by the client; `finish`, `outfit` and `head` are SKUs of the worlds catalog (kinds
 * `avatar_finish`, `avatar_outfit`, `avatar_head`), so some of them are sold. Saved with PUT /worlds/avatar; others see it
 * in PublicUser.world. Nobody is forced to make one: without it the app derives a figure from the account's Eco.
 */
export const WORLD_BODIES = ['a', 'b'] as const
export type WorldBody = (typeof WORLD_BODIES)[number]
/** Fabric colours of an outfit (the client owns the swatches; index into WORLD_FABRICS). */
export const WORLD_FABRICS = [
  '#f2efe8', '#d9d2c5', '#b8ad9c', '#8a8377', '#4a4844', '#1d1d1f',
  '#2b3a55', '#3f5d7a', '#6f8f8a', '#55664a', '#a8553f', '#c98e52',
  '#d7b5a1', '#7d4f5f', '#5a4a78', '#8b8ef7',
] as const
const fabric = z.number().int().min(0).max(WORLD_FABRICS.length - 1)
export const WorldAvatarSchema = z.strictObject({
  body: z.enum(WORLD_BODIES),
  finish: sku,
  /** Colour of the joints: one of the Eco accents, so the figure keeps the person's colour. */
  accent: z.enum(ECO_ACCENTS),
  outfit: sku,
  /** Fabric colours of the outfit's three parts. Parts the outfit does not have are ignored. */
  top: fabric, bottom: fabric, shoes: fabric,
  head: sku,
})
export type WorldAvatar = z.infer<typeof WorldAvatarSchema>
/** PUT /worlds/avatar: the avatar, or null to go back to the automatic one. */
export const PutWorldAvatarBody = z.strictObject({ avatar: WorldAvatarSchema.nullable() })
export type PutWorldAvatarBody = z.infer<typeof PutWorldAvatarBody>

// ---- sessions --------------------------------------------------------------------------------------------------------

export type WorldPlace = { kind: 'lounge' } | { kind: 'room'; ownerId: string }

/** How a person is moving, for the animation of their figure. */
export const WORLD_GAITS = { idle: 0, walk: 1, run: 2 } as const
export type WorldGait = (typeof WORLD_GAITS)[keyof typeof WORLD_GAITS]
/** [x cm, z cm, yaw degrees, gait]: integers. */
export type WorldPose = [number, number, number, WorldGait]

/** Things a figure does on request. `dance` and the poses loop until the person moves or picks another. */
export const WORLD_GESTURES = ['wave', 'yes', 'no', 'dance', 'fold', 'phone', 'drink', 'point'] as const
export type WorldGesture = (typeof WORLD_GESTURES)[number]
export const WORLD_REACTIONS = ['😂', '😍', '👏', '🔥', '😮', '👋'] as const
export type WorldReaction = (typeof WORLD_REACTIONS)[number]
export type WorldEmote = { kind: 'gesture'; id: WorldGesture } | { kind: 'reaction'; id: WorldReaction }

export interface WorldMember {
  userId: string
  /** Short key of this person in WORLD_TICK, stable while they are inside. */
  k: number
  pose: WorldPose
  /** Seat they are on (`<item id>:<n>`), or null. A seated person does not move. */
  seat: string | null
  /** Looping gesture they are in (dance, fold, phone), or null. */
  loop: WorldGesture | null
}

/** The world of a call. */
export interface WorldSession {
  channelId: string
  place: WorldPlace
  /** Who opened it. */
  hostId: string
  /** People inside, in order of arrival. */
  members: WorldMember[]
  /** Whose screen share is on the screens of the room; null = automatic (the only one sharing, else the latest). */
  tv: string | null
  /** Grows on every change of this view. */
  seq: number
}

/** The room a call's world is showing: WorldRoomLayout plus what the screen needs to name it. */
export interface WorldRoomView extends WorldRoomLayout {
  channelId: string
  place: WorldPlace
  name: string
  /** Personal rooms only. */
  access?: WorldRoomAccess
  /** Changes whenever the layout does (the client rebuilds the scene only then). */
  rev: number
}

export type WorldErrorReason =
  | 'disabled' | 'not_in_call' | 'no_session' | 'forbidden' | 'locked' | 'friends_only' | 'full' | 'not_inside'
  | 'seat_taken' | 'not_found' | 'slow_down' | 'invalid'

export type WorldClientFrame =
  /** Ask for the WORLD_STATE (and WORLD_ROOM) of a call I am in. */
  | { op: 'world_hello'; channelId: string }
  /** Open the call's world in a place, or move it there. A personal room: only your own. */
  | { op: 'world_open'; channelId: string; place: WorldPlace }
  /** Walk in (become a figure in the room). */
  | { op: 'world_enter'; channelId: string }
  | { op: 'world_leave'; channelId: string }
  | { op: 'world_move'; channelId: string; p: WorldPose }
  | { op: 'world_sit'; channelId: string; seat: string }
  | { op: 'world_stand'; channelId: string; p: WorldPose }
  | { op: 'world_emote'; channelId: string; emote: WorldEmote }
  /** Stop a looping gesture. */
  | { op: 'world_rest'; channelId: string }
  /** Put someone's screen share on the room's screens (null = automatic). */
  | { op: 'world_tv'; channelId: string; userId: string | null }

const uuid = z.uuid()
const PoseSchema = z.tuple([
  z.number().int().min(-5000).max(5000), z.number().int().min(-5000).max(5000),
  z.number().int().min(-360).max(360), z.union([z.literal(0), z.literal(1), z.literal(2)]),
])
const PlaceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('lounge') }),
  z.strictObject({ kind: z.literal('room'), ownerId: uuid }),
])
const seat = z.string().regex(/^[a-z0-9]{1,12}:\d{1,2}$/, 'seat id')
const EmoteSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('gesture'), id: z.enum(WORLD_GESTURES) }),
  z.strictObject({ kind: z.literal('reaction'), id: z.enum(WORLD_REACTIONS) }),
])
export const WorldClientFrameSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('world_hello'), channelId: uuid }),
  z.object({ op: z.literal('world_open'), channelId: uuid, place: PlaceSchema }),
  z.object({ op: z.literal('world_enter'), channelId: uuid }),
  z.object({ op: z.literal('world_leave'), channelId: uuid }),
  z.object({ op: z.literal('world_move'), channelId: uuid, p: PoseSchema }),
  z.object({ op: z.literal('world_sit'), channelId: uuid, seat }),
  z.object({ op: z.literal('world_stand'), channelId: uuid, p: PoseSchema }),
  z.object({ op: z.literal('world_emote'), channelId: uuid, emote: EmoteSchema }),
  z.object({ op: z.literal('world_rest'), channelId: uuid }),
  z.object({ op: z.literal('world_tv'), channelId: uuid, userId: uuid.nullable() }),
])

/** READY.worlds: the server has Alga Worlds on, and this is where the 3D asset pack is (no trailing slash). */
export interface WorldsReady {
  assetsUrl: string
}

/** Gestures that keep going until the person moves, sits or picks another. */
export const WORLD_LOOP_GESTURES: readonly WorldGesture[] = ['dance', 'fold', 'phone']

// ---- helpers shared by client and server -----------------------------------------------------------------------------

export const toPose = (x: number, z: number, yaw: number, gait: WorldGait = 0): WorldPose =>
  [Math.round(x * 100), Math.round(z * 100), Math.round((yaw * 180) / Math.PI) % 360, gait]

/** A pose kept inside a shell (people cannot stand in the walls). */
export function clampPose(p: WorldPose, shell: WorldShell): WorldPose {
  const mx = Math.round((shell.width / 2 - WORLD_WALL_MARGIN) * 100)
  const mz = Math.round((shell.depth / 2 - WORLD_WALL_MARGIN) * 100)
  return [Math.min(mx, Math.max(-mx, p[0])), Math.min(mz, Math.max(-mz, p[1])), p[2], p[3]]
}

/** Where the n-th person arrives. */
export function spawnPose(shell: WorldShell, n: number): WorldPose {
  const s = shell.spawns[n % shell.spawns.length]!
  return toPose(s[0], s[1], s[2])
}
