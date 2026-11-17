/**
 * Sinuca: the pool table of Alga Worlds (docs/worlds-pool.md). A room item whose catalog entry has `game: 'pool'` is
 * a table people can play on. This file is the game around the physics (pool-physics.ts): the rack, whose turn it is,
 * the rules of 8-ball, and the frames that carry it.
 *
 * One table, up to two players. Alone, it is free practice: every shot is yours, a scratch gives the cue ball back in
 * hand, an empty table is racked again. When a second person takes a cue, a match of 8-ball starts from a fresh rack.
 * Everyone else in the room watches.
 *
 * 8-ball as played here (bar rules, no called shots): the table is open after the break; the first ball legally
 * pocketed after it gives its group (1-7 solids, 9-15 stripes) to the shooter. A shot is legal when the cue ball first
 * hits a ball of the shooter's group (any but the 8 on an open table; the 8 once the group is gone) and then a ball
 * drops or any ball reaches a cushion. A foul gives the other player the cue ball in hand, anywhere. Pocketing a ball
 * of your group keeps the turn. The 8 wins when it drops legally after your group is gone, and loses when it drops
 * before that or on a foul. On the break the 8 goes back on its spot.
 *
 * Realtime. The server owns every table (apps/server/src/pool.ts): it runs the same simulation as the apps, so a shot
 * has one outcome. A shot travels as its few numbers; WORLD_POOL carries the state after it together with the shot
 * itself (`last`), and each app plays the balls out locally from that. The aim of whoever is shooting is relayed to
 * the others (WORLD_POOL_AIM) so they see the cue move. Frames are `world_pool_*`: they count in the world quota.
 */
import { z } from 'zod'
import {
  POOL_BALL_R, POOL_HL, POOL_HW, POOL_MAX_CUE_SPEED, POOL_MAX_ELEVATION, POOL_MAX_TIP_OFFSET, POOL_MIN_CUE_SPEED, simulateShot,
  type PoolBalls, type PoolEvent, type PoolShot,
} from './pool-physics.js'

export const POOL_MAX_PLAYERS = 2
/** How often whoever is aiming tells the others where the cue is. */
export const POOL_AIM_HZ = 10
/** The centre of the head string (where the cue ball starts) and the foot spot (the apex of the rack). */
export const POOL_HEAD_X = -POOL_HL / 2
export const POOL_FOOT_X = POOL_HL / 2

export type PoolGroup = 'solid' | 'stripe'
export const poolGroupOf = (ball: number): PoolGroup | null => (ball >= 1 && ball <= 7 ? 'solid' : ball >= 9 && ball <= 15 ? 'stripe' : null)

/** scratch: the cue ball dropped. no_hit: it touched nothing. wrong_ball: it first hit a ball the shooter may not. no_rail: nothing dropped or reached a cushion afterwards. */
export type PoolFoul = 'scratch' | 'no_hit' | 'wrong_ball' | 'no_rail'
/** Where the shooter may put the cue ball before shooting: behind the head string (the break) or anywhere. */
export type PoolHand = 'kitchen' | 'any'

export interface PoolLastShot {
  by: string
  shot: PoolShot
  /** The table when the cue hit, cue ball already placed. Playing `shot` on it gives the state's `balls`. */
  from: PoolBalls
  foul: PoolFoul | null
  /** Object balls that dropped, in order. */
  potted: number[]
  /** How long the balls take to stop. */
  ms: number
  /** Filled by the server on the way out: ms since the shot was played (someone arriving mid-shot catches up). */
  age?: number
}

export interface PoolState {
  /** Id of the table's item in the room. */
  table: string
  /** Who holds a cue, in order of arrival. One = practice, two = a match. */
  players: string[]
  /** Index in `players` of whoever shoots next. */
  turn: number
  phase: 'play' | 'over'
  balls: PoolBalls
  /** The shooter places the cue ball first. */
  hand: PoolHand | null
  /** The next shot is the break. */
  breaking: boolean
  /** Group of each player, by index; null while the table is open (and always in practice). */
  groups: [PoolGroup, PoolGroup] | null
  /** Shots played on this rack: a shot frame must carry it, so a repeated one is dropped. */
  shot: number
  /** Seed of this rack. */
  rack: number
  winner: string | null
  last: PoolLastShot | null
}

/** [dx, dy, pull 0..1, tip a, tip b, elevation sine, cue ball x, cue ball y] of whoever is aiming. */
export type PoolAim = [number, number, number, number, number, number, number, number]

export type PoolClientFrame =
  /** Take a cue at a table (the first two are the players). */
  | { op: 'world_pool_join'; channelId: string; table: string }
  | { op: 'world_pool_leave'; channelId: string; table: string }
  /** Rack again: either player, at any time. */
  | { op: 'world_pool_rack'; channelId: string; table: string }
  | { op: 'world_pool_aim'; channelId: string; table: string; a: PoolAim }
  /** `seq` = PoolState.shot. `cue`: where the cue ball is put first, when it is in hand. */
  | { op: 'world_pool_shot'; channelId: string; table: string; seq: number; shot: PoolShot; cue?: [number, number] }

const uuid = z.uuid()
const table = z.string().regex(/^[a-z0-9]{1,12}$/, 'table id')
const num = (min: number, max: number) => z.number().finite().min(min).max(max)
const onTableX = num(-POOL_HL, POOL_HL), onTableY = num(-POOL_HW, POOL_HW)
const ShotSchema = z.strictObject({
  dx: num(-1, 1), dy: num(-1, 1),
  v: num(POOL_MIN_CUE_SPEED, POOL_MAX_CUE_SPEED),
  a: num(-POOL_MAX_TIP_OFFSET, POOL_MAX_TIP_OFFSET), b: num(-POOL_MAX_TIP_OFFSET, POOL_MAX_TIP_OFFSET),
  e: num(0, POOL_MAX_ELEVATION),
}).refine((s) => s.dx * s.dx + s.dy * s.dy > 0.25, 'direction')
export const PoolClientFrameSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('world_pool_join'), channelId: uuid, table }),
  z.object({ op: z.literal('world_pool_leave'), channelId: uuid, table }),
  z.object({ op: z.literal('world_pool_rack'), channelId: uuid, table }),
  z.object({
    op: z.literal('world_pool_aim'), channelId: uuid, table,
    a: z.tuple([num(-1, 1), num(-1, 1), num(0, 1), num(-1, 1), num(-1, 1), num(0, 1), onTableX, onTableY]),
  }),
  z.object({
    op: z.literal('world_pool_shot'), channelId: uuid, table, seq: z.number().int().min(0).max(100_000),
    shot: ShotSchema, cue: z.tuple([onTableX, onTableY]).optional(),
  }),
])

// ---- the rack --------------------------------------------------------------------------------------------------------

const R = POOL_BALL_R
const nextSeed = (seed: number): number => (Math.imul(seed, 1664525) + 1013904223) >>> 0

/**
 * Sixteen balls ready for a break: the cue ball on the head spot, the triangle with its apex on the foot spot, the 8 in
 * the middle, a solid and a stripe on the back corners, the rest wherever the seed puts them. The balls are a hair
 * apart and a hair off their places, as on a real cloth, so no two breaks are the same.
 */
export function rackBalls(seed: number): PoolBalls {
  let s = seed >>> 0
  const rnd = (): number => {
    s = nextSeed(s)
    return s / 4294967296
  }
  const rest = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15]
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const t = rest[i]!
    rest[i] = rest[j]!
    rest[j] = t
  }
  // Slots row by row from the apex: 0 | 1 2 | 3 4 5 | 6 7 8 9 | 10 11 12 13 14.
  const slots = new Array<number>(15)
  slots[4] = 8
  const solid = rest.splice(rest.findIndex((b) => b < 8), 1)[0]!
  const stripe = rest.splice(rest.findIndex((b) => b > 8), 1)[0]!
  const flip = rnd() < 0.5
  slots[10] = flip ? solid : stripe
  slots[14] = flip ? stripe : solid
  for (let i = 0; i < 15; i++) if (slots[i] === undefined) slots[i] = rest.pop()!
  const d = 2 * R + 0.0001
  const pitch = (d * Math.sqrt(3)) / 2
  const balls: PoolBalls = new Array<null>(16).fill(null)
  balls[0] = [POOL_HEAD_X, 0]
  let n = 0
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      balls[slots[n++]!] = [POOL_FOOT_X + row * pitch + (rnd() - 0.5) * 0.00006, (col - row / 2) * d + (rnd() - 0.5) * 0.00006]
    }
  }
  return balls
}

/** Whether the cue ball may be put at (x, y): on the cloth, behind the head string if it has to be, touching nothing. */
export function cueSpotFree(balls: PoolBalls, x: number, y: number, hand: PoolHand): boolean {
  if (Math.abs(x) > POOL_HL - R - 0.001 || Math.abs(y) > POOL_HW - R - 0.001) return false
  if (hand === 'kitchen' && x > POOL_HEAD_X + 1e-9) return false
  for (let i = 1; i < balls.length; i++) {
    const b = balls[i]
    if (b && (b[0] - x) * (b[0] - x) + (b[1] - y) * (b[1] - y) < (2 * R + 0.0005) * (2 * R + 0.0005)) return false
  }
  return true
}

/** The free place nearest to (x, y) for ball `skip` to be put on, searching along the table and then across it. */
function freeSpot(balls: PoolBalls, x: number, y: number, skip: number): [number, number] {
  const free = (px: number, py: number): boolean => {
    if (Math.abs(px) > POOL_HL - R - 0.001 || Math.abs(py) > POOL_HW - R - 0.001) return false
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i]
      if (i !== skip && b && (b[0] - px) * (b[0] - px) + (b[1] - py) * (b[1] - py) < (2 * R + 0.0005) * (2 * R + 0.0005)) return false
    }
    return true
  }
  for (let step = 0; step < 2400; step++) {
    const d = step * 0.001
    if (free(x + d, y)) return [x + d, y]
    if (free(x - d, y)) return [x - d, y]
    if (free(x, y + d)) return [x, y + d]
    if (free(x, y - d)) return [x, y - d]
  }
  return [x, y]
}

/** Where the cue ball is offered to whoever has it in hand. */
export function cueSpot(balls: PoolBalls): [number, number] {
  return freeSpot(balls, POOL_HEAD_X, 0, 0)
}

// ---- the game --------------------------------------------------------------------------------------------------------

/** A table nobody is playing on: a fresh rack waiting for a break. */
export function newPool(table: string, seed: number): PoolState {
  return {
    table, players: [], turn: 0, phase: 'play', balls: rackBalls(seed), hand: 'kitchen', breaking: true, groups: null,
    shot: 0, rack: seed >>> 0, winner: null, last: null,
  }
}

const fresh = (s: PoolState, players: string[], turn: number, seed: number): PoolState => ({ ...newPool(s.table, seed), players, turn })

/** `userId` takes a cue. Null when that changes nothing (already playing, or two people already are). */
export function poolJoin(s: PoolState, userId: string, seed: number): PoolState | null {
  if (s.players.includes(userId) || s.players.length >= POOL_MAX_PLAYERS) return null
  const players = [...s.players, userId]
  // A second player starts a match from a fresh rack; a first one takes the table as it is (always a fresh rack).
  return players.length === 2 || s.phase === 'over' ? fresh(s, players, 0, seed) : { ...s, players }
}

/** `userId` puts the cue down. Null when they were not playing; `'empty'` when nobody is left (the table is reset). */
export function poolLeave(s: PoolState, userId: string, seed: number): PoolState | 'empty' | null {
  if (!s.players.includes(userId)) return null
  const players = s.players.filter((p) => p !== userId)
  if (!players.length) return 'empty'
  if (s.phase === 'over') return fresh(s, players, 0, seed)
  // The match becomes practice on the table as it stands.
  return { ...s, players, turn: 0, groups: null, winner: null, hand: s.balls[0] ? s.hand : 'any' }
}

/** A new rack. After a match the winner breaks. Null when `userId` is not playing. */
export function poolRack(s: PoolState, userId: string, seed: number): PoolState | null {
  if (!s.players.includes(userId)) return null
  return fresh(s, s.players, s.winner ? Math.max(0, s.players.indexOf(s.winner)) : 0, seed)
}

export type PoolShotError = 'not_playing' | 'not_your_turn' | 'over' | 'stale' | 'bad_spot'

/** What the rules need to know about a shot. */
function read(events: PoolEvent[]): { potted: number[]; scratch: boolean; first: number | null; railAfter: boolean } {
  const potted: number[] = []
  let scratch = false, first: number | null = null, railAfter = false
  for (const e of events) {
    if (e.k === 'pot') {
      if (e.a === 0) scratch = true
      else potted.push(e.a)
    } else if (e.k === 'ball') {
      if (first === null && e.a === 0) first = e.b
    } else if (e.k === 'rail' && first !== null) {
      railAfter = true
    }
  }
  return { potted, scratch, first, railAfter }
}

/**
 * `userId` shoots. Runs the physics and the rules and returns the table afterwards (with the shot in `last`), or why
 * the shot does not count.
 */
export function poolShoot(s: PoolState, userId: string, seq: number, shot: PoolShot, cue?: readonly [number, number]): { state: PoolState } | { error: PoolShotError } {
  const me = s.players.indexOf(userId)
  if (me < 0) return { error: 'not_playing' }
  if (s.phase !== 'play') return { error: 'over' }
  if (me !== s.turn) return { error: 'not_your_turn' }
  if (seq !== s.shot) return { error: 'stale' }
  const from = s.balls.slice()
  if (s.hand && cue) {
    if (!cueSpotFree(from, cue[0], cue[1], s.hand)) return { error: 'bad_spot' }
    from[0] = [cue[0], cue[1]]
  }
  if (!from[0]) return { error: 'bad_spot' }

  const sim = simulateShot(from, shot)
  const { potted, scratch, first, railAfter } = read(sim.events)
  const balls = sim.balls
  const last: PoolLastShot = { by: userId, shot, from, foul: scratch ? 'scratch' : null, potted, ms: Math.ceil(sim.seconds * 1000) }
  const next: PoolState = { ...s, balls, shot: s.shot + 1, breaking: false, hand: scratch ? 'any' : null, last }

  if (s.players.length < 2) {
    // Practice: nothing is a foul but the scratch, and an empty table is racked again.
    if (!balls.some((b, i) => i > 0 && b)) return { state: { ...fresh(s, s.players, 0, nextSeed(s.rack)), shot: s.shot + 1, last } }
    return { state: next }
  }

  const other = 1 - me
  const mine = s.groups?.[me] ?? null
  const cleared = mine !== null && !from.some((b, i) => b && poolGroupOf(i) === mine)
  if (!scratch) {
    if (first === null) last.foul = 'no_hit'
    else if (!s.breaking && (cleared ? first !== 8 : mine ? poolGroupOf(first) !== mine : first === 8)) last.foul = 'wrong_ball'
    else if (!potted.length && !railAfter) last.foul = 'no_rail'
  }
  const foul = last.foul !== null
  if (foul) next.hand = 'any'

  if (potted.includes(8)) {
    if (s.breaking) {
      balls[8] = freeSpot(balls, POOL_FOOT_X, 0, 8)
    } else {
      return { state: { ...next, phase: 'over', hand: null, winner: s.players[!foul && cleared ? me : other]! } }
    }
  }
  if (!s.groups && !s.breaking && !foul) {
    const decides = potted.find((b) => b !== 8)
    if (decides !== undefined) {
      const g = poolGroupOf(decides)!
      const o: PoolGroup = g === 'solid' ? 'stripe' : 'solid'
      next.groups = me === 0 ? [g, o] : [o, g]
    }
  }
  const keeps = !foul && (s.breaking ? potted.some((b) => b !== 8) : potted.some((b) => poolGroupOf(b) === next.groups?.[me]))
  next.turn = keeps ? me : other
  return { state: next }
}
