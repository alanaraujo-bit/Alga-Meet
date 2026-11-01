import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'
import { authenticate, type AuthContext } from './auth.js'
import type { Config } from './config.js'
import { openDatabase, type Db } from './db/index.js'
import { HttpError, installErrorHandling, safeUrl } from './errors.js'
import { Files } from './files.js'
import { Hub } from './gateway/hub.js'
import { gatewayRoute } from './gateway/socket.js'
import { authPublicRoutes, authRoutes } from './routes/auth.js'
import { filePublicRoutes, fileRoutes } from './routes/files.js'
import { messageRoutes } from './routes/messages.js'
import { moderationRoutes } from './routes/moderation.js'
import { roleRoutes } from './routes/roles.js'
import { invitePublicRoutes, spaceRoutes } from './routes/spaces.js'
import { userRoutes } from './routes/users.js'
import { livekitWebhookRoute, voiceRoutes } from './routes/voice.js'
import { createStorage } from './storage.js'
import { Voice } from './voice.js'

/** Shared services handed to every route module. */
export interface Ctx {
  config: Config
  db: Db
  hub: Hub
  voice: Voice
  files: Files
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
  const ctx: Ctx = { config, db: database.db, hub, voice: new Voice(config, database.db, hub, app.log), files, log: app.log }
  app.decorate('ctx', ctx)
  files.start()

  // preClose runs before @fastify/websocket's own client shutdown, so socket close handlers see hub.closing.
  app.addHook('preClose', async () => {
    hub.closing = true
    hub.closeAll(1001, 'server shutting down')
  })
  app.addHook('onClose', async () => {
    await files.stop()
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
    errorResponseBuilder: () => new HttpError('rate_limited', 'Muitas requisições. Tente novamente em instantes.'),
  })
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } })
  // Upload routes pass their own per-request limits; these are the ceilings for any multipart body.
  await app.register(multipart, {
    limits: { fileSize: config.files.maxAttachmentBytes, files: 1, fields: 4, fieldSize: 64 * 1024, parts: 16, headerPairs: 64 },
  })

  const health = async () => ({ ok: true as const, version: config.version })
  const unlimited = { config: { rateLimit: false as const } }
  app.get('/health', unlimited, health)
  gatewayRoute(app, ctx)

  await app.register(async (api) => {
    api.get('/health', unlimited, health)
    authPublicRoutes(api, ctx)
    invitePublicRoutes(api, ctx)
    await livekitWebhookRoute(api, ctx)
    filePublicRoutes(api, ctx)

    await api.register(async (authed) => {
      authed.addHook('onRequest', authenticate(ctx.db))
      authRoutes(authed, ctx)
      userRoutes(authed, ctx)
      spaceRoutes(authed, ctx)
      roleRoutes(authed, ctx)
      moderationRoutes(authed, ctx)
      messageRoutes(authed, ctx)
      voiceRoutes(authed, ctx)
      fileRoutes(authed, ctx)
    })
  }, { prefix: '/api/v1' })

  return app
}
