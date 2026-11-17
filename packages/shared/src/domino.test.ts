import { describe, expect, it } from 'vitest'
import {
  DOMINO_BOT, DOMINO_GOAL, DOMINO_TILES, DominoClientFrameSchema, dominoAuto, dominoBotMove, dominoBotSeat, dominoDeal, dominoEnds, dominoFaces,
  dominoMoves, dominoPips, dominoPlay, dominoSit, dominoStand, dominoStep, dominoView, dominoViewMoves, newDomino,
  type DominoState,
} from './domino.js'
import { LOUNGE_ROOM, roomProblem, roomSeats, worldItem } from './worlds-catalog.js'

const tile = (a: number, b: number): number => DOMINO_TILES.findIndex((t) => t[0] === Math.min(a, b) && t[1] === Math.max(a, b))
const seated = (...who: (string | null)[]): DominoState => {
  let s = newDomino('dom')
  who.forEach((w, i) => {
    if (w) s = dominoSit(s, i, w)!
  })
  return s
}
const play = (s: DominoState, seat: number, t: number, end: 0 | 1): DominoState => {
  const r = dominoPlay(s, seat, t, end)
  if ('error' in r) throw new Error(r.error)
  return r.state
}
/** A round in progress with the hands, the line and the stock given by hand. */
const rig = (hands: (number[] | null)[], line: DominoState['line'], more: Partial<DominoState> = {}): DominoState => ({
  ...newDomino('dom'), seats: hands.map((h, i) => (h ? `u${i}` : null)), phase: 'play', hands, line, round: 1, teams: hands.every(Boolean),
  mask: hands.reduce((m, h, i) => m | (h ? 1 << i : 0), 0), ...more,
})
/** Lets the table play by itself until the round is over. */
function finish(s: DominoState, seed = 1): DominoState {
  for (let i = 0; i < 400 && s.phase === 'play'; i++) s = dominoStep(s, seed + i)
  return s
}

describe('domino tiles', () => {
  it('are the 28 of a double-six set', () => {
    expect(DOMINO_TILES).toHaveLength(28)
    expect(new Set(DOMINO_TILES.map((t) => `${t[0]}-${t[1]}`)).size).toBe(28)
    expect(DOMINO_TILES.reduce((n, _, i) => n + dominoPips(i), 0)).toBe(168)
    expect(DOMINO_TILES[tile(6, 6)]).toEqual([6, 6])
  })
})

describe('chairs', () => {
  it('a person takes an empty chair or a bot\'s, never another person\'s, and only one', () => {
    let s = seated('ana')
    expect(dominoSit(s, 0, 'bia')).toBeNull()
    expect(dominoSit(s, 1, 'ana')).toBeNull()
    expect(dominoSit(s, 4, 'bia')).toBeNull()
    s = dominoSit(s, 2, DOMINO_BOT)!
    expect(dominoSit(s, 2, DOMINO_BOT)).toBeNull()
    s = dominoSit(s, 2, 'bia')!
    expect(s.seats).toEqual(['ana', null, 'bia', null])
  })

  it('a bot goes across first, then to the right, then to the left, and comes off in the reverse order', () => {
    let s = seated(null, 'ana')
    const order: number[] = []
    for (let i = 0; i < 3; i++) {
      const seat = dominoBotSeat(s, 1, true)!
      order.push(seat)
      s = dominoSit(s, seat, DOMINO_BOT)!
    }
    expect(order).toEqual([3, 2, 0])
    expect(dominoBotSeat(s, 1, true)).toBeNull()
    expect(dominoBotSeat(s, 1, false)).toBe(0)
  })

  it('leaving between rounds empties the chair; the last person leaving ends the game', () => {
    const s = seated('ana', 'bia')
    const left = dominoStand(s, 1) as DominoState
    expect(left.seats).toEqual(['ana', null, null, null])
    expect(dominoStand(left, 0)).toBe('empty')
    expect(dominoStand(left, 3)).toBeNull()
    // Bots do not keep a table alive.
    expect(dominoStand(dominoSit(seated('ana'), 2, DOMINO_BOT)!, 0)).toBe('empty')
  })

  it('leaving in the middle of a round leaves a bot with the hand, and a person can take it back', () => {
    let s = dominoDeal(seated('ana', 'bia', 'caio'), 7)!
    const hand = s.hands[1]
    s = dominoStand(s, 1) as DominoState
    expect(s.seats[1]).toBe(DOMINO_BOT)
    expect(s.hands[1]).toBe(hand)
    // The bot may not be sent away while it holds tiles.
    expect(dominoStand(s, 1)).toBeNull()
    expect(dominoSit(s, 1, DOMINO_BOT)).toBeNull()
    s = dominoSit(s, 1, 'duda')!
    expect(s.seats[1]).toBe('duda')
    expect(s.hands[1]).toBe(hand)
  })
})

describe('dealing', () => {
  it('needs two at the table and is refused during a round', () => {
    expect(dominoDeal(seated('ana'), 1)).toBeNull()
    const s = dominoDeal(seated('ana', 'bia'), 1)!
    expect(dominoDeal(s, 2)).toBeNull()
  })

  it('four play in pairs with every tile dealt; two or three leave a stock', () => {
    const four = dominoDeal(seated('a', 'b', 'c', 'd'), 3)!
    expect(four.teams).toBe(true)
    expect(four.hands.map((h) => h!.length)).toEqual([7, 7, 7, 7])
    expect(four.stock).toHaveLength(0)
    const three = dominoDeal(seated('a', null, 'c', 'd'), 3)!
    expect(three.teams).toBe(false)
    expect(three.hands.map((h) => h?.length ?? null)).toEqual([7, null, 7, 7])
    expect(three.stock).toHaveLength(7)
    expect(dominoDeal(seated('a', 'b'), 3)!.stock).toHaveLength(14)
    const all = [...three.hands.flatMap((h) => h ?? []), ...three.stock].sort((x, y) => x - y)
    expect(all).toEqual(DOMINO_TILES.map((_, i) => i))
  })

  it('the first round is opened by the highest double, and only with it', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = dominoDeal(seated('a', 'b', 'c', 'd'), seed)!
      expect(s.must).toBe(tile(6, 6))
      expect(s.hands[s.turn]).toContain(tile(6, 6))
      expect(dominoMoves(s, s.turn)).toEqual([[tile(6, 6), 1]])
      const other = s.hands[s.turn]!.find((t) => t !== s.must)!
      expect(dominoPlay(s, s.turn, other, 1)).toEqual({ error: 'no_fit' })
    }
    // With two at the table the double-six may be in the stock: the highest double dealt opens, or the heaviest tile.
    for (let seed = 1; seed <= 40; seed++) {
      const s = dominoDeal(seated('a', 'b'), seed)!
      const dealt = s.hands.flatMap((h) => h ?? [])
      const doubles = dealt.filter((t) => DOMINO_TILES[t]![0] === DOMINO_TILES[t]![1])
      if (doubles.length) expect(s.must).toBe(Math.max(...doubles))
      else expect(dominoPips(s.must!)).toBe(Math.max(...dealt.map(dominoPips)))
    }
  })
})

describe('playing', () => {
  it('a tile is turned so that the matching number touches, on either end', () => {
    let s = rig([[tile(6, 6), tile(0, 1)], [tile(6, 3), tile(0, 2)], [tile(5, 6), tile(0, 3)], [tile(3, 1), tile(0, 4)]], [], { turn: 0 })
    s = play(s, 0, tile(6, 6), 1)
    expect(dominoEnds(s.line)).toEqual([6, 6])
    s = play(s, 1, tile(6, 3), 1)
    expect(dominoEnds(s.line)).toEqual([6, 3])
    s = play(s, 2, tile(5, 6), 0)
    expect(dominoEnds(s.line)).toEqual([5, 3])
    expect(s.origin).toBe(1)
    s = play(s, 3, tile(3, 1), 1)
    expect(s.line.map(dominoFaces)).toEqual([[5, 6], [6, 6], [6, 3], [3, 1]])
    expect(s.turn).toBe(0)
  })

  it('refuses a play out of turn, with a tile not held, that does not fit, or made on an old state', () => {
    const s = rig([[tile(1, 2), tile(4, 4)], [tile(2, 3), tile(0, 0)], null, null], [[tile(1, 1), 0]], { turn: 0, stock: [tile(5, 5)] })
    expect(dominoPlay(s, 1, tile(2, 3), 1)).toEqual({ error: 'not_your_turn' })
    expect(dominoPlay(s, 0, tile(2, 3), 1)).toEqual({ error: 'not_yours' })
    expect(dominoPlay(s, 0, tile(4, 4), 1)).toEqual({ error: 'no_fit' })
    expect(dominoPlay(s, 0, tile(1, 2), 1, s.seq + 1)).toEqual({ error: 'stale' })
    expect(dominoPlay(s, 2, tile(1, 2), 1)).toEqual({ error: 'not_playing' })
    expect('state' in dominoPlay(s, 0, tile(1, 2), 0, s.seq)).toBe(true)
  })

  it('with nothing that fits the table draws for you until something does, then passes when the stock is gone', () => {
    let s = rig([[tile(4, 4), tile(1, 1)], [tile(2, 3), tile(0, 0)], null, null], [[tile(2, 2), 0]], { turn: 0, stock: [tile(5, 5), tile(2, 6)] })
    expect(dominoAuto(s)).toMatchObject({ kind: 'draw' })
    s = dominoStep(s, 1)
    expect(s.last).toEqual({ k: 'draw', seat: 0, tile: tile(5, 5) })
    expect(s.turn).toBe(0)
    s = dominoStep(s, 1)
    expect(s.hands[0]).toContain(tile(2, 6))
    expect(s.stock).toHaveLength(0)
    expect(dominoAuto(s)).toMatchObject({ kind: 'idle' })
    // Nothing to draw and nothing that fits: the turn passes.
    let p = rig([[tile(4, 4)], [tile(2, 3), tile(0, 0)], null, null], [[tile(2, 2), 0]], { turn: 0 })
    expect(dominoAuto(p)).toMatchObject({ kind: 'pass' })
    p = dominoStep(p, 1)
    expect(p.last).toEqual({ k: 'pass', seat: 0 })
    expect(p.turn).toBe(1)
  })

  it('a game nobody can play on is blocked: fewest pips wins a point, a shared lowest count nobody', () => {
    // Line 6|6: nobody holds a six.
    let s = rig([[tile(6, 6), tile(1, 1)], [tile(2, 3)], [tile(0, 1)], [tile(4, 5)]], [], { turn: 0 })
    s = play(s, 0, tile(6, 6), 1)
    expect(s.phase).toBe('done')
    // Pairs: 0+2 hold 2+1 = 3, 1+3 hold 5+9 = 14.
    expect(s.result).toMatchObject({ kind: 'blocked', side: 0, by: null, points: 1, pips: [2, 5, 1, 9] })
    expect(s.score.slice(0, 2)).toEqual([1, 0])
    // The lightest hand of the winning pair opens the next round.
    expect(s.opener).toBe(2)

    let t = rig([[tile(6, 6), tile(1, 1)], [tile(0, 2)], null, null], [], { turn: 0 })
    t = play(t, 0, tile(6, 6), 1)
    expect(t.result).toMatchObject({ kind: 'tie', side: null, points: 0 })
    expect(t.score).toEqual([0, 0, 0, 0])
    expect(t.opener).toBeNull()
  })

  it('a stock that runs out on someone with nothing to play does not leave the table passing for ever', () => {
    let s = rig([[tile(4, 4)], [tile(1, 3)], null, null], [[tile(2, 2), 0]], { turn: 0, stock: [tile(5, 5)] })
    s = dominoStep(s, 1)
    expect(s.phase).toBe('done')
    expect(s.result).toMatchObject({ kind: 'blocked', side: 1 })
  })
})

describe('going out', () => {
  const ends = [[tile(2, 5), 0]] as DominoState['line']
  it('is worth 1 point, 2 with a double, 3 with a tile for both ends, 4 with a double for both ends', () => {
    const simple = play(rig([[tile(5, 1)], [tile(0, 0)], null, null], ends, { turn: 0 }), 0, tile(5, 1), 1)
    expect(simple.result).toMatchObject({ kind: 'simple', points: 1, side: 0, by: 0, match: false })
    const double = play(rig([[tile(5, 5)], [tile(0, 0)], null, null], ends, { turn: 0 }), 0, tile(5, 5), 1)
    expect(double.result).toMatchObject({ kind: 'double', points: 2 })
    const laElo = play(rig([[tile(1, 5)], [tile(0, 0)], null, null], [[tile(1, 2), 0], [tile(2, 5), 0]], { turn: 0 }), 0, tile(1, 5), 0)
    expect(laElo.result).toMatchObject({ kind: 'both', points: 3 })
    const cross = play(rig([[tile(5, 5)], [tile(0, 0)], null, null], [[tile(2, 5), 1], [tile(2, 2), 0], [tile(2, 5), 0]], { turn: 0 }), 0, tile(5, 5), 0)
    expect(cross.result).toMatchObject({ kind: 'cross', points: 4 })
  })

  it('in pairs the point goes to the pair, and the one who went out opens the next round freely', () => {
    let s = rig([[tile(0, 0)], [tile(0, 1)], [tile(5, 1)], [tile(0, 2)]], ends, { turn: 2 })
    s = play(s, 2, tile(5, 1), 1)
    expect(s.result).toMatchObject({ side: 0, by: 2 })
    expect(s.score.slice(0, 2)).toEqual([1, 0])
    const next = dominoDeal(s, 9)!
    expect(next).toMatchObject({ round: 2, turn: 2, must: null })
    expect(next.score.slice(0, 2)).toEqual([1, 0])
    expect(dominoMoves(next, 2)).toHaveLength(7)
  })

  it(`the side that reaches ${DOMINO_GOAL} wins the match, and the next deal starts another`, () => {
    let s = rig([[tile(5, 5)], [tile(0, 0)], null, null], [[tile(2, 5), 1], [tile(2, 2), 0], [tile(2, 5), 0]], { turn: 0, score: [3, 5, 0, 0], round: 4 })
    s = play(s, 0, tile(5, 5), 1)
    expect(s.score).toEqual([7, 5, 0, 0])
    expect(s.result?.match).toBe(true)
    expect(dominoAuto(s)).toMatchObject({ kind: 'next' })
    const next = dominoStep(s, 5)
    expect(next).toMatchObject({ phase: 'play', round: 1, score: [0, 0, 0, 0] })
    expect(next.must).not.toBeNull()
  })

  it('a match starts over when the chairs taken change between rounds', () => {
    let s = rig([[tile(5, 1)], [tile(0, 0)], null, null], ends, { turn: 0, score: [2, 1, 0, 0], round: 3 })
    s = play(s, 0, tile(5, 1), 1)
    s = dominoSit(s, 2, 'caio')!
    const next = dominoDeal(s, 4)!
    expect(next).toMatchObject({ round: 1, score: [0, 0, 0, 0] })
    expect(next.hands.map((h) => !!h)).toEqual([true, true, true, false])
  })

  it('after the round the table deals again by itself, or goes back to waiting when people left', () => {
    const done = play(rig([[tile(5, 1)], [tile(0, 0)], null, null], ends, { turn: 0 }), 0, tile(5, 1), 1)
    expect(dominoStep(done, 3).phase).toBe('play')
    const alone = dominoStand(done, 1) as DominoState
    expect(dominoStep(alone, 3)).toMatchObject({ phase: 'lobby', seats: ['u0', null, null, null], line: [], result: null })
  })
})

describe('bots and the table by itself', () => {
  it('a bot plays something legal, heavy tiles and doubles first', () => {
    const s = rig([[tile(1, 2), tile(2, 6), tile(2, 2)], [tile(0, 0)], null, null], [[tile(2, 3), 0]], { turn: 0, seats: [DOMINO_BOT, 'u1', null, null] })
    expect(dominoAuto(s)).toMatchObject({ kind: 'bot' })
    expect(dominoBotMove(s, 0)).toEqual([tile(2, 2), 0])
    expect(dominoBotMove(rig([[tile(4, 4)], [tile(0, 0)], null, null], [[tile(2, 3), 0]]), 0)).toBeNull()
  })

  it('every round ends, with every tile still on the table or in a hand, whoever sits there', () => {
    for (const who of [['a', 'b'], ['a', null, 'c', 'd'], ['a', 'b', 'c', 'd']]) {
      for (let seed = 1; seed <= 120; seed++) {
        const s = finish(dominoDeal(seated(...who), seed * 7919)!, seed)
        expect(s.phase).toBe('done')
        const all = [...s.line.map((p) => p[0]), ...s.hands.flatMap((h) => h ?? []), ...s.stock].sort((x, y) => x - y)
        expect(all).toEqual(DOMINO_TILES.map((_, i) => i))
        // The line is a chain: each tile touches the next with the same number.
        for (let i = 1; i < s.line.length; i++) expect(dominoFaces(s.line[i - 1]!)[1]).toBe(dominoFaces(s.line[i]!)[0])
        const r = s.result!
        if (r.by !== null) expect(s.hands[r.by]).toHaveLength(0)
        else expect(s.hands.every((_, i) => !dominoMoves({ ...s, phase: 'play' }, i).length)).toBe(true)
      }
    }
  })

  it('a match played by the table alone reaches its end', () => {
    let s = dominoDeal(seated('a', 'b', 'c', 'd'), 11)!
    let rounds = 0
    for (let i = 0; i < 20_000 && !s.result?.match; i++) {
      if (s.phase === 'done') rounds++
      s = dominoStep(s, i + 1)
    }
    expect(s.result?.match).toBe(true)
    expect(Math.max(...s.score)).toBeGreaterThanOrEqual(DOMINO_GOAL)
    expect(rounds).toBeGreaterThan(0)
  })
})

describe('what each person is told', () => {
  it('only their own tiles, the others counted; a drawn tile only to who drew it', () => {
    let s = dominoDeal(seated('ana', 'bia'), 21)!
    const va = dominoView(s, 'ana'), vb = dominoView(s, 'bia'), vw = dominoView(s, null)
    expect(va.hand).toEqual(s.hands[0])
    expect(vb.hand).toEqual(s.hands[1])
    expect(vw.hand).toBeNull()
    for (const v of [va, vb, vw]) {
      expect(v.counts).toEqual([7, 7, 0, 0])
      expect(v.playing).toEqual([true, true, false, false])
      expect(v.stock).toBe(14)
      expect(v.shown).toBeNull()
      expect(JSON.stringify(v)).not.toContain('"hands"')
    }
    // The opening tile is told to who holds it and nobody else.
    expect([va.must, vb.must][s.turn]).toBe(s.must)
    expect([va.must, vb.must][1 - s.turn]).toBeNull()
    expect(dominoViewMoves(dominoView(s, s.seats[s.turn]!), s.turn)).toEqual([[s.must, 1]])
    expect(dominoViewMoves(dominoView(s, s.seats[1 - s.turn]!), 1 - s.turn)).toEqual([])

    s = rig([[tile(4, 4)], [tile(2, 3)], null, null], [[tile(2, 2), 0]], { turn: 0, stock: [tile(5, 5), tile(2, 6)], seats: ['ana', 'bia', null, null] })
    s = dominoStep(s, 1)
    expect(dominoView(s, 'ana').last).toEqual({ k: 'draw', seat: 0, tile: tile(5, 5) })
    expect(dominoView(s, 'bia').last).toEqual({ k: 'draw', seat: 0 })
    expect(dominoView(s, null).last).toEqual({ k: 'draw', seat: 0 })
  })

  it('every hand is shown once the round is over', () => {
    const s = finish(dominoDeal(seated('ana', 'bia', 'caio'), 5)!)
    expect(dominoView(s, null).shown).toEqual(s.hands)
  })
})

describe('frames and the piece', () => {
  it('frames are checked', () => {
    const channelId = '0b7e9d6e-6c0a-4d1f-9f0e-2b8f5a1c3d4e'
    const ok = (f: unknown) => DominoClientFrameSchema.safeParse(f).success
    expect(ok({ op: 'world_domino_start', channelId, table: 'dom' })).toBe(true)
    expect(ok({ op: 'world_domino_bot', channelId, table: 'dom', add: true })).toBe(true)
    expect(ok({ op: 'world_domino_play', channelId, table: 'dom', seq: 3, tile: 27, end: 1 })).toBe(true)
    expect(ok({ op: 'world_domino_play', channelId, table: 'dom', seq: 3, tile: 28, end: 1 })).toBe(false)
    expect(ok({ op: 'world_domino_play', channelId, table: 'dom', seq: 3, tile: 2, end: 2 })).toBe(false)
    expect(ok({ op: 'world_domino_play', channelId, table: 'DOM!', seq: 3, tile: 2, end: 0 })).toBe(false)
    expect(ok({ op: 'world_domino_bot', channelId, table: 'dom' })).toBe(false)
  })

  it('the lounge has a domino table with four chairs facing it', () => {
    const def = worldItem('w_mesa_domino')!
    expect(def.game).toBe('domino')
    expect(def.seats).toHaveLength(4)
    // Each chair looks at the middle of the table.
    for (const [x, z, yaw] of def.seats!) {
      const far = Math.hypot(x, z)
      expect(far).toBeGreaterThan(0.6)
      expect(x + Math.sin(yaw) * far).toBeCloseTo(0, 6)
      expect(z + Math.cos(yaw) * far).toBeCloseTo(0, 6)
    }
    expect(LOUNGE_ROOM.items.some((i) => i.id === 'dom' && i.sku === 'w_mesa_domino')).toBe(true)
    expect([...roomSeats(LOUNGE_ROOM)].filter((s) => s.startsWith('dom:'))).toHaveLength(4)
    expect(roomProblem(LOUNGE_ROOM, null)).toBeNull()
  })
})
