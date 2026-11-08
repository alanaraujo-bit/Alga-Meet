import { COSMETIC_SLOTS, type BillingMe } from '@alga/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PRODUCTS } from '../src/billing/catalog.js'
import { entitlements, users } from '../src/db/schema.js'
import { api, register, startServer, type TestServer } from './helpers.js'

// The founder grant (ALGA_OWNER_EMAILS) was removed: nobody gets Plus or cosmetics without paying.
describe('no free grants', () => {
  let s: TestServer
  beforeAll(async () => {
    // A leftover variable on the host must be ignored, not crash the boot.
    s = await startServer({ ALGA_OWNER_EMAILS: 'dono_owner@example.com' })
  })
  afterAll(() => s.close())

  it('revokes grant rows left by the old founder rule on the first sweep after a start', async () => {
    const owner = await register(s.app, 'dono_owner')
    const cosmetic = PRODUCTS.find((p) => p.kind === 'cosmetic' && p.cosmeticType)!
    const { db } = s.app.ctx
    await db.insert(entitlements).values([
      { userId: owner.user.id, sku: 'plan:plus', kind: 'plan', source: 'grant', sourceId: owner.user.id, expiresAt: null },
      { userId: owner.user.id, sku: cosmetic.id, kind: 'cosmetic', source: 'grant', sourceId: owner.user.id, expiresAt: null },
    ])
    await db.update(users).set({ plan: 'plus' }).where(eq(users.id, owner.user.id))

    await s.app.ctx.billing.sweep()

    const me = (await api<BillingMe>(s.app, 'GET', '/billing/me', { token: owner.token })).body
    expect(me.plan.id).toBe('free')
    expect(me.items).toHaveLength(0)
    const body = { [COSMETIC_SLOTS[cosmetic.cosmeticType!]]: cosmetic.id }
    expect((await api(s.app, 'PUT', '/users/@me/cosmetics', { token: owner.token, body })).status).toBe(403)
  })
})
