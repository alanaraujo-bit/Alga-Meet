/**
 * What a pool table sounds like, synthesized (no samples): the clack of two balls, the thud of a cushion, the tock of
 * the tip, a ball dropping into a leather pocket. Loudness follows how hard the thing was hit and how far the listener
 * is. Plays on the same context as the app's cues, so it goes to the same output device.
 */
import { cueContext } from '@/media/sounds'

let noise: AudioBuffer | null = null
function noiseOf(ac: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ac.sampleRate) return noise
  noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.25), ac.sampleRate)
  const d = noise.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return noise
}

/** A burst of filtered noise. */
export function burst(ac: AudioContext, out: AudioNode, at: number, type: BiquadFilterType, freq: number, q: number, dur: number, gain: number): void {
  const src = ac.createBufferSource()
  src.buffer = noiseOf(ac)
  const f = ac.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  const g = ac.createGain()
  g.gain.setValueAtTime(gain, at)
  g.gain.exponentialRampToValueAtTime(0.0008, at + dur)
  src.connect(f).connect(g).connect(out)
  src.start(at, Math.random() * 0.2)
  src.stop(at + dur + 0.01)
}

/** A struck tone that dies away, optionally sliding in pitch. */
export function ping(ac: AudioContext, out: AudioNode, at: number, from: number, to: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
  const o = ac.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(from, at)
  if (to !== from) o.frequency.exponentialRampToValueAtTime(to, at + dur)
  const g = ac.createGain()
  g.gain.setValueAtTime(gain, at)
  g.gain.exponentialRampToValueAtTime(0.0008, at + dur)
  o.connect(g).connect(out)
  o.start(at)
  o.stop(at + dur + 0.01)
}

export class PoolSound {
  volume = 0.9
  /** Recent clacks: a break is fifteen of them in a few milliseconds, and that many voices is only noise. */
  private recent: number[] = []

  private open(level: number): { ac: AudioContext; out: GainNode; at: number } | null {
    if (level <= 0.004) return null
    const ac = cueContext()
    if (!ac) return null
    const out = ac.createGain()
    out.gain.value = Math.min(1, level) * this.volume
    out.connect(ac.destination)
    setTimeout(() => out.disconnect(), 900)
    return { ac, out, at: ac.currentTime + 0.004 }
  }

  /** Two balls, closing at `v` m/s. `near`: 1 next to the table, falling with distance. */
  ball(v: number, near = 1): void {
    const now = performance.now()
    this.recent = this.recent.filter((t) => now - t < 45)
    if (this.recent.length >= 5) return
    this.recent.push(now)
    const s = this.open(Math.min(1, Math.pow(v / 4.5, 0.75)) * near)
    if (!s) return
    const pitch = 0.94 + Math.random() * 0.12
    burst(s.ac, s.out, s.at, 'bandpass', 4200 * pitch, 1.1, 0.012, 0.9)
    ping(s.ac, s.out, s.at, 5600 * pitch, 5200 * pitch, 0.009, 0.5)
    ping(s.ac, s.out, s.at, 1750 * pitch, 1500 * pitch, 0.022, 0.38, 'triangle')
  }

  rail(v: number, near = 1): void {
    const s = this.open(Math.min(1, Math.pow(v / 4, 0.8)) * 0.7 * near)
    if (!s) return
    burst(s.ac, s.out, s.at, 'lowpass', 520, 0.7, 0.05, 0.9)
    ping(s.ac, s.out, s.at, 170, 110, 0.07, 0.8)
  }

  /** The tip on the cue ball, which leaves at `v` m/s. */
  strike(v: number, near = 1): void {
    const s = this.open(Math.min(1, 0.25 + Math.pow(v / 9, 0.7)) * near)
    if (!s) return
    burst(s.ac, s.out, s.at, 'bandpass', 2300, 0.9, 0.014, 0.8)
    ping(s.ac, s.out, s.at, 1250, 760, 0.03, 0.55, 'triangle')
    ping(s.ac, s.out, s.at, 320, 210, 0.05, 0.35)
  }

  pot(v: number, near = 1): void {
    const s = this.open(Math.min(1, 0.45 + v / 6) * near)
    if (!s) return
    ping(s.ac, s.out, s.at, 150, 70, 0.16, 0.9)
    burst(s.ac, s.out, s.at, 'lowpass', 900, 0.8, 0.05, 0.7)
    for (const [t, g] of [[0.07, 0.4], [0.15, 0.26], [0.24, 0.15]] as const) {
      burst(s.ac, s.out, s.at + t, 'bandpass', 1500, 1.4, 0.02, g)
      ping(s.ac, s.out, s.at + t, 420, 300, 0.03, g * 0.6)
    }
  }
}
