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
  type BillingUpdate, type CheckoutInput, type PaymentProvider, type PayInput, type PayResult, type SubscriptionUpdate, type VerifiedEvent,
  type WebhookRequest,
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

async function readJson(res: Response): Promise<Json> {
  try {
    return (await res.json()) as Json
  } catch {
    return {}
  }
}

/** The reason code of a refused card (payment status_detail, or the first `cause` of an API error); never payer data. */
function rejection(body: Json): string {
  const code = body.status_detail ?? body.cause?.[0]?.code ?? body.error ?? body.message
  return typeof code === 'string' || typeof code === 'number' ? String(code).slice(0, 80) : 'unknown'
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

  private async call(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, idempotencyKey?: string, extra: Record<string, string> = {}): Promise<Json> {
    const res = await this.send(method, path, body, idempotencyKey, extra)
    // The panel's "test notification" and other merchants' ids are not found: nothing to apply (200, no retries).
    if (res.status === 404 && method === 'GET') return {}
    // The response body can carry payer data: never put it in the error (it ends up in logs).
    if (!res.ok) throw new Error(`mercadopago ${method} ${path.replace(/\/[^/]+$/, '/:id')}: HTTP ${res.status}`)
    return (await res.json()) as Json
  }

  private send(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, idempotencyKey?: string, extra: Record<string, string> = {}): Promise<Response> {
    return this.fetchImpl(`${this.opts.apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.opts.accessToken}`,
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
        ...extra,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    })
  }

  /**
   * Checkout Transparente: a card token (from MP's secure fields, never the card itself) or Pix.
   * - card, one-time: POST /v1/payments with binary_mode (approved or rejected now, no "in review").
   * - card, subscription: POST /preapproval {card_token_id, status: authorized}; the pending preapproval made for the
   *   hosted page is cancelled (it never charged: nothing was ever attached to it).
   * - pix, one-time: POST /v1/payments {payment_method_id: pix}; the same order always gets the same QR (idempotency
   *   key), valid until shortly before the order itself expires (24 h).
   */
  async pay(input: PayInput): Promise<PayResult> {
    const amount = input.amountCents / 100
    const headers: Record<string, string> = input.method === 'card' && input.deviceId ? { 'x-meli-session-id': input.deviceId } : {}
    if (input.kind === 'subscription') {
      if (input.method !== 'card') throw new Error('mercadopago: subscriptions are card-only')
      const res = await this.send('POST', '/preapproval', {
        reason: input.product.name,
        external_reference: `s_${input.reference}`,
        payer_email: input.payerEmail,
        card_token_id: input.token,
        auto_recurring: {
          frequency: input.product.interval === 'year' ? 12 : 1,
          frequency_type: 'months',
          transaction_amount: amount,
          currency_id: input.currency,
        },
        back_url: this.opts.returnUrl,
        status: 'authorized',
      }, `card_${input.token}`, headers)
      const pa = await readJson(res)
      if (!res.ok || pa.status !== 'authorized') return { status: 'rejected', reason: rejection(pa) }
      if (input.providerSubscriptionId && input.providerSubscriptionId !== String(pa.id)) {
        await this.call('PUT', `/preapproval/${encodeURIComponent(input.providerSubscriptionId)}`, { status: 'cancelled' }).catch(() => {})
      }
      const update = this.preapprovalUpdate(pa)
      return { status: 'approved', ...(update ? { update } : {}) }
    }
    const description = input.title ?? input.product.name
    const common = {
      transaction_amount: amount,
      description,
      external_reference: `o_${input.reference}`,
      notification_url: this.opts.notificationUrl,
      additional_info: { items: [{ id: input.product.id, title: description, quantity: 1, unit_price: amount, category_id: 'virtual_goods' }] },
    }
    const res = input.method === 'pix'
      ? await this.send('POST', '/v1/payments', {
        ...common,
        payment_method_id: 'pix',
        payer: { email: input.payerEmail },
        date_of_expiration: new Date(Date.now() + 23 * 3600_000).toISOString(),
      }, `pix_o_${input.reference}`)
      : await this.send('POST', '/v1/payments', {
        ...common,
        token: input.token,
        payment_method_id: input.paymentMethodId,
        ...(input.issuerId ? { issuer_id: Number(input.issuerId) } : {}),
        installments: 1,
        binary_mode: true,
        statement_descriptor: 'ALGAMEET',
        payer: { email: input.payerEmail, identification: { type: input.document.length === 14 ? 'CNPJ' : 'CPF', number: input.document } },
      }, `card_${input.token}`, headers)
    const p = await readJson(res)
    if (!res.ok) return { status: 'rejected', reason: rejection(p) }
    const status = mapPaymentStatus(p.status)
    const update: BillingUpdate = {
      kind: 'order', reference: input.reference, providerPaymentId: String(p.id), status,
      amountCents: cents(p.transaction_amount), currency: p.currency_id === 'USD' ? 'USD' : 'BRL', occurredAt: dateOf(p.date_last_updated, p.date_created),
    }
    if (status === 'paid') return { status: 'approved', update }
    if (status === 'failed' || status === 'refunded') return { status: 'rejected', reason: String(p.status_detail ?? p.status ?? '') }
    const tx = p.point_of_interaction?.transaction_data
    if (input.method === 'pix' && typeof tx?.qr_code === 'string' && typeof tx?.qr_code_base64 === 'string') {
      return { status: 'pending', pix: { qrCode: tx.qr_code, qrCodeBase64: tx.qr_code_base64, expiresAt: typeof p.date_of_expiration === 'string' ? p.date_of_expiration : null } }
    }
    return { status: 'pending' }
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
      items: [{ id: input.product.id, title: input.title ?? input.product.name, quantity: 1, unit_price: amount, currency_id: input.currency }],
      external_reference: `o_${input.reference}`,
      payer: { email: input.payerEmail },
      // Docs (2026-11-01): "Dinheiro em conta" cannot be excluded, so "Pix only" still allows the MP balance.
      ...(input.pixOnly ? { payment_methods: { excluded_payment_types: ['credit_card', 'debit_card', 'prepaid_card', 'ticket'].map((id) => ({ id })) } } : {}),
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

  /**
   * Full refund (empty body). A Pix refund may stay `in_process` (contingency with the central bank): the header makes
   * MP answer 201 instead of 400 then; the payment turns `refunded` later and its webhook revokes.
   */
  async refund(providerPaymentId: string): Promise<void> {
    await this.call('POST', `/v1/payments/${encodeURIComponent(providerPaymentId)}/refunds`, {}, `refund_${providerPaymentId}`,
      { 'x-render-in-process-refunds': 'true' })
  }

  /**
   * MP also posts the legacy IPN format to notification_url (`?topic=payment&id=…`, never signed) next to the signed
   * webhook (`?data.id=…&type=…`). The signed one carries the same change, so the IPN copy is acknowledged and dropped.
   */
  ignorable(req: WebhookRequest): boolean {
    return !header(req.headers, 'x-signature') && req.query['data.id'] === undefined && typeof req.query.topic === 'string'
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
        if (paid === 'paid' && ap.payment?.id !== undefined) update.providerPaymentId = String(ap.payment.id)
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
