import { describe, expect, it } from 'vitest'
import { ActivitySchema } from '@alga/shared'
import { cinemaActivity, formatElapsed, readableTint, sentence, spokenElapsed, vividAverage } from './logic'

describe('activity logic', () => {
  it('formats the live timer like a stopwatch', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(-5000)).toBe('0:00')
    expect(formatElapsed(65_000)).toBe('1:05')
    expect(formatElapsed(4 * 3600_000 + 37 * 60_000 + 37_000)).toBe('4:37:37')
  })

  it('says the span in words', () => {
    expect(spokenElapsed(20_000)).toBe('agora há pouco')
    expect(spokenElapsed(12 * 60_000)).toBe('há 12 min')
    expect(spokenElapsed(125 * 60_000)).toBe('há 2 h 05 min')
  })

  it('builds a Portuguese sentence per kind', () => {
    expect(sentence('game', 'VALORANT')).toBe('Jogando VALORANT')
    expect(sentence('code', 'Visual Studio Code')).toBe('Programando no Visual Studio Code')
    expect(sentence('music', 'Spotify')).toBe('Ouvindo Spotify')
  })

  it('finds the vivid color of an icon and ignores grey or transparent pixels', () => {
    const px = (...p: number[][]) => p.flat()
    // Red icon on a transparent margin with a grey outline.
    expect(vividAverage(px([230, 40, 50, 255], [230, 40, 50, 255], [128, 128, 128, 255], [0, 0, 255, 0]))).toEqual([226, 43, 53])
    expect(vividAverage(px([120, 120, 120, 255], [200, 200, 200, 255]))).toBeNull()
    expect(vividAverage(px([255, 0, 0, 0]))).toBeNull()
  })

  it('makes any hue readable on the dark surface', () => {
    expect(readableTint([230, 40, 50])).toBe('hsl(357 72% 70%)')
    expect(readableTint([20, 120, 220])).toMatch(/^hsl\(210 72% 70%\)$/)
  })

  it('the cinema presence: its own sentence, a valid activity, never the film title', () => {
    const a = cinemaActivity(1_700_000_000_000)
    expect(a).toEqual({ kind: 'video', name: 'Numa sessão de cinema', startedAt: 1_700_000_000_000 })
    expect(ActivitySchema.safeParse(a).success).toBe(true)
    expect(sentence(a.kind, a.name)).toBe('Numa sessão de cinema')
    expect(sentence('video', 'YouTube')).toBe('Assistindo no YouTube')
  })
})
