/**
 * Catalog v2 and growth-plan work package A (docs/business/growth-plan.md §5.2 "Aceite"): Hora Azul, bundles, gifts,
 * wishlist, Plus v2, Casa, refunds, try-on. Every grant here comes from a signed sandbox webhook, the sandbox page or
 * (last describe) a Mercado Pago API simulated behind a stubbed fetch.
 */
import { createHmac } from 'node:crypto'
import {
  todayInBrazil, uuidv7,
  type AuthResponse, type BillingCatalog, type BillingMe, type CheckoutResponse, type Gift, type Me, type Order, type Product,
  type PublicUser, type Quote, type SpaceSnapshot, type SpaceUpgrade, type Subscription, type TryOn, type Wishlist,
} from '@alga/shared'
import { and, eq, or } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { COLLECTIONS, PRODUCTS, productById } from '../src/billing/catalog.js'
import { SANDBOX_SIGNATURE_HEADER, sandboxSignature } from '../src/billing/provider.js'
import { loadConfig } from '../src/config.js'
import { orders, products, relationships, subscriptions, users } from '../src/db/schema.js'
import { api, befriend, connect, postWebhook, register, startServer, type TestServer } from './helpers.js'

let s: TestServer
beforeAll(async () => { s = await startServer() })
afterAll(async () => { await s.close() })
afterEach(() => { vi.restoreAllMocks() })

const DAY = 24 * 3600 * 1000
type User = AuthResponse & { password: string }
let evSeq = 0

async function hook(event: unknown, app: FastifyInstance = s.app, secret = s.config.billing.sandboxSecret) {
  const raw = JSON.stringify(event)
  const res = await app.inject({
    method: 'POST', url: '/api/v1/billing/webhooks/sandbox',
    headers: { 'content-type': 'application/json', [SANDBOX_SIGNATURE_HEADER]: sandboxSignature(secret, raw) }, payload: raw,
  })
  return res.statusCode
}
const update = (kind: 'order' | 'subscription', reference: string, status: string, extra: Record<string, unknown> = {}, id = `V2_${++evSeq}`) =>
  ({ id, type: `test.${kind}`, updates: [{ kind, reference, status, occurredAt: new Date().toISOString(), ...extra }] })
const pay = async (reference: string, amountCents: number, id?: string) =>
  expect(await hook(update('order', reference, 'paid', { amountCents, currency: 'BRL', providerPaymentId: `pay_${reference}` }, id))).toBe(200)

const call = <T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, u: User | null, body?: unknown) =>
  api<T>(s.app, method, url, { ...(u ? { token: u.token } : {}), ...(body !== undefined ? { body } : {}) })
const checkout = (u: User, productId: string) => call<CheckoutResponse>('POST', '/billing/checkout', u, { productId })
const gift = (u: User, body: Record<string, unknown>) => call<CheckoutResponse>('POST', '/billing/gifts', u, body)
const billingMe = async (u: User) => (await call<BillingMe>('GET', '/billing/me', u)).body
const skus = async (u: User) => (await billingMe(u)).items.map((i) => i.sku)
const planOf = async (u: User) => (await call<Me>('GET', '/users/@me', u)).body.plan!.id
const quote = (u: User, productId: string, recipientId?: string) =>
  call<Quote>('GET', `/billing/quote?productId=${productId}${recipientId ? `&recipientId=${recipientId}` : ''}`, u)
const openPage = (url: string, app = s.app) => app.inject({ method: 'GET', url: new URL(url).pathname + new URL(url).search })

async function buy(u: User, productId: string) {
  const co = (await checkout(u, productId)).body
  await pay(co.reference, co.amountCents!)
  return co
}

/** Plus through a signed webhook (no payment id: a 7-day refund of it waits for the provider). */
async function subscribed(productId = 'plus_monthly', periodEnd = new Date(Date.now() + 30 * DAY)) {
  const u = await register(s.app)
  const co = (await checkout(u, productId)).body
  expect(await hook(update('subscription', co.reference, 'active', { currentPeriodEnd: periodEnd.toISOString(), amountCents: productById(productId)!.priceBrlCents }))).toBe(200)
  return Object.assign(u, { reference: co.reference })
}

/** Friends for 4 days: gifts and passes need GIFT_MIN_FRIENDSHIP_HOURS. */
async function oldFriends(a: User, b: User) {
  await befriend(s.app, a, b)
  await s.app.ctx.db.update(relationships).set({ since: new Date(Date.now() - 4 * DAY) }).where(or(
    and(eq(relationships.userId, a.user.id), eq(relationships.targetId, b.user.id)),
    and(eq(relationships.userId, b.user.id), eq(relationships.targetId, a.user.id)),
  ))
}

const asTeen = async (u: User) => {
  const [y, m, d] = todayInBrazil().split('-').map(Number) as [number, number, number]
  await s.app.ctx.db.update(users).set({ birthDate: new Date(Date.UTC(y - 17, m - 1, d)).toISOString().slice(0, 10) }).where(eq(users.id, u.user.id))
}

/** Runs fn with wave 2's opening date set to `at` (null = not scheduled), then puts the catalog's own date back. */
const withWave2At = async (at: string | null, fn: () => Promise<void>) => {
  const real = COLLECTIONS[0]!.waves[1]!.opensAt
  COLLECTIONS[0]!.waves[1]!.opensAt = at
  try { await fn() } finally { COLLECTIONS[0]!.waves[1]!.opensAt = real }
}
const withWave2 = (fn: () => Promise<void>) => withWave2At('2026-01-01T00:00:00Z', fn)

async function spaceWith(owner: User, ...members: User[]) {
  const space = (await call<SpaceSnapshot>('POST', '/spaces', owner, { name: 'Galera' })).body
  const inv = (await call('POST', `/spaces/${space.id}/invites`, owner, {})).body
  for (const m of members) expect((await call('POST', `/invites/${inv.code}`, m)).status).toBe(200)
  return space
}

describe('catalog v2', () => {
  it('wave 2 is open in the real catalog (owner, 2026-11-08): bundles are on sale', async () => {
    expect(COLLECTIONS[0]!.waves[1]!.opensAt).toBe('2026-11-08T00:00:00-03:00')
    const cat = (await call<BillingCatalog>('GET', '/billing/catalog', null)).body
    expect(cat.products.filter((p) => p.kind === 'bundle').every((p) => p.available)).toBe(true)
  })

  it('Hora Azul: 28 items in waves 1/2, 25 sold for R$ 240,50, bundles, Plus wardrobe, Casa; v1 retired', () => withWave2At(null, async () => {
    const cat = (await call<BillingCatalog>('GET', '/billing/catalog', null)).body
    expect(cat.version).toBe(3)
    const ha = cat.products.filter((p) => p.collectionId === 'hora_azul' && p.kind === 'cosmetic')
    expect(ha).toHaveLength(28)
    expect(ha.filter((p) => p.wave === 1)).toHaveLength(18)
    const sold = ha.filter((p) => p.purchasable)
    expect(sold).toHaveLength(25)
    expect(sold.reduce((n, p) => n + p.priceBrlCents, 0)).toBe(24050)
    expect(ha.filter((p) => p.hero).map((p) => p.id).sort())
      .toEqual(['aura_ha_respiro', 'deco_ha_halo_vidro', 'effect_ha_hora_azul', 'frame_ha_cinema', 'nameplate_ha_crepusculo'])
    expect(ha.filter((p) => p.available)).toHaveLength(16) // wave 1 is open, wave 2 not scheduled yet
    expect(ha.filter((p) => p.includedIn?.includes('plus')).map((p) => p.id).sort()).toEqual(['aura_ha_frondes', 'icon_ha_noite', 'icon_ha_porcelana'])
    expect(cat.products.find((p) => p.id === 'aura_ha_respiro')).toMatchObject({ cosmeticType: 'voice_aura', wave: 2, purchasable: true, available: false })
    expect(cat.collections).toEqual([
      expect.objectContaining({ id: 'hora_azul', waves: [expect.objectContaining({ wave: 1, open: true }), { wave: 2, opensAt: null, open: false }] }),
      expect.objectContaining({ id: 'atelie', waves: [expect.objectContaining({ wave: 1, open: true })] }), // Alga Worlds (worlds.test.ts)
    ])
    const bundles = cat.products.filter((p) => p.kind === 'bundle').map((p) => [p.id, p.priceBrlCents, p.items!.length, p.available])
    expect(bundles).toEqual([
      ['bundle_ha_hora_azul', 4790, 5, false], ['bundle_ha_vidro', 3590, 5, false],
      ['bundle_ha_kit_chamada', 2290, 3, false], ['bundle_ha_kit_transmissao', 2690, 3, false],
    ])
    expect(cat.products.filter((p) => p.kind === 'space_upgrade').map((p) => [p.priceBrlCents, p.days]))
      .toEqual([[500, 7], [1000, 15], [1990, 30], [19900, 365]])
    expect(cat.products.find((p) => p.id === 'plus_yearly_once')).toMatchObject({ kind: 'plan', billing: 'one_time', interval: 'year', priceBrlCents: 14900, giftable: true })
    expect(cat.plans[1]!.perks).toEqual(expect.arrayContaining(['wardrobe', 'tenure_badge', 'friend_passes', 'annual_item', 'animated_banner', 'app_accents']))
    expect(cat.spaceUpgrade!.perks).not.toContain('cinema')
    expect(cat.spaceUpgrade!.tones).toHaveLength(6)
    for (const id of ['deco_folha_de_alga', 'deco_coral', 'theme_noite_paulistana', 'effect_bioluminescencia', 'nameplate_cardume', 'theme_plus_mare', 'nameplate_plus_correnteza']) {
      const p = cat.products.find((x) => x.id === id)!
      expect(p).toMatchObject({ retired: true, purchasable: false, available: false })
      expect(p.includedIn).toBeUndefined()
      expect((await s.app.ctx.db.select({ active: products.active }).from(products).where(eq(products.id, id)))[0]!.active).toBe(false)
    }

    const u = await register(s.app)
    expect((await checkout(u, 'aura_ha_respiro')).status).toBe(409) // wave 2 not open
    expect((await checkout(u, 'bundle_ha_vidro')).status).toBe(409) // has wave-2 items
    expect((await checkout(u, 'deco_coral')).status).toBe(404) // retired
    expect((await checkout(u, 'casa_7d')).status).toBe(404) // only through a space
  }))

  it('a v1 item someone owns stays theirs and equippable (grandfathered)', async () => {
    const u = await register(s.app)
    const id = uuidv7()
    await s.app.ctx.db.insert(orders).values({ id, userId: u.user.id, productId: 'deco_coral', status: 'pending', amountCents: 990, currency: 'BRL', provider: 'sandbox', items: ['deco_coral'] })
    await pay(id, 990)
    expect(await skus(u)).toContain('deco_coral')
    expect((await call<Me>('PUT', '/users/@me/cosmetics', u, { avatarDecoration: 'deco_coral' })).body.cosmetics).toEqual({ avatarDecoration: 'deco_coral' })
  })
})

describe('bundles', () => {
  it('price = bundle × missing ÷ all, rounded down to ,90 (0, 1 and all owned); one paid webhook grants the missing items at once', () => withWave2(async () => {
    const u = await register(s.app)
    expect((await quote(u, 'bundle_ha_hora_azul')).body).toMatchObject({ amountCents: 4790, items: expect.arrayContaining(['deco_ha_halo_vidro']) })
    await buy(u, 'deco_ha_halo_vidro')
    const q = (await quote(u, 'bundle_ha_hora_azul')).body
    expect(q.amountCents).toBe(3790) // 47,90 × 50,60 ÷ 63,50 = 38,17 → 37,90
    expect(q.items).toHaveLength(4)
    const gw = await connect(s.port, u.token)
    const co = (await checkout(u, 'bundle_ha_hora_azul')).body
    expect(co.amountCents).toBe(3790)
    expect(await skus(u)).not.toContain('frame_ha_cinema') // nothing before the provider confirms
    await hook(update('order', co.reference, 'paid', { amountCents: 3000, currency: 'BRL', providerPaymentId: 'low' })) // below the price
    expect(await skus(u)).not.toContain('frame_ha_cinema')
    await pay(co.reference, 3790)
    const ent = await gw.waitFor('ENTITLEMENTS_UPDATE', (d) => d.items.some((i) => i.sku === 'frame_ha_cinema'))
    for (const sku of ['deco_ha_halo_vidro', 'effect_ha_hora_azul', 'nameplate_ha_crepusculo', 'aura_ha_respiro', 'frame_ha_cinema']) {
      expect(ent.items.find((i) => i.sku === sku)).toMatchObject({ source: 'order', expiresAt: null })
    }
    expect((await billingMe(u)).orders.find((o) => o.id === co.reference)!.items!.sort())
      .toEqual(['aura_ha_respiro', 'effect_ha_hora_azul', 'frame_ha_cinema', 'nameplate_ha_crepusculo'])
    expect((await quote(u, 'bundle_ha_hora_azul')).status).toBe(409) // all owned
    expect((await checkout(u, 'bundle_ha_hora_azul')).status).toBe(409)
    gw.close()
  }))
})

describe('gifts', () => {
  it('only to friends of 72 h+, never across a block, not to yourself, not an item they own; 16–17 cannot give', async () => {
    const [a, b, c, d] = [await register(s.app), await register(s.app), await register(s.app), await register(s.app)]
    const body = { productId: 'deco_ha_orbita', recipientId: b.user.id }
    expect((await gift(a, body)).status).toBe(403) // not friends
    await befriend(s.app, a, b)
    expect((await gift(a, body)).status).toBe(403) // friends for less than 72 h
    await oldFriends(a, d)
    expect((await call('PUT', `/relationships/${a.user.id}`, d, { type: 'blocked' })).status).toBe(200)
    expect((await gift(a, { ...body, recipientId: d.user.id })).status).toBe(403) // blocked
    await s.app.ctx.db.update(relationships).set({ since: new Date(Date.now() - 4 * DAY) }).where(eq(relationships.userId, a.user.id))
    expect((await gift(a, { ...body, recipientId: a.user.id })).status).toBe(400)
    expect((await gift(a, { ...body, productId: 'plus_monthly' })).status).toBe(404) // renewing plans are not gifts
    expect((await gift(a, { ...body, message: 'x'.repeat(141) })).status).toBe(400)
    expect((await quote(a, 'deco_ha_constelacao', b.user.id)).body.amountCents).toBe(990)
    await buy(b, 'deco_ha_orbita')
    expect((await gift(a, body)).status).toBe(409) // they own it
    expect((await quote(a, 'deco_ha_orbita', b.user.id)).status).toBe(409)
    await oldFriends(c, b)
    await asTeen(c)
    expect((await gift(c, { ...body, productId: 'deco_ha_constelacao' })).status).toBe(403)
  })

  it('paid → GIFT_RECEIVED, usable only once opened; the payer’s refund revokes it with GIFT_UPDATE; refusing refunds the payer', async () => {
    const [a, b] = [await register(s.app), await register(s.app)]
    await oldFriends(a, b)
    const ga = await connect(s.port, a.token)
    const gb = await connect(s.port, b.token)
    const mails = vi.spyOn(s.app.ctx.mail.sender, 'send')
    const co = (await gift(a, { productId: 'deco_ha_fita_seda', recipientId: b.user.id, message: 'parabéns!' })).body
    expect(co).toMatchObject({ kind: 'order', amountCents: 1290, giftId: expect.any(String) })
    expect((await gift(a, { productId: 'deco_ha_fita_seda', recipientId: b.user.id })).status).toBe(409) // already on its way
    await gb.expectNone('GIFT_RECEIVED', undefined, 100)
    expect((await billingMe(b)).gifts).toEqual([]) // the unpaid gift is the sender's only
    await pay(co.reference, 1290)
    const got = await gb.waitFor('GIFT_RECEIVED', (d) => d.id === co.giftId)
    expect(got).toMatchObject({ status: 'delivered', message: 'parabéns!', items: ['deco_ha_fita_seda'], orderId: null })
    expect(got.sender!.id).toBe(a.user.id)
    expect(await skus(b)).not.toContain('deco_ha_fita_seda')
    expect(await skus(a)).not.toContain('deco_ha_fita_seda')
    const receipt = mails.mock.calls.map((x) => x[0]).find((m) => m.to === a.user.email && m.kind === 'receipt')!
    expect(receipt.text).toMatch(/Pagamento único/)
    expect(receipt.text).toContain(`@${b.user.username}`)
    expect(receipt.text).not.toContain('parabéns') // the message never goes into a mail
    expect(mails.mock.calls.some((x) => x[0].to === b.user.email && x[0].kind === 'gift')).toBe(true)

    const accept = await call<Gift>('POST', `/billing/gifts/${co.giftId}/accept`, b)
    expect(accept.body.status).toBe('accepted')
    await ga.waitFor('GIFT_UPDATE', (d) => d.id === co.giftId && d.status === 'accepted')
    expect(await skus(b)).toContain('deco_ha_fita_seda')
    expect((await call('PUT', '/users/@me/cosmetics', b, { avatarDecoration: 'deco_ha_fita_seda' })).status).toBe(200)
    expect((await call('POST', `/billing/gifts/${co.giftId}/accept`, b)).status).toBe(200) // idempotent
    expect((await call('POST', `/billing/gifts/${co.giftId}/decline`, b)).status).toBe(409) // opened
    expect((await call('POST', `/billing/gifts/${co.giftId}/accept`, a)).status).toBe(404) // not the recipient

    const refund = await call<Order>('POST', `/billing/orders/${co.reference}/refund`, a)
    expect(refund.body).toMatchObject({ status: 'refunded', giftId: co.giftId })
    await gb.waitFor('GIFT_UPDATE', (d) => d.id === co.giftId && d.status === 'refunded')
    expect(await skus(b)).not.toContain('deco_ha_fita_seda')
    expect((await call<Me>('GET', '/users/@me', b)).body.cosmetics).toBeUndefined()

    const co2 = (await gift(a, { productId: 'nameplate_ha_nanquim', recipientId: b.user.id })).body
    await pay(co2.reference, 590)
    await gb.waitFor('GIFT_RECEIVED', (d) => d.id === co2.giftId)
    expect((await call<Gift>('POST', `/billing/gifts/${co2.giftId}/decline`, b)).body.status).toBe('declined')
    await ga.waitFor('GIFT_UPDATE', (d) => d.id === co2.giftId && d.status === 'declined')
    expect((await billingMe(a)).orders.find((o) => o.id === co2.reference)!.status).toBe('refunded')
    expect(await skus(b)).not.toContain('nameplate_ha_nanquim')
    ga.close()
    gb.close()
  })

  it('16–17 receive only with "Abrir" and get no gift e-mail', async () => {
    const [a, t] = [await register(s.app), await register(s.app)]
    await oldFriends(a, t)
    await asTeen(t)
    const gt = await connect(s.port, t.token)
    const mails = vi.spyOn(s.app.ctx.mail.sender, 'send')
    const co = (await gift(a, { productId: 'theme_ha_porcelana', recipientId: t.user.id })).body
    await pay(co.reference, 990)
    await gt.waitFor('GIFT_RECEIVED', (d) => d.id === co.giftId)
    expect(await skus(t)).not.toContain('theme_ha_porcelana')
    expect(mails.mock.calls.some((x) => x[0].to === t.user.email && x[0].kind === 'gift')).toBe(false)
    await call('POST', `/billing/gifts/${co.giftId}/accept`, t)
    expect(await skus(t)).toContain('theme_ha_porcelana')
    gt.close()
  })

  it('scheduled delivery: paid now, delivered by the sweep on its date', async () => {
    const [a, b] = [await register(s.app), await register(s.app)]
    await oldFriends(a, b)
    expect((await gift(a, { productId: 'deco_ha_orbita', recipientId: b.user.id, deliverAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(400)
    expect((await gift(a, { productId: 'deco_ha_orbita', recipientId: b.user.id, deliverAt: new Date(Date.now() + 61 * DAY).toISOString() })).status).toBe(400)
    const at = new Date(Date.now() + 2 * DAY)
    const co = (await gift(a, { productId: 'deco_ha_orbita', recipientId: b.user.id, deliverAt: at.toISOString() })).body
    const gb = await connect(s.port, b.token)
    await pay(co.reference, 990)
    expect((await billingMe(a)).gifts!.find((g) => g.id === co.giftId)!.status).toBe('scheduled')
    await gb.expectNone('GIFT_RECEIVED', undefined, 100)
    await s.app.ctx.billing.sweep(new Date(at.getTime() + 1000))
    expect((await gb.waitFor('GIFT_RECEIVED', (d) => d.id === co.giftId)).status).toBe('delivered')
    gb.close()
  })

  it('Plus as a gift: a 12-month period with no renewal starting when opened; refused for someone renewing', async () => {
    const [a, b] = [await register(s.app), await register(s.app)]
    await oldFriends(a, b)
    const co = (await gift(a, { productId: 'plus_yearly_once', recipientId: b.user.id })).body
    expect(co.amountCents).toBe(14900)
    await pay(co.reference, 14900)
    expect(await planOf(b)).toBe('free')
    const g = (await billingMe(b)).gifts!.find((x) => x.id === co.giftId)!
    expect((await call('POST', `/billing/gifts/${g.id}/accept`, b)).status).toBe(200)
    expect(await planOf(b)).toBe('plus')
    const sub = (await billingMe(b)).subscription!
    expect(sub).toMatchObject({ kind: 'period', cancelAtPeriodEnd: true, refundableUntil: null })
    expect(new Date(sub.currentPeriodEnd!).getTime() - Date.now()).toBeGreaterThan(360 * DAY)
    expect((await call('POST', '/billing/subscription/resume', b)).status).toBe(409) // never renews
    expect((await call<Subscription>('POST', '/billing/subscription/cancel', b)).body.cancelAtPeriodEnd).toBe(true)
    const c = await subscribed()
    await oldFriends(a, c)
    expect((await gift(a, { productId: 'plus_monthly_once', recipientId: c.user.id })).status).toBe(409)
  })

  it('anti-fraud: past R$ 100/day in gifts the provider page is Pix-only; past R$ 300/day, 409', async () => {
    const [a, b] = [await register(s.app), await register(s.app)]
    await oldFriends(a, b)
    expect((await gift(a, { productId: 'deco_ha_halo_vidro', recipientId: b.user.id })).body.pixOnly).toBeUndefined()
    expect((await gift(a, { productId: 'plus_yearly_once', recipientId: b.user.id })).body.pixOnly).toBe(true) // 161,90
    expect((await gift(a, { productId: 'plus_monthly_once', recipientId: b.user.id })).body.pixOnly).toBe(true) // 176,80
    expect((await gift(a, { productId: 'plus_yearly_once', recipientId: b.user.id })).status).toBe(409) // 325,80
  })
})

describe('wishlist', () => {
  it('up to 20, friends only, hidden on request and by default for 16–17; owned items drop out', async () => {
    const [a, b, c] = [await register(s.app), await register(s.app), await register(s.app)]
    expect((await call<Wishlist>('GET', '/billing/wishlist', a)).body).toEqual({ userId: a.user.id, items: [], visible: true })
    expect((await call<Wishlist>('PUT', '/billing/wishlist/deco_ha_orbita', a)).body.items).toEqual(['deco_ha_orbita'])
    expect((await call<Wishlist>('PUT', '/billing/wishlist/deco_ha_orbita', a)).body.items).toEqual(['deco_ha_orbita'])
    expect((await call('PUT', '/billing/wishlist/plus_monthly', a)).status).toBe(404)
    expect((await call('PUT', '/billing/wishlist/deco_coral', a)).status).toBe(404) // retired
    await call('PUT', '/billing/wishlist/bundle_ha_vidro', a)
    expect((await call('GET', `/users/${a.user.id}/wishlist`, b)).status).toBe(404) // not a friend
    await befriend(s.app, a, b)
    expect((await call<Wishlist>('GET', `/users/${a.user.id}/wishlist`, b)).body.items).toEqual(['deco_ha_orbita', 'bundle_ha_vidro'])
    await buy(a, 'deco_ha_orbita')
    expect((await call<Wishlist>('GET', `/users/${a.user.id}/wishlist`, b)).body.items).toEqual(['bundle_ha_vidro'])
    expect((await call('PUT', '/billing/wishlist/deco_ha_orbita', a)).status).toBe(409) // owned
    expect((await call<Wishlist>('DELETE', '/billing/wishlist/bundle_ha_vidro', a)).body.items).toEqual([])
    expect((await call<Wishlist>('PATCH', '/billing/wishlist', a, { visible: false })).body.visible).toBe(false)
    expect((await call('GET', `/users/${a.user.id}/wishlist`, b)).status).toBe(404)

    const sold = PRODUCTS.filter((p) => p.kind === 'cosmetic' && p.purchasable && !p.retired).slice(0, 21)
    for (const p of sold.slice(0, 20)) expect((await call('PUT', `/billing/wishlist/${p.id}`, c)).status).toBe(200)
    expect((await call('PUT', `/billing/wishlist/${sold[20]!.id}`, c)).status).toBe(409)

    const t = await register(s.app)
    await asTeen(t)
    await befriend(s.app, t, b)
    expect((await call<Wishlist>('GET', '/billing/wishlist', t)).body.visible).toBe(false)
    expect((await call('GET', `/users/${t.user.id}/wishlist`, b)).status).toBe(404)
  })
})

describe('Plus v2', () => {
  it('wardrobe: aura, icons and accents while subscribed; app icon/accent are private; a monthly item joins on its date', async () => {
    const u = await subscribed()
    const f = await register(s.app)
    await befriend(s.app, u, f)
    expect(await skus(u)).toEqual(expect.arrayContaining(['aura_ha_frondes', 'icon_ha_noite', 'icon_ha_porcelana', 'accent_lavanda', 'accent_ardosia', 'accent_grafite']))
    const fgw = await connect(s.port, f.token)
    const me = await call<Me>('PUT', '/users/@me/cosmetics', u, { voiceAura: 'aura_ha_frondes', appIcon: 'icon_ha_noite', appAccent: 'accent_grafite' })
    expect(me.body.cosmetics).toEqual({ voiceAura: 'aura_ha_frondes', appIcon: 'icon_ha_noite', appAccent: 'accent_grafite' })
    expect((await call<PublicUser>('GET', `/users/${u.user.id}`, f)).body.cosmetics).toEqual({ voiceAura: 'aura_ha_frondes' })
    const seen = await fgw.waitFor('USER_UPDATE', (d) => d.id === u.user.id && !!d.cosmetics)
    expect(seen.cosmetics).toEqual({ voiceAura: 'aura_ha_frondes' })
    expect(fgw.events.some((e) => e.t === 'USER_UPDATE' && JSON.stringify(e.d).includes('icon_ha_noite'))).toBe(false)
    fgw.close()

    const now = Date.now()
    const monthly: Product = {
      id: 'nameplate_ha_test_mes', kind: 'cosmetic', cosmeticType: 'nameplate', name: 'Teste', description: '', priceBrlCents: 0,
      priceUsdCents: 0, purchasable: false, includedIn: ['plus'], includedFrom: new Date(now + 3600_000).toISOString(),
    }
    PRODUCTS.push(monthly)
    try {
      await s.app.ctx.billing.sweep(new Date(now))
      expect(await skus(u)).not.toContain(monthly.id)
      await s.app.ctx.billing.sweep(new Date(now + 2 * 3600_000))
      expect(await skus(u)).toContain(monthly.id)
    } finally {
      PRODUCTS.splice(PRODUCTS.indexOf(monthly), 1)
    }
  })

  it('tenure badge counts months summed (not consecutive), refunds and passes excluded; shown only while Plus is active', async () => {
    const u = await register(s.app)
    const f = await register(s.app)
    await befriend(s.app, u, f)
    const old = (startedDaysAgo: number, endedDaysAgo: number, status: 'expired' | 'canceled') => ({
      id: uuidv7(), userId: u.user.id, productId: 'plus_monthly', planId: 'plus', status, kind: 'renewing' as const,
      startedAt: new Date(Date.now() - startedDaysAgo * DAY), currentPeriodEnd: new Date(Date.now() - endedDaysAgo * DAY),
      cancelAtPeriodEnd: true, amountCents: 1490, currency: 'BRL' as const, provider: 'sandbox' as const,
    })
    await s.app.ctx.db.insert(subscriptions).values([old(400, 360, 'expired'), old(160, 100, 'expired'), old(300, 200, 'canceled')])
    expect((await billingMe(u)).plus).toMatchObject({ tenureMonths: 3, badge: null, passesLeft: 0 }) // 40 + 60 days
    expect((await call<PublicUser>('GET', `/users/${u.user.id}`, f)).body.plusBadge).toBeUndefined()
    const co = (await checkout(u, 'plus_monthly')).body
    const fgw = await connect(s.port, f.token)
    await hook(update('subscription', co.reference, 'active', { currentPeriodEnd: new Date(Date.now() + 30 * DAY).toISOString(), amountCents: 1490 }))
    expect((await billingMe(u)).plus).toMatchObject({ tenureMonths: 3, badge: 3, passesLeft: 2, annualItem: null })
    expect((await call<PublicUser>('GET', `/users/${u.user.id}`, f)).body.plusBadge).toBe(3)
    await fgw.waitFor('USER_UPDATE', (d) => d.id === u.user.id && d.plusBadge === 3)
    await hook(update('subscription', co.reference, 'revoked'))
    await fgw.waitFor('USER_UPDATE', (d) => d.id === u.user.id && d.plusBadge === undefined)
    expect((await call<Me>('GET', '/users/@me', u)).body.plusBadge).toBeUndefined()
    expect((await billingMe(u)).plus!.tenureMonths).toBe(3)
    fgw.close()
  })

  it('Plus passes: 2 a month from a paid subscriber to adult friends, 1 per person per 12 months, 7 days from "Abrir"', async () => {
    const g = await subscribed()
    const [r1, r2, r3, t, x] = [await register(s.app), await register(s.app), await register(s.app), await register(s.app), await register(s.app)]
    for (const r of [r1, r2, r3, t]) await oldFriends(g, r)
    await oldFriends(x, r1)
    await asTeen(t)
    const pass = (from: User, to: User) => call<Gift>('POST', '/billing/passes', from, { recipientId: to.user.id })
    expect((await pass(x, r1)).status).toBe(403) // not a subscriber
    expect((await pass(g, t)).status).toBe(403) // 16–17
    const gr1 = await connect(s.port, r1.token)
    const p1 = await pass(g, r1)
    expect(p1.status).toBe(201)
    expect(p1.body).toMatchObject({ productId: 'plus_pass_7d', status: 'delivered', orderId: null })
    await gr1.waitFor('GIFT_RECEIVED', (d) => d.id === p1.body.id)
    expect(await planOf(r1)).toBe('free')
    await call('POST', `/billing/gifts/${p1.body.id}/accept`, r1)
    expect(await planOf(r1)).toBe('plus')
    const sub = (await billingMe(r1)).subscription!
    expect(sub.kind).toBe('pass')
    expect(new Date(sub.currentPeriodEnd!).getTime() - Date.now()).toBeGreaterThan(6.9 * DAY)
    expect((await billingMe(r1)).plus).toMatchObject({ tenureMonths: 0, badge: null, passesLeft: 0 }) // passes do not count
    expect((await pass(r1, r2)).status).toBe(403) // a pass holder cannot pass it on

    const p2 = await pass(g, r2)
    expect(p2.status).toBe(201)
    expect((await billingMe(g)).plus!.passesLeft).toBe(0)
    expect((await pass(g, r3)).status).toBe(409) // 2 this month
    const g2 = await subscribed()
    await oldFriends(g2, r2)
    expect((await pass(g2, r2)).status).toBe(409) // already got one in 12 months
    await call('POST', `/billing/gifts/${p2.body.id}/decline`, r2)
    expect((await pass(g, r3)).status).toBe(201) // a refused pass goes back to the giver
    gr1.close()
  })

  it('annual: one Coleção 01 item up to R$ 12,90 per paid year; it stays after the plan ends, goes if the plan is refunded', async () => {
    const claim = (u: User, productId: string) => call<Order>('POST', '/billing/plus/annual-item', u, { productId })
    const m = await subscribed('plus_monthly')
    expect((await claim(m, 'deco_ha_orbita')).status).toBe(403)
    const y = await subscribed('plus_yearly', new Date(Date.now() + 365 * DAY))
    expect((await billingMe(y)).plus!.annualItem).toEqual({ available: true, claimedProductId: null })
    expect((await claim(y, 'effect_ha_hora_azul')).status).toBe(400) // R$ 16,90
    await withWave2At(null, async () => expect((await claim(y, 'aura_ha_respiro')).status).toBe(400)) // wave 2 not open
    const order = await claim(y, 'deco_ha_halo_vidro')
    expect(order.body).toMatchObject({ amountCents: 0, status: 'paid', items: ['deco_ha_halo_vidro'], refundableUntil: null })
    expect((await claim(y, 'deco_ha_orbita')).status).toBe(409)
    expect((await call('POST', `/billing/orders/${order.body.id}/refund`, y)).status).toBe(409)
    expect((await billingMe(y)).plus!.annualItem).toEqual({ available: false, claimedProductId: 'deco_ha_halo_vidro' })
    await hook(update('subscription', y.reference, 'ended', { currentPeriodEnd: new Date(Date.now() - 1000).toISOString() }))
    expect(await planOf(y)).toBe('free')
    expect((await billingMe(y)).items.find((i) => i.sku === 'deco_ha_halo_vidro')).toMatchObject({ source: 'order', expiresAt: null })

    const y2 = await subscribed('plus_yearly', new Date(Date.now() + 365 * DAY))
    await claim(y2, 'theme_ha_porcelana')
    await hook(update('subscription', y2.reference, 'revoked'))
    expect(await skus(y2)).not.toContain('theme_ha_porcelana')
  })

  it('Plus paid once (Pix): 12 months, no renewal, refundable in 7 days; not on top of a renewing subscription', async () => {
    const u = await register(s.app)
    const mails = vi.spyOn(s.app.ctx.mail.sender, 'send')
    const co = (await checkout(u, 'plus_yearly_once')).body
    expect(co).toMatchObject({ kind: 'order', amountCents: 14900 })
    expect(await planOf(u)).toBe('free')
    await pay(co.reference, 14900)
    expect(await planOf(u)).toBe('plus')
    expect((await billingMe(u)).subscription).toMatchObject({ kind: 'period', cancelAtPeriodEnd: true })
    expect((await call('POST', '/billing/subscription/resume', u)).status).toBe(409)
    expect(mails.mock.calls.find((x) => x[0].to === u.user.email && x[0].kind === 'receipt')![0].text).toMatch(/Pagamento único/)
    expect((await call<Order>('POST', `/billing/orders/${co.reference}/refund`, u)).body.status).toBe('refunded')
    expect(await planOf(u)).toBe('free')
    expect((await billingMe(u)).subscriptions[0]!.status).toBe('canceled')
    const r = await subscribed()
    expect((await checkout(r, 'plus_yearly_once')).status).toBe(409)
  })
})

describe('Casa', () => {
  it('members 18+ contribute; days add up and come off with a refund; wall without amounts; no renewal; ends in the same job', async () => {
    await s.app.ctx.billing.sweep(new Date())
    const [o, ana, bia, x, t] = [await register(s.app, `zeca${evSeq}`), await register(s.app), await register(s.app), await register(s.app), await register(s.app)]
    await s.app.ctx.db.update(users).set({ displayName: 'Ana' }).where(eq(users.id, ana.user.id))
    await s.app.ctx.db.update(users).set({ displayName: 'Bia' }).where(eq(users.id, bia.user.id))
    const space = await spaceWith(o, ana, bia, t)
    await asTeen(t)
    const contribute = (u: User, productId: string, showOnWall = false) =>
      call<CheckoutResponse>('POST', `/spaces/${space.id}/upgrade/contributions`, u, { productId, showOnWall })
    expect((await contribute(x, 'casa_7d')).status).toBe(403) // not a member
    expect((await contribute(t, 'casa_7d')).status).toBe(403) // 16–17
    expect((await contribute(o, 'plus_monthly')).status).toBe(404)
    const gw = await connect(s.port, o.token)
    const c1 = (await contribute(bia, 'casa_7d', true)).body
    expect(c1).toMatchObject({ kind: 'order', amountCents: 500 })
    expect((await call<SpaceUpgrade>('GET', `/spaces/${space.id}/upgrade`, o)).body.upgrade).toBeNull()
    const ev = `CASA_${evSeq}`
    await pay(c1.reference, 500, ev)
    const lit = await gw.waitFor('SPACE_UPGRADE_UPDATE', (d) => d.spaceId === space.id && !!d.upgrade?.active)
    const days = (iso: string) => (new Date(iso).getTime() - Date.now()) / DAY
    expect(days(lit.upgrade!.endsAt)).toBeCloseTo(7, 1)
    await pay(c1.reference, 500, ev) // the same event again: no extra days
    const c2 = (await contribute(o, 'casa_15d')).body
    await pay(c2.reference, 1000)
    const c3 = (await contribute(ana, 'casa_7d', true)).body
    await pay(c3.reference, 500)
    let view = (await call<SpaceUpgrade>('GET', `/spaces/${space.id}/upgrade`, bia)).body
    expect(days(view.upgrade!.endsAt)).toBeCloseTo(29, 1)
    expect(view.contributors.map((p) => p.displayName)).toEqual(['Ana', 'Bia']) // alphabetical, only who chose to appear
    expect(JSON.stringify(view.contributors)).not.toMatch(/amount|cents|500/)
    expect(view.perks).toEqual(expect.arrayContaining(['animated_banner', 'animated_icon', 'tone', 'vanity_invite', 'badge']))
    const ready = await connect(s.port, ana.token)
    expect(ready.events.find((e) => e.t === 'READY')!.d).toMatchObject({ spaces: [expect.objectContaining({ id: space.id, upgrade: expect.objectContaining({ active: true }) })] })
    ready.close()

    expect((await call<Order>('POST', `/billing/orders/${c1.reference}/refund`, bia)).body.status).toBe('refunded')
    view = (await call<SpaceUpgrade>('GET', `/spaces/${space.id}/upgrade`, bia)).body
    expect(days(view.upgrade!.endsAt)).toBeCloseTo(22, 1)
    expect(view.contributors.map((p) => p.displayName)).toEqual(['Ana'])
    expect((await s.app.ctx.db.select().from(subscriptions).where(eq(subscriptions.userId, o.user.id)))).toEqual([]) // nothing renews

    expect((await call('PATCH', `/spaces/${space.id}/upgrade`, ana, { tone: 'ember' })).status).toBe(403) // MANAGE_SPACE
    expect((await call('PATCH', `/spaces/${space.id}/upgrade`, o, { tone: 'neon' })).status).toBe(400)
    const set = await call<SpaceUpgrade>('PATCH', `/spaces/${space.id}/upgrade`, o, { tone: 'ember', inviteCode: `Galera${evSeq}` })
    expect(set.body.upgrade).toMatchObject({ tone: 'ember', inviteCode: `galera${evSeq}` })
    await gw.waitFor('SPACE_UPGRADE_UPDATE', (d) => d.spaceId === space.id && d.upgrade?.tone === 'ember')
    expect((await call('GET', `/invites/galera${evSeq}`, null)).status).toBe(200)
    expect((await call('POST', `/invites/galera${evSeq}`, x)).status).toBe(200)

    const end = new Date(view.upgrade!.endsAt)
    await s.app.ctx.billing.sweep(new Date(end.getTime() + 1000))
    await gw.waitFor('SPACE_UPGRADE_UPDATE', (d) => d.spaceId === space.id && d.upgrade?.active === false)
    gw.close()
    // Really over (contributions 30 days old, a provider-side refund recomputes from what is left): the vanity link
    // expires with the Casa, and its perks need it lit.
    await s.app.ctx.db.update(orders).set({ paidAt: new Date(Date.now() - 30 * DAY) }).where(eq(orders.id, c2.reference))
    await s.app.ctx.db.update(orders).set({ paidAt: new Date(Date.now() - 30 * DAY) }).where(eq(orders.id, c3.reference))
    await hook(update('order', c3.reference, 'refunded'))
    const after = (await call<SpaceUpgrade>('GET', `/spaces/${space.id}/upgrade`, o)).body.upgrade!
    expect(after.active).toBe(false)
    expect(days(after.endsAt)).toBeCloseTo(-15, 1)
    expect((await call('GET', `/invites/galera${evSeq}`, null)).status).toBe(404)
    expect((await call('PATCH', `/spaces/${space.id}/upgrade`, o, { tone: 'lilac' })).status).toBe(409)
  })

  it('Cinema is off unless CASA_CINEMA (refused in production)', async () => {
    const on = await startServer({ CASA_CINEMA: '1' })
    try {
      expect((await api<BillingCatalog>(on.app, 'GET', '/billing/catalog')).body.spaceUpgrade!.perks).toContain('cinema')
    } finally {
      await on.close()
    }
    const PROD = {
      NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db:5432/alga', CORS_ORIGINS: 'null', LIVEKIT_API_KEY: 'k',
      LIVEKIT_API_SECRET: 'a-real-production-secret-0123456789abcdef', PUBLIC_URL: 'https://api.example.com', FILES_SECRET: 's'.repeat(32),
      STORAGE_DRIVER: 'local', EMAIL_DRIVER: 'console', ALGA_ALLOW_CONSOLE_EMAIL: '1', E2EE_DS_KEY: 'A'.repeat(43) + '=',
    }
    expect(loadConfig(PROD).billing.casaCinema).toBe(false)
    expect(() => loadConfig({ ...PROD, CASA_CINEMA: '1' })).toThrow(/CASA_CINEMA/)
  })
})

describe('refunds (7 days)', () => {
  it('orders: within 7 days, the payer only, idempotent; the provider confirms; the first Plus charge too', async () => {
    const u = await register(s.app)
    const other = await register(s.app)
    const co = await buy(u, 'deco_ha_traco_grafite')
    const me = await billingMe(u)
    expect(me.orders[0]!.refundableUntil).toBeTruthy()
    expect((await call('POST', `/billing/orders/${co.reference}/refund`, other)).status).toBe(404)
    const r = await call<Order>('POST', `/billing/orders/${co.reference}/refund`, u)
    expect(r.body).toMatchObject({ status: 'refunded', refundRequestedAt: expect.any(String), refundableUntil: null })
    expect(await skus(u)).not.toContain('deco_ha_traco_grafite')
    expect((await call('POST', `/billing/orders/${co.reference}/refund`, u)).status).toBe(200) // idempotent
    const late = await buy(u, 'deco_ha_orbita')
    await s.app.ctx.db.update(orders).set({ paidAt: new Date(Date.now() - 8 * DAY) }).where(eq(orders.id, late.reference))
    expect((await call('POST', `/billing/orders/${late.reference}/refund`, u)).status).toBe(409)

    const p = await register(s.app)
    expect((await call('POST', '/billing/subscription/refund', p)).status).toBe(404)
    await openPage((await checkout(p, 'plus_monthly')).body.url) // sandbox page: carries the first charge's id
    expect((await billingMe(p)).subscription!.refundableUntil).toBeTruthy()
    const sub = await call<Subscription>('POST', '/billing/subscription/refund', p)
    expect(sub.body.status).toBe('canceled')
    expect(await planOf(p)).toBe('free')
    const w = await subscribed()
    expect((await call('POST', '/billing/subscription/refund', w)).status).toBe(409) // charge not confirmed by the provider yet
  })
})

describe('try-on in a call', () => {
  it('only in voice, not for 16–17; the room sees PublicUser.tryOn; one at a time; ends by itself; 10 a day', () => withWave2(async () => {
    const [u, v, t] = [await register(s.app), await register(s.app), await register(s.app)]
    const space = await spaceWith(u, v, t)
    const voice = space.channels.find((c) => c.type === 'voice')!
    const tryOn = (who: User, productId: string) => call<TryOn>('POST', '/billing/try-on', who, { productId })
    expect((await tryOn(u, 'aura_ha_respiro')).status).toBe(409) // not in a call
    let seq = 0
    for (const who of [u, v, t]) {
      await postWebhook(s.app, s.config, { event: 'participant_joined', id: `TRY_${evSeq}_${++seq}`, room: { name: `ch_${voice.id}` }, participant: { identity: who.user.id } })
    }
    await asTeen(t)
    expect((await tryOn(t, 'aura_ha_respiro')).status).toBe(403)
    expect((await tryOn(u, 'icon_ha_crepusculo')).status).toBe(404) // only you see app icons
    const gv = await connect(s.port, v.token)
    const tries = s.app.ctx.billing.tryOns
    tries.ttlMs = 150
    try {
      const first = await tryOn(u, 'aura_ha_respiro')
      expect(first.body).toMatchObject({ productId: 'aura_ha_respiro', slot: 'voiceAura' })
      await gv.waitFor('USER_UPDATE', (d) => d.id === u.user.id && d.tryOn?.productId === 'aura_ha_respiro')
      await tryOn(u, 'frame_ha_cinema') // replaces it
      await gv.waitFor('USER_UPDATE', (d) => d.id === u.user.id && d.tryOn?.productId === 'frame_ha_cinema')
      const at = gv.events.length
      await new Promise((r) => setTimeout(r, 300))
      expect(gv.events.slice(at).some((e) => e.t === 'USER_UPDATE' && e.d.id === u.user.id && !e.d.tryOn)).toBe(true)
      for (let i = 2; i < 10; i++) expect((await tryOn(u, 'deco_ha_orbita')).status).toBe(201)
      expect((await tryOn(u, 'deco_ha_orbita')).status).toBe(429)
    } finally {
      tries.ttlMs = 300_000
      tries.stop()
      gv.close()
    }
  }))
})

// ---- Mercado Pago (simulated API; the real one was not exercised: no credentials) --------------------------------

const MP_KEY = ['mp', 'v2', 'key'].join('-')
const MP_TOKEN = ['fake', 'v2', 'token'].join('-')
const mpHeaders = (dataId: string, ts = String(Date.now())) => ({
  'content-type': 'application/json', 'x-request-id': 'req-v2',
  'x-signature': `ts=${ts},v1=${createHmac('sha256', MP_KEY).update(`id:${dataId.toLowerCase()};request-id:req-v2;ts:${ts};`).digest('hex')}`,
})

describe('mercado pago: refunds, Pix-only gifts, first-charge refund', () => {
  it('refund asks POST /v1/payments/:id/refunds and changes nothing until the re-fetched payment says refunded', async () => {
    const store = new Map<string, Record<string, any>>()
    const calls: { method: string; path: string; body: any; headers: Headers }[] = []
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      if (url.host !== 'mp.test') return realFetch(input, init)
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, path: url.pathname, body, headers: new Headers(init?.headers) })
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
      if (method === 'POST' && url.pathname === '/checkout/preferences') return json({ id: 'pref', init_point: 'https://mp.test/checkout/pref' })
      if (method === 'POST' && url.pathname === '/preapproval') return json({ id: 'pa9', init_point: 'https://mp.test/sub/pa9' })
      if (method === 'POST' && url.pathname.endsWith('/refunds')) return json({ id: 1, status: 'in_process' }, 201)
      if (method === 'PUT') return json({})
      const hit = store.get(url.pathname)
      return hit ? json(hit) : json({}, 404)
    }))
    const m = await startServer({
      BILLING_PROVIDER: 'mercadopago', MP_ACCESS_TOKEN: MP_TOKEN, MP_WEBHOOK_SECRET: MP_KEY, MP_API_URL: 'http://mp.test',
      BILLING_RETURN_URL: 'https://algameet.com.br/billing/return',
    })
    try {
      const notify = (type: string, dataId: string) => m.app.inject({
        method: 'POST', url: `/api/v1/billing/webhooks/mercadopago?data.id=${dataId}&type=${type}`, headers: mpHeaders(dataId),
        payload: JSON.stringify({ id: Number(String(Math.random()).slice(2, 12)), type, data: { id: dataId } }),
      })
      const u = await register(m.app)
      const co = (await api<CheckoutResponse>(m.app, 'POST', '/billing/checkout', { token: u.token, body: { productId: 'deco_ha_orbita' } })).body
      const payment = (status: string, ms = 0) => ({
        id: 901, status, external_reference: `o_${co.reference}`, transaction_amount: 9.9, currency_id: 'BRL',
        date_last_updated: new Date(Date.now() + ms).toISOString(),
      })
      store.set('/v1/payments/901', payment('approved'))
      expect((await notify('payment', '901')).statusCode).toBe(200)
      const refund = await api<Order>(m.app, 'POST', `/billing/orders/${co.reference}/refund`, { token: u.token })
      expect(refund.body).toMatchObject({ status: 'paid', refundRequestedAt: expect.any(String) })
      const req = calls.find((c) => c.method === 'POST' && c.path === '/v1/payments/901/refunds')!
      expect(req.body).toEqual({})
      expect(req.headers.get('x-render-in-process-refunds')).toBe('true')
      expect(req.headers.get('x-idempotency-key')).toBe('refund_901')
      expect((await api<BillingMe>(m.app, 'GET', '/billing/me', { token: u.token })).body.items.map((i) => i.sku)).toContain('deco_ha_orbita')
      store.set('/v1/payments/901', payment('refunded', 1000))
      await notify('payment', '901')
      const me = (await api<BillingMe>(m.app, 'GET', '/billing/me', { token: u.token })).body
      expect(me.orders[0]!.status).toBe('refunded')
      expect(me.items).toEqual([])

      // Gifts past the card limit: the preference excludes card types (the MP balance cannot be excluded).
      const f = await register(m.app)
      await befriend(m.app, u, f)
      await m.app.ctx.db.update(relationships).set({ since: new Date(Date.now() - 4 * DAY) })
      const g = await api<CheckoutResponse>(m.app, 'POST', '/billing/gifts', { token: u.token, body: { productId: 'plus_yearly_once', recipientId: f.user.id } })
      expect(g.body.pixOnly).toBe(true)
      const pref = calls.filter((c) => c.path === '/checkout/preferences').at(-1)!.body
      expect(pref.payment_methods.excluded_payment_types.map((t: { id: string }) => t.id)).toEqual(['credit_card', 'debit_card', 'prepaid_card', 'ticket'])
      expect(pref.items[0].title).toMatch(/^Presente: /)

      // First Plus charge: its payment id comes with the authorized payment; refunding it also cancels renewals for good.
      const sub = (await api<CheckoutResponse>(m.app, 'POST', '/billing/checkout', { token: f.token, body: { productId: 'plus_monthly' } })).body
      const pa = { id: 'pa9', status: 'authorized', external_reference: `s_${sub.reference}`, next_payment_date: new Date(Date.now() + 30 * DAY).toISOString(), auto_recurring: { transaction_amount: 14.9 }, last_modified: new Date().toISOString() }
      store.set('/preapproval/pa9', pa)
      await notify('subscription_preapproval', 'pa9')
      expect((await api(m.app, 'POST', '/billing/subscription/refund', { token: f.token })).status).toBe(409) // no charge yet
      store.set('/authorized_payments/ap9', { id: 'ap9', preapproval_id: 'pa9', payment: { id: 777, status: 'approved' }, last_modified: new Date(Date.now() + 500).toISOString() })
      await notify('subscription_authorized_payment', 'ap9')
      const r = await api<Subscription>(m.app, 'POST', '/billing/subscription/refund', { token: f.token })
      expect(r.body).toMatchObject({ status: 'active', refundRequestedAt: expect.any(String), cancelAtPeriodEnd: true })
      expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/payments/777/refunds')).toBe(true)
      expect(calls.find((c) => c.method === 'PUT' && c.path === '/preapproval/pa9')!.body).toEqual({ status: 'cancelled' })
      store.set('/authorized_payments/ap9', { id: 'ap9', preapproval_id: 'pa9', payment: { id: 777, status: 'refunded' }, last_modified: new Date(Date.now() + 2000).toISOString() })
      await notify('subscription_authorized_payment', 'ap9')
      expect((await api<Me>(m.app, 'GET', '/users/@me', { token: f.token })).body.plan!.id).toBe('free')
    } finally {
      await m.close()
      vi.unstubAllGlobals()
    }
  })
})
