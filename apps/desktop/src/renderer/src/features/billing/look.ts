import type { BillingMe, CosmeticType, Entitlement, Order, Product, Subscription } from '@alga/shared'

/** Where a cosmetic shows on a profile. One item per slot. */
export type Slot = 'decoration' | 'theme' | 'effect' | 'nameplate'
export const SLOT_OF: Record<CosmeticType, Slot> = { avatar_decoration: 'decoration', profile_theme: 'theme', profile_effect: 'effect', nameplate: 'nameplate' }

/** Catalog SKUs this client can draw (apps/server/src/billing/catalog.ts). An SKU without a renderer is ignored. */
export const COSMETICS = {
  deco_folha_de_alga: 'decoration',
  deco_coral: 'decoration',
  theme_noite_paulistana: 'theme',
  theme_plus_mare: 'theme',
  effect_bioluminescencia: 'effect',
  nameplate_cardume: 'nameplate',
  nameplate_plus_correnteza: 'nameplate',
} as const satisfies Record<string, Slot>
export type CosmeticId = keyof typeof COSMETICS
export const isCosmeticId = (id: string): id is CosmeticId => Object.hasOwn(COSMETICS, id)

/** What a profile wears: at most one item per slot. */
export type Look = Partial<Record<Slot, CosmeticId>>

/**
 * The server has no equip route yet, so the look is derived: per slot, an item you bought beats one the plan lends
 * you, and among bought items the newest purchase wins. Orders come newest first (GET /billing/me).
 */
export function lookFrom(items: readonly Entitlement[], orders: readonly Pick<Order, 'productId' | 'status'>[]): Look {
  const paidRank = (id: string) => {
    const i = orders.findIndex((o) => o.productId === id && o.status === 'paid')
    return i < 0 ? Infinity : i
  }
  const owned = items
    .filter((e) => e.kind === 'cosmetic' && isCosmeticId(e.sku))
    .map((e) => ({ id: e.sku as CosmeticId, rank: e.source === 'order' ? paidRank(e.sku) : Infinity, bought: e.source === 'order' }))
    .sort((a, b) => Number(b.bought) - Number(a.bought) || a.rank - b.rank)
  const look: Look = {}
  for (const x of owned) look[COSMETICS[x.id]] ??= x.id
  return look
}

export type ItemState = 'in_use' | 'owned' | 'included' | 'plus_only' | 'buy' | 'unavailable'

/** How the shop presents one cosmetic to this user. */
export function itemState(p: Product, items: readonly Entitlement[], look: Look, planId: string): ItemState {
  const has = items.some((e) => e.sku === p.id)
  if (has) return isCosmeticId(p.id) && look[COSMETICS[p.id]] === p.id ? 'in_use' : 'owned'
  if (p.includedIn?.includes(planId as never)) return 'included'
  if (p.purchasable) return 'buy'
  return p.includedIn?.length ? 'plus_only' : 'unavailable'
}

/** One line of purchase history (subscriptions and one-time orders together), newest first. */
export interface HistoryRow {
  id: string
  productId: string
  kind: 'subscription' | 'order'
  status: Subscription['status'] | Order['status']
  amountCents: number
  currency: 'BRL' | 'USD'
  sandbox: boolean
  createdAt: string
}
export function historyOf(me: Pick<BillingMe, 'subscriptions' | 'orders'>): HistoryRow[] {
  const rows: HistoryRow[] = [
    ...me.subscriptions.map((s) => ({ id: s.id, productId: s.productId, kind: 'subscription' as const, status: s.status, amountCents: s.amountCents, currency: s.currency, sandbox: s.sandbox, createdAt: s.createdAt })),
    ...me.orders.map((o) => ({ id: o.id, productId: o.productId, kind: 'order' as const, status: o.status, amountCents: o.amountCents, currency: o.currency, sandbox: o.sandbox, createdAt: o.createdAt })),
  ]
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

/** SKUs that are new in `next` compared with `prev` (what a purchase just granted). */
export const granted = (prev: readonly Entitlement[], next: readonly Entitlement[]): string[] =>
  next.filter((e) => !prev.some((p) => p.sku === e.sku)).map((e) => e.sku)

/** The entitlement a checkout of `productId` should produce: the plan for plan products, the item for cosmetics. */
export const skuFor = (p: Pick<Product, 'id' | 'kind' | 'planId'>): string => (p.kind === 'plan' ? `plan:${p.planId}` : p.id)

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' })
export const money = (cents: number, currency: 'BRL' | 'USD' = 'BRL'): string => (currency === 'BRL' ? brl : usd).format(cents / 100)
