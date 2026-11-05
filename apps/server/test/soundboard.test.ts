import {
  DEFAULT_EVERYONE_PERMISSIONS, MAX_SOUNDS_PER_SPACE, Permission, uuidv7,
  type Invite, type SpaceSnapshot, type SpaceSound,
} from '@alga/shared'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { roles, spaces, storageDeletions } from '../src/db/schema.js'
import { SoundboardLimiter } from '../src/soundboard.js'
import { api, connect, postWebhook, register, startServer, type TestServer } from './helpers.js'

let s: TestServer
beforeAll(async () => { s = await startServer() })
afterAll(async () => { await s.close() })

/** PCM16 mono 48 kHz WAV of `ms` milliseconds (a quiet saw). */
function wav(ms = 400): Buffer {
  const frames = Math.round(48 * ms)
  const b = Buffer.alloc(44 + frames * 2)
  b.write('RIFF', 0); b.writeUInt32LE(b.length - 8, 4); b.write('WAVE', 8)
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(frames * 2, 40)
  for (let i = 0; i < frames; i++) b.writeInt16LE(((i % 100) - 50) * 40, 44 + i * 2)
  return b
}

async function upload(app: FastifyInstance, token: string, spaceId: string, data: Buffer, meta: unknown = { name: 'Corneta', emoji: '📯' }) {
  const fd = new FormData()
  fd.append('payload_json', JSON.stringify(meta))
  fd.append('file', new Blob([new Uint8Array(data)], { type: 'audio/wav' }), 'som.wav')
  const req = new Request('http://x', { method: 'POST', body: fd })
  const res = await app.inject({
    method: 'POST', url: `/api/v1/spaces/${spaceId}/sounds`,
    headers: { authorization: `Bearer ${token}`, 'content-type': req.headers.get('content-type')! },
    payload: Buffer.from(await req.arrayBuffer()),
  })
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined }
}

async function setup() {
  const [owner, member, outsider] = [await register(s.app), await register(s.app), await register(s.app)]
  const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: owner.token, body: { name: 'Sons' } })).body
  const inv = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: owner.token, body: {} })).body
  await api(s.app, 'POST', `/invites/${inv.code}`, { token: member.token })
  return { owner, member, outsider, space, voice: space.channels.find((c) => c.type === 'voice')! }
}

let seq = 0
const event = (name: string, channelId: string, identity: string) => ({
  event: name, id: `EV_SB_${++seq}`, createdAt: String(Math.floor(Date.now() / 1000)),
  room: { sid: `RM_${channelId.slice(0, 8)}`, name: `ch_${channelId}` },
  participant: { sid: `PA_SB_${seq}`, identity, name: 'x', joinedAt: String(Math.floor(Date.now() / 1000)) },
})
const enter = (channelId: string, userId: string) => postWebhook(s.app, s.config, event('participant_joined', channelId, userId))
const leave = (channelId: string, userId: string) => postWebhook(s.app, s.config, event('participant_left', channelId, userId))
const play = (token: string, channelId: string, soundId: string) =>
  api(s.app, 'POST', `/channels/${channelId}/soundboard/play`, { token, body: { soundId } })

describe('space sounds CRUD', () => {
  it('managers upload, members list and download, everyone gets SPACE_SOUNDS_UPDATE', async () => {
    const { owner, member, outsider, space } = await setup()
    const gw = await connect(s.port, member.token)
    const up = await upload(s.app, owner.token, space.id, wav(400))
    expect(up.status).toBe(201)
    const sound = up.body as SpaceSound
    expect(sound).toMatchObject({ spaceId: space.id, name: 'Corneta', emoji: '📯', durationMs: 400, createdBy: owner.user.id })
    const ev = await gw.waitFor('SPACE_SOUNDS_UPDATE', (d) => d.spaceId === space.id)
    expect(ev.sounds.map((x) => x.id)).toEqual([sound.id])
    gw.close()

    expect((await api(s.app, 'GET', `/spaces/${space.id}/sounds`, { token: member.token })).body).toEqual([sound])
    const audio = await s.app.inject({ method: 'GET', url: `/api/v1/spaces/${space.id}/sounds/${sound.id}/audio`, headers: { authorization: `Bearer ${member.token}` } })
    expect(audio.statusCode).toBe(200)
    expect(audio.headers['content-type']).toBe('audio/wav')
    expect(audio.headers['cache-control']).toContain('immutable')
    expect(audio.rawPayload.equals(wav(400))).toBe(true)
    const foreign = await s.app.inject({ method: 'GET', url: `/api/v1/spaces/${space.id}/sounds/${sound.id}/audio`, headers: { authorization: `Bearer ${outsider.token}` } })
    expect(foreign.statusCode).toBe(403)
    expect((await api(s.app, 'GET', `/spaces/${space.id}/sounds`, { token: outsider.token })).status).toBe(403)
  })

  it('needs MANAGE_SOUNDBOARD to upload, rename and delete', async () => {
    const { owner, member, space } = await setup()
    expect((await upload(s.app, member.token, space.id, wav())).status).toBe(403)
    const sound = (await upload(s.app, owner.token, space.id, wav())).body as SpaceSound
    expect((await api(s.app, 'PATCH', `/spaces/${space.id}/sounds/${sound.id}`, { token: member.token, body: { name: 'x' } })).status).toBe(403)
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/sounds/${sound.id}`, { token: member.token })).status).toBe(403)
    await s.app.ctx.db.update(roles).set({ permissions: DEFAULT_EVERYONE_PERMISSIONS | Permission.MANAGE_SOUNDBOARD }).where(eq(roles.id, space.id))
    const renamed = await api(s.app, 'PATCH', `/spaces/${space.id}/sounds/${sound.id}`, { token: member.token, body: { name: '  Buzina ', emoji: null } })
    expect(renamed.status).toBe(200)
    expect(renamed.body).toMatchObject({ id: sound.id, name: 'Buzina', emoji: null, durationMs: sound.durationMs })
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/sounds/${sound.id}`, { token: member.token })).status).toBe(204)
    expect((await api(s.app, 'GET', `/spaces/${space.id}/sounds`, { token: owner.token })).body).toEqual([])
    const queued = await s.app.ctx.db.select().from(storageDeletions).where(eq(storageDeletions.key, `sounds/${space.id}/${sound.id}`))
    expect(queued).toHaveLength(1)
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/sounds/${sound.id}`, { token: owner.token })).status).toBe(404)
  })

  it('rejects invalid audio and bad metadata', async () => {
    const { owner, space } = await setup()
    const stereo = wav(); stereo.writeUInt16LE(2, 22)
    expect((await upload(s.app, owner.token, space.id, stereo)).status).toBe(400)
    expect((await upload(s.app, owner.token, space.id, wav(5200))).status).toBe(400)
    expect((await upload(s.app, owner.token, space.id, Buffer.from('<html>not audio</html>'))).status).toBe(400)
    expect((await upload(s.app, owner.token, space.id, wav(), { name: '' })).status).toBe(400)
    expect((await upload(s.app, owner.token, space.id, wav(), { name: 'ok', emoji: 'ab' })).status).toBe(400)
  })

  it(`caps a space at ${MAX_SOUNDS_PER_SPACE} sounds`, async () => {
    const { owner, space } = await setup()
    const small = wav(20)
    const results = await Promise.all(Array.from({ length: MAX_SOUNDS_PER_SPACE + 2 }, () => upload(s.app, owner.token, space.id, small)))
    expect(results.filter((r) => r.status === 201)).toHaveLength(MAX_SOUNDS_PER_SPACE)
    expect(results.filter((r) => r.status === 400)).toHaveLength(2)
    expect((await api(s.app, 'GET', `/spaces/${space.id}/sounds`, { token: owner.token })).body).toHaveLength(MAX_SOUNDS_PER_SPACE)
  })

  it('deleting the space queues every sound object', async () => {
    const { owner, space } = await setup()
    const sound = (await upload(s.app, owner.token, space.id, wav())).body as SpaceSound
    await s.app.ctx.db.delete(spaces).where(eq(spaces.id, space.id))
    const queued = await s.app.ctx.db.select().from(storageDeletions).where(eq(storageDeletions.key, `sounds/${space.id}/${sound.id}`))
    expect(queued).toHaveLength(1)
  })

  it('new spaces give @everyone USE_SOUNDBOARD but not MANAGE_SOUNDBOARD', async () => {
    const { space } = await setup()
    const [everyone] = await s.app.ctx.db.select().from(roles).where(eq(roles.id, space.id))
    expect(everyone!.permissions & Permission.USE_SOUNDBOARD).toBeTruthy()
    expect(everyone!.permissions & Permission.MANAGE_SOUNDBOARD).toBe(0)
  })
})

describe('soundboard play', () => {
  it('fans out only to the users in that voice channel', async () => {
    const { owner, member, space, voice } = await setup()
    const extra = await register(s.app)
    const inv = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: owner.token, body: {} })).body
    await api(s.app, 'POST', `/invites/${inv.code}`, { token: extra.token })
    const sound = (await upload(s.app, owner.token, space.id, wav(300))).body as SpaceSound
    await enter(voice.id, owner.user.id)
    await enter(voice.id, member.user.id)
    const inCall = await connect(s.port, member.token)
    const outside = await connect(s.port, extra.token)
    expect((await play(owner.token, voice.id, sound.id)).status).toBe(204)
    const ev = await inCall.waitFor('SOUNDBOARD_PLAY')
    expect(ev).toMatchObject({ channelId: voice.id, soundId: sound.id, userId: owner.user.id, durationMs: 300 })
    expect(ev.playId).toMatch(/^[0-9a-f-]{36}$/)
    await outside.expectNone('SOUNDBOARD_PLAY')
    inCall.close(); outside.close()
  })

  it('refuses people outside the call, server-muted, without permission, and foreign or unknown sounds', async () => {
    const { owner, member, space, voice } = await setup()
    const sound = (await upload(s.app, owner.token, space.id, wav())).body as SpaceSound
    expect((await play(member.token, voice.id, sound.id)).status).toBe(403) // not in the call
    await enter(voice.id, member.user.id)
    expect((await play(member.token, voice.id, uuidv7())).status).toBe(404)
    expect((await play(member.token, voice.id, 'alga:nao-existe')).status).toBe(404)
    const other = await setup()
    const foreign = (await upload(s.app, other.owner.token, other.space.id, wav())).body as SpaceSound
    expect((await play(member.token, voice.id, foreign.id)).status).toBe(404)

    await s.app.ctx.db.update(roles).set({ permissions: DEFAULT_EVERYONE_PERMISSIONS & ~Permission.USE_SOUNDBOARD }).where(eq(roles.id, space.id))
    expect((await play(member.token, voice.id, sound.id)).status).toBe(403)
    await s.app.ctx.db.update(roles).set({ permissions: DEFAULT_EVERYONE_PERMISSIONS }).where(eq(roles.id, space.id))

    expect((await api(s.app, 'PATCH', `/spaces/${space.id}/members/${member.user.id}/voice`, { token: owner.token, body: { serverMute: true } })).status).toBeLessThan(300)
    expect((await play(member.token, voice.id, sound.id)).status).toBe(403)
    await api(s.app, 'PATCH', `/spaces/${space.id}/members/${member.user.id}/voice`, { token: owner.token, body: { serverMute: false } })

    expect((await play(member.token, voice.id, sound.id)).status).toBe(204)
    await leave(voice.id, member.user.id)
    expect((await play(member.token, voice.id, sound.id)).status).toBe(403)
  })

  it('a second play inside the cooldown is 429 with retryAfterMs', async () => {
    const { owner, space, voice } = await setup()
    const sound = (await upload(s.app, owner.token, space.id, wav(500))).body as SpaceSound
    await enter(voice.id, owner.user.id)
    expect((await play(owner.token, voice.id, sound.id)).status).toBe(204)
    const again = await play(owner.token, voice.id, sound.id)
    expect(again.status).toBe(429)
    expect(again.body.error).toMatchObject({ code: 'rate_limited', reason: 'cooldown' })
    expect(again.body.error.retryAfterMs).toBeGreaterThan(3000)
    expect(again.body.error.retryAfterMs).toBeLessThanOrEqual(3500)
  })
})

describe('SoundboardLimiter', () => {
  const make = () => { let t = 1_000_000; return { clock: { now: () => t, advance: (ms: number) => { t += ms } }, lim: new SoundboardLimiter(() => t) } }

  it('cooldown = end of your sound + 3 s', () => {
    const { clock, lim } = make()
    expect(lim.tryPlay('a', 'c', 1000)).toEqual({ ok: true })
    expect(lim.tryPlay('a', 'c', 1000)).toEqual({ ok: false, reason: 'cooldown', retryAfterMs: 4000 })
    clock.advance(3999)
    expect(lim.tryPlay('a', 'c', 1000)).toEqual({ ok: false, reason: 'cooldown', retryAfterMs: 1 })
    clock.advance(1)
    expect(lim.tryPlay('a', 'c', 1000)).toEqual({ ok: true })
  })

  it('at most 3 sounds at once in a channel', () => {
    const { clock, lim } = make()
    for (const u of ['a', 'b', 'c']) expect(lim.tryPlay(u, 'ch', 2000).ok).toBe(true)
    clock.advance(500)
    expect(lim.tryPlay('d', 'ch', 2000)).toEqual({ ok: false, reason: 'channel_busy', retryAfterMs: 1500 })
    expect(lim.tryPlay('e', 'other', 2000).ok).toBe(true)
    clock.advance(1500)
    expect(lim.tryPlay('d', 'ch', 2000).ok).toBe(true)
  })

  it('at most 10 plays per minute per person', () => {
    const { clock, lim } = make()
    for (let i = 0; i < 10; i++) {
      expect(lim.tryPlay('a', 'c', 10).ok).toBe(true)
      clock.advance(3010)
    }
    const r = lim.tryPlay('a', 'c', 10)
    expect(r).toMatchObject({ ok: false, reason: 'burst' })
    clock.advance(60_000)
    expect(lim.tryPlay('a', 'c', 10).ok).toBe(true)
  })

  it('forgets idle users and channels', () => {
    const { clock, lim } = make()
    for (let i = 0; i < 50; i++) lim.tryPlay(`u${i}`, `c${i}`, 100)
    clock.advance(120_000)
    lim.tryPlay('x', 'y', 100)
    expect(lim.size()).toBeLessThanOrEqual(2)
  })
})
