import type { CinemaPieceMeta } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { feedLane, laneOf, type PieceSource, type TimeRange } from './mse'
import { bufferPlan, scheduleDelayMs } from './player'

const sha = 'a'.repeat(64)
const piece = (startS: number, durS: number): CinemaPieceMeta => [startS, durS, 1_000, sha]
const INIT = piece(-1, 0)

describe('bufferPlan', () => {
  // Generation order (R4): a run from 8 s, then a gap-filling run from 0 s.
  const pieces = [INIT, piece(8, 4), piece(12, 4), piece(0, 4), piece(4, 4)]

  it('appends what is missing from the playhead on, in startS order (not n order)', () => {
    expect(bufferPlan([], 0, pieces)).toEqual({ append: [3, 4, 1, 2], removeBeforeS: null })
    expect(bufferPlan([{ startS: 0, endS: 8 }], 5, pieces)).toEqual({ append: [1, 2], removeBeforeS: null })
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

/** SourceBuffer stand-in: a buffer of byteLength n + 1 is piece n; media pieces add their range to `buffered`. */
class FakeSourceBuffer extends EventTarget {
  mode = 'sequence'
  updating = false
  appended: number[] = []
  ranges: TimeRange[] = []
  quotaAfter = Infinity
  constructor(private readonly pieces: CinemaPieceMeta[]) {
    super()
  }

  get buffered() {
    const r = this.ranges
    return { length: r.length, start: (i: number) => r[i]!.startS, end: (i: number) => r[i]!.endS }
  }

  appendBuffer(buf: ArrayBuffer): void {
    if (this.appended.length >= this.quotaAfter) throw new DOMException('full', 'QuotaExceededError')
    const n = buf.byteLength - 1
    this.appended.push(n)
    const [s, d] = this.pieces[n]!
    if (d > 0) this.ranges.push({ startS: s, endS: s + d })
    queueMicrotask(() => this.dispatchEvent(new Event('updateend')))
  }

  remove(): void {
    queueMicrotask(() => this.dispatchEvent(new Event('updateend')))
  }
}

const swarmOf = (pieces: CinemaPieceMeta[], held: number[]): PieceSource => ({
  pieces: () => pieces,
  get: async (_track, n) => (held.includes(n) ? new ArrayBuffer(n + 1) : null),
})

describe('feedLane', () => {
  const setup = (pieces: CinemaPieceMeta[], held: number[]) => {
    const fake = new FakeSourceBuffer(pieces)
    const lane = laneOf(fake as unknown as SourceBuffer, 'v', 'video/mp4')
    return { fake, lane, feed: () => feedLane(lane, swarmOf(pieces, held), () => 0, () => true) }
  }

  it('appends the init, then the held media pieces in startS order, in segments mode', async () => {
    const { fake, feed } = setup([INIT, piece(8, 4), piece(12, 4), piece(0, 4), piece(4, 4)], [0, 1, 3, 4])
    await feed()
    expect(fake.mode).toBe('segments')
    expect(fake.appended).toEqual([0, 3, 4, 1]) // 12..16 (n 2) is not held yet
    await feed()
    expect(fake.appended).toEqual([0, 3, 4, 1]) // nothing new: buffered already covers it
  })

  it('skips a regenerated piece whose range another piece already filled (R4)', async () => {
    const { fake, feed } = setup([INIT, piece(0, 4), piece(0, 4.1)], [0, 1, 2])
    await feed()
    expect(fake.appended).toEqual([0, 1])
  })

  it('re-appends the init when its version changes', async () => {
    const pieces = [INIT, piece(0, 4)]
    const { fake, feed } = setup(pieces, [0, 1])
    await feed()
    pieces[0] = [-1, 0, 1_000, 'b'.repeat(64)]
    await feed()
    expect(fake.appended).toEqual([0, 1, 0])
  })

  it('stops the round on QuotaExceededError', async () => {
    const { fake, feed } = setup([INIT, piece(0, 4), piece(4, 4), piece(8, 4)], [0, 1, 2, 3])
    fake.quotaAfter = 2
    await expect(feed()).resolves.toBeUndefined()
    expect(fake.appended).toEqual([0, 1])
  })
})
