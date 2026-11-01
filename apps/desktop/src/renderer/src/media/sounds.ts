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
    for (const [freq, start, dur] of CUES[cue]) {
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
  } catch {
    // Audio output unavailable: cues are cosmetic.
  }
}
