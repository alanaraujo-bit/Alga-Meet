/**
 * Stripe adapter: Checkout Sessions (subscription mode for plans, payment mode for one-time orders) over plain fetch
 * (form-encoded, no SDK). Written from the public docs (docs.stripe.com, read 2026-11-04) and exercised only against
 * a simulated API until real test keys exist.
 *
 * API version is pinned (STRIPE_API_VERSION) for our requests; the webhook endpoint must be created with the same
 * version (docs/infra/stripe.md), because newer versions moved current_period_end, invoice.subscription and
 * invoice.payment_intent.
 *
 * Webhooks: `Stripe-Signature: t=<unix s>,v1=<hex>[,v1=…]` = HMAC-SHA256(STRIPE_WEBHOOK_SECRET, "<t>.<raw body>").
 * The body is signed, so its event object is trusted; ordering comes from event.created (Billing drops older ones).
 */
import type { BillingProviderId } from '@alga/shared'
import {
  WebhookRejected, hmacHex, header, safeEqualHex,
  type BillingUpdate, type CheckoutInput, type PaymentProvider, type SubscriptionUpdate, type VerifiedEvent, type WebhookRequest,
} from './provider.js'

export const STRIPE_API_VERSION = '2024-06-20'
const TOLERANCE_S = 300

export interface StripeOptions {
  secretKey: string
  webhookSecret: string
  apiUrl: string
  /** success_url / cancel_url (https). */
  returnUrl: string
}

type Json = Record<string, any>

/** Stripe's form encoding: nested objects and arrays as a[b][0][c]=v. */
export function formEncode(value: Json): string {
  const out: string[] = []
  const walk = (v: unknown, key: string) => {
    if (v === undefined || v === null) return
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${key}[${i}]`))
    else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, key ? `${key}[${k}]` : k)
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`)
  }
  walk(value, '')
  return out.join('&')
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const refOf = (...values: unknown[]): string | null => {
  for (const v of values) if (typeof v === 'string' && UUID_RE.test(v)) return v.toLowerCase()
  return null
}
const at = (unixS: unknown): Date | undefined => (typeof unixS === 'number' && Number.isFinite(unixS) ? new Date(unixS * 1000) : undefined)
/** Expandable fields arrive as an id string or as the object. */
const idOf = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : v && typeof v === 'object' && typeof (v as Json).id === 'string' ? (v as Json).id : undefined

/** Subscription statuses; cancel_at_period_end = no more renewals (the paid period is kept by Billing). */
export function mapSubscriptionStatus(status: unknown, cancelAtPeriodEnd: unknown): SubscriptionUpdate['status'] {
  switch (status) {
    case 'active': case 'trialing': return cancelAtPeriodEnd ? 'ended' : 'active'
    case 'past_due': case 'unpaid': return 'past_due'
    case 'canceled': case 'incomplete_expired': case 'paused': return 'ended'
    default: return 'pending' // incomplete
  }
}

export class StripeProvider implements PaymentProvider {
  readonly id: BillingProviderId = 'stripe'
  readonly sandbox = false

  constructor(private readonly opts: StripeOptions, private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  private async call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: Json, idempotencyKey?: string): Promise<Json> {
    const res = await this.fetchImpl(`${this.opts.apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.opts.secretKey}`,
        'stripe-version': STRIPE_API_VERSION,
        ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      ...(body ? { body: formEncode(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 404 && method === 'GET') return {}
    // The response body can carry payer data: never put it in the error (it ends up in logs).
    if (!res.ok) throw new Error(`stripe ${method} ${path.replace(/\/[^/]+$/, '/:id')}: HTTP ${res.status}`)
    return (await res.json()) as Json
  }

  async createCheckout(input: CheckoutInput): Promise<{ url: string; providerSubscriptionId?: string }> {
    const sub = input.kind === 'subscription'
    const meta = { reference: input.reference, kind: input.kind }
    const session = await this.call('POST', '/v1/checkout/sessions', {
      mode: sub ? 'subscription' : 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: input.amountCents,
          product_data: { name: input.title ?? input.product.name },
          ...(sub ? { recurring: { interval: input.product.interval === 'year' ? 'year' : 'month' } } : {}),
        },
      }],
      client_reference_id: input.reference,
      metadata: meta,
      customer_email: input.payerEmail,
      locale: 'pt-BR',
      success_url: this.opts.returnUrl,
      cancel_url: this.opts.returnUrl,
      ...(sub
        ? { subscription_data: { metadata: meta } }
        // The statement descriptor (ALGA MEET / ALGAMEET) is set on the account, not per charge.
        : { payment_intent_data: { metadata: meta } }),
      // Pix is invite-only on Stripe Brazil: without it enabled this checkout fails (the gift flow shows the error).
      ...(input.pixOnly ? { payment_method_types: ['pix'] } : {}),
    }, `checkout_${input.reference}`)
    if (typeof session.url !== 'string') throw new Error('stripe checkout session without url')
    return { url: session.url }
  }

  /** User cancel = stop at period end (resumable); account deletion = cancel now, nothing charges again. */
  async cancelSubscription(providerSubscriptionId: string | null, final = false): Promise<void> {
    if (!providerSubscriptionId) return
    const path = `/v1/subscriptions/${encodeURIComponent(providerSubscriptionId)}`
    if (final) await this.call('DELETE', path)
    else await this.call('POST', path, { cancel_at_period_end: true })
  }

  async resumeSubscription(providerSubscriptionId: string | null): Promise<void> {
    if (!providerSubscriptionId) return
    await this.call('POST', `/v1/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, { cancel_at_period_end: false })
  }

  /** providerPaymentId is a PaymentIntent id (pi_…). The result arrives as charge.refunded. */
  async refund(providerPaymentId: string): Promise<void> {
    await this.call('POST', '/v1/refunds', { payment_intent: providerPaymentId }, `refund_${providerPaymentId}`)
  }

  verifySignature(req: WebhookRequest, nowS = Date.now() / 1000): void {
    const pairs = (header(req.headers, 'stripe-signature') ?? '').split(',').map((kv) => kv.trim().split('=', 2))
    const t = Number(pairs.find(([k]) => k === 't')?.[1])
    const v1 = pairs.filter(([k, v]) => k === 'v1' && v).map(([, v]) => v!)
    if (!Number.isInteger(t) || v1.length === 0) throw new WebhookRejected('missing or malformed Stripe-Signature')
    if (Math.abs(nowS - t) > TOLERANCE_S) throw new WebhookRejected('signature timestamp out of tolerance')
    const expected = hmacHex(this.opts.webhookSecret, `${t}.${req.rawBody}`)
    if (!v1.some((sig) => safeEqualHex(sig, expected))) throw new WebhookRejected('bad Stripe-Signature')
  }

  async parseWebhook(req: WebhookRequest): Promise<VerifiedEvent> {
    this.verifySignature(req)
    let ev: Json
    try {
      ev = JSON.parse(req.rawBody) as Json
    } catch {
      throw new WebhookRejected('body is not JSON')
    }
    if (typeof ev.id !== 'string' || typeof ev.type !== 'string' || typeof ev.data?.object !== 'object') {
      throw new WebhookRejected('unexpected Stripe event shape')
    }
    const occurredAt = at(ev.created) ?? new Date()
    return { id: ev.id, type: ev.type, updates: await this.updatesOf(ev.type, ev.data.object as Json, occurredAt) }
  }

  private async updatesOf(type: string, o: Json, occurredAt: Date): Promise<BillingUpdate[]> {
    switch (type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired': {
        const reference = refOf(o.metadata?.reference, o.client_reference_id)
        if (!reference) return []
        if (o.mode === 'subscription') {
          // Only records the subscription id; status and period come from customer.subscription.* and invoice.*.
          const subId = idOf(o.subscription)
          return subId ? [{ kind: 'subscription', reference, providerSubscriptionId: subId, status: 'pending', occurredAt }] : []
        }
        const failed = type === 'checkout.session.async_payment_failed' || type === 'checkout.session.expired'
        return [{
          kind: 'order', reference, providerPaymentId: idOf(o.payment_intent),
          status: failed ? 'failed' : o.payment_status === 'paid' ? 'paid' : 'pending',
          amountCents: typeof o.amount_total === 'number' ? o.amount_total : undefined,
          currency: o.currency === 'usd' ? 'USD' : 'BRL', occurredAt,
        }]
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const reference = refOf(o.metadata?.reference)
        if (!reference) return []
        const end = at(o.current_period_end ?? o.items?.data?.[0]?.current_period_end)
        const unit = o.items?.data?.[0]?.price?.unit_amount
        return [{
          kind: 'subscription', reference, providerSubscriptionId: idOf(o.id),
          status: mapSubscriptionStatus(o.status, o.cancel_at_period_end),
          ...(end ? { currentPeriodEnd: end } : {}),
          ...(typeof unit === 'number' ? { amountCents: unit } : {}),
          occurredAt,
        }]
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const reference = refOf(o.subscription_details?.metadata?.reference)
        if (!reference) return []
        if (type === 'invoice.payment_failed') return [{ kind: 'subscription', reference, status: 'past_due', occurredAt }]
        const ends = (o.lines?.data ?? []).map((l: Json) => l?.period?.end).filter((n: unknown) => typeof n === 'number') as number[]
        const end = ends.length ? at(Math.max(...ends)) : undefined
        return [{
          kind: 'subscription', reference, providerSubscriptionId: idOf(o.subscription), status: 'active',
          ...(end ? { currentPeriodEnd: end } : {}),
          ...(typeof o.amount_paid === 'number' ? { amountCents: o.amount_paid } : {}),
          providerPaymentId: idOf(o.payment_intent), occurredAt,
        }]
      }
      case 'charge.refunded':
        // Partial refunds keep the purchase; only a full refund revokes.
        return o.refunded ? this.revokeCharge(o, occurredAt) : []
      case 'charge.dispute.created': {
        const charge = await this.call('GET', `/v1/charges/${encodeURIComponent(String(idOf(o.charge) ?? ''))}`)
        return charge.id ? this.revokeCharge(charge, occurredAt) : []
      }
      default:
        return []
    }
  }

  /** A refunded or disputed charge: an order turns refunded, a subscription charge revokes the plan now. */
  private async revokeCharge(charge: Json, occurredAt: Date): Promise<BillingUpdate[]> {
    const invoiceId = idOf(charge.invoice)
    if (invoiceId) {
      const inv = await this.call('GET', `/v1/invoices/${encodeURIComponent(invoiceId)}`)
      const reference = refOf(inv.subscription_details?.metadata?.reference)
      return reference ? [{ kind: 'subscription', reference, status: 'revoked', occurredAt }] : []
    }
    const piId = idOf(charge.payment_intent)
    if (!piId) return []
    const pi = await this.call('GET', `/v1/payment_intents/${encodeURIComponent(piId)}`)
    const reference = refOf(pi.metadata?.reference)
    if (!reference) return []
    return pi.metadata?.kind === 'subscription'
      ? [{ kind: 'subscription', reference, status: 'revoked', occurredAt }]
      : [{ kind: 'order', reference, providerPaymentId: piId, status: 'refunded', occurredAt }]
  }
}
