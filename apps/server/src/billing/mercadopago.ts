/**
 * Mercado Pago adapter: Checkout Pro preferences (one-time cosmetics) and Subscriptions "preapproval" (plans).
 * Written from the public docs (developers.mercadopago.com.br, read 2026-11-01) and NOT exercised against the real
 * API (no credentials yet). What is unverified is listed in docs/business/monetization.md §8 and apps/server/README.md.
 *
 * Webhooks: `x-signature: ts=<ts>,v1=<hex>` = HMAC-SHA256(MP_WEBHOOK_SECRET, "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"),
 * data.id from the query string (lowercased when alphanumeric). The notification body is never trusted: every
 * state is re-fetched from the API with our access token, so a replayed or reordered notification can only make us
 * read the current truth again.
 */
import type { BillingProviderId } from '@alga/shared'
import {
  WebhookRejected, hmacHex, header, safeEqualHex,
  type BillingUpdate, type CheckoutInput, type PaymentProvider, type SubscriptionUpdate, type VerifiedEvent, type WebhookRequest,
} from './provider.js'

export interface MercadoPagoOptions {
  accessToken: string
  webhookSecret: string
  apiUrl: string
  /** back_url / back_urls after paying (https). */
  returnUrl: string
  /** Our webhook URL, sent as notification_url on preferences (subscriptions use the one set in the MP panel). */
  notificationUrl: string
}

type Json = Record<string, any>

const REF_RE = /^([so])_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
/** external_reference = `s_<subscription id>` or `o_<order id>`. */
export function parseReference(ref: unknown): { kind: 'subscription' | 'order'; id: string } | null {
  const m = typeof ref === 'string' ? REF_RE.exec(ref) : null
  return m ? { kind: m[1] === 's' ? 'subscription' : 'order', id: m[2]!.toLowerCase() } : null
}

const cents = (amount: unknown) => (typeof amount === 'number' && Number.isFinite(amount) ? Math.round(amount * 100) : undefined)
const dateOf = (...values: unknown[]): Date => {
  for (const v of values) {
    const d = typeof v === 'string' ? new Date(v) : undefined
    if (d && !Number.isNaN(d.getTime())) return d
  }
  return new Date()
}

/** Payment statuses (GET /v1/payments/:id). */
export function mapPaymentStatus(status: unknown): 'pending' | 'paid' | 'failed' | 'refunded' {
  switch (status) {
    case 'approved': return 'paid'
    case 'rejected': case 'cancelled': return 'failed'
    case 'refunded': case 'charged_back': return 'refunded'
    default: return 'pending' // pending, in_process, authorized, in_mediation
  }
}

/** Preapproval statuses; the docs spell the cancelled state both ways, accept either. */
export function mapPreapprovalStatus(status: unknown): SubscriptionUpdate['status'] {
  switch (status) {
    case 'authorized': return 'active'
    case 'paused': case 'cancelled': case 'canceled': return 'ended'
    default: return 'pending'
  }
}

export class MercadoPagoProvider implements PaymentProvider {
  readonly id: BillingProviderId = 'mercadopago'
  readonly sandbox = false

  constructor(private readonly opts: MercadoPagoOptions, private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  private async call(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, idempotencyKey?: string): Promise<Json> {
    const res = await this.fetchImpl(`${this.opts.apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.opts.accessToken}`,
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    })
    // The panel's "test notification" and other merchants' ids are not found: nothing to apply (200, no retries).
    if (res.status === 404 && method === 'GET') return {}
    // The response body can carry payer data: never put it in the error (it ends up in logs).
    if (!res.ok) throw new Error(`mercadopago ${method} ${path.replace(/\/[^/]+$/, '/:id')}: HTTP ${res.status}`)
    return (await res.json()) as Json
  }

  async createCheckout(input: CheckoutInput): Promise<{ url: string; providerSubscriptionId?: string }> {
    const amount = input.amountCents / 100
    if (input.kind === 'subscription') {
      const pa = await this.call('POST', '/preapproval', {
        reason: input.product.name,
        external_reference: `s_${input.reference}`,
        payer_email: input.payerEmail,
        auto_recurring: {
          frequency: input.product.interval === 'year' ? 12 : 1,
          frequency_type: 'months',
          transaction_amount: amount,
          currency_id: input.currency,
        },
        back_url: this.opts.returnUrl,
        status: 'pending',
      }, `s_${input.reference}`)
      if (typeof pa.init_point !== 'string') throw new Error('mercadopago preapproval without init_point')
      return { url: pa.init_point, providerSubscriptionId: String(pa.id) }
    }
    const pref = await this.call('POST', '/checkout/preferences', {
      items: [{ id: input.product.id, title: input.product.name, quantity: 1, unit_price: amount, currency_id: input.currency }],
      external_reference: `o_${input.reference}`,
      payer: { email: input.payerEmail },
      notification_url: this.opts.notificationUrl,
      back_urls: { success: this.opts.returnUrl, failure: this.opts.returnUrl, pending: this.opts.returnUrl },
      statement_descriptor: 'ALGAMEET',
    }, `o_${input.reference}`)
    if (typeof pref.init_point !== 'string') throw new Error('mercadopago preference without init_point')
    return { url: pref.init_point }
  }

  /**
   * A user's cancel pauses the preapproval (no charges; `paused` can go back to `authorized`, `cancelled` cannot);
   * account deletion cancels it for good. Both map to 'ended' on the way back (mapPreapprovalStatus).
   */
  async cancelSubscription(providerSubscriptionId: string | null, final = false): Promise<void> {
    if (!providerSubscriptionId) return
    await this.call('PUT', `/preapproval/${encodeURIComponent(providerSubscriptionId)}`, { status: final ? 'cancelled' : 'paused' })
  }

  async resumeSubscription(providerSubscriptionId: string | null): Promise<void> {
    if (!providerSubscriptionId) return
    await this.call('PUT', `/preapproval/${encodeURIComponent(providerSubscriptionId)}`, { status: 'authorized' })
  }

  async refund(providerPaymentId: string): Promise<void> {
    await this.call('POST', `/v1/payments/${encodeURIComponent(providerPaymentId)}/refunds`, {}, `refund_${providerPaymentId}`)
  }

  /** x-signature check (see file header). Requires a signed data.id: that id is what gets re-fetched. */
  verifySignature(req: WebhookRequest): { dataId: string; ts: string } {
    const parts = Object.fromEntries((header(req.headers, 'x-signature') ?? '').split(',').map((kv) => kv.trim().split('=', 2) as [string, string]))
    const rawId = req.query['data.id']
    if (!parts.ts || !parts.v1 || typeof rawId !== 'string' || !rawId || rawId.length > 128) {
      throw new WebhookRejected('missing x-signature or data.id')
    }
    const dataId = /^[a-z0-9]+$/i.test(rawId) ? rawId.toLowerCase() : rawId
    const requestId = header(req.headers, 'x-request-id')
    const manifest = `id:${dataId};${requestId ? `request-id:${requestId};` : ''}ts:${parts.ts};`
    if (!safeEqualHex(parts.v1, hmacHex(this.opts.webhookSecret, manifest))) throw new WebhookRejected('bad x-signature')
    return { dataId, ts: parts.ts }
  }

  async parseWebhook(req: WebhookRequest): Promise<VerifiedEvent> {
    const { dataId, ts } = this.verifySignature(req)
    let body: Json = {}
    try {
      body = JSON.parse(req.rawBody || '{}') as Json
    } catch {
      // The signed parts are in the headers and query; an unreadable body only loses the event id.
    }
    const type = String(body.type ?? req.query.type ?? req.query.topic ?? '')
    const id = body.id !== undefined ? String(body.id) : `${type}:${dataId}:${ts}`
    return { id, type, updates: await this.fetchUpdates(type, dataId) }
  }

  private async fetchUpdates(type: string, dataId: string): Promise<BillingUpdate[]> {
    const id = encodeURIComponent(dataId)
    switch (type) {
      case 'payment': {
        const p = await this.call('GET', `/v1/payments/${id}`)
        const ref = parseReference(p.external_reference)
        const occurredAt = dateOf(p.date_last_updated, p.date_created)
        if (ref?.kind === 'order') {
          return [{
            kind: 'order', reference: ref.id, providerPaymentId: String(p.id), status: mapPaymentStatus(p.status),
            amountCents: cents(p.transaction_amount), currency: p.currency_id === 'USD' ? 'USD' : 'BRL', occurredAt,
          }]
        }
        // Renewals are tracked through the preapproval topics; a refunded/charged-back renewal ends the plan now.
        if (ref?.kind === 'subscription' && mapPaymentStatus(p.status) === 'refunded') {
          return [{ kind: 'subscription', reference: ref.id, status: 'revoked', occurredAt }]
        }
        return []
      }
      case 'subscription_preapproval': {
        const pa = await this.call('GET', `/preapproval/${id}`)
        const update = this.preapprovalUpdate(pa)
        return update ? [update] : []
      }
      case 'subscription_authorized_payment': {
        const ap = await this.call('GET', `/authorized_payments/${id}`)
        if (!ap.preapproval_id) return []
        const pa = await this.call('GET', `/preapproval/${encodeURIComponent(String(ap.preapproval_id))}`)
        const update = this.preapprovalUpdate(pa)
        if (!update) return []
        const paid = mapPaymentStatus(ap.payment?.status)
        if (paid === 'failed') update.status = 'past_due'
        if (paid === 'refunded') update.status = 'revoked'
        const apAt = dateOf(ap.last_modified, ap.date_created)
        if (apAt > update.occurredAt) update.occurredAt = apAt
        return [update]
      }
      default:
        return [] // subscription_preapproval_plan, merchant orders, …: nothing to apply
    }
  }

  private preapprovalUpdate(pa: Json): SubscriptionUpdate | null {
    const ref = parseReference(pa.external_reference)
    if (ref?.kind !== 'subscription') return null
    const next = pa.next_payment_date ? dateOf(pa.next_payment_date) : undefined
    return {
      kind: 'subscription',
      reference: ref.id,
      providerSubscriptionId: String(pa.id),
      status: mapPreapprovalStatus(pa.status),
      ...(next ? { currentPeriodEnd: next } : {}),
      amountCents: cents(pa.auto_recurring?.transaction_amount),
      occurredAt: dateOf(pa.last_modified, pa.date_created),
    }
  }
}
