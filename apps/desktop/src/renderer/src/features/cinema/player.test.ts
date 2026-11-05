import type { CinemaPieceMeta } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { bufferPlan, scheduleDelayMs } from './player'

const sha = 'a'.repeat(64)
const piece = (startS: number, durS: number): CinemaPieceMeta => [startS, durS, 1_000, sha]
const INIT = piece(-1, 0)

describe('bufferPlan', () => {
  // Generation order (R4): a run from 8 s, then a gap-filling run from 0 s.
  const pieces = [INIT, piece(8, 4), piece(12, 4), piece(0, 4), piece(4, 4)]

  it('appends what is missing from the playhead on, in startS order (not n order)', () => {
    expect(bufferPlan([], 0, pieces)).toEqual({ append: [3, 4, 1, 2], removeBeforeS: null, removeAfterS: null })
    expect(bufferPlan([{ startS: 0, endS: 8 }], 5, pieces)).toEqual({ append: [1, 2], removeBeforeS: null, removeAfterS: null })
  })

  it('includes the piece that holds the playhead and skips what is behind it', () => {
    expect(bufferPlan([], 9, pieces).append).toEqual([1, 2])
  })

  it('never appends the init segment or zero-length pieces', () => {
    expect(bufferPlan([], 0, [INIT, piece(0, 0)]).append).toEqual([])
  })

  it('looks only 60 s ahead', () => {
    const many = [INIT, ...Array.from({ length: 30 }, (_, i) => piece(i * 4, 4))] // 0..120 s
    const { append } = bufferPlan([], 10, many)
    expect(append[0]).toBe(3) // 8..12 holds the playhead
    expect(append.at(-1)).toBe(18) // 68..72 starts before 70
    expect(append).not.toContain(19) // 72..76 starts past playhead + 60
  })

  it('treats a range a few frames short of a piece edge as covering it (keyframe shift)', () => {
    expect(bufferPlan([{ startS: 0.126, endS: 7.96 }], 1, pieces).append).toEqual([1, 2])
  })

  it('appends a piece shorter than twice the edge tolerance (the tolerance shrinks to half the piece)', () => {
    expect(bufferPlan([{ startS: 0, endS: 4 }], 1, [INIT, piece(0, 4), piece(4, 0.2)]).append).toEqual([2])
    expect(bufferPlan([{ startS: 0, endS: 4.15 }], 1, [INIT, piece(0, 4), piece(4, 0.2)]).append).toEqual([])
  })

  it('fills a hole between buffered ranges', () => {
    expect(bufferPlan([{ startS: 0, endS: 8 }, { startS: 12, endS: 16 }], 1, pieces).append).toEqual([1])
  })

  it('skips holes in a sparse index', () => {
    const sparse: CinemaPieceMeta[] = [INIT]
    sparse[3] = piece(0, 4)
    expect(bufferPlan([], 0, sparse).append).toEqual([3])
  })

  it('removes what is more than 30 s behind the playhead', () => {
    expect(bufferPlan([{ startS: 0, endS: 50 }], 40, pieces).removeBeforeS).toBe(10)
    expect(bufferPlan([{ startS: 15, endS: 50 }], 40, pieces).removeBeforeS).toBeNull()
    expect(bufferPlan([{ startS: 0, endS: 20 }], 20, pieces).removeBeforeS).toBeNull()
  })

  it('removes what is more than 90 s ahead of the playhead (after a backward seek)', () => {
    expect(bufferPlan([{ startS: 0, endS: 200 }], 10, pieces).removeAfterS).toBe(100)
    expect(bufferPlan([{ startS: 0, endS: 100 }], 10, pieces).removeAfterS).toBeNull()
  })
})

describe('scheduleDelayMs', () => {
  it('converts the server instant to a client delay', () => {
    // server = client + 500, so server 10 000 is client 9 500: 500 ms from client 9 000
    expect(scheduleDelayMs(10_000, 500, 9_000)).toBe(500)
    expect(scheduleDelayMs(10_000, -500, 9_000)).toBe(1_500)
  })

  it('is never negative', () => {
    expect(scheduleDelayMs(10_000, 500, 9_600)).toBe(0)
    expect(scheduleDelayMs(0, 0, 1e12)).toBe(0)
  })
})
