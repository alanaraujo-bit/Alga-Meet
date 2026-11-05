import { describe, expect, it } from 'vitest'
import { ClockEstimator } from './clock'

describe('ClockEstimator', () => {
  it('has no offset before the first sample', () => {
    const c = new ClockEstimator()
    expect(c.offsetMs()).toBeNull()
    expect(c.serverNow(1_000)).toBe(1_000)
  })

  it('uses the sample with the smallest round trip (offset = s - (c + r) / 2)', () => {
    const c = new ClockEstimator()
    c.add({ c: 1_000, s: 6_000, r: 1_040 }) // rtt 40
    c.add({ c: 2_000, s: 7_010, r: 2_010 }) // rtt 10 -> 7010 - 2005 = 5005
    c.add({ c: 3_000, s: 8_100, r: 3_080 }) // rtt 80
    expect(c.offsetMs()).toBe(5_005)
    expect(c.serverNow(10_000)).toBe(15_005)
  })

  it('keeps at most 16 samples (the oldest best one ages out)', () => {
    const c = new ClockEstimator()
    c.add({ c: 0, s: 1_000, r: 4 }) // rtt 4, offset 998
    for (let i = 1; i <= 15; i++) c.add({ c: i * 1_000, s: i * 1_000 + 2_000, r: i * 1_000 + 20 })
    expect(c.offsetMs()).toBe(998)
    c.add({ c: 16_000, s: 18_000, r: 16_020 }) // 17th sample: the rtt-4 one is dropped
    expect(c.offsetMs()).toBe(1_990)
  })

  it('ignores a sample whose receive time is before its send time', () => {
    const c = new ClockEstimator()
    c.add({ c: 1_000, s: 5_000, r: 900 })
    expect(c.offsetMs()).toBeNull()
  })

  it('pings every 1 s until 8 samples, then every 15 s; reset starts over', () => {
    const c = new ClockEstimator()
    for (let i = 0; i < 8; i++) {
      expect(c.nextPingDelayMs()).toBe(1_000)
      c.add({ c: i, s: i, r: i + 10 })
    }
    expect(c.nextPingDelayMs()).toBe(15_000)
    c.reset()
    expect(c.nextPingDelayMs()).toBe(1_000)
    expect(c.offsetMs()).toBeNull()
  })

  it('detects a wall-clock jump against performance.now', () => {
    const c = new ClockEstimator()
    expect(c.jumped(100_000, 50)).toBe(false) // first call only sets the baseline
    expect(c.jumped(115_000, 15_052)).toBe(false) // both moved 15 s
    expect(c.jumped(120_010, 15_062)).toBe(true) // wall +5010 ms, performance.now +10 ms
    expect(c.jumped(120_020, 15_072)).toBe(false) // new baseline after the jump
    expect(c.jumped(118_000, 16_000)).toBe(true) // backwards too
  })
})
