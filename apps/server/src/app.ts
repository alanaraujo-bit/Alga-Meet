import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'
import { authenticate } from './auth.js'
import type { Config } from './config.js'
import { openDatabase, type Db } from './db/index.js'
import { HttpError, installErrorHandling } from './errors.js'
import { Hub } from './gateway/hub.js'
import { gatewayRoute } from './gateway/socket.js'
import { authPublicRoutes, authRoutes } from './routes/auth.js'
import { messageRoutes } from './routes/messages.js'
import { invitePublicRoutes, spaceRoutes } from './routes/spaces.js'
import { userRoutes } from './routes/users.js'
import { livekitWebhookRoute, voiceRoutes } from './routes/voice.js'
import { Voice } from './voice.js'

/** Shared services handed to every route module. */
export interface Ctx {
  config: Config
  db: Db
  hub: Hub
  voice: Voice
  log: FastifyBaseLogger
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: Ctx
  }
}

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: 256 * 1024,
    logger: {
      level: config.logLevel,
      // Bodies are never logged; headers only through these redactions.
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["sec-websocket-protocol"]'],
    },
  })

  const database = await openDatabase(config)
  app.log.info({ driver: database.driver }, 'database ready')
  const hub = new Hub()
  const ctx: Ctx = { config, db: database.db, hub, voice: new Voice(config, database.db, hub, app.log), log: app.log }
  app.decorate('ctx', ctx)

  // preClose runs before @fastify/websocket's own client shutdown, so socket close handlers see hub.closing.
  app.addHook('preClose', async () => {
    hub.closing = true
    hub.closeAll(1001, 'server shutting down')
  })
  app.addHook('onClose', async () => {
    await database.close()
  })

  installErrorHandling(app)
  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  })
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new HttpError('rate_limited', 'Muitas requisições. Tente novamente em instantes.'),
  })
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } })

  const health = async () => ({ ok: true as const, version: config.version })
  app.get('/health', health)
  gatewayRoute(app, ctx)

  await app.register(async (api) => {
    api.get('/health', health)
    authPublicRoutes(api, ctx)
    invitePublicRoutes(api, ctx)
    await livekitWebhookRoute(api, ctx)

    await api.register(async (authed) => {
      authed.addHook('onRequest', authenticate(ctx.db))
      authRoutes(authed, ctx)
      userRoutes(authed, ctx)
      spaceRoutes(authed, ctx)
      messageRoutes(authed, ctx)
      voiceRoutes(authed, ctx)
    })
  }, { prefix: '/api/v1' })

  return app
}
