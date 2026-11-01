import {
  DEFAULT_EVERYONE_PERMISSIONS, Permission,
  type Ban, type Channel, type Invite, type Member, type Role, type SpaceSnapshot, type VoiceJoinResponse,
} from '@alga/shared'
import { eq } from 'drizzle-orm'
import { TokenVerifier, TrackSource, type RoomServiceClient } from 'livekit-server-sdk'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { roles } from '../src/db/schema.js'
import { api, connect, postWebhook, register, startServer, type TestServer } from './helpers.js'

let s: TestServer
beforeAll(async () => { s = await startServer() })
afterAll(async () => { await s.close() })
afterEach(() => { vi.restoreAllMocks() })

type User = Awaited<ReturnType<typeof register>>

async function setup(n = 3) {
  const owner = await register(s.app)
  const members: User[] = []
  for (let i = 0; i < n; i++) members.push(await register(s.app))
  const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: owner.token, body: { name: 'Mod' } })).body
  const invite = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: owner.token, body: {} })).body
  for (const m of members) await api(s.app, 'POST', `/invites/${invite.code}`, { token: m.token })
  return { owner, members, space, invite, voice: space.channels.find((c) => c.type === 'voice')!, text: space.channels.find((c) => c.type === 'text')! }
}

const createRole = (token: string, spaceId: string, body: object) => api<Role>(s.app, 'POST', `/spaces/${spaceId}/roles`, { token, body })
const giveRole = (token: string, spaceId: string, userId: string, roleId: string) =>
  api(s.app, 'PUT', `/spaces/${spaceId}/members/${userId}/roles/${roleId}`, { token })

let seq = 0
const joined = (channelId: string, identity: string) =>
  postWebhook(s.app, s.config, { event: 'participant_joined', id: `MOD_${++seq}`, room: { name: `ch_${channelId}` }, participant: { identity } })
const left = (channelId: string, identity: string) =>
  postWebhook(s.app, s.config, { event: 'participant_left', id: `MOD_${++seq}`, room: { name: `ch_${channelId}` }, participant: { identity } })

/** LiveKit RoomService calls, recorded (the SFU is not running in tests); the participant has one mic track. */
function spySfu() {
  const rooms = (s.app.ctx.voice as unknown as { rooms: RoomServiceClient }).rooms
  return {
    remove: vi.spyOn(rooms, 'removeParticipant').mockResolvedValue(undefined),
    update: vi.spyOn(rooms, 'updateParticipant').mockResolvedValue({} as never),
    get: vi.spyOn(rooms, 'getParticipant').mockResolvedValue({ tracks: [{ sid: 'TR_mic', source: TrackSource.MICROPHONE, muted: false }] } as never),
    mute: vi.spyOn(rooms, 'mutePublishedTrack').mockResolvedValue({} as never),
  }
}
const grantsOf = async (token: string) => (await new TokenVerifier(s.config.livekit.apiKey, s.config.livekit.apiSecret).verify(token)).video!

describe('roles', () => {
  it('create/list/patch/delete with ROLE_UPSERT / ROLE_DELETE, @everyone protected, MANAGE_ROLES required', async () => {
    const { owner, members: [bob], space } = await setup(1)
    const gw = await connect(s.port, bob!.token)
    expect((await createRole(bob!.token, space.id, { name: 'X' })).status).toBe(403)

    const mod = await createRole(owner.token, space.id, { name: 'Mod', color: '#7c9cff', permissions: Permission.KICK_MEMBERS })
    expect(mod.status).toBe(201)
    expect(mod.body).toMatchObject({ spaceId: space.id, name: 'Mod', color: '#7c9cff', permissions: Permission.KICK_MEMBERS, position: 1 })
    await gw.waitFor('ROLE_UPSERT', (r) => r.id === mod.body.id)
    const helper = (await createRole(owner.token, space.id, { name: 'Helper' })).body
    expect(helper.position).toBe(1)
    const list = (await api<Role[]>(s.app, 'GET', `/spaces/${space.id}/roles`, { token: bob!.token })).body
    expect(list.map((r) => [r.name, r.position])).toEqual([['@everyone', 0], ['Helper', 1], ['Mod', 2]])

    expect((await api(s.app, 'PATCH', `/spaces/${space.id}/roles/${helper.id}`, { token: owner.token, body: { name: 'Ajudante' } })).body.name).toBe('Ajudante')
    expect((await api(s.app, 'PATCH', `/spaces/${space.id}/roles/${space.id}`, { token: owner.token, body: { name: 'todos' } })).status).toBe(400)
    expect((await api(s.app, 'PATCH', `/spaces/${space.id}/roles/${space.id}`, { token: owner.token, body: { permissions: 1 << 30 } })).status).toBe(400)
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/roles/${space.id}`, { token: owner.token })).status).toBe(400)

    expect((await giveRole(owner.token, space.id, bob!.user.id, helper.id)).status).toBe(204)
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/roles/${helper.id}`, { token: owner.token })).status).toBe(204)
    expect(await gw.waitFor('ROLE_DELETE', (d) => d.id === helper.id)).toEqual({ spaceId: space.id, id: helper.id })
    const snap = (await connect(s.port, owner.token)).waitFor('READY')
    expect((await snap).spaces.find((x) => x.id === space.id)!.members.find((m) => m.user.id === bob!.user.id)!.roleIds).toEqual([])
    gw.close()
  })

  it('hierarchy: below-your-top only, no granting what you lack; assignments emit MEMBER_UPDATE', async () => {
    const { owner, members: [bob, carol, dave], space } = await setup(3)
    const mod = (await createRole(owner.token, space.id, { name: 'Mod', permissions: Permission.MANAGE_ROLES | Permission.KICK_MEMBERS })).body
    const gw = await connect(s.port, carol!.token)
    expect((await giveRole(owner.token, space.id, bob!.user.id, mod.id)).status).toBe(204)
    expect((await gw.waitFor('MEMBER_UPDATE', (m) => m.user.id === bob!.user.id)).roleIds).toEqual([mod.id])

    // bob (Mod) creates Helper below him and hands it out.
    const helper = (await createRole(bob!.token, space.id, { name: 'Helper', permissions: Permission.KICK_MEMBERS })).body
    expect(helper.position).toBe(1)
    expect((await giveRole(bob!.token, space.id, carol!.user.id, helper.id)).status).toBe(204)
    // …but not his own role, nor permissions he does not have.
    expect((await giveRole(bob!.token, space.id, dave!.user.id, mod.id)).status).toBe(403)
    expect((await api(s.app, 'PATCH', `/spaces/${space.id}/roles/${mod.id}`, { token: bob!.token, body: { name: 'Boss' } })).status).toBe(403)
    expect((await createRole(bob!.token, space.id, { name: 'Admin', permissions: Permission.ADMINISTRATOR })).status).toBe(403)
    expect((await api(s.app, 'PATCH', `/spaces/${space.id}/roles/${helper.id}`, { token: bob!.token, body: { permissions: Permission.BAN_MEMBERS } })).status).toBe(403)
    expect((await api(s.app, 'PATCH', `/spaces/${space.id}/roles/${helper.id}`, { token: bob!.token, body: { permissions: 0 } })).status).toBe(200)

    // Kicks follow the hierarchy too: bob outranks carol (Helper), not dave once dave is Mod, never the owner.
    await giveRole(owner.token, space.id, dave!.user.id, mod.id)
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/members/${dave!.user.id}`, { token: bob!.token })).status).toBe(403)
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/members/${owner.user.id}`, { token: bob!.token })).status).toBe(403)
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/members/${carol!.user.id}`, { token: bob!.token })).status).toBe(204)
    gw.close()
  })

  it('reorder: only roles below your top move, slots are kept, ROLE_UPSERT for each moved role', async () => {
    const { owner, members: [bob], space } = await setup(1)
    const top = (await createRole(owner.token, space.id, { name: 'Top', permissions: Permission.MANAGE_ROLES })).body
    const a = (await createRole(owner.token, space.id, { name: 'A' })).body
    const b = (await createRole(owner.token, space.id, { name: 'B' })).body // positions: B 1, A 2, Top 3
    await giveRole(owner.token, space.id, bob!.user.id, top.id)
    const gw = await connect(s.port, owner.token)
    const res = await api<Role[]>(s.app, 'PATCH', `/spaces/${space.id}/roles`, { token: bob!.token, body: [{ id: b.id, position: 2 }, { id: a.id, position: 1 }] })
    expect(res.status).toBe(200)
    expect(res.body.map((r) => r.name)).toEqual(['@everyone', 'A', 'B', 'Top'])
    await gw.waitFor('ROLE_UPSERT', (r) => r.id === b.id && r.position === 2)
    // bob cannot move his own top role (nor anything above it), even to a lower spot.
    expect((await api(s.app, 'PATCH', `/spaces/${space.id}/roles`, { token: bob!.token, body: [{ id: top.id, position: 1 }] })).status).toBe(403)
    // The owner can move anything.
    const o = await api<Role[]>(s.app, 'PATCH', `/spaces/${space.id}/roles`, { token: owner.token, body: [{ id: top.id, position: 1 }] })
    expect(o.body.map((r) => r.name)).toEqual(['@everyone', 'Top', 'A', 'B'])
    gw.close()
  })
})

describe('nicknames', () => {
  it('self with CHANGE_NICKNAME, others with MANAGE_NICKNAMES below you; MEMBER_UPDATE fans out', async () => {
    const { owner, members: [bob, carol], space } = await setup(2)
    const gw = await connect(s.port, owner.token)
    const mine = await api<Member>(s.app, 'PATCH', `/spaces/${space.id}/members/@me`, { token: bob!.token, body: { nickname: '  Bobão ' } })
    expect(mine.status).toBe(200)
    expect(mine.body).toMatchObject({ spaceId: space.id, nickname: 'Bobão' })
    await gw.waitFor('MEMBER_UPDATE', (m) => m.user.id === bob!.user.id && m.nickname === 'Bobão')
    expect((await api(s.app, 'PATCH', `/spaces/${space.id}/members/${carol!.user.id}`, { token: bob!.token, body: { nickname: 'x' } })).status).toBe(403)
    expect((await api<Member>(s.app, 'PATCH', `/spaces/${space.id}/members/${bob!.user.id}`, { token: owner.token, body: { nickname: null } })).body.nickname).toBeNull()
    expect((await api(s.app, 'PATCH', `/spaces/${space.id}/members/${owner.user.id}`, { token: bob!.token, body: { nickname: 'x' } })).status).toBe(403)

    await s.app.ctx.db.update(roles).set({ permissions: DEFAULT_EVERYONE_PERMISSIONS & ~Permission.CHANGE_NICKNAME }).where(eq(roles.id, space.id))
    expect((await api(s.app, 'PATCH', `/spaces/${space.id}/members/@me`, { token: bob!.token, body: { nickname: 'y' } })).status).toBe(403)
    gw.close()
  })
})

describe('bans and kicks', () => {
  it('ban removes the member (voice included), lists, blocks invite rejoin; unban lets them back', async () => {
    const { owner, members: [bob, carol], space, invite, voice } = await setup(2)
    const sfu = spySfu()
    const gwOwner = await connect(s.port, owner.token)
    const gwBob = await connect(s.port, bob!.token)
    await joined(voice.id, bob!.user.id)
    await gwOwner.waitFor('VOICE_STATE_UPDATE', (v) => v.userId === bob!.user.id)

    expect((await api(s.app, 'PUT', `/spaces/${space.id}/bans/${bob!.user.id}`, { token: carol!.token, body: {} })).status).toBe(403)
    expect((await api(s.app, 'PUT', `/spaces/${space.id}/bans/${owner.user.id}`, { token: owner.token, body: {} })).status).toBe(400)
    expect((await api(s.app, 'PUT', `/spaces/${space.id}/bans/${bob!.user.id}`, { token: owner.token, body: { reason: 'spam' } })).status).toBe(204)
    await gwBob.waitFor('SPACE_DELETE', (d) => d.id === space.id)
    expect(await gwBob.waitFor('VOICE_DISCONNECT')).toEqual({ channelId: voice.id, reason: 'moderator' })
    await gwOwner.waitFor('MEMBER_REMOVE', (d) => d.userId === bob!.user.id)
    await gwOwner.waitFor('VOICE_STATE_REMOVE', (d) => d.userId === bob!.user.id)
    expect(sfu.remove).toHaveBeenCalledWith(`ch_${voice.id}`, bob!.user.id)

    const bans = await api<Ban[]>(s.app, 'GET', `/spaces/${space.id}/bans`, { token: owner.token })
    expect(bans.body).toEqual([{ user: expect.objectContaining({ id: bob!.user.id }), reason: 'spam', createdAt: expect.any(String) }])
    expect((await api(s.app, 'GET', `/spaces/${space.id}/bans`, { token: carol!.token })).status).toBe(403)
    const rejoin = await api(s.app, 'POST', `/invites/${invite.code}`, { token: bob!.token })
    expect(rejoin.status).toBe(403)
    // The old LiveKit token is useless too: no longer a member.
    await joined(voice.id, bob!.user.id)
    expect(s.app.ctx.voice.inChannel(voice.id)).toEqual([])

    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/bans/${bob!.user.id}`, { token: owner.token })).status).toBe(204)
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/bans/${bob!.user.id}`, { token: owner.token })).status).toBe(404)
    expect((await api(s.app, 'POST', `/invites/${invite.code}`, { token: bob!.token })).status).toBe(200)
    gwOwner.close()
    gwBob.close()
  })

  it('kick drops voice at the SFU and the kicked user stops receiving the space\'s events', async () => {
    const { owner, members: [bob], space, voice, text } = await setup(1)
    const sfu = spySfu()
    const gwBob = await connect(s.port, bob!.token)
    await joined(voice.id, bob!.user.id)
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/members/${bob!.user.id}`, { token: owner.token })).status).toBe(204)
    expect(sfu.remove).toHaveBeenCalledWith(`ch_${voice.id}`, bob!.user.id)
    await gwBob.waitFor('VOICE_DISCONNECT', (d) => d.reason === 'moderator')
    gwBob.events.length = 0
    await api(s.app, 'POST', `/channels/${text.id}/messages`, { token: owner.token, body: { content: 'depois do kick' } })
    await joined(voice.id, owner.user.id)
    await gwBob.expectNone('MESSAGE_CREATE')
    await gwBob.expectNone('VOICE_STATE_UPDATE')
    gwBob.close()
  })
})

describe('voice moderation', () => {
  const moderate = (token: string, spaceId: string, userId: string, body: object) =>
    api(s.app, 'PATCH', `/spaces/${spaceId}/members/${userId}/voice`, { token, body })

  it('server mute/deafen is enforced at the SFU, persists across joins and needs MUTE/DEAFEN_MEMBERS', async () => {
    const { owner, members: [bob, carol], space, voice } = await setup(2)
    const sfu = spySfu()
    const gw = await connect(s.port, carol!.token)
    await joined(voice.id, bob!.user.id)
    expect((await moderate(carol!.token, space.id, bob!.user.id, { serverMute: true })).status).toBe(403)

    expect((await moderate(owner.token, space.id, bob!.user.id, { serverMute: true })).status).toBe(204)
    await gw.waitFor('VOICE_STATE_UPDATE', (v) => v.userId === bob!.user.id && v.serverMute && !v.serverDeaf)
    expect(sfu.update).toHaveBeenCalledWith(`ch_${voice.id}`, bob!.user.id, {
      permission: { canSubscribe: true, canPublish: true, canPublishSources: [TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO], canPublishData: false },
    })
    expect(sfu.mute).toHaveBeenCalledWith(`ch_${voice.id}`, bob!.user.id, 'TR_mic', true)

    // Persisted: a fresh join is muted again and the new token carries no microphone.
    await left(voice.id, bob!.user.id)
    await joined(voice.id, bob!.user.id)
    expect(s.app.ctx.voice.stateOf(bob!.user.id)).toMatchObject({ serverMute: true })
    const tok = await api<VoiceJoinResponse>(s.app, 'POST', '/voice/join', { token: bob!.token, body: { channelId: voice.id } })
    expect((await grantsOf(tok.body.token)).canPublishSources).toEqual(['camera', 'screen_share', 'screen_share_audio'])

    expect((await moderate(owner.token, space.id, bob!.user.id, { serverMute: false, serverDeaf: true })).status).toBe(204)
    await gw.waitFor('VOICE_STATE_UPDATE', (v) => v.userId === bob!.user.id && !v.serverMute && v.serverDeaf)
    expect(sfu.update).toHaveBeenLastCalledWith(`ch_${voice.id}`, bob!.user.id, {
      permission: { canSubscribe: false, canPublish: true, canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO], canPublishData: false },
    })
    const deaf = await api<VoiceJoinResponse>(s.app, 'POST', '/voice/join', { token: bob!.token, body: { channelId: voice.id } })
    expect((await grantsOf(deaf.body.token)).canSubscribe).toBe(false)
    gw.close()
  })

  it('move: VOICE_MOVE to the user, dropped from the old room, may enter the target even when full', async () => {
    const { owner, members: [bob, carol], space, voice } = await setup(2)
    const sfu = spySfu()
    const afk = (await api<Channel>(s.app, 'POST', `/spaces/${space.id}/channels`, { token: owner.token, body: { type: 'voice', name: 'AFK' } })).body
    await api(s.app, 'PATCH', `/channels/${afk.id}`, { token: owner.token, body: { userLimit: 1 } })
    await joined(afk.id, carol!.user.id) // AFK is now full
    await joined(voice.id, bob!.user.id)
    const gwBob = await connect(s.port, bob!.token)
    const gwOwner = await connect(s.port, owner.token)

    expect((await moderate(owner.token, space.id, bob!.user.id, { channelId: space.channels.find((c) => c.type === 'text')!.id })).status).toBe(400)
    expect((await moderate(owner.token, space.id, owner.user.id, { channelId: afk.id })).status).toBe(400) // not in voice
    expect((await moderate(carol!.token, space.id, bob!.user.id, { channelId: afk.id })).status).toBe(403)

    expect((await moderate(owner.token, space.id, bob!.user.id, { channelId: afk.id })).status).toBe(204)
    expect(await gwBob.waitFor('VOICE_MOVE')).toEqual({ channelId: afk.id })
    await gwOwner.waitFor('VOICE_STATE_REMOVE', (d) => d.userId === bob!.user.id && d.channelId === voice.id)
    expect(sfu.remove).toHaveBeenCalledWith(`ch_${voice.id}`, bob!.user.id)
    // The client follows the move: join is allowed although AFK is full, and the SFU join is accepted.
    expect((await api(s.app, 'POST', '/voice/join', { token: bob!.token, body: { channelId: afk.id } })).status).toBe(200)
    await joined(afk.id, bob!.user.id)
    expect(s.app.ctx.voice.inChannel(afk.id).map((v) => v.userId).sort()).toEqual([bob!.user.id, carol!.user.id].sort())
    gwBob.close()
    gwOwner.close()
  })

  it('disconnect: channelId null removes the member from voice with VOICE_DISCONNECT', async () => {
    const { owner, members: [bob], space, voice } = await setup(1)
    const sfu = spySfu()
    await joined(voice.id, bob!.user.id)
    const gwBob = await connect(s.port, bob!.token)
    expect((await moderate(owner.token, space.id, bob!.user.id, { channelId: null })).status).toBe(204)
    expect(await gwBob.waitFor('VOICE_DISCONNECT')).toEqual({ channelId: voice.id, reason: 'moderator' })
    expect(sfu.remove).toHaveBeenCalledWith(`ch_${voice.id}`, bob!.user.id)
    expect(s.app.ctx.voice.stateOf(bob!.user.id)).toBeUndefined()
    expect((await moderate(owner.token, space.id, bob!.user.id, { channelId: null })).status).toBe(400)
    gwBob.close()
  })

  it('losing SPEAK through a role change updates the live grants', async () => {
    const { owner, members: [bob], space, voice } = await setup(1)
    const sfu = spySfu()
    await joined(voice.id, bob!.user.id)
    const r = await api(s.app, 'PATCH', `/spaces/${space.id}/roles/${space.id}`, {
      token: owner.token, body: { permissions: DEFAULT_EVERYONE_PERMISSIONS & ~Permission.SPEAK },
    })
    expect(r.status).toBe(200)
    expect(sfu.update).toHaveBeenCalledWith(`ch_${voice.id}`, bob!.user.id, {
      permission: { canSubscribe: true, canPublish: true, canPublishSources: [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO], canPublishData: false },
    })
  })
})
