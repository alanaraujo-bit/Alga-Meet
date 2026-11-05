import { describe, expect, it } from 'vitest'
import { SyncController, type SyncAction } from './sync'

const FRAME_MS = 50

/** Feeds `n` frames of `errMs` starting at `t0`; returns the last action. */
function feed(s: SyncController, errMs: number, n = 10, t0 = 0, targetS?: number): SyncAction {
  let a: SyncAction = { kind: 'none' }
  for (let i = 0; i < n; i++) a = s.frame(errMs, t0 + i * FRAME_MS, targetS)
  return a
}

describe('SyncController', () => {
  it('does nothing under 20 ms', () => {
    expect(feed(new SyncController(), 10)).toEqual({ kind: 'none' })
    expect(feed(new SyncController(), -19)).toEqual({ kind: 'none' })
  })

  it('waits for a full window of 10 frames before acting', () => {
    expect(feed(new SyncController(), 900, 9)).toEqual({ kind: 'none' })
  })

  it('nudges the rate by err / 3000 between 20 and 500 ms (ahead -> slower, behind -> faster)', () => {
    const a = feed(new SyncController(), 100)
    expect(a.kind).toBe('rate')
    expect(a.kind === 'rate' && a.rate).toBeCloseTo(1 - 100 / 3000, 10)
    const b = feed(new SyncController(), -100)
    expect(b.kind === 'rate' && b.rate).toBeCloseTo(1 + 100 / 3000, 10)
  })

  it('caps the nudge at 5%', () => {
    expect(feed(new SyncController(), 400)).toEqual({ kind: 'rate', rate: 0.95 })
    expect(feed(new SyncController(), -400)).toEqual({ kind: 'rate', rate: 1.05 })
  })

  it('seeks to the target plus the learned seek latency above 500 ms', () => {
    const s = new SyncController({ seekLatencyMs: 80 })
    expect(feed(s, 600, 10, 0, 42)).toEqual({ kind: 'seek', toS: expect.closeTo(42.08, 9) })
    s.learnSeekLatency(120) // first measurement replaces the default
    expect(feed(s, -600, 10, 1_000, 42)).toEqual({ kind: 'seek', toS: expect.closeTo(42.12, 9) })
    expect(s.seekLatencyMs).toBe(120)
  })

  it('smooths later latency measurements', () => {
    const s = new SyncController()
    s.learnSeekLatency(100)
    s.learnSeekLatency(200)
    expect(s.seekLatencyMs).toBeGreaterThan(100)
    expect(s.seekLatencyMs).toBeLessThan(200)
  })

  it('seeks when 100 ms does not converge within 5 s', () => {
    const s = new SyncController()
    let firstRate: number | null = null
    let seekAt: number | null = null
    for (let t = 0; t <= 10_000 && seekAt === null; t += FRAME_MS) {
      const a = s.frame(100, t)
      if (a.kind === 'rate') firstRate ??= t
      if (a.kind === 'seek') seekAt = t
    }
    expect(firstRate).not.toBeNull()
    expect(seekAt! - firstRate!).toBeGreaterThanOrEqual(5_000)
    expect(seekAt! - firstRate!).toBeLessThan(5_000 + FRAME_MS)
  })

  it('restarts the 5 s budget once the error is back under 20 ms', () => {
    const s = new SyncController()
    feed(s, 100, 10, 0)
    feed(s, 5, 10, 4_000) // converged at ~4.2 s
    expect(feed(s, 100, 10, 4_600)).toMatchObject({ kind: 'rate' })
    expect(s.frame(100, 9_000)).toMatchObject({ kind: 'rate' }) // ~4.2 s into the new correction: still under 5 s
  })

  it('takes the median: an isolated 900 ms spike among nine 10 ms frames is ignored', () => {
    const s = new SyncController()
    feed(s, 10, 9)
    expect(s.frame(900, 500)).toEqual({ kind: 'none' })
    const m = new SyncController()
    feed(m, 10, 5)
    m.frame(900, 300)
    expect(feed(m, 10, 4, 400)).toEqual({ kind: 'none' })
  })

  it('starts over after a seek and after reset()', () => {
    const s = new SyncController()
    expect(feed(s, 600)).toMatchObject({ kind: 'seek' })
    expect(s.frame(600, 1_000)).toEqual({ kind: 'none' }) // window cleared by the seek
    feed(s, 100, 9, 2_000)
    s.reset()
    expect(s.frame(100, 3_000)).toEqual({ kind: 'none' })
  })
})
