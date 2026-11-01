import type { CosmeticId } from '../hora-azul'

/*
 * Entrance sounds (HA-20…22), synthesized in the renderer (no samples, no files): glass bell, nylon arpeggio, air
 * + bell. Peaks stay near −20 dBFS so the integrated loudness lands well under the −24 LUFS ceiling (§3.3.6).
 * shortcut: loudness is set by ear and peak math, not measured; package B's sound script (LUFS/dBTP) is still to do.
 * shortcut: preview only. The join-event player (once per 10 min per channel, ≤ 15 people, mutes) waits for the
 * entranceSound slot on PublicUser and the voice owner (voice.ts).
 */

let ctx: AudioContext | null = null
const PEAK = 0.1

/** A struck glass/metal partial: fast attack, exponential tail. */
function partial(ac: BaseAudioContext, out: AudioNode, at: number, freq: number, gain: number, attack: number, decay: number, type: OscillatorType = 'sine') {
  const o = ac.createOscillator()
  const g = ac.createGain()
  o.type = type
  o.frequency.value = freq
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(gain, at + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, at + decay)
  o.connect(g).connect(out)
  o.start(at)
  o.stop(at + decay + 0.02)
}

/** Glass bell: fundamental plus two inharmonic partials (2.76×, 5.4×) that die faster. */
const bell = (ac: BaseAudioContext, out: AudioNode, at: number, f: number, len: number, k = 1) => {
  partial(ac, out, at, f, PEAK * 0.7 * k, 0.005, len)
  partial(ac, out, at, f * 2.76, PEAK * 0.22 * k, 0.005, len * 0.45)
  partial(ac, out, at, f * 5.4, PEAK * 0.08 * k, 0.003, len * 0.2)
}

/** Nylon string: harmonics 1–6 at 1/n, the high ones fading first (a plucked, warm tone). */
const pluck = (ac: BaseAudioContext, out: AudioNode, at: number, f: number, len: number) => {
  for (let n = 1; n <= 6; n++) partial(ac, out, at, f * n, (PEAK * 0.5) / n ** 1.3, 0.004, len / (1 + (n - 1) * 0.6), 'triangle')
}

/** Schedules `id` on `ac` from `at`. Exported so a script can render it offline (OfflineAudioContext). */
export function schedule(ac: BaseAudioContext, id: CosmeticId, at = ac.currentTime): number {
  const out = ac.createGain()
  out.connect(ac.destination)
  if (id === 'sound_ha_toque_vidro') {
    bell(ac, out, at, 659.25, 0.62) // E5
    bell(ac, out, at + 0.09, 987.77, 0.6, 0.85) // B5
    return 0.7
  }
  if (id === 'sound_ha_corda') {
    // Cmaj7 (C4 E4 G4 B4), 70 ms apart: a nod to bossa nova.
    ;[261.63, 329.63, 392.0, 493.88].forEach((f, i) => pluck(ac, out, at + i * 0.07, f, 0.9 - i * 0.07))
    return 0.9
  }
  if (id === 'sound_ha_sopro') {
    const len = 0.25
    const noise = ac.createBuffer(1, Math.ceil(ac.sampleRate * len), ac.sampleRate)
    const d = noise.getChannelData(0)
    let seed = 7
    for (let i = 0; i < d.length; i++) d[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
    const src = ac.createBufferSource()
    src.buffer = noise
    const bp = ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 1.4
    bp.frequency.setValueAtTime(600, at)
    bp.frequency.exponentialRampToValueAtTime(2600, at + len)
    const g = ac.createGain()
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(PEAK * 0.5, at + len * 0.8)
    g.gain.linearRampToValueAtTime(0, at + len)
    src.connect(bp).connect(g).connect(out)
    src.start(at)
    bell(ac, out, at + 0.22, 880, 0.38, 0.8) // A5
    return 0.6
  }
  return 0
}

/** Plays an entrance sound now (shop/gallery preview). */
export function playEntranceSound(id: CosmeticId): void {
  ctx ??= new AudioContext()
  void ctx.resume()
  schedule(ctx, id)
}
