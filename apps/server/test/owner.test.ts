import { COSMETIC_SLOTS, type BillingMe } from '@alga/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PRODUCTS } from '../src/billing/catalog.js'
import { api, register, startServer, type TestServer } from './helpers.js'

describe('founder account (ALGA_OWNER_EMAILS)', () => {
  let s: TestServer
  beforeAll(async () => {
    s = await startServer({ ALGA_OWNER_EMAILS: ' Dono_owner@Example.com , unverified_owner@example.com' })
  })
  afterAll(() => s.close())

  it('holds Plus and every cosmetic for good; other accounts and an unverified owner e-mail do not', async () => {
    const owner = await register(s.app, 'dono_owner')
    const unverified = await register(s.app, 'unverified_owner', { verified: false })
    const other = await register(s.app)
    await s.app.ctx.billing.sweep()

    const cosmetics = PRODUCTS.filter((p) => p.kind === 'cosmetic')
    const mine = (await api<BillingMe>(s.app, 'GET', '/billing/me', { token: owner.token })).body
    expect(mine.plan.id).toBe('plus')
    expect(mine.items.filter((i) => i.kind === 'cosmetic' && i.source === 'grant' && i.expiresAt === null)).toHaveLength(cosmetics.length)
    expect(mine.items.find((i) => i.sku === 'plan:plus')).toMatchObject({ source: 'grant', expiresAt: null })

    const item = cosmetics.find((p) => p.cosmeticType)!
    const body = { [COSMETIC_SLOTS[item.cosmeticType!]]: item.id }
    expect((await api(s.app, 'PUT', '/users/@me/cosmetics', { token: owner.token, body })).status).toBe(200)
    for (const u of [unverified, other]) {
      expect((await api<BillingMe>(s.app, 'GET', '/billing/me', { token: u.token })).body.plan.id).toBe('free')
      expect((await api(s.app, 'PUT', '/users/@me/cosmetics', { token: u.token, body })).status).toBe(403)
    }

    // A second pass changes nothing (no churn every minute).
    await s.app.ctx.billing.sweep()
    expect((await api<BillingMe>(s.app, 'GET', '/billing/me', { token: owner.token })).body.items).toHaveLength(mine.items.length)
  })
})
