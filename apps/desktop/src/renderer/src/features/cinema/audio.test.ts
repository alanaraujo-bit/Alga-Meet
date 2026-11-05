import { describe, expect, it, vi } from 'vitest'
import { DUCK_DB, duckGain, echoRisk } from './audio'

function run(speaking: boolean, from: number, ms: number): number {
  let g = from
  for (let t = 0; t < ms; t += 50) g = duckGain(speaking, g, 50)
  return g
}

describe('duckGain', () => {
  it('attacks to -10 dB in ~150 ms', () => {
    expect(run(true, 0, 150)).toBeCloseTo(DUCK_DB, 5)
    const half = run(true, 0, 75)
    expect(half).toBeLessThan(-3)
    expect(half).toBeGreaterThan(-7)
  })
  it('releases to 0 dB in ~700 ms (within 10%)', () => {
    expect(run(false, DUCK_DB, 700)).toBeCloseTo(0, 5)
    expect(run(false, DUCK_DB, 600)).toBeLessThan(-1) // not early
  })
  it('never overshoots', () => {
    expect(duckGain(true, DUCK_DB, 1000)).toBe(DUCK_DB)
    expect(duckGain(false, 0, 1000)).toBe(0)
  })
})

describe('echoRisk', () => {
  it('is false for headphones-like labels, any case or language', () => {
    for (const l of ['Headphones (Realtek)', 'Headset Earphone (Logitech)', 'Fone de ouvido (USB)', 'AirPods Pro', 'Galaxy EARBUDS'])
      expect(echoRisk(l)).toBe(false)
  })
  it('is true for speakers or unknown labels', () => {
    for (const l of ['Speakers (Realtek)', 'Alto-falantes', 'Monitor LG', '', null]) expect(echoRisk(l)).toBe(true)
  })
})

describe('FilmAudio per element', () => {
  /** Just enough of AudioContext: a second source on one element throws, like Chromium. */
  class FakeCtx {
    static used = new WeakSet<object>()
    static last: FakeCtx | null = null
    state = 'suspended'
    resumes = 0
    closed = false
    currentTime = 0
    baseLatency = 0
    outputLatency = 0
    destination = {}
    constructor() {
      FakeCtx.last = this
    }
    createMediaElementSource(el: object) {
      if (FakeCtx.used.has(el)) throw new DOMException('already connected', 'InvalidStateError')
      FakeCtx.used.add(el)
      return { connect: (n: unknown) => n, disconnect: () => undefined }
    }
    createGain() {
      return { gain: { value: 1, setTargetAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect: (n: unknown) => n }
    }
    async resume() {
      this.resumes++
      this.state = 'running'
    }
    async close() {
      this.closed = true
    }
  }

  it('reuses one FilmAudio per <video>, survives a StrictMode remount, refuses a reused dead element', async () => {
    vi.stubGlobal('AudioContext', FakeCtx)
    try {
      const { FilmAudio } = await import('./audio')
      const video = new EventTarget() as HTMLVideoElement
      const a = FilmAudio.for(video)
      expect(FilmAudio.for(video)).toBe(a)
      a.release() // unmount…
      expect(FilmAudio.for(video)).toBe(a) // …and the remount takes it back before the tick
      await new Promise((r) => setTimeout(r, 5))
      expect(FakeCtx.last!.closed).toBe(false)
      a.release()
      await new Promise((r) => setTimeout(r, 5))
      expect(FakeCtx.last!.closed).toBe(true)
      expect(() => FilmAudio.for(video)).toThrow(/fresh element/)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('resumes a suspended context when the video starts playing', async () => {
    vi.stubGlobal('AudioContext', FakeCtx)
    try {
      const { FilmAudio } = await import('./audio')
      const video = new EventTarget() as HTMLVideoElement
      const a = FilmAudio.for(video)
      const ctx = FakeCtx.last!
      await Promise.resolve()
      ctx.state = 'suspended' // e.g. created before any user gesture
      video.dispatchEvent(new Event('play'))
      expect(ctx.resumes).toBe(2)
      a.destroy()
      ctx.state = 'suspended'
      video.dispatchEvent(new Event('play'))
      expect(ctx.resumes).toBe(2) // no longer listening
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
