import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sent: Record<string, unknown>[] = []
vi.mock('./store', () => ({
  send: (f: Record<string, unknown>) => (sent.push(f), true),
  useCinema: { getState: () => ({ session: { sessionId: 's1', film: { durationS: 600 }, playback: { seq: 1 } }, audio: null }) },
  callChannel: () => null, chooseAudio: () => undefined, chooseSubtitle: () => undefined, hostBegin: () => undefined,
  hostEnd: () => undefined, ipNoticeOnce: () => undefined, setPrefs: () => undefined,
}))
const { control, SEEK_MIN_GAP_MS } = await import('./actions')
const seeks = () => sent.filter((f) => f.action === 'seek').map((f) => f.position)

let clock = Date.now()
// each test starts well after the previous one's last seek (the throttle keeps module state)
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime((clock += 3_600_000)); sent.length = 0 })
afterEach(() => vi.useRealTimers())

describe('control seek throttle', () => {
  it('at most 4 seeks per second, the last target always goes out', () => {
        for (let i = 1; i <= 30; i++) { control('seek', i * 10); vi.advanceTimersByTime(33) } // ~1 s of key auto-repeat
    vi.advanceTimersByTime(SEEK_MIN_GAP_MS)
    expect(seeks().length).toBeLessThanOrEqual(5)
    expect(seeks().length).toBeGreaterThanOrEqual(3)
    expect(seeks().at(-1)).toBe(300)
  })

  it('play/pause are never delayed and cancel a pending seek', () => {
        control('seek', 10); control('seek', 20)
    control('pause')
    vi.advanceTimersByTime(1000)
    expect(sent.map((f) => f.action)).toEqual(['seek', 'pause'])
  })
})
