import { describe, expect, it } from 'vitest'
import { chapterAt, heatProfile, reactionsAt, skipIntroTo } from './timeline'
import { thumbCount, thumbHeight, thumbTile } from './thumbs'

describe('thumbs (R27 sprite)', () => {
  it('tile height is even round(160·h/w)', () => {
    expect(thumbHeight(1920, 1080)).toBe(90)
    expect(thumbHeight(1920, 804)).toBe(68) // 2.39: 66.9 → 68 (even)
    expect(thumbHeight(3840, 1606)).toBe(66)
  })

  it('the tile of a time: 10 columns, one tile per 10 s', () => {
    const film = { durationS: 9960, width: 1920, height: 1080 }
    expect(thumbTile(0, film)).toMatchObject({ x: 0, y: 0, w: 160, h: 90 })
    expect(thumbTile(9.9, film)).toMatchObject({ x: 0, y: 0 })
    expect(thumbTile(10, film)).toMatchObject({ x: 160, y: 0 })
    expect(thumbTile(4360, film)).toMatchObject({ x: 6 * 160, y: 43 * 90, sheetW: 1600, sheetH: 100 * 90 })
    expect(thumbTile(99_999, film)).toMatchObject({ x: 5 * 160, y: 99 * 90 }) // past the end: the last tile (#995)
    expect(thumbTile(-5, film)).toMatchObject({ x: 0, y: 0 })
  })

  it('a very long film stops at the WebP height cap', () => {
    expect(thumbCount(86_400, 1920, 1080)).toBe(Math.floor(16383 / 90) * 10)
    expect(thumbCount(5, 1920, 1080)).toBe(1)
  })
})

describe('heatProfile', () => {
  it('normalizes to the peak', () => {
    const p = heatProfile([0, 0, 4, 0, 0, 1, 0, 0, 0, 0], 10)
    expect(Math.max(...p)).toBeCloseTo(1)
    expect(p.every((v) => v >= 0 && v <= 1)).toBe(true)
    expect(p.indexOf(Math.max(...p))).toBe(2)
  })
  it('no reactions, no buckets: flat zero', () => {
    expect(heatProfile([0, 0, 0], 5)).toEqual([0, 0, 0, 0, 0])
    expect(heatProfile([], 4)).toEqual([0, 0, 0, 0])
  })
  it('resamples to the requested points', () => {
    expect(heatProfile(Array.from({ length: 996 }, (_, i) => i % 7), 240)).toHaveLength(240)
  })
})

describe('chapters', () => {
  const ch = [{ startS: 0, title: 'Abertura' }, { startS: 90, title: 'A travessia' }, { startS: 300, title: 'Créditos' }]
  it('the chapter at a time', () => {
    expect(chapterAt(ch, 0)?.chapter.title).toBe('Abertura')
    expect(chapterAt(ch, 120)).toEqual({ index: 1, chapter: ch[1] })
    expect(chapterAt([{ startS: 10, title: 'x' }], 5)).toBeNull()
    expect(chapterAt([], 50)).toBeNull()
  })
  it('"Pular abertura" only inside an opening chapter, to the next one', () => {
    expect(skipIntroTo(ch, 30)).toBe(90)
    expect(skipIntroTo(ch, 100)).toBeNull()
    expect(skipIntroTo([{ startS: 0, title: 'Intro' }], 10)).toBeNull() // nothing after it
    expect(skipIntroTo([{ startS: 0, title: 'OP' }, { startS: 85, title: 'Part A' }], 1)).toBe(85)
    expect(skipIntroTo([{ startS: 0, title: 'Operação' }, { startS: 85, title: 'B' }], 1)).toBeNull() // "op" must be a word
    expect(skipIntroTo([], 10)).toBeNull() // no chapters
  })
  it('reactions in the bucket of a time', () => {
    expect(reactionsAt([0, 3, 23], 25)).toBe(23)
    expect(reactionsAt([], 25)).toBe(0)
  })
})
