import { GatewayClose, LoginBody, RegisterBody, uuidv7, type AuthResponse, type Session } from '@alga/shared'
import { and, desc, eq, or } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../app.js'
import { createSession, hashPassword, verifyPassword } from '../auth.js'
import { isUniqueViolation } from '../db/index.js'
import { sessions, users } from '../db/schema.js'
import { HttpError, conflict, idParam, notFound, parse } from '../errors.js'
import { meView } from '../views.js'

const authLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } }

export function authPublicRoutes(app: FastifyInstance, { db }: Ctx): void {
  app.post('/auth/register', { config: authLimit }, async (req, reply): Promise<AuthResponse> => {
    const body = parse(RegisterBody, req.body)
    const taken = await db.select({ email: users.email, username: users.username }).from(users)
      .where(or(eq(users.email, body.email), eq(users.username, body.username)))
    if (taken.length) throw takenError(taken, body)
    const passwordHash = await hashPassword(body.password)
    let user
    try {
      ;[user] = await db.insert(users).values({
        id: uuidv7(),
        email: body.email,
        username: body.username,
        displayName: body.displayName ?? body.username,
        passwordHash,
      }).returning()
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('E-mail ou nome de usuário já em uso.')
      throw err
    }
    const { token } = await createSession(db, user!.id, req.headers['user-agent'] ?? '')
    reply.code(201)
    return { token, user: meView(user!) }
  })

  app.post('/auth/login', { config: authLimit }, async (req): Promise<AuthResponse> => {
    const body = parse(LoginBody, req.body)
    const [user] = await db.select().from(users)
      .where(or(eq(users.email, body.login), eq(users.username, body.login))).limit(1)
    // Same message and (roughly) same cost whether the login exists or not.
    if (!(await verifyPassword(user?.passwordHash, body.password)) || !user) {
      throw new HttpError('unauthorized', 'Login ou senha inválidos.')
    }
    const { token } = await createSession(db, user.id, req.headers['user-agent'] ?? '')
    return { token, user: meView(user) }
  })
}

function takenError(taken: { email: string; username: string }[], body: { email: string; username: string }) {
  const fields: Record<string, string> = {}
  if (taken.some((t) => t.email === body.email)) fields.email = 'E-mail já cadastrado.'
  if (taken.some((t) => t.username === body.username)) fields.username = 'Nome de usuário já em uso.'
  return conflict('E-mail ou nome de usuário já em uso.', fields)
}

export function authRoutes(app: FastifyInstance, { db, hub }: Ctx): void {
  app.post('/auth/logout', async (req, reply) => {
    await db.delete(sessions).where(eq(sessions.id, req.auth.sessionId))
    hub.closeSession(req.auth.sessionId, GatewayClose.SESSION_REVOKED, 'logged out')
    return reply.code(204).send()
  })

  app.get('/auth/sessions', async (req): Promise<Session[]> => {
    const rows = await db.select().from(sessions).where(eq(sessions.userId, req.auth.user.id)).orderBy(desc(sessions.lastUsedAt))
    return rows.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === req.auth.sessionId,
    }))
  })

  app.delete<{ Params: { id: string } }>('/auth/sessions/:id', async (req, reply) => {
    const id = idParam(req.params.id)
    const deleted = await db.delete(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, req.auth.user.id)))
      .returning({ id: sessions.id })
    if (!deleted.length) throw notFound('Sessão não encontrada.')
    hub.closeSession(id, GatewayClose.SESSION_REVOKED, 'session revoked')
    return reply.code(204).send()
  })
}
