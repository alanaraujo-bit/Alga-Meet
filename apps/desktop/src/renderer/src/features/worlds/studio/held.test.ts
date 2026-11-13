import type { Entitlement, Product } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import { firstMissing, heldSet, skuState } from './held'

const NOW = Date.parse('2026-11-13T12:00:00Z')
const ent = (sku: string, expiresAt: string | null = null): Entitlement => ({ sku, kind: 'cosmetic', source: 'order', expiresAt })
const product = (id: string, over: Partial<Product> = {}): Product => ({
  id, kind: 'cosmetic', name: id, description: '', priceBrlCents: 990, priceUsdCents: 199, purchasable: true, available: true, world: true, ...over,
})

describe('what the account holds of the worlds catalog', () => {
  it('counts an entitlement only while it is valid', () => {
    const held = heldSet([ent('w_poltrona_lounge'), ent('a_perola', '2026-12-01T00:00:00Z'), ent('w_xadrez', '2026-11-01T00:00:00Z')], NOW)
    expect([...held].sort()).toEqual(['a_perola', 'w_poltrona_lounge'])
    expect(heldSet(undefined).size).toBe(0)
  })

  it('says what each piece is to this account: its own, to buy, with Plus, or not known yet', () => {
    const held = new Set(['w_poltrona_lounge'])
    const products = [product('w_sofa_canto', { priceBrlCents: 1290 }), product('w_xadrez', { available: false })]
    // Base pieces are everyone's, whatever the entitlements say.
    expect(skuState('w_sofa_trio', new Set(), products)).toEqual({ kind: 'held' })
    expect(skuState('w_poltrona_lounge', held, products)).toEqual({ kind: 'held' })
    expect(skuState('w_sofa_canto', held, products)).toMatchObject({ kind: 'buy', available: true, product: { priceBrlCents: 1290 } })
    expect(skuState('w_xadrez', held, products)).toMatchObject({ kind: 'buy', available: false })
    expect(skuState('a_perola', held, products)).toEqual({ kind: 'plus' })
    // The billing catalog has not arrived (or an older server): never shown as free.
    expect(skuState('w_sofa_canto', held, undefined)).toEqual({ kind: 'unknown' })
  })

  it('finds the first thing in a room or on a figure that is not the account\'s', () => {
    const held = new Set(['w_poltrona_lounge'])
    expect(firstMissing(['w_sofa_trio', 'f_carvalho', 'w_poltrona_lounge'], held)).toBeNull()
    expect(firstMissing(['w_sofa_trio', 'f_pedra', 'w_sofa_canto'], held)?.sku).toBe('f_pedra')
    expect(firstMissing(['nope'], held)).toBeNull()
  })
})
