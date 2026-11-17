/**
 * Pool on a table of a world (src/worlds.ts handlePool, rules in packages/shared/src/pool.ts): who may take a cue, that
 * the server plays every shot itself and everyone inside gets the same table, the clock of a shot, and what happens to
 * a game when its players or its table go. People join calls through signed LiveKit webhooks.
 */
import {
  POOL_HEAD_X, simulateShot,
  type AuthResponse, type DispatchOf, type DispatchType, type Invite, type PoolShot, type PoolState, type ReadyPayload, type SpaceSnapshot,
} from '@alga/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RawData } from 'ws'
import { api, connect, postWebhook, register, startServer, type Gateway, type TestServer } from './helpers.js'

type User = AuthResponse & { password: string }

let s: TestServer
beforeAll(async () => {
  s = await startServer()
  s.app.ctx.worlds.start(3_600_000)
  s.app.ctx.worlds.placeCooldownMs = 0
})
afterAll(async () => {
  await s.close()
})

let seq = 0
const voiceEvent = (name: string, channelId: string, identity: string) => ({
  event: name, id: `EV_PL_${++seq}`, createdAt: String(Math.floor(Date.now() / 1000)),
  room: { sid: `RM_${channelId.slice(0, 8)}`, name: `ch_${channelId}` },
  participant: { sid: `PA_PL_${seq}`, identity, name: 'x', joinedAt: String(Math.floor(Date.now() / 1000)) },
})
const quit = (channelId: string, userId: string) => postWebhook(s.app, s.config, voiceEvent('participant_left', channelId, userId))

function settled(gw: Gateway): Promise<void> {
  return new Promise((resolve) => {
    const on = (raw: RawData) => {
      if ((JSON.parse(raw.toString()) as { op: string }).op !== 'heartbeat_ack') return
      gw.ws.off('message', on)
      resolve()
    }
    gw.ws.on('message', on)
    gw.send({ op: 'heartbeat' })
  })
}
async function act(gw: Gateway, frame: Record<string, unknown>, ...watch: Gateway[]): Promise<void> {
  gw.send(frame)
  await settled(gw)
  for (const w of watch) await settled(w)
}
const got = <T extends DispatchType>(gw: Gateway, t: T, from = 0) => gw.events.slice(from).filter((e) => e.t === t).map((e) => e.d as DispatchOf<T>)
/** The last state of the lounge's table `gw` was told (undefined: never told; null: told it is free). */
const table = (gw: Gateway): PoolState | null | undefined => got(gw, 'WORLD_POOL').filter((d) => d.table === 'sin').at(-1)?.pool
const errors = (gw: Gateway, from = 0) => got(gw, 'WORLD_ERROR', from)
/** Test-only reach into a live game: the clock of its last shot. */
const game = (ch: string) =>
  (s.app.ctx.worlds as unknown as { sessions: Map<string, { pools: Map<string, { state: PoolState; busyUntil: number; playedAt: number }> }> }).sessions.get(ch)!.pools.get('sin')!

/** Three members of a space in its voice channel, connected, all inside the lounge (which has the pool table `sin`). */
async function setup() {
  const [a, b, c] = [await register(s.app), await register(s.app), await register(s.app)]
  const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: a.token, body: { name: 'Sinuca' } })).body
  const inv = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: a.token, body: {} })).body
  for (const u of [b, c]) await api(s.app, 'POST', `/invites/${inv.code}`, { token: u.token })
  const ch = space.channels.find((x) => x.type === 'voice')!.id
  for (const u of [a, b, c]) await postWebhook(s.app, s.config, voiceEvent('participant_joined', ch, u.user.id))
  const [ga, gb, gc] = (await Promise.all([a, b, c].map((u) => connect(s.port, u.token)))) as [Gateway, Gateway, Gateway]
  await act(ga, { op: 'world_open', channelId: ch, place: { kind: 'lounge' } }, gb, gc)
  for (const g of [ga, gb, gc]) await act(g, { op: 'world_enter', channelId: ch }, ga, gb, gc)
  const pool = (gw: Gateway, op: 'join' | 'leave' | 'rack', tableId = 'sin') => act(gw, { op: `world_pool_${op}`, channelId: ch, table: tableId }, ga, gb, gc)
  const shoot = (gw: Gateway, n: number, shot: PoolShot, cue?: [number, number]) =>
    act(gw, { op: 'world_pool_shot', channelId: ch, table: 'sin', seq: n, shot, ...(cue ? { cue } : {}) }, ga, gb, gc)
  return { a, b, c, ga, gb, gc, ch, pool, shoot }
}
const BREAK: PoolShot = { dx: 1, dy: 0.01, v: 6.5, a: 0, b: 0.1, e: 0.05 }

describe('pool on a world table', () => {
  it('READY says the server plays pool', async () => {
    const u = await register(s.app)
    const gw = await connect(s.port, u.token)
    expect((gw.events.find((e) => e.t === 'READY')!.d as ReadyPayload).worlds).toMatchObject({ pool: true })
    gw.ws.close()
  })

  it('one person practises, a second starts a match, a third is refused, and everyone inside is told', async () => {
    const { a, b, ga, gb, gc, ch, pool } = await setup()
    await pool(ga, 'join')
    expect(table(gc)).toMatchObject({ table: 'sin', players: [a.user.id], phase: 'play', breaking: true, hand: 'kitchen', shot: 0, last: null })
    const rack = table(gc)!.rack
    await pool(ga, 'join')
    expect(got(gc, 'WORLD_POOL')).toHaveLength(1)
    await pool(gb, 'join')
    expect(table(ga)).toMatchObject({ players: [a.user.id, b.user.id], turn: 0, breaking: true, shot: 0 })
    expect(table(ga)!.rack).not.toBe(rack)
    expect(table(ga)).toEqual(table(gc))
    const before = errors(gc).length
    await pool(gc, 'join')
    expect(errors(gc, before)).toEqual([{ op: 'world_pool_join', reason: 'full' }])
    await act(gc, { op: 'world_pool_join', channelId: ch, table: 'sofa' })
    expect(errors(gc).at(-1)).toEqual({ op: 'world_pool_join', reason: 'not_found' })
  })

  it('plays a shot on the server: the same table for everyone, the shot inside it, and no second shot while it rolls', async () => {
    const { a, b, ga, gb, gc, ch, pool, shoot } = await setup()
    await pool(ga, 'join')
    await pool(gb, 'join')
    const start = table(gc)!
    // Not the other player's turn, not a stale number, not from in front of the head string.
    await shoot(gb, 0, BREAK, [POOL_HEAD_X, 0])
    await shoot(ga, 1, BREAK, [POOL_HEAD_X, 0])
    await shoot(ga, 0, BREAK, [0.2, 0])
    expect(errors(gb).at(-1)).toEqual({ op: 'world_pool_shot', reason: 'invalid' })
    expect(errors(ga).slice(-2)).toEqual([{ op: 'world_pool_shot', reason: 'invalid' }, { op: 'world_pool_shot', reason: 'invalid' }])
    expect(table(gc)).toEqual(start)

    await shoot(ga, 0, BREAK, [POOL_HEAD_X - 0.05, 0.03])
    const after = table(gc)!
    expect(after.shot).toBe(1)
    expect(after.breaking).toBe(false)
    expect(after.last).toMatchObject({ by: a.user.id, shot: BREAK })
    expect(after.last!.from[0]).toEqual([POOL_HEAD_X - 0.05, 0.03])
    expect(after.last!.age).toBeLessThan(1000)
    // What the server sent is what the shared simulation gives for that shot, to the last bit.
    const mine = simulateShot(after.last!.from, BREAK)
    expect(after.last!.ms).toBe(Math.ceil(mine.seconds * 1000))
    expect(after.balls.map((p, i) => (i === 0 || i === 8 ? null : p))).toEqual(mine.balls.map((p, i) => (i === 0 || i === 8 ? null : p)))
    expect({ ...table(ga)!, last: null }).toEqual({ ...after, last: null })

    // The balls are still rolling.
    const next = after.players[after.turn] === a.user.id ? ga : gb
    await shoot(next, 1, { ...BREAK, v: 1 }, after.hand ? [-0.8, 0.3] : undefined)
    expect(errors(next).at(-1)).toEqual({ op: 'world_pool_shot', reason: 'slow_down' })
    await pool(ga, 'rack')
    expect(errors(ga).at(-1)).toEqual({ op: 'world_pool_rack', reason: 'slow_down' })
    // They have stopped.
    game(ch).busyUntil = 0
    await shoot(next, 1, { ...BREAK, v: 1 }, after.hand ? [-0.8, 0.3] : undefined)
    expect(table(gc)!.shot).toBe(2)
    expect(table(gc)!.last!.by).toBe(next === ga ? a.user.id : b.user.id)
    game(ch).busyUntil = 0
    await pool(gb, 'rack')
    expect(table(gc)).toMatchObject({ shot: 0, breaking: true, last: null, players: [a.user.id, b.user.id] })
  })

  it('relays the aim of whoever is about to shoot, to the others only', async () => {
    const { a, ga, gb, gc, ch, pool } = await setup()
    await pool(ga, 'join')
    await pool(gb, 'join')
    const aim = [1, 0, 0.4, 0.1, -0.2, 0.05, POOL_HEAD_X, 0]
    await act(gb, { op: 'world_pool_aim', channelId: ch, table: 'sin', a: aim }, ga, gc)
    expect(got(ga, 'WORLD_POOL_AIM')).toHaveLength(0)
    await act(ga, { op: 'world_pool_aim', channelId: ch, table: 'sin', a: aim }, gb, gc)
    expect(got(gb, 'WORLD_POOL_AIM')).toEqual([{ channelId: ch, table: 'sin', userId: a.user.id, a: aim }])
    expect(got(gc, 'WORLD_POOL_AIM')).toHaveLength(1)
    expect(got(ga, 'WORLD_POOL_AIM')).toHaveLength(0)
  })

  it('puts the cue down for whoever leaves the table, the world or the call, and frees the table when nobody is left', async () => {
    const { a, b, ga, gb, gc, ch, pool } = await setup()
    await pool(ga, 'join')
    await pool(gb, 'join')
    await pool(ga, 'leave')
    expect(table(gc)).toMatchObject({ players: [b.user.id], turn: 0, groups: null })
    await pool(ga, 'join')
    expect(table(gc)!.players).toEqual([b.user.id, a.user.id])
    // Walking out of the world.
    await act(gb, { op: 'world_leave', channelId: ch }, ga, gc)
    expect(table(gc)!.players).toEqual([a.user.id])
    expect(table(gb)!.players).toEqual([b.user.id, a.user.id])
    // Hanging up.
    await quit(ch, a.user.id)
    await act(gc, { op: 'heartbeat' })
    expect(table(gc)).toBeNull()
    // Someone who walks in later is told about the games going on.
    await pool(gc, 'join')
    await act(gb, { op: 'world_enter', channelId: ch }, gb)
    expect(table(gb)).toMatchObject({ players: [expect.any(String)] })
    expect(table(gb)!.players).toHaveLength(1)
  })

  it('forgets the games when the world moves to another place, and refuses pool from outside the world', async () => {
    const { ga, gb, gc, ch, pool } = await setup()
    await pool(ga, 'join')
    expect(table(gc)).not.toBeNull()
    await act(ga, { op: 'world_open', channelId: ch, place: { kind: 'room', ownerId: (got(ga, 'READY')[0] as ReadyPayload).user.id } }, gb, gc)
    expect(table(gc)).toBeNull()
    await act(gc, { op: 'world_leave', channelId: ch }, ga, gb)
    await act(gc, { op: 'world_pool_join', channelId: ch, table: 'sin' })
    expect(errors(gc).at(-1)).toEqual({ op: 'world_pool_join', reason: 'not_inside' })
  })

  it('closes the socket on a malformed pool frame, like any other', async () => {
    const { gc, ch } = await setup()
    const closed = new Promise<number>((resolve) => gc.ws.once('close', (code) => resolve(code)))
    gc.send({ op: 'world_pool_shot', channelId: ch, table: 'sin', seq: 0, shot: { dx: 0, dy: 0, v: 99, a: 0, b: 0, e: 0 } })
    expect(await closed).toBe(4003)
  })
})
