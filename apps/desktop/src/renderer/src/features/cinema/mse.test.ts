import type { CinemaPieceMeta, CinemaTrackId } from '@alga/shared'
import { describe, expect, it, vi } from 'vitest'
import { aheadOf, feedLane, gapJumpTarget, laneOf, swapLane, type PieceSource, type TimeRange } from './mse'

const piece = (startS: number, durS: number, sha = 'a'.repeat(64)): CinemaPieceMeta => [startS, durS, 1_000, sha]
const INIT = piece(-1, 0)
const AAC = 'audio/mp4; codecs="mp4a.40.2"'
const OPUS = 'audio/mp4; codecs="opus"'

/** SourceBuffer stand-in: a buffer of byteLength n + 1 is piece n; media pieces add their range to `buffered`. */
class FakeSourceBuffer extends EventTarget {
  mode = 'sequence'
  updating = false
  type = AAC
  appended: number[] = []
  removed: [number, number][] = []
  ranges: TimeRange[] = []
  quotaAfter = Infinity
  failOn = -1
  rejectType: string | null = null
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
    if (n === this.failOn) return this.later('error', 'updateend')
    if (d > 0) this.ranges.push({ startS: s, endS: s + d })
    this.later('updateend')
  }

  remove(start: number, end: number): void {
    this.removed.push([start, end])
    this.ranges = this.ranges.flatMap((r) => [
      ...(r.startS < start ? [{ startS: r.startS, endS: Math.min(r.endS, start) }] : []),
      ...(r.endS > end ? [{ startS: Math.max(r.startS, end), endS: r.endS }] : []),
    ])
    this.later('updateend')
  }

  changeType(type: string): void {
    if (type === this.rejectType) throw new DOMException('no', 'NotSupportedError')
    this.type = type
  }

  abort(): void {}

  private later(...events: string[]): void {
    queueMicrotask(() => {
      for (const e of events) this.dispatchEvent(new Event(e))
    })
  }
}

const swarmOf = (
  tracks: Partial<Record<CinemaTrackId, CinemaPieceMeta[]>>,
  held: (track: CinemaTrackId, n: number) => boolean = () => true,
  onGet?: (track: CinemaTrackId, n: number) => void,
): PieceSource => ({
  pieces: (t) => tracks[t] ?? [],
  get: async (t, n) => {
    onGet?.(t, n)
    return tracks[t]?.[n] && held(t, n) ? new ArrayBuffer(n + 1) : null
  },
})

const setup = (pieces: CinemaPieceMeta[], track: CinemaTrackId = 'v', mime = 'video/mp4') => {
  const fake = new FakeSourceBuffer(pieces)
  return { fake, lane: laneOf(fake as unknown as SourceBuffer, track, mime) }
}

describe('feedLane', () => {
  const run = (pieces: CinemaPieceMeta[], held: number[]) => {
    const { fake, lane } = setup(pieces)
    const swarm = swarmOf({ v: pieces }, (_t, n) => held.includes(n))
    return { fake, lane, feed: () => feedLane(lane, swarm, () => 0, () => true) }
  }

  it('appends the init, then the held media pieces in startS order, in segments mode', async () => {
    const { fake, feed } = run([INIT, piece(8, 4), piece(12, 4), piece(0, 4), piece(4, 4)], [0, 1, 3, 4])
    await feed()
    expect(fake.mode).toBe('segments')
    expect(fake.appended).toEqual([0, 3, 4, 1]) // 12..16 (n 2) is not held yet
    await feed()
    expect(fake.appended).toEqual([0, 3, 4, 1]) // nothing new: buffered already covers it
  })

  it('skips a regenerated piece whose range another piece already filled (R4)', async () => {
    const { fake, feed } = run([INIT, piece(0, 4), piece(0, 4.1)], [0, 1, 2])
    await feed()
    expect(fake.appended).toEqual([0, 1])
  })

  it('re-appends the init when its version changes', async () => {
    const pieces = [INIT, piece(0, 4)]
    const { fake, feed } = run(pieces, [0, 1])
    await feed()
    pieces[0] = piece(-1, 0, 'b'.repeat(64))
    await feed()
    expect(fake.appended).toEqual([0, 1, 0])
  })

  it('stops the round on QuotaExceededError', async () => {
    const { fake, feed } = run([INIT, piece(0, 4), piece(4, 4), piece(8, 4)], [0, 1, 2, 3])
    fake.quotaAfter = 2
    await expect(feed()).resolves.toBeUndefined()
    expect(fake.appended).toEqual([0, 1])
  })

  it('abandons a stale plan when the playhead moved more than 1 s (a seek)', async () => {
    const pieces = [INIT, piece(0, 4), piece(4, 4), piece(8, 4)]
    const { fake, lane } = setup(pieces)
    let playhead = 0
    const swarm = swarmOf({ v: pieces }, () => true, (_t, n) => {
      if (n === 2) playhead = 50
    })
    await feedLane(lane, swarm, () => playhead, () => true)
    expect(fake.appended).toEqual([0, 1])
  })

  it('keeps the round going while the playhead advances with normal playback', async () => {
    const pieces = [INIT, piece(0, 4), piece(4, 4), piece(8, 4)]
    const { fake, lane } = setup(pieces)
    let playhead = 0
    let clock = 0
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock)
    try {
      // each read takes 1.5 s while the video plays at 1×: the playhead ends 4.5 s on, never a stale plan
      const swarm = swarmOf({ v: pieces }, () => true, () => {
        clock += 1500
        playhead += 1.5
      })
      await feedLane(lane, swarm, () => playhead, () => true)
    } finally {
      now.mockRestore()
    }
    expect(fake.appended).toEqual([0, 1, 2, 3])
  })

  it('abandons a stale plan on a backward seek too', async () => {
    const pieces = [INIT, piece(0, 4), piece(4, 4), piece(8, 4)]
    const { fake, lane } = setup(pieces)
    let playhead = 6
    const swarm = swarmOf({ v: pieces }, () => true, (_t, n) => {
      if (n === 3) playhead = 1
    })
    await feedLane(lane, swarm, () => playhead, () => true)
    expect(fake.appended).toEqual([0, 2])
  })

  it('a swarm read that throws ends the round without breaking the lane', async () => {
    const pieces = [INIT, piece(0, 4), piece(4, 4)]
    const { fake, lane } = setup(pieces)
    let fail = true
    const base = swarmOf({ v: pieces })
    const swarm: PieceSource = { pieces: base.pieces, get: async (t, n) => (n === 2 && fail ? Promise.reject(new Error('cache read')) : base.get(t, n)) }
    await expect(feedLane(lane, swarm, () => 0, () => true)).resolves.toBeUndefined()
    expect(lane.broken).toBe(false)
    expect(fake.appended).toEqual([0, 1])
    fail = false
    await feedLane(lane, swarm, () => 0, () => true)
    expect(fake.appended).toEqual([0, 1, 2])
  })

  it('cuts what is more than 90 s ahead after a backward seek', async () => {
    const pieces = [INIT, piece(0, 4)]
    const { fake, lane } = setup(pieces)
    fake.ranges = [{ startS: 0, endS: 300 }]
    await feedLane(lane, swarmOf({ v: pieces }), () => 10, () => true)
    expect(fake.removed).toEqual([[100, Infinity]])
  })

  it('rejects on a SourceBuffer error and stops feeding that lane', async () => {
    const pieces = [INIT, piece(0, 4), piece(4, 4), piece(8, 4)]
    const { fake, lane, feed } = run(pieces, [0, 1, 2, 3])
    fake.failOn = 2
    await expect(feed()).rejects.toThrow(/SourceBuffer error/)
    expect(lane.broken).toBe(true)
    expect(fake.appended).toEqual([0, 1, 2])
    await expect(feed()).resolves.toBeUndefined()
    expect(fake.appended).toEqual([0, 1, 2])
  })
})

describe('swapLane', () => {
  const a1 = [INIT, piece(0, 4), piece(4, 4)]
  const a2 = [piece(-1, 0, 'c'.repeat(64)), piece(0, 4), piece(4, 4)]

  const started = async () => {
    const { fake, lane } = setup(a1, 'a1', AAC)
    await feedLane(lane, swarmOf({ a1 }), () => 1, () => true)
    fake.appended = []
    return { fake, lane }
  }

  it('empties the buffer, changes the type, appends the new init, then takes the new track', async () => {
    const { fake, lane } = await started()
    await swapLane(lane, swarmOf({ a1, a2 }), 'a2', OPUS)
    expect(fake.removed).toEqual([[0, Infinity]])
    expect(fake.type).toBe(OPUS)
    expect(fake.appended).toEqual([0])
    expect(lane).toMatchObject({ track: 'a2', mime: OPUS, init: 'c'.repeat(64), swapping: false })
  })

  it('touches nothing when the new init is not held yet', async () => {
    const { fake, lane } = await started()
    await expect(swapLane(lane, swarmOf({ a1, a2 }, (t, n) => !(t === 'a2' && n === 0)), 'a2', OPUS)).rejects.toThrow(/init/)
    expect(fake.removed).toEqual([])
    expect(lane).toMatchObject({ track: 'a1', mime: AAC, init: 'a'.repeat(64), swapping: false })
  })

  it('keeps the old track working when the new type is refused', async () => {
    const { fake, lane } = await started()
    fake.rejectType = OPUS
    await expect(swapLane(lane, swarmOf({ a1, a2 }), 'a2', OPUS)).rejects.toThrow()
    expect(lane).toMatchObject({ track: 'a1', mime: AAC, init: null, swapping: false, broken: false })
    expect(fake.type).toBe(AAC)
    await feedLane(lane, swarmOf({ a1 }), () => 1, () => true)
    expect(fake.appended).toEqual([0, 1, 2]) // old init and pieces back at the playhead
  })
})

describe('aheadOf', () => {
  const joined = [{ startS: 0, endS: 10 }, { startS: 10.126, endS: 30 }] // HEVC open-GOP run join (Task 8)

  it('walks across a hole up to 0.25 s', () => {
    expect(aheadOf(joined, 5)).toBeCloseTo(25, 9)
  })

  it('gives the same answer on both sides of a range boundary', () => {
    expect(aheadOf(joined, 10)).toBeCloseTo(20, 9)
    expect(aheadOf(joined, 9.999)).toBeCloseTo(20.001, 9)
  })

  it('stops at a wider hole', () => {
    const wide = [{ startS: 0, endS: 10 }, { startS: 10.3, endS: 30 }]
    expect(aheadOf(wide, 5)).toBeCloseTo(5, 9)
    expect(aheadOf(wide, 10)).toBe(0)
  })

  it('counts a range that starts just after the playhead (keyframe shift after a seek)', () => {
    expect(aheadOf([{ startS: 10.05, endS: 20 }], 10)).toBeCloseTo(10, 9)
    expect(aheadOf([], 10)).toBe(0)
  })
})

describe('gapJumpTarget', () => {
  it('returns the next range start when it is within 0.25 s', () => {
    expect(gapJumpTarget([{ startS: 0, endS: 10 }, { startS: 10.126, endS: 30 }], 10)).toBe(10.126)
    expect(gapJumpTarget([{ startS: 10.05, endS: 20 }], 10)).toBe(10.05)
  })

  it('returns null for a wider hole, inside a range, or with nothing ahead', () => {
    expect(gapJumpTarget([{ startS: 0, endS: 10 }, { startS: 10.3, endS: 30 }], 10)).toBeNull()
    expect(gapJumpTarget([{ startS: 0, endS: 10 }, { startS: 10.126, endS: 30 }], 9.5)).toBeNull()
    expect(gapJumpTarget([{ startS: 0, endS: 30 }], 10)).toBeNull()
  })
})
