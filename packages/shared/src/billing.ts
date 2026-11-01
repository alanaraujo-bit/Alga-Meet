import { z } from 'zod'

/**
 * Billing and entitlements contract (routes documented in api.ts). Payments are confirmed only by the provider
 * (verified webhook or provider API re-fetch), never by a client call. Strategy: docs/business/monetization.md.
 */

/**
 * Screen-share presets: the top simulcast layer a user may publish. `height` is the short side of the captured
 * area (ultrawide and portrait screens are scaled so their short side fits), `maxBitrateKbps` the encoder ceiling.
 * D11: free = 720p30, 720p60 and 1080p30; paid adds 1080p60, 1440p60 and 2160p30 (4K30). Voice is never a paid perk (D12).
 */
export const STREAM_PRESETS = {
  '720p30': { height: 720, fps: 30, maxBitrateKbps: 2_000 },
  '720p60': { height: 720, fps: 60, maxBitrateKbps: 3_000 },
  '1080p30': { height: 1080, fps: 30, maxBitrateKbps: 5_000 },
  '1080p60': { height: 1080, fps: 60, maxBitrateKbps: 8_000 },
  '1440p60': { height: 1440, fps: 60, maxBitrateKbps: 12_000 },
  '2160p30': { height: 2160, fps: 30, maxBitrateKbps: 16_000 },
} as const
export type StreamPreset = keyof typeof STREAM_PRESETS

/** LiveKit participant attribute (set by the server in the join token; clients cannot change it) with the allowed presets, comma-separated. */
export const STREAM_PRESETS_ATTRIBUTE = 'alga.stream_presets'

export type PlanId = 'free' | 'plus'

export interface PlanFeatures {
  /** Presets this plan may publish; the media engine picks one of these (see STREAM_PRESETS for each one's limits). */
  streamPresets: StreamPreset[]
  /** Per-file attachment cap enforced by the server (413 above it). */
  maxAttachmentBytes: number
}

/** The user's current plan as sent in Me.plan, GET /billing/me and ENTITLEMENTS_UPDATE. */
export interface PlanSummary extends PlanFeatures {
  id: PlanId
  name: string
}

export type CosmeticType = 'avatar_decoration' | 'profile_theme' | 'profile_effect' | 'nameplate'

/** Profile slot of each cosmetic type: one equipped item per slot (PublicUser.cosmetics, PUT /users/@me/cosmetics). */
export const COSMETIC_SLOTS = {
  avatar_decoration: 'avatarDecoration',
  profile_theme: 'profileTheme',
  profile_effect: 'profileEffect',
  nameplate: 'nameplate',
} as const satisfies Record<CosmeticType, string>
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[CosmeticType]

/** Equipped cosmetic product ids (catalog SKUs) by slot. A missing slot = nothing equipped there. */
export type EquippedCosmetics = Partial<Record<CosmeticSlot, string>>

const equipSlot = z.string().trim().min(1).max(64).nullable().optional()
/**
 * PUT /users/@me/cosmetics: per slot, a product id to equip (owned, or included in the current plan) or null to
 * unequip; slots left out keep their item. Unknown slots are a 400.
 */
export const PutCosmeticsBody = z.strictObject({
  avatarDecoration: equipSlot,
  profileTheme: equipSlot,
  profileEffect: equipSlot,
  nameplate: equipSlot,
}) satisfies z.ZodType<Partial<Record<CosmeticSlot, string | null>>>
export type PutCosmeticsBody = z.infer<typeof PutCosmeticsBody>

export interface Product {
  /** Stable SKU from the server catalog (apps/server/src/billing/catalog.ts). */
  id: string
  kind: 'plan' | 'cosmetic'
  name: string
  description: string
  /** Prices in cents. Checkout charges BRL for now; USD is shown for reference until a USD-capable provider exists. */
  priceBrlCents: number
  priceUsdCents: number
  /** Plan products only. */
  planId?: PlanId
  interval?: 'month' | 'year'
  /** Cosmetics only. */
  cosmeticType?: CosmeticType
  /** Plans whose subscribers can use this cosmetic while subscribed, without buying it. */
  includedIn?: PlanId[]
  /** false: only available through a plan (`includedIn`), not sold separately. */
  purchasable: boolean
}

export type BillingProviderId = 'sandbox' | 'mercadopago'

export interface BillingProviderInfo {
  id: BillingProviderId
  /** true = test provider: nothing is charged. Never true in production (the server refuses to start). */
  sandbox: boolean
}

export interface BillingCatalog {
  version: number
  /** null when payments are disabled on this server (checkout answers 503). */
  provider: BillingProviderInfo | null
  /** Every plan with its features (free included), for comparison screens. */
  plans: PlanSummary[]
  products: Product[]
}

/**
 * pending = checkout created, not paid (grants nothing; expires after 24 h). active = paid; with cancelAtPeriodEnd
 * it ends at currentPeriodEnd. past_due = a renewal failed; perks continue for a short grace period. canceled =
 * ended early (refund/chargeback). expired = the period ended without renewal.
 */
export type SubscriptionStatus = 'pending' | 'active' | 'past_due' | 'canceled' | 'expired'

export interface Subscription {
  id: string
  productId: string
  planId: PlanId
  status: SubscriptionStatus
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  amountCents: number
  currency: 'BRL' | 'USD'
  provider: BillingProviderId
  /** Made with the sandbox provider: nothing was charged. */
  sandbox: boolean
  createdAt: string
}

/** pending → paid → refunded; pending → canceled (declined) / expired (abandoned after 24 h). */
export type OrderStatus = 'pending' | 'paid' | 'refunded' | 'canceled' | 'expired'

/** One-time purchase (cosmetics). */
export interface Order {
  id: string
  productId: string
  status: OrderStatus
  amountCents: number
  currency: 'BRL' | 'USD'
  provider: BillingProviderId
  sandbox: boolean
  createdAt: string
}

/** Something the user can use right now. Derived by the server from subscriptions and paid orders. */
export interface Entitlement {
  /** `plan:<planId>` or a cosmetic product id. */
  sku: string
  kind: 'plan' | 'cosmetic'
  source: 'subscription' | 'order'
  /** null = owned for good (bought); otherwise usable until then. */
  expiresAt: string | null
}

/** ENTITLEMENTS_UPDATE payload. */
export interface Entitlements {
  plan: PlanSummary
  items: Entitlement[]
}

export interface BillingMe extends Entitlements {
  /** The subscription that grants (or last granted) the plan; null if the user never subscribed. */
  subscription: Subscription | null
  /** Newest first, pending ones included. */
  subscriptions: Subscription[]
  orders: Order[]
}

export const CheckoutBody = z.object({ productId: z.string().trim().min(1).max(64) })
export type CheckoutBody = z.infer<typeof CheckoutBody>

export interface CheckoutResponse {
  /** Provider page to open in the browser; the result arrives later as ENTITLEMENTS_UPDATE. */
  url: string
  /** Subscription or order id. */
  reference: string
  kind: 'subscription' | 'order'
  provider: BillingProviderId
  sandbox: boolean
}
