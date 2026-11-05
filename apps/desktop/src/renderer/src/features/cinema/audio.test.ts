import { describe, expect, it } from 'vitest'
import { DUCK_DB, duckGain, echoRisk } from './audio'

function run(speaking: boolean, from: number, ms: number): number {
  let g = from
  for (let t = 0; t < ms; t += 50) g = duckGain(speaking, g, 50)
  return g
}

describe('duckGain', () => {
  it('attacks to -10 dB in ~150 ms', () => {
    expect(run(true, 0, 150)).toBeCloseTo(DUCK_DB, 5)
    const half = run(true, 0, 75)
    expect(half).toBeLessThan(-3)
    expect(half).toBeGreaterThan(-7)
  })
  it('releases to 0 dB in ~700 ms (within 10%)', () => {
    expect(run(false, DUCK_DB, 700)).toBeCloseTo(0, 5)
    expect(run(false, DUCK_DB, 600)).toBeLessThan(-1) // not early
  })
  it('never overshoots', () => {
    expect(duckGain(true, DUCK_DB, 1000)).toBe(DUCK_DB)
    expect(duckGain(false, 0, 1000)).toBe(0)
  })
})

describe('echoRisk', () => {
  it('is false for headphones-like labels, any case or language', () => {
    for (const l of ['Headphones (Realtek)', 'Headset Earphone (Logitech)', 'Fone de ouvido (USB)', 'AirPods Pro', 'Galaxy EARBUDS'])
      expect(echoRisk(l)).toBe(false)
  })
  it('is true for speakers or unknown labels', () => {
    for (const l of ['Speakers (Realtek)', 'Alto-falantes', 'Monitor LG', '', null]) expect(echoRisk(l)).toBe(true)
  })
})
