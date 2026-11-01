import { createHash, randomBytes } from 'node:crypto'
import { hash, verify, type Algorithm } from '@node-rs/argon2'
import { uuidv7 } from '@alga/shared'
import { eq } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import type { Db } from './db/index.js'
import { sessions, users, type UserRow } from './db/schema.js'
import { HttpError } from './errors.js'

// OWASP 2024 argon2id baseline: m=19 MiB, t=2, p=1.
const ARGON = { algorithm: 2 as Algorithm /* Argon2id */, memoryCost: 19_456, timeCost: 2, parallelism: 1 }

export const hashPassword = (password: string) => hash(password, ARGON)

// Verified against when the login does not match any user, so both paths cost one argon2 verification.
let dummyHash: Promise<string> | undefined
export async function verifyPassword(stored: string | undefined, password: string): Promise<boolean> {
  if (!stored) {
    dummyHash ??= hash(randomBytes(16).toString('hex'), ARGON)
    await verify(await dummyHash, password)
    return false
  }
  return verify(stored, password)
}

export const sha256Hex = (token: string) => createHash('sha256').update(token).digest('hex')

/** Creates a session and returns the opaque token (32 random bytes, base64url). Only its SHA-256 is stored. */
export async function createSession(db: Db, userId: string, userAgent: string): Promise<{ token: string; sessionId: string }> {
  const token = randomBytes(32).toString('base64url')
  const sessionId = uuidv7()
  await db.insert(sessions).values({ id: sessionId, userId, tokenHash: sha256Hex(token), userAgent: userAgent.slice(0, 512) })
  return { token, sessionId }
}

export interface AuthContext {
  user: UserRow
  sessionId: string
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext
  }
}

const TOUCH_INTERVAL_MS = 60_000

/** Resolves a bearer token to its session + user, or null. Touches lastUsedAt at most once a minute. */
export async function resolveToken(db: Db, token: string): Promise<AuthContext | null> {
  if (!token || token.length > 128) return null
  const [row] = await db
    .select({ user: users, sessionId: sessions.id, lastUsedAt: sessions.lastUsedAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, sha256Hex(token)))
    .limit(1)
  if (!row) return null
  if (Date.now() - row.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.update(sessions).set({ lastUsedAt: new Date() }).where(eq(sessions.id, row.sessionId))
  }
  return { user: row.user, sessionId: row.sessionId }
}

export function bearerToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization
  if (!h) return null
  const m = /^Bearer\s+(\S+)$/i.exec(h)
  return m ? m[1]! : null
}

/** onRequest hook for authenticated route contexts. */
export function authenticate(db: Db) {
  return async (req: FastifyRequest) => {
    const token = bearerToken(req)
    const auth = token ? await resolveToken(db, token) : null
    if (!auth) throw new HttpError('unauthorized', 'Sessão inválida ou expirada.')
    req.auth = auth
  }
}
