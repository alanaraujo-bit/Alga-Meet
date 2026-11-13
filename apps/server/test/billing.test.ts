import { createHmac } from 'node:crypto'
import {
  STREAM_PRESETS_ATTRIBUTE, uuidv7,
  type BillingCatalog, type BillingMe, type CheckoutResponse, type Me, type Subscription, type SpaceSnapshot, type VoiceJoinResponse,
} from '@alga/shared'
import { count, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { TokenVerifier, TrackSource, type RoomServiceClient } from 'livekit-server-sdk'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { GRACE_MS } from '../src/billing/billing.js'
import { productById } from '../src/billing/catalog.js'
import { MercadoPagoProvider, mapPaymentStatus, mapPreapprovalStatus, parseReference } from '../src/billing/mercadopago.js'
import { SANDBOX_SIGNATURE_HEADER, SandboxProvider, WebhookRejected, sandboxSignature } from '../src/billing/provider.js'
import { loadConfig } from '../src/config.js'
import { billingEvents, subscriptions } from '../src/db/schema.js'
import { PLAN_RECHECK_MS } from '../src/voice.js'
import { api, befriend, connect, postWebhook, register, startServer, type TestServer } from './helpers.js'

let s: TestServer
const MAX = 64 * 1024 // free attachment cap for this server; Plus gets 100 MiB
beforeAll(async () => { s = await startServer({ MAX_ATTACHMENT_BYTES: String(MAX) }) })
afterAll(async () => { await s.close() })
afterEach(() => { vi.restoreAllMocks() })

const DAY = 24 * 3600 * 1000
let evSeq = 0

async function sandboxHook(app: FastifyInstance, event: unknown, opts: { secret?: string; t?: number; body?: string; signature?: string | null } = {}) {
  const raw = JSON.stringify(event)
  const sig = opts.signature === undefined ? sandboxSignature(opts.secret ?? s.config.billing.sandboxSecret, raw, opts.t) : opts.signature
  const res = await app.inject({
    method: 'POST', url: '/api/v1/billing/webhooks/sandbox',
    headers: { 'content-type': 'application/json', ...(sig !== null ? { [SANDBOX_SIGNATURE_HEADER]: sig } : {}) },
    payload: opts.body ?? raw,
  })
  return res.statusCode
}

const subEvent = (reference: string, status: string, extra: Record<string, unknown> = {}, id = `EV_${++evSeq}`) =>
  ({ id, type: 'test.subscription', updates: [{ kind: 'subscription', reference, status, occurredAt: new Date().toISOString(), ...extra }] })
const orderEvent = (reference: string, status: string, extra: Record<string, unknown> = {}, id = `EV_${++evSeq}`) =>
  ({ id, type: 'test.order', updates: [{ kind: 'order', reference, status, occurredAt: new Date().toISOString(), ...extra }] })

const checkout = (token: string, productId: string) => api<CheckoutResponse>(s.app, 'POST', '/billing/checkout', { token, body: { productId } })
const billingMe = async (token: string) => (await api<BillingMe>(s.app, 'GET', '/billing/me', { token })).body
const planOf = async (token: string) => (await api<Me>(s.app, 'GET', '/users/@me', { token })).body.plan!.id
const openPage = (url: string) => s.app.inject({ method: 'GET', url: new URL(url).pathname + new URL(url).search })

/** Registers a user and activates Plus through a signed sandbox webhook; periodEnd defaults to now + 30 days. */
async function subscribed(periodEnd = new Date(Date.now() + 30 * DAY)) {
  const u = await register(s.app)
  const co = (await checkout(u.token, 'plus_monthly')).body
  expect(await sandboxHook(s.app, subEvent(co.reference, 'active', { currentPeriodEnd: periodEnd.toISOString(), amountCents: 1490 }))).toBe(200)
  return { ...u, reference: co.reference, periodEnd }
}

describe('catalog and checkout', () => {
  it('public catalog lists plans with features, products and the sandbox provider; Me.plan starts free', async () => {
    const cat = await api<BillingCatalog>(s.app, 'GET', '/billing/catalog')
    expect(cat.status).toBe(200)
    expect(cat.body.provider).toEqual({ id: 'sandbox', sandbox: true })
    const [free, plus] = cat.body.plans
    expect(free).toMatchObject({ id: 'free', streamPresets: ['720p30', '720p60', '1080p30'], maxAttachmentBytes: MAX })
    expect(plus).toMatchObject({ id: 'plus', maxAttachmentBytes: 100 * 1024 * 1024 })
    expect(plus!.streamPresets).toEqual(expect.arrayContaining(['1080p60', '1440p60', '2160p30']))
    expect(cat.body.products.find((p) => p.id === 'plus_monthly')).toMatchObject({ priceBrlCents: 1490, interval: 'month', purchasable: true })
    const u = await register(s.app)
    expect((await api<Me>(s.app, 'GET', '/users/@me', { token: u.token })).body.plan).toMatchObject({ id: 'free', maxAttachmentBytes: MAX })
  })

  it('checkout needs a verified e-mail and a sold product; it returns a sandbox page and grants nothing', async () => {
    const unverified = await register(s.app, undefined, { verified: false })
    expect((await checkout(unverified.token, 'plus_monthly')).status).toBe(403)
    const u = await register(s.app)
    expect((await checkout(u.token, 'nope')).status).toBe(404)
    expect((await checkout(u.token, 'icon_ha_noite')).status).toBe(404) // included in Plus, not sold
    const res = await checkout(u.token, 'plus_monthly')
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ kind: 'subscription', provider: 'sandbox', sandbox: true })
    expect(res.body.url).toContain(`/api/v1/billing/sandbox/checkout/${res.body.reference}?sig=`)
    const me = await billingMe(u.token)
    expect(me.plan.id).toBe('free')
    expect(me.items).toEqual([])
    expect(me.subscriptions[0]).toMatchObject({ id: res.body.reference, status: 'pending', sandbox: true })
    // Every checkout creates an object at the provider: 10 per hour (3 used above).
    for (let i = 0; i < 7; i++) expect((await checkout(u.token, 'plus_monthly')).status).toBe(201)
    expect((await checkout(u.token, 'plus_monthly')).status).toBe(429)
  })

  it('the sandbox page needs its signed link; approving activates Plus, buying a cosmetic grants it for good', async () => {
    const u = await register(s.app)
    const gw = await connect(s.port, u.token)
    const co = (await checkout(u.token, 'plus_yearly')).body
    expect((await s.app.inject({ method: 'GET', url: `${new URL(co.url).pathname}?sig=${'0'.repeat(64)}` })).statusCode).toBe(403)
    const page = await openPage(co.url)
    expect(page.statusCode).toBe(200)
    expect(page.body).toContain('SANDBOX')
    await gw.waitFor('ENTITLEMENTS_UPDATE', (d) => d.plan.id === 'plus')
    await gw.waitFor('ME_UPDATE', (d) => d.plan?.id === 'plus')
    const sub = (await billingMe(u.token)).subscription!
    expect(new Date(sub.currentPeriodEnd!).getTime() - Date.now()).toBeGreaterThan(360 * DAY)
    expect((await checkout(u.token, 'plus_monthly')).status).toBe(409) // already subscribed

    const deco = (await checkout(u.token, 'deco_ha_orbita')).body
    expect(deco.kind).toBe('order')
    await openPage(deco.url)
    const me = await billingMe(u.token)
    expect(me.orders[0]).toMatchObject({ productId: 'deco_ha_orbita', status: 'paid', amountCents: 990, sandbox: true })
    expect(me.items.map((i) => [i.sku, i.source, i.expiresAt === null])).toEqual(expect.arrayContaining([
      ['deco_ha_orbita', 'order', true], ['plan:plus', 'subscription', false], ['icon_ha_noite', 'subscription', false],
    ]))
    expect((await checkout(u.token, 'deco_ha_orbita')).status).toBe(409) // already owned
    gw.close()
  })
})

describe('webhooks', () => {
  it('rejects missing, wrong, stale and tampered signatures, and providers that are not configured', async () => {
    const u = await register(s.app)
    const co = (await checkout(u.token, 'plus_monthly')).body
    const ev = subEvent(co.reference, 'active', { currentPeriodEnd: new Date(Date.now() + DAY).toISOString() })
    expect(await sandboxHook(s.app, ev, { signature: null })).toBe(401)
    expect(await sandboxHook(s.app, ev, { signature: 't=1,v1=zz' })).toBe(401)
    expect(await sandboxHook(s.app, ev, { secret: 'x'.repeat(64) })).toBe(401)
    expect(await sandboxHook(s.app, ev, { t: Math.floor(Date.now() / 1000) - 3600 })).toBe(401)
    expect(await sandboxHook(s.app, ev, { body: JSON.stringify({ ...ev, id: 'other' }) })).toBe(401)
    const mp = await s.app.inject({ method: 'POST', url: '/api/v1/billing/webhooks/mercadopago', headers: { 'content-type': 'application/json' }, payload: '{}' })
    expect(mp.statusCode).toBe(404)
    expect(await planOf(u.token)).toBe('free')
    const [row] = await s.app.ctx.db.select({ n: count() }).from(billingEvents).where(eq(billingEvents.providerEventId, ev.id))
    expect(row!.n).toBe(0)
  })

  it('is idempotent: the same event id twice is acknowledged once, even with a different payload', async () => {
    const u = await subscribed()
    const ev = subEvent(u.reference, 'revoked')
    expect(await sandboxHook(s.app, ev)).toBe(200)
    expect(await planOf(u.token)).toBe('free')
    // Same id again (a retry) and the id reused with an "active" payload: both ignored.
    expect(await sandboxHook(s.app, ev)).toBe(200)
    const replay = subEvent(u.reference, 'active', { currentPeriodEnd: new Date(Date.now() + 60 * DAY).toISOString() }, ev.id)
    expect(await sandboxHook(s.app, replay)).toBe(200)
    expect(await planOf(u.token)).toBe('free')
    const [row] = await s.app.ctx.db.select({ n: count() }).from(billingEvents).where(eq(billingEvents.providerEventId, ev.id))
    expect(row!.n).toBe(1)
  })

  it('ignores updates older than the last applied state (out-of-order delivery)', async () => {
    const u = await register(s.app)
    const co = (await checkout(u.token, 'plus_monthly')).body
    const t0 = Date.now()
    const at = (ms: number) => new Date(t0 + ms).toISOString()
    // The renewal failure (t+2s) arrives before an older activation (t+1s).
    expect(await sandboxHook(s.app, subEvent(co.reference, 'active', { occurredAt: at(-1000), currentPeriodEnd: at(DAY) }))).toBe(200)
    expect(await sandboxHook(s.app, subEvent(co.reference, 'past_due', { occurredAt: at(2000) }))).toBe(200)
    expect(await sandboxHook(s.app, subEvent(co.reference, 'active', { occurredAt: at(1000), currentPeriodEnd: at(31 * DAY) }))).toBe(200)
    let sub = (await billingMe(u.token)).subscription!
    expect(sub.status).toBe('past_due')
    expect(new Date(sub.currentPeriodEnd!).getTime()).toBe(t0 + DAY)
    expect(await planOf(u.token)).toBe('plus') // past_due keeps the grace period
    // A newer renewal applies; a later refund ends it for good, and neither a stale nor a newer "active" resurrects it.
    expect(await sandboxHook(s.app, subEvent(co.reference, 'active', { occurredAt: at(3000), currentPeriodEnd: at(31 * DAY) }))).toBe(200)
    expect((await billingMe(u.token)).subscription!.status).toBe('active')
    expect(await sandboxHook(s.app, subEvent(co.reference, 'revoked', { occurredAt: at(5000) }))).toBe(200)
    expect(await sandboxHook(s.app, subEvent(co.reference, 'active', { occurredAt: at(4000), currentPeriodEnd: at(62 * DAY) }))).toBe(200)
    expect(await sandboxHook(s.app, subEvent(co.reference, 'active', { occurredAt: at(6000), currentPeriodEnd: at(62 * DAY) }))).toBe(200)
    sub = (await billingMe(u.token)).subscriptions[0]!
    expect(sub.status).toBe('canceled')
    expect(await planOf(u.token)).toBe('free')
  })

  it('refuses activations and payments below the price', async () => {
    const u = await register(s.app)
    const co = (await checkout(u.token, 'plus_monthly')).body
    await sandboxHook(s.app, subEvent(co.reference, 'active', { currentPeriodEnd: new Date(Date.now() + DAY).toISOString(), amountCents: 1 }))
    expect(await planOf(u.token)).toBe('free')
    const order = (await checkout(u.token, 'nameplate_ha_vidro_fosco')).body
    await sandboxHook(s.app, orderEvent(order.reference, 'paid', { amountCents: 100, currency: 'BRL', providerPaymentId: 'p1' }))
    expect((await billingMe(u.token)).orders[0]!.status).toBe('pending')
  })
})

describe('entitlements lifecycle', () => {
  it('cancel at period end keeps Plus until the end, then the expiry sweep downgrades with events', async () => {
    const periodEnd = new Date(Date.now() + 10 * DAY)
    const u = await subscribed(periodEnd)
    const gw = await connect(s.port, u.token)
    expect((await billingMe(u.token)).items.find((i) => i.sku === 'plan:plus')!.expiresAt).toBe(new Date(periodEnd.getTime() + GRACE_MS).toISOString())

    const canceled = await api<Subscription>(s.app, 'POST', '/billing/subscription/cancel', { token: u.token })
    expect(canceled.status).toBe(200)
    expect(canceled.body).toMatchObject({ status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: periodEnd.toISOString() })
    await gw.waitFor('ENTITLEMENTS_UPDATE', (d) => d.items.some((i) => i.sku === 'plan:plus' && i.expiresAt === periodEnd.toISOString()))
    expect((await api(s.app, 'POST', '/billing/subscription/cancel', { token: u.token })).body.cancelAtPeriodEnd).toBe(true) // idempotent

    await s.app.ctx.billing.sweep(new Date(periodEnd.getTime() - 1000))
    expect(await planOf(u.token)).toBe('plus')
    await s.app.ctx.billing.sweep(new Date(periodEnd.getTime() + 1000))
    expect(await planOf(u.token)).toBe('free')
    const me = await billingMe(u.token)
    expect(me.subscriptions[0]!.status).toBe('expired')
    expect(me.items).toEqual([])
    await gw.waitFor('ENTITLEMENTS_UPDATE', (d) => d.plan.id === 'free' && d.items.length === 0)
    await gw.waitFor('ME_UPDATE', (d) => d.plan?.id === 'free')
    expect((await api(s.app, 'POST', '/billing/subscription/cancel', { token: u.token })).status).toBe(404)
    // Subscribing again is allowed once the old one is over.
    expect((await checkout(u.token, 'plus_monthly')).status).toBe(201)
    gw.close()
  })

  it('resume undoes a cancel while the period is paid: renewals and the grace period come back', async () => {
    const periodEnd = new Date(Date.now() + 10 * DAY)
    const u = await subscribed(periodEnd)
    const resume = () => api<Subscription>(s.app, 'POST', '/billing/subscription/resume', { token: u.token })
    expect((await resume()).body).toMatchObject({ status: 'active', cancelAtPeriodEnd: false }) // nothing to undo
    await api(s.app, 'POST', '/billing/subscription/cancel', { token: u.token })
    const gw = await connect(s.port, u.token)
    const res = await resume()
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: periodEnd.toISOString() })
    const graceEnd = new Date(periodEnd.getTime() + GRACE_MS).toISOString()
    await gw.waitFor('ENTITLEMENTS_UPDATE', (d) => d.items.some((i) => i.sku === 'plan:plus' && i.expiresAt === graceEnd))
    expect((await resume()).body.cancelAtPeriodEnd).toBe(false) // idempotent
    // Renewing again, so the grace period applies past the end.
    await s.app.ctx.billing.sweep(new Date(periodEnd.getTime() + 1000))
    expect(await planOf(u.token)).toBe('plus')
    await s.app.ctx.billing.sweep(new Date(periodEnd.getTime() + GRACE_MS + 1000))
    expect(await planOf(u.token)).toBe('free')
    expect((await resume()).status).toBe(404) // over: nothing to resume, subscribe again instead
    expect((await api(s.app, 'POST', '/billing/subscription/resume', { token: (await register(s.app)).token })).status).toBe(404)
    gw.close()
  })

  it('auto-renewing subscriptions get a grace period past the end; abandoned checkouts expire after 24 h', async () => {
    const periodEnd = new Date(Date.now() + DAY)
    const u = await subscribed(periodEnd)
    await s.app.ctx.billing.sweep(new Date(periodEnd.getTime() + GRACE_MS - 1000))
    expect(await planOf(u.token)).toBe('plus')
    await s.app.ctx.billing.sweep(new Date(periodEnd.getTime() + GRACE_MS + 1000))
    expect(await planOf(u.token)).toBe('free')

    const v = await register(s.app)
    const pending = (await checkout(v.token, 'deco_ha_constelacao')).body
    await s.app.ctx.billing.sweep(new Date(Date.now() + DAY + 1000))
    expect((await billingMe(v.token)).orders.find((o) => o.id === pending.reference)!.status).toBe('expired')
  })

  it('recompute: refunds remove owned cosmetics, owned ones outlive the plan, plan cosmetics follow the plan', async () => {
    const u = await subscribed()
    const order = (await checkout(u.token, 'effect_ha_poeira_luz')).body
    await sandboxHook(s.app, orderEvent(order.reference, 'paid', { amountCents: 1290, currency: 'BRL', providerPaymentId: `pay_${order.reference}` }))
    const skus = async () => (await billingMe(u.token)).items.map((i) => i.sku).sort()
    // The Plus wardrobe: the profile pieces and, from Alga Worlds, a_perola and w_pendente_linear.
    expect(await skus()).toEqual(['a_perola', 'accent_ardosia', 'accent_grafite', 'accent_lavanda', 'aura_ha_frondes', 'effect_ha_poeira_luz', 'icon_ha_noite', 'icon_ha_porcelana', 'plan:plus', 'w_pendente_linear'])
    await sandboxHook(s.app, subEvent(u.reference, 'revoked'))
    expect(await skus()).toEqual(['effect_ha_poeira_luz'])
    await sandboxHook(s.app, orderEvent(order.reference, 'refunded'))
    expect(await skus()).toEqual([])
    expect((await billingMe(u.token)).orders[0]!.status).toBe('refunded')
    // A refused card does not end the checkout: another attempt (another payment id) still pays it.
    const other = (await checkout(u.token, 'deco_ha_constelacao')).body
    await sandboxHook(s.app, orderEvent(other.reference, 'failed', { providerPaymentId: 'p_refused' }))
    expect((await billingMe(u.token)).orders.find((o) => o.id === other.reference)!.status).toBe('pending')
    await sandboxHook(s.app, orderEvent(other.reference, 'paid', { providerPaymentId: 'p_ok', amountCents: other.amountCents }))
    expect((await billingMe(u.token)).orders.find((o) => o.id === other.reference)!.status).toBe('paid')
    expect(await skus()).toEqual(['deco_ha_constelacao'])
  })
})

describe('cosmetics', () => {
  const equip = (token: string, body: object) => api<Me>(s.app, 'PUT', '/users/@me/cosmetics', { token, body })
  async function buy(token: string, productId: string) {
    const o = (await checkout(token, productId)).body
    const paid = orderEvent(o.reference, 'paid', { amountCents: productById(productId)!.priceBrlCents, currency: 'BRL', providerPaymentId: `pay_${o.reference}` })
    expect(await sandboxHook(s.app, paid)).toBe(200)
    return o.reference
  }

  it('equips owned items per slot, refuses the rest; PublicUser.cosmetics goes out with USER_UPDATE and every profile', async () => {
    const u = await register(s.app)
    const friend = await register(s.app)
    await befriend(s.app, u, friend)
    const fgw = await connect(s.port, friend.token)
    expect((await api<Me>(s.app, 'GET', '/users/@me', { token: u.token })).body.cosmetics).toBeUndefined()
    expect((await equip(u.token, { avatarDecoration: 'deco_ha_orbita' })).status).toBe(403) // not owned
    expect((await equip(u.token, { voiceAura: 'aura_ha_frondes' })).status).toBe(403) // Plus only
    expect((await equip(u.token, { avatarDecoration: 'nope' })).body.error.fields).toHaveProperty('avatarDecoration')
    expect((await equip(u.token, { avatarDecoration: 'theme_ha_noite_indigo' })).status).toBe(400) // wrong slot
    expect((await equip(u.token, { avatarDecoration: 'plus_monthly' })).status).toBe(400) // not a cosmetic
    expect((await equip(u.token, { halo: 'deco_ha_orbita' })).status).toBe(400) // unknown slot

    await buy(u.token, 'deco_ha_orbita')
    await buy(u.token, 'effect_ha_poeira_luz')
    const res = await equip(u.token, { avatarDecoration: 'deco_ha_orbita', profileEffect: 'effect_ha_poeira_luz' })
    expect(res.status).toBe(200)
    expect(res.body.cosmetics).toEqual({ avatarDecoration: 'deco_ha_orbita', profileEffect: 'effect_ha_poeira_luz' })
    await fgw.waitFor('USER_UPDATE', (d) => d.id === u.user.id && d.cosmetics?.avatarDecoration === 'deco_ha_orbita')
    expect((await api(s.app, 'GET', `/users/${u.user.id}`, { token: friend.token })).body.cosmetics).toEqual(res.body.cosmetics)
    const rels = (await api(s.app, 'GET', '/relationships', { token: friend.token })).body as { user: { id: string; cosmetics?: unknown } }[]
    expect(rels.find((r) => r.user.id === u.user.id)!.user.cosmetics).toEqual(res.body.cosmetics)

    // Omitted slots keep their item; null unequips; an empty set leaves the field out.
    expect((await equip(u.token, { profileEffect: null })).body.cosmetics).toEqual({ avatarDecoration: 'deco_ha_orbita' })
    expect((await equip(u.token, {})).body.cosmetics).toEqual({ avatarDecoration: 'deco_ha_orbita' })
    expect((await equip(u.token, { avatarDecoration: null })).body.cosmetics).toBeUndefined()
    await fgw.waitFor('USER_UPDATE', (d) => d.id === u.user.id && d.cosmetics === undefined)
    fgw.close()
  })

  it('plan-included items come off when the plan ends (owned ones stay), refunded ones when refunded', async () => {
    const periodEnd = new Date(Date.now() + 5 * DAY)
    const u = await subscribed(periodEnd)
    const friend = await register(s.app)
    await befriend(s.app, u, friend)
    const owned = await buy(u.token, 'deco_ha_constelacao')
    const all = { avatarDecoration: 'deco_ha_constelacao', voiceAura: 'aura_ha_frondes', appIcon: 'icon_ha_noite' }
    expect((await equip(u.token, all)).body.cosmetics).toEqual(all)
    const gw = await connect(s.port, u.token)
    const fgw = await connect(s.port, friend.token)
    await api(s.app, 'POST', '/billing/subscription/cancel', { token: u.token })
    await s.app.ctx.billing.sweep(new Date(periodEnd.getTime() + 1000))
    const onlyOwned = { avatarDecoration: 'deco_ha_constelacao' }
    await fgw.waitFor('USER_UPDATE', (d) => d.id === u.user.id && JSON.stringify(d.cosmetics) === JSON.stringify(onlyOwned))
    await gw.waitFor('ME_UPDATE', (d) => d.plan?.id === 'free' && JSON.stringify(d.cosmetics) === JSON.stringify(onlyOwned))
    expect((await equip(u.token, { voiceAura: 'aura_ha_frondes' })).status).toBe(403) // lapsed with the plan

    await sandboxHook(s.app, orderEvent(owned, 'refunded'))
    await fgw.waitFor('USER_UPDATE', (d) => d.id === u.user.id && d.cosmetics === undefined)
    expect((await api<Me>(s.app, 'GET', '/users/@me', { token: u.token })).body.cosmetics).toBeUndefined()
    gw.close()
    fgw.close()
  })
})

describe('enforcement', () => {
  it('attachment cap follows the plan (413 for free above its cap, accepted for Plus)', async () => {
    const send = async (token: string, channelId: string, bytes: number) => {
      const fd = new FormData()
      fd.append('payload_json', JSON.stringify({ content: '' }))
      fd.append('files', new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }), 'dados.bin')
      const req = new Request('http://x', { method: 'POST', body: fd })
      const res = await s.app.inject({
        method: 'POST', url: `/api/v1/channels/${channelId}/messages`,
        headers: { authorization: `Bearer ${token}`, 'content-type': req.headers.get('content-type')! },
        payload: Buffer.from(await req.arrayBuffer()),
      })
      return res.statusCode
    }
    const free = await register(s.app)
    const plus = await subscribed()
    for (const u of [free, plus]) {
      const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: u.token, body: { name: 'Anexos' } })).body
      const text = space.channels.find((c) => c.type === 'text')!
      expect(await send(u.token, text.id, MAX * 2)).toBe(u === free ? 413 : 200)
    }
  })

  it('voice tokens carry the plan presets; screen shares above the plan are muted at the SFU', async () => {
    const free = await register(s.app)
    const plus = await subscribed()
    const presetsOf = async (token: string) => {
      const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token, body: { name: 'Tela' } })).body
      const voice = space.channels.find((c) => c.type === 'voice')!
      const res = await api<VoiceJoinResponse>(s.app, 'POST', '/voice/join', { token, body: { channelId: voice.id } })
      const claims = await new TokenVerifier(s.config.livekit.apiKey, s.config.livekit.apiSecret).verify(res.body.token)
      expect(claims.attributes![STREAM_PRESETS_ATTRIBUTE]).toBe(res.body.streamPresets!.join(','))
      expect(claims.video!.canUpdateOwnMetadata).toBeFalsy()
      return res.body.streamPresets
    }
    expect(await presetsOf(free.token)).toEqual(['720p30', '720p60', '1080p30'])
    expect(await presetsOf(plus.token)).toContain('2160p30')

    const rooms = (s.app.ctx.voice as unknown as { rooms: RoomServiceClient }).rooms
    const mute = vi.spyOn(rooms, 'mutePublishedTrack').mockResolvedValue({} as never)
    let seq = 0
    const published = (identity: string, track: Record<string, unknown>) => postWebhook(s.app, s.config, {
      event: 'track_published', id: `TP_${++seq}`, room: { name: `ch_${uuidv7()}` }, participant: { identity }, track,
    })
    const layer = (width: number, height: number, bitrate: number) => ({ quality: 'HIGH', width, height, bitrate })
    // Free: 1440p is above the plan; an ultrawide scaled to a 1080 short side is fine; 20 Mbps is far above 1080p30.
    await published(free.user.id, { sid: 'TR_a', source: 'SCREEN_SHARE', width: 2560, height: 1440, layers: [layer(2560, 1440, 9_000_000)] })
    await published(free.user.id, { sid: 'TR_b', source: 'SCREEN_SHARE', width: 3440, height: 1440, layers: [layer(2580, 1080, 4_500_000)] })
    await published(free.user.id, { sid: 'TR_c', source: 'SCREEN_SHARE', width: 1920, height: 1080, layers: [layer(1920, 1080, 20_000_000)] })
    await published(free.user.id, { sid: 'TR_d', source: 'CAMERA', width: 3840, height: 2160 })
    await published(plus.user.id, { sid: 'TR_e', source: 'SCREEN_SHARE', width: 3840, height: 2160, layers: [layer(3840, 2160, 15_000_000)] })
    expect(mute.mock.calls.map((c) => c[2])).toEqual(['TR_a', 'TR_c'])
    expect(mute.mock.calls[0]![1]).toBe(free.user.id)
  })

  it('plan change mid-share: presets attribute at once (stale join tokens too); after the grace, shares above the new plan are muted', async () => {
    const voice = s.app.ctx.voice
    voice.planRecheckMs = 30
    const rooms = (voice as unknown as { rooms: RoomServiceClient }).rooms
    const update = vi.spyOn(rooms, 'updateParticipant').mockResolvedValue({} as never)
    const mute = vi.spyOn(rooms, 'mutePublishedTrack').mockResolvedValue({} as never)
    const layer = (width: number, height: number, bitrate: number) => ({ quality: 2, width, height, bitrate })
    const screen = (sid: string, l: ReturnType<typeof layer>, muted = false) => ({ sid, source: TrackSource.SCREEN_SHARE, muted, width: l.width, height: l.height, layers: [layer(320, 180, 100_000), l], codecs: [] })
    // As LiveKit reports them: layers declared at publish (1080p60 at 8 Mbps is Plus-only; 720p60 fits Free).
    const tracks = [
      screen('TR_hi', layer(1920, 1080, 8_000_000)),
      screen('TR_ok', layer(1280, 720, 3_000_000)),
      screen('TR_off', layer(3840, 2160, 15_000_000), true),
      { sid: 'TR_cam', source: TrackSource.CAMERA, muted: false, width: 3840, height: 2160, layers: [layer(3840, 2160, 15_000_000)], codecs: [] },
    ]
    const get = vi.spyOn(rooms, 'getParticipant').mockResolvedValue({ tracks } as never)
    let seq = 0
    const join = async (u: { token: string; user: { id: string } }, attrs: Record<string, string> = {}) => {
      const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: u.token, body: { name: 'Ao vivo' } })).body
      const ch = space.channels.find((c) => c.type === 'voice')!
      await postWebhook(s.app, s.config, { event: 'participant_joined', id: `PJ_${++seq}`, room: { name: `ch_${ch.id}` }, participant: { identity: u.user.id, attributes: attrs } })
      expect(voice.stateOf(u.user.id)?.channelId).toBe(ch.id)
      return `ch_${ch.id}`
    }
    const presetsSent = () => update.mock.calls.map((c) => [c[0], c[1], (c[2] as { attributes?: Record<string, string> } | undefined)?.attributes?.[STREAM_PRESETS_ATTRIBUTE]])
    const FREE = '720p30,720p60,1080p30'

    // Downgrade (refund): the attribute changes in the same request; the re-check mutes only what is still above.
    const plus = await subscribed()
    const room = await join(plus)
    expect(update).not.toHaveBeenCalled() // no attribute in the event: nothing to compare
    expect(await sandboxHook(s.app, subEvent(plus.reference, 'revoked'))).toBe(200)
    expect(presetsSent()).toEqual([[room, plus.user.id, FREE]])
    expect(mute).not.toHaveBeenCalled() // the client gets the grace to re-cap itself
    await vi.waitFor(() => expect(mute).toHaveBeenCalledTimes(1))
    expect(mute.mock.calls[0]).toEqual([room, plus.user.id, 'TR_hi', true])
    expect(get).toHaveBeenCalledWith(room, plus.user.id)

    // Upgrade: attribute at once; the re-check finds nothing above Plus.
    update.mockClear(); mute.mockClear(); get.mockClear()
    const free = await register(s.app)
    const room2 = await join(free, { [STREAM_PRESETS_ATTRIBUTE]: FREE }) // fresh token: matches, no update
    expect(update).not.toHaveBeenCalled()
    const co = (await checkout(free.token, 'plus_monthly')).body
    expect(await sandboxHook(s.app, subEvent(co.reference, 'active', { currentPeriodEnd: new Date(Date.now() + 30 * DAY).toISOString(), amountCents: 1490 }))).toBe(200)
    expect(presetsSent()).toEqual([[room2, free.user.id, expect.stringContaining('2160p30')]])
    await vi.waitFor(() => expect(get).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 100))
    expect(mute).not.toHaveBeenCalled()

    // A token minted before the plan change still says Free: corrected on join (and re-checked).
    update.mockClear()
    await join(free, { [STREAM_PRESETS_ATTRIBUTE]: FREE })
    expect(presetsSent()).toEqual([[expect.stringMatching(/^ch_/), free.user.id, expect.stringContaining('2160p30')]])
    voice.planRecheckMs = PLAN_RECHECK_MS
  })
})

describe('configuration', () => {
  const PROD = {
    NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db:5432/alga', CORS_ORIGINS: 'null',
    LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 'a-real-production-secret-0123456789abcdef',
    PUBLIC_URL: 'https://api.example.com', FILES_SECRET: 's'.repeat(32), STORAGE_DRIVER: 'local',
    EMAIL_DRIVER: 'console', ALGA_ALLOW_CONSOLE_EMAIL: '1', E2EE_DS_KEY: 'A'.repeat(43) + '=',
  }
  const MP = { BILLING_PROVIDER: 'mercadopago', MP_ACCESS_TOKEN: 'fake-access-token', MP_WEBHOOK_SECRET: 'fake-secret', BILLING_RETURN_URL: 'https://algameet.com.br/billing/return' }

  it('the sandbox provider cannot be enabled in production (config and constructor both fail closed)', () => {
    expect(() => loadConfig({ ...PROD, BILLING_PROVIDER: 'sandbox' })).toThrow(/BILLING_PROVIDER/)
    expect(() => loadConfig({ ...PROD, BILLING_PROVIDER: 'sandbox', ALGA_ALLOW_DEV_SECRETS: '1' })).toThrow(/BILLING_PROVIDER/)
    expect(loadConfig(PROD).billing.provider).toBe('none')
    expect(loadConfig({ NODE_ENV: 'test' }).billing.provider).toBe('sandbox')
    expect(() => new SandboxProvider(loadConfig(PROD))).toThrow(/production/)
    for (const k of ['MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET', 'BILLING_RETURN_URL'] as const) {
      expect(() => loadConfig({ ...PROD, ...MP, [k]: undefined })).toThrow(new RegExp(k))
    }
    expect(() => loadConfig({ ...PROD, ...MP, BILLING_RETURN_URL: 'http://algameet.com.br/r' })).toThrow(/https/)
    expect(loadConfig({ ...PROD, ...MP }).billing).toMatchObject({ provider: 'mercadopago', mercadopago: { apiUrl: 'https://api.mercadopago.com' } })
  })
})

// ---- Mercado Pago adapter against a simulated API (the real API was not exercised: no credentials) ---------------

const MP_HOOK_KEY = ['mp', 'hook', 'key', 'for', 'tests'].join('-')
const MP_TOKEN = ['fake', 'token', 'for', 'tests'].join('-')
const mpHeaders = (dataId: string, key = MP_HOOK_KEY, requestId = 'req-1', ts = String(Date.now())) => ({
  'content-type': 'application/json',
  'x-request-id': requestId,
  'x-signature': `ts=${ts},v1=${createHmac('sha256', key).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex')}`,
})

describe('mercado pago adapter', () => {
  it('validates x-signature (lowercased data.id, request id, ts) and maps statuses', () => {
    const mp = new MercadoPagoProvider({ accessToken: MP_TOKEN, webhookSecret: MP_HOOK_KEY, apiUrl: 'http://mp.test', returnUrl: 'https://r', notificationUrl: 'https://n' })
    expect(mp.verifySignature({ rawBody: '', headers: mpHeaders('ABC123'), query: { 'data.id': 'ABC123' } }).dataId).toBe('abc123')
    expect(() => mp.verifySignature({ rawBody: '', headers: mpHeaders('123', 'wrong'), query: { 'data.id': '123' } })).toThrow(WebhookRejected)
    expect(() => mp.verifySignature({ rawBody: '', headers: mpHeaders('123'), query: { 'data.id': '124' } })).toThrow(WebhookRejected)
    expect(() => mp.verifySignature({ rawBody: '', headers: mpHeaders('123'), query: {} })).toThrow(WebhookRejected)
    expect(() => mp.verifySignature({ rawBody: '', headers: { 'x-signature': 'garbage' }, query: { 'data.id': '1' } })).toThrow(WebhookRejected)
    expect(mapPaymentStatus('approved')).toBe('paid')
    expect(mapPaymentStatus('charged_back')).toBe('refunded')
    expect(mapPaymentStatus('in_process')).toBe('pending')
    expect(mapPreapprovalStatus('authorized')).toBe('active')
    expect(mapPreapprovalStatus('cancelled')).toBe('ended')
    expect(mapPreapprovalStatus('canceled')).toBe('ended')
    expect(parseReference('o_0190f000-0000-7000-8000-00000000000a')).toEqual({ kind: 'order', id: '0190f000-0000-7000-8000-00000000000a' })
    expect(parseReference('x_1')).toBeNull()
  })

  it('end to end on a server configured for Mercado Pago: checkout, signed webhooks, re-fetch, cancel', async () => {
    const store = new Map<string, Record<string, any>>()
    const calls: string[] = []
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      if (url.host !== 'mp.test') return realFetch(input, init)
      const method = init?.method ?? 'GET'
      calls.push(`${method} ${url.pathname}`)
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${MP_TOKEN}`)
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
      if (method === 'POST' && url.pathname === '/preapproval') {
        store.set('/preapproval/pa1', { ...body, id: 'pa1', status: 'pending', last_modified: new Date().toISOString() })
        return json({ id: 'pa1', init_point: 'https://mp.test/subscriptions/checkout?preapproval_id=pa1' })
      }
      if (method === 'POST' && url.pathname === '/checkout/preferences') return json({ id: 'pref1', init_point: 'https://mp.test/checkout/pref1' })
      if (method === 'PUT' && url.pathname.startsWith('/preapproval/')) {
        store.set(url.pathname, { ...store.get(url.pathname), ...body, last_modified: new Date(Date.now() + 1000).toISOString() })
        return json(store.get(url.pathname))
      }
      const hit = store.get(url.pathname)
      return hit ? json(hit) : json({ message: 'not found' }, 404)
    }))
    const m = await startServer({
      BILLING_PROVIDER: 'mercadopago', MP_ACCESS_TOKEN: MP_TOKEN, MP_WEBHOOK_SECRET: MP_HOOK_KEY, MP_API_URL: 'http://mp.test',
      BILLING_RETURN_URL: 'https://algameet.com.br/billing/return',
    })
    try {
      const hook = (type: string, dataId: string, headers = mpHeaders(dataId)) => m.app.inject({
        method: 'POST', url: `/api/v1/billing/webhooks/mercadopago?data.id=${dataId}&type=${type}`, headers,
        payload: JSON.stringify({ id: Number(String(Math.random()).slice(2, 12)), type, action: 'updated', data: { id: dataId } }),
      })
      const u = await register(m.app)
      const co = await api<CheckoutResponse>(m.app, 'POST', '/billing/checkout', { token: u.token, body: { productId: 'plus_monthly' } })
      expect(co.body).toMatchObject({ provider: 'mercadopago', sandbox: false, url: 'https://mp.test/subscriptions/checkout?preapproval_id=pa1' })
      const created = store.get('/preapproval/pa1')!
      expect(created).toMatchObject({
        external_reference: `s_${co.body.reference}`, payer_email: u.user.email, status: 'pending',
        auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: 14.9, currency_id: 'BRL' },
      })
      const [row] = await m.app.ctx.db.select().from(subscriptions).where(eq(subscriptions.id, co.body.reference))
      expect(row!.providerSubscriptionId).toBe('pa1')
      expect((await m.app.inject({ method: 'GET', url: `/api/v1/billing/sandbox/checkout/${co.body.reference}` })).statusCode).toBe(404)

      // Forged notification: rejected before any API call.
      const before = calls.length
      expect((await hook('subscription_preapproval', 'pa1', mpHeaders('pa1', 'forged'))).statusCode).toBe(401)
      expect(calls.length).toBe(before)
      // The panel's test notification (an id MP does not have): acknowledged, nothing applied, no retry loop.
      expect((await hook('payment', '123456')).statusCode).toBe(200)

      // Authorized at MP: the webhook only says "look at pa1"; the state comes from GET /preapproval/pa1.
      const next = new Date(Date.now() + 30 * DAY).toISOString()
      store.set('/preapproval/pa1', { ...created, status: 'authorized', next_payment_date: next, last_modified: new Date().toISOString() })
      expect((await hook('subscription_preapproval', 'pa1')).statusCode).toBe(200)
      expect(calls).toContain('GET /preapproval/pa1')
      expect((await api<Me>(m.app, 'GET', '/users/@me', { token: u.token })).body.plan!.id).toBe('plus')

      // A failed renewal (authorized payment rejected) → past_due, still inside the grace period.
      store.set('/authorized_payments/ap1', { id: 'ap1', preapproval_id: 'pa1', payment: { id: 99, status: 'rejected' }, last_modified: new Date(Date.now() + 500).toISOString() })
      expect((await hook('subscription_authorized_payment', 'ap1')).statusCode).toBe(200)
      expect((await api<BillingMe>(m.app, 'GET', '/billing/me', { token: u.token })).body.subscription).toMatchObject({ status: 'past_due', currentPeriodEnd: next })

      // Cancel: PUT /preapproval/pa1 {status: paused} (resumable; 'cancelled' is not); the paid period is kept.
      const cancel = await api<Subscription>(m.app, 'POST', '/billing/subscription/cancel', { token: u.token })
      expect(cancel.body.cancelAtPeriodEnd).toBe(true)
      expect(calls).toContain('PUT /preapproval/pa1')
      expect(store.get('/preapproval/pa1')!.status).toBe('paused')
      expect((await hook('subscription_preapproval', 'pa1')).statusCode).toBe(200)
      expect((await api<BillingMe>(m.app, 'GET', '/billing/me', { token: u.token })).body.subscription).toMatchObject({ cancelAtPeriodEnd: true, currentPeriodEnd: next })
      expect((await api<Me>(m.app, 'GET', '/users/@me', { token: u.token })).body.plan!.id).toBe('plus')

      // Resume: PUT {status: authorized}; the re-fetched preapproval confirms renewals are on.
      const resumed = await api<Subscription>(m.app, 'POST', '/billing/subscription/resume', { token: u.token })
      expect(resumed.body.cancelAtPeriodEnd).toBe(false)
      expect(store.get('/preapproval/pa1')!.status).toBe('authorized')
      expect((await hook('subscription_preapproval', 'pa1')).statusCode).toBe(200)
      expect((await api<BillingMe>(m.app, 'GET', '/billing/me', { token: u.token })).body.subscription).toMatchObject({ status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: next })
      // Paused from the payer's own MP account, then resumed there: the webhooks follow it both ways.
      store.set('/preapproval/pa1', { ...store.get('/preapproval/pa1'), status: 'paused', last_modified: new Date(Date.now() + 2000).toISOString() })
      await hook('subscription_preapproval', 'pa1')
      expect((await api<BillingMe>(m.app, 'GET', '/billing/me', { token: u.token })).body.subscription!.cancelAtPeriodEnd).toBe(true)
      store.set('/preapproval/pa1', { ...store.get('/preapproval/pa1'), status: 'authorized', last_modified: new Date(Date.now() + 3000).toISOString() })
      await hook('subscription_preapproval', 'pa1')
      expect((await api<BillingMe>(m.app, 'GET', '/billing/me', { token: u.token })).body.subscription!.cancelAtPeriodEnd).toBe(false)

      // One-time purchase: Checkout Pro preference, then a payment notification re-fetched from /v1/payments.
      const order = await api<CheckoutResponse>(m.app, 'POST', '/billing/checkout', { token: u.token, body: { productId: 'deco_ha_orbita' } })
      expect(order.body.url).toBe('https://mp.test/checkout/pref1')
      store.set('/v1/payments/555', {
        id: 555, status: 'approved', external_reference: `o_${order.body.reference}`, transaction_amount: 9.9, currency_id: 'BRL',
        date_last_updated: new Date().toISOString(),
      })
      expect((await hook('payment', '555')).statusCode).toBe(200)
      const me = (await api<BillingMe>(m.app, 'GET', '/billing/me', { token: u.token })).body
      expect(me.orders[0]).toMatchObject({ id: order.body.reference, status: 'paid', sandbox: false })
      expect(me.items.map((i) => i.sku)).toContain('deco_ha_orbita')

      // Account deletion cancels the preapproval for good (never resumable).
      expect((await api(m.app, 'DELETE', '/users/@me', { token: u.token, body: { password: u.password } })).status).toBe(202)
      expect(store.get('/preapproval/pa1')!.status).toBe('cancelled')
    } finally {
      await m.close()
      vi.unstubAllGlobals()
    }
  })
})
