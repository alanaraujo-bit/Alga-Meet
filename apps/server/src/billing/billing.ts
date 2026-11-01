/**
 * Entitlements engine. Subscriptions and orders change state only through `apply` (a verified provider event,
 * stored idempotently in billing_events) and the expiry sweep; `entitlements` + `users.plan` are rebuilt from them
 * by `recompute` in the same transaction, then ENTITLEMENTS_UPDATE / ME_UPDATE go to the user's sockets.
 */
import { createHash } from 'node:crypto'
import {
  uuidv7,
  type BillingCatalog, type BillingMe, type CheckoutResponse, type Entitlement, type Entitlements, type Order, type PlanId,
  type PlanSummary, type Subscription,
} from '@alga/shared'
import { and, desc, eq, inArray, isNull, lt, lte, notInArray, or } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import type { Config } from '../config.js'
import type { Db, Tx } from '../db/index.js'
import {
  billingEvents, entitlements, orders, products, subscriptions, users,
  type OrderRow, type SubscriptionRow, type UserRow,
} from '../db/schema.js'
import { HttpError, conflict, forbidden, notFound, safeErr } from '../errors.js'
import type { Hub } from '../gateway/hub.js'
import { meView } from '../views.js'
import type { Voice } from '../voice.js'
import { CATALOG_VERSION, PLANS, PLAN_RANK, PRODUCTS, planSummary, productById } from './catalog.js'
import { MercadoPagoProvider } from './mercadopago.js'
import {
  SandboxProvider, safeEqualHex,
  type OrderUpdate, type PaymentProvider, type SubscriptionUpdate, type VerifiedEvent, type WebhookRequest,
} from './provider.js'

const DAY_MS = 24 * 60 * 60 * 1000
/** Auto-renewing and past_due subscriptions keep their perks this long past the period end (renewals can be late). */
export const GRACE_MS = 3 * DAY_MS
/** Unpaid checkouts expire after this. */
export const PENDING_TTL_MS = DAY_MS
const LIVE = ['active', 'past_due'] as const

/** Until when a subscription grants its plan (0 = not at all). */
export const entitledUntil = (s: Pick<SubscriptionRow, 'status' | 'currentPeriodEnd' | 'cancelAtPeriodEnd'>): number =>
  (s.status === 'active' || s.status === 'past_due') && s.currentPeriodEnd
    ? s.currentPeriodEnd.getTime() + (s.cancelAtPeriodEnd ? 0 : GRACE_MS)
    : 0

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
})

const orderView = (o: OrderRow): Order => ({
  id: o.id,
  productId: o.productId,
  status: o.status,
  amountCents: o.amountCents,
  currency: o.currency,
  provider: o.provider,
  sandbox: o.provider === 'sandbox',
  createdAt: o.createdAt.toISOString(),
})

interface Change { userId: string; planChanged: boolean }
type Desired = Omit<typeof entitlements.$inferInsert, 'userId' | 'sku'>

export class Billing {
  private timer: NodeJS.Timeout | undefined
  private sweeping: Promise<number> | undefined

  constructor(
    private readonly config: Config,
    private readonly db: Db,
    private readonly hub: Hub,
    private readonly voice: Voice,
    private readonly log: FastifyBaseLogger,
    readonly provider: PaymentProvider | null = createProvider(config),
  ) {}

  get sandbox(): SandboxProvider | null {
    return this.provider instanceof SandboxProvider ? this.provider : null
  }

  plan(id: PlanId): PlanSummary {
    return planSummary(id, this.config.files.maxAttachmentBytes)
  }

  /** Upserts catalog.ts into `products`; SKUs no longer in the catalog go inactive. */
  async syncCatalog(): Promise<void> {
    const now = new Date()
    await this.db.transaction(async (tx) => {
      for (const p of PRODUCTS) {
        const row = {
          kind: p.kind, planId: p.planId ?? null, interval: p.interval ?? null, cosmeticType: p.cosmeticType ?? null,
          name: p.name, priceBrlCents: p.priceBrlCents, priceUsdCents: p.priceUsdCents, active: true,
          catalogVersion: CATALOG_VERSION, updatedAt: now,
        }
        await tx.insert(products).values({ id: p.id, ...row }).onConflictDoUpdate({ target: products.id, set: row })
      }
      await tx.update(products).set({ active: false, updatedAt: now }).where(notInArray(products.id, PRODUCTS.map((p) => p.id)))
    })
  }

  catalog(): BillingCatalog {
    return {
      version: CATALOG_VERSION,
      provider: this.provider ? { id: this.provider.id, sandbox: this.provider.sandbox } : null,
      plans: (Object.keys(PLANS) as PlanId[]).map((id) => this.plan(id)),
      products: PRODUCTS,
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
    const [subs, ords, ents] = await Promise.all([
      this.db.select().from(subscriptions).where(eq(subscriptions.userId, user.id)).orderBy(desc(subscriptions.id)).limit(50),
      this.db.select().from(orders).where(eq(orders.userId, user.id)).orderBy(desc(orders.id)).limit(100),
      this.entitlementsOf(user.id, user.plan),
    ])
    const current = subs.find((s) => entitledUntil(s) > Date.now()) ?? subs.find((s) => s.status !== 'pending')
    return { ...ents, subscription: current ? subscriptionView(current) : null, subscriptions: subs.map(subscriptionView), orders: ords.map(orderView) }
  }

  /** Creates the pending subscription/order and the provider's page. Grants nothing. */
  async checkout(user: UserRow, productId: string): Promise<CheckoutResponse> {
    const provider = this.provider
    if (!provider) throw new HttpError('internal', 'Pagamentos indisponíveis no momento.', undefined, 503)
    const product = productById(productId)
    if (!product?.purchasable) throw notFound('Produto não encontrado.')
    const id = uuidv7()
    const amountCents = product.priceBrlCents
    const kind = product.kind === 'plan' ? 'subscription' as const : 'order' as const
    if (kind === 'subscription') {
      const live = await this.db.select().from(subscriptions).where(and(eq(subscriptions.userId, user.id), inArray(subscriptions.status, LIVE)))
      if (live.some((s) => entitledUntil(s) > Date.now())) throw conflict('Você já tem uma assinatura ativa.')
      await this.db.insert(subscriptions).values({
        id, userId: user.id, productId: product.id, planId: product.planId!, status: 'pending', amountCents, currency: 'BRL', provider: provider.id,
      })
    } else {
      const [owned] = await this.db.select({ id: orders.id }).from(orders)
        .where(and(eq(orders.userId, user.id), eq(orders.productId, product.id), eq(orders.status, 'paid'))).limit(1)
      if (owned) throw conflict('Você já tem este item.')
      await this.db.insert(orders).values({ id, userId: user.id, productId: product.id, status: 'pending', amountCents, currency: 'BRL', provider: provider.id })
    }
    let page: Awaited<ReturnType<PaymentProvider['createCheckout']>>
    try {
      page = await provider.createCheckout({ kind, reference: id, product, amountCents, currency: 'BRL', payerEmail: user.email })
    } catch (err) {
      this.log.error({ err: safeErr(err), provider: provider.id, kind }, 'billing: checkout creation failed')
      const now = new Date()
      if (kind === 'subscription') await this.db.update(subscriptions).set({ status: 'expired', updatedAt: now }).where(eq(subscriptions.id, id))
      else await this.db.update(orders).set({ status: 'expired', updatedAt: now }).where(eq(orders.id, id))
      throw new HttpError('internal', 'Não foi possível iniciar o pagamento. Tente novamente.', undefined, 502)
    }
    if (page.providerSubscriptionId) {
      await this.db.update(subscriptions).set({ providerSubscriptionId: page.providerSubscriptionId }).where(eq(subscriptions.id, id))
    }
    return { url: page.url, reference: id, kind, provider: provider.id, sandbox: provider.sandbox }
  }

  /** Stops renewals at the provider; the plan lasts until currentPeriodEnd (then the sweep expires it). Idempotent. */
  async cancel(userId: string): Promise<Subscription> {
    const now = Date.now()
    const live = await this.db.select().from(subscriptions).where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, LIVE)))
    const sub = live.filter((s) => entitledUntil(s) > now).sort((a, b) => entitledUntil(b) - entitledUntil(a))[0]
    if (!sub) throw notFound('Nenhuma assinatura ativa.')
    if (sub.cancelAtPeriodEnd) return subscriptionView(sub)
    if (sub.provider === this.provider?.id) {
      try {
        await this.provider.cancelSubscription(sub.providerSubscriptionId)
      } catch (err) {
        this.log.error({ err: safeErr(err), provider: sub.provider }, 'billing: provider cancel failed')
        throw new HttpError('internal', 'Não foi possível cancelar agora. Tente novamente.', undefined, 502)
      }
    } else if (sub.provider !== 'sandbox') {
      // Renewals would keep being charged at a provider this server cannot reach.
      throw new HttpError('internal', 'Pagamentos indisponíveis no momento.', undefined, 503)
    }
    const { row, change } = await this.db.transaction(async (tx) => {
      const [updated] = await tx.update(subscriptions).set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
        .where(eq(subscriptions.id, sub.id)).returning()
      return { row: updated!, change: await this.recompute(tx, userId, new Date(now)) }
    })
    await this.notify(change ? [change] : [])
    return subscriptionView(row)
  }

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
    const changes = await this.db.transaction(async (tx) => {
      const [fresh] = await tx.insert(billingEvents)
        .values({ id: uuidv7(), provider, providerEventId: event.id.slice(0, 200), type: event.type.slice(0, 64), payloadSha256 })
        .onConflictDoNothing().returning({ id: billingEvents.id })
      if (!fresh) return null
      const touched = new Set<string>()
      for (const u of event.updates) {
        const userId = u.kind === 'subscription' ? await this.applySubscription(tx, u, now) : await this.applyOrder(tx, u)
        if (userId) touched.add(userId)
      }
      const out: Change[] = []
      for (const userId of touched) {
        const c = await this.recompute(tx, userId, now)
        if (c) out.push(c)
      }
      return out
    })
    if (!changes) return { duplicate: true }
    await this.notify(changes)
    return { duplicate: false }
  }

  private async applySubscription(tx: Tx, u: SubscriptionUpdate, now: Date): Promise<string | null> {
    const provider = this.provider!.id
    const [s] = await tx.select().from(subscriptions)
      .where(and(eq(subscriptions.id, u.reference), eq(subscriptions.provider, provider))).for('update')
    if (!s) {
      this.log.warn({ provider, reference: u.reference }, 'billing: update for an unknown subscription')
      return null
    }
    if (s.providerUpdatedAt && u.occurredAt < s.providerUpdatedAt) {
      this.log.info({ provider, reference: u.reference }, 'billing: stale subscription update ignored')
      return null
    }
    if (u.status === 'active' && u.amountCents !== undefined && u.amountCents < s.amountCents) {
      this.log.error({ provider, reference: u.reference }, 'billing: subscription charged below its price, not activated')
      return null
    }
    const periodEnd = u.currentPeriodEnd ?? s.currentPeriodEnd
    const live = s.status === 'active' || s.status === 'past_due'
    let status = s.status
    let cancelAtPeriodEnd = s.cancelAtPeriodEnd
    switch (u.status) {
      case 'active':
        if (s.status !== 'canceled') status = 'active' // a revoked (refunded) subscription never comes back
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
    await tx.update(subscriptions).set({
      status, cancelAtPeriodEnd, currentPeriodEnd: periodEnd,
      providerSubscriptionId: u.providerSubscriptionId ?? s.providerSubscriptionId,
      providerUpdatedAt: u.occurredAt, updatedAt: now,
    }).where(eq(subscriptions.id, s.id))
    return s.userId
  }

  private async applyOrder(tx: Tx, u: OrderUpdate): Promise<string | null> {
    const provider = this.provider!.id
    const [o] = await tx.select().from(orders).where(and(eq(orders.id, u.reference), eq(orders.provider, provider))).for('update')
    if (!o) {
      this.log.warn({ provider, reference: u.reference }, 'billing: update for an unknown order')
      return null
    }
    if (u.providerPaymentId && o.providerPaymentId && u.providerPaymentId !== o.providerPaymentId) {
      // The same checkout paid twice: the extra payment needs a manual refund.
      this.log.error({ provider, reference: u.reference }, 'billing: second payment for one order, refund it manually')
      return null
    }
    if (o.providerUpdatedAt && u.occurredAt < o.providerUpdatedAt) {
      this.log.info({ provider, reference: u.reference }, 'billing: stale order update ignored')
      return null
    }
    let status = o.status
    switch (u.status) {
      case 'paid':
        if (o.status === 'refunded') break
        if ((u.amountCents !== undefined && u.amountCents < o.amountCents) || (u.currency && u.currency !== o.currency)) {
          this.log.error({ provider, reference: u.reference }, 'billing: order paid below its price, not granted')
          return null
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
    await tx.update(orders).set({
      status, providerPaymentId: u.providerPaymentId ?? o.providerPaymentId, providerUpdatedAt: u.occurredAt, updatedAt: new Date(),
    }).where(eq(orders.id, o.id))
    return o.userId
  }

  /** Rebuilds the user's entitlements and users.plan from subscriptions + paid orders. null = nothing changed. */
  private async recompute(tx: Tx, userId: string, now: Date): Promise<Change | null> {
    const [u] = await tx.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).for('update')
    if (!u) return null
    // Defense in depth: sandbox rows (e.g. a copied dev database) never grant anything in production.
    const counts = (provider: string) => this.config.env !== 'production' || provider !== 'sandbox'
    const subs = await tx.select().from(subscriptions).where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, LIVE)))
    const best = subs
      .filter((s) => counts(s.provider) && entitledUntil(s) > now.getTime() && s.planId in PLANS)
      .sort((a, b) => PLAN_RANK[b.planId as PlanId] - PLAN_RANK[a.planId as PlanId] || entitledUntil(b) - entitledUntil(a))[0]
    const paid = await tx.select({ id: orders.id, productId: orders.productId, provider: orders.provider }).from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.status, 'paid')))

    const desired = new Map<string, Desired>()
    const plan: PlanId = (best?.planId as PlanId | undefined) ?? 'free'
    if (best) {
      const until = { source: 'subscription' as const, sourceId: best.id, expiresAt: new Date(entitledUntil(best)) }
      desired.set(`plan:${plan}`, { kind: 'plan', ...until })
      for (const p of PRODUCTS) if (p.includedIn?.includes(plan)) desired.set(p.id, { kind: 'cosmetic', ...until })
    }
    // Owned beats included (no expiry).
    for (const o of paid) if (counts(o.provider)) desired.set(o.productId, { kind: 'cosmetic', source: 'order', sourceId: o.id, expiresAt: null })

    const current = await tx.select().from(entitlements).where(eq(entitlements.userId, userId))
    const same = current.length === desired.size && current.every((c) => {
      const d = desired.get(c.sku)
      return d && d.kind === c.kind && d.source === c.source && d.sourceId === c.sourceId && iso(d.expiresAt ?? null) === iso(c.expiresAt)
    })
    if (same && plan === u.plan) return null
    if (!same) {
      await tx.delete(entitlements).where(eq(entitlements.userId, userId))
      if (desired.size) await tx.insert(entitlements).values([...desired].map(([sku, d]) => ({ userId, sku, ...d })))
    }
    if (plan !== u.plan) await tx.update(users).set({ plan }).where(eq(users.id, userId))
    return { userId, planChanged: plan !== u.plan }
  }

  /** After commit: ENTITLEMENTS_UPDATE, and on a plan change ME_UPDATE + the new stream presets at the SFU. */
  private async notify(changes: Change[]): Promise<void> {
    for (const c of changes) {
      const [row] = await this.db.select().from(users).where(eq(users.id, c.userId))
      if (!row) continue
      this.hub.dispatch([c.userId], 'ENTITLEMENTS_UPDATE', await this.entitlementsOf(c.userId, row.plan))
      if (!c.planChanged) continue
      this.hub.dispatch([c.userId], 'ME_UPDATE', meView(row, this.config.files.maxAttachmentBytes))
      await this.voice.setStreamPresets(c.userId, this.plan(row.plan).streamPresets)
    }
  }

  /** Expiry job: ends lapsed subscriptions and abandoned checkouts, rebuilds the affected users. Returns users touched. */
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
    await this.db.update(orders).set({ status: 'expired', updatedAt: now })
      .where(and(eq(orders.status, 'pending'), lt(orders.createdAt, abandoned)))
    // Safety net: anything whose derived expiry passed gets rebuilt even if no status changed.
    const lapsed = await this.db.selectDistinct({ userId: entitlements.userId }).from(entitlements).where(lte(entitlements.expiresAt, now))
    const ids = new Set([...ended, ...lapsed].map((r) => r.userId))
    const changes: Change[] = []
    for (const id of ids) {
      const c = await this.db.transaction((tx) => this.recompute(tx, id, now))
      if (c) changes.push(c)
    }
    await this.notify(changes)
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
    let update: SubscriptionUpdate | OrderUpdate
    if (sub) {
      const end = new Date(now)
      end.setUTCMonth(end.getUTCMonth() + (productById(sub.productId)?.interval === 'year' ? 12 : 1))
      update = outcome === 'approve'
        ? { kind: 'subscription', reference, status: 'active', currentPeriodEnd: end, amountCents: sub.amountCents, occurredAt: now }
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
}
