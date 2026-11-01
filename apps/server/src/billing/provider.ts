/**
 * Payment provider boundary. Providers turn checkouts into hosted payment pages and turn their webhooks into
 * normalized updates; Billing (billing.ts) owns every state transition. A payment is never confirmed from a client
 * call: only from a verified webhook whose state the provider reports (Mercado Pago: re-fetched from its API).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { BillingProviderId, Product } from '@alga/shared'
import { z } from 'zod'
import type { Config } from '../config.js'

export interface SubscriptionUpdate {
  kind: 'subscription'
  /** Our subscription id (the `reference` given to createCheckout). */
  reference: string
  providerSubscriptionId?: string
  /**
   * active = paid through currentPeriodEnd; past_due = a renewal failed; ended = no more renewals (the paid period
   * is kept); revoked = refund/chargeback, ends now.
   */
  status: 'pending' | 'active' | 'past_due' | 'ended' | 'revoked'
  currentPeriodEnd?: Date
  amountCents?: number
  /** Provider-side time of this state; older than the last applied one → ignored. */
  occurredAt: Date
}

export interface OrderUpdate {
  kind: 'order'
  reference: string
  providerPaymentId?: string
  status: 'pending' | 'paid' | 'failed' | 'refunded'
  amountCents?: number
  currency?: 'BRL' | 'USD'
  occurredAt: Date
}

export type BillingUpdate = SubscriptionUpdate | OrderUpdate

export interface VerifiedEvent {
  /** Provider event id: the idempotency key of billing_events. */
  id: string
  type: string
  updates: BillingUpdate[]
}

export interface WebhookRequest {
  rawBody: string
  headers: Record<string, string | string[] | undefined>
  query: Record<string, unknown>
}

export interface CheckoutInput {
  kind: 'subscription' | 'order'
  reference: string
  product: Product
  amountCents: number
  currency: 'BRL'
  payerEmail: string
}

export interface PaymentProvider {
  readonly id: BillingProviderId
  readonly sandbox: boolean
  /** Hosted payment page. `providerSubscriptionId` when the provider creates the subscription up front. */
  createCheckout(input: CheckoutInput): Promise<{ url: string; providerSubscriptionId?: string }>
  /** Stops renewals now; the paid period is honored by Billing. */
  cancelSubscription(providerSubscriptionId: string | null): Promise<void>
  /** Asks for a refund; the result arrives as a webhook (order → refunded). */
  refund(providerPaymentId: string): Promise<void>
  /** Verifies the signature and returns the normalized updates. Throws WebhookRejected when not authentic. */
  parseWebhook(req: WebhookRequest): Promise<VerifiedEvent>
}

export class WebhookRejected extends Error {}

export const header = (h: WebhookRequest['headers'], name: string): string | undefined => {
  const v = h[name]
  return Array.isArray(v) ? v[0] : v
}

export const hmacHex = (key: string, data: string) => createHmac('sha256', key).update(data).digest('hex')

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex')
  const y = Buffer.from(b, 'hex')
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y)
}

// ---- sandbox ------------------------------------------------------------------------------------------------------

export const SANDBOX_SIGNATURE_HEADER = 'x-alga-sandbox-signature'
const SANDBOX_TOLERANCE_S = 300

/** `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>` */
export function sandboxSignature(secret: string, rawBody: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${hmacHex(secret, `${t}.${rawBody}`)}`
}

const date = z.iso.datetime({ offset: true }).transform((s) => new Date(s))
const SandboxEvent = z.object({
  id: z.string().min(1).max(128),
  type: z.string().min(1).max(64),
  updates: z.array(z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('subscription'),
      reference: z.uuid(),
      providerSubscriptionId: z.string().max(128).optional(),
      status: z.enum(['pending', 'active', 'past_due', 'ended', 'revoked']),
      currentPeriodEnd: date.optional(),
      amountCents: z.number().int().min(0).optional(),
      occurredAt: date,
    }),
    z.object({
      kind: z.literal('order'),
      reference: z.uuid(),
      providerPaymentId: z.string().max(128).optional(),
      status: z.enum(['pending', 'paid', 'failed', 'refunded']),
      amountCents: z.number().int().min(0).optional(),
      currency: z.enum(['BRL', 'USD']).optional(),
      occurredAt: date,
    }),
  ])).max(10),
})

/**
 * Test provider for development and tests: its "hosted page" is GET /billing/sandbox/checkout/:reference (signed
 * link) and its webhooks are HMAC-signed with a per-process secret. Refuses to exist in production.
 */
export class SandboxProvider implements PaymentProvider {
  readonly id = 'sandbox' as const
  readonly sandbox = true
  private readonly secret: string

  constructor(private readonly config: Config) {
    if (config.env === 'production') throw new Error('sandbox billing provider cannot run in production')
    this.secret = config.billing.sandboxSecret
  }

  checkoutSig(reference: string): string {
    return hmacHex(this.secret, `checkout:${reference}`)
  }

  async createCheckout(input: CheckoutInput): Promise<{ url: string; providerSubscriptionId?: string }> {
    const url = `${this.config.publicUrl}/api/v1/billing/sandbox/checkout/${input.reference}?sig=${this.checkoutSig(input.reference)}`
    return { url, ...(input.kind === 'subscription' ? { providerSubscriptionId: `sbx_sub_${input.reference}` } : {}) }
  }

  async cancelSubscription(): Promise<void> {}

  async refund(): Promise<void> {}

  async parseWebhook(req: WebhookRequest): Promise<VerifiedEvent> {
    const sig = header(req.headers, SANDBOX_SIGNATURE_HEADER) ?? ''
    const parts = Object.fromEntries(sig.split(',').map((kv) => kv.trim().split('=', 2) as [string, string]))
    const t = Number(parts.t)
    if (!Number.isInteger(t) || !parts.v1) throw new WebhookRejected('missing or malformed signature')
    if (Math.abs(Date.now() / 1000 - t) > SANDBOX_TOLERANCE_S) throw new WebhookRejected('signature timestamp out of tolerance')
    if (!safeEqualHex(parts.v1, hmacHex(this.secret, `${t}.${req.rawBody}`))) throw new WebhookRejected('bad signature')
    let json: unknown
    try {
      json = JSON.parse(req.rawBody)
    } catch {
      throw new WebhookRejected('body is not JSON')
    }
    const ev = SandboxEvent.safeParse(json)
    if (!ev.success) throw new WebhookRejected('unexpected sandbox event shape')
    return { id: ev.data.id, type: ev.data.type, updates: ev.data.updates }
  }
}
