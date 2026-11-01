import { describe, expect, it } from 'vitest'
import { DEFAULT_HANGOVER_MS, PttLatch, VadGate, perceptualLevel, rmsDb } from './vad'
import { SCREEN_PRESETS, availablePresets, contentSettings, defaultPreset, getPreset, pickCodec, recordSustain, simulcastFor } from './presets'
import { PrefsStore } from './prefs'

const run = (g: VadGate, db: number, ms: number) => {
  let open = false
  for (let t = 0; t < ms; t += 10) open = g.process(db, 10)
  return open
}

describe('VadGate', () => {
  it('opens above the manual threshold and holds for the hangover', () => {
    const g = new VadGate({ thresholdDb: -40 })
    expect(run(g, -60, 200)).toBe(false)
    expect(g.process(-30, 10)).toBe(true)
    // word ending: quiet, but still inside the 300 ms hangover
    expect(run(g, -60, DEFAULT_HANGOVER_MS - 20)).toBe(true)
    expect(run(g, -60, 40)).toBe(false)
  })

  it('hysteresis keeps it open while the level hovers just under the open threshold', () => {
    const g = new VadGate({ thresholdDb: -40, hangoverMs: 50 })
    g.process(-35, 10)
    expect(run(g, -42, 500)).toBe(true) // above close threshold (-44)
    expect(run(g, -50, 100)).toBe(false)
  })

  it('auto threshold follows the noise floor, not the speech', () => {
    const g = new VadGate()
    expect(run(g, -55, 3000)).toBe(false) // steady room noise never opens it
    expect(g.thresholdDb).toBeGreaterThan(-55)
    expect(g.process(-20, 10)).toBe(true) // speech does
    expect(run(g, -20, 2000)).toBe(true) // 2 s of continuous speech stays open
    expect(g.thresholdDb).toBeLessThan(-30)
    run(g, -55, 400) // a pause pulls the floor back down
    expect(g.thresholdDb).toBeCloseTo(-55 + 12, 0)
  })

  it('learns a noisier room quickly instead of staying stuck open', () => {
    const g = new VadGate()
    run(g, -70, 1000) // quiet
    expect(run(g, -48, 6000)).toBe(false) // fan turns on: after a few seconds it is noise, not voice
  })

  it('perceptualLevel maps -50..-20 dBFS onto 0..1, clamped', () => {
    expect([perceptualLevel(-120), perceptualLevel(-50), perceptualLevel(-35), perceptualLevel(-20), perceptualLevel(0)]).toEqual([0, 0, 0.5, 1, 1])
  })

  it('rmsDb of a full-scale square wave is 0 dB, silence is -120', () => {
    expect(rmsDb(new Float32Array(480).fill(1))).toBeCloseTo(0)
    expect(rmsDb(new Float32Array(480))).toBe(-120)
  })
})

describe('PttLatch', () => {
  it('keeps the mic open for the release delay after key up', () => {
    const p = new PttLatch(150)
    p.down()
    expect(p.isOpen(0)).toBe(true)
    p.up(1000)
    expect(p.isOpen(1100)).toBe(true)
    expect(p.isOpen(1150)).toBe(false)
  })
  it('pressing again during the release delay cancels the release', () => {
    const p = new PttLatch(150)
    p.down()
    p.up(0)
    p.down()
    expect(p.isOpen(1000)).toBe(true)
  })
})

describe('presets', () => {
  const ids = (l: { id: string }[]) => l.map((p) => p.id)
  it('software encoder: up to 1080p30 only', () => {
    expect(ids(availablePresets({ hardware: false }))).toEqual(['720p30', '1080p30'])
  })
  it('hardware encoder on a 1440p monitor: up to 1440p60, never 4K (upscaling)', () => {
    expect(ids(availablePresets({ hardware: true, sourceWidth: 2560, sourceHeight: 1440 }))).toEqual(['720p30', '1080p30', '1080p60', '1440p60'])
  })
  it('hides a preset that failed to hold its fps more often than not', () => {
    let r = recordSustain({}, '1440p60', 60, 41)
    r = recordSustain(r, '1440p60', 60, 59)
    expect(ids(availablePresets({ hardware: true }, r))).toContain('1440p60') // 1 ok / 1 bad: keep
    r = recordSustain(r, '1440p60', 60, 38)
    expect(ids(availablePresets({ hardware: true }, r))).not.toContain('1440p60')
  })
  it('defaults to 1080p60 when offered', () => {
    expect(defaultPreset(availablePresets({ hardware: true })).id).toBe('1080p60')
    expect(defaultPreset(availablePresets({ hardware: false })).id).toBe('1080p30')
  })
  it('simulcast layers are strictly below the top layer', () => {
    for (const p of SCREEN_PRESETS) for (const l of p.simulcast) expect(l.width * l.height).toBeLessThan(p.width * p.height)
  })
  it('simulcast ladder follows a smaller source: 3 distinct layers at /4 and /2 when the preset ladder does not fit', () => {
    const p = getPreset('1080p60')
    const dims = (l: { width: number; height: number }[]) => l.map((x) => `${x.width}x${x.height}`)
    expect(dims(simulcastFor(p, 1920, 1080))).toEqual(['640x360', '1280x720']) // the preset's own ladder
    expect(dims(simulcastFor(p, 1600, 900))).toEqual(['640x360', '1280x720'])
    expect(dims(simulcastFor(p, 1280, 720))).toEqual(['320x180', '640x360'])
    expect(dims(simulcastFor(p, 1360, 768))).toEqual(['340x192', '680x384'])
    expect(dims(simulcastFor(p, 608, 1080))).toEqual(['152x270', '304x540']) // portrait window (capped to 1080 tall)
    expect(dims(simulcastFor(p, 320, 240))).toEqual(['160x120']) // a quarter would be below 90 px
    expect(dims(simulcastFor(p))).toEqual(['640x360', '1280x720']) // unknown size: the preset's own
    const [low, mid] = simulcastFor(p, 1280, 720)
    expect(low!.maxBitrate).toBeLessThan(400_000)
    expect(mid!.maxBitrate).toBeLessThan(1_700_000)
  })
  it('automatic codec prefers a hardware HEVC encoder, else H.264', () => {
    expect(pickCodec({ h265: true, h264: false })).toBe('h265')
    expect(pickCodec({ h265: false, h264: true })).toBe('h264')
    expect(pickCodec({})).toBe('h264')
  })
  it('content type maps to hint + degradation preference', () => {
    expect(contentSettings('motion')).toEqual({ hint: 'motion', degradation: 'maintain-framerate' })
    expect(contentSettings('detail')).toEqual({ hint: 'detail', degradation: 'maintain-resolution' })
  })
})

describe('PrefsStore volumes', () => {
  const mem = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
  }
  it('persists per-user volume, clamped to 0..200%', () => {
    const storage = mem()
    const a = new PrefsStore(storage)
    expect(a.volumeOf('u1')).toBe(1)
    expect(a.setVolume('u1', 1.5)).toBe(1.5)
    expect(a.setVolume('u2', 9)).toBe(2)
    expect(a.setVolume('u3', -1)).toBe(0)
    const b = new PrefsStore(storage) // reload
    expect([b.volumeOf('u1'), b.volumeOf('u2'), b.volumeOf('u3')]).toEqual([1.5, 2, 0])
  })
  it('100% is not stored; corrupt values are dropped', () => {
    const storage = mem()
    const a = new PrefsStore(storage)
    a.setVolume('u1', 0.5)
    a.setVolume('u1', 1)
    expect(a.get().volumes).toEqual({})
    storage.setItem('alga.media.prefs.v1', JSON.stringify({ volumes: { x: 'loud', y: 0.3 } }))
    expect(new PrefsStore(storage).get().volumes).toEqual({ y: 0.3 })
  })
  it('survives unreadable storage', () => {
    const broken = { getItem: () => '{nope', setItem: () => { throw new Error('quota') } }
    const p = new PrefsStore(broken)
    expect(p.setVolume('u', 0.7)).toBe(0.7)
  })
})
