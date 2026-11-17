import { generateKeyPairSync } from 'node:crypto'
import type { AdminEvent, AdminGrowth, AdminHealth, AdminMe, AdminOverview, AdminUserDetail, AdminUserSummary, CheckoutResponse } from '@alga/shared'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { bootstrapAdmin, normalizeCode } from '../src/admin/bootstrap.js'
import { renewalCharges, periodWindow } from '../src/admin/insights.js'
import { SANDBOX_SIGNATURE_HEADER, sandboxSignature } from '../src/billing/provider.js'
import { adminDevices, adminEvents, subscriptions } from '../src/db/schema.js'
import { setStaffRole } from '../src/trust-safety.js'
import { api, register, startServer, type TestServer } from './helpers.js'

const DAY = 24 * 3600 * 1000
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account', project_id: 'alga-admin-test', client_email: 'push@alga-admin-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
})

let s: TestServer
const realFetch = globalThis.fetch
/** Every FCM send the server made: device token + the message. */
let pushes: { token: string; title: string; body: string; data: Record<string, string>; channel: string }[] = []
let fcmStatus = 200

beforeAll(async () => {
  s = await startServer({ FCM_SERVICE_ACCOUNT: SERVICE_ACCOUNT })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url === 'https://oauth2.googleapis.com/token') {
      const assertion = new URLSearchParams(String(init!.body)).get('assertion')!
      expect(assertion.split('.')).toHaveLength(3)
      return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 })
    }
    if (url.startsWith('https://fcm.googleapis.com/v1/projects/alga-admin-test/messages:send')) {
      expect((init!.headers as Record<string, string>).authorization).toBe('Bearer ya29.test')
      const m = JSON.parse(String(init!.body)).message
      pushes.push({ token: m.token, title: m.notification.title, body: m.notification.body, data: m.data, channel: m.android.notification.channel_id })
      return new Response(fcmStatus === 200 ? '{}' : '{"error":{"status":"NOT_FOUND"}}', { status: fcmStatus })
    }
    return realFetch(input, init)
  })
})
afterAll(async () => { vi.restoreAllMocks(); await s.close() })
afterEach(() => { pushes = []; fcmStatus = 200 })

let evSeq = 0
async function sandboxHook(event: unknown) {
  const raw = JSON.stringify(event)
  const res = await s.app.inject({
    method: 'POST', url: '/api/v1/billing/webhooks/sandbox',
    headers: { 'content-type': 'application/json', [SANDBOX_SIGNATURE_HEADER]: sandboxSignature(s.config.billing.sandboxSecret, raw) },
    payload: raw,
  })
  expect(res.statusCode).toBe(200)
}
const update = (kind: 'subscription' | 'order', reference: string, status: string, extra: Record<string, unknown> = {}) =>
  ({ id: `ADM_${++evSeq}`, type: `test.${kind}`, updates: [{ kind, reference, status, occurredAt: new Date().toISOString(), ...extra }] })
const checkout = async (token: string, productId: string) => (await api<CheckoutResponse>(s.app, 'POST', '/billing/checkout', { token, body: { productId } })).body

async function staff(role: 'admin' | 'moderator') {
  const u = await register(s.app)
  await setStaffRole(s.app.ctx.db, u.user.username, role)
  return u
}
const settle = () => s.app.ctx.alerts.settled()
const events = async () => (await s.app.ctx.db.select().from(adminEvents)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

describe('revenue math', () => {
  it('renewing charges: start, then each interval before the current period end, never in the future', () => {
    const start = new Date('2026-01-10T12:00:00Z')
    const now = new Date('2026-04-20T00:00:00Z').getTime()
    // Three renewals happened (Feb, Mar, Apr 10); the period now ends May 10.
    const charges = renewalCharges({ kind: 'renewing', startedAt: start, currentPeriodEnd: new Date('2026-05-10T12:00:00Z'), amountCents: 1490 }, 1, now)
    expect(charges.map((t) => new Date(t).toISOString().slice(0, 10))).toEqual(['2026-01-10', '2026-02-10', '2026-03-10', '2026-04-10'])
    // Only the first charge: the period still ends one interval after the start.
    expect(renewalCharges({ kind: 'renewing', startedAt: start, currentPeriodEnd: new Date('2026-02-10T12:00:00Z'), amountCents: 1490 }, 1, now)).toHaveLength(1)
    expect(renewalCharges({ kind: 'renewing', startedAt: start, currentPeriodEnd: new Date('2027-01-10T12:00:00Z'), amountCents: 14900 }, 12, now)).toHaveLength(1)
    expect(renewalCharges({ kind: 'pass', startedAt: start, currentPeriodEnd: null, amountCents: 0 }, 1, now)).toEqual([])
  })

  it('period windows: BRT buckets of the right length', () => {
    const now = new Date('2026-11-16T15:30:00Z').getTime() // 12:30 BRT
    expect(periodWindow('today', now)).toMatchObject({ bucket: 'hour', from: new Date('2026-11-16T03:00:00Z').getTime() })
    expect(periodWindow('today', now).keys).toHaveLength(13)
    expect(periodWindow('7d', now).keys).toEqual(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'])
    expect(periodWindow('12m', now).keys[0]).toBe('2025-12')
    expect(periodWindow('12m', now).keys.at(-1)).toBe('2026-11')
  })
})

describe('access', () => {
  it('only staff gets in; money is admin-only; the moderator feed has no money events', async () => {
    const user = await register(s.app)
    expect((await api(s.app, 'GET', '/admin/me', { token: user.token })).status).toBe(403)
    const mod = await staff('moderator')
    const me = await api<AdminMe>(s.app, 'GET', '/admin/me', { token: mod.token })
    expect(me.body).toMatchObject({ role: 'moderator', env: 'test', push: { fcm: true } })
    expect((await api(s.app, 'GET', '/admin/overview', { token: mod.token })).status).toBe(403)
    expect((await api(s.app, 'GET', '/admin/growth', { token: mod.token })).status).toBe(403)
    expect((await api(s.app, 'GET', '/admin/health', { token: mod.token })).status).toBe(200)
    s.app.ctx.alerts.fire({ kind: 'purchase', title: 'Nova compra · R$ 1,00', body: 'x', amountCents: 100, currency: 'BRL' })
    s.app.ctx.alerts.fire({ kind: 'sfu_up', title: 'ok', body: 'ok' })
    await settle()
    const feed = await api<AdminEvent[]>(s.app, 'GET', '/admin/events', { token: mod.token })
    expect(feed.body.some((e) => e.kind === 'purchase')).toBe(false)
    expect(feed.body.some((e) => e.kind === 'sfu_up')).toBe(true)
    const owner = await staff('admin')
    expect((await api<AdminEvent[]>(s.app, 'GET', '/admin/events', { token: owner.token })).body.some((e) => e.kind === 'purchase')).toBe(true)
  })
})

describe('money and push', () => {
  it('a subscription, a renewal, a purchase and its refund: feed, FCM pushes and the overview numbers', async () => {
    const owner = await staff('admin')
    const mod = await staff('moderator')
    expect((await api(s.app, 'POST', '/admin/devices', { token: owner.token, body: { token: 'fcm-owner-token-0123456789', platform: 'android' } })).status).toBe(201)
    expect((await api(s.app, 'POST', '/admin/devices', { token: mod.token, body: { token: 'fcm-mod-token-0123456789', platform: 'android' } })).status).toBe(201)
    const before = await api<AdminOverview>(s.app, 'GET', '/admin/overview?period=30d', { token: owner.token })
    expect(before.status).toBe(200)

    const buyer = await register(s.app)
    const sub = await checkout(buyer.token, 'plus_monthly')
    await sandboxHook(update('subscription', sub.reference, 'active', { currentPeriodEnd: new Date(Date.now() + 30 * DAY).toISOString(), amountCents: 1490 }))
    const order = await checkout(buyer.token, 'deco_ha_orbita')
    await sandboxHook(update('order', order.reference, 'paid', { amountCents: 990, providerPaymentId: `pay_${order.reference}` }))
    await settle()

    const money = pushes.filter((p) => p.token === 'fcm-owner-token-0123456789' && p.channel === 'money')
    expect(money.map((p) => p.title)).toEqual(['Nova assinatura · R$ 14,90', 'Nova compra · R$ 9,90'])
    expect(money[0]).toMatchObject({ channel: 'money', data: { kind: 'subscription_started' } })
    // Pushes go through Google: never the account's name or address.
    for (const p of pushes) expect(`${p.title} ${p.body}`).not.toContain(buyer.user.username)
    expect(pushes.some((p) => p.token === 'fcm-mod-token-0123456789' && p.data.kind === 'purchase')).toBe(false)

    // Renewal a month later: the start moves back so the deduced charge falls before now.
    await s.app.ctx.db.update(subscriptions).set({ startedAt: new Date(Date.now() - 31 * DAY), currentPeriodEnd: new Date(Date.now() - DAY) }).where(eq(subscriptions.id, sub.reference))
    await sandboxHook(update('subscription', sub.reference, 'active', { currentPeriodEnd: new Date(Date.now() + 29 * DAY).toISOString(), amountCents: 1490 }))
    await sandboxHook(update('order', order.reference, 'refunded'))
    await settle()
    expect(pushes.filter((p) => p.token === 'fcm-owner-token-0123456789' && p.data.kind !== 'signup').map((p) => p.data.kind)).toEqual(['subscription_started', 'purchase', 'subscription_renewed', 'refund'])

    const feed = (await api<AdminEvent[]>(s.app, 'GET', '/admin/events', { token: owner.token })).body
    expect(feed.find((e) => e.kind === 'purchase')!.user).toMatchObject({ id: buyer.user.id, username: buyer.user.username })

    const o = (await api<AdminOverview>(s.app, 'GET', '/admin/overview?period=90d', { token: owner.token })).body
    const b = before.body
    expect(o.received.gross.brl - b.received.gross.brl).toBe(1490 * 2 + 990)
    expect(o.received.refunds.brl - b.received.refunds.brl).toBe(990)
    expect(o.received.net.brl - b.received.net.brl).toBe(1490 * 2)
    expect(o.mrr.now.brl - b.mrr.now.brl).toBe(1490)
    expect(o.subscribers.plus - b.subscribers.plus).toBe(1)
    expect(o.series.reduce((n, p) => n + p.value, 0)).toBe(o.received.net.brl)
    // The renewal is deduced at start + 1 month, which this test placed at "now" too: compare as a set.
    expect(o.latest.slice(0, 4).map((p) => p.kind).sort()).toEqual(['order', 'refund', 'subscription_first', 'subscription_renewal'])
    expect(o.latest.slice(0, 4).map((p) => Date.parse(p.at))).toEqual([...o.latest.slice(0, 4).map((p) => Date.parse(p.at))].sort((a, b) => b - a))
    expect(o.latest.find((p) => p.kind === 'order')).toMatchObject({ amountCents: 990, productId: 'deco_ha_orbita', user: { id: buyer.user.id } })
  })

  it('dead FCM tokens are dropped; logging out removes the device; the test push reaches only your phones', async () => {
    const owner = await staff('admin')
    await api(s.app, 'POST', '/admin/devices', { token: owner.token, body: { token: 'fcm-dead-token-0123456789', platform: 'android' } })
    fcmStatus = 404
    s.app.ctx.alerts.fire({ kind: 'sfu_down', title: 't', body: 'b' })
    await settle()
    expect(await s.app.ctx.db.select().from(adminDevices).where(eq(adminDevices.token, 'fcm-dead-token-0123456789'))).toEqual([])

    fcmStatus = 200
    pushes = []
    await api(s.app, 'POST', '/admin/devices', { token: owner.token, body: { token: 'fcm-live-token-0123456789', platform: 'android' } })
    expect((await api(s.app, 'POST', '/admin/devices/test', { token: owner.token })).body).toEqual({ sent: 1 })
    expect(pushes.map((p) => p.token)).toEqual(['fcm-live-token-0123456789'])
    await api(s.app, 'POST', '/auth/logout', { token: owner.token })
    expect(await s.app.ctx.db.select().from(adminDevices).where(eq(adminDevices.token, 'fcm-live-token-0123456789'))).toEqual([])
  })

  it('a device can mute kinds; a moderator cannot ask for money kinds', async () => {
    const mod = await staff('moderator')
    const res = await api(s.app, 'POST', '/admin/devices', { token: mod.token, body: { token: 'fcm-kinds-token-0123456789', platform: 'android', kinds: ['purchase', 'report'] } })
    expect(res.body.kinds).toEqual(['report'])
    s.app.ctx.alerts.fire({ kind: 'sfu_down', title: 't', body: 'b' })
    await settle()
    expect(pushes.some((p) => p.token === 'fcm-kinds-token-0123456789')).toBe(false)
  })
})

describe('watchers', () => {
  it('signups and high-priority reports become events; the SFU is down after 2 failed probes and up again once it answers', async () => {
    const n0 = (await events()).length
    const someone = await register(s.app)
    const reporter = await register(s.app)
    expect((await api(s.app, 'POST', '/reports', { token: reporter.token, body: { targetType: 'user', targetId: someone.user.id, reason: 'violence' } })).status).toBe(201)
    await new Promise((r) => setTimeout(r, 50))
    await settle()
    const fresh = (await events()).slice(n0)
    expect(fresh.filter((e) => e.kind === 'signup').map((e) => e.userId)).toEqual([someone.user.id, reporter.user.id])
    expect(fresh.find((e) => e.kind === 'report')).toMatchObject({ userId: someone.user.id, title: 'Denúncia de alta prioridade' })

    const alerts = s.app.ctx.alerts
    await alerts.probeSfu()
    expect(alerts.sfu.ok).not.toBe(false)
    await alerts.probeSfu()
    await alerts.probeSfu()
    await settle()
    expect(alerts.sfu.ok).toBe(false)
    expect((await events()).filter((e) => e.kind === 'sfu_down' && e.title.startsWith('Servidor'))).toHaveLength(1)
    const lk = (s.config as { livekit: { url: string } }).livekit
    const old = lk.url
    lk.url = `http://127.0.0.1:${s.port}/api/v1/health`
    await alerts.probeSfu()
    lk.url = old
    await settle()
    expect(alerts.sfu.ok).toBe(true)
    expect((await events()).some((e) => e.kind === 'sfu_up' && e.title === 'Servidor de voz de volta')).toBe(true)
  })

  it('a burst of 5xx makes one api_errors event', async () => {
    const alerts = s.app.ctx.alerts
    const t = Date.now()
    for (let i = 0; i < 25; i++) alerts.recordStatus(500, t + i)
    await settle()
    expect((await events()).filter((e) => e.kind === 'api_errors')).toHaveLength(1)
    expect(alerts.errorCounts(t + 30).errors5m).toBeGreaterThanOrEqual(25)
  })
})

describe('break-glass bootstrap', () => {
  it('makes the account admin and its one-time code sets a new password once', async () => {
    const u = await register(s.app)
    const logged: string[] = []
    const log = { warn: (o: unknown, m?: string) => logged.push(JSON.stringify(o) + (m ?? '')) } as unknown as Parameters<typeof bootstrapAdmin>[2]
    expect(await bootstrapAdmin(s.app.ctx.db, 'nobody@example.com', log)).toBeNull()
    const code = (await bootstrapAdmin(s.app.ctx.db, `${u.user.username}@EXAMPLE.com`, log))!
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(logged.at(-1)).toContain(code)
    // The app strips the dashes and upper-cases what the person typed.
    const password = 'uma senha nova bem longa 42'
    expect((await api(s.app, 'POST', '/auth/password-reset/confirm', { body: { token: normalizeCode(code.toLowerCase()), password } })).status).toBe(204)
    expect((await api(s.app, 'POST', '/auth/password-reset/confirm', { body: { token: normalizeCode(code), password: `${password}!` } })).status).toBe(400)
    // The old sessions are gone; the new password logs in and the account is staff.
    expect((await api(s.app, 'GET', '/admin/me', { token: u.token })).status).toBe(401)
    const login = await api(s.app, 'POST', '/auth/login', { body: { login: u.user.username, password }, ip: '10.9.9.9' })
    expect(login.status).toBe(200)
    expect((await api<AdminMe>(s.app, 'GET', '/admin/me', { token: login.body.token })).body.role).toBe('admin')
  })
})

describe('accounts and dashboards', () => {
  it('search by username, e-mail or id; the detail shows billing to admins only', async () => {
    const owner = await staff('admin')
    const mod = await staff('moderator')
    const u = await register(s.app, `findme_${Date.now().toString(36)}`)
    const hit = await api<AdminUserSummary[]>(s.app, 'GET', `/admin/users/search?q=${encodeURIComponent('@' + u.user.username.slice(0, 10))}`, { token: mod.token })
    expect(hit.body.map((x) => x.id)).toContain(u.user.id)
    expect((await api<AdminUserSummary[]>(s.app, 'GET', `/admin/users/search?q=${u.user.id}`, { token: mod.token })).body[0]!.id).toBe(u.user.id)
    expect((await api<AdminUserSummary[]>(s.app, 'GET', '/admin/users/search?q=%25', { token: mod.token })).status).toBe(200)
    const asMod = await api<AdminUserDetail>(s.app, 'GET', `/admin/users/${u.user.id}`, { token: mod.token })
    expect(asMod.body).toMatchObject({ id: u.user.id, state: 'ok', billing: null })
    expect(asMod.body.sessions).toHaveLength(1)
    const asAdmin = await api<AdminUserDetail>(s.app, 'GET', `/admin/users/${u.user.id}`, { token: owner.token })
    expect(asAdmin.body.billing).toMatchObject({ lifetime: { brl: 0, usd: 0 }, orders: [], subscriptions: [] })
    expect((await api(s.app, 'GET', `/admin/users/${crypto.randomUUID()}`, { token: owner.token })).status).toBe(404)
  })

  it('growth and health answer with their shapes', async () => {
    const owner = await staff('admin')
    const g = await api<AdminGrowth>(s.app, 'GET', '/admin/growth?days=30', { token: owner.token })
    expect(g.status).toBe(200)
    expect(g.body.users.total).toBeGreaterThan(5)
    expect(g.body.signups.series).toHaveLength(30)
    expect(g.body.signups.series.reduce((n, p) => n + p.value, 0)).toBe(g.body.signups.inPeriod)
    expect(g.body.cohorts.length).toBeGreaterThanOrEqual(8)
    expect(g.body.notTracked.length).toBeGreaterThan(3)
    const h = await api<AdminHealth>(s.app, 'GET', '/admin/health', { token: owner.token })
    expect(h.body).toMatchObject({ env: 'test', moderation: { openReports: expect.any(Number) }, live: { online: expect.any(Number) } })
  })

  it('the stream delivers events live and closes nothing it should not', async () => {
    const owner = await staff('admin')
    const ctrl = new AbortController()
    const res = await realFetch(`http://127.0.0.1:${s.port}/api/v1/admin/stream`, { headers: { authorization: `Bearer ${owner.token}` }, signal: ctrl.signal })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let text = dec.decode((await reader.read()).value)
    s.app.ctx.alerts.fire({ kind: 'signup', title: 'Novo cadastro', body: 'Conta nº 1.' })
    while (!text.includes('event: alert')) text += dec.decode((await reader.read()).value)
    const data = JSON.parse(/data: (.*)\n/.exec(text)![1]!)
    expect(data).toMatchObject({ kind: 'signup', title: 'Novo cadastro' })
    ctrl.abort()
    await settle()
  })
})
