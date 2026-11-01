/**
 * Regression tests for docs/security/server-review-2026-11-01.md (one describe per finding).
 * Each test reproduces the reviewer's PoC and asserts the fixed behaviour.
 */
import { DEFAULT_EVERYONE_PERMISSIONS, GatewayClose, Permission, type Invite, type SpaceSnapshot, type VoiceJoinResponse } from '@alga/shared'
import { TokenVerifier } from 'livekit-server-sdk'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { loadConfig } from '../src/config.js'
import { roles, sessions } from '../src/db/schema.js'
import { api, connect, freshIp, openGateway, postWebhook, register, startServer, type TestServer } from './helpers.js'

let s: TestServer
beforeAll(async () => { s = await startServer() })
afterAll(async () => { await s.close() })

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Space owned by `owner` with every other token joined through an invite. */
async function spaceWith(owner: string, ...others: string[]) {
  const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: owner, body: { name: 'sec' } })).body
  const invite = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: owner, body: {} })).body
  for (const t of others) expect((await api(s.app, 'POST', `/invites/${invite.code}`, { token: t })).status).toBe(200)
  return {
    space, invite,
    voice: space.channels.find((c) => c.type === 'voice')!,
    text: space.channels.find((c) => c.type === 'text')!,
  }
}

let evSeq = 0
const lkEvent = (event: string, channelId: string, identity: string) => ({
  event, id: `SEC_${++evSeq}`, room: { name: `ch_${channelId}` }, participant: { identity },
})

/** Records LiveKit RoomService calls instead of hitting the (absent) SFU. */
function spyRooms() {
  const rooms = (s.app.ctx.voice as unknown as { rooms: Record<string, (...a: unknown[]) => Promise<unknown>> }).rooms
  return {
    remove: vi.spyOn(rooms, 'removeParticipant' as never).mockResolvedValue(undefined as never),
    restore: () => vi.restoreAllMocks(),
  }
}

const PROD = { NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db:5432/alga', CORS_ORIGINS: 'null,file://' }
const REAL_SECRET = 'a-real-production-secret-0123456789abcdef'

describe('A1 trusted proxy + login limits', () => {
  it('refuses TRUST_PROXY=true (trusts any X-Forwarded-For) and accepts hop counts / proxy lists', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/)
    expect(loadConfig({ NODE_ENV: 'test', TRUST_PROXY: '1' }).trustProxy).toBe(1)
    expect(loadConfig({ NODE_ENV: 'test', TRUST_PROXY: '10.0.0.0/8, 127.0.0.1' }).trustProxy).toEqual(['10.0.0.0/8', '127.0.0.1'])
    expect(loadConfig({ NODE_ENV: 'test' }).trustProxy).toBe(false)
  })

  it('with one trusted hop a spoofed X-Forwarded-For does not reset the per-IP limit', async () => {
    const proxied = await startServer({ TRUST_PROXY: '1' })
    try {
      const codes: number[] = []
      for (let i = 0; i < 12; i++) {
        codes.push((await api(proxied.app, 'POST', '/auth/login', {
          ip: '10.0.0.1', // the proxy
          headers: { 'x-forwarded-for': `9.9.${i}.1, 198.51.100.7` }, // client-chosen value, then the proxy's own append
          body: { login: `ghost${i}`, password: 'x' },
        })).status)
      }
      expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true)
      expect(codes[10]).toBe(429)
      // Another client behind the same proxy is not affected.
      expect((await api(proxied.app, 'POST', '/auth/login', {
        ip: '10.0.0.1', headers: { 'x-forwarded-for': '198.51.100.8' }, body: { login: 'ghost', password: 'x' },
      })).status).toBe(401)
    } finally {
      await proxied.close()
    }
  })

  it('limits failed logins per account across IPs, without locking other accounts', async () => {
    const victim = await register(s.app)
    const other = await register(s.app)
    const codes: number[] = []
    for (let i = 0; i < 11; i++) {
      codes.push((await api(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: victim.user.username, password: `guess-${i}` } })).status)
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true)
    expect(codes[10]).toBe(429)
    // Same account by e-mail is the same counter; even the right password waits (no oracle while limited).
    expect((await api(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: victim.user.email, password: victim.password } })).status).toBe(429)
    expect((await api(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: other.user.username, password: other.password } })).status).toBe(200)
  })
})

describe('M1/B11 configuration fails closed', () => {
  it('without NODE_ENV the server is production: DATABASE_URL, a real LiveKit key/secret and CORS_ORIGINS are required', () => {
    expect(() => loadConfig({ DATABASE_URL: PROD.DATABASE_URL, HOST: '0.0.0.0', PGLITE_DIR: 'memory://' })).toThrow(/LIVEKIT_API_SECRET/)
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({ ...PROD, LIVEKIT_API_SECRET: REAL_SECRET })).toThrow(/LIVEKIT_API_KEY/)
    expect(() => loadConfig({ ...PROD, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: REAL_SECRET })).toThrow(/LIVEKIT_API_KEY/)
    expect(() => loadConfig({ ...PROD, CORS_ORIGINS: undefined, LIVEKIT_API_KEY: 'prodkey', LIVEKIT_API_SECRET: REAL_SECRET })).toThrow(/CORS_ORIGINS/)
    const ok = loadConfig({ ...PROD, LIVEKIT_API_KEY: 'prodkey', LIVEKIT_API_SECRET: REAL_SECRET })
    expect(ok).toMatchObject({ env: 'production', corsOrigins: ['null', 'file://'], livekit: { apiKey: 'prodkey', apiSecret: REAL_SECRET } })
  })

  it('dev values need NODE_ENV=development on a loopback host, or ALGA_ALLOW_DEV_SECRETS=1', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).livekit.apiKey).toBe('devkey')
    expect(() => loadConfig({ NODE_ENV: 'development', HOST: '0.0.0.0' })).toThrow(/LIVEKIT_API_SECRET/)
    expect(loadConfig({ NODE_ENV: 'development', HOST: '0.0.0.0', ALGA_ALLOW_DEV_SECRETS: '1' }).livekit.apiKey).toBe('devkey')
    expect(loadConfig({ ...PROD, ALGA_ALLOW_DEV_SECRETS: '1' }).livekit.apiKey).toBe('devkey')
  })
})

describe('M10/A2 write routes are rate limited per user', () => {
  it('friend requests, profile updates and the public invite preview have limits', async () => {
    const a = await register(s.app)
    const codes: number[] = []
    for (let i = 0; i < 11; i++) {
      codes.push((await api(s.app, 'POST', '/relationships', { token: a.token, body: { username: `nobody${i}` } })).status)
    }
    expect(codes.slice(0, 10).every((c) => c === 400)).toBe(true)
    expect(codes[10]).toBe(429)

    const names: number[] = []
    for (let i = 0; i < 11; i++) {
      names.push((await api(s.app, 'PATCH', '/users/@me', { token: a.token, body: { displayName: `n${i}` } })).status)
    }
    expect(names[10]).toBe(429)

    const ip = freshIp()
    const previews: number[] = []
    for (let i = 0; i < 31; i++) previews.push((await api(s.app, 'GET', '/invites/AAAAAAAA', { ip })).status)
    expect(previews[30]).toBe(429)
  })

  it('a generic per-user ceiling covers every authenticated route', async () => {
    const a = await register(s.app)
    let last = 0
    for (let i = 0; i < 201 && last !== 429; i++) last = (await api(s.app, 'GET', '/users/@me', { token: a.token })).status
    expect(last).toBe(429)
    // Other users are unaffected.
    const b = await register(s.app)
    expect((await api(s.app, 'GET', '/users/@me', { token: b.token })).status).toBe(200)
  })
})

describe('A2/M3 gateway throttling and limits', () => {
  it('presence spam collapses to at most one fan-out per second and the flooder is closed with 4008', async () => {
    const [a, b] = [await register(s.app), await register(s.app)]
    await spaceWith(a.token, b.token)
    const ga = await connect(s.port, a.token)
    const gb = await connect(s.port, b.token)
    for (let i = 0; i < 200; i++) ga.send({ op: 'presence', status: i % 2 ? 'online' : 'dnd' })
    expect((await ga.closed).code).toBe(GatewayClose.RATE_LIMITED)
    await sleep(1500)
    const n = gb.events.filter((e) => e.t === 'PRESENCE_UPDATE' && e.d.userId === a.user.id).length
    expect(n).toBeLessThanOrEqual(3)
    gb.close()
  })

  it('voice_state: unchanged flags send nothing, bursts collapse to the latest value', async () => {
    const [a, b] = [await register(s.app), await register(s.app)]
    const { voice } = await spaceWith(a.token, b.token)
    const ga = await connect(s.port, a.token)
    const gb = await connect(s.port, b.token)
    await postWebhook(s.app, s.config, lkEvent('participant_joined', voice.id, a.user.id))
    await gb.waitFor('VOICE_STATE_UPDATE', (v) => v.userId === a.user.id)
    gb.events.length = 0
    ga.send({ op: 'voice_state', selfMute: false, selfDeaf: false, streaming: false, video: false })
    await gb.expectNone('VOICE_STATE_UPDATE', () => true, 1200)
    for (let i = 0; i < 10; i++) ga.send({ op: 'voice_state', selfMute: i % 2 === 0, selfDeaf: false, streaming: false, video: false })
    await sleep(1500)
    const updates = gb.events.filter((e) => e.t === 'VOICE_STATE_UPDATE')
    expect(updates.length).toBeLessThanOrEqual(2)
    expect(updates.at(-1)!.d).toMatchObject({ selfMute: false }) // i = 9 → the last frame wins
    ga.close()
    gb.close()
  })

  it('caps sockets per user', async () => {
    const a = await register(s.app)
    const socks = []
    for (let i = 0; i < 10; i++) socks.push(await connect(s.port, a.token))
    const extra = await openGateway(s.port)
    extra.send({ op: 'identify', token: a.token })
    expect((await extra.closed).code).toBe(GatewayClose.RATE_LIMITED)
    for (const g of socks) g.close()
  })

  it('unidentified sockets are dropped after 10 s even with a long heartbeat interval', async () => {
    const idle = await openGateway(s.port)
    const started = Date.now()
    expect((await idle.closed).code).toBe(GatewayClose.HEARTBEAT_TIMEOUT)
    expect(Date.now() - started).toBeLessThan(12_000)
  }, 15_000)
})

describe('M2 sessions expire and can all be revoked', () => {
  const DAY = 24 * 60 * 60 * 1000

  it('rejects sessions idle for 30 days or older than 90 days', async () => {
    const idle = await register(s.app)
    const old = await register(s.app)
    await s.app.ctx.db.update(sessions).set({ lastUsedAt: new Date(Date.now() - 31 * DAY) }).where(eq(sessions.userId, idle.user.id))
    await s.app.ctx.db.update(sessions).set({ createdAt: new Date(Date.now() - 91 * DAY) }).where(eq(sessions.userId, old.user.id))
    expect((await api(s.app, 'GET', '/users/@me', { token: idle.token })).status).toBe(401)
    expect((await api(s.app, 'GET', '/users/@me', { token: old.token })).status).toBe(401)
    expect(await s.app.ctx.db.select().from(sessions).where(eq(sessions.userId, old.user.id))).toEqual([])
  })

  it('POST /auth/password checks the current password and revokes every other session', async () => {
    const a = await register(s.app)
    const other = (await api(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: a.user.username, password: a.password } })).body.token as string
    const gw = await connect(s.port, other)
    const wrong = await api(s.app, 'POST', '/auth/password', { token: a.token, body: { currentPassword: 'nope-nope', newPassword: 'brand new password' } })
    expect(wrong.status).toBe(400)
    expect(wrong.body.error.fields.currentPassword).toBeDefined()
    expect((await api(s.app, 'POST', '/auth/password', { token: a.token, body: { currentPassword: a.password, newPassword: 'brand new password' } })).status).toBe(204)
    expect((await gw.closed).code).toBe(GatewayClose.SESSION_REVOKED)
    expect((await api(s.app, 'GET', '/users/@me', { token: other })).status).toBe(401)
    expect((await api(s.app, 'GET', '/users/@me', { token: a.token })).status).toBe(200)
    expect((await api(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: a.user.username, password: a.password } })).status).toBe(401)
    expect((await api(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: a.user.username, password: 'brand new password' } })).status).toBe(200)
  })

  it('DELETE /auth/sessions revokes all but the current session', async () => {
    const a = await register(s.app)
    const t2 = (await api(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: a.user.username, password: a.password } })).body.token as string
    expect((await api(s.app, 'DELETE', '/auth/sessions', { token: a.token })).status).toBe(204)
    expect((await api(s.app, 'GET', '/users/@me', { token: t2 })).status).toBe(401)
    expect((await api(s.app, 'GET', '/auth/sessions', { token: a.token })).body).toHaveLength(1)
  })

  it('logging out of the last session drops voice, and the old LiveKit token cannot rejoin', async () => {
    const [a, b] = [await register(s.app), await register(s.app)]
    const { voice } = await spaceWith(a.token, b.token)
    const ga = await connect(s.port, a.token)
    await postWebhook(s.app, s.config, lkEvent('participant_joined', voice.id, b.user.id))
    await ga.waitFor('VOICE_STATE_UPDATE', (v) => v.userId === b.user.id)
    expect((await api(s.app, 'POST', '/auth/logout', { token: b.token })).status).toBe(204)
    await ga.waitFor('VOICE_STATE_REMOVE', (d) => d.userId === b.user.id)
    await postWebhook(s.app, s.config, lkEvent('participant_joined', voice.id, b.user.id))
    expect(s.app.ctx.voice.inChannel(voice.id)).toEqual([])
    ga.close()
  })
})

describe('M4/B1/B7/B8/B9 voice', () => {
  it('M4: userLimit is enforced when the participant actually joins, not only when the token is minted', async () => {
    const [a, b, c] = [await register(s.app), await register(s.app), await register(s.app)]
    const { voice } = await spaceWith(a.token, b.token, c.token)
    await api(s.app, 'PATCH', `/channels/${voice.id}`, { token: a.token, body: { userLimit: 1 } })
    // Both tokens are minted while the room is still empty (the TOCTOU window).
    expect((await api(s.app, 'POST', '/voice/join', { token: b.token, body: { channelId: voice.id } })).status).toBe(200)
    expect((await api(s.app, 'POST', '/voice/join', { token: c.token, body: { channelId: voice.id } })).status).toBe(200)
    const gc = await connect(s.port, c.token)
    const spy = spyRooms()
    try {
      await Promise.all([b, c].map((u) => postWebhook(s.app, s.config, lkEvent('participant_joined', voice.id, u.user.id))))
      expect(s.app.ctx.voice.inChannel(voice.id)).toHaveLength(1)
      const [loser] = [b, c].filter((u) => !s.app.ctx.voice.inChannel(voice.id).some((v) => v.userId === u.user.id))
      expect(spy.remove).toHaveBeenCalledWith(`ch_${voice.id}`, loser!.user.id)
      if (loser === c) expect(await gc.waitFor('VOICE_DISCONNECT')).toEqual({ channelId: voice.id, reason: 'channel_full' })
      // MOVE_MEMBERS (the owner) bypasses the limit.
      await postWebhook(s.app, s.config, lkEvent('participant_joined', voice.id, a.user.id))
      expect(s.app.ctx.voice.inChannel(voice.id)).toHaveLength(2)
    } finally {
      spy.restore()
      gc.close()
    }
  })

  it('B1: a participant re-entering the room of a deleted channel is removed from the SFU', async () => {
    const [a, b] = [await register(s.app), await register(s.app)]
    const { voice } = await spaceWith(a.token, b.token)
    expect((await api(s.app, 'DELETE', `/channels/${voice.id}`, { token: a.token })).status).toBe(204)
    const spy = spyRooms()
    try {
      await postWebhook(s.app, s.config, lkEvent('participant_joined', voice.id, b.user.id))
      expect(spy.remove).toHaveBeenCalledWith(`ch_${voice.id}`, b.user.id)
    } finally {
      spy.restore()
    }
  })

  it('B7: voice tokens cannot publish on the data channel', async () => {
    const [a] = [await register(s.app)]
    const { voice } = await spaceWith(a.token)
    const res = await api<VoiceJoinResponse>(s.app, 'POST', '/voice/join', { token: a.token, body: { channelId: voice.id } })
    const claims = await new TokenVerifier(s.config.livekit.apiKey, s.config.livekit.apiSecret).verify(res.body.token)
    expect(claims.video!.canPublishData).toBe(false)
  })

  it('B8: streaming/video flags need STREAM/SPEAK', async () => {
    const [a, b] = [await register(s.app), await register(s.app)]
    const { voice, space } = await spaceWith(a.token, b.token)
    await s.app.ctx.db.update(roles).set({ permissions: DEFAULT_EVERYONE_PERMISSIONS & ~(Permission.STREAM | Permission.SPEAK) }).where(eq(roles.id, space.id))
    const ga = await connect(s.port, a.token)
    const gb = await connect(s.port, b.token)
    await postWebhook(s.app, s.config, lkEvent('participant_joined', voice.id, b.user.id))
    await ga.waitFor('VOICE_STATE_UPDATE', (v) => v.userId === b.user.id)
    gb.send({ op: 'voice_state', selfMute: true, selfDeaf: false, streaming: true, video: true })
    const st = await ga.waitFor('VOICE_STATE_UPDATE', (v) => v.userId === b.user.id && v.selfMute)
    expect(st).toMatchObject({ streaming: false, video: false })
    ga.close()
    gb.close()
  })

  it('B9: a replayed webhook (same event id) is ignored', async () => {
    const [a] = [await register(s.app)]
    const { voice } = await spaceWith(a.token)
    const left = lkEvent('participant_left', voice.id, a.user.id)
    await postWebhook(s.app, s.config, lkEvent('participant_joined', voice.id, a.user.id))
    await postWebhook(s.app, s.config, left)
    await postWebhook(s.app, s.config, lkEvent('participant_joined', voice.id, a.user.id))
    expect((await postWebhook(s.app, s.config, left)).status).toBe(200)
    expect(s.app.ctx.voice.inChannel(voice.id).map((v) => v.userId)).toEqual([a.user.id])
  })
})
