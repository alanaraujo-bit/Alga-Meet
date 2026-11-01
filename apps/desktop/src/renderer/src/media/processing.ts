// Mic processing: Chromium APM constraints per mode + a LiveKit audio TrackProcessor that runs
// [RNNoise (advanced mode)] -> VAD/PTT gate (always) on our own 48 kHz AudioContext.
import { RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import type { AudioCaptureOptions, AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client'
import type { ProcessingMode } from './prefs'
import type { GateMessage, GateReport } from './vad-gate.worklet'
import gateWorkletUrl from './vad-gate.worklet.ts?worker&url'

/** getUserMedia constraints per processing mode. Echo cancellation stays on unless the user asked for raw audio. */
export function captureConstraints(mode: ProcessingMode, deviceId: string | null): AudioCaptureOptions {
  const apm = mode === 'standard'
  return {
    deviceId: deviceId ?? undefined,
    channelCount: 1,
    sampleRate: 48000,
    echoCancellation: mode !== 'off',
    // RNNoise replaces Chromium's NS in advanced mode; running both over-suppresses (watery voice).
    noiseSuppression: apm,
    autoGainControl: mode !== 'off',
    voiceIsolation: false,
  }
}

let rnnoiseWasm: Promise<ArrayBuffer> | null = null
function loadRnnoiseWasm(): Promise<ArrayBuffer> {
  // Chromium 140 always has wasm SIMD on x64, so only the SIMD build ships.
  rnnoiseWasm ??= fetch(rnnoiseWasmUrl).then(async (r) => {
    if (!r.ok) throw new Error(`rnnoise wasm: HTTP ${r.status}`)
    const bin = await r.arrayBuffer()
    // The worklet would fail silently (outputting silence) if CSP forbids WASM; find out here instead.
    await WebAssembly.compile(bin).catch(() => {
      throw new Error("a CSP do app bloqueia WebAssembly (falta 'wasm-unsafe-eval' em script-src)")
    })
    return bin
  })
  rnnoiseWasm.catch(() => (rnnoiseWasm = null))
  return rnnoiseWasm
}

export interface VoiceGraphOptions {
  rnnoise: boolean
  onReport: (r: GateReport) => void
}

/** A capture graph usable both as a LiveKit TrackProcessor and standalone (mic test). */
export class VoiceGraph {
  readonly ctx: AudioContext
  private source: MediaStreamAudioSourceNode | null = null
  private rnnoise: RnnoiseWorkletNode | null = null
  private gate: AudioWorkletNode | null = null
  private dest: MediaStreamAudioDestinationNode
  private ready: Promise<void>
  private rnnoiseLoaded = false
  private lastConfig: GateMessage = { type: 'config', thresholdDb: null, hangoverMs: 300 }
  private lastMode: GateMessage = { type: 'mode', mode: 'vad', forcedOpen: false }
  rnnoiseActive = false

  constructor(private opts: VoiceGraphOptions) {
    // Own context at 48 kHz (RNNoise assumes it) with no output device: this graph only feeds WebRTC.
    this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive', sinkId: { type: 'none' } } as AudioContextOptions)
    this.dest = this.ctx.createMediaStreamDestination()
    this.dest.channelCount = 1
    this.ready = this.ctx.audioWorklet.addModule(gateWorkletUrl)
  }

  get output(): MediaStreamTrack {
    return this.dest.stream.getAudioTracks()[0]!
  }

  async setInput(track: MediaStreamTrack): Promise<void> {
    await this.ready
    if (this.ctx.state !== 'running') await this.ctx.resume()
    this.source?.disconnect()
    this.source = this.ctx.createMediaStreamSource(new MediaStream([track]))
    if (!this.gate) {
      this.gate = new AudioWorkletNode(this.ctx, 'alga-vad-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' })
      this.gate.port.onmessage = (e: MessageEvent<GateReport>) => this.opts.onReport(e.data)
      this.gate.port.postMessage(this.lastConfig)
      this.gate.port.postMessage(this.lastMode)
      this.gate.connect(this.dest)
    }
    await this.setRnnoise(this.opts.rnnoise)
  }

  /** Insert/remove RNNoise without touching the capture track. Throws if it can't load (CSP/WASM). */
  async setRnnoise(on: boolean): Promise<void> {
    this.opts.rnnoise = on
    if (!this.source || !this.gate) return
    this.source.disconnect()
    this.rnnoise?.disconnect()
    if (on && !this.rnnoise) {
      try {
        if (!this.rnnoiseLoaded) {
          await this.ctx.audioWorklet.addModule(rnnoiseWorkletUrl)
          this.rnnoiseLoaded = true
        }
        this.rnnoise = new RnnoiseWorkletNode(this.ctx, { maxChannels: 1, wasmBinary: await loadRnnoiseWasm() })
      } catch (err) {
        this.source.connect(this.gate)
        this.rnnoiseActive = false
        this.opts.rnnoise = false // later track restarts must not retry (and throw) inside LiveKit
        throw err
      }
    }
    if (on && this.rnnoise) {
      this.source.connect(this.rnnoise).connect(this.gate)
      this.rnnoiseActive = true
    } else {
      this.source.connect(this.gate)
      this.rnnoiseActive = false
    }
  }

  setGate(thresholdDb: number | null, hangoverMs: number): void {
    this.lastConfig = { type: 'config', thresholdDb, hangoverMs }
    this.gate?.port.postMessage(this.lastConfig)
  }

  /** 'vad' = automatic gate; 'forced' = PTT/open mic controlled by `open`. */
  setMode(mode: 'vad' | 'forced', open = false): void {
    this.lastMode = { type: 'mode', mode, forcedOpen: open }
    this.gate?.port.postMessage(this.lastMode)
  }

  async close(): Promise<void> {
    this.source?.disconnect()
    this.rnnoise?.destroy()
    this.gate?.port.close()
    this.output.stop()
    await this.ctx.close().catch(() => undefined)
  }
}

/** LiveKit adapter: LiveKit hands us the raw mic track; we hand back the gated/denoised one. */
export class VoiceProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = 'alga-voice'
  processedTrack?: MediaStreamTrack
  constructor(readonly graph: VoiceGraph) {}

  async init(opts: AudioProcessorOptions): Promise<void> {
    await this.graph.setInput(opts.track)
    this.processedTrack = this.graph.output
  }
  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.init(opts)
  }
  async destroy(): Promise<void> {
    // The graph outlives a single LiveKit track (device switch / mode change restart it); the engine closes it.
  }
}
