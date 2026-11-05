import { describe, expect, it } from 'vitest'
import { BRAND_ECO, ECO_ACCENTS, ECO_ACCESSORIES, ECO_EYES, ecoFor, eyeColor, shade } from './ecoRules'

describe('Eco', () => {
  it('each person is born with one stable Eco, and people differ', () => {
    expect(ecoFor('0190f0a0-aaaa-7bbb-8ccc-000000000001')).toEqual(ecoFor('0190f0a0-aaaa-7bbb-8ccc-000000000001'))
    const many = Array.from({ length: 400 }, (_, i) => ecoFor(`0190f0a0-aaaa-7bbb-8ccc-${String(i).padStart(12, '0')}`))
    // Every part gets used, and no single combination dominates.
    expect(new Set(many.map((e) => e.accent)).size).toBe(ECO_ACCENTS.length)
    expect(new Set(many.map((e) => e.eyes)).size).toBe(ECO_EYES.length)
    expect(new Set(many.map((e) => e.accessory)).size).toBe(ECO_ACCESSORIES.length)
    const combos = new Set(many.map((e) => `${e.accent}|${e.eyes}|${e.accessory}`))
    expect(combos.size).toBeGreaterThan(250)
  })

  it('the brand Eco keeps white eyes; the others wear their accent', () => {
    expect(eyeColor(BRAND_ECO.accent)).toBe('#f7f8f8')
    expect(eyeColor('#e5484d')).toBe('#e5484d')
  })

  it('shades toward black without leaving the color range', () => {
    expect(shade('#ffffff', 0.5)).toBe('#808080')
    expect(shade('#e5484d', 1)).toBe('#e5484d')
    expect(shade('#123456', 0)).toBe('#000000')
  })
})
