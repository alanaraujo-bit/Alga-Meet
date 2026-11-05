// Film audio (spec §6.7): film → volume gain → duck gain → output, independent from the voices' volume.
export const DUCK_DB = -10
const ATTACK_MS = 150
const RELEASE_MS = 700
const TICK_MS = 50

/** Ducking envelope in dB: linear in dB, reaches -10 dB in ATTACK_MS and returns to 0 in RELEASE_MS, no overshoot. */
export function duckGain(speakingAnyone: boolean, prevGainDb: number, dtMs: number): number {
  if (speakingAnyone) return Math.max(DUCK_DB, prevGainDb - (-DUCK_DB / ATTACK_MS) * dtMs)
  return Math.min(0, prevGainDb + (-DUCK_DB / RELEASE_MS) * dtMs)
}

const HEADPHONES = /head(phone|set)|earphone|earbud|ear ?pod|airpod|fone|auricular|buds/i

/** True when the output device label does not look like headphones: the film would leak into the mic (UI shows the notice). */
export function echoRisk(label: string | null | undefined): boolean {
  return !label || !HEADPHONES.test(label)
}

const dbToLin = (db: number) => 10 ** (db / 20)

type SinkCtx = AudioContext & { setSinkId?: (id: string) => Promise<void> }

export interface FilmAudioOpts {
  /** 'mediastream' plays the graph through a hidden <audio> (the path Chromium's AEC is likelier to reference). Task 15 picks. */
  route?: 'webaudio' | 'mediastream'
}

export class FilmAudio {
  private readonly ctx = new AudioContext({ latencyHint: 'interactive' })
  private readonly source: MediaElementAudioSourceNode
  private readonly volume: GainNode
  private readonly duck: GainNode
  private readonly sinkEl: HTMLAudioElement | null = null
  private readonly timer: ReturnType<typeof setInterval>
  private vol = 1
  private muted = false
  private ducking = true
  private others = false
  private duckDb = 0
  private deviceLabel: string | null = null

  constructor(video: HTMLVideoElement, opts: FilmAudioOpts = {}) {
    this.source = this.ctx.createMediaElementSource(video)
    this.volume = this.ctx.createGain()
    this.duck = this.ctx.createGain()
    this.source.connect(this.volume).connect(this.duck)
    if (opts.route === 'mediastream') {
      const dest = this.ctx.createMediaStreamDestination()
      this.duck.connect(dest)
      this.sinkEl = new Audio()
      this.sinkEl.srcObject = dest.stream
      void this.sinkEl.play().catch(() => undefined)
    } else this.duck.connect(this.ctx.destination)
    void this.ctx.resume().catch(() => undefined)
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  setVolume(v: number): void {
    this.vol = Math.min(1, Math.max(0, v))
    this.applyVolume()
  }
  setMuted(m: boolean): void {
    this.muted = m
    this.applyVolume()
  }
  setDucking(on: boolean): void {
    this.ducking = on
  }
  /** Fed by the UI from the voice call's speaking state (others only, never the user). */
  setOthersSpeaking(b: boolean): void {
    this.others = b
  }
  /** Route to the call's output device; falls back to the default device (and logs) if the sink can't be set. */
  async setOutput(deviceId: string | null, label: string | null = null): Promise<void> {
    this.deviceLabel = label
    const id = deviceId && deviceId !== 'default' ? deviceId : ''
    try {
      if (this.sinkEl) await (this.sinkEl as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(id)
      else await (this.ctx as SinkCtx).setSinkId?.(id)
    } catch (e) {
      console.warn('[cinema] film audio: setSinkId failed, using the default device', e)
    }
  }
  echoRisk(): boolean {
    return echoRisk(this.deviceLabel)
  }
  /** Added to the expected display time by the player (R28). */
  outputLatencyMs = (): number => ((this.ctx.outputLatency || 0) + this.ctx.baseLatency) * 1000

  destroy(): void {
    clearInterval(this.timer)
    this.sinkEl?.pause()
    this.source.disconnect()
    void this.ctx.close().catch(() => undefined)
  }

  private applyVolume(): void {
    this.volume.gain.setTargetAtTime(this.muted ? 0 : this.vol, this.ctx.currentTime, 0.015)
  }
  private tick(): void {
    const next = duckGain(this.ducking && this.others, this.duckDb, TICK_MS)
    if (next === this.duckDb) return
    this.duckDb = next
    const now = this.ctx.currentTime
    this.duck.gain.cancelScheduledValues(now)
    this.duck.gain.setValueAtTime(this.duck.gain.value, now)
    this.duck.gain.linearRampToValueAtTime(dbToLin(next), now + TICK_MS / 1000)
  }
}
