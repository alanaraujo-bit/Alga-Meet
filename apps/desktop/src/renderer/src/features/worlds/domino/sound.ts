/**
 * What a domino table sounds like, synthesized (no samples): a tile put down on the felt, the set being shuffled, a
 * tile slid into a hand, knuckles on the table for a pass, and two short chimes (your turn, a round won). Loudness
 * falls with the distance to the table. Plays on the same context as the app's cues.
 */
import { cueContext } from '@/media/sounds'
import { burst, ping } from '../pool/sound'

export class DominoSound {
  volume = 0.9

  private open(level: number, lastMs = 900): { ac: AudioContext; out: GainNode; at: number } | null {
    if (level <= 0.004) return null
    const ac = cueContext()
    if (!ac) return null
    const out = ac.createGain()
    out.gain.value = Math.min(1, level) * this.volume
    out.connect(ac.destination)
    setTimeout(() => out.disconnect(), lastMs)
    return { ac, out, at: ac.currentTime + 0.004 }
  }

  /** A tile put down on the table. `hard`: 0..1. */
  clack(hard = 0.7, near = 1): void {
    const s = this.open((0.35 + hard * 0.65) * near)
    if (!s) return
    const pitch = 0.92 + Math.random() * 0.16
    // The resin itself, then the table under the felt answering.
    burst(s.ac, s.out, s.at, 'bandpass', 3100 * pitch, 1.3, 0.016, 0.85)
    ping(s.ac, s.out, s.at, 2350 * pitch, 2100 * pitch, 0.02, 0.4, 'triangle')
    ping(s.ac, s.out, s.at, 210, 130, 0.07, 0.6)
    burst(s.ac, s.out, s.at + 0.002, 'lowpass', 700, 0.7, 0.045, 0.5)
  }

  /** A tile slid across the felt into a hand. */
  tick(near = 1): void {
    const s = this.open(0.32 * near)
    if (!s) return
    const pitch = 0.9 + Math.random() * 0.25
    burst(s.ac, s.out, s.at, 'bandpass', 2600 * pitch, 1.6, 0.012, 0.7)
    ping(s.ac, s.out, s.at, 1700 * pitch, 1500 * pitch, 0.014, 0.25, 'triangle')
  }

  /** The whole set stirred on the table for `seconds`. */
  shuffle(seconds = 0.9, near = 1): void {
    const s = this.open(0.55 * near, seconds * 1000 + 600)
    if (!s) return
    const n = Math.round(seconds * 26)
    for (let i = 0; i < n; i++) {
      const at = s.at + (i / n) * seconds + Math.random() * 0.02
      const pitch = 0.8 + Math.random() * 0.5
      const g = 0.25 + Math.random() * 0.5
      burst(s.ac, s.out, at, 'bandpass', 2900 * pitch, 1.4, 0.014, g)
      ping(s.ac, s.out, at, 2000 * pitch, 1800 * pitch, 0.015, g * 0.35, 'triangle')
    }
    // The tiles dragging over the felt underneath it all.
    burst(s.ac, s.out, s.at, 'lowpass', 1100, 0.5, seconds, 0.16)
  }

  /** Two knocks on the table: no tile to play. */
  knock(near = 1): void {
    const s = this.open(0.75 * near)
    if (!s) return
    for (const t of [0, 0.15]) {
      ping(s.ac, s.out, s.at + t, 165, 95, 0.09, 0.9)
      burst(s.ac, s.out, s.at + t, 'lowpass', 520, 0.8, 0.04, 0.55)
    }
  }

  /** Soft: it is my turn. */
  turn(): void {
    const s = this.open(0.2)
    if (!s) return
    ping(s.ac, s.out, s.at, 880, 880, 0.16, 0.5)
    ping(s.ac, s.out, s.at + 0.09, 1320, 1320, 0.22, 0.4)
  }

  /** A round ended. `mine`: my side won it. */
  over(mine: boolean, near = 1): void {
    const s = this.open(0.3 * near, 1600)
    if (!s) return
    const notes = mine ? [523, 659, 784, 1047] : [440, 392]
    notes.forEach((f, i) => ping(s.ac, s.out, s.at + i * 0.11, f, f, 0.34, 0.45, 'triangle'))
  }
}
