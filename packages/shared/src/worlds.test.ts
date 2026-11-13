import { describe, expect, it } from 'vitest'
import { ECO_ACCENTS } from './eco.js'
import {
  PutWorldRoomBody, WORLD_FABRICS, WORLD_SHELLS, WorldAvatarSchema, WorldClientFrameSchema, clampPose, spawnPose, toPose,
  type WorldRoomLayout,
} from './worlds.js'
import {
  LOUNGE_ROOM, STARTER_ROOM, WORLD_CATALOG, WORLD_PAID_SKUS, avatarProblem, defaultWorldAvatar, holdsWorldSku, roomProblem,
  roomSeats, seatPlace, worldEntries, worldEntry, worldItem,
} from './worlds-catalog.js'

const NOTHING = new Set<string>()

describe('worlds catalog', () => {
  it('has unique SKUs that fit the wire format, and every paid one is marked', () => {
    const skus = WORLD_CATALOG.map((e) => e.sku)
    expect(new Set(skus).size).toBe(skus.length)
    for (const s of skus) expect(s).toMatch(/^[a-z0-9_]{1,48}$/)
    expect(WORLD_PAID_SKUS.length).toBeGreaterThan(8)
    for (const s of WORLD_PAID_SKUS) expect(worldEntry(s)!.tier).not.toBe('base')
  })

  it('gives everyone a whole room and a whole figure for free', () => {
    const base = (kind: Parameters<typeof worldEntries>[0]) => worldEntries(kind).filter((e) => e.tier === 'base').length
    expect(base('floor')).toBeGreaterThanOrEqual(3)
    expect(base('wall')).toBeGreaterThanOrEqual(5)
    expect(base('mood')).toBe(3)
    expect(base('avatar_finish')).toBeGreaterThanOrEqual(4)
    expect(base('avatar_outfit')).toBeGreaterThanOrEqual(4)
    expect(base('avatar_head')).toBeGreaterThanOrEqual(4)
    const items = worldEntries('item').filter((e) => e.tier === 'base')
    for (const c of ['seating', 'tables', 'storage', 'lighting', 'plants', 'decor', 'rugs', 'media', 'beds']) {
      expect(items.some((i) => i.category === c), c).toBe(true)
    }
    // A screen to watch a shared screen on is never something to buy.
    expect(items.some((i) => i.screen)).toBe(true)
  })

  it('keeps seats inside their piece and screens inside their frame', () => {
    for (const it of worldEntries('item')) {
      for (const s of it.seats ?? []) {
        expect(Math.abs(s[0]), it.sku).toBeLessThanOrEqual(it.size[0] / 2)
        expect(Math.abs(s[1]), it.sku).toBeLessThanOrEqual(it.size[2] / 2)
        expect(s[3], it.sku).toBeGreaterThan(0.3)
      }
      if (it.screen) {
        expect(it.screen[0]).toBeLessThanOrEqual(it.size[0])
        expect(it.screen[0] / it.screen[1]).toBeCloseTo(16 / 9, 1)
      }
    }
  })
})

describe('rooms', () => {
  it('the starter room uses only what everyone has, and saves as it is', () => {
    expect(roomProblem(STARTER_ROOM, NOTHING)).toBeNull()
    const body = PutWorldRoomBody.safeParse({ name: 'Minha sala', access: 'call', finish: STARTER_ROOM.finish, items: STARTER_ROOM.items })
    expect(body.success).toBe(true)
    expect(roomSeats(STARTER_ROOM).size).toBeGreaterThanOrEqual(8)
    expect(STARTER_ROOM.items.some((i) => worldItem(i.sku)?.screen)).toBe(true)
  })

  it('the lounge is valid as a built-in room and needs paid pieces to be copied', () => {
    expect(roomProblem(LOUNGE_ROOM, null)).toBeNull()
    expect(roomProblem(LOUNGE_ROOM, NOTHING)?.reason).toBe('not_owned')
    expect(roomSeats(LOUNGE_ROOM).size).toBeGreaterThanOrEqual(16)
  })

  it('says what is wrong with a layout', () => {
    const base: WorldRoomLayout = { shell: 'loft', finish: STARTER_ROOM.finish, items: [] }
    const one = (sku: string, more: Partial<WorldRoomLayout['items'][number]> = {}) => ({ id: 'a', sku, x: 0, y: 0, z: 0, rot: 0, ...more })
    expect(roomProblem({ ...base, items: [one('w_nope')] }, NOTHING)).toEqual({ reason: 'unknown_sku', sku: 'w_nope' })
    expect(roomProblem({ ...base, items: [one('f_carvalho')] }, NOTHING)).toEqual({ reason: 'wrong_kind', sku: 'f_carvalho' })
    expect(roomProblem({ ...base, items: [one('w_poltrona_lounge')] }, NOTHING)).toEqual({ reason: 'not_owned', sku: 'w_poltrona_lounge' })
    expect(roomProblem({ ...base, items: [one('w_poltrona_lounge')] }, new Set(['w_poltrona_lounge']))).toBeNull()
    expect(roomProblem({ ...base, items: [one('w_sofa_duo', { variant: 'rosa' })] }, NOTHING)?.reason).toBe('unknown_variant')
    expect(roomProblem({ ...base, items: [one('w_sofa_duo'), one('w_pufe_couro')] }, NOTHING)).toEqual({ reason: 'duplicate_id', id: 'a' })
    expect(roomProblem({ ...base, items: [one('w_sofa_duo', { x: 5.2 })] }, NOTHING)).toEqual({ reason: 'out_of_bounds', id: 'a' })
    const nine = Array.from({ length: 9 }, (_, i) => one('w_vaso_gota', { id: `v${i}` }))
    expect(roomProblem({ ...base, items: nine }, NOTHING)).toEqual({ reason: 'too_many_copies', sku: 'w_vaso_gota' })
    expect(roomProblem({ ...base, finish: { ...base.finish, floor: 'f_pedra' } }, NOTHING)).toEqual({ reason: 'not_owned', sku: 'f_pedra' })
    expect(roomProblem({ ...base, finish: { ...base.finish, mood: 'f_carvalho' } }, NOTHING)).toEqual({ reason: 'wrong_kind', sku: 'f_carvalho' })
  })

  it('places a seat in the room following the piece', () => {
    const room = { items: [{ id: 's', sku: 'w_sofa_trio', x: 1, y: 0, z: 2, rot: Math.PI / 2 }] }
    // Facing +X: the left seat (local x = -0.8) is towards +Z.
    const left = seatPlace(room, 's:0')!
    expect(left.x).toBeCloseTo(1.1, 2)
    expect(left.z).toBeCloseTo(2.8, 2)
    expect(left.yaw).toBeCloseTo(Math.PI / 2)
    expect(left.y).toBeCloseTo(0.44)
    expect(seatPlace(room, 's:3')).toBeNull()
    expect(seatPlace(room, 'x:0')).toBeNull()
  })
})

describe('avatars', () => {
  it('derives a steady, free figure from the account, in the colour of its Eco', () => {
    const id = '0192f0c1-7a3e-7c11-9a55-1f2e3d4c5b6a'
    const a = defaultWorldAvatar(id)
    expect(defaultWorldAvatar(id)).toEqual(a)
    expect(WorldAvatarSchema.safeParse(a).success).toBe(true)
    expect(avatarProblem(a, NOTHING)).toBeNull()
    const eco = { accent: ECO_ACCENTS[3], eyes: 'dot', hair: 'none', accessory: 'headset' } as const
    expect(defaultWorldAvatar(id, eco)).toMatchObject({ accent: ECO_ACCENTS[3], head: 'h_headset' })
    expect(a.top).toBeLessThan(WORLD_FABRICS.length)
  })

  it('refuses parts that do not exist, are of another kind or are not held', () => {
    const a = defaultWorldAvatar('x')
    expect(avatarProblem({ ...a, finish: 'a_bronze' }, NOTHING)).toEqual({ field: 'finish', reason: 'not_owned' })
    expect(avatarProblem({ ...a, finish: 'a_bronze' }, new Set(['a_bronze']))).toBeNull()
    expect(avatarProblem({ ...a, head: 'o_basico' }, NOTHING)).toEqual({ field: 'head', reason: 'unknown' })
    expect(avatarProblem({ ...a, outfit: 'o_nada' }, NOTHING)).toEqual({ field: 'outfit', reason: 'unknown' })
    expect(holdsWorldSku('nope', new Set(['nope']))).toBe(false)
  })
})

describe('wire', () => {
  it('poses are integers and stay inside the room', () => {
    expect(toPose(1.234, -2.5, Math.PI / 2, 1)).toEqual([123, -250, 90, 1])
    const loft = WORLD_SHELLS.loft
    expect(clampPose([9999, -9999, 10, 2], loft)).toEqual([470, -370, 10, 2])
    expect(spawnPose(loft, 0)).toEqual(spawnPose(loft, loft.spawns.length))
  })

  it('accepts the world frames and refuses malformed ones', () => {
    const channelId = '0192f0c1-7a3e-7c11-9a55-1f2e3d4c5b6a'
    const ok = [
      { op: 'world_hello', channelId },
      { op: 'world_open', channelId, place: { kind: 'lounge' } },
      { op: 'world_open', channelId, place: { kind: 'room', ownerId: channelId } },
      { op: 'world_move', channelId, p: [10, -20, 90, 1] },
      { op: 'world_sit', channelId, seat: 'sofa:2' },
      { op: 'world_emote', channelId, emote: { kind: 'gesture', id: 'wave' } },
      { op: 'world_emote', channelId, emote: { kind: 'reaction', id: '👏' } },
      { op: 'world_tv', channelId, userId: null },
    ]
    for (const f of ok) expect(WorldClientFrameSchema.safeParse(f).success, f.op).toBe(true)
    const bad = [
      { op: 'world_move', channelId, p: [10.5, 0, 0, 0] },
      { op: 'world_move', channelId, p: [0, 0, 0, 3] },
      { op: 'world_sit', channelId, seat: 'sofa' },
      { op: 'world_emote', channelId, emote: { kind: 'gesture', id: 'moonwalk' } },
      { op: 'world_open', channelId, place: { kind: 'room' } },
    ]
    for (const f of bad) expect(WorldClientFrameSchema.safeParse(f).success, JSON.stringify(f)).toBe(false)
  })
})
