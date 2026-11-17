/**
 * Break-glass for the owner (ADMIN_BOOTSTRAP_EMAIL): at startup, the account with that e-mail becomes admin
 * (audited like scripts/grant-staff.ts) and gets a short one-time code that works with POST /auth/password-reset/confirm,
 * so the owner sets their own password without any e-mail provider. The code is written to the log once, lives 1 h and
 * is used up on first use. For a production without database access from outside; remove the variable afterwards
 * (each restart while it is set replaces the code).
 */
import { randomInt } from 'node:crypto'
import { REMOVED_USER_ID } from '@alga/shared'
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { sha256Hex } from '../auth.js'
import type { Db } from '../db/index.js'
import { emailTokens, users } from '../db/schema.js'
import { setStaffRole } from '../trust-safety.js'

/** No 0/O, 1/I/L: read off a screen and typed on a phone. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_TTL_MS = 60 * 60 * 1000

/** What the person types, with or without dashes, in any case, is reduced to this before hashing (the app does the same). */
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

export async function bootstrapAdmin(db: Db, email: string, log: FastifyBaseLogger, now = new Date()): Promise<string | null> {
  const [u] = await db.select({ id: users.id, username: users.username }).from(users)
    .where(and(eq(users.email, email.trim().toLowerCase()), ne(users.id, REMOVED_USER_ID)))
    .orderBy(sql`${users.emailVerifiedAt} is null`, desc(users.createdAt)).limit(1)
  if (!u) {
    log.warn('admin bootstrap: no account with ADMIN_BOOTSTRAP_EMAIL; nothing done')
    return null
  }
  await setStaffRole(db, u.username, 'admin')
  const code = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  await db.transaction(async (tx) => {
    await tx.delete(emailTokens).where(and(eq(emailTokens.userId, u.id), eq(emailTokens.kind, 'password_reset')))
    await tx.insert(emailTokens).values({ tokenHash: sha256Hex(code), userId: u.id, kind: 'password_reset', expiresAt: new Date(now.getTime() + CODE_TTL_MS) })
  })
  const shown = code.match(/.{4}/g)!.join('-')
  log.warn({ username: u.username, code: shown, expiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString() },
    'admin bootstrap: account is admin; one-time code to set the password (1 h, single use). Remove ADMIN_BOOTSTRAP_EMAIL now.')
  return shown
}
