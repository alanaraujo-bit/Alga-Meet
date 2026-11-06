import type { CinemaPieceMeta } from '@alga/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHUNK_BYTES, decode } from './protocol'
import { HIGH_WATER, PACE_ADJUST_MS, PACE_FLOOR, Pacer, PeerUploader, type ChannelLike } from './uploader'

afterEach(() => vi.useRealTimers())

describe('Pacer', () => {
  it('a prefetch piece may start once the debt of the previous ones is paid (rate × time)', () => {
    const p = new Pacer(1_000_000, 0)
    expect(p.waitMs(0)).toBe(0)
    p.spend(300_000, 0)
    expect(p.waitMs(0)).toBe(300)
    expect(p.waitMs(299)).toBe(1)
    expect(p.waitMs(300)).toBe(0)
  })
  it('idle time buys at most one chunk of credit', () => {
    const p = new Pacer(1_000_000, 0)
    p.spend(2 * CHUNK_BYTES, 60_000) // after a minute idle
    expect(p.waitMs(60_000)).toBe(Math.ceil((CHUNK_BYTES / 1_000_000) * 1000))
  })
  it('no base rate: never waits', () => {
    const p = new Pacer(0, 0)
    p.spend(10_000_000, 0)
    expect(p.waitMs(0)).toBe(0)
  })
  it('halves when a lane RTT exceeds 2× its baseline, at most once per PACE_ADJUST_MS, down to the floor', () => {
    const p = new Pacer(1_000_000, 0)
    p.rtt(0, 40, 0)
    p.rtt(1, 42, 0)
    p.rtt(0, 79, 0) // < 2 × 40
    expect(p.bps).toBe(1_000_000)
    p.rtt(0, 90, 10)
    expect(p.bps).toBe(500_000)
    p.rtt(1, 300, 20) // too soon after the last change
    expect(p.bps).toBe(500_000)
    for (let t = 1; t <= 5; t++) p.rtt(1, 300, t * PACE_ADJUST_MS + 10)
    expect(p.bps).toBe(1_000_000 * PACE_FLOOR)
  })
  it('climbs back by a quarter of the base per step once every lane is normal again', () => {
    const p = new Pacer(1_000_000, 0)
    p.rtt(0, 40, 0)
    p.rtt(0, 200, 0)
    p.rtt(0, 200, PACE_ADJUST_MS)
    expect(p.bps).toBe(250_000)
    p.rtt(0, 41, 2 * PACE_ADJUST_MS)
    expect(p.bps).toBe(500_000)
    p.rtt(0, 41, 3 * PACE_ADJUST_MS)
    p.rtt(0, 41, 4 * PACE_ADJUST_MS)
    p.rtt(0, 41, 5 * PACE_ADJUST_MS)
    expect(p.bps).toBe(1_000_000)
  })
  it('a LAN baseline (1 ms) needs +25 ms to count as inflated; a dropped lane no longer counts', () => {
    const p = new Pacer(1_000_000, 0)
    p.rtt(0, 1, 0)
    p.rtt(0, 20, 0)
    expect(p.bps).toBe(1_000_000)
    p.rtt(1, 10, 0)
    p.rtt(1, 100, 0)
    expect(p.bps).toBe(500_000)
    p.dropLane(1)
    p.rtt(0, 1, PACE_ADJUST_MS)
    expect(p.bps).toBe(750_000)
  })
})

/** A ChannelLike whose bufferedAmount the test sets; it logs (time, n, offset) of every chunk sent. */
function lane(buffered = 0) {
  const sent: [number, number, number][] = []
  const ch: ChannelLike & { bufferedAmount: number; sent: typeof sent } = {
    bufferedAmount: buffered, bufferedAmountLowThreshold: 0, onmessage: null, onbufferedamountlow: null, sent, close() {},
    send(d: ArrayBuffer) {
      const m = decode(d)
      if (m?.t === 'chunk') sent.push([Date.now(), m.n, m.offset])
    },
  }
  return ch
}
const SIZE = 2 * CHUNK_BYTES // two chunks per piece
const meta = (): CinemaPieceMeta => [0, 4, SIZE, '0'.repeat(64)]
function uploader(paceBps = 0) {
  return new PeerUploader({ read: async () => new ArrayBuffer(SIZE), meta, refused: vi.fn(), sent: () => undefined }, paceBps)
}
const settle = () => vi.advanceTimersByTimeAsync(0)

describe('PeerUploader', () => {
  it('stripes chunks over the lanes, least bufferedAmount first, skipping lanes above HIGH_WATER', async () => {
    vi.useFakeTimers()
    const up = uploader()
    const [a, b, c] = [lane(50_000), lane(10_000), lane(HIGH_WATER + 1)]
    up.addLane(0, a)
    up.addLane(1, b)
    up.addLane(2, c)
    up.add('v', 1, 0, true)
    await settle()
    // b had less queued: it takes the first chunk; the fakes' bufferedAmount does not grow, so b takes both
    expect(b.sent.map((s) => s[2])).toEqual([0, CHUNK_BYTES])
    expect(a.sent).toEqual([])
    b.bufferedAmount = HIGH_WATER + 1
    up.add('v', 2, 0, true)
    await settle()
    expect(a.sent.map((s) => s[1])).toEqual([2, 2])
    expect(c.sent).toEqual([])
  })
  it('waits for bufferedamountlow when every lane is above HIGH_WATER', async () => {
    vi.useFakeTimers()
    const up = uploader()
    const a = lane(HIGH_WATER + 1)
    up.addLane(0, a)
    up.add('v', 1, 0, true)
    await settle()
    expect(a.sent).toEqual([])
    a.bufferedAmount = 0
    a.onbufferedamountlow!(new Event('bufferedamountlow'))
    await settle()
    expect(a.sent).toHaveLength(2)
  })
  it('paces prefetch pieces at the rate; an urgent piece goes at once', async () => {
    vi.useFakeTimers({ now: 0 })
    const up = uploader(SIZE) // one piece per second
    const a = lane()
    up.addLane(0, a)
    up.add('v', 1, 0, false)
    up.add('v', 2, 0, false)
    await settle()
    expect(a.sent.map(([t, n]) => [t, n])).toEqual([[0, 1], [0, 1]])
    await vi.advanceTimersByTimeAsync(500)
    up.add('v', 9, 0, true) // urgent: before the queued prefetch, not paced
    await settle()
    expect(a.sent.slice(2).map(([t, n]) => [t, n])).toEqual([[500, 9], [500, 9]])
    await vi.advanceTimersByTimeAsync(499)
    expect(a.sent).toHaveLength(4)
    await vi.advanceTimersByTimeAsync(1)
    expect(a.sent.slice(4).map(([t, n]) => [t, n])).toEqual([[1000, 2], [1000, 2]])
  })
  it('urgent pieces go in time order (init first), not in arrival order; a one-chunk init passes a head being sent', async () => {
    vi.useFakeTimers()
    // n → [startS, durS, bytes]: 1 and 2 are 3-chunk video pieces at 0 s and 4 s, 7 an audio piece at 0 s, 9 an init
    const sizes: Record<number, [number, number, number]> = { 1: [0, 4, 3 * CHUNK_BYTES], 2: [4, 4, 3 * CHUNK_BYTES], 7: [0, 4, 2 * CHUNK_BYTES], 9: [-1, 0, 900] }
    const metaOf = (_t: string, n: number): CinemaPieceMeta => [...sizes[n]!, '0'.repeat(64)]
    const up = new PeerUploader({ read: async (_t, n) => new ArrayBuffer(sizes[n]![2]), meta: metaOf, refused: vi.fn(), sent: () => undefined })
    const a = lane()
    up.addLane(0, a)
    a.bufferedAmount = HIGH_WATER + 1 // a slow link: nothing leaves until the test lets it
    up.add('v', 2, 0, true)
    up.add('v', 1, 0, true)
    up.add('a0', 7, 0, true)
    const step = async () => {
      a.bufferedAmount = 0
      a.onbufferedamountlow!(new Event('bufferedamountlow'))
      await settle()
    }
    // one chunk leaves per step
    a.send = ((orig) => (d: ArrayBuffer) => { orig(d); a.bufferedAmount = HIGH_WATER + 1 })(a.send.bind(a))
    await step()
    expect(a.sent.map((s) => s[1])).toEqual([1]) // v:1 (0 s) came after v:2 (4 s) but goes first
    up.add('a0', 9, 0, true) // the audio init arrives late: one chunk, it passes the head in progress
    for (let i = 0; i < 8; i++) await step()
    // the init, the rest of the head, then by start time (a tie keeps arrival order)
    expect(a.sent.map((s) => s[1])).toEqual([1, 9, 1, 1, 7, 7, 2, 2, 2])
  })
  it('a removed lane gets nothing more', async () => {
    vi.useFakeTimers()
    const up = uploader()
    const [a, b] = [lane(0), lane(10)]
    up.addLane(0, a)
    up.addLane(1, b)
    up.removeLane(0)
    up.add('v', 1, 0, true)
    await settle()
    expect(a.sent).toEqual([])
    expect(b.sent).toHaveLength(2)
  })
})
