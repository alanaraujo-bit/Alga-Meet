import { describe, expect, it, vi } from 'vitest'

vi.mock('@/store/session', () => ({ onDispatch: () => () => undefined, useSession: { getState: () => ({ send: () => true }) } }))
const { MAX_FLYING, REACTION_MS, emptyQueue, mergedHeat, push, takeToken, tick } = await import('./reactions')

const r = (id: number) => ({ id, userId: `u${id}`, emoji: '😂' as const })

describe('reaction queue', () => {
  it('at most 6 fly at once; the rest wait and take free places as others land', () => {
    let q = emptyQueue()
    for (let i = 1; i <= 8; i++) q = push(q, r(i), 1000 + i)
    expect(q.flying.map((f) => f.id)).toEqual([1, 2, 3, 4, 5, 6])
    expect(q.waiting.map((f) => f.id)).toEqual([7, 8])
    expect(tick(q, 1500)).toBe(q) // nothing landed: same object (no re-render)
    q = tick(q, 1001 + REACTION_MS) // #1 lands; #7 waited 1.59 s: still fresh, it takes the place
    expect(q.flying.map((f) => f.id)).toEqual([2, 3, 4, 5, 6, 7])
    expect(q.flying.at(-1)!.born).toBe(1001 + REACTION_MS)
    expect(q.flying).toHaveLength(MAX_FLYING)
  })

  it('expiry: every reaction lands after 1.6 s; one that waited a whole flight is dropped', () => {
    let q = emptyQueue()
    for (let i = 1; i <= 7; i++) q = push(q, r(i), 0)
    q = tick(q, REACTION_MS)
    expect(q).toEqual({ flying: [], waiting: [] })
  })

  it('the waiting line is bounded (oldest dropped)', () => {
    let q = emptyQueue()
    for (let i = 1; i <= 30; i++) q = push(q, r(i), 0)
    expect(q.flying).toHaveLength(6)
    expect(q.waiting).toHaveLength(12)
    expect(q.waiting[0]!.id).toBe(19)
  })
})

describe('heat between states', () => {
  it('adds live reactions to the server buckets, ignores out-of-range ones', () => {
    expect(mergedHeat([0, 2, 1], { 1: 3, 2: 1, 9: 5 })).toEqual([0, 5, 2])
    expect(mergedHeat([], {})).toEqual([])
  })
})

describe('client rate limit (server: 1/s, burst 5)', () => {
  it('5 at once, then one per second', () => {
    let b = { tokens: 5, at: 0 }
    const oks: boolean[] = []
    for (let i = 0; i < 7; i++) {
      const x = takeToken(b, 0)
      oks.push(x.ok)
      b = x.bucket
    }
    expect(oks).toEqual([true, true, true, true, true, false, false])
    expect(takeToken(b, 500).ok).toBe(false)
    expect(takeToken(b, 1000).ok).toBe(true)
  })
})
