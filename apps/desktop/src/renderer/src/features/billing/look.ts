import type { BillingMe, CosmeticSlot, Entitlement, EquippedCosmetics, Order, Product, Subscription } from '@alga/shared'

/** Where a cosmetic shows on a profile. One item per slot. */
export type Slot = 'decoration' | 'theme' | 'effect' | 'nameplate'
export const SLOTS: Slot[] = ['decoration', 'theme', 'effect', 'nameplate']
/** The server's name for each slot (COSMETIC_SLOTS, PublicUser.cosmetics, PUT /users/@me/cosmetics). */
export const SLOT_KEY: Record<Slot, CosmeticSlot> = { decoration: 'avatarDecoration', theme: 'profileTheme', effect: 'profileEffect', nameplate: 'nameplate' }

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

/** The look of what someone equipped (PublicUser.cosmetics). Unknown SKUs or an item in the wrong slot are skipped. */
export function lookOf(equipped: EquippedCosmetics | undefined): Look {
  const look: Look = {}
  for (const slot of SLOTS) {
    const id = equipped?.[SLOT_KEY[slot]]
    if (id && isCosmeticId(id) && COSMETICS[id] === slot) look[slot] = id
  }
  return look
}

export type ItemState = 'in_use' | 'owned' | 'included' | 'plus_only' | 'buy' | 'unavailable'

/** How the shop presents one cosmetic to this user. `look` = what is equipped right now (server). */
export function itemState(p: Product, items: readonly Entitlement[], look: Look, planId: string): ItemState {
  const ent = items.find((e) => e.sku === p.id)
  if (ent) return isCosmeticId(p.id) && look[COSMETICS[p.id]] === p.id ? 'in_use' : ent.source === 'subscription' ? 'included' : 'owned'
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
