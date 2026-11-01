import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { CallQualityReport, Me, SpaceSnapshot } from '@alga/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { callQualityReports, users } from '../src/db/schema.js'
import { Registry } from '../src/metrics.js'
import { logUserHash } from '../src/observability.js'
import { api, connect, freshDatabaseUrl, onRealPostgres, postWebhook, register, startServer, type TestServer } from './helpers.js'

let s: TestServer
beforeAll(async () => { s = await startServer() })
afterAll(async () => { await s.close() })

const scrape = async (headers: Record<string, string> = {}, app = s.app) => (await app.inject({ method: 'GET', url: '/metrics', headers })).body
/** Value of the sample `name{labels}` (labels sorted, as rendered), 0 when the series does not exist yet. */
function sample(text: string, name: string, labels: Record<string, string> = {}): number {
  const l = Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}="${v}"`).join(',')
  const prefix = l ? `${name}{${l}} ` : `${name} `
  const line = text.split('\n').find((x) => x.startsWith(prefix))
  return line === undefined ? 0 : Number(line.slice(prefix.length))
}

describe('prometheus exposition', () => {
  it('renders counters, gauges and cumulative histograms in text format 0.0.4, escaping label values', () => {
    const r = new Registry()
    const c = r.counter('t_requests_total', 'Requests.\nSecond line')
    c.inc({ route: '/a', method: 'GET' })
    c.inc({ method: 'GET', route: '/a' }, 2) // same series whatever the key order
    c.inc({ route: 'q"uote\\back\nnl' })
    const g = r.gauge('t_open', 'Open things.')
    g.set({}, 3)
    const h = r.histogram('t_seconds', 'Latency.', [0.5, 0.01])
    for (const v of [0.003, 0.2, 7]) h.observe({ k: 'v' }, v)
    expect(r.render()).toBe([
      '# HELP t_requests_total Requests.\\nSecond line',
      '# TYPE t_requests_total counter',
      't_requests_total{method="GET",route="/a"} 3',
      't_requests_total{route="q\\"uote\\\\back\\nnl"} 1',
      '# HELP t_open Open things.',
      '# TYPE t_open gauge',
      't_open 3',
      '# HELP t_seconds Latency.',
      '# TYPE t_seconds histogram',
      't_seconds_bucket{k="v",le="0.01"} 1',
      't_seconds_bucket{k="v",le="0.5"} 2',
      't_seconds_bucket{k="v",le="+Inf"} 3',
      't_seconds_sum{k="v"} 7.203',
      't_seconds_count{k="v"} 3',
      '',
    ].join('\n'))
    g.reset()
    expect(r.render()).toContain('# TYPE t_open gauge\n# HELP t_seconds')
    expect(() => r.counter('t_open', 'again')).toThrow(/duplicate/)
  })

  it('log uid is a stable keyed hash, never the id', () => {
    const a = logUserHash('k'.repeat(32), '0190f000-0000-7000-8000-00000000000a')
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(logUserHash('k'.repeat(32), '0190f000-0000-7000-8000-00000000000a')).toBe(a)
    expect(logUserHash('k'.repeat(32), '0190f000-0000-7000-8000-00000000000b')).not.toBe(a)
    expect(logUserHash('j'.repeat(32), '0190f000-0000-7000-8000-00000000000a')).not.toBe(a)
  })
})

describe('/metrics access', () => {
  it('open in dev/test without a token, Bearer METRICS_TOKEN when set, off in production without one', async () => {
    const open = await s.app.inject({ method: 'GET', url: '/metrics' })
    expect(open.statusCode).toBe(200)
    expect(open.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8')
    expect(open.body).toContain('# TYPE alga_http_requests_total counter')

    const token = 'm'.repeat(40)
    const t = await startServer({ METRICS_TOKEN: token })
    try {
      const none = await t.app.inject({ method: 'GET', url: '/metrics' })
      expect(none.statusCode).toBe(401)
      expect(none.headers['www-authenticate']).toBe('Bearer')
      expect((await t.app.inject({ method: 'GET', url: '/metrics', headers: { authorization: `Bearer ${'x'.repeat(40)}` } })).statusCode).toBe(401)
      expect((await t.app.inject({ method: 'GET', url: '/metrics', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200)
    } finally {
      await t.close()
    }

    const databaseUrl = await freshDatabaseUrl()
    const prod = await buildApp({
      ...s.config, env: 'production', metricsToken: undefined, databaseUrl, pgliteDir: 'memory://',
      billing: { ...s.config.billing, provider: 'none' },
    })
    try {
      expect((await prod.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(404)
      expect((await prod.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200)
    } finally {
      await prod.close()
    }
  })
})

describe('health and readiness', () => {
  it('/health is liveness; /ready checks the database and LiveKit (root and /api/v1)', async () => {
    expect((await s.app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ ok: true, version: s.config.version })
    // Test servers point LiveKit at a closed port.
    for (const url of ['/ready', '/api/v1/ready']) {
      const down = await s.app.inject({ method: 'GET', url })
      expect(down.statusCode).toBe(503)
      expect(down.json()).toEqual({ ok: false, checks: { database: 'ok', livekit: 'fail' } })
    }
    const fake = createServer((_req, res) => res.end('OK'))
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve))
    const original = s.config.livekit.url
    s.config.livekit.url = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`
    try {
      const up = await s.app.inject({ method: 'GET', url: '/ready' })
      expect(up.statusCode).toBe(200)
      expect(up.json()).toEqual({ ok: true, checks: { database: 'ok', livekit: 'ok' } })
    } finally {
      s.config.livekit.url = original
      await new Promise((resolve) => fake.close(resolve))
    }
  })
})

describe('instrumentation', () => {
  it('counts HTTP by route template, gateway, DB, voice, webhooks, rate limits, e-mail and billing outcomes', async () => {
    const before = await scrape()
    const u = await register(s.app) // sends the verification e-mail (console driver)
    const http = { method: 'GET', route: '/api/v1/users/@me', status_class: '2xx' }
    await api(s.app, 'GET', '/users/@me', { token: u.token })
    await api(s.app, 'GET', '/nope')
    const gw = await connect(s.port, u.token)
    const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: u.token, body: { name: 'Métricas' } })).body
    await gw.waitFor('SPACE_CREATE')
    const voice = space.channels.find((c) => c.type === 'voice')!
    expect((await api(s.app, 'POST', '/voice/join', { token: u.token, body: { channelId: voice.id } })).status).toBe(200)
    const joined = {
      event: 'participant_joined', id: `EV_obs_${Date.now()}`, createdAt: String(Math.floor(Date.now() / 1000)),
      room: { sid: 'RM_obs', name: `ch_${voice.id}` },
      participant: { sid: 'PA_obs', identity: u.user.id, name: 'x', joinedAt: String(Math.floor(Date.now() / 1000)) },
    }
    expect((await postWebhook(s.app, s.config, joined)).status).toBe(200)
    expect((await postWebhook(s.app, s.config, joined, 'not-the-livekit-secret-0123456789abcdef')).status).toBe(401)
    expect((await s.app.inject({ method: 'POST', url: '/api/v1/billing/webhooks/sandbox', headers: { 'content-type': 'application/json' }, payload: '{}' })).statusCode).toBe(401)
    expect((await s.app.inject({ method: 'POST', url: '/api/v1/billing/webhooks/stripe', headers: { 'content-type': 'application/json' }, payload: '{}' })).statusCode).toBe(404)
    let limited = 0
    for (let i = 0; i < 11; i++) if ((await api(s.app, 'PATCH', '/users/@me', { token: u.token, body: {} })).status === 429) limited++
    expect(limited).toBe(1)

    await vi.waitFor(async () => {
      expect(sample(await scrape(), 'alga_email_sent_total', { kind: 'verify_email' })).toBe(sample(before, 'alga_email_sent_total', { kind: 'verify_email' }) + 1)
    })
    const after = await scrape()
    const delta = (name: string, labels: Record<string, string> = {}) => sample(after, name, labels) - sample(before, name, labels)
    expect(delta('alga_http_requests_total', http)).toBe(1)
    expect(delta('alga_http_request_duration_seconds_count', http)).toBe(1)
    expect(delta('alga_http_requests_total', { method: 'GET', route: 'unmatched', status_class: '4xx' })).toBe(1)
    expect(delta('alga_db_query_duration_seconds_count', { driver: onRealPostgres() ? 'postgres' : 'pglite', op: 'select' })).toBeGreaterThan(5)
    expect(sample(after, 'alga_gateway_connections')).toBeGreaterThanOrEqual(1)
    expect(delta('alga_gateway_ready_seconds_count')).toBe(1)
    expect(delta('alga_gateway_dispatches_total', { type: 'SPACE_CREATE' })).toBe(1)
    expect(delta('alga_gateway_frames_sent_total', { type: 'VOICE_STATE_UPDATE' })).toBe(1)
    expect(delta('alga_voice_tokens_issued_total', { kind: 'space' })).toBe(1)
    expect(delta('alga_voice_joins_total', { result: 'joined' })).toBe(1)
    expect(sample(after, 'alga_voice_participants')).toBeGreaterThanOrEqual(1)
    expect(sample(after, 'alga_voice_rooms')).toBeGreaterThanOrEqual(1)
    expect(delta('alga_livekit_webhook_duration_seconds_count', { event: 'participant_joined' })).toBe(1)
    expect(delta('alga_livekit_webhook_failures_total', { reason: 'signature' })).toBe(1)
    expect(delta('alga_billing_webhooks_total', { provider: 'sandbox', outcome: 'rejected' })).toBe(1)
    expect(delta('alga_billing_webhooks_total', { provider: 'other', outcome: 'unknown_provider' })).toBe(1)
    expect(delta('alga_rate_limited_total', { route: '/api/v1/users/@me' })).toBe(1)
    expect(sample(after, 'alga_build_info', { version: s.config.version })).toBe(1)
    expect(sample(after, 'process_resident_memory_bytes')).toBeGreaterThan(0)
    expect(after).toMatch(/^nodejs_eventloop_lag_seconds\{stat="p99"\} \d/m)
    gw.close()
  })
})

describe('call-quality telemetry', () => {
  const report: CallQualityReport = {
    sessionDurationS: 1800, joinMs: 640, reconnects: 1, reconnectFailed: false, rttAvgMs: 38.5, rttP95Ms: 81, jitterMs: 4.2,
    packetLossPct: 0.7, concealmentPct: 1.1, audioCodec: 'opus', videoCodec: 'h264', encoderHardware: true,
    stream: { fps: '60+', resolution: '1080p' }, os: 'windows', osVersion: '10.0.26100', appVersion: '0.1.0',
    cpuVendor: 'amd', gpuVendor: 'nvidia',
  }
  const send = (token: string, body: unknown) => api(s.app, 'POST', '/telemetry/call-quality', { token, body })

  it('opt-in only (default off), strict aggregates, pseudonymous day-only rows, metrics, 30-day purge', async () => {
    const u = await register(s.app)
    expect(u.user.telemetryOptIn).toBe(false)
    expect((await send(u.token, report)).status).toBe(403)

    const on = await api<Me>(s.app, 'PATCH', '/users/@me', { token: u.token, body: { telemetryOptIn: true } })
    expect(on.body.telemetryOptIn).toBe(true)
    const [row] = await s.app.ctx.db.select().from(users).where(eq(users.id, u.user.id))
    expect(row!.telemetryOptInAt).toBeInstanceOf(Date)

    const before = await scrape()
    expect((await send(u.token, report)).status).toBe(204)
    expect((await send(u.token, { ...report, stream: null, videoCodec: null, encoderHardware: null, joinMs: null })).status).toBe(204)
    // Anything outside the schema is refused: extra fields, free text, out-of-range values.
    for (const bad of [
      { ...report, roomName: 'Geral' }, { ...report, os: 'Windows 11 (casa)' }, { ...report, osVersion: 'build abc' },
      { ...report, stream: { ...report.stream, title: 'x' } }, { ...report, packetLossPct: 101 }, { ...report, joinMs: 1.5 },
    ]) expect((await send(u.token, bad)).status).toBe(400)

    const rows = await s.app.ctx.db.select().from(callQualityReports)
    const mine = rows.filter((r) => r.userHash === s.app.ctx.telemetry.userHash(u.user.id))
    expect(mine).toHaveLength(2)
    expect(mine[0]).toMatchObject({ day: new Date().toISOString().slice(0, 10), os: 'windows', rttP95Ms: 81, streamFps: '60+', streamResolution: '1080p' })
    expect(JSON.stringify(mine)).not.toContain(u.user.id)
    expect(mine[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/) // random v4: no timestamp inside
    // The salt rotates every UTC day: tomorrow's hash of the same user is unrelated.
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000)
    expect(s.app.ctx.telemetry.userHash(u.user.id, tomorrow)).not.toBe(mine[0]!.userHash)

    const after = await scrape()
    const delta = (name: string, labels: Record<string, string> = {}) => sample(after, name, labels) - sample(before, name, labels)
    expect(delta('alga_call_quality_reports_total', { os: 'windows' })).toBe(2)
    expect(delta('alga_call_rtt_p95_seconds_count')).toBe(2)
    expect(delta('alga_call_join_seconds_count')).toBe(1)
    expect(delta('alga_call_streams_total', { fps: '60+', resolution: '1080p' })).toBe(1)
    expect(delta('alga_call_video_encoder_total', { codec: 'h264', hw: 'true' })).toBe(1)

    // Retention: rows older than 30 days go.
    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const old = { ...mine[0]!, id: crypto.randomUUID(), day: daysAgo(31) }
    const recent = { ...mine[0]!, id: crypto.randomUUID(), day: daysAgo(29) }
    await s.app.ctx.db.insert(callQualityReports).values([old, recent])
    expect(await s.app.ctx.telemetry.sweep()).toBe(1)
    const ids = (await s.app.ctx.db.select({ id: callQualityReports.id }).from(callQualityReports)).map((r) => r.id)
    expect(ids).toContain(recent.id)
    expect(ids).not.toContain(old.id)

    // Withdrawing consent stops it (and clears the consent timestamp); 20 per hour otherwise.
    expect((await api<Me>(s.app, 'PATCH', '/users/@me', { token: u.token, body: { telemetryOptIn: false } })).body.telemetryOptIn).toBe(false)
    const [offRow] = await s.app.ctx.db.select().from(users).where(eq(users.id, u.user.id))
    expect(offRow!.telemetryOptInAt).toBeNull()
    expect((await send(u.token, report)).status).toBe(403)
    const v = await register(s.app)
    await api(s.app, 'PATCH', '/users/@me', { token: v.token, body: { telemetryOptIn: true } })
    const statuses = []
    for (let i = 0; i < 21; i++) statuses.push((await send(v.token, report)).status)
    expect(statuses.slice(0, 20).every((st) => st === 204)).toBe(true)
    expect(statuses[20]).toBe(429)
  })
})
