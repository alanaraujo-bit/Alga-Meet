/**
 * Entitlements engine. Subscriptions, orders, gifts and Casa contributions change payment state only through `apply`
 * (a verified provider event, stored idempotently in billing_events) and the expiry sweep; `entitlements`,
 * `users.plan`/`plus_since` and `spaces.upgrade_ends_at` are rebuilt from them by `recompute`/`recomputeSpace` in the
 * same transaction, then ENTITLEMENTS_UPDATE / ME_UPDATE / GIFT_* / SPACE_UPGRADE_UPDATE go out after commit.
 * Catalog and rules: docs/business/growth-plan.md §2–§3 (catalog.ts).
 */
import { createHash } from 'node:crypto'
import {
  ANNUAL_ITEM_MAX_CENTS, COSMETIC_SLOTS, GIFT_CARD_LIMIT_CENTS, GIFT_MAX_SCHEDULE_DAYS, GIFT_MIN_FRIENDSHIP_HOURS,
  GIFT_PIX_LIMIT_CENTS, PLUS_PASSES_PER_MONTH, PLUS_PASS_DAYS, PLUS_PASS_PRODUCT_ID, PRIVATE_COSMETIC_SLOTS, REFUND_WINDOW_DAYS,
  REMOVED_USER_ID, SPACE_TONES, uuidv7,
  type BillingCatalog, type BillingMe, type CheckoutResponse, type CosmeticSlot, type Entitlement, type Entitlements,
  type EquippedCosmetics, type Gift, type GiftBody, type Order, type PlanId, type PlanSummary, type PlusPassBody,
  type PlusStatus, type Product, type PutCosmeticsBody, type Quote, type Subscription,
} from '@alga/shared'
import { and, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { isBlockedBetween, profileAudience, spaceMemberIds } from '../access.js'
import type { Config } from '../config.js'
import type { Db, Tx } from '../db/index.js'
import {
  billingEvents, entitlements, gifts, orders, products, relationships, spaceUpgradeContributions, spaces, subscriptions, users,
  type GiftRow, type OrderRow, type SubscriptionRow, type UserRow,
} from '../db/schema.js'
import type { Mailer } from '../email.js'
import { giftReceivedMail, receiptMail } from '../email-templates.js'
import { HttpError, conflict, forbidden, invalid, notFound, safeErr } from '../errors.js'
import type { Hub } from '../gateway/hub.js'
import { ageBracketOf } from '../legal.js'
import { meView, publicUser } from '../views.js'
import type { Voice } from '../voice.js'
import { recomputeSpace, spaceUpgradeState } from './casa.js'
import {
  CATALOG_VERSION, PLANS, PLAN_RANK, PRODUCTS, bundlePriceCents, collectionsView, includedIn, isAvailable, monthsOf,
  plusBadgeOf, planSummary, productById, spaceUpgradePerks,
} from './catalog.js'
import { MercadoPagoProvider } from './mercadopago.js'
import { TryOns } from './tryon.js'
import {
  SandboxProvider, safeEqualHex,
  type BillingUpdate, type OrderUpdate, type PaymentProvider, type SubscriptionUpdate, type VerifiedEvent, type WebhookRequest,
} from './provider.js'

const DAY_MS = 24 * 60 * 60 * 1000
/** Auto-renewing and past_due subscriptions keep their perks this long past the period end (renewals can be late). */
export const GRACE_MS = 3 * DAY_MS
/** Unpaid checkouts expire after this. */
export const PENDING_TTL_MS = DAY_MS
const REFUND_MS = REFUND_WINDOW_DAYS * DAY_MS
const LIVE = ['active', 'past_due'] as const
/** America/Sao_Paulo has no DST since 2019. */
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000

/** Until when a subscription grants its plan (0 = not at all). */
export const entitledUntil = (s: Pick<SubscriptionRow, 'status' | 'currentPeriodEnd' | 'cancelAtPeriodEnd'>): number =>
  (s.status === 'active' || s.status === 'past_due') && s.currentPeriodEnd
    ? s.currentPeriodEnd.getTime() + (s.cancelAtPeriodEnd ? 0 : GRACE_MS)
    : 0

const startOf = (s: SubscriptionRow) => (s.startedAt ?? s.createdAt).getTime()

/**
 * The subscription granting the plan at `now` and until when, following periods stacked back to back (a Plus gift
 * opened while another period runs starts when it ends). null = no plan.
 */
export function coverage(subs: SubscriptionRow[], now: number): { best: SubscriptionRow; until: number } | null {
  const live = subs.filter((s) => s.planId in PLANS && entitledUntil(s) > now)
  const best = live.filter((s) => startOf(s) <= now)
    .sort((a, b) => PLAN_RANK[b.planId as PlanId] - PLAN_RANK[a.planId as PlanId] || entitledUntil(b) - entitledUntil(a))[0]
  if (!best) return null
  let until = entitledUntil(best)
  for (let grew = true; grew;) {
    grew = false
    for (const s of live) if (startOf(s) <= until && entitledUntil(s) > until) { until = entitledUntil(s); grew = true }
  }
  return { best, until }
}

/** Paid Plus time summed over every period (union of intervals, passes and refunds excluded). */
export function tenureMs(subs: SubscriptionRow[], now: number): number {
  const spans = subs
    .filter((s) => s.kind !== 'pass' && (s.status === 'active' || s.status === 'past_due' || s.status === 'expired') && s.currentPeriodEnd)
    .map((s) => [startOf(s), Math.min(s.currentPeriodEnd!.getTime(), now)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  let total = 0
  let end = -Infinity
  for (const [a, b] of spans) {
    if (b <= end) continue
    total += b - Math.max(a, end)
    end = b
  }
  return total
}

const renewingLive = (subs: SubscriptionRow[], now: number) =>
  subs.some((s) => s.kind === 'renewing' && !s.cancelAtPeriodEnd && entitledUntil(s) > now)

const addMonths = (d: Date, months: number) => {
  const out = new Date(d)
  out.setUTCMonth(out.getUTCMonth() + months)
  return out
}

/** First instant of the current calendar month in America/Sao_Paulo. */
const brtMonthStart = (now: number) => {
  const d = new Date(now - BRT_OFFSET_MS)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) + BRT_OFFSET_MS)
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const iso = (d: Date | null) => d?.toISOString() ?? null

export function createProvider(config: Config): PaymentProvider | null {
  const b = config.billing
  if (b.provider === 'sandbox') return new SandboxProvider(config)
  if (b.provider === 'mercadopago' && b.mercadopago) {
    return new MercadoPagoProvider({
      ...b.mercadopago,
      returnUrl: b.returnUrl,
      notificationUrl: `${config.publicUrl}/api/v1/billing/webhooks/mercadopago`,
    })
  }
  return null
}

const subscriptionView = (s: SubscriptionRow): Subscription => ({
  id: s.id,
  productId: s.productId,
  planId: s.planId as PlanId,
  status: s.status,
  currentPeriodEnd: iso(s.currentPeriodEnd),
  cancelAtPeriodEnd: s.cancelAtPeriodEnd,
  amountCents: s.amountCents,
  currency: s.currency,
  provider: s.provider,
  sandbox: s.provider === 'sandbox',
  createdAt: s.createdAt.toISOString(),
  kind: s.kind,
  startedAt: iso(s.startedAt),
  refundableUntil: s.kind === 'renewing' && s.startedAt && (s.status === 'active' || s.status === 'past_due') && !s.refundRequestedAt
    && Date.now() < s.startedAt.getTime() + REFUND_MS ? new Date(s.startedAt.getTime() + REFUND_MS).toISOString() : null,
  refundRequestedAt: iso(s.refundRequestedAt),
})

const orderView = (o: OrderRow, extra: { giftId?: string | null; spaceId?: string | null } = {}): Order => ({
  id: o.id,
  productId: o.productId,
  status: o.status,
  amountCents: o.amountCents,
  currency: o.currency,
  provider: o.provider,
  sandbox: o.provider === 'sandbox',
  createdAt: o.createdAt.toISOString(),
  items: [...o.items],
  giftId: extra.giftId ?? null,
  spaceId: extra.spaceId ?? null,
  paidAt: iso(o.paidAt),
  refundableUntil: o.status === 'paid' && o.amountCents > 0 && o.paidAt && !o.refundRequestedAt
    && Date.now() < o.paidAt.getTime() + REFUND_MS ? new Date(o.paidAt.getTime() + REFUND_MS).toISOString() : null,
  refundRequestedAt: iso(o.refundRequestedAt),
})

interface Change { userId: string; planChanged: boolean; cosmeticsChanged: boolean; profileChanged: boolean }
type Desired = Omit<typeof entitlements.$inferInsert, 'userId' | 'sku'>

/** What a transaction touched; the notifications go out after commit. */
interface Touched {
  users: Set<string>
  spaces: Set<string>
  /** gift id → 'received' (just delivered) or 'update'. */
  gifts: Map<string, 'received' | 'update'>
  /** Orders that became paid / subscriptions activated for the first time: a receipt each. */
  receipts: { kind: 'order' | 'subscription'; id: string }[]
}
const touchedSet = (): Touched => ({ users: new Set(), spaces: new Set(), gifts: new Map(), receipts: [] })

export class Billing {
  private timer: NodeJS.Timeout | undefined
  private sweeping: Promise<number> | undefined
  private lastSweepAt: Date | undefined
  readonly tryOns: TryOns

  constructor(
    private readonly config: Config,
    private readonly db: Db,
    private readonly hub: Hub,
    private readonly voice: Voice,
    private readonly log: FastifyBaseLogger,
    private readonly mail: Mailer | null = null,
    readonly provider: PaymentProvider | null = createProvider(config),
  ) {
    this.tryOns = new TryOns(db, hub, voice)
  }

  get sandbox(): SandboxProvider | null {
    return this.provider instanceof SandboxProvider ? this.provider : null
  }

  plan(id: PlanId): PlanSummary {
    return planSummary(id, this.config.files.maxAttachmentBytes)
  }

  /** Defense in depth: sandbox rows (e.g. a copied dev database) never grant anything in production. */
  private counts(provider: string): boolean {
    return this.config.env !== 'production' || provider !== 'sandbox'
  }

  /** Upserts catalog.ts into `products`; retired SKUs and SKUs no longer in the catalog go inactive. */
  async syncCatalog(): Promise<void> {
    const now = new Date()
    await this.db.transaction(async (tx) => {
      for (const p of PRODUCTS) {
        const row = {
          kind: p.kind, planId: p.planId ?? null, interval: p.interval ?? null, cosmeticType: p.cosmeticType ?? null,
          name: p.name, priceBrlCents: p.priceBrlCents, priceUsdCents: p.priceUsdCents, active: !p.retired,
          catalogVersion: CATALOG_VERSION, updatedAt: now,
        }
        await tx.insert(products).values({ id: p.id, ...row }).onConflictDoUpdate({ target: products.id, set: row })
      }
      await tx.update(products).set({ active: false, updatedAt: now }).where(notInArray(products.id, PRODUCTS.map((p) => p.id)))
    })
  }

  catalog(now = Date.now()): BillingCatalog {
    return {
      version: CATALOG_VERSION,
      provider: this.provider ? { id: this.provider.id, sandbox: this.provider.sandbox } : null,
      plans: (Object.keys(PLANS) as PlanId[]).map((id) => this.plan(id)),
      products: PRODUCTS.map((p) => ({ ...p, available: isAvailable(p, now) })),
      collections: collectionsView(now),
      spaceUpgrade: { perks: spaceUpgradePerks(this.config.billing.casaCinema), tones: [...SPACE_TONES] },
    }
  }

  async entitlementsOf(userId: string, planId?: PlanId): Promise<Entitlements> {
    if (!planId) {
      const [u] = await this.db.select({ plan: users.plan }).from(users).where(eq(users.id, userId))
      planId = u?.plan ?? 'free'
    }
    const rows = await this.db.select().from(entitlements).where(eq(entitlements.userId, userId)).orderBy(entitlements.sku)
    const items: Entitlement[] = rows.map((r) => ({ sku: r.sku, kind: r.kind, source: r.source, expiresAt: iso(r.expiresAt) }))
    return { plan: this.plan(planId), items }
  }

  async me(user: UserRow): Promise<BillingMe> {
    const [subs, ords, ents, giftRows] = await Promise.all([
      this.db.select().from(subscriptions).where(eq(subscriptions.userId, user.id)).orderBy(desc(subscriptions.id)),
      this.db.select().from(orders).where(eq(orders.userId, user.id)).orderBy(desc(orders.id)).limit(100),
      this.entitlementsOf(user.id, user.plan),
      this.db.select().from(gifts).where(or(
        eq(gifts.senderId, user.id),
        and(eq(gifts.recipientId, user.id), notInArray(gifts.status, ['unpaid', 'scheduled', 'canceled'])),
      )).orderBy(desc(gifts.id)).limit(100),
    ])
    const current = subs.find((s) => entitledUntil(s) > Date.now()) ?? subs.find((s) => s.status !== 'pending')
    const ids = ords.map((o) => o.id)
    const [giftOf, spaceOf] = ids.length ? await Promise.all([
      this.db.select({ orderId: gifts.orderId, id: gifts.id }).from(gifts).where(inArray(gifts.orderId, ids)),
      this.db.select({ orderId: spaceUpgradeContributions.orderId, spaceId: spaceUpgradeContributions.spaceId })
        .from(spaceUpgradeContributions).where(inArray(spaceUpgradeContributions.orderId, ids)),
    ]) : [[], []]
    const g = new Map(giftOf.map((r) => [r.orderId, r.id]))
    const sp = new Map(spaceOf.map((r) => [r.orderId, r.spaceId]))
    return {
      ...ents,
      subscription: current ? subscriptionView(current) : null,
      subscriptions: subs.slice(0, 50).map(subscriptionView),
      orders: ords.map((o) => orderView(o, { giftId: g.get(o.id), spaceId: sp.get(o.id) })),
      gifts: await this.giftViews(giftRows, user.id),
      plus: await this.plusStatus(user.id, subs.filter((s) => this.counts(s.provider))),
    }
  }

  private async plusStatus(userId: string, subs: SubscriptionRow[], now = Date.now()): Promise<PlusStatus> {
    const months = monthsOf(tenureMs(subs, now))
    const cover = coverage(subs, now)
    const paid = cover && cover.best.kind !== 'pass' ? cover.best : null
    let passesLeft = 0
    let annualItem: PlusStatus['annualItem'] = null
    if (paid) {
      const [sent] = await this.db.select({ n: sql<number>`count(*)::int` }).from(gifts).where(and(
        eq(gifts.senderId, userId), eq(gifts.productId, PLUS_PASS_PRODUCT_ID), ne(gifts.status, 'declined'),
        gte(gifts.createdAt, brtMonthStart(now)),
      ))
      passesLeft = Math.max(0, PLUS_PASSES_PER_MONTH - (sent?.n ?? 0))
      if (productById(paid.productId)?.interval === 'year') {
        const claim = await this.annualClaim(this.db, paid)
        annualItem = { available: !claim, claimedProductId: claim?.productId ?? null }
      }
    }
    return { tenureMonths: months, badge: paid ? plusBadgeOf(new Date(now - tenureMs(subs, now)), 'plus', now) ?? null : null, passesLeft, annualItem }
  }

  // ---- checkout -----------------------------------------------------------------------------------------------------

  private requireProvider(): PaymentProvider {
    if (!this.provider) throw new HttpError('internal', 'Pagamentos indisponíveis no momento.', undefined, 503)
    return this.provider
  }

  /** A product that can be bought now: 404 unknown/unsold, 409 not on sale yet (its wave has not opened). */
  private sellable(productId: string, kinds: Product['kind'][]): Product {
    const product = productById(productId)
    if (!product?.purchasable || product.retired || !kinds.includes(product.kind)) throw notFound('Produto não encontrado.')
    if (!isAvailable(product)) throw conflict('Este item ainda não está à venda.')
    return product
  }

  /** Cosmetics owned for good (bought, gifted, the annual item). `incoming` adds gifts on their way to the user. */
  private async ownedSkus(userId: string, incoming = false): Promise<Set<string>> {
    const rows = await this.db.select({ sku: entitlements.sku }).from(entitlements)
      .where(and(eq(entitlements.userId, userId), eq(entitlements.kind, 'cosmetic'), isNull(entitlements.expiresAt)))
    const out = new Set(rows.map((r) => r.sku))
    if (incoming) {
      const pending = await this.db.select({ items: orders.items }).from(gifts).innerJoin(orders, eq(orders.id, gifts.orderId)).where(and(
        eq(gifts.recipientId, userId), inArray(gifts.status, ['unpaid', 'scheduled', 'delivered']), inArray(orders.status, ['pending', 'paid']),
      ))
      for (const r of pending) for (const sku of r.items) out.add(sku)
    }
    return out
  }

  /** Price and items for `targetId` now (a bundle: only what they miss). 409 when they already have it all. */
  private async price(product: Product, targetId: string, gift: boolean): Promise<{ amountCents: number; items: string[] }> {
    if (product.kind === 'cosmetic' || product.kind === 'bundle') {
      const owned = await this.ownedSkus(targetId, gift)
      const items = (product.kind === 'bundle' ? product.items ?? [] : [product.id]).filter((id) => !owned.has(id))
      if (!items.length) throw conflict(gift ? 'Seu amigo já tem (ou já vai ganhar) este item.' : 'Você já tem este item.')
      return { amountCents: product.kind === 'bundle' ? bundlePriceCents(product, items) : product.priceBrlCents, items }
    }
    return { amountCents: product.priceBrlCents, items: [] }
  }

  /** GET /billing/quote */
  async quote(user: UserRow, productId: string, recipientId?: string): Promise<Quote> {
    const product = this.sellable(productId, ['cosmetic', 'bundle', 'plan', 'space_upgrade'])
    if (recipientId) {
      if (!product.giftable) throw notFound('Produto não encontrado.')
      await this.assertGiftable(user.id, recipientId)
    }
    const { amountCents, items } = await this.price(product, recipientId ?? user.id, !!recipientId)
    return { productId, amountCents, items, recipientId: recipientId ?? null }
  }

  /** Creates the pending subscription/order and the provider's page. Grants nothing. */
  async checkout(user: UserRow, productId: string): Promise<CheckoutResponse> {
    const provider = this.requireProvider()
    const product = this.sellable(productId, ['plan', 'cosmetic', 'bundle'])
    if (product.kind === 'plan' && product.billing !== 'one_time') {
      const id = uuidv7()
      const amountCents = product.priceBrlCents
      const live = await this.db.select().from(subscriptions).where(and(eq(subscriptions.userId, user.id), inArray(subscriptions.status, LIVE)))
      if (live.some((s) => entitledUntil(s) > Date.now())) throw conflict('Você já tem uma assinatura ativa.')
      await this.db.insert(subscriptions).values({
        id, userId: user.id, productId: product.id, planId: product.planId!, status: 'pending', amountCents, currency: 'BRL', provider: provider.id,
      })
      let page: Awaited<ReturnType<PaymentProvider['createCheckout']>>
      try {
        page = await provider.createCheckout({ kind: 'subscription', reference: id, product, amountCents, currency: 'BRL', payerEmail: user.email })
      } catch (err) {
        this.log.error({ err: safeErr(err), provider: provider.id, kind: 'subscription' }, 'billing: checkout creation failed')
        await this.db.update(subscriptions).set({ status: 'expired', updatedAt: new Date() }).where(eq(subscriptions.id, id))
        throw new HttpError('internal', 'Não foi possível iniciar o pagamento. Tente novamente.', undefined, 502)
      }
      if (page.providerSubscriptionId) {
        await this.db.update(subscriptions).set({ providerSubscriptionId: page.providerSubscriptionId }).where(eq(subscriptions.id, id))
      }
      return { url: page.url, reference: id, kind: 'subscription', provider: provider.id, sandbox: provider.sandbox, amountCents }
    }
    if (product.kind === 'plan') {
      const live = await this.db.select().from(subscriptions).where(and(eq(subscriptions.userId, user.id), inArray(subscriptions.status, LIVE)))
      if (renewingLive(live, Date.now())) throw conflict('Você já tem uma assinatura com renovação automática.')
    }
    const { amountCents, items } = await this.price(product, user.id, false)
    return this.createOrder(user, product, amountCents, items)
  }

  /** Inserts the pending order (and its gift / Casa contribution) and opens the provider's page. */
  private async createOrder(
    user: UserRow, product: Product, amountCents: number, items: string[],
    extra: { gift?: { recipientId: string; message: string | null; deliverAt: Date | null }; spaceId?: string; showOnWall?: boolean; pixOnly?: boolean; title?: string } = {},
  ): Promise<CheckoutResponse> {
    const provider = this.requireProvider()
    const id = uuidv7()
    const giftId = extra.gift ? uuidv7() : undefined
    await this.db.transaction(async (tx) => {
      await tx.insert(orders).values({ id, userId: user.id, productId: product.id, status: 'pending', amountCents, currency: 'BRL', provider: provider.id, items })
      if (extra.gift) {
        await tx.insert(gifts).values({
          id: giftId!, orderId: id, productId: product.id, senderId: user.id, recipientId: extra.gift.recipientId,
          message: extra.gift.message, deliverAt: extra.gift.deliverAt, status: 'unpaid',
        })
      }
      if (extra.spaceId) {
        await tx.insert(spaceUpgradeContributions).values({ orderId: id, spaceId: extra.spaceId, userId: user.id, days: product.days!, showOnWall: !!extra.showOnWall })
      }
    })
    let page: Awaited<ReturnType<PaymentProvider['createCheckout']>>
    try {
      page = await provider.createCheckout({
        kind: 'order', reference: id, product, amountCents, currency: 'BRL', payerEmail: user.email,
        ...(extra.title ? { title: extra.title } : {}), ...(extra.pixOnly ? { pixOnly: true } : {}),
      })
    } catch (err) {
      this.log.error({ err: safeErr(err), provider: provider.id, kind: 'order' }, 'billing: checkout creation failed')
      const now = new Date()
      await this.db.update(orders).set({ status: 'expired', updatedAt: now }).where(eq(orders.id, id))
      if (giftId) await this.db.update(gifts).set({ status: 'canceled', updatedAt: now }).where(eq(gifts.id, giftId))
      throw new HttpError('internal', 'Não foi possível iniciar o pagamento. Tente novamente.', undefined, 502)
    }
    return {
      url: page.url, reference: id, kind: 'order', provider: provider.id, sandbox: provider.sandbox, amountCents,
      ...(giftId ? { giftId } : {}), ...(extra.pixOnly ? { pixOnly: true } : {}),
    }
  }

  // ---- gifts and Plus passes ----------------------------------------------------------------------------------------

  /** Friends for GIFT_MIN_FRIENDSHIP_HOURS, neither blocking the other. */
  private async assertGiftable(senderId: string, recipientId: string, now = Date.now()): Promise<UserRow> {
    if (senderId === recipientId) throw invalid({ recipientId: 'Escolha um amigo.' })
    const [recipient] = await this.db.select().from(users).where(eq(users.id, recipientId))
    if (!recipient || recipient.deletionRequestedAt) throw notFound('Usuário não encontrado.')
    const [rel] = await this.db.select({ since: relationships.since }).from(relationships)
      .where(and(eq(relationships.userId, senderId), eq(relationships.targetId, recipientId), eq(relationships.type, 'friend')))
    if (!rel || rel.since.getTime() > now - GIFT_MIN_FRIENDSHIP_HOURS * 3600_000 || await isBlockedBetween(this.db, senderId, recipientId)) {
      throw forbidden('Presentes e convites são só para amigos de pelo menos 3 dias.')
    }
    return recipient
  }

  /** POST /billing/gifts: a pending order + gift; the recipient sees it once it is paid (and its date comes). */
  async gift(user: UserRow, body: GiftBody): Promise<CheckoutResponse> {
    const product = this.sellable(body.productId, ['cosmetic', 'bundle', 'plan'])
    if (!product.giftable) throw notFound('Produto não encontrado.')
    const now = Date.now()
    const recipient = await this.assertGiftable(user.id, body.recipientId, now)
    const deliverAt = body.deliverAt ? new Date(body.deliverAt) : null
    if (deliverAt && (deliverAt.getTime() <= now || deliverAt.getTime() > now + GIFT_MAX_SCHEDULE_DAYS * DAY_MS)) {
      throw invalid({ deliverAt: `Escolha uma data nos próximos ${GIFT_MAX_SCHEDULE_DAYS} dias.` })
    }
    if (product.kind === 'plan') {
      const live = await this.db.select().from(subscriptions).where(and(eq(subscriptions.userId, recipient.id), inArray(subscriptions.status, LIVE)))
      if (renewingLive(live, now)) throw conflict('Seu amigo já tem Plus com renovação automática.')
    }
    const { amountCents, items } = await this.price(product, recipient.id, true)
    const [spent] = await this.db.select({ cents: sql<number>`coalesce(sum(${orders.amountCents}), 0)::int` }).from(gifts)
      .innerJoin(orders, eq(orders.id, gifts.orderId))
      .where(and(eq(gifts.senderId, user.id), inArray(orders.status, ['pending', 'paid']), gt(orders.createdAt, new Date(now - DAY_MS))))
    const total = (spent?.cents ?? 0) + amountCents
    if (total > GIFT_PIX_LIMIT_CENTS) throw conflict('Você chegou ao limite de presentes de hoje. Tente de novo amanhã.')
    return this.createOrder(user, product, amountCents, items, {
      gift: { recipientId: recipient.id, message: body.message || null, deliverAt },
      pixOnly: total > GIFT_CARD_LIMIT_CENTS,
      title: `Presente: ${product.name}`,
    })
  }

  /** POST /billing/passes: a free 7-day Plus pass from a paid subscriber to an adult friend (growth-plan §2.2). */
  async givePass(user: UserRow, body: PlusPassBody): Promise<Gift> {
    const now = Date.now()
    const own = await this.db.select().from(subscriptions).where(and(eq(subscriptions.userId, user.id), inArray(subscriptions.status, LIVE)))
    const cover = coverage(own.filter((s) => this.counts(s.provider)), now)
    if (!cover || cover.best.kind === 'pass') throw forbidden('Convites Plus são para quem assina o Plus.')
    const recipient = await this.assertGiftable(user.id, body.recipientId, now)
    const age = ageBracketOf(recipient)
    if (age === 'teen' || (age === 'unknown' && this.config.legal.requireBirthDate)) throw forbidden('Convites Plus são só para maiores de 18 anos.')
    if (recipient.plan === 'plus') throw conflict('Seu amigo já tem Plus.')
    const id = uuidv7()
    await this.db.transaction(async (tx) => {
      // Serializes concurrent passes from this sender (the monthly count below).
      await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for('update')
      const [sent] = await tx.select({ n: sql<number>`count(*)::int` }).from(gifts).where(and(
        eq(gifts.senderId, user.id), eq(gifts.productId, PLUS_PASS_PRODUCT_ID), ne(gifts.status, 'declined'), gte(gifts.createdAt, brtMonthStart(now)),
      ))
      if ((sent?.n ?? 0) >= PLUS_PASSES_PER_MONTH) throw conflict(`Você já deu os ${PLUS_PASSES_PER_MONTH} convites deste mês.`)
      const [got] = await tx.select({ id: gifts.id }).from(gifts).where(and(
        eq(gifts.recipientId, recipient.id), eq(gifts.productId, PLUS_PASS_PRODUCT_ID), inArray(gifts.status, ['delivered', 'accepted']),
        gt(gifts.createdAt, new Date(now - 365 * DAY_MS)),
      )).limit(1)
      if (got) throw conflict('Seu amigo já recebeu um convite Plus nos últimos 12 meses.')
      const at = new Date(now)
      await tx.insert(gifts).values({
        id, productId: PLUS_PASS_PRODUCT_ID, senderId: user.id, recipientId: recipient.id, message: body.message || null,
        status: 'delivered', deliveredAt: at, createdAt: at,
      })
    })
    await this.afterCommit({ ...touchedSet(), gifts: new Map([[id, 'received']]) }, [])
    const [row] = await this.db.select().from(gifts).where(eq(gifts.id, id))
    return (await this.giftViews([row!], user.id))[0]!
  }

  /** POST /billing/gifts/:id/accept: opens a delivered gift; only now it is usable (a Plus period starts now). Idempotent. */
  async acceptGift(user: UserRow, giftId: string): Promise<Gift> {
    const now = new Date()
    const { touched, change } = await this.db.transaction(async (tx) => {
      const [g] = await tx.select().from(gifts).where(and(eq(gifts.id, giftId), eq(gifts.recipientId, user.id))).for('update')
      if (!g || !['delivered', 'accepted'].includes(g.status)) throw notFound('Presente não encontrado.')
      const touched = touchedSet()
      if (g.status === 'accepted') return { touched, change: null }
      const product = productById(g.productId)
      if (product?.kind === 'plan') {
        const live = await tx.select().from(subscriptions).where(and(eq(subscriptions.userId, user.id), inArray(subscriptions.status, LIVE)))
        if (renewingLive(live, now.getTime())) {
          throw conflict('Você já tem Plus com renovação automática: cancele a renovação para abrir este presente, ou recuse-o.')
        }
        if (g.productId === PLUS_PASS_PRODUCT_ID) {
          const [giverSub] = g.senderId
            ? await tx.select({ provider: subscriptions.provider }).from(subscriptions).where(eq(subscriptions.userId, g.senderId)).orderBy(desc(subscriptions.id)).limit(1)
            : []
          const provider = giverSub?.provider ?? this.provider?.id
          if (!provider) throw new HttpError('internal', 'Pagamentos indisponíveis no momento.', undefined, 503)
          await this.grantPeriod(tx, user.id, { kind: 'pass', productId: g.productId, provider, grantedBy: g.senderId, amountCents: 0, days: PLUS_PASS_DAYS }, now)
        } else {
          const [o] = await tx.select().from(orders).where(eq(orders.id, g.orderId!))
          await this.grantPeriod(tx, user.id, {
            kind: 'period', productId: g.productId, provider: o!.provider, orderId: o!.id, amountCents: o!.amountCents,
            months: product.interval === 'year' ? 12 : 1,
          }, now)
        }
      }
      await tx.update(gifts).set({ status: 'accepted', updatedAt: now }).where(eq(gifts.id, g.id))
      touched.gifts.set(g.id, 'update')
      return { touched, change: await this.recompute(tx, user.id, now) }
    })
    await this.afterCommit(touched, change ? [change] : [])
    const [row] = await this.db.select().from(gifts).where(eq(gifts.id, giftId))
    return (await this.giftViews([row!], user.id))[0]!
  }

  /** POST /billing/gifts/:id/decline: refused before opening; the payer is refunded in full. */
  async declineGift(user: UserRow, giftId: string): Promise<Gift> {
    const [g] = await this.db.select().from(gifts).where(and(eq(gifts.id, giftId), eq(gifts.recipientId, user.id)))
    if (!g || !['delivered', 'declined'].includes(g.status)) {
      if (g?.status === 'accepted') throw conflict('Este presente já foi aberto.')
      throw notFound('Presente não encontrado.')
    }
    if (g.status === 'delivered') {
      const [o] = g.orderId ? await this.db.select().from(orders).where(eq(orders.id, g.orderId)) : []
      if (o?.status === 'paid' && !o.refundRequestedAt) await this.providerRefund(o.provider, o.providerPaymentId)
      const now = new Date()
      await this.db.transaction(async (tx) => {
        await tx.update(gifts).set({ status: 'declined', updatedAt: now }).where(eq(gifts.id, g.id))
        if (o?.status === 'paid') await tx.update(orders).set({ refundRequestedAt: now }).where(eq(orders.id, o.id))
      })
      await this.afterCommit({ ...touchedSet(), gifts: new Map([[g.id, 'update']]) }, [])
      if (o?.status === 'paid') await this.sandboxConfirmRefund(o)
    }
    const [row] = await this.db.select().from(gifts).where(eq(gifts.id, giftId))
    return (await this.giftViews([row!], user.id))[0]!
  }

  /** A Plus period (paid once) or pass, stacked after whatever plan time the user already has. */
  private async grantPeriod(
    tx: Tx, userId: string,
    p: { kind: 'period' | 'pass'; productId: string; provider: SubscriptionRow['provider']; amountCents: number; orderId?: string; grantedBy?: string | null; months?: number; days?: number },
    now: Date,
  ): Promise<void> {
    const live = await tx.select().from(subscriptions).where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, LIVE)))
    const start = new Date(Math.max(now.getTime(), coverage(live, now.getTime())?.until ?? 0))
    const end = p.months ? addMonths(start, p.months) : new Date(start.getTime() + p.days! * DAY_MS)
    await tx.insert(subscriptions).values({
      id: uuidv7(), userId, productId: p.productId, planId: 'plus', status: 'active', kind: p.kind, startedAt: start, currentPeriodEnd: end,
      cancelAtPeriodEnd: true, amountCents: p.amountCents, currency: 'BRL', provider: p.provider, orderId: p.orderId ?? null,
      grantedBy: p.grantedBy ?? null,
    })
  }

  private async giftViews(rows: GiftRow[], viewerId: string): Promise<Gift[]> {
    const userIds = [...new Set(rows.flatMap((g) => [g.senderId, g.recipientId]).filter((id): id is string => !!id))]
    const orderIds = rows.map((g) => g.orderId).filter((id): id is string => !!id)
    const [us, os] = await Promise.all([
      userIds.length ? this.db.select().from(users).where(inArray(users.id, userIds)) : [],
      orderIds.length ? this.db.select({ id: orders.id, items: orders.items }).from(orders).where(inArray(orders.id, orderIds)) : [],
    ])
    const people = new Map(us.map((u) => [u.id, publicUser(u)]))
    const items = new Map(os.map((o) => [o.id, o.items]))
    return rows.map((g) => ({
      id: g.id,
      productId: g.productId,
      items: g.orderId ? [...(items.get(g.orderId) ?? [])] : [],
      sender: g.senderId ? people.get(g.senderId) ?? null : null,
      recipient: g.recipientId ? people.get(g.recipientId) ?? null : null,
      message: g.message,
      deliverAt: iso(g.deliverAt),
      deliveredAt: iso(g.deliveredAt),
      status: g.status,
      orderId: viewerId === g.senderId ? g.orderId : null,
      createdAt: g.createdAt.toISOString(),
    }))
  }

  // ---- Plus: annual item --------------------------------------------------------------------------------------------

  /** The annual item claimed in the subscription's current paid year, if any. */
  private async annualClaim(db: Db | Tx, sub: SubscriptionRow): Promise<OrderRow | undefined> {
    const yearStart = Math.max(startOf(sub), addMonths(sub.currentPeriodEnd!, -12).getTime())
    const [claim] = await db.select().from(orders).where(and(
      eq(orders.subscriptionId, sub.id), eq(orders.amountCents, 0), eq(orders.status, 'paid'), gte(orders.createdAt, new Date(yearStart - 1000)),
    )).limit(1)
    return claim
  }

  /** POST /billing/plus/annual-item: one Coleção 01 item (≤ ANNUAL_ITEM_MAX_CENTS) that stays with you, per paid year. */
  async claimAnnualItem(user: UserRow, productId: string): Promise<Order> {
    const now = new Date()
    const { order, change } = await this.db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for('update')
      const subs = await tx.select().from(subscriptions).where(and(eq(subscriptions.userId, user.id), inArray(subscriptions.status, LIVE)))
      const cover = coverage(subs.filter((s) => this.counts(s.provider)), now.getTime())
      const sub = cover?.best
      if (!sub || sub.kind === 'pass' || productById(sub.productId)?.interval !== 'year') throw forbidden('O item anual é do Plus anual.')
      const p = productById(productId)
      if (p?.kind !== 'cosmetic' || p.collectionId !== 'hora_azul' || !isAvailable(p, now.getTime()) || p.priceBrlCents > ANNUAL_ITEM_MAX_CENTS) {
        throw invalid({ productId: 'Escolha um item da Coleção 01 de até R$ 12,90 que já esteja na loja.' })
      }
      if (await this.annualClaim(tx, sub)) throw conflict('Você já escolheu o item deste ano.')
      const [owned] = await tx.select({ sku: entitlements.sku }).from(entitlements)
        .where(and(eq(entitlements.userId, user.id), eq(entitlements.sku, productId), isNull(entitlements.expiresAt)))
      if (owned) throw conflict('Você já tem este item.')
      const [order] = await tx.insert(orders).values({
        id: uuidv7(), userId: user.id, productId, status: 'paid', amountCents: 0, currency: 'BRL', provider: sub.provider,
        items: [productId], subscriptionId: sub.id, paidAt: now,
      }).returning()
      return { order: order!, change: await this.recompute(tx, user.id, now) }
    })
    await this.afterCommit(touchedSet(), change ? [change] : [])
    return orderView(order)
  }

  // ---- refunds (7 days, Termos 9.5) ---------------------------------------------------------------------------------

  /** Asks the provider for a full refund. The state changes only when the provider confirms (webhook). */
  private async providerRefund(providerId: string, paymentId: string | null): Promise<void> {
    if (!this.provider || providerId !== this.provider.id) throw new HttpError('internal', 'Pagamentos indisponíveis no momento.', undefined, 503)
    if (!paymentId) throw conflict('O pagamento ainda não foi confirmado. Tente de novo em alguns minutos.')
    try {
      await this.provider.refund(paymentId)
    } catch (err) {
      this.log.error({ err: safeErr(err), provider: providerId }, 'billing: provider refund failed')
      throw new HttpError('internal', 'Não foi possível pedir o reembolso agora. Tente novamente.', undefined, 502)
    }
  }

  /** The sandbox provider refunds at once: its confirmation is applied like a webhook (as its checkout page does). */
  private async sandboxConfirmRefund(o: Pick<OrderRow, 'id' | 'provider'>): Promise<void> {
    if (!this.sandbox || o.provider !== 'sandbox') return
    const update: OrderUpdate = { kind: 'order', reference: o.id, status: 'refunded', occurredAt: new Date() }
    await this.apply({ id: `refund:${o.id}`, type: 'sandbox.refund', updates: [update] }, sha256(JSON.stringify(update)))
  }

  /** POST /billing/orders/:id/refund: the payer's 7-day right (items, bundles, gifts, one-time Plus, Casa). Idempotent. */
  async refundOrder(user: UserRow, orderId: string): Promise<Order> {
    const [o] = await this.db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, user.id)))
    if (!o) throw notFound('Pedido não encontrado.')
    if (!o.refundRequestedAt) {
      if (o.status !== 'paid' || o.amountCents === 0) throw conflict('Este pedido não pode ser reembolsado.')
      if (!o.paidAt || Date.now() > o.paidAt.getTime() + REFUND_MS) throw conflict(`O prazo de ${REFUND_WINDOW_DAYS} dias para pedir reembolso acabou.`)
      await this.providerRefund(o.provider, o.providerPaymentId)
      await this.db.update(orders).set({ refundRequestedAt: new Date() }).where(eq(orders.id, o.id))
      await this.sandboxConfirmRefund(o)
    }
    const [row] = await this.db.select().from(orders).where(eq(orders.id, o.id))
    const [g] = await this.db.select({ id: gifts.id }).from(gifts).where(eq(gifts.orderId, o.id))
    const [c] = await this.db.select({ spaceId: spaceUpgradeContributions.spaceId }).from(spaceUpgradeContributions).where(eq(spaceUpgradeContributions.orderId, o.id))
    return orderView(row!, { giftId: g?.id, spaceId: c?.spaceId })
  }

  /** POST /billing/subscription/refund: the first charge of a renewing Plus within 7 days; renewals stop for good. */
  async refundSubscription(user: UserRow): Promise<Subscription> {
    const now = Date.now()
    const subs = await this.db.select().from(subscriptions).where(and(
      eq(subscriptions.userId, user.id), eq(subscriptions.kind, 'renewing'), inArray(subscriptions.status, LIVE),
    )).orderBy(desc(subscriptions.id))
    const sub = subs.find((s) => s.startedAt && now <= s.startedAt.getTime() + REFUND_MS)
    if (!sub) throw notFound(`Nenhuma cobrança do Plus para reembolsar nos últimos ${REFUND_WINDOW_DAYS} dias.`)
    if (!sub.refundRequestedAt) {
      await this.providerRefund(sub.provider, sub.providerPaymentId)
      try {
        await this.provider!.cancelSubscription(sub.providerSubscriptionId, true)
      } catch (err) {
        // The refund webhook still revokes; a renewal charged meanwhile needs a manual refund.
        this.log.error({ err: safeErr(err), provider: sub.provider }, 'billing: cancel after refund failed, check renewals manually')
      }
      await this.db.update(subscriptions).set({ refundRequestedAt: new Date(now), cancelAtPeriodEnd: true, updatedAt: new Date(now) })
        .where(eq(subscriptions.id, sub.id))
      if (this.sandbox && sub.provider === 'sandbox') {
        const update: SubscriptionUpdate = { kind: 'subscription', reference: sub.id, status: 'revoked', occurredAt: new Date() }
        await this.apply({ id: `refund:${sub.id}`, type: 'sandbox.refund', updates: [update] }, sha256(JSON.stringify(update)))
      }
    }
    const [row] = await this.db.select().from(subscriptions).where(eq(subscriptions.id, sub.id))
    return subscriptionView(row!)
  }

  // ---- subscription renewal -----------------------------------------------------------------------------------------

  /**
   * Stops renewals at the provider; the plan lasts until currentPeriodEnd (then the sweep expires it). Idempotent.
   * `final` (account deletion): the provider-side subscription can never be resumed, even if already canceled here.
   */
  cancel(userId: string, { final = false } = {}): Promise<Subscription> {
    return this.setRenewal(userId, false, final)
  }

  /** Undoes cancel while the paid period lasts: renewals resume at the provider, the grace period comes back. Idempotent. */
  resume(userId: string): Promise<Subscription> {
    return this.setRenewal(userId, true)
  }

  private async setRenewal(userId: string, renew: boolean, final = false): Promise<Subscription> {
    const now = Date.now()
    const live = await this.db.select().from(subscriptions).where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, LIVE)))
    const renewing = live.filter((s) => s.kind === 'renewing')
    const sub = renewing.filter((s) => entitledUntil(s) > now).sort((a, b) => entitledUntil(b) - entitledUntil(a))[0]
    if (!sub) {
      // A one-time period or a pass never renews: nothing to cancel, nothing to resume.
      const period = live.find((s) => entitledUntil(s) > now)
      if (period && !renew) return subscriptionView(period)
      if (period) throw conflict('Este Plus foi pago uma vez e não se renova. Assine para ter renovação.')
      throw notFound('Nenhuma assinatura ativa.')
    }
    if (sub.cancelAtPeriodEnd === !renew && !final) return subscriptionView(sub)
    if (sub.provider === this.provider?.id) {
      try {
        if (renew) await this.provider.resumeSubscription(sub.providerSubscriptionId)
        else await this.provider.cancelSubscription(sub.providerSubscriptionId, final)
      } catch (err) {
        this.log.error({ err: safeErr(err), provider: sub.provider }, renew ? 'billing: provider resume failed' : 'billing: provider cancel failed')
        throw new HttpError('internal', `Não foi possível ${renew ? 'retomar' : 'cancelar'} agora. Tente novamente.`, undefined, 502)
      }
    } else if (sub.provider !== 'sandbox') {
      // Renewals would keep being charged (or never restart) at a provider this server cannot reach.
      throw new HttpError('internal', 'Pagamentos indisponíveis no momento.', undefined, 503)
    }
    const { row, change } = await this.db.transaction(async (tx) => {
      const [updated] = await tx.update(subscriptions).set({ cancelAtPeriodEnd: !renew, updatedAt: new Date() })
        .where(eq(subscriptions.id, sub.id)).returning()
      return { row: updated!, change: await this.recompute(tx, userId, new Date(now)) }
    })
    await this.notify(change ? [change] : [])
    return subscriptionView(row)
  }

  /**
   * PUT /users/@me/cosmetics. Runs under the user-row lock recompute takes, so an item cannot be equipped while it
   * lapses. 400 for an unknown id or the wrong slot, 403 for an item the user does not hold right now.
   */
  async equip(userId: string, body: PutCosmeticsBody, now = new Date()): Promise<{ before: UserRow; after: UserRow }> {
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(users).where(eq(users.id, userId)).for('update')
      if (!before) throw notFound()
      const held = await tx.select({ sku: entitlements.sku, expiresAt: entitlements.expiresAt }).from(entitlements)
        .where(and(eq(entitlements.userId, userId), eq(entitlements.kind, 'cosmetic')))
      const owned = new Set(held.filter((e) => !e.expiresAt || e.expiresAt > now).map((e) => e.sku))
      const next: EquippedCosmetics = { ...before.cosmetics }
      const bad: Record<string, string> = {}
      for (const [slot, id] of Object.entries(body) as [CosmeticSlot, string | null | undefined][]) {
        if (id === undefined) continue
        if (id === null) {
          delete next[slot]
          continue
        }
        const p = productById(id)
        if (p?.kind !== 'cosmetic' || !p.cosmeticType || COSMETIC_SLOTS[p.cosmeticType] !== slot) bad[slot] = 'Item inexistente ou de outro espaço do perfil.'
        else if (!owned.has(id)) throw forbidden('Você não tem este item.')
        else next[slot] = id
      }
      if (Object.keys(bad).length) throw invalid(bad)
      const [after] = await tx.update(users).set({ cosmetics: next }).where(eq(users.id, userId)).returning()
      return { before, after: after! }
    })
  }

  // ---- provider events ----------------------------------------------------------------------------------------------

  /** POST /billing/webhooks/:provider. Throws WebhookRejected (→ 401) for unauthentic requests. */
  async handleWebhook(providerId: string, req: WebhookRequest): Promise<{ duplicate: boolean }> {
    if (!this.provider || this.provider.id !== providerId) throw notFound()
    const event = await this.provider.parseWebhook(req)
    return this.apply(event, sha256(req.rawBody))
  }

  /**
   * Applies a verified event exactly once (billing_events unique key; a failed transaction leaves no row, so the
   * provider's retry is processed again). Out-of-order updates older than the last applied state are ignored.
   */
  async apply(event: VerifiedEvent, payloadSha256: string, now = new Date()): Promise<{ duplicate: boolean }> {
    const provider = this.provider!.id
    const result = await this.db.transaction(async (tx) => {
      const [fresh] = await tx.insert(billingEvents)
        .values({ id: uuidv7(), provider, providerEventId: event.id.slice(0, 200), type: event.type.slice(0, 64), payloadSha256 })
        .onConflictDoNothing().returning({ id: billingEvents.id })
      if (!fresh) return null
      const touched = touchedSet()
      for (const u of event.updates) {
        if (u.kind === 'subscription') await this.applySubscription(tx, u, now, touched)
        else await this.applyOrder(tx, u, now, touched)
      }
      return { touched, changes: await this.recomputeTouched(tx, touched, now) }
    })
    if (!result) return { duplicate: true }
    await this.afterCommit(result.touched, result.changes)
    return { duplicate: false }
  }

  private async recomputeTouched(tx: Tx, touched: Touched, now: Date): Promise<Change[]> {
    const out: Change[] = []
    for (const userId of touched.users) {
      const c = await this.recompute(tx, userId, now)
      if (c) out.push(c)
    }
    for (const spaceId of [...touched.spaces]) {
      if (!await recomputeSpace(tx, spaceId, (p) => this.counts(p))) touched.spaces.delete(spaceId)
    }
    return out
  }

  private async applySubscription(tx: Tx, u: SubscriptionUpdate, now: Date, touched: Touched): Promise<void> {
    const provider = this.provider!.id
    const [s] = await tx.select().from(subscriptions)
      .where(and(eq(subscriptions.id, u.reference), eq(subscriptions.provider, provider))).for('update')
    if (!s) {
      this.log.warn({ provider, reference: u.reference }, 'billing: update for an unknown subscription')
      return
    }
    if (s.providerUpdatedAt && u.occurredAt < s.providerUpdatedAt) {
      this.log.info({ provider, reference: u.reference }, 'billing: stale subscription update ignored')
      return
    }
    if (u.status === 'active' && u.amountCents !== undefined && u.amountCents < s.amountCents) {
      this.log.error({ provider, reference: u.reference }, 'billing: subscription charged below its price, not activated')
      return
    }
    const periodEnd = u.currentPeriodEnd ?? s.currentPeriodEnd
    const live = s.status === 'active' || s.status === 'past_due'
    let status = s.status
    let cancelAtPeriodEnd = s.cancelAtPeriodEnd
    switch (u.status) {
      case 'active':
        // A revoked (refunded) subscription never comes back. Active at the provider = renewing (e.g. resumed, also
        // from the payer's own account at the provider), so a cancel undone there is undone here too.
        if (s.status !== 'canceled') {
          status = 'active'
          cancelAtPeriodEnd = s.refundRequestedAt ? true : false
        }
        break
      case 'past_due':
        if (live) status = 'past_due'
        break
      case 'ended':
        cancelAtPeriodEnd = true
        if (s.status === 'pending' || (live && !(periodEnd && periodEnd.getTime() > now.getTime()))) status = 'expired'
        break
      case 'revoked':
        status = 'canceled'
        break
      case 'pending':
        break
    }
    const firstActivation = status === 'active' && !s.startedAt
    await tx.update(subscriptions).set({
      status, cancelAtPeriodEnd, currentPeriodEnd: periodEnd,
      providerSubscriptionId: u.providerSubscriptionId ?? s.providerSubscriptionId,
      providerPaymentId: s.providerPaymentId ?? u.providerPaymentId ?? null,
      ...(firstActivation ? { startedAt: u.occurredAt < now ? u.occurredAt : now } : {}),
      providerUpdatedAt: u.occurredAt, updatedAt: now,
    }).where(eq(subscriptions.id, s.id))
    if (status === 'canceled') await this.revokeClaims(tx, [s.id])
    if (firstActivation) touched.receipts.push({ kind: 'subscription', id: s.id })
    touched.users.add(s.userId)
  }

  /** The annual items claimed under refunded subscriptions go with them. */
  private async revokeClaims(tx: Tx, subscriptionIds: string[]): Promise<void> {
    if (!subscriptionIds.length) return
    await tx.update(orders).set({ status: 'refunded', updatedAt: new Date() })
      .where(and(inArray(orders.subscriptionId, subscriptionIds), eq(orders.amountCents, 0), eq(orders.status, 'paid')))
  }

  private async applyOrder(tx: Tx, u: OrderUpdate, now: Date, touched: Touched): Promise<void> {
    const provider = this.provider!.id
    const [o] = await tx.select().from(orders).where(and(eq(orders.id, u.reference), eq(orders.provider, provider))).for('update')
    if (!o) {
      this.log.warn({ provider, reference: u.reference }, 'billing: update for an unknown order')
      return
    }
    if (u.providerPaymentId && o.providerPaymentId && u.providerPaymentId !== o.providerPaymentId) {
      // The same checkout paid twice: the extra payment needs a manual refund.
      this.log.error({ provider, reference: u.reference }, 'billing: second payment for one order, refund it manually')
      return
    }
    if (o.providerUpdatedAt && u.occurredAt < o.providerUpdatedAt) {
      this.log.info({ provider, reference: u.reference }, 'billing: stale order update ignored')
      return
    }
    let status = o.status
    switch (u.status) {
      case 'paid':
        if (o.status === 'refunded') break
        if ((u.amountCents !== undefined && u.amountCents < o.amountCents) || (u.currency && u.currency !== o.currency)) {
          this.log.error({ provider, reference: u.reference }, 'billing: order paid below its price, not granted')
          return
        }
        status = 'paid'
        break
      case 'failed':
        if (o.status === 'pending') status = 'canceled'
        break
      case 'refunded':
        status = 'refunded'
        break
      case 'pending':
        break
    }
    const paid = status === 'paid' && o.status !== 'paid'
    const refunded = status === 'refunded' && o.status !== 'refunded'
    await tx.update(orders).set({
      status, providerPaymentId: u.providerPaymentId ?? o.providerPaymentId, providerUpdatedAt: u.occurredAt, updatedAt: now,
      ...(paid && !o.paidAt ? { paidAt: now } : {}),
    }).where(eq(orders.id, o.id))
    touched.users.add(o.userId)
    if (paid) touched.receipts.push({ kind: 'order', id: o.id })

    const [contribution] = await tx.select({ spaceId: spaceUpgradeContributions.spaceId }).from(spaceUpgradeContributions)
      .where(eq(spaceUpgradeContributions.orderId, o.id))
    if (contribution && (paid || refunded)) touched.spaces.add(contribution.spaceId)

    const [gift] = await tx.select().from(gifts).where(eq(gifts.orderId, o.id)).for('update')
    if (gift) {
      if (paid && gift.status === 'unpaid') {
        const later = gift.deliverAt && gift.deliverAt > now
        await tx.update(gifts).set({ status: later ? 'scheduled' : 'delivered', deliveredAt: later ? null : now, updatedAt: now }).where(eq(gifts.id, gift.id))
        touched.gifts.set(gift.id, later ? 'update' : 'received')
      } else if (refunded && !['declined', 'refunded', 'canceled'].includes(gift.status)) {
        // The payer's 7-day right: whatever the recipient opened goes away, with GIFT_UPDATE as the notice.
        await tx.update(gifts).set({ status: 'refunded', updatedAt: now }).where(eq(gifts.id, gift.id))
        if (gift.recipientId) touched.users.add(gift.recipientId)
        touched.gifts.set(gift.id, 'update')
      } else if (status === 'canceled' && gift.status === 'unpaid') {
        await tx.update(gifts).set({ status: 'canceled', updatedAt: now }).where(eq(gifts.id, gift.id))
        touched.gifts.set(gift.id, 'update')
      }
    } else if (paid && productById(o.productId)?.kind === 'plan') {
      // Plus paid once (Pix): a period with no renewal, stacked after the plan time the buyer already has.
      await this.grantPeriod(tx, o.userId, {
        kind: 'period', productId: o.productId, provider: o.provider, orderId: o.id, amountCents: o.amountCents,
        months: productById(o.productId)!.interval === 'year' ? 12 : 1,
      }, now)
    }
    if (refunded) {
      // A refunded one-time Plus (bought or gifted) ends now, and the annual item claimed under it goes too.
      const periods = await tx.update(subscriptions).set({ status: 'canceled', updatedAt: now })
        .where(and(eq(subscriptions.orderId, o.id), inArray(subscriptions.status, LIVE))).returning({ id: subscriptions.id, userId: subscriptions.userId })
      for (const p of periods) touched.users.add(p.userId)
      await this.revokeClaims(tx, periods.map((p) => p.id))
    }
  }

  /**
   * Rebuilds the user's entitlements, users.plan and users.plus_since from subscriptions, paid orders and accepted
   * gifts. null = nothing changed.
   */
  private async recompute(tx: Tx, userId: string, now: Date): Promise<Change | null> {
    // Payment rows of purged accounts move to the "removed user" (src/privacy.ts): they never grant anything again.
    if (userId === REMOVED_USER_ID) return null
    const [u] = await tx.select({ plan: users.plan, cosmetics: users.cosmetics, plusSince: users.plusSince }).from(users)
      .where(eq(users.id, userId)).for('update')
    if (!u) return null
    const subs = (await tx.select().from(subscriptions).where(eq(subscriptions.userId, userId))).filter((s) => this.counts(s.provider))
    const cover = coverage(subs, now.getTime())
    const own = await tx.select({ id: orders.id, items: orders.items, provider: orders.provider }).from(orders)
      .leftJoin(gifts, eq(gifts.orderId, orders.id))
      .where(and(eq(orders.userId, userId), eq(orders.status, 'paid'), isNull(gifts.id)))
    const received = await tx.select({ id: orders.id, items: orders.items, provider: orders.provider }).from(gifts)
      .innerJoin(orders, eq(orders.id, gifts.orderId))
      .where(and(eq(gifts.recipientId, userId), eq(gifts.status, 'accepted'), eq(orders.status, 'paid')))

    const desired = new Map<string, Desired>()
    const plan: PlanId = (cover?.best.planId as PlanId | undefined) ?? 'free'
    if (cover) {
      const until = { source: 'subscription' as const, sourceId: cover.best.id, expiresAt: new Date(cover.until) }
      desired.set(`plan:${plan}`, { kind: 'plan', ...until })
      for (const p of includedIn(plan, now.getTime())) desired.set(p.id, { kind: 'cosmetic', ...until })
    }
    // Owned beats included (no expiry).
    for (const o of [...own, ...received]) {
      if (!this.counts(o.provider)) continue
      for (const sku of o.items) desired.set(sku, { kind: 'cosmetic', source: 'order', sourceId: o.id, expiresAt: null })
    }
    // Badge base: while a paid Plus (not a pass) is active, now − summed Plus time; stable as time passes.
    const plusSince = cover && plan === 'plus' && cover.best.kind !== 'pass' ? new Date(now.getTime() - tenureMs(subs, now.getTime())) : null

    const current = await tx.select().from(entitlements).where(eq(entitlements.userId, userId))
    const same = current.length === desired.size && current.every((c) => {
      const d = desired.get(c.sku)
      return d && d.kind === c.kind && d.source === c.source && d.sourceId === c.sourceId && iso(d.expiresAt ?? null) === iso(c.expiresAt)
    })
    // An equipped item the user no longer holds (plan ended, refund) comes off.
    const equipped = Object.entries(u.cosmetics)
    const kept = equipped.filter(([, sku]) => desired.has(sku))
    const cosmeticsChanged = kept.length !== equipped.length
    const planChanged = plan !== u.plan
    const sinceChanged = iso(plusSince) !== iso(u.plusSince)
    if (same && !planChanged && !cosmeticsChanged && !sinceChanged) return null
    if (!same) {
      await tx.delete(entitlements).where(eq(entitlements.userId, userId))
      if (desired.size) await tx.insert(entitlements).values([...desired].map(([sku, d]) => ({ userId, sku, ...d })))
    }
    if (planChanged || cosmeticsChanged || sinceChanged) {
      await tx.update(users).set({
        ...(planChanged ? { plan } : {}), ...(cosmeticsChanged ? { cosmetics: Object.fromEntries(kept) } : {}), ...(sinceChanged ? { plusSince } : {}),
      }).where(eq(users.id, userId))
    }
    const shown = (c: [string, string][]) => c.filter(([slot]) => !PRIVATE_COSMETIC_SLOTS.includes(slot as CosmeticSlot)).length
    // The badge others see changes only with the plan or with the summed time (both move plusSince).
    return { userId, planChanged, cosmeticsChanged, profileChanged: shown(kept) !== shown(equipped) || sinceChanged }
  }

  /**
   * After commit: ENTITLEMENTS_UPDATE; ME_UPDATE when the plan, the equipped cosmetics or the badge changed;
   * USER_UPDATE to the profile audience when what others see changed; the new stream presets at the SFU on a plan change.
   */
  private async notify(changes: Change[]): Promise<void> {
    for (const c of changes) {
      const [row] = await this.db.select().from(users).where(eq(users.id, c.userId))
      if (!row) continue
      this.hub.dispatch([c.userId], 'ENTITLEMENTS_UPDATE', await this.entitlementsOf(c.userId, row.plan))
      if (c.planChanged || c.cosmeticsChanged || c.profileChanged) this.hub.dispatch([c.userId], 'ME_UPDATE', meView(row, this.config.files.maxAttachmentBytes))
      if (c.profileChanged) this.hub.dispatch(await profileAudience(this.db, c.userId), 'USER_UPDATE', publicUser(row))
      if (c.planChanged) await this.voice.setStreamPresets(c.userId, this.plan(row.plan).streamPresets)
    }
  }

  /** `now`: the sweep's clock, for whether a Casa is still lit. */
  private async afterCommit(t: Touched, changes: Change[], now = new Date()): Promise<void> {
    await this.notify(changes)
    for (const spaceId of t.spaces) {
      const [s] = await this.db.select().from(spaces).where(eq(spaces.id, spaceId))
      if (s) this.hub.dispatch(await spaceMemberIds(this.db, spaceId), 'SPACE_UPGRADE_UPDATE', { spaceId, upgrade: spaceUpgradeState(s, now.getTime()) })
    }
    for (const [giftId, what] of t.gifts) await this.notifyGift(giftId, what)
    for (const r of t.receipts) await this.sendReceipt(r.kind, r.id).catch((err: unknown) => this.log.error({ err: safeErr(err) }, 'billing: receipt not sent'))
  }

  /** GIFT_RECEIVED (just delivered) to the recipient, GIFT_UPDATE to the sender and, once it is theirs to see, the recipient. */
  private async notifyGift(giftId: string, what: 'received' | 'update'): Promise<void> {
    const [g] = await this.db.select().from(gifts).where(eq(gifts.id, giftId))
    if (!g) return
    if (g.senderId) this.hub.dispatch([g.senderId], 'GIFT_UPDATE', (await this.giftViews([g], g.senderId))[0]!)
    if (!g.recipientId || !g.deliveredAt) return
    this.hub.dispatch([g.recipientId], what === 'received' ? 'GIFT_RECEIVED' : 'GIFT_UPDATE', (await this.giftViews([g], g.recipientId))[0]!)
    if (what !== 'received' || !this.mail) return
    const [r] = await this.db.select().from(users).where(eq(users.id, g.recipientId))
    const [s] = g.senderId ? await this.db.select({ username: users.username }).from(users).where(eq(users.id, g.senderId)) : []
    // In-app only for 16–17 (growth-plan §1.3: no mail nudges to teens); never to an unverified address.
    if (r?.emailVerifiedAt && ageBracketOf(r) !== 'teen') this.mail.send({ to: r.email, kind: 'gift', ...giftReceivedMail(s?.username ?? null) })
  }

  /** E-mail receipt to the payer (Decreto 7.962 art. 4º): what, how much, one-time or renewing, the 7-day right. */
  private async sendReceipt(kind: 'order' | 'subscription', id: string): Promise<void> {
    if (!this.mail) return
    const row = kind === 'order'
      ? (await this.db.select().from(orders).where(eq(orders.id, id)))[0]
      : (await this.db.select().from(subscriptions).where(eq(subscriptions.id, id)))[0]
    if (!row || row.amountCents === 0) return
    const [payer] = await this.db.select().from(users).where(eq(users.id, row.userId))
    if (!payer?.emailVerifiedAt) return
    const product = productById(row.productId)
    const [g] = kind === 'order' ? await this.db.select({ recipientId: gifts.recipientId }).from(gifts).where(eq(gifts.orderId, id)) : []
    const [to] = g?.recipientId ? await this.db.select({ username: users.username }).from(users).where(eq(users.id, g.recipientId)) : []
    this.mail.send({
      to: payer.email, kind: 'receipt',
      ...receiptMail({
        reference: id, productName: product?.name ?? row.productId, amountCents: row.amountCents, paidAt: new Date(),
        renews: kind === 'subscription' ? (product?.interval ?? 'month') : null, giftTo: to?.username ?? null,
        termsUrl: this.config.legal.url,
      }),
    })
  }

  // ---- expiry job ---------------------------------------------------------------------------------------------------

  /**
   * Expiry job: ends lapsed subscriptions and abandoned checkouts, delivers scheduled gifts, announces Casas that
   * ended, adds the Plus wardrobe's new item, rebuilds the affected users. Returns users touched.
   */
  sweep(now = new Date()): Promise<number> {
    this.sweeping ??= this.runSweep(now).finally(() => { this.sweeping = undefined })
    return this.sweeping
  }

  private async runSweep(now: Date): Promise<number> {
    const graceCut = new Date(now.getTime() - GRACE_MS)
    const ended = await this.db.update(subscriptions).set({ status: 'expired', updatedAt: now }).where(and(
      inArray(subscriptions.status, LIVE),
      or(
        isNull(subscriptions.currentPeriodEnd),
        and(eq(subscriptions.cancelAtPeriodEnd, true), lte(subscriptions.currentPeriodEnd, now)),
        lte(subscriptions.currentPeriodEnd, graceCut),
      ),
    )).returning({ userId: subscriptions.userId })
    const abandoned = new Date(now.getTime() - PENDING_TTL_MS)
    await this.db.update(subscriptions).set({ status: 'expired', updatedAt: now })
      .where(and(eq(subscriptions.status, 'pending'), lt(subscriptions.createdAt, abandoned)))
    const expiredOrders = await this.db.update(orders).set({ status: 'expired', updatedAt: now })
      .where(and(eq(orders.status, 'pending'), lt(orders.createdAt, abandoned))).returning({ id: orders.id })
    const touched = touchedSet()
    if (expiredOrders.length) {
      const canceled = await this.db.update(gifts).set({ status: 'canceled', updatedAt: now })
        .where(and(eq(gifts.status, 'unpaid'), inArray(gifts.orderId, expiredOrders.map((o) => o.id)))).returning({ id: gifts.id })
      for (const g of canceled) touched.gifts.set(g.id, 'update')
    }
    const due = await this.db.update(gifts).set({ status: 'delivered', deliveredAt: now, updatedAt: now })
      .where(and(eq(gifts.status, 'scheduled'), lte(gifts.deliverAt, now))).returning({ id: gifts.id })
    for (const g of due) touched.gifts.set(g.id, 'received')
    const prev = this.lastSweepAt
    this.lastSweepAt = now
    if (prev && prev < now) {
      const casas = await this.db.select({ id: spaces.id }).from(spaces).where(and(gt(spaces.upgradeEndsAt, prev), lte(spaces.upgradeEndsAt, now)))
      for (const c of casas) touched.spaces.add(c.id)
    }
    // Safety net: anything whose derived expiry passed gets rebuilt even if no status changed.
    const lapsed = await this.db.selectDistinct({ userId: entitlements.userId }).from(entitlements).where(lte(entitlements.expiresAt, now))
    const ids = new Set([...ended, ...lapsed].map((r) => r.userId))
    // First sweep after a start (the catalog may have changed: retired items, a new wardrobe item) or a wardrobe
    // item arriving now: rebuild every user who holds something.
    const wardrobe = PRODUCTS.some((p) => p.includedFrom && (!prev || (new Date(p.includedFrom) > prev && new Date(p.includedFrom) <= now)))
    if (!prev || wardrobe) {
      const holders = await this.db.selectDistinct({ userId: entitlements.userId }).from(entitlements)
      for (const h of holders) ids.add(h.userId)
    }
    const changes: Change[] = []
    for (const id of ids) {
      const c = await this.db.transaction((tx) => this.recompute(tx, id, now))
      if (c) changes.push(c)
    }
    await this.afterCommit(touched, changes, now)
    return ids.size
  }

  start(intervalMs = 60_000): void {
    this.timer = setInterval(() => {
      void this.sweep().catch((err: unknown) => this.log.error({ err: safeErr(err) }, 'billing sweep failed'))
    }, intervalMs)
    this.timer.unref()
  }

  async stop(): Promise<void> {
    clearInterval(this.timer)
    this.tryOns.stop()
    await this.sweeping?.catch(() => {})
  }

  /**
   * GET /billing/sandbox/checkout/:reference: the sandbox's "hosted payment page". The signed link stands in for
   * the provider's own page, so approving here is the provider confirming, as a webhook would.
   */
  async sandboxCheckout(reference: string, sig: string, outcome: 'approve' | 'decline'): Promise<'subscription' | 'order'> {
    const sandbox = this.sandbox
    if (!sandbox) throw notFound()
    if (!safeEqualHex(sig, sandbox.checkoutSig(reference))) throw forbidden('Link de pagamento inválido.')
    const [sub] = await this.db.select().from(subscriptions).where(eq(subscriptions.id, reference))
    const [order] = sub ? [] : await this.db.select().from(orders).where(eq(orders.id, reference))
    const now = new Date()
    let update: BillingUpdate
    if (sub) {
      const end = addMonths(now, productById(sub.productId)?.interval === 'year' ? 12 : 1)
      update = outcome === 'approve'
        ? { kind: 'subscription', reference, status: 'active', currentPeriodEnd: end, amountCents: sub.amountCents, providerPaymentId: `sbx_pay_${reference}`, occurredAt: now }
        : { kind: 'subscription', reference, status: 'ended', occurredAt: now }
    } else if (order) {
      update = {
        kind: 'order', reference, providerPaymentId: `sbx_pay_${reference}`, status: outcome === 'approve' ? 'paid' : 'failed',
        amountCents: order.amountCents, currency: order.currency, occurredAt: now,
      }
    } else {
      throw notFound()
    }
    await this.apply({ id: `checkout:${reference}:${outcome}`, type: 'sandbox.checkout', updates: [update] }, sha256(JSON.stringify(update)), now)
    return update.kind
  }

  /** For casa.ts and the Casa routes: the same refusal and checkout plumbing as everything else. */
  async contribute(user: UserRow, spaceId: string, productId: string, showOnWall: boolean): Promise<CheckoutResponse> {
    const product = this.sellable(productId, ['space_upgrade'])
    return this.createOrder(user, product, product.priceBrlCents, [], { spaceId, showOnWall, title: product.name })
  }

  /** After a Casa setting changed (casa.ts): SPACE_UPGRADE_UPDATE to the members. */
  async spaceChanged(spaceId: string): Promise<void> {
    await this.afterCommit({ ...touchedSet(), spaces: new Set([spaceId]) }, [])
  }

  /** Wishlist helper (wishlist.ts): cosmetics owned for good. */
  owned(userId: string): Promise<Set<string>> {
    return this.ownedSkus(userId)
  }
}
