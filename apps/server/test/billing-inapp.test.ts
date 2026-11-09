import { createHmac } from 'node:crypto'
import type { BillingCatalog, BillingMe, CheckoutResponse, Me, PayResponse } from '@alga/shared'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { rejectionMessage } from '../src/billing/billing.js'
import { api, register, startServer, type TestServer } from './helpers.js'

// In-app checkout (POST /billing/pay) against a simulated Mercado Pago API.
const KEY = ['mp', 'hook', 'key', 'inapp'].join('-')
const TOKEN = ['fake', 'token', 'inapp'].join('-')
const PUBLIC_KEY = 'TEST-00000000-1111-2222-3333-444444444444'
const DAY = 86_400_000

describe('in-app checkout (Mercado Pago)', () => {
  let m: TestServer
  const store = new Map<string, Record<string, any>>()
  const byKey = new Map<string, Record<string, any>>()
  const calls: Array<{ method: string; path: string; body?: any; key: string | null }> = []
  let seq = 0

  beforeAll(async () => {
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      if (url.host !== 'mp.test') return realFetch(input, init)
      const method = init?.method ?? 'GET'
      const headers = new Headers(init?.headers)
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      const key = headers.get('x-idempotency-key')
      calls.push({ method, path: url.pathname, body, key })
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
      if (method === 'POST' && key && byKey.has(key)) return json(byKey.get(key))
      const now = new Date().toISOString()
      if (method === 'POST' && url.pathname === '/preapproval') {
        const id = `pa${++seq}`
        // card_token "bad…" = a card the issuer refuses when MP validates it.
        if (body.card_token_id?.startsWith('bad')) return json({ message: 'card rejected', cause: [{ code: 'cc_rejected_other_reason' }] }, 400)
        const pa = { ...body, id, status: body.card_token_id ? 'authorized' : 'pending', last_modified: now, init_point: `https://mp.test/sub/${id}`,
          ...(body.card_token_id ? { next_payment_date: new Date(Date.now() + 30 * DAY).toISOString() } : {}) }
        store.set(`/preapproval/${id}`, pa)
        if (key) byKey.set(key, pa)
        return json(pa)
      }
      if (method === 'POST' && url.pathname === '/checkout/preferences') return json({ id: 'pref', init_point: 'https://mp.test/pref' })
      if (method === 'POST' && url.pathname === '/v1/payments') {
        const id = 7000 + ++seq
        const pix = body.payment_method_id === 'pix'
        const p = {
          id, status: pix ? 'pending' : body.token.startsWith('bad') ? 'rejected' : 'approved',
          status_detail: pix ? 'pending_waiting_transfer' : body.token.startsWith('bad') ? 'cc_rejected_insufficient_amount' : 'accredited',
          external_reference: body.external_reference, transaction_amount: body.transaction_amount, currency_id: 'BRL',
          date_created: now, date_last_updated: now, date_of_expiration: body.date_of_expiration ?? null,
          ...(pix ? { point_of_interaction: { transaction_data: { qr_code: `000201pix${id}`, qr_code_base64: 'iVBORw0KGgo=' } } } : {}),
        }
        store.set(`/v1/payments/${id}`, p)
        if (key) byKey.set(key, p)
        return json(p, 201)
      }
      if (method === 'PUT' && url.pathname.startsWith('/preapproval/')) {
        store.set(url.pathname, { ...store.get(url.pathname), ...body, last_modified: new Date(Date.now() + 1000).toISOString() })
        return json(store.get(url.pathname))
      }
      const hit = store.get(url.pathname)
      return hit ? json(hit) : json({ message: 'not found' }, 404)
    }))
    m = await startServer({
      BILLING_PROVIDER: 'mercadopago', MP_ACCESS_TOKEN: TOKEN, MP_WEBHOOK_SECRET: KEY, MP_API_URL: 'http://mp.test',
      MP_PUBLIC_KEY: PUBLIC_KEY, BILLING_RETURN_URL: 'https://algameet.com.br/billing/return',
    })
  })
  afterAll(async () => {
    await m.close()
    vi.unstubAllGlobals()
  })

  const hook = (type: string, dataId: string) => {
    const ts = String(Date.now())
    const v1 = createHmac('sha256', KEY).update(`id:${dataId};request-id:r1;ts:${ts};`).digest('hex')
    return m.app.inject({
      method: 'POST', url: `/api/v1/billing/webhooks/mercadopago?data.id=${dataId}&type=${type}`,
      headers: { 'content-type': 'application/json', 'x-request-id': 'r1', 'x-signature': `ts=${ts},v1=${v1}` },
      payload: JSON.stringify({ id: ++seq, type, data: { id: dataId } }),
    })
  }
  // A real MP device id is long (armor. + ~225 chars).
  const card = (reference: string, token: string) =>
    ({ method: 'card', reference, token, paymentMethodId: 'master', document: '52998224725', deviceId: `armor.${'a1b2c3d4e5'.repeat(23)}` })

  it('announces itself and serves the card frame with the public key', async () => {
    const cat = await api<BillingCatalog>(m.app, 'GET', '/billing/catalog')
    expect(cat.body.provider).toMatchObject({ id: 'mercadopago', inApp: true })
    const frame = await m.app.inject({ method: 'GET', url: '/api/v1/billing/card-frame?accent=6163d0' })
    expect(frame.statusCode).toBe(200)
    expect(frame.headers['content-type']).toContain('text/html')
    expect(frame.body).toContain(PUBLIC_KEY)
    expect(frame.body).toContain('--accent:#6163d0')
    const font = await m.app.inject({ method: 'GET', url: '/api/v1/billing/card-frame/inter.woff2' })
    expect(font.statusCode).toBe(200)
    expect(font.headers['content-type']).toBe('font/woff2')
    expect(font.rawPayload.subarray(0, 4).toString()).toBe('wOF2')
    // A hostile accent never reaches the page.
    expect((await m.app.inject({ method: 'GET', url: '/api/v1/billing/card-frame?accent=%22%3E%3Cscript%3E' })).body).toContain('--accent:#8b8ef7')
  })

  it('Plus by card: authorized now, the hosted-page preapproval cancelled and its notifications ignored', async () => {
    const u = await register(m.app)
    const co = (await api<CheckoutResponse>(m.app, 'POST', '/billing/checkout', { token: u.token, body: { productId: 'plus_monthly' } })).body
    const pending = calls.find((c) => c.method === 'POST' && c.path === '/preapproval' && c.body.external_reference === `s_${co.reference}`)!
    const pendingId = [...store.entries()].find(([, v]) => v.external_reference === `s_${co.reference}`)![1].id as string

    expect((await api(m.app, 'POST', '/billing/pay', { token: u.token, body: { method: 'pix', reference: co.reference } })).status).toBe(400)
    const refused = await api<PayResponse>(m.app, 'POST', '/billing/pay', { token: u.token, body: card(co.reference, 'bad-card-tok-1') })
    expect(refused.body).toMatchObject({ status: 'rejected', message: expect.stringContaining('recusado') })
    expect((await api<Me>(m.app, 'GET', '/users/@me', { token: u.token })).body.plan!.id).toBe('free')

    const ok = await api<PayResponse>(m.app, 'POST', '/billing/pay', { token: u.token, body: card(co.reference, 'good-card-tok-1') })
    expect(ok.body).toEqual({ status: 'approved' })
    const authorized = calls.findLast((c) => c.method === 'POST' && c.path === '/preapproval')!
    expect(authorized.body).toMatchObject({ card_token_id: 'good-card-tok-1', status: 'authorized', payer_email: u.user.email, external_reference: `s_${co.reference}` })
    expect(authorized.key).toBeTruthy()
    expect(pending.body.status).toBe('pending')
    expect(store.get(`/preapproval/${pendingId}`)!.status).toBe('cancelled')
    expect((await api<Me>(m.app, 'GET', '/users/@me', { token: u.token })).body.plan!.id).toBe('plus')

    // The cancelled hosted-page preapproval notifies: it is not this subscription any more.
    expect((await hook('subscription_preapproval', pendingId)).statusCode).toBe(200)
    expect((await api<BillingMe>(m.app, 'GET', '/billing/me', { token: u.token })).body.subscription).toMatchObject({ status: 'active', cancelAtPeriodEnd: false })
    // Paying again is a no-op.
    expect((await api<PayResponse>(m.app, 'POST', '/billing/pay', { token: u.token, body: card(co.reference, 'good-card-tok-2') })).body).toEqual({ status: 'approved' })
  })

  it('an item by Pix: one QR per order, paid by the webhook; a refused card then an approved one pays at once', async () => {
    const u = await register(m.app)
    const co = (await api<CheckoutResponse>(m.app, 'POST', '/billing/checkout', { token: u.token, body: { productId: 'deco_ha_orbita' } })).body
    const pix = (await api<PayResponse>(m.app, 'POST', '/billing/pay', { token: u.token, body: { method: 'pix', reference: co.reference } })).body
    expect(pix).toMatchObject({ status: 'pending', pix: { qrCode: expect.stringContaining('pix'), qrCodeBase64: 'iVBORw0KGgo=' } })
    const again = (await api<PayResponse>(m.app, 'POST', '/billing/pay', { token: u.token, body: { method: 'pix', reference: co.reference } })).body
    expect(again.pix!.qrCode).toBe(pix.pix!.qrCode)
    const pixCall = calls.findLast((c) => c.body?.payment_method_id === 'pix')!
    expect(pixCall.body).toMatchObject({ external_reference: `o_${co.reference}`, payer: { email: u.user.email } })
    const paymentId = pix.pix!.qrCode.replace('000201pix', '')
    store.set(`/v1/payments/${paymentId}`, { ...store.get(`/v1/payments/${paymentId}`), status: 'approved', date_last_updated: new Date(Date.now() + 1000).toISOString() })
    expect((await hook('payment', paymentId)).statusCode).toBe(200)
    expect((await api<BillingMe>(m.app, 'GET', '/billing/me', { token: u.token })).body.items.map((i) => i.sku)).toContain('deco_ha_orbita')

    const co2 = (await api<CheckoutResponse>(m.app, 'POST', '/billing/checkout', { token: u.token, body: { productId: 'deco_ha_constelacao' } })).body
    const refused = (await api<PayResponse>(m.app, 'POST', '/billing/pay', { token: u.token, body: card(co2.reference, 'bad-card-tok-3') })).body
    expect(refused).toEqual({ status: 'rejected', message: 'Saldo ou limite insuficiente. Tente outro cartão ou o Pix.' })
    const ok = (await api<PayResponse>(m.app, 'POST', '/billing/pay', { token: u.token, body: card(co2.reference, 'good-card-tok-3') })).body
    expect(ok).toEqual({ status: 'approved' })
    const charged = calls.findLast((c) => c.body?.token === 'good-card-tok-3')!
    expect(charged.body).toMatchObject({ binary_mode: true, installments: 1, payer: { identification: { type: 'CPF', number: '52998224725' } } })
    expect((await api<BillingMe>(m.app, 'GET', '/billing/me', { token: u.token })).body.items.map((i) => i.sku)).toContain('deco_ha_constelacao')
  })

  it('only the buyer pays their checkout, and bad input never reaches the provider', async () => {
    const owner = await register(m.app)
    const other = await register(m.app)
    const co = (await api<CheckoutResponse>(m.app, 'POST', '/billing/checkout', { token: owner.token, body: { productId: 'deco_ha_orbita' } })).body
    const before = calls.length
    expect((await api(m.app, 'POST', '/billing/pay', { token: other.token, body: { method: 'pix', reference: co.reference } })).status).toBe(404)
    expect((await api(m.app, 'POST', '/billing/pay', { token: owner.token, body: { ...card(co.reference, 'tok-xyz-123'), document: '123' } })).status).toBe(400)
    expect((await api(m.app, 'POST', '/billing/pay', { token: owner.token, body: { ...card(co.reference, 'tok"><x'), document: '52998224725' } })).status).toBe(400)
    expect(calls.length).toBe(before)
    // An odd device id is dropped, never a refusal.
    const odd = await api<PayResponse>(m.app, 'POST', '/billing/pay', { token: owner.token, body: { ...card(co.reference, 'good-card-tok-9'), deviceId: 'x'.repeat(2000) } })
    expect(odd.body.status).toBe('approved')
  })

  it('acknowledges the unsigned legacy IPN copy without acting on it; anything else unsigned is still refused', async () => {
    const before = calls.length
    const post = (query: string, headers: Record<string, string> = {}) => m.app.inject({
      method: 'POST', url: `/api/v1/billing/webhooks/mercadopago?${query}`, headers: { 'content-type': 'application/json', ...headers }, payload: '{}',
    })
    expect((await post('topic=payment&id=123456')).statusCode).toBe(200)
    expect((await post('topic=merchant_order&id=99')).statusCode).toBe(200)
    expect(calls.length).toBe(before)
    expect((await post('type=payment')).statusCode).toBe(401)
    expect((await post('data.id=123&type=payment')).statusCode).toBe(401)
    expect((await post('topic=payment&id=1', { 'x-signature': 'ts=1,v1=00' })).statusCode).toBe(401)
  })

  it('explains refusals in words the buyer can act on', () => {
    // What MP answered on a real subscription attempt (2026-11-08): the pre-authorization of the card failed.
    expect(rejectionMessage('CC_VAL_433 Credit card validation has failed')).toContain('validar este cartão')
    expect(rejectionMessage('cc_rejected_insufficient_amount')).toContain('limite')
    expect(rejectionMessage(undefined)).toContain('recusado')
  })

  it('is off without a public key (hosted page only)', async () => {
    const plain = await startServer()
    try {
      expect((await api<BillingCatalog>(plain.app, 'GET', '/billing/catalog')).body.provider!.inApp).toBeUndefined()
      expect((await plain.app.inject({ method: 'GET', url: '/api/v1/billing/card-frame' })).statusCode).toBe(404)
    } finally {
      await plain.close()
    }
  })
})
