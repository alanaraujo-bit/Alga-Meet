import { describe, expect, it } from 'vitest'
import { diagnoseSend, type VideoOutStats } from './stats'

const sample = (fps: number, sourceFps: number | null, ql: string | null = 'none'): VideoOutStats => ({
  codec: 'video/H265',
  bitrateKbps: 3000,
  rttMs: 20,
  sourceFps,
  layers: [{ rid: 'f', width: 1280, height: 720, fps, bitrateKbps: 3000, encoderImplementation: 'NVIDIA', powerEfficientEncoder: true, qualityLimitationReason: ql, scalabilityMode: null }],
})
const three = (fps: number, src: number | null, ql?: string) => [sample(fps, src, ql), sample(fps, src, ql), sample(fps, src, ql)]

describe('why a share leaves below its frame rate', () => {
  it('says nothing before 3 seconds, or when the share is at its target', () => {
    expect(diagnoseSend([sample(30, 30)], { f: 60 }, 60, true, 'screen')).toBeNull()
    expect(diagnoseSend(three(58, 58), { f: 60 }, 60, true, 'screen')).toMatchObject({ limit: 'none', reason: null, fps: 58, targetFps: 60 })
  })

  it('blames the encoder limits first, then the capture of a moving picture, then dropped frames', () => {
    expect(diagnoseSend(three(30, 58, 'cpu'), { f: 60 }, 60, true, 'screen')?.limit).toBe('cpu')
    expect(diagnoseSend(three(30, 58, 'bandwidth'), { f: 60 }, 60, true, 'screen')?.limit).toBe('bandwidth')
    const capture = diagnoseSend(three(47, 47), { f: 60 }, 60, true, 'window')!
    expect(capture.limit).toBe('capture')
    expect(capture.reason).toContain('47 quadros por segundo desta janela')
    expect(diagnoseSend(three(30, 58), { f: 60 }, 60, true, 'screen')?.limit).toBe('encoder')
  })

  it('leaves a still screen alone: code or a document legitimately sends few frames', () => {
    expect(diagnoseSend(three(8, 8), { f: 60 }, 60, false, 'screen')?.limit).toBe('none')
    expect(diagnoseSend(three(5, 5), { f: 60 }, 60, true, 'screen')?.limit).toBe('none')
  })
})
