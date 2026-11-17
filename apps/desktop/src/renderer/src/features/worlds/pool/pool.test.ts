import type { Dispatch, PoolBalls, PoolState, WorldSession } from '@alga/shared'
import { POOL_BALL_R, POOL_HL, POOL_HW, POOL_MAX_CUE_SPEED, POOL_MIN_CUE_SPEED, newPool, poolJoin, poolShoot } from '@alga/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listeners: Array<(d: Dispatch) => void> = []
const sent: Array<{ op: string } & Record<string, unknown>> = []
const session: { worlds: { assetsUrl: string; pool?: boolean } | null; send: (f: never) => boolean } = {
  worlds: { assetsUrl: '/x', pool: true },
  send: (f) => (sent.push(f), true),
}
vi.mock('@/store/session', () => ({
  onDispatch: (fn: (d: Dispatch) => void) => {
    listeners.push(fn)
    return () => listeners.splice(listeners.indexOf(fn), 1)
  },
  useSession: { getState: () => session },
}))

const { useData } = await import('@/store/data')
const p = await import('./store')
const { cueElevation, cueSpeed } = await import('./PoolRoom')
const { predict } = await import('./PoolView')

const CH = '0190f3a2-7b4c-7d00-8000-0000000000aa'
const dispatch = (d: Dispatch) => {
  for (const l of [...listeners]) l(d)
}
const inCall = (channelId: string | null) =>
  useData.setState((st) => ({ voiceStates: channelId ? { me: { userId: 'me', channelId } } : {}, me: { ...(st.me ?? {}), id: 'me' } }) as never)
const world = (members: string[]): WorldSession => ({
  channelId: CH, place: { kind: 'lounge' }, hostId: 'ana', tv: null, seq: 1, members: members.map((userId, k) => ({ userId, k, pose: [0, 0, 0, 0], seat: null, loop: null })),
})
const pool = (state: PoolState | null, channelId = CH): Dispatch => ({ t: 'WORLD_POOL', d: { channelId, table: 'sin', pool: state } })

let stop: () => void = () => {}
beforeEach(() => {
  stop()
  sent.length = 0
  session.worlds = { assetsUrl: '/x', pool: true }
  inCall(CH)
  stop = p.startPool()
})

describe('the pool tables of my world', () => {
  const match = (): PoolState => poolJoin(poolJoin(newPool('sin', 1), 'me', 1)!, 'ana', 2)!
  const shot = (s: PoolState): PoolState => {
    const r = poolShoot(s, s.players[s.turn]!, s.shot, { dx: 1, dy: 0.01, v: 5, a: 0, b: 0, e: 0.05 }, s.hand ? [-0.6, 0] : undefined)
    if ('error' in r) throw new Error(r.error)
    return { ...r.state, last: { ...r.state.last!, age: 30 } }
  }

  it('keeps what the server says, and holds the scoreboard back while a shot is rolling', () => {
    const before = match()
    dispatch(pool(before))
    expect(p.usePool.getState()).toMatchObject({ tables: { sin: before }, shown: { sin: before } })
    const after = shot(before)
    dispatch(pool(after))
    expect(p.usePool.getState().tables.sin).toBe(after)
    expect(p.usePool.getState().shown.sin).toBe(before)
    // The room finished playing it.
    p.poolSettled('sin', after.shot)
    expect(p.usePool.getState().shown.sin).toBe(after)
    // A shot that is long over (I walked in later) is shown as it stands.
    const old = { ...shot(after), last: { ...shot(after).last!, age: 60_000 } }
    dispatch(pool(old))
    expect(p.usePool.getState().shown.sin).toBe(old)
  })

  it('forgets a table that was freed, the tables of another call, and everything when I leave the world', () => {
    dispatch(pool(match(), '0190f3a2-7b4c-7d00-8000-0000000000bb'))
    expect(p.usePool.getState().tables).toEqual({})
    dispatch(pool(match()))
    dispatch(pool(null))
    expect(p.usePool.getState()).toEqual({ tables: {}, shown: {} })
    dispatch(pool(match()))
    dispatch({ t: 'WORLD_STATE', d: { channelId: CH, session: world(['me', 'ana']) } })
    expect(Object.keys(p.usePool.getState().tables)).toEqual(['sin'])
    dispatch({ t: 'WORLD_STATE', d: { channelId: CH, session: world(['ana']) } })
    expect(p.usePool.getState().tables).toEqual({})
    dispatch(pool(match()))
    inCall(null)
    expect(p.usePool.getState().tables).toEqual({})
  })

  it('sends pool frames for my call, and none to a server that does not play pool', () => {
    p.poolJoin('sin')
    p.poolShot('sin', 3, { dx: 1, dy: 0, v: 2, a: 0, b: 0, e: 0 }, [-0.5, 0.1])
    p.poolShot('sin', 4, { dx: 1, dy: 0, v: 2, a: 0, b: 0, e: 0 }, undefined)
    expect(sent).toEqual([
      { op: 'world_pool_join', table: 'sin', channelId: CH },
      { op: 'world_pool_shot', table: 'sin', seq: 3, shot: { dx: 1, dy: 0, v: 2, a: 0, b: 0, e: 0 }, cue: [-0.5, 0.1], channelId: CH },
      { op: 'world_pool_shot', table: 'sin', seq: 4, shot: { dx: 1, dy: 0, v: 2, a: 0, b: 0, e: 0 }, channelId: CH },
    ])
    sent.length = 0
    session.worlds = { assetsUrl: '/x' }
    p.poolJoin('sin')
    p.poolAim('sin', [1, 0, 0, 0, 0, 0, 0, 0])
    expect(sent).toEqual([])
  })
})

describe('the cue', () => {
  it('turns a pull into a speed: soft at first, the break at the end', () => {
    expect(cueSpeed(0)).toBe(POOL_MIN_CUE_SPEED)
    expect(cueSpeed(1)).toBe(POOL_MAX_CUE_SPEED)
    expect(cueSpeed(0.5)).toBeLessThan(POOL_MAX_CUE_SPEED * 0.4)
    expect(cueSpeed(0.6)).toBeGreaterThan(cueSpeed(0.5))
  })

  it('is raised only as much as the rail behind the ball asks for', () => {
    const open = cueElevation(0, 0, 1, 0, 0)
    expect(open).toBeGreaterThan(0.03)
    expect(open).toBeLessThan(0.07)
    // The cue ball against the cushion, shooting away from it: the butt comes up a lot, less when hitting high.
    const frozen = cueElevation(-POOL_HL + POOL_BALL_R, 0, 1, 0, 0)
    const high = cueElevation(-POOL_HL + POOL_BALL_R, 0, 1, 0, 0.5)
    expect(frozen).toBeGreaterThan(0.3)
    expect(high).toBeLessThan(frozen)
    // Along the rail instead, there is no rail under the cue.
    expect(cueElevation(-POOL_HL + POOL_BALL_R, 0, 0, 1, 0)).toBeLessThan(0.2)
  })
})

describe('the aiming line', () => {
  const lie = (balls: Record<number, [number, number]>): PoolBalls => {
    const out: PoolBalls = new Array<null>(16).fill(null)
    for (const [i, b] of Object.entries(balls)) out[Number(i)] = b
    return out
  }

  it('ends where the cue ball touches the first ball, and shows where both go', () => {
    const g = predict(lie({ 0: [-0.5, 0], 3: [0.3, 0.02] }), { dx: 1, dy: 0, v: 2.5, a: 0, b: 0, e: 0.05 })
    expect(g.hit).toBe(3)
    expect(Math.hypot(g.ghost![0] - 0.3, g.ghost![1] - 0.02)).toBeCloseTo(2 * POOL_BALL_R, 2)
    expect(g.path.length).toBeGreaterThan(8)
    // The object ball leaves away from the cue ball, the cue ball to the other side.
    expect(g.object.at(-1)!).toBeGreaterThan(0.02)
    expect(g.after.at(-1)!).toBeLessThan(g.ghost![1])
  })

  it('with nothing in the way goes to the rail and only a little past it', () => {
    const g = predict(lie({ 0: [-0.5, 0], 3: [0.3, 0.4] }), { dx: 1, dy: 0.3, v: 3, a: 0, b: 0, e: 0.05 })
    expect(g.hit).toBe(-1)
    expect(g.ghost).toBeNull()
    const xs = g.path.filter((_, i) => i % 2 === 0), ys = g.path.filter((_, i) => i % 2 === 1)
    expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(POOL_HL)
    expect(Math.max(...ys)).toBeGreaterThan(POOL_HW - POOL_BALL_R - 0.01)
    let length = 0
    for (let i = 1; i < xs.length; i++) length += Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!)
    expect(length).toBeLessThan(2.4)
  })
})
