import { describe, expect, it } from 'vitest'
import { hueOfHex, hueOfPixels } from './personHue'

describe('person hue', () => {
  it('reads the dominant hue in OKLCH', () => {
    // sRGB red ≈ 29°, blue ≈ 264°, the accent indigo ≈ 279°.
    expect(hueOfHex('#ff0000')).toBeGreaterThan(24)
    expect(hueOfHex('#ff0000')).toBeLessThan(34)
    expect(Math.abs(hueOfHex('#0000ff')! - 264)).toBeLessThan(4)
    expect(Math.abs(hueOfHex('#8b8ef7')! - 279)).toBeLessThan(5)
  })

  it('ignores greys and transparent pixels, and weights by chroma', () => {
    expect(hueOfHex('#808080')).toBeNull()
    expect(hueOfPixels([255, 0, 0, 0, 120, 120, 120, 255])).toBeNull()
    // Mostly grey with one vivid blue pixel: the blue wins, the greys do not pull it.
    const px = [...Array(12).fill([128, 128, 128, 255]).flat(), 0, 0, 255, 255, 0, 0, 255, 255]
    expect(Math.abs(hueOfPixels(px)! - 264)).toBeLessThan(4)
    expect(hueOfHex('nope')).toBeNull()
  })
})
