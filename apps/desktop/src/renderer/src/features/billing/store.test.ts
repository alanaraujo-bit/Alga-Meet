import type { Entitlement, Product } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { ACCENTS } from './accents'
import { bundleView, daysUntil, itemState, lookOf, withTryOn } from './look'

const ent = (sku: string): Entitlement => ({ sku, kind: 'cosmetic', source: 'order', expiresAt: null })
const product = (id: string, over: Partial<Product> = {}): Product => ({ id, kind: 'cosmetic', name: id, description: '', priceBrlCents: 990, priceUsdCents: 299, purchasable: true, ...over })
const NOW = Date.parse('2026-11-01T12:00:00Z')
const later = new Date(NOW + 60_000).toISOString()

describe('try-on in the call (PublicUser.tryOn, "provando")', () => {
  const base = lookOf({ avatarDecoration: 'deco_ha_orbita' })
  it('puts the item over what is equipped while it lasts', () => {
    expect(withTryOn(base, { productId: 'deco_ha_halo_vidro', slot: 'avatarDecoration', expiresAt: later }, NOW)).toEqual({ decoration: 'deco_ha_halo_vidro' })
    expect(withTryOn(base, { productId: 'nameplate_ha_crepusculo', slot: 'nameplate', expiresAt: later }, NOW)).toEqual({ decoration: 'deco_ha_orbita', nameplate: 'nameplate_ha_crepusculo' })
  })
  it('ends by itself and ignores what this client cannot draw or should not show', () => {
    expect(withTryOn(base, { productId: 'deco_ha_halo_vidro', slot: 'avatarDecoration', expiresAt: new Date(NOW - 1).toISOString() }, NOW)).toBe(base)
    expect(withTryOn(base, { productId: 'icon_ha_noite', slot: 'appIcon', expiresAt: later }, NOW)).toBe(base) // private slot
    expect(withTryOn(base, { productId: 'mystery', slot: 'avatarDecoration', expiresAt: later }, NOW)).toBe(base)
    expect(withTryOn(base, { productId: 'nameplate_ha_crepusculo', slot: 'avatarDecoration', expiresAt: later }, NOW)).toBe(base) // wrong slot
    expect(withTryOn(base, undefined, NOW)).toBe(base)
  })
})

describe('store states and bundles', () => {
  it('a closed wave is "soon": visible and wishable, not buyable', () => {
    expect(itemState(product('aura_ha_respiro', { available: false }), [], {}, 'free')).toBe('soon')
    expect(itemState(product('deco_ha_halo_vidro', { available: true }), [], {}, 'free')).toBe('buy')
    expect(itemState(product('deco_coral', { purchasable: false, retired: true }), [], {}, 'free')).toBe('unavailable')
  })
  it('shows the real saving: the items are sold apart at those prices', () => {
    const items = [product('deco_ha_halo_vidro', { priceBrlCents: 1290 }), product('effect_ha_hora_azul', { priceBrlCents: 1690 }), product('nameplate_ha_crepusculo', { priceBrlCents: 790 }), product('aura_ha_respiro', { priceBrlCents: 1290 }), product('frame_ha_cinema', { priceBrlCents: 1290 })]
    const bundle = product('bundle_ha_hora_azul', { kind: 'bundle', priceBrlCents: 4790, items: items.map((p) => p.id) })
    const v = bundleView(bundle, [...items, bundle], [ent('deco_ha_halo_vidro')])
    expect(v.separateCents).toBe(6350)
    expect(v.savingCents).toBe(1560)
    expect(v.owned).toBe(1)
  })
  it('counts whole days left (Casa end notice)', () => {
    expect(daysUntil(new Date(NOW + 4.2 * 86_400_000).toISOString(), NOW)).toBe(5)
    expect(daysUntil(new Date(NOW - 1000).toISOString(), NOW)).toBe(0)
  })
})

// ── Plus app colors: readable, on-palette, never a state color ──
type RGB = [number, number, number]
const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB
const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lum = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const contrast = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}
/** OKLCH-free hue estimate (HSL) is enough to keep the accents out of teal/cyan (H 180–230 in OKLCH ≈ 170–200 HSL). */
const hslHue = ([r, g, b]: RGB) => {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  if (mx === mn) return -1
  const d = mx - mn
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

describe('Plus app colors (accents.ts)', () => {
  const panel = rgb('#0f1011')
  const chrome = rgb('#0b0b0c')
  const white = rgb('#ffffff')
  for (const [id, a] of Object.entries(ACCENTS)) {
    it(`${id}: accent text ≥ 4.5:1 on the panel and the chrome, white ≥ 4.5:1 on the fills`, () => {
      expect(contrast(rgb(a.accent), panel)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(rgb(a.accent), chrome)).toBeGreaterThanOrEqual(4.5)
      for (const f of [a.fill, a.fillHover, a.pressed]) expect(contrast(white, rgb(f))).toBeGreaterThanOrEqual(4.5)
      expect(a.rgb.split(',').map((n) => Number(n.trim()))).toEqual(rgb(a.accent))
    })
    it(`${id}: no teal/cyan, no state green`, () => {
      const h = hslHue(rgb(a.accent))
      expect(h === -1 || h < 140 || h > 205).toBe(true)
    })
  }
})
