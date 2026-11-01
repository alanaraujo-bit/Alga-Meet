// AudioWorklet: mic level meter + voice-activity / push-to-talk gate with 10 ms lookahead.
// The lookahead delays the audio slightly so the gate is already open when a word's first
// consonant arrives (no clipped onsets); the VadGate hangover keeps word endings.
import { VadGate, rmsDb } from './vad'

declare const sampleRate: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

export type GateMessage =
  | { type: 'config'; thresholdDb: number | null; hangoverMs: number }
  | { type: 'mode'; mode: 'vad' | 'forced'; forcedOpen: boolean }

export interface GateReport {
  db: number
  open: boolean
  thresholdDb: number
}

const FRAME_MS = 10
const LOOKAHEAD_MS = 10
const ATTACK_MS = 5
const RELEASE_MS = 40
const REPORT_MS = 50

class GateProcessor extends AudioWorkletProcessor {
  private gate = new VadGate()
  private mode: 'vad' | 'forced' = 'vad'
  private forcedOpen = false
  private frame = new Float32Array(Math.round((sampleRate * FRAME_MS) / 1000))
  private frameFill = 0
  private delay = new Float32Array(Math.round((sampleRate * LOOKAHEAD_MS) / 1000))
  private delayPos = 0
  private gain = 0
  private attackStep = 1 / ((sampleRate * ATTACK_MS) / 1000)
  private releaseStep = 1 / ((sampleRate * RELEASE_MS) / 1000)
  private lastDb = -120
  private sinceReport = 0

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<GateMessage>) => {
      const m = e.data
      if (m.type === 'config') this.gate.config = { thresholdDb: m.thresholdDb, hangoverMs: m.hangoverMs }
      else {
        this.mode = m.mode
        this.forcedOpen = m.forcedOpen
      }
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0]
    const outs = outputs[0] ?? []
    const n = outs[0]?.length ?? 128
    for (let i = 0; i < n; i++) {
      const x = input ? input[i]! : 0
      this.frame[this.frameFill++] = x
      if (this.frameFill === this.frame.length) {
        this.lastDb = rmsDb(this.frame)
        this.gate.process(this.lastDb, FRAME_MS)
        this.frameFill = 0
      }
      const open = this.mode === 'forced' ? this.forcedOpen : this.gate.open
      this.gain = open ? Math.min(1, this.gain + this.attackStep) : Math.max(0, this.gain - this.releaseStep)
      const delayed = this.delay[this.delayPos]!
      this.delay[this.delayPos] = x
      this.delayPos = (this.delayPos + 1) % this.delay.length
      const y = delayed * this.gain
      for (const ch of outs) ch[i] = y
    }
    this.sinceReport += (n / sampleRate) * 1000
    if (this.sinceReport >= REPORT_MS) {
      this.sinceReport = 0
      const open = this.mode === 'forced' ? this.forcedOpen : this.gate.open
      const report: GateReport = { db: this.lastDb, open, thresholdDb: this.gate.thresholdDb }
      this.port.postMessage(report)
    }
    return true
  }
}

registerProcessor('alga-vad-gate', GateProcessor)
