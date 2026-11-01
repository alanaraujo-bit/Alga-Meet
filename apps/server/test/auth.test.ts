import { GatewayClose, type Session } from '@alga/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sessions, users } from '../src/db/schema.js'
import { api, connect, freshIp, openGateway, register, startServer, type TestServer } from './helpers.js'

let s: TestServer
beforeAll(async () => { s = await startServer() })
afterAll(async () => { await s.close() })

describe('auth', () => {
  it('registers, stores argon2id + only the token hash, and serves /users/@me', async () => {
    const { token, user } = await register(s.app, 'alice')
    expect(user).toMatchObject({ username: 'alice', displayName: 'ALICE', email: 'alice@example.com', statusPreference: 'online' })
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/) // 32 bytes base64url

    const [row] = await s.app.ctx.db.select().from(users)
    expect(row!.passwordHash.startsWith('$argon2id$')).toBe(true)
    const stored = await s.app.ctx.db.select().from(sessions)
    expect(stored.some((r) => r.tokenHash === token)).toBe(false)
    expect(stored[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/)

    const me = await api(s.app, 'GET', '/users/@me', { token })
    expect(me.status).toBe(200)
    expect(me.body.id).toBe(user.id)
    expect(me.body.passwordHash).toBeUndefined()
  })

  it('rejects a taken username (only) with a field error and bad bodies with validation fields', async () => {
    await register(s.app, 'bob')
    const dup = await api(s.app, 'POST', '/auth/register', {
      ip: freshIp(), body: { email: 'BOB@example.com', username: 'bob', password: 'a fine long passphrase' },
    })
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('conflict')
    // B5: the e-mail is never reported (email.test.ts covers what happens instead).
    expect(dup.body.error.fields).toEqual({ username: expect.any(String) })

    const bad = await api(s.app, 'POST', '/auth/register', {
      ip: freshIp(), body: { email: 'nope', username: 'x y', password: 'short' },
    })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('validation')
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['email', 'password', 'username'])
  })

  it('logs in by email or username; failures do not reveal which part was wrong', async () => {
    const { password } = await register(s.app, 'carol')
    const byName = await api(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: 'CAROL', password } })
    expect(byName.status).toBe(200)
    expect(byName.body.user.username).toBe('carol')
    const byEmail = await api(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: 'carol@example.com', password } })
    expect(byEmail.status).toBe(200)

    const wrongPass = await api(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: 'carol', password: 'nope-nope' } })
    const noUser = await api(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: 'ghost', password: 'nope-nope' } })
    expect(wrongPass.status).toBe(401)
    expect(noUser.status).toBe(401)
    expect(wrongPass.body).toEqual(noUser.body)
  })

  it('rate limits auth routes per IP', async () => {
    const ip = freshIp()
    const codes: number[] = []
    for (let i = 0; i < 10; i++) {
      // Distinct logins: this is the per-IP limit, not the per-account one (security.test.ts).
      codes.push((await api(s.app, 'POST', '/auth/login', { ip, body: { login: `ghost-ip${i}`, password: 'x' } })).status)
    }
    expect(codes.every((c) => c === 401)).toBe(true)
    const limited = await api(s.app, 'POST', '/auth/login', { ip, body: { login: 'ghost-ip-last', password: 'x' } })
    expect(limited.status).toBe(429)
    expect(limited.body.error.code).toBe('rate_limited')
  })

  it('requires a valid bearer token', async () => {
    expect((await api(s.app, 'GET', '/users/@me')).status).toBe(401)
    const r = await api(s.app, 'GET', '/users/@me', { token: 'not-a-token' })
    expect(r.status).toBe(401)
    expect(r.body.error.code).toBe('unauthorized')
  })

  it('lists sessions, revokes one (closing its sockets with 4004) and logs out', async () => {
    const first = await register(s.app, 'dave')
    const second = await api(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: 'dave', password: first.password } })
    const t2 = second.body.token as string

    const list = await api<Session[]>(s.app, 'GET', '/auth/sessions', { token: first.token })
    expect(list.body).toHaveLength(2)
    expect(list.body.filter((x) => x.current)).toHaveLength(1)
    const other = list.body.find((x) => !x.current)!

    const gw = await connect(s.port, t2)
    expect((await api(s.app, 'DELETE', `/auth/sessions/${other.id}`, { token: first.token })).status).toBe(204)
    expect((await gw.closed).code).toBe(GatewayClose.SESSION_REVOKED)
    expect((await api(s.app, 'GET', '/users/@me', { token: t2 })).status).toBe(401)
    expect((await api(s.app, 'DELETE', `/auth/sessions/${other.id}`, { token: first.token })).status).toBe(404)

    const gw1 = await connect(s.port, first.token)
    expect((await api(s.app, 'POST', '/auth/logout', { token: first.token })).status).toBe(204)
    expect((await gw1.closed).code).toBe(GatewayClose.SESSION_REVOKED)
    expect((await api(s.app, 'GET', '/users/@me', { token: first.token })).status).toBe(401)
  })

  it('cannot revoke another user\'s session', async () => {
    const a = await register(s.app)
    const b = await register(s.app)
    const bs = await api<Session[]>(s.app, 'GET', '/auth/sessions', { token: b.token })
    expect((await api(s.app, 'DELETE', `/auth/sessions/${bs.body[0]!.id}`, { token: a.token })).status).toBe(404)
  })
})

describe('gateway handshake', () => {
  it('closes with 4001 on a bad token and 4003 on garbage', async () => {
    const bad = await openGateway(s.port)
    bad.send({ op: 'identify', token: 'nope' })
    expect((await bad.closed).code).toBe(GatewayClose.AUTH_FAILED)

    const garbage = await openGateway(s.port)
    garbage.ws.send('not json')
    expect((await garbage.closed).code).toBe(GatewayClose.INVALID_PAYLOAD)

    const early = await openGateway(s.port)
    early.send({ op: 'heartbeat' })
    expect((await early.closed).code).toBe(GatewayClose.INVALID_PAYLOAD)
  })

  it('acks heartbeats and sends READY with the configured interval', async () => {
    const { token, user } = await register(s.app)
    const gw = await connect(s.port, token)
    const ready = await gw.waitFor('READY')
    expect(ready.user.id).toBe(user.id)
    expect(ready.heartbeatIntervalMs).toBe(30_000)
    expect(ready).toMatchObject({ spaces: [], privateChannels: [], relationships: [], voiceStates: [], readStates: [], users: [] })
    const ack = new Promise((resolve) => gw.ws.once('message', (raw) => resolve(JSON.parse(raw.toString()))))
    gw.send({ op: 'heartbeat' })
    expect(await ack).toEqual({ op: 'heartbeat_ack' })
    gw.close()
  })
})

describe('heartbeat timeout', () => {
  it('closes with 4002 when no frame arrives for two intervals', async () => {
    const fast = await startServer({ HEARTBEAT_INTERVAL_MS: '1000' })
    try {
      const { token } = await register(fast.app)
      const gw = await connect(fast.port, token)
      const started = Date.now()
      expect((await gw.closed).code).toBe(GatewayClose.HEARTBEAT_TIMEOUT)
      expect(Date.now() - started).toBeGreaterThanOrEqual(1500)
    } finally {
      await fast.close()
    }
  })
})

describe('health', () => {
  it('reports ok + version on both paths', async () => {
    const root = await s.app.inject({ method: 'GET', url: '/health' })
    expect(root.json()).toEqual({ ok: true, version: s.config.version })
    expect((await api(s.app, 'GET', '/health')).body.ok).toBe(true)
  })

  it('answers unknown routes with the ApiError shape', async () => {
    const r = await api(s.app, 'GET', '/nope')
    expect(r.status).toBe(404)
    expect(r.body).toEqual({ error: { code: 'not_found', message: expect.any(String) } })
  })

  it('allows the Electron renderer origins via CORS', async () => {
    for (const origin of ['http://localhost:5173', 'null', 'file://']) {
      const r = await s.app.inject({
        method: 'OPTIONS', url: '/api/v1/users/@me',
        headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
      })
      expect(r.statusCode).toBe(204)
      expect(r.headers['access-control-allow-origin']).toBe(origin)
    }
    const evil = await s.app.inject({
      method: 'OPTIONS', url: '/api/v1/users/@me',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    })
    expect(evil.headers['access-control-allow-origin']).toBeUndefined()
  })
})
