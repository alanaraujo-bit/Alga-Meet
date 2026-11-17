/**
 * Dominoes at a table of a world (src/worlds.ts handleDomino and dominoSync, rules in packages/shared/src/domino.ts):
 * sitting on a chair is joining, each person is told only their own tiles, the table plays for bots and for nobody
 * else, and what happens to a game when its people or its table go. The table's timers are off here: the tests call
 * what a timer would. People join calls through signed LiveKit webhooks.
 */
import {
  DOMINO_BOT, DOMINO_TILES, dominoViewMoves,
  type AuthResponse, type DispatchOf, type DispatchType, type DominoState, type DominoView, type Invite, type PoolState, type ReadyPayload,
  type SpaceSnapshot,
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
  s.app.ctx.worlds.dominoTimers = false
})
afterAll(async () => {
  await s.close()
})

let seq = 0
const voiceEvent = (name: string, channelId: string, identity: string) => ({
  event: name, id: `EV_DM_${++seq}`, createdAt: String(Math.floor(Date.now() / 1000)),
  room: { sid: `RM_${channelId.slice(0, 8)}`, name: `ch_${channelId}` },
  participant: { sid: `PA_DM_${seq}`, identity, name: 'x', joinedAt: String(Math.floor(Date.now() / 1000)) },
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
/** The lounge's domino table as `gw` was last told (undefined: never told; null: told nobody sits there). */
const table = (gw: Gateway): DominoView | null | undefined => got(gw, 'WORLD_DOMINO').filter((d) => d.table === 'dom').at(-1)?.game
const errors = (gw: Gateway, from = 0) => got(gw, 'WORLD_ERROR', from)

interface Inner {
  sessions: Map<string, { dominos: Map<string, { state: DominoState; timer: unknown }> }>
  dominoTick(session: unknown, table: string): void
}
const inner = (): Inner => s.app.ctx.worlds as unknown as Inner
/** Test-only reach into a live game. */
const game = (ch: string) => inner().sessions.get(ch)?.dominos.get('dom')

/** Three members of a space in its voice channel, connected, all inside the lounge (which has the domino table `dom`). */
async function setup() {
  const [a, b, c] = [await register(s.app), await register(s.app), await register(s.app)] as [User, User, User]
  const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: a.token, body: { name: 'Dominó' } })).body
  const inv = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: a.token, body: {} })).body
  for (const u of [b, c]) await api(s.app, 'POST', `/invites/${inv.code}`, { token: u.token })
  const ch = space.channels.find((x) => x.type === 'voice')!.id
  for (const u of [a, b, c]) await postWebhook(s.app, s.config, voiceEvent('participant_joined', ch, u.user.id))
  const [ga, gb, gc] = (await Promise.all([a, b, c].map((u) => connect(s.port, u.token)))) as [Gateway, Gateway, Gateway]
  const all = [ga, gb, gc]
  await act(ga, { op: 'world_open', channelId: ch, place: { kind: 'lounge' } }, gb, gc)
  for (const g of all) await act(g, { op: 'world_enter', channelId: ch }, ...all)
  const sit = (gw: Gateway, chair: number) => act(gw, { op: 'world_sit', channelId: ch, seat: `dom:${chair}` }, ...all)
  const stand = (gw: Gateway) => act(gw, { op: 'world_stand', channelId: ch, p: [0, 0, 0, 0] }, ...all)
  const send = (gw: Gateway, op: 'start' | 'bot' | 'play', more: Record<string, unknown> = {}) => act(gw, { op: `world_domino_${op}`, channelId: ch, table: 'dom', ...more }, ...all)
  /** What a timer of the table would do, once. */
  const tick = async (): Promise<void> => {
    inner().dominoTick(inner().sessions.get(ch), 'dom')
    for (const g of all) await settled(g)
  }
  return { a, b, c, ga, gb, gc, ch, sit, stand, send, tick }
}

describe('dominoes at a world table', () => {
  it('READY says the server plays dominoes', async () => {
    const u = await register(s.app)
    const gw = await connect(s.port, u.token)
    expect((gw.events.find((e) => e.t === 'READY')!.d as ReadyPayload).worlds).toMatchObject({ domino: true })
    gw.ws.close()
  })

  it('sitting on a chair is joining: everyone inside is told, and it takes two to deal', async () => {
    const { a, b, ga, gb, gc, sit, send } = await setup()
    expect(table(gc)).toBeUndefined()
    await sit(ga, 0)
    expect(table(gc)).toMatchObject({ table: 'dom', seats: [a.user.id, null, null, null], phase: 'lobby', hand: null, counts: [0, 0, 0, 0], auto: null })
    await send(ga, 'start')
    expect(errors(ga).at(-1)).toEqual({ op: 'world_domino_start', reason: 'invalid' })
    // Someone who is not at the table has no say in it.
    await send(gc, 'start')
    expect(errors(gc).at(-1)).toEqual({ op: 'world_domino_start', reason: 'not_found' })
    await sit(gb, 2)
    expect(table(gc)!.seats).toEqual([a.user.id, null, b.user.id, null])
    await send(gc, 'bot', { add: true })
    expect(errors(gc).at(-1)).toEqual({ op: 'world_domino_bot', reason: 'not_found' })
    await send(gb, 'start')
    expect(table(gc)).toMatchObject({ phase: 'play', round: 1, teams: false, counts: [7, 0, 7, 0], stock: 14, hand: null, shown: null })
  })

  it('each person is told their own tiles and nobody else\'s', async () => {
    const { ga, gb, gc, ch, sit, send } = await setup()
    await sit(ga, 0)
    await sit(gb, 1)
    await send(ga, 'start')
    const st = game(ch)!.state
    expect(table(ga)!.hand).toEqual(st.hands[0])
    expect(table(gb)!.hand).toEqual(st.hands[1])
    expect(table(gc)!.hand).toBeNull()
    for (const gw of [ga, gb, gc]) {
      const text = JSON.stringify(got(gw, 'WORLD_DOMINO'))
      expect(text).not.toContain('"hands"')
      expect(text).not.toContain('"mask"')
    }
    // What was sent to one never names a tile of the other: the two hands share nothing, and each got only its own.
    const mine = new Set(table(ga)!.hand)
    expect(table(gb)!.hand!.some((t) => mine.has(t))).toBe(false)
    // The opening tile is told only to who holds it.
    const opener = st.turn === 0 ? ga : gb
    expect(table(opener)!.must).toBe(st.must)
    expect(table(opener === ga ? gb : ga)!.must).toBeNull()
    expect(table(gc)!.must).toBeNull()
    // People play at their own pace: the table only says how long it waits for them.
    expect(table(gc)!.auto).toMatchObject({ kind: 'idle' })
  })

  it('a play is the server\'s to accept: in turn, with a tile held that fits, on the current state', async () => {
    const { a, b, ga, gb, gc, ch, sit, send } = await setup()
    await sit(ga, 0)
    await sit(gb, 1)
    await send(ga, 'start')
    const st = game(ch)!.state
    const [first, second] = st.turn === 0 ? [ga, gb] : [gb, ga]
    const view = table(first)!
    const before = table(gc)
    await send(second, 'play', { seq: view.seq, tile: table(second)!.hand![0], end: 1 })
    await send(first, 'play', { seq: view.seq + 5, tile: view.must, end: 1 })
    await send(first, 'play', { seq: view.seq, tile: table(second)!.hand![0], end: 1 })
    await send(first, 'play', { seq: view.seq, tile: view.hand!.find((t) => t !== view.must), end: 1 })
    expect(errors(second).at(-1)).toEqual({ op: 'world_domino_play', reason: 'invalid' })
    expect(errors(first).slice(-3).every((e) => e.op === 'world_domino_play' && e.reason === 'invalid')).toBe(true)
    expect(table(gc)).toEqual(before)

    await send(first, 'play', { seq: view.seq, tile: view.must, end: 1 })
    const after = table(gc)!
    expect(after.line).toEqual([[view.must, 0]])
    expect(after.last).toEqual({ k: 'play', seat: st.turn, tile: view.must, end: 1 })
    expect(after.seq).toBe(view.seq + 1)
    expect(after.turn).toBe(1 - st.turn)
    expect(after.counts[st.turn]).toBe(6)
    expect(table(first)!.hand).toHaveLength(6)
    expect([a.user.id, b.user.id]).toContain(after.seats[after.turn])
    // Bots are only moved between rounds.
    await send(first, 'bot', { add: true })
    expect(errors(first).at(-1)).toEqual({ op: 'world_domino_bot', reason: 'invalid' })
  })

  it('with bots on the other chairs the table plays a whole round by itself, shows every hand at the end and deals again', async () => {
    const { a, ga, gc, ch, sit, send, tick } = await setup()
    await sit(ga, 1)
    for (let i = 0; i < 3; i++) await send(ga, 'bot', { add: true })
    expect(table(gc)!.seats).toEqual([DOMINO_BOT, a.user.id, DOMINO_BOT, DOMINO_BOT])
    await send(ga, 'bot', { add: true })
    expect(errors(ga).at(-1)).toEqual({ op: 'world_domino_bot', reason: 'invalid' })
    await send(ga, 'bot', { add: false })
    expect(table(gc)!.seats).toEqual([null, a.user.id, DOMINO_BOT, DOMINO_BOT])
    await send(ga, 'bot', { add: true })
    await send(ga, 'start')
    expect(table(gc)).toMatchObject({ phase: 'play', teams: true, stock: 0, counts: [7, 7, 7, 7] })

    let plays = 0
    for (let i = 0; i < 200 && table(ga)!.phase === 'play'; i++) {
      const v = table(ga)!
      const moves = dominoViewMoves(v, 1)
      if (v.turn === 1 && moves.length) {
        // My turn and something fits: the table waits for me (and would play for me only after a long while).
        expect(v.auto).toMatchObject({ kind: 'idle' })
        await send(ga, 'play', { seq: v.seq, tile: moves[0]![0], end: moves[0]![1] })
        plays++
      } else {
        expect(['bot', 'pass']).toContain(v.auto!.kind)
        await tick()
      }
    }
    const done = table(gc)!
    expect(done.phase).toBe('done')
    expect(plays).toBeGreaterThan(0)
    expect(done.shown).toEqual(game(ch)!.state.hands)
    expect(done.result!.pips).toEqual(done.shown!.map((h) => h!.reduce((n, t) => n + DOMINO_TILES[t]![0] + DOMINO_TILES[t]![1], 0)))
    expect(done.line.length + done.counts.reduce((n, c) => n + c, 0)).toBe(28)
    expect(done.score.reduce((n, x) => n + x, 0)).toBe(done.result!.points)
    expect(done.auto).toMatchObject({ kind: 'next' })
    await tick()
    expect(table(gc)).toMatchObject({ phase: 'play', round: 2, counts: [7, 7, 7, 7], shown: null })
    // Or without waiting: anyone at the table deals the next round.
    game(ch)!.state = { ...game(ch)!.state, phase: 'done' }
    await send(ga, 'start')
    expect(table(gc)).toMatchObject({ phase: 'play', round: 3 })
  })

  it('whoever gets up in the middle of a round leaves a bot with the hand, and anyone may sit there and carry on', async () => {
    const { a, b, c, ga, gb, gc, ch, sit, stand, send } = await setup()
    await sit(ga, 0)
    await sit(gb, 2)
    await send(ga, 'start')
    const hand = game(ch)!.state.hands[2]
    await stand(gb)
    expect(table(gc)!.seats).toEqual([a.user.id, null, DOMINO_BOT, null])
    expect(table(gc)!.phase).toBe('play')
    expect(table(gb)!.hand).toBeNull()
    expect(game(ch)!.state.hands[2]).toBe(hand)
    await sit(gc, 2)
    expect(table(ga)!.seats).toEqual([a.user.id, null, c.user.id, null])
    expect(table(gc)!.hand).toEqual(hand)
    // Between rounds a chair that is left is just empty.
    game(ch)!.state = { ...game(ch)!.state, phase: 'done' }
    await stand(gc)
    expect(table(ga)!.seats).toEqual([a.user.id, null, null, null])
    expect(b.user.id).not.toBe(c.user.id)
  })

  it('the game ends when the last person leaves the table, the world or the call', async () => {
    const { ga, gb, gc, ch, sit, stand, send } = await setup()
    await sit(ga, 0)
    await send(ga, 'bot', { add: true })
    await send(ga, 'start')
    await stand(ga)
    expect(table(gc)).toBeNull()
    expect(game(ch)).toBeUndefined()

    await sit(ga, 0)
    await sit(gb, 1)
    await send(ga, 'start')
    // Walking out of the world.
    await act(gb, { op: 'world_leave', channelId: ch }, ga, gc)
    expect(table(gc)!.seats.slice(0, 2)).toEqual([expect.any(String), DOMINO_BOT])
    // Hanging up.
    await quit(ch, table(gc)!.seats[0]!)
    await act(gc, { op: 'heartbeat' })
    expect(table(gc)).toBeNull()
    // Someone who walks in later is told about the games going on.
    await sit(gc, 3)
    await act(gb, { op: 'world_enter', channelId: ch }, gb)
    expect(table(gb)).toMatchObject({ phase: 'lobby', seats: [null, null, null, expect.any(String)] })
  })

  it('sitting down to dominoes puts the pool cue down', async () => {
    const { a, ga, gc, ch, sit } = await setup()
    await act(ga, { op: 'world_pool_join', channelId: ch, table: 'sin' }, gc)
    const pool = (): PoolState | null | undefined => got(gc, 'WORLD_POOL').filter((d) => d.table === 'sin').at(-1)?.pool
    expect(pool()!.players).toEqual([a.user.id])
    await sit(ga, 0)
    expect(pool()).toBeNull()
  })

  it('forgets the games when the world moves to another place, and refuses dominoes from outside the world', async () => {
    const { ga, gb, gc, ch, sit, send } = await setup()
    await sit(ga, 0)
    await send(ga, 'bot', { add: true })
    expect(table(gc)).not.toBeNull()
    await act(ga, { op: 'world_open', channelId: ch, place: { kind: 'room', ownerId: (got(ga, 'READY')[0] as ReadyPayload).user.id } }, gb, gc)
    expect(table(gc)).toBeNull()
    expect(game(ch)).toBeUndefined()
    await act(gc, { op: 'world_leave', channelId: ch }, ga, gb)
    await act(gc, { op: 'world_domino_start', channelId: ch, table: 'dom' })
    expect(errors(gc).at(-1)).toEqual({ op: 'world_domino_start', reason: 'not_inside' })
  })

  it('closes the socket on a malformed domino frame, like any other', async () => {
    const { gc, ch } = await setup()
    const closed = new Promise<number>((resolve) => gc.ws.once('close', (code) => resolve(code)))
    gc.send({ op: 'world_domino_play', channelId: ch, table: 'dom', seq: 0, tile: 99, end: 1 })
    expect(await closed).toBe(4003)
  })
})
