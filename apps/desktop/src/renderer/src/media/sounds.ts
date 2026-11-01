// UI cues synthesized with WebAudio (no assets): short, soft sine/triangle notes with smooth envelopes.
export type Cue = 'join' | 'leave' | 'mute' | 'unmute' | 'deafen' | 'undeafen' | 'disconnect' | 'streamStart' | 'streamStop'

// [frequency Hz, start s, duration s]
const CUES: Record<Cue, Array<[number, number, number]>> = {
  join: [[523.25, 0, 0.09], [783.99, 0.07, 0.14]],
  leave: [[783.99, 0, 0.09], [523.25, 0.07, 0.14]],
  mute: [[440, 0, 0.08], [349.23, 0.05, 0.1]],
  unmute: [[349.23, 0, 0.08], [440, 0.05, 0.1]],
  deafen: [[392, 0, 0.08], [293.66, 0.06, 0.1], [220, 0.12, 0.14]],
  undeafen: [[220, 0, 0.08], [293.66, 0.06, 0.1], [392, 0.12, 0.14]],
  disconnect: [[659.25, 0, 0.1], [493.88, 0.09, 0.1], [329.63, 0.18, 0.22]],
  streamStart: [[587.33, 0, 0.07], [880, 0.06, 0.12]],
  streamStop: [[880, 0, 0.07], [587.33, 0.06, 0.12]],
}

let ctx: AudioContext | null = null
let sink: string | null = null

export function setCueOutput(deviceId: string | null): void {
  sink = deviceId
  const c = ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null
  if (c?.setSinkId) void c.setSinkId(deviceId && deviceId !== 'default' ? deviceId : '').catch(() => undefined)
}

export function playCue(cue: Cue, volume = 0.18): void {
  play(CUES[cue], volume)
}

/** Schedule notes now on the shared context; returns their master gain (null if audio is unavailable). */
function play(notes: Array<[number, number, number]>, volume: number): GainNode | null {
  try {
    if (!ctx) {
      ctx = new AudioContext({ latencyHint: 'interactive' })
      setCueOutput(sink)
    }
    if (ctx.state === 'suspended') void ctx.resume()
    const t0 = ctx.currentTime + 0.01
    const master = ctx.createGain()
    master.gain.value = volume
    master.connect(ctx.destination)
    for (const [freq, start, dur] of notes) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      // A quiet octave-up triangle adds warmth without harshness.
      const over = ctx.createOscillator()
      over.type = 'triangle'
      over.frequency.value = freq * 2
      const overGain = ctx.createGain()
      overGain.gain.value = 0.12
      const env = ctx.createGain()
      const a = t0 + start
      env.gain.setValueAtTime(0, a)
      env.gain.linearRampToValueAtTime(1, a + 0.012)
      env.gain.exponentialRampToValueAtTime(0.001, a + dur)
      osc.connect(env)
      over.connect(overGain).connect(env)
      env.connect(master)
      osc.start(a)
      over.start(a)
      osc.stop(a + dur + 0.02)
      over.stop(a + dur + 0.02)
    }
    return master
  } catch {
    // Audio output unavailable: cues are cosmetic.
    return null
  }
}

export type RingKind = 'incoming' | 'outgoing'

/**
 * Call rings, same voice as the cues (sine + soft octave triangle, no samples). Incoming: a light rising E–G♯–B
 * figure twice, then rest, every 3.2 s; present without alarm. Outgoing (ringback while you call): a quiet low
 * A–C♯ swell every 3 s, so you know it is ringing without it competing with the room.
 */
const RINGS: Record<RingKind, { notes: Array<[number, number, number]>; period: number; volume: number }> = {
  incoming: {
    notes: [[659.25, 0, 0.16], [830.61, 0.12, 0.16], [987.77, 0.24, 0.36], [659.25, 0.86, 0.16], [830.61, 0.98, 0.16], [987.77, 1.1, 0.42]],
    period: 3.2,
    volume: 0.16,
  },
  outgoing: { notes: [[440, 0, 0.45], [554.37, 0.2, 0.7]], period: 3, volume: 0.07 },
}

let ring: { timer: ReturnType<typeof setInterval>; gains: Set<GainNode> } | null = null

/** Loop a ring until stopRing(). One ring at a time: a new one replaces the old. */
export function startRing(kind: RingKind): void {
  stopRing()
  const { notes, period, volume } = RINGS[kind]
  const gains = new Set<GainNode>()
  const cycle = () => {
    const g = play(notes, volume)
    if (!g) return
    gains.add(g)
    setTimeout(() => gains.delete(g), period * 1000 + 500)
  }
  cycle()
  ring = { timer: setInterval(cycle, period * 1000), gains }
}

/** Stop now with a 60 ms fade (no click), including notes already scheduled. */
export function stopRing(): void {
  if (!ring) return
  clearInterval(ring.timer)
  const now = ctx?.currentTime ?? 0
  for (const g of ring.gains) {
    g.gain.cancelScheduledValues(now)
    g.gain.setValueAtTime(g.gain.value, now)
    g.gain.linearRampToValueAtTime(0, now + 0.06)
    setTimeout(() => g.disconnect(), 120)
  }
  ring = null
}
