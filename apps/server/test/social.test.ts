import type { Channel, Relationship } from '@alga/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, connect, register, startServer, type TestServer } from './helpers.js'

let s: TestServer
beforeAll(async () => { s = await startServer() })
afterAll(async () => { await s.close() })

const rels = async (token: string) => (await api<Relationship[]>(s.app, 'GET', '/relationships', { token })).body
const typeOf = async (token: string, userId: string) => (await rels(token)).find((r) => r.user.id === userId)?.type

describe('friend requests', () => {
  it('request → incoming/outgoing → accept → friends, with gateway events and presence', async () => {
    const a = await register(s.app)
    const b = await register(s.app)
    const gwA = await connect(s.port, a.token)
    const gwB = await connect(s.port, b.token)

    const sent = await api<Relationship>(s.app, 'POST', '/relationships', { token: a.token, body: { username: b.user.username } })
    expect(sent.status).toBe(200)
    expect(sent.body).toMatchObject({ type: 'outgoing', user: { id: b.user.id } })
    expect(await typeOf(b.token, a.user.id)).toBe('incoming')
    await gwB.waitFor('RELATIONSHIP_UPSERT', (r) => r.user.id === a.user.id && r.type === 'incoming')

    // Sending again is idempotent.
    expect((await api(s.app, 'POST', '/relationships', { token: a.token, body: { username: b.user.username } })).body.type).toBe('outgoing')
    // The sender cannot accept their own request.
    expect((await api(s.app, 'PUT', `/relationships/${b.user.id}`, { token: a.token, body: { type: 'friend' } })).status).toBe(400)

    const accepted = await api<Relationship>(s.app, 'PUT', `/relationships/${a.user.id}`, { token: b.token, body: { type: 'friend' } })
    expect(accepted.body.type).toBe('friend')
    expect(await typeOf(a.token, b.user.id)).toBe('friend')
    await gwA.waitFor('RELATIONSHIP_UPSERT', (r) => r.user.id === b.user.id && r.type === 'friend')
    // Both online → each learns the other's presence.
    await gwA.waitFor('PRESENCE_UPDATE', (p) => p.userId === b.user.id && p.status === 'online')
    await gwB.waitFor('PRESENCE_UPDATE', (p) => p.userId === a.user.id && p.status === 'online')

    expect((await api(s.app, 'POST', '/relationships', { token: a.token, body: { username: b.user.username } })).status).toBe(409)

    // Remove friend: both sides lose the relationship.
    expect((await api(s.app, 'DELETE', `/relationships/${b.user.id}`, { token: a.token })).status).toBe(204)
    expect(await typeOf(a.token, b.user.id)).toBeUndefined()
    expect(await typeOf(b.token, a.user.id)).toBeUndefined()
    await gwB.waitFor('RELATIONSHIP_REMOVE', (d) => d.userId === a.user.id)
    gwA.close()
    gwB.close()
  })

  it('a request to someone who already requested you becomes a friendship', async () => {
    const a = await register(s.app)
    const b = await register(s.app)
    await api(s.app, 'POST', '/relationships', { token: a.token, body: { username: b.user.username } })
    const r = await api(s.app, 'POST', '/relationships', { token: b.token, body: { username: a.user.username } })
    expect(r.body.type).toBe('friend')
    expect(await typeOf(a.token, b.user.id)).toBe('friend')
  })

  it('decline and cancel remove both rows', async () => {
    const a = await register(s.app)
    const b = await register(s.app)
    await api(s.app, 'POST', '/relationships', { token: a.token, body: { username: b.user.username } })
    expect((await api(s.app, 'DELETE', `/relationships/${a.user.id}`, { token: b.token })).status).toBe(204) // decline
    expect(await typeOf(a.token, b.user.id)).toBeUndefined()
    await api(s.app, 'POST', '/relationships', { token: a.token, body: { username: b.user.username } })
    expect((await api(s.app, 'DELETE', `/relationships/${b.user.id}`, { token: a.token })).status).toBe(204) // cancel
    expect(await typeOf(b.token, a.user.id)).toBeUndefined()
  })

  it('validates the target', async () => {
    const a = await register(s.app)
    const ghost = await api(s.app, 'POST', '/relationships', { token: a.token, body: { username: 'no_such_user' } })
    expect(ghost.status).toBe(400)
    expect(ghost.body.error.fields.username).toBeDefined()
    expect((await api(s.app, 'POST', '/relationships', { token: a.token, body: { username: a.user.username } })).status).toBe(400)
  })
})

describe('blocking', () => {
  it('drops the friendship, prevents requests and DMs, and unblock keeps the other side clean', async () => {
    const a = await register(s.app)
    const b = await register(s.app)
    await api(s.app, 'POST', '/relationships', { token: a.token, body: { username: b.user.username } })
    await api(s.app, 'PUT', `/relationships/${a.user.id}`, { token: b.token, body: { type: 'friend' } })
    const gwB = await connect(s.port, b.token)

    const blocked = await api<Relationship>(s.app, 'PUT', `/relationships/${b.user.id}`, { token: a.token, body: { type: 'blocked' } })
    expect(blocked.body.type).toBe('blocked')
    expect(await typeOf(b.token, a.user.id)).toBeUndefined()
    await gwB.waitFor('RELATIONSHIP_REMOVE', (d) => d.userId === a.user.id)

    // The blocked user cannot friend-request or DM the blocker…
    const req = await api(s.app, 'POST', '/relationships', { token: b.token, body: { username: a.user.username } })
    expect(req.status).toBe(403)
    expect((await api(s.app, 'POST', '/users/@me/channels', { token: b.token, body: { recipientIds: [a.user.id] } })).status).toBe(403)
    // …and the blocker must unblock first.
    expect((await api(s.app, 'POST', '/relationships', { token: a.token, body: { username: b.user.username } })).status).toBe(400)

    expect((await api(s.app, 'DELETE', `/relationships/${b.user.id}`, { token: a.token })).status).toBe(204)
    expect(await typeOf(a.token, b.user.id)).toBeUndefined()
    expect((await api(s.app, 'POST', '/relationships', { token: b.token, body: { username: a.user.username } })).body.type).toBe('outgoing')
    gwB.close()
  })

  it('blocks messages in an existing DM', async () => {
    const a = await register(s.app)
    const b = await register(s.app)
    const dm = await api<Channel>(s.app, 'POST', '/users/@me/channels', { token: a.token, body: { recipientIds: [b.user.id] } })
    expect((await api(s.app, 'POST', `/channels/${dm.body.id}/messages`, { token: b.token, body: { content: 'oi' } })).status).toBe(200)
    await api(s.app, 'PUT', `/relationships/${b.user.id}`, { token: a.token, body: { type: 'blocked' } })
    expect((await api(s.app, 'POST', `/channels/${dm.body.id}/messages`, { token: b.token, body: { content: 'oi?' } })).status).toBe(403)
    expect((await api(s.app, 'POST', '/voice/join', { token: b.token, body: { channelId: dm.body.id } })).status).toBe(403)
  })
})

describe('direct messages', () => {
  it('opening a 1:1 DM is idempotent from either side and visible in READY', async () => {
    const a = await register(s.app)
    const b = await register(s.app)
    const gwB = await connect(s.port, b.token)
    const first = await api<Channel>(s.app, 'POST', '/users/@me/channels', { token: a.token, body: { recipientIds: [b.user.id] } })
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ type: 'dm', spaceId: null, lastMessageId: null })
    expect(first.body.recipientIds!.sort()).toEqual([a.user.id, b.user.id].sort())
    await gwB.waitFor('CHANNEL_CREATE', (c) => c.id === first.body.id)

    const again = await api<Channel>(s.app, 'POST', '/users/@me/channels', { token: a.token, body: { recipientIds: [b.user.id, a.user.id] } })
    const reverse = await api<Channel>(s.app, 'POST', '/users/@me/channels', { token: b.token, body: { recipientIds: [a.user.id] } })
    expect(again.status).toBe(200)
    expect(again.body.id).toBe(first.body.id)
    expect(reverse.body.id).toBe(first.body.id)

    const gwA = await connect(s.port, a.token)
    const ready = await gwA.waitFor('READY')
    expect(ready.privateChannels.map((c) => c.id)).toEqual([first.body.id])
    // b shares no space with a, so b's profile comes in READY.users.
    expect(ready.users.map((u) => u.id)).toEqual([b.user.id])
    gwA.close()
    gwB.close()
  })

  it('creates group DMs and rejects bad recipient lists', async () => {
    const [a, b, c] = [await register(s.app), await register(s.app), await register(s.app)]
    const g = await api<Channel>(s.app, 'POST', '/users/@me/channels', { token: a.token, body: { recipientIds: [b.user.id, c.user.id] } })
    expect(g.status).toBe(201)
    expect(g.body.type).toBe('group_dm')
    expect(g.body.recipientIds).toHaveLength(3)
    expect((await api(s.app, 'POST', '/users/@me/channels', { token: a.token, body: { recipientIds: [a.user.id] } })).status).toBe(400)
    expect((await api(s.app, 'POST', '/users/@me/channels', {
      token: a.token, body: { recipientIds: ['0190f000-0000-7000-8000-000000000000'] },
    })).status).toBe(404)
  })
})

describe('profile and presence', () => {
  it('PATCH /users/@me updates, enforces username uniqueness and fans out presence (invisible → offline)', async () => {
    const a = await register(s.app)
    const b = await register(s.app)
    await api(s.app, 'POST', '/relationships', { token: a.token, body: { username: b.user.username } })
    await api(s.app, 'PUT', `/relationships/${a.user.id}`, { token: b.token, body: { type: 'friend' } })
    const gwA = await connect(s.port, a.token)
    const gwB = await connect(s.port, b.token)

    const patched = await api(s.app, 'PATCH', '/users/@me', { token: a.token, body: { displayName: 'Novo Nome', bio: 'oi' } })
    expect(patched.body).toMatchObject({ displayName: 'Novo Nome', bio: 'oi' })
    await gwB.waitFor('USER_UPDATE', (u) => u.id === a.user.id && u.displayName === 'Novo Nome')
    await gwA.waitFor('ME_UPDATE', (m) => m.displayName === 'Novo Nome')

    const taken = await api(s.app, 'PATCH', '/users/@me', { token: a.token, body: { username: b.user.username } })
    expect(taken.status).toBe(409)
    expect(taken.body.error.fields.username).toBeDefined()

    await api(s.app, 'PATCH', '/users/@me', { token: a.token, body: { statusPreference: 'invisible' } })
    await gwB.waitFor('PRESENCE_UPDATE', (p) => p.userId === a.user.id && p.status === 'offline')

    gwA.send({ op: 'presence', status: 'dnd' })
    await gwB.waitFor('PRESENCE_UPDATE', (p) => p.userId === a.user.id && p.status === 'dnd')
    expect((await api(s.app, 'GET', '/users/@me', { token: a.token })).body.statusPreference).toBe('dnd')

    gwB.events.length = 0
    gwA.close()
    await gwB.waitFor('PRESENCE_UPDATE', (p) => p.userId === a.user.id && p.status === 'offline')
    gwB.close()
  })

  it('an invisible user is not announced on connect and READY hides them', async () => {
    const a = await register(s.app)
    const b = await register(s.app)
    await api(s.app, 'POST', '/relationships', { token: a.token, body: { username: b.user.username } })
    await api(s.app, 'PUT', `/relationships/${a.user.id}`, { token: b.token, body: { type: 'friend' } })
    await api(s.app, 'PATCH', '/users/@me', { token: a.token, body: { statusPreference: 'invisible' } })
    const gwB = await connect(s.port, b.token)
    const gwA = await connect(s.port, a.token)
    await gwB.expectNone('PRESENCE_UPDATE', (p) => p.userId === a.user.id)
    const gwB2 = await connect(s.port, b.token)
    expect((await gwB2.waitFor('READY')).presences.find((p) => p.userId === a.user.id)).toBeUndefined()
    const readyA = await gwA.waitFor('READY')
    expect(readyA.presences).toContainEqual({ userId: b.user.id, status: 'online' })
    for (const g of [gwA, gwB, gwB2]) g.close()
  })
})
