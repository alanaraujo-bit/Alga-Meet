import { describe, expect, it } from 'vitest'
import { CHROMIUM_SWITCHES } from './chromium-flags-logic'

describe('chromium switches', () => {
  it('raises the MSE buffer limits for the cinema (R29)', () => {
    const m = new Map(CHROMIUM_SWITCHES)
    expect(m.get('mse-video-buffer-size-limit-mb')).toBe('500')
    expect(m.get('mse-audio-buffer-size-limit-mb')).toBe('64')
    expect(Number(m.get('mse-video-buffer-size-limit-mb'))).toBeGreaterThan(450) // 90 s at 40 Mbps
  })
})
