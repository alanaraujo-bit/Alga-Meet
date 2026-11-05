import { describe, expect, it } from 'vitest'
import { CallQualityReport } from '@alga/shared'
import { initialState, type MediaState } from './store'
import { CallSession, gpuVendorOf, type Environment } from './telemetry'

const env: Environment = { os: 'windows', osVersion: '15.0.0', appVersion: '0.1.0', cpuVendor: 'unknown', gpuVendor: 'nvidia' }
type Patch = { connection?: Partial<MediaState['connection']>; screen?: Partial<MediaState['screen']> } & Partial<Pick<MediaState, 'local' | 'participants'>>
const audio = (jitterMs: number, packetLossPct: number, concealedPct: number) => ({ bitrateKbps: 40, jitterMs, packetLossPct, audioLevel: 0, concealedPct, jitterBufferMs: 60, codec: 'audio/opus', fmtp: null })
const person = (id: string, a: ReturnType<typeof audio>) => ({ identity: id, name: id, speaking: false, level: 0, micMuted: false, volume: 1, locallyMuted: false, streaming: false, streamHasAudio: false, quality: 'good' as const, audio: a })
const local = (rttMs: number) => ({ bitrateKbps: 70, packetsPerSec: 50, rttMs, codec: 'audio/red', fmtp: null })

/** Drive a session through a list of patches, one second apart; returns the report when it ends. */
function run(patches: Patch[]) {
  const session = new CallSession()
  let prev = initialState()
  let t = 0
  for (const p of patches) {
    const s: MediaState = { ...prev, ...p, connection: { ...prev.connection, ...p.connection }, screen: { ...prev.screen, ...p.screen } }
    t += 1000
    if (session.update(s, prev, t)) return session.report(env, t, s.connection)
    prev = s
  }
  return null
}

describe('call-quality telemetry', () => {
  it('aggregates one session from connect to leave, schema-valid, nothing identifying', () => {
    const r = run([
      { connection: { state: 'connecting' } },
      { connection: { state: 'connected', joinMs: 180, reconnects: 2, channelId: 'secret-channel', room: 'secret-room', channelName: 'Sala secreta' } },
      { local: local(40), participants: { u1: person('u1', audio(10, 0, 0)), u2: person('u2', audio(20, 2, 1)) } },
      { local: local(60), participants: { u1: person('u1', audio(10, 0, 0)) } },
      { local: local(200) },
      { connection: { state: 'idle' } },
    ])!
    expect(CallQualityReport.parse(r)).toEqual(r)
    expect(r).toMatchObject({ sessionDurationS: 4, joinMs: 180, reconnects: 0, reconnectFailed: false, rttAvgMs: 100, rttP95Ms: 200, audioCodec: 'red', videoCodec: null, encoderHardware: null, stream: null })
    expect(r.jitterMs).toBe(11.7) // per-second means: (10+20)/2, 10, 10
    expect(r.packetLossPct).toBe(0.3)
    expect(JSON.stringify(r)).not.toMatch(/secret|Sala|u1|u2/)
  })

  it('counts LiveKit reconnects and automatic rejoins in one session; a give-up is a failed reconnection', () => {
    const r = run([
      { connection: { state: 'connected', joinMs: 150, reconnects: 5 } },
      { connection: { state: 'reconnecting', willRetry: true } },
      { connection: { state: 'connected', reconnects: 6, willRetry: false } },
      { connection: { state: 'disconnected', willRetry: true } },
      { connection: { state: 'connecting', willRetry: true } },
      { connection: { state: 'connected', willRetry: false } },
      { connection: { state: 'disconnected', willRetry: true } },
      { connection: { state: 'disconnected', willRetry: false } },
    ])!
    expect(r.reconnects).toBe(2)
    expect(r.reconnectFailed).toBe(true)
    expect(r.sessionDurationS).toBe(3)
  })

  it('a terminal disconnect without retries is not a failed reconnection', () => {
    const r = run([{ connection: { state: 'connected' } }, { connection: { state: 'disconnected', willRetry: false } }])!
    expect(r.reconnectFailed).toBe(false)
  })

  it('buckets the most used screen-share fps/resolution and keeps the HW flag', () => {
    const layer = (width: number, height: number, fps: number) => ({ rid: 'f', width, height, fps, bitrateKbps: 5000, encoderImplementation: 'x', powerEfficientEncoder: true, qualityLimitationReason: 'none', scalabilityMode: null })
    const share = (w: number, h: number, fps: number): Patch => ({ local: local(30), screen: { active: true, codec: 'h265', stats: { codec: 'video/H265', bitrateKbps: 5000, rttMs: 30, sourceFps: null, layers: [layer(w, h, fps), layer(640, 360, 15)] } } })
    const r = run([{ connection: { state: 'connected' } }, share(1920, 1080, 52), share(1920, 1080, 50), share(1280, 720, 29), { connection: { state: 'idle' } }])!
    expect(r.stream).toEqual({ fps: '30-59', resolution: '1080p' })
    expect(r.videoCodec).toBe('h265')
    expect(r.encoderHardware).toBe(true)
  })

  it('never reports a session that did not connect', () => {
    expect(run([{ connection: { state: 'connecting' } }, { connection: { state: 'disconnected', willRetry: false } }])).toBeNull()
  })

  it('GPU vendor from the WebGL renderer string', () => {
    expect(gpuVendorOf('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002484) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('nvidia')
    expect(gpuVendorOf('ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11)')).toBe('amd')
    expect(gpuVendorOf('ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11)')).toBe('intel')
    expect(gpuVendorOf(null)).toBe('unknown')
  })
})
