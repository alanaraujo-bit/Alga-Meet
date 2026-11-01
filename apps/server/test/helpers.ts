import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { AuthResponse, Dispatch, DispatchOf, DispatchType, ServerFrame } from '@alga/shared'
import type { FastifyInstance } from 'fastify'
import { AccessToken } from 'livekit-server-sdk'
import pg from 'pg'
import { inject } from 'vitest'
import WebSocket from 'ws'
import { buildApp } from '../src/app.js'
import { loadConfig, type Config } from '../src/config.js'

export interface TestServer {
  app: FastifyInstance
  config: Config
  port: number
  close(): Promise<void>
}

let dbCounter = 0
/** `npm run test:pg`: a fresh database on the shared real PostgreSQL cluster (test/pg-setup.ts); otherwise none (PGlite). */
export async function freshDatabaseUrl(): Promise<string | undefined> {
  const admin = inject('pgAdminUrl')
  if (!admin) return undefined
  const name = `alga_${process.pid}_${++dbCounter}_${Math.random().toString(36).slice(2, 8)}`
  const client = new pg.Client({ connectionString: admin })
  await client.connect()
  try {
    await client.query(`create database "${name}"`)
  } finally {
    await client.end()
  }
  const url = new URL(admin)
  url.pathname = `/${name}`
  return url.toString()
}

/** True when the suite runs against real PostgreSQL. */
export const onRealPostgres = () => Boolean(inject('pgAdminUrl'))

export async function startServer(env: Record<string, string> = {}): Promise<TestServer> {
  const databaseUrl = await freshDatabaseUrl()
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    PGLITE_DIR: 'memory://',
    ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
    // Nothing listens here: SFU calls (kick/delete room) fail fast and are logged, as in production with LiveKit down.
    LIVEKIT_URL: 'http://127.0.0.1:9',
    ...env,
  })
  const app = await buildApp(config)
  await app.listen({ port: 0, host: '127.0.0.1' })
  const port = (app.server.address() as AddressInfo).port
  return { app, config, port, close: () => app.close() }
}

let ipCounter = 0
/** Fresh client IP per call so the per-IP auth rate limit never interferes with unrelated tests. */
export const freshIp = () => `10.${(++ipCounter >> 8) & 255}.${ipCounter & 255}.7`

export interface Res<T = any> {
  status: number
  // Error responses share the call site with the success type, hence the loose `error`.
  body: T & { error?: any }
}

export async function api<T = any>(
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  opts: { token?: string; body?: unknown; ip?: string; headers?: Record<string, string> } = {},
): Promise<Res<T>> {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    remoteAddress: opts.ip ?? '127.0.0.1',
    headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  })
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined }
}

let userCounter = 0
export async function register(app: FastifyInstance, name?: string): Promise<AuthResponse & { password: string }> {
  const username = name ?? `user${++userCounter}_${Math.random().toString(36).slice(2, 6)}`
  const password = 'correct horse battery'
  const res = await api<AuthResponse>(app, 'POST', '/auth/register', {
    ip: freshIp(),
    body: { email: `${username}@example.com`, username, displayName: username.toUpperCase(), password },
  })
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`)
  return { ...res.body, password }
}

/** Makes `a` and `b` friends (request + accept). */
export async function befriend(app: FastifyInstance, a: AuthResponse, b: AuthResponse): Promise<void> {
  const req = await api(app, 'POST', '/relationships', { token: a.token, body: { username: b.user.username } })
  if (req.status !== 200) throw new Error(`friend request failed: ${req.status}`)
  const acc = await api(app, 'PUT', `/relationships/${a.user.id}`, { token: b.token, body: { type: 'friend' } })
  if (acc.status !== 200) throw new Error(`accept failed: ${acc.status}`)
}

/** Minimal gateway client recording every dispatch. */
export class Gateway {
  readonly events: Dispatch[] = []
  readonly closed: Promise<{ code: number; reason: string }>
  private waiters: (() => void)[] = []

  constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as ServerFrame
      if (frame.op === 'dispatch') this.events.push({ t: frame.t, d: frame.d } as Dispatch)
      for (const w of this.waiters.splice(0)) w()
    })
    this.closed = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })))
  }

  send(frame: unknown): void {
    this.ws.send(JSON.stringify(frame))
  }

  /** Resolves with the first (already received or future) dispatch of type `t` matching `pred`. */
  async waitFor<T extends DispatchType>(t: T, pred: (d: DispatchOf<T>) => boolean = () => true, timeoutMs = 3000): Promise<DispatchOf<T>> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const hit = this.events.find((e) => e.t === t && pred(e.d as DispatchOf<T>))
      if (hit) return hit.d as DispatchOf<T>
      const left = deadline - Date.now()
      if (left <= 0) throw new Error(`timed out waiting for ${t}; got: ${this.events.map((e) => e.t).join(', ')}`)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left)
        this.waiters.push(() => { clearTimeout(timer); resolve() })
      })
    }
  }

  /** Asserts that no dispatch of type `t` matching `pred` arrives within `ms`. */
  async expectNone<T extends DispatchType>(t: T, pred: (d: DispatchOf<T>) => boolean = () => true, ms = 300): Promise<void> {
    await new Promise((r) => setTimeout(r, ms))
    const hit = this.events.find((e) => e.t === t && pred(e.d as DispatchOf<T>))
    if (hit) throw new Error(`unexpected ${t}: ${JSON.stringify(hit.d)}`)
  }

  close(): void {
    this.ws.close()
  }
}

export async function openGateway(port: number): Promise<Gateway> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/gateway`)
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
  return new Gateway(ws)
}

/** Connects and identifies; resolves once READY arrived. */
export async function connect(port: number, token: string): Promise<Gateway> {
  const gw = await openGateway(port)
  gw.send({ op: 'identify', token })
  await gw.waitFor('READY')
  return gw
}

/** Builds a request exactly as LiveKit signs webhooks: a JWT whose `sha256` claim is the base64 SHA-256 of the body. */
export async function signedWebhook(config: Config, payload: unknown, secret = config.livekit.apiSecret) {
  const body = JSON.stringify(payload)
  const at = new AccessToken(config.livekit.apiKey, secret)
  at.sha256 = createHash('sha256').update(body).digest('base64')
  return { body, authorization: await at.toJwt() }
}

export async function postWebhook(app: FastifyInstance, config: Config, payload: unknown, secret?: string) {
  const { body, authorization } = await signedWebhook(config, payload, secret)
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/livekit/webhook',
    headers: { authorization, 'content-type': 'application/webhook+json' },
    payload: body,
  })
  return { status: res.statusCode, body: res.body }
}
