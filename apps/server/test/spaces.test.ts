import { DEFAULT_EVERYONE_PERMISSIONS, Permission, type Invite, type SpaceSnapshot } from '@alga/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { invites } from '../src/db/schema.js'
import { inviteCode } from '../src/routes/spaces.js'
import { api, connect, register, startServer, type TestServer } from './helpers.js'

let s: TestServer
beforeAll(async () => { s = await startServer() })
afterAll(async () => { await s.close() })

async function spaceWithMember() {
  const owner = await register(s.app)
  const member = await register(s.app)
  const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: owner.token, body: { name: 'Clã' } })).body
  const inv = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: owner.token, body: {} })).body
  await api(s.app, 'POST', `/invites/${inv.code}`, { token: member.token })
  return { owner, member, space }
}

describe('spaces', () => {
  it('creating a space makes @everyone (id == space id) and the default channels, and dispatches SPACE_CREATE', async () => {
    const owner = await register(s.app)
    const gw = await connect(s.port, owner.token)
    const res = await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: owner.token, body: { name: '  Meu Espaço ' } })
    expect(res.status).toBe(201)
    const space = res.body
    expect(space).toMatchObject({ name: 'Meu Espaço', ownerId: owner.user.id, iconUrl: null })
    expect(space.roles).toEqual([{ id: space.id, spaceId: space.id, name: '@everyone', color: null, permissions: DEFAULT_EVERYONE_PERMISSIONS, position: 0 }])
    expect(space.channels.map((c) => [c.type, c.name, c.position])).toEqual([['text', 'geral', 0], ['voice', 'Geral', 1]])
    expect(space.channels[1]).toMatchObject({ bitrateKbps: 64, userLimit: 0 })
    expect(space.channels[0]!.bitrateKbps).toBeUndefined()
    expect(space.members.map((m) => m.user.id)).toEqual([owner.user.id])
    await gw.waitFor('SPACE_CREATE', (d) => d.id === space.id)
    gw.close()
  })

  it('denies non-members and members without MANAGE_CHANNELS / MANAGE_SPACE / KICK_MEMBERS', async () => {
    const { owner, member, space } = await spaceWithMember()
    const outsider = await register(s.app)
    const text = space.channels.find((c) => c.type === 'text')!

    const asOutsider = await api(s.app, 'POST', `/spaces/${space.id}/channels`, { token: outsider.token, body: { type: 'text', name: 'x' } })
    expect(asOutsider.status).toBe(403)
    expect(asOutsider.body.error.code).toBe('forbidden')
    expect((await api(s.app, 'GET', `/channels/${text.id}/messages`, { token: outsider.token })).status).toBe(403)
    expect((await api(s.app, 'POST', `/channels/${text.id}/messages`, { token: outsider.token, body: { content: 'oi' } })).status).toBe(403)

    expect((await api(s.app, 'POST', `/spaces/${space.id}/channels`, { token: member.token, body: { type: 'text', name: 'x' } })).status).toBe(403)
    expect((await api(s.app, 'PATCH', `/channels/${text.id}`, { token: member.token, body: { name: 'y' } })).status).toBe(403)
    expect((await api(s.app, 'DELETE', `/channels/${text.id}`, { token: member.token })).status).toBe(403)
    expect((await api(s.app, 'PATCH', `/spaces/${space.id}`, { token: member.token, body: { name: 'y' } })).status).toBe(403)
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/members/${owner.user.id}`, { token: member.token })).status).toBe(403)
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}`, { token: member.token })).status).toBe(403)

    expect((await api(s.app, 'PATCH', '/spaces/0190f000-0000-7000-8000-000000000000', { token: owner.token, body: {} })).status).toBe(404)
    expect((await api(s.app, 'PATCH', '/spaces/not-a-uuid', { token: owner.token, body: {} })).status).toBe(404)
  })

  it('channel create/update/delete dispatch to members; voice-only fields are validated', async () => {
    const { owner, member, space } = await spaceWithMember()
    const gw = await connect(s.port, member.token)
    const created = await api(s.app, 'POST', `/spaces/${space.id}/channels`, { token: owner.token, body: { type: 'voice', name: 'Jogos' } })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ type: 'voice', position: 2, bitrateKbps: 64, userLimit: 0 })
    await gw.waitFor('CHANNEL_CREATE', (c) => c.id === created.body.id)

    const patched = await api(s.app, 'PATCH', `/channels/${created.body.id}`, { token: owner.token, body: { bitrateKbps: 96, userLimit: 5 } })
    expect(patched.body).toMatchObject({ bitrateKbps: 96, userLimit: 5 })
    await gw.waitFor('CHANNEL_UPDATE', (c) => c.id === created.body.id && c.bitrateKbps === 96)

    const text = space.channels.find((c) => c.type === 'text')!
    const bad = await api(s.app, 'PATCH', `/channels/${text.id}`, { token: owner.token, body: { bitrateKbps: 96 } })
    expect(bad.status).toBe(400)
    expect(bad.body.error.fields.bitrateKbps).toBeDefined()

    expect((await api(s.app, 'DELETE', `/channels/${created.body.id}`, { token: owner.token })).status).toBe(204)
    await gw.waitFor('CHANNEL_DELETE', (c) => c.id === created.body.id && c.spaceId === space.id)
    gw.close()
  })

  it('owner cannot leave; members can leave or be kicked; owner can delete the space', async () => {
    const { owner, member, space } = await spaceWithMember()
    const gwOwner = await connect(s.port, owner.token)
    const gwMember = await connect(s.port, member.token)

    const leaveOwner = await api(s.app, 'DELETE', `/spaces/${space.id}/members/@me`, { token: owner.token })
    expect(leaveOwner.status).toBe(400)

    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/members/${member.user.id}`, { token: owner.token })).status).toBe(204)
    await gwOwner.waitFor('MEMBER_REMOVE', (d) => d.userId === member.user.id)
    await gwMember.waitFor('SPACE_DELETE', (d) => d.id === space.id)
    expect((await api(s.app, 'PATCH', `/spaces/${space.id}`, { token: owner.token, body: { name: 'Renomeado' } })).body.name).toBe('Renomeado')

    const inv = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: owner.token, body: {} })).body
    await api(s.app, 'POST', `/invites/${inv.code}`, { token: member.token })
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/members/@me`, { token: member.token })).status).toBe(204)
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/members/@me`, { token: member.token })).status).toBe(403)

    gwMember.events.length = 0
    await api(s.app, 'POST', `/invites/${inv.code}`, { token: member.token })
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}`, { token: owner.token })).status).toBe(204)
    await gwMember.waitFor('SPACE_DELETE', (d) => d.id === space.id)
    expect((await api(s.app, 'PATCH', `/spaces/${space.id}`, { token: owner.token, body: { name: 'x' } })).status).toBe(404)
    gwOwner.close()
    gwMember.close()
  })
})

describe('invites', () => {
  it('8-char base62 codes', () => {
    for (let i = 0; i < 200; i++) expect(inviteCode()).toMatch(/^[0-9A-Za-z]{8}$/)
  })

  it('public preview, idempotent join with MEMBER_ADD + SPACE_CREATE, READY includes the space', async () => {
    const owner = await register(s.app)
    const joiner = await register(s.app)
    const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: owner.token, body: { name: 'Público' } })).body
    const created = await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: owner.token, body: { maxUses: 5 } })
    expect(created.status).toBe(201)
    const code = created.body.code
    expect(code).toMatch(/^[0-9A-Za-z]{8}$/)
    expect(created.body).toMatchObject({ uses: 0, maxUses: 5, memberCount: 1, inviterId: owner.user.id })
    expect(Date.parse(created.body.expiresAt!) - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000)

    const preview = await api<Invite>(s.app, 'GET', `/invites/${code}`) // no auth
    expect(preview.status).toBe(200)
    expect(preview.body.space).toMatchObject({ id: space.id, name: 'Público' })
    // A new person sees who called them: the inviter's public profile only (no e-mail).
    expect(preview.body.inviter).toMatchObject({ id: owner.user.id, displayName: owner.user.displayName })
    expect(Object.keys(preview.body.inviter!).sort()).toEqual(['avatarUrl', 'displayName', 'id'])
    // Their Eco is part of the face once they pick one.
    const eco = { accent: '#e5484d', eyes: 'slit', hair: 'none', accessory: 'horns' } as const
    expect((await api(s.app, 'PATCH', '/users/@me', { token: owner.token, body: { eco } })).status).toBe(200)
    expect((await api<Invite>(s.app, 'GET', `/invites/${code}`)).body.inviter).toMatchObject({ eco })

    const gwOwner = await connect(s.port, owner.token)
    const gwJoiner = await connect(s.port, joiner.token)
    const joined = await api<SpaceSnapshot>(s.app, 'POST', `/invites/${code}`, { token: joiner.token })
    expect(joined.status).toBe(200)
    expect(joined.body.members.map((m) => m.user.id).sort()).toEqual([owner.user.id, joiner.user.id].sort())
    await gwOwner.waitFor('MEMBER_ADD', (m) => m.user.id === joiner.user.id && m.spaceId === space.id)
    await gwJoiner.waitFor('SPACE_CREATE', (d) => d.id === space.id)
    await gwJoiner.waitFor('PRESENCE_UPDATE', (p) => p.userId === owner.user.id && p.status === 'online')

    const again = await api<SpaceSnapshot>(s.app, 'POST', `/invites/${code}`, { token: joiner.token })
    expect(again.status).toBe(200)
    expect((await api<Invite>(s.app, 'GET', `/invites/${code}`)).body).toMatchObject({ uses: 1, memberCount: 2 })

    const fresh = await connect(s.port, joiner.token)
    expect((await fresh.waitFor('READY')).spaces.map((x) => x.id)).toContain(space.id)
    for (const g of [gwOwner, gwJoiner, fresh]) g.close()
  })

  it('rejects expired and exhausted invites', async () => {
    const owner = await register(s.app)
    const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: owner.token, body: { name: 'Fechado' } })).body

    const once = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: owner.token, body: { maxUses: 1, maxAgeSeconds: 0 } })).body
    expect(once.expiresAt).toBeNull()
    const u1 = await register(s.app)
    const u2 = await register(s.app)
    expect((await api(s.app, 'POST', `/invites/${once.code}`, { token: u1.token })).status).toBe(200)
    const exhausted = await api(s.app, 'POST', `/invites/${once.code}`, { token: u2.token })
    expect(exhausted.status).toBe(404)
    expect((await api(s.app, 'GET', `/invites/${once.code}`)).status).toBe(404)

    const old = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: owner.token, body: {} })).body
    await s.app.ctx.db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.code, old.code))
    expect((await api(s.app, 'GET', `/invites/${old.code}`)).status).toBe(404)
    expect((await api(s.app, 'POST', `/invites/${old.code}`, { token: u2.token })).status).toBe(404)
    // The failed join must not have added u2.
    expect((await api(s.app, 'PATCH', `/spaces/${space.id}`, { token: u2.token, body: {} })).status).toBe(403)

    expect((await api(s.app, 'GET', '/invites/../../x')).status).toBe(404)
  })
})

describe('invite management', () => {
  const list = (token: string, spaceId: string) => api<Invite[]>(s.app, 'GET', `/spaces/${spaceId}/invites`, { token })
  const create = async (token: string, spaceId: string, body: object = {}) =>
    (await api<Invite>(s.app, 'POST', `/spaces/${spaceId}/invites`, { token, body })).body
  const revoke = (token: string, code: string) => api(s.app, 'DELETE', `/invites/${code}`, { token })

  it('lists usable invites: everything with MANAGE_SPACE, only your own otherwise; outsiders are refused', async () => {
    const { owner, member, space } = await spaceWithMember()
    const outsider = await register(s.app)
    const mine = await create(member.token, space.id, { maxUses: 5 })
    const used = await create(owner.token, space.id, { maxUses: 1 })
    await s.app.ctx.db.update(invites).set({ uses: 1 }).where(eq(invites.code, used.code))
    const expired = await create(owner.token, space.id)
    await s.app.ctx.db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.code, expired.code))

    const all = await list(owner.token, space.id)
    expect(all.status).toBe(200)
    const codes = all.body.map((i) => i.code)
    expect(codes).toContain(mine.code)
    expect(codes).not.toContain(used.code)
    expect(codes).not.toContain(expired.code)
    expect(all.body.find((i) => i.code === mine.code)).toMatchObject({ inviterId: member.user.id, maxUses: 5, memberCount: 2, space: { id: space.id } })
    expect((await list(member.token, space.id)).body.map((i) => i.code)).toEqual([mine.code])
    expect((await list(outsider.token, space.id)).status).toBe(403)
  })

  it('INVITE_CREATE / INVITE_DELETE go to MANAGE_SPACE members and the creator only', async () => {
    const { owner, member, space } = await spaceWithMember()
    const other = await register(s.app)
    await api(s.app, 'POST', `/invites/${(await create(owner.token, space.id)).code}`, { token: other.token })
    const [ogw, mgw, xgw] = await Promise.all([connect(s.port, owner.token), connect(s.port, member.token), connect(s.port, other.token)])

    const inv = await create(member.token, space.id)
    expect(await ogw.waitFor('INVITE_CREATE', (d) => d.code === inv.code)).toMatchObject({ inviterId: member.user.id, space: { id: space.id } })
    await mgw.waitFor('INVITE_CREATE', (d) => d.code === inv.code)
    const byOwner = await create(owner.token, space.id)
    await ogw.waitFor('INVITE_CREATE', (d) => d.code === byOwner.code)

    expect((await revoke(owner.token, inv.code)).status).toBe(204)
    await mgw.waitFor('INVITE_DELETE', (d) => d.code === inv.code && d.spaceId === space.id)
    await ogw.waitFor('INVITE_DELETE', (d) => d.code === inv.code)

    // Leaving takes the creator's invites along; the managers hear about it.
    const second = await create(member.token, space.id)
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/members/@me`, { token: member.token })).status).toBe(204)
    await ogw.waitFor('INVITE_DELETE', (d) => d.code === second.code)
    await xgw.expectNone('INVITE_CREATE')
    await xgw.expectNone('INVITE_DELETE')
    expect(mgw.events.some((e) => e.t === 'INVITE_CREATE' && e.d.code === byOwner.code)).toBe(false)
    ogw.close()
    mgw.close()
    xgw.close()
  })

  it('revoke: the creator or MANAGE_SPACE; others get 403, outsiders and unknown codes 404', async () => {
    const { owner, member, space } = await spaceWithMember()
    const outsider = await register(s.app)
    const ownerInvite = await create(owner.token, space.id)
    const memberInvite = await create(member.token, space.id)

    expect((await revoke(outsider.token, ownerInvite.code)).status).toBe(404)
    expect((await revoke(member.token, ownerInvite.code)).status).toBe(403)
    expect((await revoke(member.token, 'NoSuchCode')).status).toBe(404)
    expect((await revoke(member.token, memberInvite.code)).status).toBe(204)
    expect((await api(s.app, 'GET', `/invites/${memberInvite.code}`)).status).toBe(404)

    // A member given MANAGE_SPACE can revoke someone else's invite; the code stops working for joins.
    const role = (await api(s.app, 'POST', `/spaces/${space.id}/roles`, { token: owner.token, body: { name: 'Gestão', permissions: Permission.MANAGE_SPACE } })).body
    await api(s.app, 'PUT', `/spaces/${space.id}/members/${member.user.id}/roles/${role.id}`, { token: owner.token })
    expect((await revoke(member.token, ownerInvite.code)).status).toBe(204)
    expect((await api(s.app, 'POST', `/invites/${ownerInvite.code}`, { token: outsider.token })).status).toBe(404)
    expect((await revoke(owner.token, ownerInvite.code)).status).toBe(404)
  })
})
