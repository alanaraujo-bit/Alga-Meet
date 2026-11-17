import { describe, expect, it } from 'vitest'
import {
  POOL_BALL_R, POOL_DT, POOL_HL, POOL_HW, POOL_POCKETS, PoolSim, simulateShot, type PoolBalls, type PoolShot,
} from './pool-physics.js'
import {
  POOL_FOOT_X, POOL_HEAD_X, PoolClientFrameSchema, cueSpot, cueSpotFree, newPool, poolGroupOf, poolJoin, poolLeave, poolRack, poolShoot,
  rackBalls, type PoolState,
} from './pool.js'

const R = POOL_BALL_R
const empty = (): PoolBalls => new Array<null>(16).fill(null)
const table = (balls: Record<number, [number, number]>): PoolBalls => {
  const out = empty()
  for (const [i, p] of Object.entries(balls)) out[Number(i)] = p
  return out
}
const shot = (dx: number, dy: number, v: number, more: Partial<PoolShot> = {}): PoolShot => ({ dx, dy, v, a: 0, b: 0, e: 0, ...more })
/** Runs a shot and keeps the simulation, to look at velocities on the way. */
function run(balls: PoolBalls, s: PoolShot, until?: (sim: PoolSim) => boolean): PoolSim {
  const sim = new PoolSim(balls)
  sim.strike(s)
  for (let n = 0; n < 40_000 && sim.busy && !until?.(sim); n++) sim.step()
  return sim
}

describe('pool physics', () => {
  it('a centre hit slides, then rolls, and stops where the equations say', () => {
    const sim = new PoolSim(table({ 0: [-1, 0] }))
    sim.strike(shot(1, 0, 0.4))
    const v0 = sim.vx[0]!
    expect(v0).toBeCloseTo((1.75 * 0.4) / (1 + 0.17 / 0.54), 9)
    const before = sim.x[0]!
    while (sim.busy) sim.step()
    const g = 9.81, ms = 0.2, mr = 0.0105
    const ts = (2 * v0) / (7 * ms * g)
    const slide = v0 * ts - 0.5 * ms * g * ts * ts
    const roll = ((5 * v0) / 7) ** 2 / (2 * mr * g)
    expect(sim.x[0]! - before).toBeCloseTo(slide + roll, 6)
    expect(sim.y[0]).toBe(0)
    expect(sim.events.map((e) => e.k)).toEqual(['strike'])
  })

  it('is deterministic: the same shot gives the same table, bit for bit', () => {
    const a = simulateShot(rackBalls(7), shot(1, 0.013, 6.5, { a: 0.2, b: -0.1, e: 0.08 }))
    const b = simulateShot(rackBalls(7), shot(1, 0.013, 6.5, { a: 0.2, b: -0.1, e: 0.08 }))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    // And survives the wire: positions that went through JSON play out the same.
    const c = simulateShot(JSON.parse(JSON.stringify(rackBalls(7))) as PoolBalls, JSON.parse(JSON.stringify(shot(1, 0.013, 6.5, { a: 0.2, b: -0.1, e: 0.08 }))) as PoolShot)
    expect(JSON.stringify(c)).toBe(JSON.stringify(a))
  })

  it('a stun shot stops dead, follow goes forward, draw comes back', () => {
    // The object ball is close, so a centre hit is still sliding without spin when it arrives.
    const layout = table({ 0: [-0.5, 0], 1: [-0.38, 0] })
    // Half a second after the hit the cue ball has settled into what it will do.
    const soon = (s: PoolSim): boolean => s.time > (s.events.find((e) => e.k === 'ball')?.t ?? Infinity) + 0.5
    const stun = run(layout, shot(1, 0, 3), soon)
    expect(Math.abs(stun.vx[0]!)).toBeLessThan(0.15)
    expect(stun.events.find((e) => e.k === 'ball')!.v).toBeGreaterThan(3)
    const follow = run(layout, shot(1, 0, 3, { b: 0.5 }), soon)
    expect(follow.vx[0]!).toBeGreaterThan(0.4)
    const draw = run(layout, shot(1, 0, 3, { b: -0.5 }), soon)
    expect(draw.vx[0]!).toBeLessThan(-0.4)
  })

  it('a cut shot sends the balls apart at about a right angle, the object ball thrown a little off the line', () => {
    // Half-ball hit: the centres are one radius apart across the line of the shot.
    const sim = run(table({ 0: [0, 0], 1: [0.15, R] }), shot(1, 0, 2.5), (s) => s.events.some((e) => e.k === 'ball'))
    const cue = [sim.vx[0]!, sim.vy[0]!], obj = [sim.vx[1]!, sim.vy[1]!]
    const cos = (cue[0]! * obj[0]! + cue[1]! * obj[1]!) / (Math.hypot(cue[0]!, cue[1]!) * Math.hypot(obj[0]!, obj[1]!))
    expect(Math.abs(cos)).toBeLessThan(0.12)
    // Line of centres at the hit is 30 degrees up; friction throws the object ball below it, by a degree or three.
    const angle = (Math.atan2(obj[1]!, obj[0]!) * 180) / Math.PI
    expect(angle).toBeLessThan(30)
    expect(angle).toBeGreaterThan(25)
  })

  it('comes off a cushion slower, and side spin changes the angle', () => {
    const plain = run(table({ 0: [0.5, 0] }), shot(0, 1, 2), (s) => s.events.some((e) => e.k === 'rail'))
    expect(plain.vy[0]!).toBeLessThan(0)
    const before = plain.events.find((e) => e.k === 'rail')!
    expect(-plain.vy[0]! / before.v).toBeGreaterThan(0.55)
    expect(-plain.vy[0]! / before.v).toBeLessThan(0.9)
    expect(Math.abs(plain.vx[0]!)).toBeLessThan(1e-9)
    // Shooting along +y the player's right is +x: right english comes off the far rail to the right, left to the left.
    const right = run(table({ 0: [0.5, 0] }), shot(0, 1, 2, { a: 0.4 }), (s) => s.events.some((e) => e.k === 'rail'))
    const left = run(table({ 0: [0.5, 0] }), shot(0, 1, 2, { a: -0.4 }), (s) => s.events.some((e) => e.k === 'rail'))
    expect(right.vx[0]!).toBeGreaterThan(0.1)
    expect(left.vx[0]!).toBeLessThan(-0.1)
  })

  it('a raised cue with side makes the ball curve (masse)', () => {
    const level = run(table({ 0: [-0.9, 0] }), shot(1, 0, 3, { a: 0.4 }), (s) => s.x[0]! > 0.6)
    const raised = run(table({ 0: [-0.9, 0] }), shot(1, 0, 3, { a: 0.4, e: 0.6 }), (s) => s.x[0]! > 0.6 || s.events.length > 1)
    // Right english, cue raised: the ball bends to the player's right (-y when shooting along +x).
    expect(raised.y[0]!).toBeLessThan(level.y[0]! - 0.05)
  })

  it('pockets take a ball aimed at them and refuse one that is not', () => {
    const corner = POOL_POCKETS[5]!
    const into = simulateShot(table({ 0: [0.3, 0.1] }), shot(corner.x - 0.3 - 0.03, corner.y - 0.1 - 0.03, 2))
    expect(into.events.some((e) => e.k === 'pot' && e.a === 0 && e.p === 5)).toBe(true)
    expect(into.balls[0]).toBeNull()
    const side = simulateShot(table({ 0: [0.1, 0] }), shot(-0.1, POOL_HW + 0.03, 1.5))
    expect(side.events.some((e) => e.k === 'pot' && e.p === 4)).toBe(true)
    // Along the rail a ball goes past the side pocket.
    const past = simulateShot(table({ 0: [-0.6, POOL_HW - R - 0.002] }), shot(1, 0, 1.2))
    expect(past.events.some((e) => e.k === 'pot' && e.p === 4)).toBe(false)
    // An object ball cut into the corner.
    const cut = simulateShot(table({ 0: [0.6, 0.2], 3: [0.9, 0.38] }), shot(0.9 - 0.6 - 0.012, 0.38 - 0.2 - 0.016, 2.2))
    expect(cut.events.filter((e) => e.k === 'pot').map((e) => e.a)).toEqual([3])
  })

  it('a hard break ends with every ball on the cloth or in a pocket, none overlapping, in good time', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const t0 = performance.now()
      const out = simulateShot(rackBalls(seed), shot(1, 0.004 * seed, 8, { b: 0.1 }))
      const took = performance.now() - t0
      expect(out.seconds).toBeLessThan(30)
      expect(took).toBeLessThan(400)
      const on = out.balls.map((b, i) => [b, i] as const).filter(([b]) => b)
      for (const [b] of on) {
        expect(Number.isFinite(b![0]) && Number.isFinite(b![1])).toBe(true)
        expect(Math.abs(b![0])).toBeLessThanOrEqual(POOL_HL + 0.03)
        expect(Math.abs(b![1])).toBeLessThanOrEqual(POOL_HW + 0.03)
      }
      for (const [a, i] of on) for (const [b, j] of on) if (i < j) expect(Math.hypot(a![0] - b![0], a![1] - b![1])).toBeGreaterThan(2 * R - 1e-6)
      expect(out.events.filter((e) => e.k === 'ball').length).toBeGreaterThan(15)
      // Balls that went in are exactly the ones missing.
      const potted = out.events.filter((e) => e.k === 'pot').map((e) => e.a).sort((x, y) => x - y)
      expect(potted).toEqual(out.balls.map((b, i) => (b ? -1 : i)).filter((i) => i >= 0))
    }
  })

  it('advances by its step', () => {
    const sim = new PoolSim(table({ 0: [0, 0] }))
    sim.strike(shot(1, 0, 1))
    for (let n = 0; n < 10; n++) sim.step()
    expect(sim.time).toBeCloseTo(10 * POOL_DT, 12)
  })
})

describe('pool rack', () => {
  it('racks 15 balls in a triangle with the 8 in the middle and both groups on the back corners', () => {
    for (const seed of [0, 1, 99, 123456]) {
      const balls = rackBalls(seed)
      expect(balls).toHaveLength(16)
      expect(balls[0]).toEqual([POOL_HEAD_X, 0])
      expect(Math.abs(balls[8]![1])).toBeLessThan(0.001)
      const back = balls.map((b, i) => [b!, i] as const).filter(([b, i]) => i > 0 && b[0] > POOL_FOOT_X + 0.19)
      expect(back).toHaveLength(5)
      const corners = [...back].sort((a, b) => a[0][1] - b[0][1])
      expect(new Set([poolGroupOf(corners[0]![1]), poolGroupOf(corners[4]![1])])).toEqual(new Set(['solid', 'stripe']))
      for (let i = 1; i < 16; i++) for (let j = i + 1; j < 16; j++) {
        expect(Math.hypot(balls[i]![0] - balls[j]![0], balls[i]![1] - balls[j]![1])).toBeGreaterThan(2 * R)
      }
    }
    expect(JSON.stringify(rackBalls(5))).not.toBe(JSON.stringify(rackBalls(6)))
  })

  it('knows where the cue ball may be put', () => {
    const balls = rackBalls(1)
    expect(cueSpotFree(balls, POOL_HEAD_X, 0, 'kitchen')).toBe(true)
    expect(cueSpotFree(balls, 0, 0, 'kitchen')).toBe(false)
    expect(cueSpotFree(balls, 0, 0, 'any')).toBe(true)
    expect(cueSpotFree(balls, POOL_FOOT_X, 0, 'any')).toBe(false)
    expect(cueSpotFree(balls, POOL_HL, 0, 'any')).toBe(false)
    balls[3] = [POOL_HEAD_X, 0]
    const [x, y] = cueSpot(balls)
    expect(cueSpotFree(balls, x, y, 'any')).toBe(true)
  })
})

// ---- the game --------------------------------------------------------------------------------------------------------

const A = 'ana', B = 'bia'
/** A match with the table set by hand: `balls` on the cloth, groups given, A to shoot. */
function match(balls: Record<number, [number, number]>, more: Partial<PoolState> = {}): PoolState {
  const s = poolJoin(poolJoin(newPool('mesa', 1), A, 1)!, B, 2)!
  return { ...s, balls: table(balls), breaking: false, hand: null, ...more }
}
const play = (s: PoolState, who: string, sh: PoolShot, cue?: [number, number]): PoolState => {
  const r = poolShoot(s, who, s.shot, sh, cue)
  if ('error' in r) throw new Error(r.error)
  return r.state
}
/** Straight into the +x+y corner from (0.6, 0.2) through a ball at (0.9, 0.38). */
const CUT = shot(0.9 - 0.6 - 0.012, 0.38 - 0.2 - 0.016, 2.2)

describe('pool game', () => {
  it('is practice alone and a match with two', () => {
    const idle = newPool('mesa', 1)
    expect(idle.players).toEqual([])
    const alone = poolJoin(idle, A, 2)!
    expect(alone.players).toEqual([A])
    expect(alone.rack).toBe(1)
    expect(poolJoin(alone, A, 3)).toBeNull()
    const two = poolJoin(alone, B, 3)!
    expect(two).toMatchObject({ players: [A, B], turn: 0, breaking: true, hand: 'kitchen', rack: 3, shot: 0 })
    expect(poolJoin(two, 'caio', 4)).toBeNull()
    expect(poolLeave(two, 'caio', 4)).toBeNull()
    const back = poolLeave(two, A, 4) as PoolState
    expect(back.players).toEqual([B])
    expect(back.turn).toBe(0)
    expect(poolLeave(back, B, 5)).toBe('empty')
  })

  it('refuses a shot out of turn, twice, or from a bad spot', () => {
    const s = poolJoin(poolJoin(newPool('mesa', 1), A, 1)!, B, 2)!
    expect(poolShoot(s, B, 0, shot(1, 0, 5))).toEqual({ error: 'not_your_turn' })
    expect(poolShoot(s, 'caio', 0, shot(1, 0, 5))).toEqual({ error: 'not_playing' })
    expect(poolShoot(s, A, 1, shot(1, 0, 5))).toEqual({ error: 'stale' })
    expect(poolShoot(s, A, 0, shot(1, 0, 5), [0.3, 0])).toEqual({ error: 'bad_spot' })
    const after = play(s, A, shot(1, 0, 6), [POOL_HEAD_X - 0.1, 0.1])
    expect(after.shot).toBe(1)
    expect(after.breaking).toBe(false)
    expect(after.last).toMatchObject({ by: A, foul: after.balls[0] ? null : 'scratch' })
    expect(after.last!.from[0]).toEqual([POOL_HEAD_X - 0.1, 0.1])
    expect(after.last!.ms).toBeGreaterThan(1000)
    expect(poolShoot(s, A, 0, shot(1, 0, 6), [POOL_HEAD_X - 0.1, 0.1])).toEqual({ state: after })
  })

  it('gives the group of the first ball pocketed and keeps the turn', () => {
    const s = play(match({ 0: [0.6, 0.2], 3: [0.9, 0.38], 8: [0, 0], 12: [-0.5, 0.3] }), A, CUT)
    expect(s.last).toMatchObject({ potted: [3], foul: null })
    expect(s.groups).toEqual(['solid', 'stripe'])
    expect(s.turn).toBe(0)
    expect(s.hand).toBeNull()
  })

  it('passes the turn on a miss and gives ball in hand on a foul', () => {
    const base = { 0: [0.6, 0.2] as [number, number], 3: [0.9, 0.38] as [number, number], 8: [0, 0] as [number, number], 12: [-0.5, 0.3] as [number, number] }
    // Soft touch on the 3: nothing drops, nothing reaches a rail.
    const soft = play(match(base), A, shot(0.3, 0.18, 0.32))
    expect(soft.last!.foul).toBe('no_rail')
    expect(soft).toMatchObject({ turn: 1, hand: 'any' })
    // Away from everything.
    const miss = play(match(base), A, shot(-1, -0.6, 0.4))
    expect(miss.last!.foul).toBe('no_hit')
    // Stripes are the other player's.
    const wrong = play(match(base, { groups: ['stripe', 'solid'] }), A, CUT)
    expect(wrong.last!.foul).toBe('wrong_ball')
    expect(wrong).toMatchObject({ turn: 1, hand: 'any' })
    // The 8 first on an open table.
    const eight = play(match({ 0: [-0.5, 0], 8: [0, 0], 3: [0.9, 0.38] }), A, shot(1, 0, 2))
    expect(eight.last!.foul).toBe('wrong_ball')
    // A legal hit that reaches a rail and pockets nothing: just the other player's turn.
    const legal = play(match(base, { groups: ['solid', 'stripe'] }), A, shot(0.32, 0.15, 1.2))
    expect(legal.last!.foul).toBeNull()
    expect(legal).toMatchObject({ turn: 1, hand: null })
    // The next player puts the cue ball where they like.
    const placed = play(soft, B, shot(1, 0, 1), [-0.8, -0.3])
    expect(placed.last!.from[0]).toEqual([-0.8, -0.3])
  })

  it('wins with the 8 after the group is gone, and loses with it before', () => {
    const eightIn = { 0: [0.6, 0.2] as [number, number], 8: [0.9, 0.38] as [number, number], 12: [-0.5, 0.3] as [number, number] }
    const win = play(match(eightIn, { groups: ['solid', 'stripe'] }), A, CUT)
    expect(win).toMatchObject({ phase: 'over', winner: A })
    const early = play(match({ ...eightIn, 2: [-0.3, -0.3] }, { groups: ['solid', 'stripe'] }), A, CUT)
    expect(early).toMatchObject({ phase: 'over', winner: B })
    const open = play(match(eightIn), A, CUT)
    expect(open).toMatchObject({ phase: 'over', winner: B })
    expect(poolShoot(win, A, win.shot, CUT)).toEqual({ error: 'over' })
    // The winner breaks the next rack.
    const again = poolRack(play(match(eightIn, { groups: ['stripe', 'solid'], turn: 1 }), B, CUT), A, 9)!
    expect(again).toMatchObject({ phase: 'play', winner: null, turn: 1, breaking: true, shot: 0, rack: 9 })
    expect(poolRack(again, 'caio', 1)).toBeNull()
  })

  it('puts the 8 back when it drops on the break', () => {
    const s = play(match({ 0: [0.6, 0.2], 8: [0.9, 0.38], 5: [-0.5, 0.3] }, { breaking: true }), A, CUT)
    expect(s.phase).toBe('play')
    expect(s.balls[8]).toEqual([POOL_FOOT_X, 0])
    expect(s.groups).toBeNull()
  })

  it('in practice only a scratch matters, and an empty table is racked again', () => {
    const alone = { ...poolJoin(newPool('mesa', 1), A, 1)!, breaking: false, hand: null }
    const corner = POOL_POCKETS[5]!
    const scratch = play({ ...alone, balls: table({ 0: [0.3, 0.1], 4: [-0.5, 0] }) }, A, shot(corner.x - 0.33, corner.y - 0.13, 2))
    expect(scratch.last!.foul).toBe('scratch')
    expect(scratch).toMatchObject({ turn: 0, hand: 'any', groups: null })
    expect(scratch.balls[0]).toBeNull()
    expect(poolShoot(scratch, A, scratch.shot, shot(1, 0, 1))).toEqual({ error: 'bad_spot' })
    const miss = play({ ...alone, balls: table({ 0: [0.3, 0.1], 4: [-0.5, 0] }) }, A, shot(1, 0, 0.3))
    expect(miss.last!.foul).toBeNull()
    const last = play({ ...alone, balls: table({ 0: [0.6, 0.2], 4: [0.9, 0.38] }) }, A, CUT)
    expect(last.last!.potted).toEqual([4])
    expect(last.balls.filter((b) => b)).toHaveLength(16)
    expect(last).toMatchObject({ breaking: true, hand: 'kitchen', shot: alone.shot + 1 })
    expect(last.rack).not.toBe(alone.rack)
  })
})

describe('pool frames', () => {
  const channelId = '018f4e2a-7b1c-7def-8abc-0123456789ab'
  it('accepts well-formed frames and refuses the rest', () => {
    const ok = [
      { op: 'world_pool_join', channelId, table: 'sin' },
      { op: 'world_pool_leave', channelId, table: 'sin' },
      { op: 'world_pool_rack', channelId, table: 'sin' },
      { op: 'world_pool_aim', channelId, table: 'sin', a: [1, 0, 0.5, 0.1, -0.2, 0.07, -0.56, 0] },
      { op: 'world_pool_shot', channelId, table: 'sin', seq: 0, shot: shot(1, 0, 3) },
      { op: 'world_pool_shot', channelId, table: 'sin', seq: 3, shot: shot(0, -1, 3, { a: 0.3 }), cue: [-0.7, 0.2] },
    ]
    for (const f of ok) expect(PoolClientFrameSchema.safeParse(f).success).toBe(true)
    const bad = [
      { op: 'world_pool_join', channelId, table: 'Mesa 1' },
      { op: 'world_pool_shot', channelId, table: 'sin', seq: 0, shot: shot(0, 0, 3) },
      { op: 'world_pool_shot', channelId, table: 'sin', seq: 0, shot: shot(1, 0, 30) },
      { op: 'world_pool_shot', channelId, table: 'sin', seq: 0, shot: { ...shot(1, 0, 3), a: Number.NaN } },
      { op: 'world_pool_shot', channelId, table: 'sin', seq: 0, shot: { ...shot(1, 0, 3), extra: 1 } },
      { op: 'world_pool_shot', channelId, table: 'sin', seq: 0, shot: shot(1, 0, 3), cue: [9, 0] },
      { op: 'world_pool_aim', channelId, table: 'sin', a: [1, 0, 2, 0, 0, 0, 0, 0] },
    ]
    for (const f of bad) expect(PoolClientFrameSchema.safeParse(f).success).toBe(false)
  })
})
