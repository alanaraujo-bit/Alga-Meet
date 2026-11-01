import type { Entitlement, Order, Product } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { granted, historyOf, itemState, lookFrom, money, skuFor } from './look'

const ent = (sku: string, source: Entitlement['source'] = 'order'): Entitlement => ({ sku, kind: sku.startsWith('plan:') ? 'plan' : 'cosmetic', source, expiresAt: null })
const paid = (productId: string): Pick<Order, 'productId' | 'status'> => ({ productId, status: 'paid' })
const product = (id: string, over: Partial<Product> = {}): Product => ({
  id, kind: 'cosmetic', name: id, description: '', priceBrlCents: 990, priceUsdCents: 299, purchasable: true, ...over,
})

describe('cosmetic look (no equip route: derived)', () => {
  it('puts one item per slot and ignores SKUs without a renderer', () => {
    expect(lookFrom([ent('plan:plus', 'subscription'), ent('deco_coral'), ent('theme_noite_paulistana'), ent('mystery_item')], [paid('theme_noite_paulistana'), paid('deco_coral')])).toEqual({
      decoration: 'deco_coral',
      theme: 'theme_noite_paulistana',
    })
  })

  it('newest purchase wins within a slot (orders are newest first)', () => {
    const items = [ent('deco_folha_de_alga'), ent('deco_coral')]
    expect(lookFrom(items, [paid('deco_coral'), paid('deco_folha_de_alga')]).decoration).toBe('deco_coral')
    expect(lookFrom(items, [paid('deco_folha_de_alga'), paid('deco_coral')]).decoration).toBe('deco_folha_de_alga')
  })

  it('a bought item beats one the plan lends, which still fills an empty slot', () => {
    const items = [ent('theme_plus_mare', 'subscription'), ent('nameplate_plus_correnteza', 'subscription'), ent('theme_noite_paulistana')]
    expect(lookFrom(items, [paid('theme_noite_paulistana')])).toEqual({ theme: 'theme_noite_paulistana', nameplate: 'nameplate_plus_correnteza' })
  })

  it('tells the shop how to present each item', () => {
    const items = [ent('deco_folha_de_alga'), ent('deco_coral')]
    const look = lookFrom(items, [paid('deco_coral'), paid('deco_folha_de_alga')])
    expect(itemState(product('deco_coral'), items, look, 'free')).toBe('in_use')
    expect(itemState(product('deco_folha_de_alga'), items, look, 'free')).toBe('owned')
    expect(itemState(product('effect_bioluminescencia'), items, look, 'free')).toBe('buy')
    const plusOnly = product('theme_plus_mare', { priceBrlCents: 0, purchasable: false, includedIn: ['plus'] })
    expect(itemState(plusOnly, items, look, 'free')).toBe('plus_only')
    expect(itemState(plusOnly, items, look, 'plus')).toBe('included')
    expect(itemState(product('retired', { purchasable: false }), items, look, 'free')).toBe('unavailable')
  })
})

describe('purchases', () => {
  it('detects what an ENTITLEMENTS_UPDATE granted, and which SKU a checkout should produce', () => {
    expect(granted([ent('deco_coral')], [ent('deco_coral'), ent('plan:plus', 'subscription')])).toEqual(['plan:plus'])
    expect(granted([ent('deco_coral')], [])).toEqual([])
    expect(skuFor({ id: 'plus_yearly', kind: 'plan', planId: 'plus' })).toBe('plan:plus')
    expect(skuFor({ id: 'deco_coral', kind: 'cosmetic' })).toBe('deco_coral')
  })

  it('merges subscriptions and orders into one history, newest first', () => {
    const base = { amountCents: 1490, currency: 'BRL' as const, provider: 'sandbox' as const, sandbox: true }
    const rows = historyOf({
      subscriptions: [{ ...base, id: 's1', productId: 'plus_monthly', planId: 'plus', status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false, createdAt: '2026-11-01T10:00:00Z' }],
      orders: [
        { ...base, id: 'o2', productId: 'deco_coral', status: 'paid', createdAt: '2026-11-01T12:00:00Z' },
        { ...base, id: 'o1', productId: 'nameplate_cardume', status: 'canceled', createdAt: '2026-10-31T09:00:00Z' },
      ],
    })
    expect(rows.map((r) => [r.id, r.kind])).toEqual([['o2', 'order'], ['s1', 'subscription'], ['o1', 'order']])
  })

  it('formats BRL the Brazilian way', () => {
    expect(money(1490).replace(/\s/g, ' ')).toBe('R$ 14,90')
    expect(money(14900).replace(/\s/g, ' ')).toBe('R$ 149,00')
  })
})
