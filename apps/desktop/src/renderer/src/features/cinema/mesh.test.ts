import type { CinemaClientFrame, CinemaSeat } from '@alga/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CandidateBatcher, GATHER_WAIT_MS, LANE_STAGGER_MS, Mesh, SignalBuffer, fingerprintOf, isOfferer, tagInput } from './mesh'

const SDP = ['v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
  'a=group:BUNDLE 0', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:abcd', 'a=fingerprint:sha-256 AB:CD:EF:01:23', 'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000', ''].join('\r\n')

describe('isOfferer', () => {
  it('the smaller id offers', () => {
    expect(isOfferer('a', 'b')).toBe(true)
    expect(isOfferer('b', 'a')).toBe(false)
  })
})

describe('CandidateBatcher', () => {
  afterEach(() => vi.useRealTimers())
  it('30 candidates in 50 ms flush as 20 + 10', () => {
    vi.useFakeTimers()
    const out: string[][] = []
    const b = new CandidateBatcher((c) => out.push(c))
    for (let i = 0; i < 30; i++) { b.add(String(i)); vi.advanceTimersByTime(1) }
    expect(out.map((c) => c.length)).toEqual([20])
    vi.advanceTimersByTime(200)
    expect(out.map((c) => c.length)).toEqual([20, 10])
  })
  it('one candidate flushes after 200 ms', () => {
    vi.useFakeTimers()
    const out: string[][] = []
    new CandidateBatcher((c) => out.push(c)).add('x')
    vi.advanceTimersByTime(199)
    expect(out).toEqual([])
    vi.advanceTimersByTime(1)
    expect(out).toEqual([['x']])
  })
  it('close drops pending', () => {
    vi.useFakeTimers()
    const out: string[][] = []
    const b = new CandidateBatcher((c) => out.push(c))
    b.add('x')
    b.close()
    vi.advanceTimersByTime(1000)
    b.add('y')
    vi.advanceTimersByTime(1000)
    expect(out).toEqual([])
  })
})

describe('fingerprintOf', () => {
  it('extracts the sha-256 fingerprint', () => expect(fingerprintOf(SDP)).toBe('sha-256 AB:CD:EF:01:23'))
  it('null without one', () => expect(fingerprintOf('v=0\r\ns=-\r\n')).toBeNull())
  it('session + media line with the same value is fine (normalized)', () => {
    const sdp = 'v=0\r\na=fingerprint:SHA-256 ab:cd\r\nm=application 9 x\r\na=fingerprint:sha-256 AB:CD\r\n'
    expect(fingerprintOf(sdp)).toBe('sha-256 AB:CD')
  })
  it('two different fingerprints (RFC 8122 override trick) -> null', () => {
    expect(fingerprintOf('v=0\r\na=fingerprint:sha-256 AA:BB\r\nm=application 9 x\r\na=fingerprint:sha-256 CC:DD\r\n')).toBeNull()
  })
  it('malformed -> null', () => {
    expect(fingerprintOf('a=fingerprint:sha-256 ZZ:YY\r\n')).toBeNull()
    expect(fingerprintOf('a=fingerprint:sha-256\r\n')).toBeNull()
  })
})

describe('tagInput', () => {
  it('joins in order', () => {
    expect(tagInput('s', 'a', 'b', 'AB:CD')).toBe('s|a|b|AB:CD')
    expect(tagInput('s', 'b', 'a', 'AB:CD')).not.toBe(tagInput('s', 'a', 'b', 'AB:CD'))
  })
  it('binds lanes > 0 (lane 0 keeps the original input)', () => {
    expect(tagInput('s', 'a', 'b', 'AB:CD', 0)).toBe('s|a|b|AB:CD')
    expect(tagInput('s', 'a', 'b', 'AB:CD', 2)).toBe('s|a|b|AB:CD|2')
  })
})

describe('SignalBuffer', () => {
  const ice = { kind: 'ice' as const, candidates: ['c'] }
  it('replays in order, then empties', () => {
    const b = new SignalBuffer()
    b.add('p', ice, 0)
    b.add('p', { kind: 'offer', sdp: 'x' }, 1)
    expect(b.take('p', 2).map((s) => s.kind)).toEqual(['ice', 'offer'])
    expect(b.take('p', 2)).toEqual([])
  })
  it('expires after 10 s', () => {
    const b = new SignalBuffer()
    b.add('p', ice, 0)
    expect(b.take('p', 10_000)).toEqual([])
  })
  it('bounds entries per peer (50) and peers (8)', () => {
    const b = new SignalBuffer()
    for (let i = 0; i < 80; i++) b.add('p', ice, 0)
    expect(b.take('p', 1)).toHaveLength(50)
    for (let i = 0; i < 12; i++) b.add('q' + i, ice, 0)
    expect(b.take('q11', 1)).toEqual([])
    expect(b.take('q0', 1)).toHaveLength(1)
  })
})

// Minimal RTCPeerConnection stand-in: enough to drive the Mesh signalling and timers.
const SDPFP = 'v=0\r\nm=application 9 x\r\na=fingerprint:sha-256 AB:CD\r\n'
type FakeCh = { label: string; ordered: boolean; readyState: string; close(): void; onopen: (() => void) | null; onclose: (() => void) | null; binaryType: string }
const fakeCh = (label: string, ordered = true): FakeCh => ({ label, ordered, readyState: 'connecting', close() {}, onopen: null, onclose: null, binaryType: '' })
class FakePC {
  static all: FakePC[] = []
  localDescription: { sdp: string } | null = null
  remoteDescription: { sdp: string } | null = null
  signalingState = 'stable'
  connectionState = 'new'
  iceGatheringState = 'complete'
  restarts = 0
  closed = false
  log: string[] = []
  onnegotiationneeded: (() => void) | null = null
  onicecandidate: ((e: { candidate: { candidate: string } | null }) => void) | null = null
  ondatachannel: ((e: { channel: FakeCh }) => void) | null = null
  constructor() { FakePC.all.push(this) }
  chs = new Map<string, FakeCh>()
  onconnectionstatechange: (() => void) | null = null
  createDataChannel(label: string, o: { ordered?: boolean } = {}) {
    const ch = fakeCh(label, o.ordered !== false)
    this.chs.set(label, ch)
    return ch
  }
  /** Both channels open (offerer side), as the browser fires it. */
  openAll() {
    for (const ch of this.chs.values()) { ch.readyState = 'open'; ch.onopen?.() }
  }
  async setLocalDescription() { this.localDescription = { sdp: SDPFP }; this.signalingState = 'have-local-offer' }
  async setRemoteDescription(d: { sdp: string }) { await Promise.resolve(); this.remoteDescription = d; this.signalingState = 'stable'; this.log.push('remote') }
  async addIceCandidate(c: { candidate: string }) { this.log.push('ice:' + c.candidate) }
  restartIce() { this.restarts++ }
  close() { this.closed = true }
}
const seat = (userId: string): CinemaSeat => ({ userId, status: 'ready', aheadS: 0, direct: true }) as unknown as CinemaSeat
const flush = () => new Promise((r) => setTimeout(r, 0))
const sig = (f: CinemaClientFrame) => (f as Extract<CinemaClientFrame, { op: 'cinema_signal' }>).signal

describe('Mesh', () => {
  afterEach(() => { vi.useRealTimers(); FakePC.all = [] })
  const mk = (over: Partial<ConstructorParameters<typeof Mesh>[0]> = {}) => {
    ;(globalThis as any).RTCPeerConnection = FakePC
    const sent: CinemaClientFrame[] = []
    const mesh = new Mesh({ sessionId: 's', channelId: 'ch', selfId: 'a', iceServers: [], e2ee: null, send: (f) => (sent.push(f), true), ...over })
    return { mesh, sent }
  }

  it('tags the offer with the epoch current at send time', async () => {
    let epoch = 1
    const calls: [number, string][] = []
    const { mesh, sent } = mk({ e2ee: { epoch: () => epoch }, cinemaTag: async (_c, e, m) => (calls.push([e, m]), 'T') })
    mesh.sync([seat('b')])
    epoch = 7
    FakePC.all[0]!.onnegotiationneeded!()
    await flush()
    expect(calls).toEqual([[7, 's|a|b|sha-256 AB:CD']])
    expect(sig(sent[0]!)).toMatchObject({ kind: 'offer', tag: 'T', epoch: 7 })
  })
  it('receiver verifies with the sender epoch; null tag drops the pair', async () => {
    const seen: number[] = []
    const gone: string[] = []
    let result: string | null = 'OK'
    const { mesh, sent } = mk({ selfId: 'b', e2ee: { epoch: () => 99 }, cinemaTag: async (_c, e) => (seen.push(e), result) })
    mesh.onPeerGone((id) => gone.push(id))
    mesh.sync([seat('a')])
    await mesh.onSignal('a', { kind: 'offer', sdp: SDPFP, tag: 'OK', epoch: 3 })
    expect(seen[0]).toBe(3)
    expect(sig(sent[0]!)).toMatchObject({ kind: 'answer', epoch: 99 })
    expect(gone).toEqual([])
    result = null
    await mesh.onSignal('a', { kind: 'offer', sdp: SDPFP, tag: 'OK', epoch: 3 })
    expect(gone).toEqual(['a'])
  })
  it('missing tag in an E2EE call is rejected', async () => {
    const gone: string[] = []
    const { mesh } = mk({ selfId: 'b', e2ee: { epoch: () => 1 }, cinemaTag: async () => 'OK' })
    mesh.onPeerGone((id) => gone.push(id))
    mesh.sync([seat('a')])
    await mesh.onSignal('a', { kind: 'offer', sdp: SDPFP })
    expect(gone).toEqual(['a'])
  })
  it('replays signals that arrived before sync()', async () => {
    const { mesh, sent } = mk({ selfId: 'b' })
    void mesh.onSignal('a', { kind: 'offer', sdp: SDPFP })
    void mesh.onSignal('a', { kind: 'ice', candidates: ['c1'] })
    mesh.sync([seat('a')])
    await flush()
    await flush()
    expect(sent.some((f) => sig(f).kind === 'answer')).toBe(true)
    expect(FakePC.all[0]!.log).toEqual(['remote', 'ice:c1'])
  })
  it('handles one peer signals in order (ICE waits for the description)', async () => {
    const { mesh } = mk({ selfId: 'b' })
    mesh.sync([seat('a')])
    void mesh.onSignal('a', { kind: 'offer', sdp: SDPFP })
    await mesh.onSignal('a', { kind: 'ice', candidates: ['c1'] })
    expect(FakePC.all[0]!.log).toEqual(['remote', 'ice:c1'])
  })
  it('connect timeout: offerer restarts ICE twice, then the pair is gone', () => {
    vi.useFakeTimers()
    const gone: string[] = []
    const { mesh } = mk()
    mesh.onPeerGone((id) => gone.push(id))
    mesh.sync([seat('b')])
    vi.advanceTimersByTime(20_000)
    vi.advanceTimersByTime(20_000)
    expect(FakePC.all[0]!.restarts).toBe(2)
    expect(gone).toEqual([])
    vi.advanceTimersByTime(20_000)
    expect(gone).toEqual(['b'])
    expect(FakePC.all[0]!.closed).toBe(true)
  })
  it('never re-opens a dropped link from a stray signal; close() does not notify', async () => {
    const gone: string[] = []
    const { mesh } = mk({ selfId: 'b' })
    mesh.onPeerGone((id) => gone.push(id))
    mesh.sync([seat('a')])
    const made = FakePC.all.length
    mesh.sync([])
    expect(gone).toEqual(['a'])
    await mesh.onSignal('a', { kind: 'offer', sdp: SDPFP })
    await mesh.onSignal('a', { kind: 'offer', sdp: SDPFP, lane: 2 })
    expect(FakePC.all).toHaveLength(made)
    expect(FakePC.all.every((pc) => pc.closed && !pc.remoteDescription)).toBe(true)
    mesh.sync([seat('a')])
    mesh.close()
    expect(gone).toEqual(['a'])
  })
  it('a recovered link is not hit by the re-armed connect timer', () => {
    vi.useFakeTimers()
    const gone: string[] = []
    const { mesh } = mk()
    mesh.onPeerGone((id) => gone.push(id))
    mesh.sync([seat('b')])
    const pc = FakePC.all[0]!
    pc.openAll()
    pc.connectionState = 'failed'
    pc.onconnectionstatechange!()
    expect(pc.restarts).toBe(1)
    pc.connectionState = 'connected'
    pc.onconnectionstatechange!()
    vi.advanceTimersByTime(70_000)
    expect(pc.restarts).toBe(1)
    expect(gone).toEqual([])
    expect(pc.closed).toBe(false)
  })
  it('lane 0: an ordered control channel and an unordered (reliable) bulk channel', () => {
    const { mesh } = mk()
    mesh.sync([seat('b')])
    expect([...FakePC.all[0]!.chs.values()].map((c) => [c.label, c.ordered])).toEqual([['cinema-ctl', true], ['cinema', false]])
  })
  it('offerer: lanes 1 and 2 open LANE_STAGGER_MS apart once lane 0 is up; each lane is announced with its channels', () => {
    vi.useFakeTimers()
    const lanes: [string, number, string, string][] = []
    const { mesh } = mk()
    mesh.onLane((id, k, ctl, bulk) => lanes.push([id, k, ctl.label, bulk.label]))
    mesh.sync([seat('b')])
    vi.advanceTimersByTime(10_000)
    expect(FakePC.all).toHaveLength(1) // nothing before lane 0 is up
    FakePC.all[0]!.openAll()
    expect(lanes).toEqual([['b', 0, 'cinema-ctl', 'cinema']])
    vi.advanceTimersByTime(LANE_STAGGER_MS - 1)
    expect(FakePC.all).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakePC.all).toHaveLength(2)
    vi.advanceTimersByTime(LANE_STAGGER_MS)
    expect(FakePC.all).toHaveLength(3)
    FakePC.all[2]!.openAll()
    expect(lanes.map((l) => l[1])).toEqual([0, 2])
    const late: number[] = []
    mesh.onLane((_id, k) => late.push(k)) // replays the open lanes
    expect(late).toEqual([0, 2])
  })
  it('lanes > 0 carry their lane, wait for ICE gathering and send the early candidates inside the description', async () => {
    vi.useFakeTimers()
    const { mesh, sent } = mk()
    mesh.sync([seat('b')])
    FakePC.all[0]!.openAll()
    vi.advanceTimersByTime(LANE_STAGGER_MS)
    const pc = FakePC.all[1]!
    pc.iceGatheringState = 'gathering'
    pc.onnegotiationneeded!()
    await vi.advanceTimersByTimeAsync(0)
    pc.onicecandidate!({ candidate: { candidate: 'c1' } }) // goes in the description, not trickled
    await vi.advanceTimersByTimeAsync(GATHER_WAIT_MS - 1)
    expect(sent).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(sent.map(sig)).toEqual([expect.objectContaining({ kind: 'offer', lane: 1 })])
    pc.onicecandidate!({ candidate: { candidate: 'c2' } }) // after it: trickled, with the lane
    await vi.advanceTimersByTimeAsync(200)
    expect(sent.map(sig).slice(1)).toEqual([{ kind: 'ice', candidates: ['c2'], lane: 1 }])
  })
  it('E2EE: every lane is tagged over its own fingerprint and lane; a tag made for another lane drops the pair', async () => {
    const gone: string[] = []
    const { mesh, sent } = mk({ selfId: 'b', e2ee: { epoch: () => 4 }, cinemaTag: async (_c, _e, m) => `T(${m})` })
    mesh.onPeerGone((id) => gone.push(id))
    mesh.sync([seat('a')])
    const tag = (lane: number) => `T(${tagInput('s', 'a', 'b', 'sha-256 AB:CD', lane)})`
    await mesh.onSignal('a', { kind: 'offer', sdp: SDPFP, tag: tag(1), epoch: 4, lane: 1 })
    expect(sig(sent[0]!)).toMatchObject({ kind: 'answer', lane: 1, epoch: 4, tag: `T(${tagInput('s', 'b', 'a', 'sha-256 AB:CD', 1)})` })
    expect(gone).toEqual([])
    await mesh.onSignal('a', { kind: 'offer', sdp: SDPFP, tag: tag(1), epoch: 4, lane: 2 }) // lane 1's tag replayed on lane 2
    expect(gone).toEqual(['a'])
    expect(FakePC.all.every((pc) => pc.closed)).toBe(true)
  })
  it('a failed lane goes alone (onLaneGone); the peer goes with its last open lane', () => {
    vi.useFakeTimers()
    const laneGone: number[] = []
    const gone: string[] = []
    const { mesh } = mk()
    mesh.onLaneGone((_id, k) => laneGone.push(k))
    mesh.onPeerGone((id) => gone.push(id))
    mesh.sync([seat('b')])
    FakePC.all[0]!.openAll()
    vi.advanceTimersByTime(2 * LANE_STAGGER_MS)
    FakePC.all[1]!.openAll()
    FakePC.all[2]!.openAll()
    FakePC.all[0]!.chs.get('cinema')!.onclose!() // lane 0's bulk channel closed
    expect(laneGone).toEqual([0])
    expect(FakePC.all[0]!.closed).toBe(true)
    const pc2 = FakePC.all[2]!
    pc2.connectionState = 'failed'
    pc2.onconnectionstatechange!() // then two ICE restarts time out
    vi.advanceTimersByTime(40_000)
    expect(laneGone).toEqual([0, 2])
    expect(gone).toEqual([])
    FakePC.all[1]!.connectionState = 'closed'
    FakePC.all[1]!.onconnectionstatechange!()
    expect(gone).toEqual(['b'])
    expect(laneGone).toEqual([0, 2])
  })
  it('answerer: idle lanes (no offer yet) do not keep a peer whose lane 0 failed', () => {
    vi.useFakeTimers()
    const gone: string[] = []
    const { mesh } = mk({ selfId: 'b' })
    mesh.onPeerGone((id) => gone.push(id))
    mesh.sync([seat('a')])
    expect(FakePC.all).toHaveLength(3)
    vi.advanceTimersByTime(60_000)
    expect(gone).toEqual(['a'])
    expect(FakePC.all.every((pc) => pc.closed)).toBe(true)
  })
})

/**
 * Signalling load at 8 seats (gateway quota: CINEMA_FRAME_LIMIT = 300 cinema_* frames per 60 s per socket; target < 200).
 * Eight real Mesh instances over a simulated relay; every RTCPeerConnection gathers 4 candidates 120 ms apart (two ICE
 * frames on lane 0) and connects 50 ms after the answer.
 */
describe('Mesh signalling at 8 seats', () => {
  afterEach(() => vi.useRealTimers())
  class SimPC {
    static all: SimPC[] = []
    static seq = 0
    id = ++SimPC.seq
    peer: SimPC | null = null
    localDescription: { type: string; sdp: string } | null = null
    remoteDescription: { type: string; sdp: string } | null = null
    signalingState = 'stable'
    connectionState = 'new'
    iceGatheringState = 'new'
    chs: FakeCh[] = []
    onnegotiationneeded: (() => void) | null = null
    onicecandidate: ((e: { candidate: { candidate: string } | null }) => void) | null = null
    onicegatheringstatechange: (() => void) | null = null
    onconnectionstatechange: (() => void) | null = null
    ondatachannel: ((e: { channel: FakeCh }) => void) | null = null
    constructor() { SimPC.all.push(this) }
    createDataChannel(label: string, o: { ordered?: boolean } = {}) {
      if (!this.chs.length) setTimeout(() => this.onnegotiationneeded?.(), 0)
      const ch = fakeCh(label, o.ordered !== false)
      this.chs.push(ch)
      return ch
    }
    async setLocalDescription() {
      const type = this.remoteDescription ? 'answer' : 'offer'
      this.localDescription = { type, sdp: `${SDPFP}a=x-pc:${this.id}\r\n` }
      this.signalingState = type === 'offer' ? 'have-local-offer' : 'stable'
      this.iceGatheringState = 'gathering'
      for (let i = 1; i <= 4; i++) {
        setTimeout(() => {
          this.localDescription!.sdp += `a=candidate:${i}\r\n`
          this.onicecandidate?.({ candidate: { candidate: `c${i}` } })
          if (i < 4) return
          this.iceGatheringState = 'complete'
          this.onicegatheringstatechange?.()
        }, 120 * i)
      }
    }
    async setRemoteDescription(d: { type: string; sdp: string }) {
      this.remoteDescription = d
      this.peer = SimPC.all.find((p) => p.id === Number(/a=x-pc:(\d+)/.exec(d.sdp)![1]))!
      if (d.type !== 'answer') return
      this.signalingState = 'stable'
      setTimeout(() => { this.up(); this.peer!.up() }, 50)
    }
    up() {
      if (this.connectionState === 'connected') return
      this.connectionState = 'connected'
      this.onconnectionstatechange?.()
      if (this.chs.length) for (const ch of this.chs) { ch.readyState = 'open'; ch.onopen?.() }
      else for (const ch of this.peer!.chs) this.ondatachannel?.({ channel: { ...fakeCh(ch.label, ch.ordered), readyState: 'open' } })
    }
    async addIceCandidate() {}
    async getStats() { return new Map() }
    restartIce() {}
    close() { this.connectionState = 'closed' }
  }

  it('every pair gets its 3 lanes; each client sends < 50 mesh frames in any 60 s (< 200 with status, clock and index)', async () => {
    vi.useFakeTimers()
    ;(globalThis as any).RTCPeerConnection = SimPC
    const ids = Array.from({ length: 8 }, (_, i) => `u${i}`)
    const meshes = new Map<string, Mesh>()
    const frames = new Map<string, number[]>(ids.map((id) => [id, []]))
    const lanes = new Map<string, number>(ids.map((id) => [id, 0]))
    for (const id of ids) {
      const mesh = new Mesh({
        sessionId: 's', channelId: 'ch', selfId: id, iceServers: [], e2ee: null,
        send: (f) => {
          frames.get(id)!.push(Date.now())
          const { to, signal } = f as Extract<CinemaClientFrame, { op: 'cinema_signal' }>
          setTimeout(() => void meshes.get(to)!.onSignal(id, signal), 20) // the server's relay
          return true
        },
      })
      mesh.onLane(() => lanes.set(id, lanes.get(id)! + 1))
      meshes.set(id, mesh)
    }
    for (const m of meshes.values()) m.sync(ids.map(seat))
    for (let t = 0; t < 120_000; t += 100) await vi.advanceTimersByTimeAsync(100)
    for (const id of ids) expect(lanes.get(id), id).toBe(7 * 3)
    const worst60 = (ts: number[]) => Math.max(...ts.map((t) => ts.filter((x) => x >= t && x < t + 60_000).length))
    const mesh60 = Math.max(...ids.map((id) => worst60(frames.get(id)!)))
    // per 60 s besides the mesh: a status every CINEMA_STATUS_INTERVAL_MS (30), clock pings (≤ 8 + 4) and, for the host,
    // the index at INDEX_FRAMES_PER_FLUSH per 2 s (90; viewers send none)
    const others = 30 + 12 + 90
    console.info(`[signalling] 8 seats × 3 lanes: worst client ${mesh60} mesh frames in 60 s, ${mesh60 + others} with the rest`)
    expect(mesh60).toBeLessThan(50)
    expect(mesh60 + others).toBeLessThan(200)
    for (const m of meshes.values()) m.close()
  })
})
