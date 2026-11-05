import { PRIVATE_COSMETIC_SLOTS, type BillingMe, type CosmeticSlot, type Entitlement, type Order, type Product, type Subscription, type TryOn } from '@alga/shared'
import { HORA_AZUL, type CosmeticId, type Slot } from './hora-azul'

export type { CosmeticId, Slot }
/** Where a cosmetic shows. One item per slot; profile slots first (the shop's shelf order). */
export const SLOTS: Slot[] = ['decoration', 'nameplate', 'effect', 'theme', 'aura', 'frame', 'reactions', 'sound', 'icon']
/**
 * The server's name for each slot (COSMETIC_SLOTS, PublicUser.cosmetics, PUT /users/@me/cosmetics). appIcon only ever
 * comes in Me, never in PublicUser. appAccent (Plus app colors) has no renderer here: it recolors the whole UI.
 */
export const SLOT_KEY: Record<Slot, CosmeticSlot> = {
  decoration: 'avatarDecoration',
  theme: 'profileTheme',
  effect: 'profileEffect',
  nameplate: 'nameplate',
  aura: 'voiceAura',
  sound: 'entranceSound',
  reactions: 'callReactions',
  frame: 'streamFrame',
  icon: 'appIcon',
}

/** Catalog SKUs this client can draw (hora-azul.ts). An SKU without a renderer is ignored. */
export const COSMETICS = Object.fromEntries(Object.entries(HORA_AZUL).map(([id, m]) => [id, m.slot])) as Record<CosmeticId, Slot>
export const isCosmeticId = (id: string): id is CosmeticId => Object.hasOwn(COSMETICS, id)

/** What a profile wears: at most one item per slot. */
export type Look = Partial<Record<Slot, CosmeticId>>

/**
 * The look of what someone equipped (PublicUser.cosmetics, keyed by server slot name). Unknown SKUs, unknown slots
 * and an item in the wrong slot are skipped, so an older client simply draws less.
 */
export function lookOf(equipped: Readonly<Record<string, string | undefined>> | undefined): Look {
  const look: Look = {}
  for (const slot of SLOTS) {
    const id = equipped?.[SLOT_KEY[slot]]
    if (id && isCosmeticId(id) && COSMETICS[id] === slot) look[slot] = id
  }
  return look
}

/** `soon` = sold, but its wave has not opened yet (Product.available false): see it, try it on the profile, wish it. */
export type ItemState = 'in_use' | 'owned' | 'included' | 'plus_only' | 'buy' | 'soon' | 'unavailable'

/** How the shop presents one cosmetic to this user. `look` = what is equipped right now (server). */
export function itemState(p: Product, items: readonly Entitlement[], look: Look, planId: string): ItemState {
  const ent = items.find((e) => e.sku === p.id)
  if (ent) return isCosmeticId(p.id) && look[COSMETICS[p.id]] === p.id ? 'in_use' : ent.source === 'subscription' ? 'included' : 'owned'
  if (p.includedIn?.includes(planId as never)) return 'included'
  if (p.purchasable && !p.retired) return p.available === false ? 'soon' : 'buy'
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

/**
 * The look with a try-on on top (PublicUser.tryOn, "provando"): only while it lasts, only a public slot this client
 * draws, only an item made for that slot. Anything else leaves the look as it was.
 */
export function withTryOn(look: Look, tryOn: TryOn | undefined, now = Date.now()): Look {
  if (!tryOn || Date.parse(tryOn.expiresAt) <= now || PRIVATE_COSMETIC_SLOTS.includes(tryOn.slot)) return look
  const slot = SLOTS.find((s) => SLOT_KEY[s] === tryOn.slot)
  if (!slot || !isCosmeticId(tryOn.productId) || COSMETICS[tryOn.productId] !== slot) return look
  return { ...look, [slot]: tryOn.productId }
}

/** A bundle as the store shows it: what it holds, what those cost apart, and what you already have of it. */
export interface BundleView {
  items: Product[]
  /** List price of the items bought one by one (they are all sold apart at these prices: the saving is real). */
  separateCents: number
  savingCents: number
  owned: number
}
export function bundleView(bundle: Product, products: readonly Product[], owned: readonly Entitlement[]): BundleView {
  const items = (bundle.items ?? []).map((id) => products.find((p) => p.id === id)).filter((p): p is Product => !!p)
  const separateCents = items.reduce((t, p) => t + p.priceBrlCents, 0)
  return { items, separateCents, savingCents: Math.max(0, separateCents - bundle.priceBrlCents), owned: items.filter((p) => owned.some((e) => e.sku === p.id)).length }
}

/** Whole days until `iso` from `now`, rounded up (0 = today or past). */
export const daysUntil = (iso: string, now = Date.now()) => Math.max(0, Math.ceil((Date.parse(iso) - now) / 86_400_000))

/** SKUs that are new in `next` compared with `prev` (what a purchase just granted). */
export const granted = (prev: readonly Entitlement[], next: readonly Entitlement[]): string[] =>
  next.filter((e) => !prev.some((p) => p.sku === e.sku)).map((e) => e.sku)

/** The entitlement a checkout of `productId` should produce: the plan for plan products, the item for cosmetics. */
export const skuFor = (p: Pick<Product, 'id' | 'kind' | 'planId'>): string => (p.kind === 'plan' ? `plan:${p.planId}` : p.id)

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' })
export const money = (cents: number, currency: 'BRL' | 'USD' = 'BRL'): string => (currency === 'BRL' ? brl : usd).format(cents / 100)
