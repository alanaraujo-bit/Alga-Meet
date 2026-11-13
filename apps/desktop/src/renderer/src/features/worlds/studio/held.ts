// What the account holds of the worlds catalog, and what the rest costs. Ownership and prices are the billing
// feature's (the same entitlements and catalog as every other cosmetic): nothing here grants or prices anything.
import { holdsWorldSku, worldEntry, type Entitlement, type Product, type WorldEntry } from '@alga/shared'
import { useMemo } from 'react'
import { useBilling } from '../../billing/store'

export type SkuState =
  | { kind: 'held' }
  /** Sold: `product` is what checkout takes. `available` false = not on sale right now. */
  | { kind: 'buy'; product: Product; available: boolean }
  /** Comes with Alga Plus, not sold by itself. */
  | { kind: 'plus' }
  /** A paid piece whose price the server has not said (billing still loading, or an older server). */
  | { kind: 'unknown' }

/** SKUs of entitlements that are valid now. */
export function heldSet(items: readonly Entitlement[] | undefined, now = Date.now()): Set<string> {
  const s = new Set<string>()
  for (const i of items ?? []) if (!i.expiresAt || Date.parse(i.expiresAt) > now) s.add(i.sku)
  return s
}

export function skuState(sku: string, held: ReadonlySet<string>, products: readonly Product[] | undefined): SkuState {
  if (holdsWorldSku(sku, held)) return { kind: 'held' }
  const e = worldEntry(sku)
  if (e?.tier === 'plus') return { kind: 'plus' }
  const product = products?.find((p) => p.id === sku)
  return product ? { kind: 'buy', product, available: product.available !== false && product.purchasable } : { kind: 'unknown' }
}

export function useHeld(): { held: Set<string>; products: readonly Product[] | undefined; state: (sku: string) => SkuState; ready: boolean } {
  const items = useBilling((st) => st.me?.items)
  const products = useBilling((st) => st.catalog?.products)
  return useMemo(() => {
    const held = heldSet(items)
    return { held, products, state: (sku: string) => skuState(sku, held, products), ready: !!items && !!products }
  }, [items, products])
}

/** The first thing in `skus` the account does not hold, with its entry. */
export function firstMissing(skus: readonly string[], held: ReadonlySet<string>): WorldEntry | null {
  for (const sku of skus) {
    if (holdsWorldSku(sku, held)) continue
    const e = worldEntry(sku)
    if (e) return e
  }
  return null
}
