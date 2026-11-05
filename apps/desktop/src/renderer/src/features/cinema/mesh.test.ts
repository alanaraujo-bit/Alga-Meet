import type { CinemaClientFrame, CinemaSeat } from '@alga/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CandidateBatcher, Mesh, SignalBuffer, fingerprintOf, isOfferer, tagInput } from './mesh'

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
class FakePC {
  static all: FakePC[] = []
  localDescription: { sdp: string } | null = null
  remoteDescription: { sdp: string } | null = null
  signalingState = 'stable'
  connectionState = 'new'
  restarts = 0
  closed = false
  log: string[] = []
  onnegotiationneeded: (() => void) | null = null
  constructor() { FakePC.all.push(this) }
  ch = { readyState: 'connecting', close() {}, onopen: null, onclose: null, binaryType: '' }
  onconnectionstatechange: (() => void) | null = null
  createDataChannel() { return this.ch }
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
    mesh.sync([])
    expect(gone).toEqual(['a'])
    await mesh.onSignal('a', { kind: 'offer', sdp: SDPFP })
    expect(FakePC.all).toHaveLength(1)
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
    pc.ch.readyState = 'open'
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
})
