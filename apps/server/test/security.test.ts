/**
 * Regression tests for docs/security/server-review-2026-11-01.md (one describe per finding).
 * Each test reproduces the reviewer's PoC and asserts the fixed behaviour.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { api, freshIp, register, startServer, type TestServer } from './helpers.js'

let s: TestServer
beforeAll(async () => { s = await startServer() })
afterAll(async () => { await s.close() })

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
