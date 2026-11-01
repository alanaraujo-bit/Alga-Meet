import { DEFAULT_EVERYONE_PERMISSIONS, Permission, type Channel, type Invite, type SpaceSnapshot, type VoiceJoinResponse } from '@alga/shared'
import { eq } from 'drizzle-orm'
import { TokenVerifier } from 'livekit-server-sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { roles } from '../src/db/schema.js'
import { api, connect, postWebhook, register, signedWebhook, startServer, type TestServer } from './helpers.js'

let s: TestServer
beforeAll(async () => { s = await startServer() })
afterAll(async () => { await s.close() })

async function setup() {
  const alice = await register(s.app)
  const bob = await register(s.app)
  const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: alice.token, body: { name: 'Voz' } })).body
  const inv = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: alice.token, body: {} })).body
  await api(s.app, 'POST', `/invites/${inv.code}`, { token: bob.token })
  return { alice, bob, space, text: space.channels.find((c) => c.type === 'text')!, voice: space.channels.find((c) => c.type === 'voice')! }
}

let seq = 0
const event = (name: string, channelId: string, identity?: string) => ({
  event: name,
  id: `EV_${++seq}`,
  createdAt: String(Math.floor(Date.now() / 1000)),
  room: { sid: `RM_${channelId.slice(0, 8)}`, name: `ch_${channelId}` },
  ...(identity ? { participant: { sid: `PA_${seq}`, identity, name: 'x', joinedAt: String(Math.floor(Date.now() / 1000)) } } : {}),
})

const join = (token: string, channelId: string) => api<VoiceJoinResponse>(s.app, 'POST', '/voice/join', { token, body: { channelId } })

describe('voice join', () => {
  it('mints a 1h LiveKit token scoped to ch_<channelId> with grants derived from permissions', async () => {
    const { bob, voice, space } = await setup()
    const res = await join(bob.token, voice.id)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ url: s.config.livekit.publicUrl, room: `ch_${voice.id}`, bitrateKbps: 64 })

    const claims = await new TokenVerifier(s.config.livekit.apiKey, s.config.livekit.apiSecret).verify(res.body.token)
    expect(claims.sub).toBe(bob.user.id)
    expect(claims.name).toBe(bob.user.displayName)
    expect(claims.exp! - claims.nbf!).toBe(3600)
    expect(claims.video).toMatchObject({
      roomJoin: true, room: `ch_${voice.id}`, canSubscribe: true, canPublish: true,
      canPublishSources: ['microphone', 'camera', 'screen_share', 'screen_share_audio'],
    })

    // Without STREAM the screen sources disappear; without SPEAK too, nothing can be published.
    await s.app.ctx.db.update(roles).set({ permissions: DEFAULT_EVERYONE_PERMISSIONS & ~Permission.STREAM }).where(eq(roles.id, space.id))
    const noStream = await new TokenVerifier(s.config.livekit.apiKey, s.config.livekit.apiSecret).verify((await join(bob.token, voice.id)).body.token)
    expect(noStream.video!.canPublishSources).toEqual(['microphone', 'camera'])
    await s.app.ctx.db.update(roles).set({ permissions: DEFAULT_EVERYONE_PERMISSIONS & ~(Permission.STREAM | Permission.SPEAK) }).where(eq(roles.id, space.id))
    const listenOnly = await new TokenVerifier(s.config.livekit.apiKey, s.config.livekit.apiSecret).verify((await join(bob.token, voice.id)).body.token)
    expect(listenOnly.video).toMatchObject({ canPublish: false, canPublishSources: [], canSubscribe: true })

    await s.app.ctx.db.update(roles).set({ permissions: DEFAULT_EVERYONE_PERMISSIONS & ~Permission.CONNECT }).where(eq(roles.id, space.id))
    expect((await join(bob.token, voice.id)).status).toBe(403)
  })

  it('refuses text channels, non-members and full channels (MOVE_MEMBERS bypasses the limit)', async () => {
    const { alice, bob, text, voice } = await setup()
    const outsider = await register(s.app)
    expect((await join(alice.token, text.id)).status).toBe(400)
    expect((await join(outsider.token, voice.id)).status).toBe(403)

    await api(s.app, 'PATCH', `/channels/${voice.id}`, { token: alice.token, body: { userLimit: 1 } })
    expect((await postWebhook(s.app, s.config, event('participant_joined', voice.id, alice.user.id))).status).toBe(200)
    const full = await join(bob.token, voice.id)
    expect(full.status).toBe(403)
    expect(full.body.error.code).toBe('forbidden')
    expect((await join(alice.token, voice.id)).status).toBe(200) // already inside: rejoining is fine

    await postWebhook(s.app, s.config, event('participant_left', voice.id, alice.user.id))
    await postWebhook(s.app, s.config, event('participant_joined', voice.id, bob.user.id))
    expect((await join(alice.token, voice.id)).status).toBe(200) // owner has MOVE_MEMBERS
  })

  it('DM participants can join the DM call room', async () => {
    const a = await register(s.app)
    const b = await register(s.app)
    const dm = (await api<Channel>(s.app, 'POST', '/users/@me/channels', { token: a.token, body: { recipientIds: [b.user.id] } })).body
    const res = await join(b.token, dm.id)
    expect(res.status).toBe(200)
    expect(res.body.room).toBe(`ch_${dm.id}`)
    expect((await join((await register(s.app)).token, dm.id)).status).toBe(403)
  })
})

describe('livekit webhook', () => {
  it('rejects missing, wrongly-signed and tampered requests', async () => {
    const { voice, alice } = await setup()
    const payload = event('participant_joined', voice.id, alice.user.id)
    const noAuth = await s.app.inject({
      method: 'POST', url: '/api/v1/livekit/webhook',
      headers: { 'content-type': 'application/webhook+json' }, payload: JSON.stringify(payload),
    })
    expect(noAuth.statusCode).toBe(401)
    expect((await postWebhook(s.app, s.config, payload, 'x'.repeat(40))).status).toBe(401)

    const { authorization } = await signedWebhook(s.config, payload)
    const tampered = await s.app.inject({
      method: 'POST', url: '/api/v1/livekit/webhook',
      headers: { authorization, 'content-type': 'application/webhook+json' },
      payload: JSON.stringify({ ...payload, id: 'EV_other' }),
    })
    expect(tampered.statusCode).toBe(401)
    expect(s.app.ctx.voice.all().find((v) => v.userId === alice.user.id)).toBeUndefined()
  })

  it('participant_joined / voice_state op / participant_left drive VOICE_STATE_* to space members', async () => {
    const { alice, bob, voice, space } = await setup()
    const gwBob = await connect(s.port, bob.token)
    const gwAlice = await connect(s.port, alice.token)

    expect((await postWebhook(s.app, s.config, event('participant_joined', voice.id, alice.user.id))).status).toBe(200)
    const st = await gwBob.waitFor('VOICE_STATE_UPDATE', (v) => v.userId === alice.user.id)
    expect(st).toMatchObject({ channelId: voice.id, spaceId: space.id, selfMute: false, selfDeaf: false, serverMute: false, streaming: false, video: false })
    // Duplicate delivery is a no-op.
    gwBob.events.length = 0
    await postWebhook(s.app, s.config, event('participant_joined', voice.id, alice.user.id))
    await gwBob.expectNone('VOICE_STATE_UPDATE')

    const ready = await (await connect(s.port, bob.token)).waitFor('READY')
    expect(ready.voiceStates).toEqual([expect.objectContaining({ userId: alice.user.id, channelId: voice.id })])

    gwAlice.send({ op: 'voice_state', selfMute: true, selfDeaf: false, streaming: true, video: false })
    await gwBob.waitFor('VOICE_STATE_UPDATE', (v) => v.userId === alice.user.id && v.selfMute && v.streaming)
    // Not in voice → the op is ignored.
    gwBob.send({ op: 'voice_state', selfMute: true, selfDeaf: true, streaming: false, video: false })
    await gwAlice.expectNone('VOICE_STATE_UPDATE', (v) => v.userId === bob.user.id)

    await postWebhook(s.app, s.config, event('participant_left', voice.id, alice.user.id))
    await gwBob.waitFor('VOICE_STATE_REMOVE', (d) => d.userId === alice.user.id && d.channelId === voice.id)
    expect(s.app.ctx.voice.inChannel(voice.id)).toEqual([])
    gwBob.close()
    gwAlice.close()
  })

  it('joining a second channel removes the first (one voice channel per user), keeping mute/deaf', async () => {
    const { alice, bob, voice, space } = await setup()
    const other = (await api<Channel>(s.app, 'POST', `/spaces/${space.id}/channels`, { token: alice.token, body: { type: 'voice', name: 'Outro' } })).body
    const gwBob = await connect(s.port, bob.token)
    const gwAlice = await connect(s.port, alice.token)
    await postWebhook(s.app, s.config, event('participant_joined', voice.id, alice.user.id))
    gwAlice.send({ op: 'voice_state', selfMute: true, selfDeaf: true, streaming: true, video: false })
    await gwBob.waitFor('VOICE_STATE_UPDATE', (v) => v.selfDeaf)

    await postWebhook(s.app, s.config, event('participant_joined', other.id, alice.user.id))
    await gwBob.waitFor('VOICE_STATE_REMOVE', (d) => d.userId === alice.user.id && d.channelId === voice.id)
    const moved = await gwBob.waitFor('VOICE_STATE_UPDATE', (v) => v.channelId === other.id)
    expect(moved).toMatchObject({ selfMute: true, selfDeaf: true, streaming: false })
    // The late `participant_left` for the old room must not remove the new state.
    await postWebhook(s.app, s.config, event('participant_left', voice.id, alice.user.id))
    expect(s.app.ctx.voice.inChannel(other.id).map((v) => v.userId)).toEqual([alice.user.id])

    await postWebhook(s.app, s.config, event('room_finished', other.id))
    await gwBob.waitFor('VOICE_STATE_REMOVE', (d) => d.channelId === other.id)
    gwBob.close()
    gwAlice.close()
  })

  it('ignores participants without access and unknown rooms', async () => {
    const { voice } = await setup()
    const outsider = await register(s.app)
    expect((await postWebhook(s.app, s.config, event('participant_joined', voice.id, outsider.user.id))).status).toBe(200)
    expect((await postWebhook(s.app, s.config, { ...event('participant_joined', voice.id, outsider.user.id), room: { name: 'lobby' } })).status).toBe(200)
    expect(s.app.ctx.voice.inChannel(voice.id)).toEqual([])
  })

  it('first participant in a DM room rings the other recipients; kicking from a space drops voice', async () => {
    const a = await register(s.app)
    const b = await register(s.app)
    const dm = (await api<Channel>(s.app, 'POST', '/users/@me/channels', { token: a.token, body: { recipientIds: [b.user.id] } })).body
    const gwA = await connect(s.port, a.token)
    const gwB = await connect(s.port, b.token)
    await postWebhook(s.app, s.config, event('participant_joined', dm.id, a.user.id))
    expect(await gwB.waitFor('CALL_RING')).toEqual({ channelId: dm.id, fromUserId: a.user.id })
    await gwB.waitFor('VOICE_STATE_UPDATE', (v) => v.channelId === dm.id && v.spaceId === null)
    await postWebhook(s.app, s.config, event('participant_joined', dm.id, b.user.id))
    await gwA.waitFor('VOICE_STATE_UPDATE', (v) => v.userId === b.user.id)
    await gwA.expectNone('CALL_RING')
    gwA.close()
    gwB.close()

    const { alice, bob, voice, space } = await setup()
    const gwAlice = await connect(s.port, alice.token)
    await postWebhook(s.app, s.config, event('participant_joined', voice.id, bob.user.id))
    await api(s.app, 'DELETE', `/spaces/${space.id}/members/${bob.user.id}`, { token: alice.token })
    await gwAlice.waitFor('VOICE_STATE_REMOVE', (d) => d.userId === bob.user.id)
    expect(s.app.ctx.voice.inChannel(voice.id)).toEqual([])
    gwAlice.close()
  })
})
