import {
  ChangePasswordBody, GatewayClose, LoginBody, MIN_AGE, ageOn, PasswordResetConfirmBody, PasswordResetRequestBody, RegisterBody, VerifyEmailBody,
  uuidv7, type AuthResponse, type Session,
} from '@alga/shared'
import { and, desc, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Ctx } from '../app.js'
import {
  consumeEmailToken, createSession, hasSession, hashPassword, issueEmailToken, peekEmailToken, verifyPassword,
} from '../auth.js'
import { isUniqueViolation } from '../db/index.js'
import { algaClientHeader, sessionDevice } from '../devices.js'
import { consentRecords, emailTokens, sessions, users, type UserRow } from '../db/schema.js'
import { accountExistsMail, passwordResetMail, verifyEmailMail } from '../email-templates.js'
import { HttpError, conflict, idParam, invalid, notFound, parse, safeErr } from '../errors.js'
import { TERMS_VERSION } from '../legal.js'
import { assertStrongPassword } from '../passwords.js'
import { restrictedError } from '../trust-safety.js'
import { meView } from '../views.js'
import { UNDER_AGE_MESSAGE, oldTerms } from './privacy.js'

/** Per client IP (see TRUST_PROXY). */
const authLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } }
const MAX_FAILED_LOGINS = 10

const usernameTaken = () => conflict('Nome de usuário já em uso.', { username: 'Nome de usuário já em uso.' })
const badToken = () => invalid({ token: 'Link inválido, expirado ou já usado. Peça um novo.' })

/** Closes the sockets of deleted sessions (4004); a user left without any session also leaves voice. */
async function revoked({ db, hub, voice }: Ctx, userId: string, deleted: { id: string }[], reason: string): Promise<void> {
  for (const s of deleted) hub.closeSession(s.id, GatewayClose.SESSION_REVOKED, reason)
  if (deleted.length && !(await hasSession(db, userId))) await voice.disconnect(userId)
}

/** Runs after the response (same timing whatever the outcome; e-mail never delays or fails a request). */
function later(ctx: Ctx, what: string, fn: () => Promise<void>): void {
  void fn().catch((err: unknown) => ctx.log.error({ err: safeErr(err) }, `${what} failed`))
}

/**
 * Verification mail for `user`, or, when another account already verified that address, a "you already have an
 * account" mail to it (B5: the requester sees the same thing either way). Dropped beyond the per-address quota.
 */
function sendVerification(ctx: Ctx, user: UserRow): void {
  if (!ctx.mail.reserve('verify', user.email)) return
  later(ctx, 'verification mail', async () => {
    const [owner] = await ctx.db.select({ username: users.username }).from(users)
      .where(and(eq(users.email, user.email), isNotNull(users.emailVerifiedAt), ne(users.id, user.id)))
    if (owner) return ctx.mail.send({ to: user.email, kind: 'account_exists', ...accountExistsMail(owner.username) })
    const token = await issueEmailToken(ctx.db, user.id, 'verify_email')
    ctx.mail.send({ to: user.email, kind: 'verify_email', ...verifyEmailMail(ctx.mail.link('verify-email', token), token) })
  })
}

export function authPublicRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, hub, mail } = ctx
  // Failed logins per account, across IPs. Only failures count, and other accounts are unaffected, so an attacker
  // can at worst slow down the account they target (for 15 min), never lock everyone out.
  const loginKey = new WeakMap<FastifyRequest, string>()
  const failedLogins = app.createRateLimit({ max: MAX_FAILED_LOGINS, timeWindow: '15 minutes', keyGenerator: (req) => loginKey.get(req)! })

  // B5: only the username can be reported as taken (usernames are public). The e-mail never is: the account is
  // created unverified and the address gets either a verification link or a "you already have an account" mail.
  app.post('/auth/register', { config: authLimit }, async (req, reply): Promise<AuthResponse> => {
    const body = parse(RegisterBody, req.body)
    // Age gate (Lei 15.211/2025): nothing is stored for someone under MIN_AGE.
    if (ctx.config.legal.requireBirthDate) {
      const missing = {
        ...(!body.birthDate ? { birthDate: 'Informe sua data de nascimento.' } : {}),
        ...(!body.termsVersion ? { termsVersion: 'Aceite os Termos de Uso e a Política de Privacidade.' } : {}),
      }
      if (Object.keys(missing).length) throw invalid(missing)
    } else if (!body.birthDate || !body.termsVersion) {
      req.log.warn('register without birthDate/termsVersion: accepted outside production until the client sends them (REQUIRE_BIRTHDATE=1 enforces)')
    }
    if (body.birthDate && ageOn(body.birthDate) < MIN_AGE) throw new HttpError('validation', UNDER_AGE_MESSAGE, { birthDate: UNDER_AGE_MESSAGE })
    if (body.termsVersion && body.termsVersion !== TERMS_VERSION) throw oldTerms()
    assertStrongPassword(body.password, body, 'password')
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.username, body.username))
    if (taken) throw usernameTaken()
    const passwordHash = await hashPassword(body.password)
    let user: UserRow | undefined
    const now = new Date()
    const insert = (emailVerifiedAt: Date | null) => db.transaction(async (tx) => {
      const [row] = await tx.insert(users).values({
        id: uuidv7(),
        email: body.email,
        username: body.username,
        displayName: body.displayName ?? body.username,
        passwordHash,
        emailVerifiedAt,
        ...(body.birthDate ? { birthDate: body.birthDate, birthDateSetAt: now } : {}),
        ...(body.termsVersion ? { termsVersion: body.termsVersion, termsAcceptedAt: now } : {}),
      }).returning()
      if (body.termsVersion) await tx.insert(consentRecords).values({ id: uuidv7(), userId: row!.id, termsVersion: body.termsVersion, acceptedAt: now })
      return row
    })
    try {
      // ALGA_AUTO_VERIFY_EMAIL (staging): if another account already verified the address, users_verified_email_key
      // fires and the account is created unverified as usual (B5 mail). shortcut: emailVerified in the response then
      // tells the two cases apart (B5 oracle); fine on a closed staging, never turn it on for open sign-ups.
      user = await insert(ctx.config.email.autoVerify ? now : null)
        .catch((err: unknown) => { if (ctx.config.email.autoVerify && isUniqueViolation(err)) return insert(null); throw err })
    } catch (err) {
      // Unverified inserts never hit users_verified_email_key: only the username can collide.
      if (isUniqueViolation(err)) throw usernameTaken()
      throw err
    }
    const { token } = await createSession(db, user!.id, req.headers['user-agent'] ?? '', algaClientHeader(req.headers['x-alga-client']))
    await ctx.privacy.recordUse(user!.id, req.ip, req.headers['user-agent'], 'login')
    if (!user!.emailVerifiedAt) sendVerification(ctx, user!)
    reply.code(201)
    return { token, user: meView(user!, ctx.config.files.maxAttachmentBytes) }
  })

  app.post('/auth/login', { config: authLimit }, async (req): Promise<AuthResponse> => {
    const body = parse(LoginBody, req.body)
    // By e-mail only once verified: an unverified address may be claimed by several accounts (see register).
    const [user] = await db.select().from(users)
      .where(or(and(eq(users.email, body.login), isNotNull(users.emailVerifiedAt)), eq(users.username, body.login))).limit(1)
    loginKey.set(req, `login:${user?.id ?? body.login}`)
    // Checked before argon2, so a locked account costs no CPU and gives no password oracle.
    const failures = await failedLogins(req, { increment: false })
    if (!failures.isAllowed && failures.remaining === 0) {
      throw new HttpError('rate_limited', 'Muitas tentativas de login. Tente novamente mais tarde.')
    }
    // Same message and (roughly) same cost whether the login exists or not.
    if (!(await verifyPassword(user?.passwordHash, body.password)) || !user) {
      await failedLogins(req)
      throw new HttpError('unauthorized', 'Login ou senha inválidos.')
    }
    // Right password: a suspended/banned account learns why and gets a token that only lets it appeal.
    const restriction = await ctx.trust.restrictionOf(user, true)
    if (restriction) throw restrictedError(restriction)
    const canceled = user.deletionPurgeAfter !== null
    if (canceled) await ctx.privacy.cancelDeletion(user)
    const { token } = await createSession(db, user.id, req.headers['user-agent'] ?? '', algaClientHeader(req.headers['x-alga-client']))
    await ctx.privacy.recordUse(user.id, req.ip, req.headers['user-agent'], 'login')
    return { token, user: meView(user, ctx.config.files.maxAttachmentBytes), ...(canceled ? { deletionCanceled: true } : {}) }
  })

  // No auth: the link may be opened on another device or after logging out; the token is the proof.
  app.post('/auth/verify-email', { config: authLimit }, async (req, reply) => {
    const { token } = parse(VerifyEmailBody, req.body)
    const userId = await consumeEmailToken(db, token, 'verify_email')
    if (!userId) throw badToken()
    let row: UserRow | undefined
    try {
      ;[row] = await db.update(users).set({ emailVerifiedAt: new Date() })
        .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt))).returning()
    } catch (err) {
      // Two accounts claimed the address and the other one confirmed it first.
      if (isUniqueViolation(err)) throw conflict('Este e-mail já foi confirmado em outra conta.')
      throw err
    }
    if (row) hub.dispatch([row.id], 'ME_UPDATE', meView(row, ctx.config.files.maxAttachmentBytes))
    return reply.code(204).send()
  })

  // Always 204, before any lookup (no enumeration by status or timing). 5 per 15 min per IP; per address, at most
  // MAILS_PER_ADDRESS_PER_HOUR mails (further requests are dropped and do not replace the link already sent).
  app.post('/auth/password-reset/request', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const { email } = parse(PasswordResetRequestBody, req.body)
    if (mail.reserve('reset', email)) {
      later(ctx, 'password reset mail', async () => {
        // The verified owner; without one, the newest account claiming the address (confirming proves the inbox).
        const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
          .orderBy(sql`${users.emailVerifiedAt} is null`, desc(users.createdAt)).limit(1)
        if (!user) return // nothing is sent to addresses without an account (no spam relay)
        const token = await issueEmailToken(db, user.id, 'password_reset')
        mail.send({ to: email, kind: 'password_reset', ...passwordResetMail(mail.link('reset-password', token), token) })
      })
    }
    return reply.code(204).send()
  })

  app.post('/auth/password-reset/confirm', { config: authLimit }, async (req, reply) => {
    const body = parse(PasswordResetConfirmBody, req.body)
    const userId = await peekEmailToken(db, body.token, 'password_reset')
    const [user] = userId ? await db.select().from(users).where(eq(users.id, userId)) : []
    if (!user) throw badToken()
    assertStrongPassword(body.password, user, 'password')
    const passwordHash = await hashPassword(body.password)
    // Used up only now, so a refused password does not burn the link; concurrent confirms have one winner.
    if (!(await consumeEmailToken(db, body.token, 'password_reset'))) throw badToken()
    await db.update(users).set({ passwordHash }).where(eq(users.id, user.id))
    if (!user.emailVerifiedAt) {
      // Opening the mail proves the inbox, unless another account confirmed the address meanwhile.
      await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id))
        .catch((err: unknown) => { if (!isUniqueViolation(err)) throw err })
    }
    await revoked(ctx, user.id, await db.delete(sessions).where(eq(sessions.userId, user.id)).returning({ id: sessions.id }), 'password reset')
    return reply.code(204).send()
  })
}

export function authRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx
  const deleteOthers = (req: FastifyRequest) => db.delete(sessions)
    .where(and(eq(sessions.userId, req.auth.user.id), ne(sessions.id, req.auth.sessionId))).returning({ id: sessions.id })

  app.post('/auth/logout', async (req, reply) => {
    const deleted = await db.delete(sessions).where(eq(sessions.id, req.auth.sessionId)).returning({ id: sessions.id })
    await revoked(ctx, req.auth.user.id, deleted, 'logged out')
    return reply.code(204).send()
  })

  app.post('/auth/password', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req, reply) => {
    const body = parse(ChangePasswordBody, req.body)
    const me = req.auth.user
    if (!(await verifyPassword(me.passwordHash, body.currentPassword))) throw invalid({ currentPassword: 'Senha atual incorreta.' })
    assertStrongPassword(body.newPassword, me, 'newPassword')
    await db.update(users).set({ passwordHash: await hashPassword(body.newPassword) }).where(eq(users.id, me.id))
    // A reset link mailed before the change must not undo it.
    await db.delete(emailTokens).where(and(eq(emailTokens.userId, me.id), eq(emailTokens.kind, 'password_reset')))
    await revoked(ctx, me.id, await deleteOthers(req), 'password changed')
    return reply.code(204).send()
  })

  app.post('/auth/verify-email/resend', { config: { rateLimit: { max: 3, timeWindow: '15 minutes' } } }, async (req, reply) => {
    if (!req.auth.user.emailVerifiedAt) sendVerification(ctx, req.auth.user)
    return reply.code(204).send()
  })

  app.delete('/auth/sessions', async (req, reply) => {
    await revoked(ctx, req.auth.user.id, await deleteOthers(req), 'session revoked')
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
      ...sessionDevice(s.userAgent, s.clientInfo),
    }))
  })

  app.delete<{ Params: { id: string } }>('/auth/sessions/:id', async (req, reply) => {
    const id = idParam(req.params.id)
    const deleted = await db.delete(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, req.auth.user.id)))
      .returning({ id: sessions.id })
    if (!deleted.length) throw notFound('Sessão não encontrada.')
    await revoked(ctx, req.auth.user.id, deleted, 'session revoked')
    return reply.code(204).send()
  })
}
