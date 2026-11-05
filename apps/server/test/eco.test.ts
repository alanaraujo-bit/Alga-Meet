import type { Me, PublicUser } from '@alga/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, befriend, connect, register, startServer, type TestServer } from './helpers.js'

let s: TestServer
beforeAll(async () => { s = await startServer() })
afterAll(async () => { await s.close() })

describe('Eco (mascot avatar) choice', () => {
  it('saves a valid pick, shows it to friends live, and goes back to automatic with null', async () => {
    const a = await register(s.app)
    const b = await register(s.app)
    await befriend(s.app, a, b)
    const gw = await connect(s.port, b.token)
    const pick = { accent: '#f07a9a', eyes: 'wing', hair: 'braid', accessory: 'choker' }
    const me = await api<Me>(s.app, 'PATCH', '/users/@me', { token: a.token, body: { eco: pick } })
    expect(me.status).toBe(200)
    expect(me.body.eco).toEqual(pick)
    await gw.waitFor('USER_UPDATE', (u) => u.id === a.user.id && u.eco?.hair === 'braid')
    expect((await api<PublicUser>(s.app, 'GET', `/users/${a.user.id}`, { token: b.token })).body.eco).toEqual(pick)

    const reset = await api<Me>(s.app, 'PATCH', '/users/@me', { token: a.token, body: { eco: null } })
    expect(reset.body.eco).toBeUndefined()
    gw.close()
  })

  it('refuses parts that do not exist (the client draws a closed set)', async () => {
    const a = await register(s.app)
    for (const eco of [
      { accent: '#123456', eyes: 'bar', hair: 'none', accessory: 'none' },
      { accent: '#8b8ef7', eyes: 'laser', hair: 'none', accessory: 'none' },
      { accent: '#8b8ef7', eyes: 'bar', hair: 'none' },
    ]) {
      expect((await api(s.app, 'PATCH', '/users/@me', { token: a.token, body: { eco } })).status).toBe(400)
    }
  })
})
