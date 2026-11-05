/**
 * Ops surface: liveness (/health), readiness (/ready: database + LiveKit), Prometheus scrape (/metrics) and the
 * per-request hook that feeds the HTTP metrics and writes the one standardized "request completed" log line.
 * Log fields (docs/infra/observability.md): reqId (Fastify), uid (logUserHash, authenticated requests), route
 * (template, never the raw URL), method, statusCode, durationMs.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createRequire } from 'node:module'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import type { FastifyRateLimitStore } from '@fastify/rate-limit'
import { sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Ctx } from './app.js'
import { HttpError } from './errors.js'
import { metrics, registry } from './metrics.js'

/** Routes polled by machines: their completion log goes to `debug`. Telemetry too, so no log links a uid to a report. */
const QUIET = new Set(['/health', '/api/v1/health', '/ready', '/api/v1/ready', '/metrics', '/api/v1/telemetry/call-quality'])
const CHECK_TIMEOUT_MS = 2000

/** Request logs carry this instead of the user id: stable per user (FILES_SECRET is the key), so staff can grep a known id's hash. */
export const logUserHash = (secret: string, userId: string) =>
  createHmac('sha256', secret).update(`log-uid:${userId}`).digest('hex').slice(0, 16)

/** Route template for labels and logs; "unmatched" when no route matched (404s), so raw URLs never become labels. */
export const routeOf = (req: FastifyRequest) => req.routeOptions?.url ?? 'unmatched'

const sha256 = (s: string) => createHash('sha256').update(s).digest()

interface StoreOptions { continueExceeding?: boolean; exponentialBackoff?: boolean; cache?: number; routeInfo?: { url?: string } }
type Store = FastifyRateLimitStore & { read: (...args: unknown[]) => void }
// shortcut: deep import of the plugin's own LRU store (not exported) to count evictions; goes away with the Redis store.
const LocalStore = createRequire(import.meta.url)('@fastify/rate-limit/store/LocalStore') as
  new (continueExceeding?: boolean, exponentialBackoff?: boolean, cache?: number) => Store & { lru: { evict(): void } }

/**
 * @fastify/rate-limit's in-memory store (an LRU of `cache` keys, 5000 by default), counting the keys it evicts into
 * alga_ratelimit_evictions_total: an evicted key's counter restarts, so a full store lets limits leak.
 */
export class RateLimitStore implements FastifyRateLimitStore {
  private readonly inner: Store

  constructor(o: StoreOptions = {}) {
    const inner = new LocalStore(o.continueExceeding, o.exponentialBackoff, o.cache)
    const route = o.routeInfo?.url ?? 'global'
    const evict = inner.lru.evict.bind(inner.lru)
    inner.lru.evict = () => {
      metrics.rateLimitEvictions.inc({ route })
      evict()
    }
    this.inner = inner
  }

  incr(...args: Parameters<FastifyRateLimitStore['incr']>): void {
    this.inner.incr(...args)
  }

  read(...args: unknown[]): void {
    this.inner.read(...args)
  }

  // Called per route with its merged options (`routeInfo` = the route).
  child(o: Parameters<FastifyRateLimitStore['child']>[0]): FastifyRateLimitStore {
    return new RateLimitStore(o as StoreOptions)
  }
}

async function check(fn: () => Promise<unknown>): Promise<'ok' | 'fail'> {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([fn(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS) })])
    return 'ok'
  } catch {
    return 'fail'
  } finally {
    clearTimeout(timer)
  }
}

export function installObservability(app: FastifyInstance, ctx: Ctx): void {
  const { config, db, hub, voice } = ctx
  const startedAt = Date.now() / 1000
  const lag = monitorEventLoopDelay({ resolution: 20 })
  lag.enable()
  app.addHook('onClose', async () => lag.disable())

  app.addHook('onResponse', async (req, reply) => {
    const route = routeOf(req)
    const labels = { method: req.method, route, status_class: `${Math.floor(reply.statusCode / 100)}xx` }
    metrics.httpRequests.inc(labels)
    metrics.httpDuration.observe(labels, reply.elapsedTime / 1000)
    const line = { route, method: req.method, statusCode: reply.statusCode, durationMs: Math.round(reply.elapsedTime) }
    if (QUIET.has(route)) req.log.debug(line, 'request completed')
    else req.log.info(line, 'request completed')
  })

  const unlimited = { config: { rateLimit: false as const } }
  const health = async () => ({ ok: true as const, version: config.version })
  const ready = async (_req: FastifyRequest, reply: { code(n: number): unknown }) => {
    const [database, livekit] = await Promise.all([
      check(() => db.execute(sql`select 1`)),
      // LiveKit answers "OK" on GET / (no auth); a 2 s budget keeps this cheap for frequent probes.
      check(async () => {
        const res = await fetch(config.livekit.url, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      }),
    ])
    const ok = database === 'ok' && livekit === 'ok'
    reply.code(ok ? 200 : 503)
    return { ok, checks: { database, livekit } }
  }
  for (const prefix of ['', '/api/v1']) {
    app.get(`${prefix}/health`, unlimited, health)
    app.get(`${prefix}/ready`, unlimited, ready)
  }

  // Off in production unless a token is configured; with a token, required everywhere.
  const token = config.metricsToken
  if (!token && config.env === 'production') return
  const expected = token ? sha256(`Bearer ${token}`) : undefined
  app.get('/metrics', async (req, reply) => {
    if (expected && !timingSafeEqual(sha256(req.headers.authorization ?? ''), expected)) {
      reply.header('www-authenticate', 'Bearer')
      throw new HttpError('unauthorized', 'Token de métricas inválido.')
    }
    const m = metrics
    m.gatewayConnections.set({}, hub.socketCount())
    m.gatewayUsers.set({}, hub.userCount())
    const states = voice.all()
    m.voiceParticipants.set({}, states.length)
    m.voiceRooms.set({}, new Set(states.map((s) => s.channelId)).size)
    m.e2eeGroups.set({}, ctx.e2ee.groupCount())
    m.cinemaSeats.set({}, ctx.cinema.seatCount())
    const mem = process.memoryUsage()
    m.rss.set({}, mem.rss)
    m.heapUsed.set({}, mem.heapUsed)
    m.heapTotal.set({}, mem.heapTotal)
    m.external.set({}, mem.external)
    const cpu = process.cpuUsage()
    m.cpuSeconds.set({}, (cpu.user + cpu.system) / 1e6)
    m.startTime.set({}, startedAt)
    m.buildInfo.set({ version: config.version }, 1)
    // Nanoseconds → seconds; reset so each scrape reports the window since the previous one.
    for (const [stat, v] of [['mean', lag.mean], ['p50', lag.percentile(50)], ['p99', lag.percentile(99)], ['max', lag.max]] as const) {
      m.loopLag.set({ stat }, Number.isFinite(v) ? v / 1e9 : 0)
    }
    lag.reset()
    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(registry.render())
  })
}
