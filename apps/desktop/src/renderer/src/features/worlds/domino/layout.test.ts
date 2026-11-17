import { DOMINO_TILES, dominoDeal, dominoSit, dominoStep, newDomino, type DominoPlaced, type DominoState } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { CHAIN_DEPTH, CHAIN_LIMIT, FELT_HALF, RACK_D, RACK_PER_ROW, TILE_L, TILE_T, TILE_W, chainLayout, chainNext, handSpots, pileSpot, spotHalf, stockSpot, type Spot } from './layout'

const tile = (a: number, b: number): number => DOMINO_TILES.findIndex((t) => t[0] === Math.min(a, b) && t[1] === Math.max(a, b))

/** How far apart two lying tiles are on each axis (negative on both: they overlap). */
function gap(a: Spot, b: Spot): [number, number] {
  const [ax, az] = spotHalf(a), [bx, bz] = spotHalf(b)
  return [Math.abs(a.x - b.x) - ax - bx, Math.abs(a.z - b.z) - az - bz]
}
const overlap = (a: Spot, b: Spot): boolean => {
  const [gx, gz] = gap(a, b)
  return gx < -1e-9 && gz < -1e-9
}
/** Two tiles next to each other in the line share part of an edge. */
const touching = (a: Spot, b: Spot): boolean => {
  const [gx, gz] = gap(a, b)
  return (Math.abs(gx) < 1e-9 && gz < -1e-9) || (Math.abs(gz) < 1e-9 && gx < -1e-9)
}

function check(line: readonly DominoPlaced[], origin: number): Spot[] {
  const spots = chainLayout(line, origin)
  expect(spots).toHaveLength(line.length)
  for (let i = 0; i < spots.length; i++) {
    const [hx, hz] = spotHalf(spots[i]!)
    // Inside the part of the felt the hands and the stock leave free.
    expect(Math.abs(spots[i]!.x) + hx).toBeLessThanOrEqual(CHAIN_LIMIT + TILE_W + 1e-9)
    expect(Math.abs(spots[i]!.z) + hz).toBeLessThanOrEqual(CHAIN_DEPTH + 1e-9)
    if (i > 0) expect(touching(spots[i - 1]!, spots[i]!), `tiles ${i - 1} and ${i} of ${JSON.stringify(line)} from ${origin}`).toBe(true)
    for (let j = 0; j < i; j++) expect(overlap(spots[i]!, spots[j]!), `tiles ${j} and ${i} of ${JSON.stringify(line)} from ${origin}`).toBe(false)
  }
  return spots
}

function played(seats: number, seed: number): DominoState[] {
  let s = newDomino('dom')
  for (let i = 0; i < seats; i++) s = dominoSit(s, i, `u${i}`)!
  s = dominoDeal(s, seed)!
  const out: DominoState[] = []
  for (let i = 0; i < 400 && s.phase === 'play'; i++) {
    s = dominoStep(s, seed + i)
    out.push(s)
  }
  return out
}

describe('the line on the table', () => {
  it('starts in the middle and grows both ways without a tile ever moving', () => {
    expect(chainLayout([], 0)).toEqual([])
    const one = chainLayout([[tile(2, 5), 0]], 0)
    expect(one).toEqual([{ x: 0, z: 0, rot: 0 }])
    for (let seed = 1; seed <= 12; seed++) {
      let before = new Map<number, Spot>()
      for (const s of played(4, seed * 31)) {
        const now = new Map(chainLayout(s.line, s.origin).map((spot, i) => [s.line[i]![0], spot]))
        for (const [t, spot] of before) expect(now.get(t)).toEqual(spot)
        before = now
      }
    }
  })

  it('lies the lower number of a tile towards its own -x, whichever way the line turns', () => {
    // 6|6 in the middle (across), then 6|3 to the right and 5|6 to the left.
    const spots = chainLayout([[tile(5, 6), 0], [tile(6, 6), 0], [tile(3, 6), 1]], 1)
    expect(spots[1]).toEqual({ x: 0, z: 0, rot: Math.PI / 2 })
    // Right of it: 6 towards the middle, so the tile's +x (its 6) points at -x.
    expect(spots[2]!.x).toBeCloseTo(TILE_W / 2 + TILE_L / 2, 9)
    expect(Math.cos(spots[2]!.rot)).toBeCloseTo(-1, 9)
    // Left of it: 5|6 with the 6 towards the middle, so its +x points at +x.
    expect(spots[0]!.x).toBeCloseTo(-(TILE_W / 2 + TILE_L / 2), 9)
    expect(Math.cos(spots[0]!.rot)).toBeCloseTo(1, 9)
  })

  it('no two tiles overlap, each touches the one before, and all stay on the free part of the felt', () => {
    let longest = 0
    for (const seats of [2, 3, 4]) {
      for (let seed = 1; seed <= 150; seed++) {
        const last = played(seats, seed * 7919).at(-1)!
        longest = Math.max(longest, last.line.length)
        check(last.line, last.origin)
        // The same tiles played all on one end, and all on the other: the longest arms there can be.
        check(last.line, 0)
        check(last.line, last.line.length - 1)
      }
    }
    expect(longest).toBeGreaterThan(20)
  })

  it('the whole set in one line still fits, from either end', () => {
    // Every tile once, each touching the next by number (a walk over all 28).
    const numbers = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 0, 2, 4, 6, 1, 3, 5, 0, 3, 6, 2, 5, 1, 4, 0]
    const line: DominoPlaced[] = []
    for (let i = 1; i < numbers.length; i++) line.push([tile(numbers[i - 1]!, numbers[i]!), numbers[i - 1]! > numbers[i]! ? 1 : 0])
    expect(new Set(line.map((p) => p[0])).size).toBe(28)
    check(line, 0)
    check(line, 27)
    check(line, 13)
  })

  it('says where a tile would go before it is played', () => {
    const line: DominoPlaced[] = [[tile(2, 5), 0]]
    const next = chainNext(line, 0, tile(5, 5), 1)
    expect(next.x).toBeCloseTo(TILE_L / 2 + TILE_W / 2, 9)
    expect(chainNext(line, 0, tile(1, 2), 0).x).toBeCloseTo(-TILE_L, 9)
    expect(chainNext([], 0, tile(6, 6), 1)).toEqual({ x: 0, z: 0, rot: Math.PI / 2 })
  })
})

describe('hands, stock and the waiting set', () => {
  it('a hand stands in front of its chair, in order from the left of who sits there, and never reaches the line or a neighbour', () => {
    const seven = handSpots(0, 7)
    expect(seven.every((p) => Math.abs(p.z - RACK_D) < 1e-9)).toBe(true)
    expect(seven.map((p) => p.x)).toEqual([...seven.map((p) => p.x)].sort((a, b) => a - b))
    // The chair on the right of chair 0 has its own left at the far side of the table from chair 0.
    expect(handSpots(1, 7)[0]!.z).toBeGreaterThan(handSpots(1, 7)[6]!.z)
    for (let seat = 0; seat < 4; seat++) {
      const all = handSpots(seat, 21)
      expect(all).toHaveLength(21)
      for (const p of all) {
        expect(Math.max(Math.abs(p.x), Math.abs(p.z))).toBeGreaterThan(CHAIN_LIMIT + TILE_W + TILE_T)
        expect(Math.max(Math.abs(p.x), Math.abs(p.z)) + TILE_T).toBeLessThan(FELT_HALF)
        expect(Math.min(Math.abs(p.x), Math.abs(p.z))).toBeLessThan(RACK_PER_ROW * TILE_W * 0.6)
      }
    }
  })

  it('the stock and the waiting set are laid out without overlap, clear of the hands', () => {
    const stock = Array.from({ length: 14 }, (_, i) => stockSpot(i))
    const pile = Array.from({ length: 28 }, (_, i) => pileSpot(i))
    for (const set of [stock, pile]) {
      for (let i = 0; i < set.length; i++) for (let j = 0; j < i; j++) expect(overlap(set[i]!, set[j]!)).toBe(false)
    }
    for (const s of stock) {
      expect(s.x - TILE_L / 2).toBeGreaterThan(RACK_PER_ROW * (TILE_W + 0.0035) / 2)
      expect(-s.z - TILE_W / 2).toBeGreaterThan(CHAIN_DEPTH)
      expect(Math.max(s.x + TILE_L / 2, -s.z + TILE_W / 2)).toBeLessThan(FELT_HALF)
    }
  })
})
