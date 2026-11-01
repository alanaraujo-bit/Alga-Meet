import type { Entitlement, Product } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { granted, historyOf, itemState, lookOf, money, skuFor } from './look'

const ent = (sku: string, source: Entitlement['source'] = 'order'): Entitlement => ({ sku, kind: sku.startsWith('plan:') ? 'plan' : 'cosmetic', source, expiresAt: null })
const product = (id: string, over: Partial<Product> = {}): Product => ({
  id, kind: 'cosmetic', name: id, description: '', priceBrlCents: 990, priceUsdCents: 299, purchasable: true, ...over,
})

describe('cosmetic look (equipped on the server: PublicUser.cosmetics)', () => {
  it('maps server slots to what this client draws, skipping unknown SKUs and wrong slots', () => {
    expect(lookOf({ avatarDecoration: 'deco_ha_halo_vidro', profileTheme: 'theme_ha_noite_indigo', profileEffect: 'mystery_item', nameplate: 'deco_ha_halo_vidro' })).toEqual({
      decoration: 'deco_ha_halo_vidro',
      theme: 'theme_ha_noite_indigo',
    })
    expect(lookOf(undefined)).toEqual({})
    expect(lookOf({})).toEqual({})
  })

  it('tells the shop how to present each item', () => {
    const items = [ent('deco_ha_orbita'), ent('deco_ha_halo_vidro'), ent('icon_ha_noite', 'subscription')]
    const look = lookOf({ avatarDecoration: 'deco_ha_halo_vidro' })
    expect(itemState(product('deco_ha_halo_vidro'), items, look, 'plus')).toBe('in_use')
    expect(itemState(product('deco_ha_orbita'), items, look, 'plus')).toBe('owned')
    expect(itemState(product('effect_ha_poeira_luz'), items, look, 'plus')).toBe('buy')
    const plusOnly = product('icon_ha_noite', { priceBrlCents: 0, purchasable: false, includedIn: ['plus'] })
    expect(itemState(plusOnly, [], look, 'free')).toBe('plus_only')
    // Lent by the plan and not equipped: "Alga Plus", equipped: in use like anything else.
    expect(itemState(plusOnly, items, look, 'plus')).toBe('included')
    expect(itemState(plusOnly, items, lookOf({ appIcon: 'icon_ha_noite' }), 'plus')).toBe('in_use')
    expect(itemState(product('retired', { purchasable: false }), items, look, 'free')).toBe('unavailable')
  })
})

describe('purchases', () => {
  it('detects what an ENTITLEMENTS_UPDATE granted, and which SKU a checkout should produce', () => {
    expect(granted([ent('deco_ha_halo_vidro')], [ent('deco_ha_halo_vidro'), ent('plan:plus', 'subscription')])).toEqual(['plan:plus'])
    expect(granted([ent('deco_ha_halo_vidro')], [])).toEqual([])
    expect(skuFor({ id: 'plus_yearly', kind: 'plan', planId: 'plus' })).toBe('plan:plus')
    expect(skuFor({ id: 'deco_ha_halo_vidro', kind: 'cosmetic' })).toBe('deco_ha_halo_vidro')
  })

  it('merges subscriptions and orders into one history, newest first', () => {
    const base = { amountCents: 1490, currency: 'BRL' as const, provider: 'sandbox' as const, sandbox: true }
    const rows = historyOf({
      subscriptions: [{ ...base, id: 's1', productId: 'plus_monthly', planId: 'plus', status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false, createdAt: '2026-11-01T10:00:00Z' }],
      orders: [
        { ...base, id: 'o2', productId: 'deco_ha_halo_vidro', status: 'paid', createdAt: '2026-11-01T12:00:00Z' },
        { ...base, id: 'o1', productId: 'nameplate_ha_crepusculo', status: 'canceled', createdAt: '2026-10-31T09:00:00Z' },
      ],
    })
    expect(rows.map((r) => [r.id, r.kind])).toEqual([['o2', 'order'], ['s1', 'subscription'], ['o1', 'order']])
  })

  it('formats BRL the Brazilian way', () => {
    expect(money(1490).replace(/\s/g, ' ')).toBe('R$ 14,90')
    expect(money(14900).replace(/\s/g, ' ')).toBe('R$ 149,00')
  })
})
