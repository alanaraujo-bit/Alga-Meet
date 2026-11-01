import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify'
import { authenticate, isRestricted, type AuthContext } from './auth.js'
import { Billing } from './billing/billing.js'
import { maxPlanAttachmentBytes } from './billing/catalog.js'
import type { Config } from './config.js'
import { openDatabase, type Db } from './db/index.js'
import { Mailer, createEmailSender } from './email.js'
import { HttpError, installErrorHandling, safeUrl } from './errors.js'
import { Files } from './files.js'
import { Hub } from './gateway/hub.js'
import { gatewayRoute } from './gateway/socket.js'
import { metrics } from './metrics.js'
import { installObservability, logUserHash, routeOf } from './observability.js'
import { Privacy } from './privacy.js'
import { adminRoutes } from './routes/admin.js'
import { authPublicRoutes, authRoutes } from './routes/auth.js'
import { billingPublicRoutes, billingRoutes } from './routes/billing.js'
import { filePublicRoutes, fileRoutes } from './routes/files.js'
import { messageRoutes } from './routes/messages.js'
import { moderationRoutes } from './routes/moderation.js'
import { privacyPublicRoutes, privacyRoutes } from './routes/privacy.js'
import { reportPublicRoutes, reportRoutes } from './routes/reports.js'
import { roleRoutes } from './routes/roles.js'
import { invitePublicRoutes, spaceRoutes } from './routes/spaces.js'
import { telemetryRoutes } from './routes/telemetry.js'
import { userRoutes } from './routes/users.js'
import { livekitWebhookRoute, voiceRoutes } from './routes/voice.js'
import { createStorage } from './storage.js'
import { Telemetry } from './telemetry.js'
import { TrustSafety, restrictedError } from './trust-safety.js'
import { Voice } from './voice.js'

/** Shared services handed to every route module. */
export interface Ctx {
  config: Config
  db: Db
  hub: Hub
  voice: Voice
  files: Files
  mail: Mailer
  billing: Billing
  trust: TrustSafety
  privacy: Privacy
  telemetry: Telemetry
  log: FastifyBaseLogger
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: Ctx
  }
}

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const tp = config.trustProxy
  const app = Fastify({
    // Fastify treats a bare hop count as "trust nothing"; a hop function is only safe when the app is reachable
    // exclusively through the proxy (otherwise list the proxy IPs/CIDRs).
    trustProxy: typeof tp === 'number' ? (_addr: string, hop: number) => hop < tp : tp,
    bodyLimit: 256 * 1024,
    // src/observability.ts writes one "request completed" line per request with the standardized fields instead.
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      level: config.logLevel,
      // Bodies are never logged; headers only through these redactions.
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["sec-websocket-protocol"]'],
      serializers: {
        req: (req: { method: string; url: string; ip: string }) => ({ method: req.method, url: safeUrl(req.url), remoteAddress: req.ip }),
      },
    },
  })

  const database = await openDatabase(config)
  app.log.info({ driver: database.driver }, 'database ready')
  const hub = new Hub()
  const files = new Files(config, database.db, createStorage(config.storage), app.log)
  const mail = new Mailer(createEmailSender(config.email, app.log, config.env === 'production'), app.log, config.email.linkUrl)
  const voice = new Voice(config, database.db, hub, app.log)
  const billing = new Billing(config, database.db, hub, voice, app.log)
  await billing.syncCatalog()
  // trust/privacy take the whole Ctx (they use every other service); assigned right below.
  const ctx = { config, db: database.db, hub, voice, files, mail, billing, telemetry: new Telemetry(database.db, app.log), log: app.log } as Ctx
  ctx.trust = new TrustSafety(ctx)
  ctx.privacy = new Privacy(ctx)
  app.decorate('ctx', ctx)
  files.start()
  billing.start()
  ctx.trust.start()
  ctx.privacy.start()
  ctx.telemetry.start()
  app.log.info({ provider: config.billing.provider }, 'billing ready')

  // preClose runs before @fastify/websocket's own client shutdown, so socket close handlers see hub.closing.
  app.addHook('preClose', async () => {
    hub.closing = true
    hub.closeAll(1001, 'server shutting down')
  })
  app.addHook('onClose', async () => {
    await ctx.telemetry.stop()
    await ctx.privacy.stop()
    await ctx.trust.stop()
    await files.stop()
    await billing.stop()
    await database.close()
  })

  installErrorHandling(app)
  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  })
  // Every route gets this ceiling unless it sets its own `config.rateLimit` (which inherits the key below).
  // preHandler: runs after authentication, so authenticated routes are keyed per user, public ones per IP.
  await app.register(rateLimit, {
    global: true,
    hook: 'preHandler',
    max: 200,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const auth = (req as { auth?: AuthContext }).auth
      return auth ? `u:${auth.user.id}` : `ip:${req.ip}`
    },
    errorResponseBuilder: (req) => {
      metrics.rateLimited.inc({ route: routeOf(req) })
      return new HttpError('rate_limited', 'Muitas requisições. Tente novamente em instantes.')
    },
  })
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } })
  // Upload routes pass their own per-request limits; these are the ceilings for any multipart body.
  await app.register(multipart, {
    limits: { fileSize: maxPlanAttachmentBytes(config.files.maxAttachmentBytes), files: 1, fields: 4, fieldSize: 64 * 1024, parts: 16, headerPairs: 64 },
  })

  // /health, /ready (root and /api/v1), /metrics and the per-request metrics/log hook.
  installObservability(app, ctx)
  gatewayRoute(app, ctx)

  await app.register(async (api) => {
    authPublicRoutes(api, ctx)
    invitePublicRoutes(api, ctx)
    await livekitWebhookRoute(api, ctx)
    filePublicRoutes(api, ctx)
    await billingPublicRoutes(api, ctx)
    privacyPublicRoutes(api, ctx)
    reportPublicRoutes(api, ctx)

    await api.register(async (authed) => {
      authed.addHook('onRequest', authenticate(ctx.db))
      authed.addHook('onRequest', async (req) => {
        // Sessions are deleted when an account is restricted; this covers a request racing that.
        if (isRestricted(req.auth.user)) throw restrictedError((await ctx.trust.restrictionOf(req.auth.user))!)
        req.log = req.log.child({ uid: logUserHash(config.files.secret, req.auth.user.id) })
        await ctx.privacy.recordUse(req.auth.user.id, req.ip, req.headers['user-agent'], 'session_use')
      })
      authRoutes(authed, ctx)
      userRoutes(authed, ctx)
      spaceRoutes(authed, ctx)
      roleRoutes(authed, ctx)
      moderationRoutes(authed, ctx)
      messageRoutes(authed, ctx)
      voiceRoutes(authed, ctx)
      fileRoutes(authed, ctx)
      billingRoutes(authed, ctx)
      privacyRoutes(authed, ctx)
      reportRoutes(authed, ctx)
      telemetryRoutes(authed, ctx)
      await authed.register(async (admin) => adminRoutes(admin, ctx))
    })
  }, { prefix: '/api/v1' })

  return app
}
