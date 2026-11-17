/**
 * Dominó: the domino table of Alga Worlds (docs/worlds-domino.md). A room item whose catalog entry has
 * `game: 'domino'` is a square table with four chairs. Sitting on one of them is being at the game and standing up is
 * leaving it: there is no other way in or out. Chair n of the table is seat `<table id>:<n>` of the room; play goes
 * 0, 1, 2, 3, which is anticlockwise seen from above. An empty chair may be given to a bot.
 *
 * The game as played here (Brazilian double-six, 28 tiles, 7 each):
 * - Four at the table play in pairs, partners facing each other (chairs 0+2 against 1+3), and there is no stock.
 *   Two or three play each for themselves, and whoever has no tile that fits draws from the stock until one does.
 * - No tile that fits and nothing to draw: the turn passes.
 * - The first round of a match is opened by whoever holds the highest double, with that tile. After that the winner of
 *   the round opens the next one with any tile.
 * - Going out ("bater") is worth 1 point; with a double ("carroça") 2; with a tile that fits both ends ("lá-e-lô") 3;
 *   with a double that fits both ends ("cruzada") 4. A blocked game ("trancado") gives 1 point to the side holding
 *   the fewest pips, and nothing to anyone when the lowest count is shared.
 * - The first side to reach DOMINO_GOAL points wins the match. A match also starts over when the people at the table
 *   change between rounds (someone sat on an empty chair, a chair was emptied).
 * - Someone who stands up in the middle of a round leaves a bot on the chair with their hand; anyone may sit on a
 *   bot's chair and carry on from there.
 *
 * Realtime. The server owns every table (apps/server/src/worlds.ts): hands are secret, so each person is sent a view of
 * the game with only their own tiles (WORLD_DOMINO). What the table does by itself (a bot's move, a draw, a pass, the
 * move of someone who took too long, the next round) is decided here (`dominoAuto`, `dominoStep`) and timed by the
 * server. Frames are `world_domino_*`: they count in the world quota.
 */
import { z } from 'zod'

export const DOMINO_SEATS = 4
export const DOMINO_HAND = 7
/** Points that close a match. */
export const DOMINO_GOAL = 6
/** What a chair holds when a bot plays on it (user ids are UUIDs). */
export const DOMINO_BOT = 'bot'
/** How long the table waits before doing each thing by itself, in ms. */
export const DOMINO_PACE = { bot: 1300, draw: 700, pass: 1300, idle: 45_000, next: 10_000, match: 16_000 } as const

/** The 28 tiles: tile n is [a, b] with a <= b, in the order 0-0, 0-1 … 0-6, 1-1 … 6-6. */
export const DOMINO_TILES: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = []
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) out.push([a, b])
  return out
})()

export const dominoPips = (tile: number): number => DOMINO_TILES[tile]![0] + DOMINO_TILES[tile]![1]
export const dominoIsDouble = (tile: number): boolean => DOMINO_TILES[tile]![0] === DOMINO_TILES[tile]![1]
const has = (tile: number, n: number): boolean => DOMINO_TILES[tile]![0] === n || DOMINO_TILES[tile]![1] === n

/** A tile on the table: flipped (1) when its higher number is the one towards the left end of the line. */
export type DominoPlaced = readonly [tile: number, flip: 0 | 1]
/** The two numbers of a placed tile as they lie: [towards the left end, towards the right end]. */
export const dominoFaces = (p: DominoPlaced): [number, number] => {
  const [a, b] = DOMINO_TILES[p[0]]!
  return p[1] ? [b, a] : [a, b]
}
/** The open numbers of the line: [left, right]. Null while nothing was played. */
export function dominoEnds(line: readonly DominoPlaced[]): [number, number] | null {
  if (!line.length) return null
  return [dominoFaces(line[0]!)[0], dominoFaces(line[line.length - 1]!)[1]]
}

/** How a round ended. simple/double/both/cross: someone went out (see the header); blocked; tie: blocked with the lowest count shared. */
export type DominoOut = 'simple' | 'double' | 'both' | 'cross' | 'blocked' | 'tie'
export const DOMINO_POINTS: Record<DominoOut, number> = { simple: 1, double: 2, both: 3, cross: 4, blocked: 1, tie: 0 }

export interface DominoResult {
  /** The side that won the round; null when it was tied. */
  side: number | null
  /** The chair that played the last tile; null in a blocked game. */
  by: number | null
  kind: DominoOut
  points: number
  /** Pips each chair was left holding. */
  pips: number[]
  /** The round closed the match: `side` reached DOMINO_GOAL. */
  match: boolean
}

/** What the last change was, for whoever draws it. A drawn tile is only told to who drew it. */
export type DominoLast =
  | { k: 'deal' }
  | { k: 'play'; seat: number; tile: number; end: 0 | 1 }
  | { k: 'draw'; seat: number; tile?: number }
  | { k: 'pass'; seat: number }

/** What the people at the table and whoever watches all know. */
interface DominoPublic {
  /** Id of the table's item in the room. */
  table: string
  /** Who is on each chair: a user id, DOMINO_BOT, or null. */
  seats: (string | null)[]
  /** lobby: nothing dealt. play: a round is on. done: a round ended and `result` says how. */
  phase: 'lobby' | 'play' | 'done'
  /** The tiles on the table, from the left end to the right end. */
  line: DominoPlaced[]
  /** Index in `line` of the first tile played: the line grows both ways from it. */
  origin: number
  /** The chair that plays next. */
  turn: number
  /** Grows with every change of the game: a play carries it, so a repeated or late one is dropped. */
  seq: number
  /** Four in the round: pairs, chairs 0+2 against 1+3. */
  teams: boolean
  /** Points of each side in the match: by chair, or [pair of 0 and 2, pair of 1 and 3] when `teams`. */
  score: number[]
  /** Rounds dealt in this match. */
  round: number
  last: DominoLast | null
  result: DominoResult | null
}

/** The whole game, as the server holds it. */
export interface DominoState extends DominoPublic {
  /** The hand of each chair; null for a chair that is not in the round. */
  hands: (number[] | null)[]
  /** Tiles to draw from, next first. */
  stock: number[]
  /** The tile that has to open the round (the highest double dealt), or null when the opener is free to choose. */
  must: number | null
  /** The chairs taken when the match began, a bit each: a different set at the next deal starts a new match. */
  mask: number
  /** The chair that opens the next round; null: whoever holds the highest double. */
  opener: number | null
}

export type DominoAutoKind = 'bot' | 'draw' | 'pass' | 'idle' | 'next'

/** The game as one person is told it: everyone's tiles are counted, only their own are named. */
export interface DominoView extends DominoPublic {
  /** Tiles in each hand. */
  counts: number[]
  /** Chairs that are in the round. */
  playing: boolean[]
  /** Tiles left to draw. */
  stock: number
  /** The hand of whoever this is sent to; null when they are not in the round. */
  hand: number[] | null
  /** The tile that has to open the round, told only to who holds it. */
  must: number | null
  /** Every hand, face up, once the round is over. */
  shown: (number[] | null)[] | null
  /** Filled by the server on the way out: what the table does by itself next, and in how many ms. */
  auto?: { kind: DominoAutoKind; ms: number } | null
}

export type DominoClientFrame =
  /** Deal: the first round, or the next one without waiting. Anyone sitting at the table, never during a round. */
  | { op: 'world_domino_start'; channelId: string; table: string }
  /** Put a bot on an empty chair, or take one off. Anyone sitting at the table, never during a round. */
  | { op: 'world_domino_bot'; channelId: string; table: string; add: boolean }
  /** `seq` = DominoView.seq. `end`: 0 the left end of the line, 1 the right. */
  | { op: 'world_domino_play'; channelId: string; table: string; seq: number; tile: number; end: 0 | 1 }

const uuid = z.uuid()
const table = z.string().regex(/^[a-z0-9]{1,12}$/, 'table id')
export const DominoClientFrameSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('world_domino_start'), channelId: uuid, table }),
  z.object({ op: z.literal('world_domino_bot'), channelId: uuid, table, add: z.boolean() }),
  z.object({
    op: z.literal('world_domino_play'), channelId: uuid, table, seq: z.number().int().min(0).max(10_000_000),
    tile: z.number().int().min(0).max(27), end: z.union([z.literal(0), z.literal(1)]),
  }),
])

// ---- chairs ----------------------------------------------------------------------------------------------------------

const EMPTY = <T>(v: T): T[] => new Array<T>(DOMINO_SEATS).fill(v)
const isPerson = (who: string | null): boolean => who !== null && who !== DOMINO_BOT

/** A table nobody sits at. */
export function newDomino(table: string): DominoState {
  return {
    table, seats: EMPTY<string | null>(null), phase: 'lobby', hands: EMPTY<number[] | null>(null), stock: [], line: [], origin: 0, turn: 0, seq: 0,
    must: null, teams: false, score: EMPTY(0), round: 0, mask: 0, opener: null, last: null, result: null,
  }
}

/** The side a chair scores for. */
export const dominoSide = (s: Pick<DominoPublic, 'teams'>, seat: number): number => (s.teams ? seat % 2 : seat)

/**
 * `who` (a user id, or DOMINO_BOT) takes chair `seat`. A person may take an empty chair or a bot's, hand and all; a bot
 * only an empty one, and never during a round. Null when that is not allowed or changes nothing.
 */
export function dominoSit(s: DominoState, seat: number, who: string): DominoState | null {
  if (!Number.isInteger(seat) || seat < 0 || seat >= DOMINO_SEATS) return null
  const now = s.seats[seat] ?? null
  if (who === DOMINO_BOT) {
    if (now !== null || s.phase === 'play') return null
  } else if (isPerson(now) || s.seats.includes(who)) {
    return null
  }
  const seats = s.seats.slice()
  seats[seat] = who
  return { ...s, seats, seq: s.seq + 1, last: null }
}

/**
 * Chair `seat` is left. A person who leaves in the middle of a round leaves a bot there to finish it. `'empty'` when
 * no person is left at the table (the game is over); null when that is not allowed or changes nothing.
 */
export function dominoStand(s: DominoState, seat: number): DominoState | 'empty' | null {
  const now = s.seats[seat] ?? null
  if (now === null) return null
  const inRound = s.phase === 'play' && !!s.hands[seat]
  if (now === DOMINO_BOT && inRound) return null
  const seats = s.seats.slice()
  seats[seat] = inRound ? DOMINO_BOT : null
  if (!seats.some(isPerson)) return 'empty'
  return { ...s, seats, seq: s.seq + 1, last: null }
}

/** The chair a bot is put on (or taken off) when the person on chair `from` asks: across first, then right, then left. */
export function dominoBotSeat(s: Pick<DominoPublic, 'seats'>, from: number, add: boolean): number | null {
  const order = [2, 1, 3].map((d) => (from + d) % DOMINO_SEATS)
  const seat = add ? order.find((i) => s.seats[i] === null) : order.reverse().find((i) => s.seats[i] === DOMINO_BOT)
  return seat ?? null
}

// ---- a round ---------------------------------------------------------------------------------------------------------

const nextSeed = (seed: number): number => (Math.imul(seed, 1664525) + 1013904223) >>> 0

function shuffled(seed: number): number[] {
  let s = seed >>> 0
  const tiles = DOMINO_TILES.map((_, i) => i)
  for (let i = tiles.length - 1; i > 0; i--) {
    s = nextSeed(s)
    const j = Math.floor((s / 4294967296) * (i + 1))
    const t = tiles[i]!
    tiles[i] = tiles[j]!
    tiles[j] = t
  }
  return tiles
}

/** What decides who opens: any double beats any other tile, then the heavier one. */
const rank = (tile: number): number => {
  if (tile < 0) return -1
  const [a, b] = DOMINO_TILES[tile]!
  return a === b ? 1000 + a : (a + b) * 10 + b
}

/**
 * Deals a round to everyone at the table. Null during a round or with fewer than two chairs taken. The match starts
 * over (score cleared, the highest double opens) when the last one was won or the chairs taken are not the same.
 */
export function dominoDeal(s: DominoState, seed: number): DominoState | null {
  if (s.phase === 'play') return null
  const taken = s.seats.map((who) => who !== null)
  const n = taken.filter(Boolean).length
  if (n < 2) return null
  const mask = taken.reduce((m, on, i) => m | (on ? 1 << i : 0), 0)
  const fresh = s.round === 0 || mask !== s.mask || s.result?.match === true
  const tiles = shuffled(seed)
  const hands = taken.map((on) => (on ? tiles.splice(0, DOMINO_HAND).sort((a, b) => a - b) : null))
  let turn = 0
  let must: number | null = null
  if (!fresh && s.opener !== null && hands[s.opener]) {
    turn = s.opener
  } else {
    let best = -1
    hands.forEach((hand, i) => hand?.forEach((tile) => {
      if (rank(tile) > rank(best)) {
        best = tile
        turn = i
      }
    }))
    must = best
  }
  return {
    ...s, phase: 'play', hands, stock: tiles, line: [], origin: 0, turn, seq: s.seq + 1, must, teams: n === DOMINO_SEATS,
    score: fresh ? EMPTY(0) : s.score, round: fresh ? 1 : s.round + 1, mask, opener: null, last: { k: 'deal' }, result: null,
  }
}

/** Every play chair `seat` could make now: [tile, end]. A tile that fits both ends is there twice. */
export function dominoMoves(s: Pick<DominoState, 'phase' | 'hands' | 'line' | 'must'>, seat: number): [number, 0 | 1][] {
  const hand = s.hands[seat]
  if (!hand || s.phase !== 'play') return []
  const ends = dominoEnds(s.line)
  if (!ends) return hand.filter((t) => s.must === null || t === s.must).map((t) => [t, 1])
  const out: [number, 0 | 1][] = []
  for (const t of hand) {
    if (has(t, ends[0])) out.push([t, 0])
    if (has(t, ends[1])) out.push([t, 1])
  }
  return out
}

/** The line with `tile` put on one of its ends, turned so that the matching number touches. */
export function dominoPlace(line: readonly DominoPlaced[], origin: number, tile: number, end: 0 | 1): { line: DominoPlaced[]; origin: number } {
  const ends = dominoEnds(line)
  const [a, b] = DOMINO_TILES[tile]!
  if (!ends) return { line: [[tile, 0]], origin: 0 }
  if (end === 0) return { line: [[tile, b === ends[0] ? 0 : 1], ...line], origin: origin + 1 }
  return { line: [...line, [tile, a === ends[1] ? 0 : 1]], origin }
}

const nextSeat = (s: Pick<DominoState, 'hands'>, seat: number): number => {
  for (let d = 1; d <= DOMINO_SEATS; d++) if (s.hands[(seat + d) % DOMINO_SEATS]) return (seat + d) % DOMINO_SEATS
  return seat
}

/** The round is over: `by` went out with a play of kind `kind`, or (null) nobody can play. */
function finish(s: DominoState, by: number | null, kind: DominoOut): DominoState {
  const pips = s.hands.map((hand) => (hand ? hand.reduce((n, t) => n + dominoPips(t), 0) : 0))
  let side: number | null = null
  let opener: number | null = null
  if (by !== null) {
    side = dominoSide(s, by)
    opener = by
  } else {
    const sums = new Map<number, number>()
    s.hands.forEach((hand, i) => {
      if (hand) sums.set(dominoSide(s, i), (sums.get(dominoSide(s, i)) ?? 0) + pips[i]!)
    })
    const low = Math.min(...sums.values())
    const lowest = [...sums].filter(([, v]) => v === low)
    if (lowest.length === 1) {
      side = lowest[0]![0]
      // The lightest hand of the side that won opens the next round.
      s.hands.forEach((hand, i) => {
        if (hand && dominoSide(s, i) === side && (opener === null || pips[i]! < pips[opener]!)) opener = i
      })
    } else {
      kind = 'tie'
    }
  }
  const points = DOMINO_POINTS[kind]
  const score = s.score.slice()
  if (side !== null) score[side] = (score[side] ?? 0) + points
  const match = side !== null && score[side]! >= DOMINO_GOAL
  return { ...s, phase: 'done', score, opener, result: { side, by, kind, points, pips, match } }
}

/** Nobody has a tile that fits and there is nothing to draw: the game is blocked. */
const settle = (s: DominoState): DominoState =>
  !s.stock.length && !s.hands.some((_, i) => dominoMoves(s, i).length) ? finish(s, null, 'blocked') : s

export type DominoError = 'not_playing' | 'not_your_turn' | 'stale' | 'not_yours' | 'no_fit'

/** Chair `seat` puts `tile` on an end of the line. `seq`, when given, must be the game's. */
export function dominoPlay(s: DominoState, seat: number, tile: number, end: 0 | 1, seq?: number): { state: DominoState } | { error: DominoError } {
  const hand = s.hands[seat]
  if (s.phase !== 'play' || !hand) return { error: 'not_playing' }
  if (seq !== undefined && seq !== s.seq) return { error: 'stale' }
  if (seat !== s.turn) return { error: 'not_your_turn' }
  if (!hand.includes(tile)) return { error: 'not_yours' }
  if (!dominoMoves(s, seat).some((m) => m[0] === tile && (m[1] === end || !s.line.length))) return { error: 'no_fit' }
  const ends = dominoEnds(s.line)
  const both = !!ends && has(tile, ends[0]) && has(tile, ends[1])
  const kind: DominoOut = dominoIsDouble(tile) ? (both ? 'cross' : 'double') : both ? 'both' : 'simple'
  const hands = s.hands.slice()
  hands[seat] = hand.filter((t) => t !== tile)
  const next: DominoState = { ...s, ...dominoPlace(s.line, s.origin, tile, end), hands, seq: s.seq + 1, must: null, last: { k: 'play', seat, tile, end } }
  if (!hands[seat]!.length) return { state: finish(next, seat, kind) }
  next.turn = nextSeat(next, seat)
  return { state: settle(next) }
}

/**
 * The play a bot makes: it gets rid of heavy tiles and doubles first, and prefers to leave open a number it still
 * holds. Null when nothing fits.
 */
export function dominoBotMove(s: Pick<DominoState, 'phase' | 'hands' | 'line' | 'must'>, seat: number): [number, 0 | 1] | null {
  const hand = s.hands[seat] ?? []
  const ends = dominoEnds(s.line)
  let best: [number, 0 | 1] | null = null
  let bestScore = -Infinity
  for (const move of dominoMoves(s, seat)) {
    const [a, b] = DOMINO_TILES[move[0]]!
    // The number this play leaves open on its end.
    const open = !ends ? b : a === ends[move[1]] ? b : a
    const keep = hand.filter((t) => t !== move[0] && has(t, open)).length
    const score = a + b + (a === b ? 6 : 0) + keep * 4
    if (score > bestScore) {
      best = move
      bestScore = score
    }
  }
  return best
}

/** What the table does by itself next and after how long; null when it waits for someone to deal. */
export function dominoAuto(s: DominoState): { kind: DominoAutoKind; ms: number } | null {
  if (s.phase === 'lobby') return null
  if (s.phase === 'done') return { kind: 'next', ms: s.result?.match ? DOMINO_PACE.match : DOMINO_PACE.next }
  if (!dominoMoves(s, s.turn).length) return s.stock.length ? { kind: 'draw', ms: DOMINO_PACE.draw } : { kind: 'pass', ms: DOMINO_PACE.pass }
  return s.seats[s.turn] === DOMINO_BOT ? { kind: 'bot', ms: DOMINO_PACE.bot } : { kind: 'idle', ms: DOMINO_PACE.idle }
}

/** Does what `dominoAuto` announced: a bot's play, one tile drawn, a pass, the play of someone who took too long, the next round. */
export function dominoStep(s: DominoState, seed: number): DominoState {
  const auto = dominoAuto(s)
  if (!auto) return s
  const seat = s.turn
  switch (auto.kind) {
    case 'next':
      // Not enough people for another round: back to waiting.
      return dominoDeal(s, seed) ?? { ...newDomino(s.table), seats: s.seats, seq: s.seq + 1 }
    case 'draw': {
      const [tile, ...stock] = s.stock
      const hands = s.hands.slice()
      hands[seat] = [...hands[seat]!, tile!]
      return settle({ ...s, hands, stock, seq: s.seq + 1, last: { k: 'draw', seat, tile: tile! } })
    }
    case 'pass':
      return settle({ ...s, turn: nextSeat(s, seat), seq: s.seq + 1, last: { k: 'pass', seat } })
    case 'bot':
    case 'idle': {
      const move = dominoBotMove(s, seat)
      const r = move ? dominoPlay(s, seat, move[0], move[1]) : null
      return r && 'state' in r ? r.state : s
    }
  }
}

/** The game as `userId` may see it (null: someone who only watches). */
export function dominoView(s: DominoState, userId: string | null): DominoView {
  const seat = userId === null ? -1 : s.seats.indexOf(userId)
  const { hands, stock, must, mask: _mask, opener: _opener, last, ...open } = s
  return {
    ...open,
    counts: hands.map((hand) => hand?.length ?? 0),
    playing: hands.map((hand) => !!hand),
    stock: stock.length,
    hand: seat >= 0 ? hands[seat] ?? null : null,
    must: seat >= 0 && seat === s.turn ? must : null,
    shown: s.phase === 'done' ? hands : null,
    last: last?.k === 'draw' && last.seat !== seat ? { k: 'draw', seat: last.seat } : last,
  }
}

/** The plays `view`'s owner could make right now: [tile, end]. Empty when it is not their turn. */
export function dominoViewMoves(v: DominoView, seat: number): [number, 0 | 1][] {
  if (v.phase !== 'play' || v.turn !== seat || !v.hand) return []
  const hands = EMPTY<number[] | null>(null)
  hands[seat] = v.hand
  return dominoMoves({ phase: v.phase, hands, line: v.line, must: v.must }, seat)
}
