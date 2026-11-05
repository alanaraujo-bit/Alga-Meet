import { createHmac } from 'node:crypto'
import type { BillingMe, CheckoutResponse, Me, Subscription } from '@alga/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebhookRejected } from '../src/billing/provider.js'
import { StripeProvider, formEncode, mapSubscriptionStatus } from '../src/billing/stripe.js'
import { loadConfig } from '../src/config.js'
import { api, register, startServer } from './helpers.js'

const KEY = ['sk', 'test', 'fake'].join('_')
const WHSEC = ['whsec', 'fake', 'for', 'tests'].join('_')
const DAY = 24 * 3600 * 1000
const sec = (ms: number) => Math.floor(ms / 1000)
const sign = (raw: string, secret = WHSEC, t = sec(Date.now())) =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`

afterEach(() => { vi.unstubAllGlobals() })

describe('stripe adapter', () => {
  it('encodes nested forms, verifies Stripe-Signature and maps statuses', () => {
    expect(formEncode({ a: 1, b: { c: 'x y' }, d: [{ e: true }], skip: undefined })).toBe('a=1&b%5Bc%5D=x%20y&d%5B0%5D%5Be%5D=true')
    const st = new StripeProvider({ secretKey: KEY, webhookSecret: WHSEC, apiUrl: 'http://stripe.test', returnUrl: 'https://r' })
    const raw = '{"id":"evt_1"}'
    expect(() => st.verifySignature({ rawBody: raw, headers: { 'stripe-signature': sign(raw) }, query: {} })).not.toThrow()
    // Rotation: any matching v1 passes.
    expect(() => st.verifySignature({ rawBody: raw, headers: { 'stripe-signature': `${sign(raw)},v1=00ff` }, query: {} })).not.toThrow()
    expect(() => st.verifySignature({ rawBody: raw, headers: { 'stripe-signature': sign(raw, 'wrong') }, query: {} })).toThrow(WebhookRejected)
    expect(() => st.verifySignature({ rawBody: `${raw} `, headers: { 'stripe-signature': sign(raw) }, query: {} })).toThrow(WebhookRejected)
    expect(() => st.verifySignature({ rawBody: raw, headers: { 'stripe-signature': sign(raw, WHSEC, sec(Date.now()) - 3600) }, query: {} })).toThrow(WebhookRejected)
    expect(() => st.verifySignature({ rawBody: raw, headers: {}, query: {} })).toThrow(WebhookRejected)
    expect(mapSubscriptionStatus('active', false)).toBe('active')
    expect(mapSubscriptionStatus('active', true)).toBe('ended')
    expect(mapSubscriptionStatus('past_due', false)).toBe('past_due')
    expect(mapSubscriptionStatus('canceled', false)).toBe('ended')
    expect(mapSubscriptionStatus('incomplete', false)).toBe('pending')
  })

  it('config requires keys and an https return URL', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', BILLING_PROVIDER: 'stripe' })).toThrow()
    expect(loadConfig({
      NODE_ENV: 'test', BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: WHSEC,
      BILLING_RETURN_URL: 'https://algameet.com.br/billing/return',
    }).billing).toMatchObject({ provider: 'stripe', stripe: { apiUrl: 'https://api.stripe.com' } })
  })

  it('end to end on a server configured for Stripe: checkout, signed webhooks, cancel/resume, order, refund', async () => {
    const calls: { method: string; path: string; body: URLSearchParams }[] = []
    const store = new Map<string, Record<string, any>>()
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      if (url.host !== 'stripe.test') return realFetch(input, init)
      const method = init?.method ?? 'GET'
      const h = new Headers(init?.headers)
      expect(h.get('authorization')).toBe(`Bearer ${KEY}`)
      expect(h.get('stripe-version')).toBe('2024-06-20')
      const body = new URLSearchParams(String(init?.body ?? ''))
      calls.push({ method, path: url.pathname, body })
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
      if (method === 'POST' && url.pathname === '/v1/checkout/sessions') return json({ id: `cs_${calls.length}`, url: `https://checkout.stripe.test/cs_${calls.length}` })
      if (method === 'POST' && url.pathname === '/v1/refunds') return json({ id: 're_1', status: 'succeeded' })
      if (url.pathname.startsWith('/v1/subscriptions/')) return json({ id: 'sub_1' })
      const hit = store.get(url.pathname)
      return hit ? json(hit) : json({ error: {} }, 404)
    }))
    const m = await startServer({
      BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_API_URL: 'http://stripe.test',
      BILLING_RETURN_URL: 'https://algameet.com.br/billing/return',
    })
    let seq = 0
    const hook = (type: string, object: Record<string, unknown>, opts: { created?: number; secret?: string } = {}) => {
      const raw = JSON.stringify({ id: `evt_${++seq}`, type, created: opts.created ?? sec(Date.now()) + seq, data: { object } })
      return m.app.inject({
        method: 'POST', url: '/api/v1/billing/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': sign(raw, opts.secret) }, payload: raw,
      })
    }
    try {
      const u = await register(m.app)
      const co = await api<CheckoutResponse>(m.app, 'POST', '/billing/checkout', { token: u.token, body: { productId: 'plus_monthly' } })
      expect(co.body).toMatchObject({ provider: 'stripe', sandbox: false, url: expect.stringMatching(/^https:\/\/checkout\.stripe\.test\//) })
      const session = calls.find((c) => c.path === '/v1/checkout/sessions')!.body
      expect(Object.fromEntries(session)).toMatchObject({
        mode: 'subscription', client_reference_id: co.body.reference, customer_email: u.user.email,
        'line_items[0][price_data][currency]': 'brl', 'line_items[0][price_data][unit_amount]': '1490',
        'line_items[0][price_data][recurring][interval]': 'month', 'subscription_data[metadata][reference]': co.body.reference,
      })
      const ref = co.body.reference
      const meta = { reference: ref, kind: 'subscription' }
      const end = sec(Date.now() + 30 * DAY)
      const sub = (status: string, cancel = false) => ({
        id: 'sub_1', object: 'subscription', status, cancel_at_period_end: cancel, current_period_end: end, metadata: meta,
        items: { data: [{ price: { unit_amount: 1490 } }] },
      })

      // Forged signature: 401, nothing applied.
      expect((await hook('customer.subscription.updated', sub('active'), { secret: 'forged' })).statusCode).toBe(401)
      expect((await hook('checkout.session.completed', { mode: 'subscription', client_reference_id: ref, metadata: meta, subscription: 'sub_1' })).statusCode).toBe(200)
      expect((await hook('customer.subscription.created', sub('incomplete'))).statusCode).toBe(200)
      expect((await api<Me>(m.app, 'GET', '/users/@me', { token: u.token })).body.plan!.id).not.toBe('plus')
      await hook('invoice.paid', {
        subscription: 'sub_1', subscription_details: { metadata: meta }, amount_paid: 1490, payment_intent: 'pi_first',
        lines: { data: [{ period: { end } }] },
      })
      await hook('customer.subscription.updated', sub('active'))
      expect((await api<Me>(m.app, 'GET', '/users/@me', { token: u.token })).body.plan!.id).toBe('plus')
      expect((await api<BillingMe>(m.app, 'GET', '/billing/me', { token: u.token })).body.subscription)
        .toMatchObject({ status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: new Date(end * 1000).toISOString() })

      // Cancel = cancel_at_period_end (resumable); the paid period is kept.
      const cancel = await api<Subscription>(m.app, 'POST', '/billing/subscription/cancel', { token: u.token })
      expect(cancel.body.cancelAtPeriodEnd).toBe(true)
      expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/v1/subscriptions/sub_1' })
      expect(calls.at(-1)!.body.get('cancel_at_period_end')).toBe('true')
      await hook('customer.subscription.updated', sub('active', true))
      expect((await api<Me>(m.app, 'GET', '/users/@me', { token: u.token })).body.plan!.id).toBe('plus')
      const resumed = await api<Subscription>(m.app, 'POST', '/billing/subscription/resume', { token: u.token })
      expect(resumed.body.cancelAtPeriodEnd).toBe(false)
      expect(calls.at(-1)!.body.get('cancel_at_period_end')).toBe('false')
      await hook('customer.subscription.updated', sub('active'))
      expect((await api<BillingMe>(m.app, 'GET', '/billing/me', { token: u.token })).body.subscription!.cancelAtPeriodEnd).toBe(false)

      // A failed renewal → past_due.
      await hook('invoice.payment_failed', { subscription: 'sub_1', subscription_details: { metadata: meta } })
      expect((await api<BillingMe>(m.app, 'GET', '/billing/me', { token: u.token })).body.subscription!.status).toBe('past_due')

      // One-time purchase: payment-mode session, paid on completion; then a full refund takes the item back.
      const order = await api<CheckoutResponse>(m.app, 'POST', '/billing/checkout', { token: u.token, body: { productId: 'deco_ha_orbita' } })
      const oBody = calls.at(-1)!.body
      expect(oBody.get('mode')).toBe('payment')
      expect(oBody.get('payment_intent_data[metadata][reference]')).toBe(order.body.reference)
      const amount = Number(oBody.get('line_items[0][price_data][unit_amount]'))
      await hook('checkout.session.completed', {
        mode: 'payment', client_reference_id: order.body.reference, metadata: { reference: order.body.reference, kind: 'order' },
        payment_status: 'paid', payment_intent: 'pi_order', amount_total: amount, currency: 'brl',
      })
      let me = (await api<BillingMe>(m.app, 'GET', '/billing/me', { token: u.token })).body
      expect(me.orders[0]).toMatchObject({ id: order.body.reference, status: 'paid', sandbox: false })
      expect(me.items.map((i) => i.sku)).toContain('deco_ha_orbita')
      store.set('/v1/payment_intents/pi_order', { id: 'pi_order', metadata: { reference: order.body.reference, kind: 'order' } })
      await hook('charge.refunded', { id: 'ch_1', refunded: false, payment_intent: 'pi_order' }) // partial: ignored
      expect((await api<BillingMe>(m.app, 'GET', '/billing/me', { token: u.token })).body.orders[0]!.status).toBe('paid')
      await hook('charge.refunded', { id: 'ch_1', refunded: true, payment_intent: 'pi_order' })
      me = (await api<BillingMe>(m.app, 'GET', '/billing/me', { token: u.token })).body
      expect(me.orders[0]!.status).toBe('refunded')
      expect(me.items.map((i) => i.sku)).not.toContain('deco_ha_orbita')

      // A refunded subscription charge (found through its invoice) revokes the plan now.
      store.set('/v1/invoices/in_1', { id: 'in_1', subscription_details: { metadata: meta } })
      await hook('charge.refunded', { id: 'ch_2', refunded: true, invoice: 'in_1', payment_intent: 'pi_first' })
      expect((await api<Me>(m.app, 'GET', '/users/@me', { token: u.token })).body.plan!.id).not.toBe('plus')
    } finally {
      await m.close()
    }
  })
})
