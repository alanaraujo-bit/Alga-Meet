import type { CinemaPieceMeta, CinemaTrackId } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { LATE_MIN_AGE_S, MAX_PEER_INFLIGHT, hostShouldSend, isLate, nextRequests, type SwarmView } from './scheduler'

const H = 'ab'.repeat(32)
const meta = (startS: number, durS: number): CinemaPieceMeta => [startS, durS, 1000, H]
/** n = 0 init, then media pieces of 10 s at the given start times (n is generation order, not time order). */
const track = (...starts: number[]): CinemaPieceMeta[] => [meta(-1, 0), ...starts.map((s) => meta(s, 10))]

type PeerView = SwarmView['peers'][number]
const peer = (id: string, mbps: number, has: number[], over: Partial<PeerView> = {}): PeerView =>
  ({ id, isHost: false, has: new Map([['v', new Set(has)]]), inflight: 0, mbps, bannedFor: new Set(), ...over })

const view = (over: Partial<SwarmView>): SwarmView => ({
  now: 0, playheadS: 0, tracks: ['v'], index: new Map(), mine: new Map(), peers: [], inflight: new Map(), budgetPieces: 1000, ...over,
})
const asked = (v: SwarmView, maxNew = 100) => nextRequests(v, maxNew).map((r) => `${r.n}@${r.peer}`)
const all = (k: number) => Array.from({ length: k }, (_, i) => i)

describe('nextRequests', () => {
  it('fetches init pieces first, then the critical window in time order from the fastest holder', () => {
    // n order != time order (R4): n1 = 20 s, n2 = 0 s, n3 = 10 s
    const v = view({
      index: new Map([['v', track(20, 0, 10, 100, 60)]]),
      peers: [peer('slow', 5, all(6)), peer('fast', 50, [1, 2])],
    })
    expect(asked(v, 4)).toEqual(['0@slow', '2@fast', '3@slow', '1@fast'])
  })

  it('counts the piece under the playhead as critical and stops the window at playhead + 30 s', () => {
    const v = view({ playheadS: 15, index: new Map([['v', track(0, 10, 20, 30, 40, 50)]]), mine: new Map([['v', new Set([0])]]), peers: [peer('a', 1, all(7)), peer('b', 1, all(7))] })
    // critical: 10–20 (n2), 20–30 (n3), 30–40 (n4), 40–50 (n5 starts at 40 < 45); n1 (0–10) is behind
    expect(nextRequests(v, 4).map((r) => r.n)).toEqual([2, 3, 4, 5])
  })

  it('a wider criticalS (a longer pre-roll) fetches that far ahead as critical: urgent and in time order', () => {
    const v = view({ playheadS: 0, criticalS: 60, index: new Map([['v', track(0, 10, 20, 30, 40, 50, 60)]]), mine: new Map([['v', new Set([0])]]), peers: [peer('a', 1, all(8)), peer('b', 1, all(8)), peer('c', 1, all(8))] })
    const r = nextRequests(v, 7)
    expect(r.map((x) => [x.n, x.urgent])).toEqual([[1, true], [2, true], [3, true], [4, true], [5, true], [6, true], [7, false]])
  })

  it('outside the window takes the rarest piece first, nearest on a tie', () => {
    const v = view({
      index: new Map([['v', track(0, 10, 20, 30, 40, 50, 60)]]),
      mine: new Map([['v', new Set([0, 1, 2, 3])]]),
      peers: [peer('A', 30, all(8)), peer('B', 20, [4, 6]), peer('C', 10, [4])],
    })
    // holders: n4 (30 s) A,B,C · n5 (40 s) A · n6 (50 s) A,B · n7 (60 s) A
    expect(asked(v)).toEqual(['5@A', '7@A', '6@A', '4@B'])
    expect(MAX_PEER_INFLIGHT).toBe(3)
  })

  it('outside the window never asks the host for what a friend holds; inside it, the fastest even if host', () => {
    const v = view({
      index: new Map([['v', track(0, 10, 20, 30, 40, 50, 60)]]),
      mine: new Map([['v', new Set([0, 1])]]),
      peers: [peer('host', 100, all(8), { isHost: true }), peer('p', 1, [2, 3, 4, 5, 6, 7], { inflight: 1 })],
    })
    // critical n2, n3 from the host; n4..n7 belong to p, which has room for 2 more; the rest waits (no host fallback)
    expect(asked(v)).toEqual(['2@host', '3@host', '4@p', '5@p'])
    const lonely = view({ ...v, peers: [v.peers[0]!, peer('p', 1, [])] })
    expect(asked(lonely)).toEqual(['2@host', '3@host', '4@host'])
  })

  it('never asks for pieces held, in flight, without a holder, or from a peer banned for them', () => {
    const v = view({
      index: new Map([['v', track(0, 10, 20, 30, 40)]]),
      mine: new Map([['v', new Set([0, 1])]]),
      inflight: new Map([['v:2', 'z']]),
      peers: [peer('a', 9, [0, 1, 2, 3, 5], { bannedFor: new Set(['v:3']) }), peer('b', 1, [3])],
    })
    // n3 only from b (a banned for it), n4 nobody has, n5 from a
    expect(asked(v)).toEqual(['3@b', '5@a'])
  })

  it('respects the per-peer cap, maxNew and budgetPieces (critical pieces use the budget but are never held back)', () => {
    const idx = new Map<CinemaTrackId, CinemaPieceMeta[]>([['v', track(...all(20).map((i) => i * 10))]])
    const peers = [peer('a', 1, all(21), { inflight: 1 }), peer('b', 1, all(21)), peer('c', 1, all(21)), peer('d', 1, all(21))]
    const mine = new Map<CinemaTrackId, Set<number>>([['v', new Set([0, 1, 2])]])
    expect(nextRequests(view({ index: idx, mine, peers }), 2)).toHaveLength(2)
    expect(nextRequests(view({ index: idx, mine, peers, budgetPieces: 3 }), 100)).toHaveLength(1 + 2) // critical n3 + 2 prefetch
    expect(nextRequests(view({ index: idx, mine: new Map(), peers, budgetPieces: 0 }), 100).map((r) => r.n)).toEqual([0, 1, 2, 3])
    const many = nextRequests(view({ index: idx, mine, peers }), 100)
    expect(many.filter((r) => r.peer === 'a')).toHaveLength(MAX_PEER_INFLIGHT - 1)
    expect(many).toHaveLength(4 * MAX_PEER_INFLIGHT - 1)
  })

  it('only schedules selected tracks and skips holes in the index', () => {
    const v = view({
      tracks: ['a1'],
      index: new Map([['v', track(0)], ['a1', [meta(-1, 0), undefined as unknown as CinemaPieceMeta, meta(10, 10)]]]),
      peers: [peer('a', 1, [], { has: new Map([['v', new Set([0, 1])], ['a1', new Set([0, 1, 2])]]) })],
    })
    expect(nextRequests(v, 10).map((r) => `${r.track}:${r.n}`)).toEqual(['a1:0', 'a1:2'])
  })
})

describe('nextRequests: preemption, urgency and back-off', () => {
  const index = new Map<CinemaTrackId, CinemaPieceMeta[]>([['v', track(...all(20).map((i) => i * 10))]])

  it('marks critical requests urgent and prefetch not', () => {
    const v = view({ index, mine: new Map([['v', new Set([0, 1, 2])]]), peers: [peer('a', 1, all(21))] })
    expect(nextRequests(v, 2).map((r) => [r.n, r.urgent])).toEqual([[3, true], [4, false]])
  })

  it('preempts the farthest prefetch on the fastest holder when every slot is busy, even at maxNew', () => {
    const v = view({
      playheadS: 150, index, mine: new Map([['v', new Set([0])]]),
      inflight: new Map([['v:5', 'fast'], ['v:9', 'fast'], ['v:7', 'fast'], ['v:6', 'slow'], ['v:8', 'slow'], ['v:4', 'slow']]),
      peers: [peer('slow', 1, all(21), { inflight: 3 }), peer('fast', 9, all(21), { inflight: 3 })],
    })
    // critical: n16 (150 s), n17, n18; prefetch to cancel on 'fast' farthest first: n9, n7, n5
    expect(nextRequests(v, 0)).toEqual([
      { peer: 'fast', track: 'v', n: 16, urgent: true, preempt: 'v:9' },
      { peer: 'fast', track: 'v', n: 17, urgent: true, preempt: 'v:7' },
      { peer: 'fast', track: 'v', n: 18, urgent: true, preempt: 'v:5' },
    ])
  })

  it('never preempts critical downloads', () => {
    const v = view({ index, mine: new Map([['v', new Set([0])]]), inflight: new Map([['v:1', 'a'], ['v:2', 'a'], ['v:3', 'a']]), peers: [peer('a', 1, all(21), { inflight: 3 })] })
    expect(nextRequests(v, 10)).toEqual([])
  })

  it('uses a peer in back-off (mbps < 0) only when nobody else holds the piece', () => {
    const v = view({
      index, mine: new Map([['v', new Set([0, 1, 2, 3])]]),
      peers: [peer('host', 0, all(21), { isHost: true }), peer('bad', -1, all(21)), peer('lone', -1, [], { has: new Map([['a1', new Set([0])]]) })],
      tracks: ['v', 'a1'], budgetPieces: 2,
    })
    v.index.set('a1', [meta(-1, 0)])
    expect(asked(v)).toEqual(['0@lone', '4@host', '5@host'])
    const full = view({ ...v, peers: [peer('host', 0, all(21), { isHost: true, inflight: 3 }), peer('bad', -1, all(21))] })
    expect(asked(full)).toEqual([]) // not even as overflow when the host is busy
  })
})

describe('isLate', () => {
  const m: CinemaPieceMeta = [40, 10, 1_000_000, H]
  it('waits LATE_MIN_AGE_S before judging', () => {
    expect(isLate(m, 0, LATE_MIN_AGE_S - 0.1, 40)).toBe(false)
  })
  it('is late with no bytes, or when the projected end passes the time left before the playhead reaches the piece', () => {
    expect(isLate(m, 0, 2, 0)).toBe(true)
    expect(isLate(m, 100_000, 2, 30)).toBe(true) // 900 kB left at 50 kB/s = 18 s > 10 s
    expect(isLate(m, 500_000, 2, 30)).toBe(false) // 2 s < 10 s
    expect(isLate(m, 500_000, 2, 45)).toBe(true) // already playing: deadline 0
  })
})

describe('hostShouldSend (super-seed)', () => {
  const index = new Map<CinemaTrackId, CinemaPieceMeta[]>([['v', track(0, 10, 20, 30, 40, 50)]])
  const hv = (playheadS: number) => view({ playheadS, index, peers: [peer('A', 1, [6]), peer('B', 1, [5, 6])] })

  it('refuses a piece a friend already has when it is outside the requester\'s critical window', () => {
    expect(hostShouldSend(hv(0), 'A', 'v', 6)).toBe(false)
  })
  it('sends it inside the critical window', () => {
    expect(hostShouldSend(hv(30), 'A', 'v', 6)).toBe(true)
  })
  it('sends a piece no other friend has (the requester holding it does not count)', () => {
    expect(hostShouldSend(hv(0), 'A', 'v', 4)).toBe(true)
    expect(hostShouldSend(hv(0), 'B', 'v', 5)).toBe(true)
  })
  it('always sends init pieces; never an unknown piece', () => {
    expect(hostShouldSend(view({ index, peers: [peer('A', 1, [0]), peer('B', 1, [0])] }), 'A', 'v', 0)).toBe(true)
    expect(hostShouldSend(hv(0), 'A', 'v', 99)).toBe(false)
  })
})
