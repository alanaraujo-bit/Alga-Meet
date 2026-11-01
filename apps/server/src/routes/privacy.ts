/** Age gate, consent, account deletion and data export routes (src/privacy.ts; contract in packages/shared/src/trust-safety.ts). */
import {
  APPEAL_WINDOW_DAYS, AcceptTermsBody, BirthDateBody, DeleteAccountBody, ExportDownloadBody, MIN_AGE, ageOn, uuidv7,
  type AccountDeletionScheduled, type DataExport, type DataExportDownload, type DataExportRequested, type LegalInfo, type Me,
} from '@alga/shared'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../app.js'
import { requireVerifiedEmail, verifyPassword } from '../auth.js'
import { consentRecords, dataExports, users } from '../db/schema.js'
import { FILE_HEADERS } from '../files.js'
import { HttpError, conflict, forbidden, idParam, invalid, notFound, parse } from '../errors.js'
import { DAY_MS, LEGAL_VERSIONS, TERMS_VERSION } from '../legal.js'
import { restrictedError } from '../trust-safety.js'
import { meView } from '../views.js'
import { perMinute } from './users.js'

export const UNDER_AGE_MESSAGE = `O Alga Meet é para pessoas com ${MIN_AGE} anos ou mais.`
export const oldTerms = () => invalid({ termsVersion: 'Os Termos de Uso mudaram. Leia e aceite a versão atual.' })

const ExportQuery = z.object({ exp: z.coerce.number().int().positive(), sig: z.string().min(1).max(128) })

export function privacyPublicRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { config, db, files, privacy } = ctx
  const legal = config.legal.url

  app.get('/legal', async (): Promise<LegalInfo> => ({
    termsVersion: TERMS_VERSION,
    termsUrl: `${legal}/termos-de-uso`,
    privacyUrl: `${legal}/politica-de-privacidade`,
    guidelinesUrl: `${legal}/diretrizes-da-comunidade`,
    minAge: MIN_AGE,
    signupRequiresBirthDate: config.legal.requireBirthDate,
    ...(LEGAL_VERSIONS[0]!.changeSummary ? { changeSummary: LEGAL_VERSIONS[0]!.changeSummary } : {}),
  }))

  // Opened from the e-mail (browser, no auth header): the signature binds export and expiry.
  app.get<{ Params: { id: string } }>('/exports/:id', { config: perMinute(30) }, async (req, reply) => {
    const id = idParam(req.params.id)
    const q = parse(ExportQuery, req.query)
    if (!privacy.verifyExport(id, q.exp, q.sig)) throw forbidden('Link expirado ou inválido.')
    const [row] = await db.select().from(dataExports).where(eq(dataExports.id, id))
    if (row?.status !== 'ready' || !row.storageKey || !row.expiresAt || row.expiresAt <= new Date()) throw notFound('Exportação expirada. Peça outra no app.')
    const body = await files.storage.get(row.storageKey)
    if (!body) throw notFound('Exportação expirada. Peça outra no app.')
    return reply.headers({
      ...FILE_HEADERS,
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="alga-meet-dados-${row.createdAt.toISOString().slice(0, 10)}.zip"`,
      'cache-control': 'private, no-store',
    }).send(body)
  })
}

export function privacyRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, hub, privacy, trust } = ctx
  const me = (u: typeof users.$inferSelect): Me => meView(u, ctx.config.files.maxAttachmentBytes)

  // Accounts created before the age gate declare once. Under 16: suspended at once (sessions revoked, appealable) and
  // deleted after the appeal window unless an appeal wins (Termos 3.1; Política 10).
  app.patch('/users/@me/birth-date', { config: perMinute(5) }, async (req): Promise<Me> => {
    const { birthDate } = parse(BirthDateBody, req.body)
    const [after] = await db.update(users).set({ birthDate, birthDateSetAt: new Date() })
      .where(and(eq(users.id, req.auth.user.id), isNull(users.birthDate))).returning()
    if (!after) throw conflict('A data de nascimento já foi informada. Para corrigir, fale com o suporte.')
    if (ageOn(birthDate) < MIN_AGE) {
      const deletionOn = new Date(Date.now() + APPEAL_WINDOW_DAYS * DAY_MS)
      await db.update(users).set({ deletionRequestedAt: new Date(), deletionPurgeAfter: deletionOn, deletionMessages: 'delete' }).where(eq(users.id, after.id))
      await trust.applyAction({ userId: after.id, type: 'suspend', reason: 'underage', until: deletionOn, deletionOn })
      const [row] = await db.select().from(users).where(eq(users.id, after.id))
      throw restrictedError((await trust.restrictionOf(row!, true))!)
    }
    hub.dispatch([after.id], 'ME_UPDATE', me(after))
    return me(after)
  })

  app.post('/users/@me/accept-terms', { config: perMinute(10) }, async (req): Promise<Me> => {
    const { termsVersion } = parse(AcceptTermsBody, req.body)
    if (termsVersion !== TERMS_VERSION) throw oldTerms()
    // Already on it: no second consent row (repeated calls would only grow the history).
    if (req.auth.user.termsVersion === TERMS_VERSION) return me(req.auth.user)
    const now = new Date()
    const after = await db.transaction(async (tx) => {
      await tx.insert(consentRecords).values({ id: uuidv7(), userId: req.auth.user.id, termsVersion, acceptedAt: now })
      const [row] = await tx.update(users).set({ termsVersion, termsAcceptedAt: now }).where(eq(users.id, req.auth.user.id)).returning()
      return row!
    })
    hub.dispatch([after.id], 'ME_UPDATE', me(after))
    return me(after)
  })

  app.delete('/users/@me', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req, reply): Promise<AccountDeletionScheduled> => {
    const body = parse(DeleteAccountBody, req.body)
    const user = req.auth.user
    if (!(await verifyPassword(user.passwordHash, body.password))) throw invalid({ password: 'Senha incorreta.' })
    // A renewing subscription would keep being charged after the account is gone.
    try {
      await ctx.billing.cancel(user.id, { final: true })
    } catch (err) {
      if (!(err instanceof HttpError && err.code === 'not_found')) throw err
    }
    const purgeAfter = await privacy.requestDeletion(user, body.messages)
    reply.code(202)
    return { purgeAfter: purgeAfter.toISOString(), messages: body.messages }
  })

  // The link goes only to the verified e-mail: a stolen session alone cannot take the data out.
  app.post('/users/@me/export', { config: perMinute(3) }, async (req, reply): Promise<DataExportRequested> => {
    const user = req.auth.user
    requireVerifiedEmail(user, 'exportar seus dados')
    if (await privacy.lastExportWithin(user.id)) {
      throw new HttpError('rate_limited', 'Você já pediu uma cópia dos seus dados nas últimas 24 horas. O link vai para o seu e-mail.')
    }
    const [row] = await db.insert(dataExports).values({ id: uuidv7(), userId: user.id }).returning()
    privacy.kickExports()
    reply.code(202)
    return { id: row!.id, status: 'pending', createdAt: row!.createdAt.toISOString() }
  })

  // Status only: the in-app link takes the password again (below); the e-mailed 7-day one still goes out.
  app.get('/users/@me/exports', { config: perMinute(30) }, async (req): Promise<DataExport[]> => {
    const rows = await db.select().from(dataExports).where(eq(dataExports.userId, req.auth.user.id)).orderBy(desc(dataExports.createdAt)).limit(20)
    return rows.map((r) => privacy.exportView(r))
  })

  // A stolen session alone cannot take the data out: the password again, a 10-minute link, an access-log row.
  app.post<{ Params: { id: string } }>('/users/@me/exports/:id/download', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req): Promise<DataExportDownload> => {
    const { password } = parse(ExportDownloadBody, req.body)
    const user = req.auth.user
    if (!(await verifyPassword(user.passwordHash, password))) throw invalid({ password: 'Senha incorreta.' })
    const [row] = await db.select().from(dataExports).where(and(eq(dataExports.id, idParam(req.params.id)), eq(dataExports.userId, user.id)))
    if (!row) throw notFound('Exportação não encontrada.')
    const view = privacy.exportView(row)
    if (view.status === 'queued' || view.status === 'processing') throw conflict('Sua exportação ainda está sendo preparada.')
    if (view.status !== 'ready' || !row.expiresAt) throw notFound('Exportação expirada. Peça outra no app.')
    await privacy.recordUse(user.id, req.ip, req.headers['user-agent'], 'export_download')
    req.log.info({ exportId: row.id }, 'privacy: export download link issued')
    return { downloadUrl: privacy.downloadLink(row.id, row.expiresAt) }
  })
}
