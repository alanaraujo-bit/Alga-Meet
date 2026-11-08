import { z } from 'zod'
import type { PublicUser } from './models.js'

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

/**
 * Plus v2 perks (docs/business/growth-plan.md §2.2) a client turns on for the plan. wardrobe = the plan-included
 * cosmetics (Product.includedIn, growing by Product.includedFrom); tenure_badge = PublicUser.plusBadge;
 * animated_banner = a profile banner may animate (the static one is free); app_accents = the `appAccent` items;
 * annual_item = POST /billing/plus/annual-item (annual products only); friend_passes = POST /billing/passes.
 */
export type PlanPerk =
  | 'hd_streaming' | 'large_attachments' | 'wardrobe' | 'tenure_badge' | 'animated_banner' | 'app_accents'
  | 'priority_support' | 'annual_item' | 'friend_passes'

/** The user's current plan as sent in Me.plan, GET /billing/me and ENTITLEMENTS_UPDATE. */
export interface PlanSummary extends PlanFeatures {
  id: PlanId
  name: string
  /** Always sent by the server (empty for free); optional only so existing PlanSummary literals keep compiling. */
  perks?: PlanPerk[]
}

export type CosmeticType =
  | 'avatar_decoration' | 'profile_theme' | 'profile_effect' | 'nameplate'
  | 'voice_aura' | 'entrance_sound' | 'call_reactions' | 'stream_frame' | 'app_icon' | 'app_accent'

/** Profile slot of each cosmetic type: one equipped item per slot (PublicUser.cosmetics, PUT /users/@me/cosmetics). */
export const COSMETIC_SLOTS = {
  avatar_decoration: 'avatarDecoration',
  profile_theme: 'profileTheme',
  profile_effect: 'profileEffect',
  nameplate: 'nameplate',
  voice_aura: 'voiceAura',
  entrance_sound: 'entranceSound',
  call_reactions: 'callReactions',
  stream_frame: 'streamFrame',
  app_icon: 'appIcon',
  app_accent: 'appAccent',
} as const satisfies Record<CosmeticType, string>
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[CosmeticType]

/**
 * Slots only the user sees (their own app icon and accent color): in Me.cosmetics, never in PublicUser.cosmetics,
 * USER_UPDATE or a try-on.
 */
export const PRIVATE_COSMETIC_SLOTS: readonly CosmeticSlot[] = ['appIcon', 'appAccent']

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
  voiceAura: equipSlot,
  entranceSound: equipSlot,
  callReactions: equipSlot,
  streamFrame: equipSlot,
  appIcon: equipSlot,
  appAccent: equipSlot,
}) satisfies z.ZodType<Partial<Record<CosmeticSlot, string | null>>>
export type PutCosmeticsBody = z.infer<typeof PutCosmeticsBody>

export type ProductKind = 'plan' | 'cosmetic' | 'bundle' | 'space_upgrade'

export interface Product {
  /** Stable SKU from the server catalog (apps/server/src/billing/catalog.ts). */
  id: string
  /** plan = Alga Plus; cosmetic = one item; bundle = several items of a collection; space_upgrade = a Casa contribution. */
  kind: ProductKind
  name: string
  description: string
  /** Prices in cents. Checkout charges BRL for now; USD is shown for reference until a USD-capable provider exists. */
  priceBrlCents: number
  priceUsdCents: number
  /** Plan products only. */
  planId?: PlanId
  interval?: 'month' | 'year'
  /**
   * Plan products: 'recurring' renews (card, provider subscription); 'one_time' = one paid period with no renewal
   * (Pix or card; also what a Plus gift buys). Omitted = 'recurring'.
   */
  billing?: 'recurring' | 'one_time'
  /** Cosmetics only. */
  cosmeticType?: CosmeticType
  /** Plans whose subscribers can use this cosmetic while subscribed, without buying it. */
  includedIn?: PlanId[]
  /** `includedIn` applies from this instant on (the Plus wardrobe grows by one item a month). Omitted = always. */
  includedFrom?: string
  /** false: only available through a plan (`includedIn`), not sold separately. */
  purchasable: boolean
  /** Cosmetics and bundles of a collection (BillingCatalog.collections) and the wave they belong to. */
  collectionId?: string
  wave?: number
  /** One of the collection's hero items. */
  hero?: boolean
  /**
   * Can be bought right now: purchasable, not retired and its wave is open (every item's wave, for a bundle). Always
   * sent by the server.
   */
  available?: boolean
  /** Retired catalog item (catalog v1 "oceano"): never sold again, still equippable by whoever owns it. */
  retired?: boolean
  /** Can be bought as a gift (POST /billing/gifts). */
  giftable?: boolean
  /**
   * Bundles: the cosmetic ids it contains. priceBrlCents is for all of them; if you own some, you pay
   * price × (value missing ÷ value of all), rounded down to ,90 (GET /billing/quote).
   */
  items?: string[]
  /** space_upgrade: days this contribution adds to the space's Casa. */
  days?: number
}

/** A wave of a collection. Nothing ever leaves the store: a wave only opens (opensAt null = not scheduled yet). */
export interface CollectionWave {
  wave: number
  opensAt: string | null
  open: boolean
}

export interface Collection {
  id: string
  name: string
  description: string
  waves: CollectionWave[]
}

export type BillingProviderId = 'sandbox' | 'mercadopago' | 'stripe'

export interface BillingProviderInfo {
  id: BillingProviderId
  /** true = test provider: nothing is charged. Never true in production (the server refuses to start). */
  sandbox: boolean
  /**
   * The app can pay inside its own checkout (POST /billing/pay): card fields from GET /billing/card-frame and Pix
   * QR codes. Absent = only the provider page (CheckoutResponse.url).
   */
  inApp?: boolean
}

export interface BillingCatalog {
  version: number
  /** null when payments are disabled on this server (checkout answers 503). */
  provider: BillingProviderInfo | null
  /** Every plan with its features (free included), for comparison screens. */
  plans: PlanSummary[]
  products: Product[]
  /** Always sent by the server (catalog v2+). */
  collections?: Collection[]
  /** What a Casa gives the space (space_upgrade products are the contributions). Always sent by the server. */
  spaceUpgrade?: { perks: SpaceUpgradePerk[]; tones: SpaceTone[] }
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
  /**
   * renewing = card subscription at the provider; period = a one-time paid period (Plus on Pix, a Plus gift; never
   * renews, cancel/resume do not apply); pass = a free 7-day Plus pass from a friend. Always sent by the server.
   */
  kind?: 'renewing' | 'period' | 'pass'
  /** When its paid time started (first activation; a stacked period may start in the future). */
  startedAt?: string | null
  /** renewing only: until when POST /billing/subscription/refund refunds the first charge (7 days); else null. */
  refundableUntil?: string | null
  /** A refund was asked for; the provider's confirmation ends the plan (status canceled). */
  refundRequestedAt?: string | null
}

/** pending → paid → refunded; pending → canceled (declined) / expired (abandoned after 24 h). */
export type OrderStatus = 'pending' | 'paid' | 'refunded' | 'canceled' | 'expired'

/** One-time purchase: cosmetics, bundles, one-time Plus periods, gifts, Casa contributions, the annual item. */
export interface Order {
  id: string
  productId: string
  status: OrderStatus
  amountCents: number
  currency: 'BRL' | 'USD'
  provider: BillingProviderId
  sandbox: boolean
  createdAt: string
  /** Cosmetic ids it grants (a bundle: the ones that were missing at checkout). Always sent by the server. */
  items?: string[]
  /** Set when the order pays for a gift (Gift.orderId) or a Casa contribution. */
  giftId?: string | null
  spaceId?: string | null
  paidAt?: string | null
  /** Until when POST /billing/orders/:id/refund is accepted (7 days after payment); null = not refundable. */
  refundableUntil?: string | null
  /** A refund was asked for; the provider's confirmation turns the order `refunded`. */
  refundRequestedAt?: string | null
}

/** Days after the payment in which a purchase can be refunded with no questions (CDC art. 49; Termos 9.5). */
export const REFUND_WINDOW_DAYS = 7

/** Something the user can use right now. Derived by the server from subscriptions and paid orders. */
export interface Entitlement {
  /** `plan:<planId>` or a cosmetic product id. */
  sku: string
  kind: 'plan' | 'cosmetic'
  /** grant = retired (the founder rule was removed); old rows are revoked by the server's first sweep. */
  source: 'subscription' | 'order' | 'grant'
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
  /** Gifts you sent (any status) and received (once delivered), newest first. Always sent by the server. */
  gifts?: Gift[]
  /** Always sent by the server. */
  plus?: PlusStatus
}

const productId = z.string().trim().min(1).max(64)
export const CheckoutBody = z.object({ productId })
export type CheckoutBody = z.infer<typeof CheckoutBody>

export interface CheckoutResponse {
  /** Provider page to open in the browser; the result arrives later as ENTITLEMENTS_UPDATE. */
  url: string
  /** Subscription or order id. */
  reference: string
  kind: 'subscription' | 'order'
  provider: BillingProviderId
  sandbox: boolean
  /** What this checkout charges (a bundle you partly own costs less than its list price). */
  amountCents?: number
  /** POST /billing/gifts: the gift this order pays for. */
  giftId?: string
  /** The provider page offers Pix only (cards are past today's gift limit, GIFT_CARD_LIMIT_CENTS). */
  pixOnly?: boolean
}

/**
 * POST /billing/pay: pays a pending checkout (CheckoutResponse.reference) inside the app. The card fields live in the
 * provider's own iframes (GET /billing/card-frame): only a single-use card token ever reaches us.
 */
export const PayBody = z.discriminatedUnion('method', [
  z.object({ method: z.literal('pix'), reference: z.uuid() }),
  z.object({
    method: z.literal('card'),
    reference: z.uuid(),
    token: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
    paymentMethodId: z.string().trim().min(2).max(32).regex(/^[a-z0-9_]+$/),
    issuerId: z.string().trim().max(32).regex(/^\d*$/).optional(),
    /** CPF (11 digits) or CNPJ (14), digits only. */
    document: z.string().regex(/^(\d{11}|\d{14})$/),
    /**
     * The provider's device fingerprint (fraud screening; MP's is `armor.` + ~225 chars). Optional and never a reason
     * to refuse a payment: anything odd is dropped.
     */
    deviceId: z.string().trim().max(512).regex(/^[A-Za-z0-9:_.-]+$/).optional().catch(undefined),
  }),
])
export type PayBody = z.infer<typeof PayBody>

export interface PayResponse {
  /** approved = paid now (the item arrives as ENTITLEMENTS_UPDATE); pending = waiting for the Pix; rejected = try again. */
  status: 'approved' | 'pending' | 'rejected'
  /** Why it was rejected, in plain Portuguese for the buyer. */
  message?: string
  pix?: { qrCode: string; qrCodeBase64: string; expiresAt: string | null }
}

/** GET /billing/quote?productId=&recipientId=: what a checkout (or a gift to recipientId) would charge now. */
export interface Quote {
  productId: string
  amountCents: number
  /** Cosmetic ids it would grant (a bundle: only the missing ones). */
  items: string[]
  recipientId: string | null
}

// ---- gifts (growth-plan §2.4) ---------------------------------------------------------------------------------------

/** Friendship age needed to give or receive a gift or a Plus pass (anti-fraud, anti-grooming). */
export const GIFT_MIN_FRIENDSHIP_HOURS = 72
export const GIFT_MESSAGE_MAX = 140
/** Latest delivery date a gift can be scheduled for. */
export const GIFT_MAX_SCHEDULE_DAYS = 60
/** Gift spending per sender per 24 h: above the card limit the provider page offers Pix only; above Pix's, 409. */
export const GIFT_CARD_LIMIT_CENTS = 10_000
export const GIFT_PIX_LIMIT_CENTS = 30_000

/**
 * unpaid → scheduled (paid, deliverAt in the future) → delivered (the recipient sees it: GIFT_RECEIVED) → accepted
 * (opened: only now it is usable) | declined (refused before opening: the payer is refunded). refunded = the payer
 * used the 7-day right (revoked from the recipient, GIFT_UPDATE). canceled = never paid. The recipient sees a gift
 * from `delivered` on; unpaid/scheduled/canceled are the sender's only.
 */
export type GiftStatus = 'unpaid' | 'scheduled' | 'delivered' | 'accepted' | 'declined' | 'refunded' | 'canceled'

export interface Gift {
  id: string
  /** A cosmetic, a bundle, a one-time Plus product, or PLUS_PASS_PRODUCT_ID for a Plus pass. */
  productId: string
  /** Cosmetic ids it grants once accepted. */
  items: string[]
  /** null after that account was deleted. */
  sender: PublicUser | null
  recipient: PublicUser | null
  message: string | null
  deliverAt: string | null
  deliveredAt: string | null
  status: GiftStatus
  /** The order paying for it, for the sender (refund it with POST /billing/orders/:id/refund); null for passes and for the recipient. */
  orderId: string | null
  createdAt: string
}

export const GiftBody = z.object({
  productId,
  recipientId: z.uuid(),
  message: z.string().trim().max(GIFT_MESSAGE_MAX).optional(),
  /** Deliver later (≤ GIFT_MAX_SCHEDULE_DAYS); omitted = as soon as it is paid. */
  deliverAt: z.iso.datetime({ offset: true }).optional(),
})
export type GiftBody = z.infer<typeof GiftBody>

// ---- Plus v2 (growth-plan §2.2) -------------------------------------------------------------------------------------

/** Tenure badge thresholds, in months of Plus summed over time (not consecutive). */
export const PLUS_BADGES = [1, 3, 6, 12, 24] as const
export type PlusBadge = (typeof PLUS_BADGES)[number]
export const PLUS_PASSES_PER_MONTH = 2
export const PLUS_PASS_DAYS = 7
/** Product id of a Plus pass gift (Gift.productId); not sold. */
export const PLUS_PASS_PRODUCT_ID = 'plus_pass_7d'
/** The annual plan's permanent item: a Coleção 01 item up to this price. */
export const ANNUAL_ITEM_MAX_CENTS = 1290

export interface PlusStatus {
  /** Months of Plus summed over every paid period (passes do not count). */
  tenureMonths: number
  /** Shown to others as PublicUser.plusBadge while Plus is active. */
  badge: PlusBadge | null
  /** Plus passes you can still give this calendar month (America/Sao_Paulo); 0 without a paid Plus. */
  passesLeft: number
  /** Annual plan only: may claim one item this paid year (null = not on an annual plan). */
  annualItem: { available: boolean; claimedProductId: string | null } | null
}

export const PlusPassBody = z.object({ recipientId: z.uuid(), message: z.string().trim().max(GIFT_MESSAGE_MAX).optional() })
export type PlusPassBody = z.infer<typeof PlusPassBody>
export const AnnualItemBody = z.object({ productId })
export type AnnualItemBody = z.infer<typeof AnnualItemBody>

// ---- wishlist and try-on (growth-plan §2.4) ------------------------------------------------------------------------

export const WISHLIST_MAX = 20

/** Visible only to friends, never announced. Off by default for 16–17. */
export interface Wishlist {
  userId: string
  /** Product ids (cosmetics and bundles), oldest first; items the owner already has are left out. */
  items: string[]
  visible: boolean
}

export const PatchWishlistBody = z.object({ visible: z.boolean() })
export type PatchWishlistBody = z.infer<typeof PatchWishlistBody>

export const TRY_ON_SECONDS = 300
export const TRY_ONS_PER_DAY = 10

/** PublicUser.tryOn: an item shown on someone in your call for TRY_ON_SECONDS ("provando"), in place of `slot`. */
export interface TryOn {
  productId: string
  slot: CosmeticSlot
  expiresAt: string
}

export const TryOnBody = z.object({ productId })
export type TryOnBody = z.infer<typeof TryOnBody>

// ---- Casa: the group's purchase for a space (growth-plan §2.3) ------------------------------------------------------

/** Banner/header tints a Casa can pick (palette of growth-plan §3.2; never the "you are here" indigo). */
export const SPACE_TONES = ['deep', 'lilac', 'porcelain', 'silver', 'graphite', 'ember'] as const
export type SpaceTone = (typeof SPACE_TONES)[number]

/** cinema (1080p60 for the space) only appears when the server enables it (CASA_CINEMA, off until the bandwidth deal). */
export type SpaceUpgradePerk =
  | 'animated_banner' | 'animated_icon' | 'tone' | 'vanity_invite' | 'event_cover' | 'monthly_recap' | 'badge' | 'cinema'

/**
 * Space.upgrade. Present once the space ever had a Casa; `active` is false after endsAt (nothing is deleted).
 * Clients show the end notices from endsAt (5 days before, and at the end), no countdown.
 */
export interface SpaceUpgradeState {
  endsAt: string
  active: boolean
  tone: SpaceTone | null
  /** The vanity invite (an Invite with this code that expires with the Casa). */
  inviteCode: string | null
}

/** GET /spaces/:id/upgrade */
export interface SpaceUpgrade {
  spaceId: string
  upgrade: SpaceUpgradeState | null
  perks: SpaceUpgradePerk[]
  /** Mural da Casa: contributors who chose to appear, alphabetical; no amounts, no ranking. */
  contributors: PublicUser[]
}

export const SpaceContributionBody = z.object({ productId, showOnWall: z.boolean().default(false) })
export type SpaceContributionBody = z.infer<typeof SpaceContributionBody>

export const PatchSpaceUpgradeBody = z.object({
  tone: z.enum(SPACE_TONES).nullable().optional(),
  /** Lowercase letters and digits (invite codes are alphanumeric), 3–32: algameet.com/c/<code>. */
  inviteCode: z.string().trim().toLowerCase().regex(/^[a-z0-9]{3,32}$/).nullable().optional(),
})
export type PatchSpaceUpgradeBody = z.infer<typeof PatchSpaceUpgradeBody>
