/**
 * Staff API (/admin/*). Needs users.staff_role (granted only by scripts/grant-staff.ts); access logs need 'admin'.
 * Every call is written to staff_audit_log before the handler runs (no unlogged action) and gets its status after.
 */
import {
  AccountActionBody, PatchAdminUserBody, PatchAppealBody, PatchQuarantineBody, PatchReportBody, QuarantineBody,
  REMOVED_USER_ID, uuidv7,
  type AccessLogEntry, type AccountAction, type AdminAppeal, type AdminReport, type QuarantinedFile, type StaffRole,
} from '@alga/shared'
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../app.js'
import { isRestricted } from '../auth.js'
import {
  accessLogs, accountActions, appeals, deletedAccounts, quarantinedFiles, reports, spaces, staffAuditLog, users,
  type AppealRow, type ReportRow,
} from '../db/schema.js'
import { appealDecisionMail } from '../email-templates.js'
import { badRequest, conflict, forbidden, idParam, invalid, notFound, parse } from '../errors.js'
import { accountActionView, quarantineView } from '../trust-safety.js'
import { deleteSpace } from './spaces.js'

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Minimum staff role for an /admin route (default 'moderator'). */
    staff?: StaffRole
  }
}

const iso = (d: Date | null) => d?.toISOString() ?? null
const limitQ = z.coerce.number().int().min(1).max(500).default(100)

const reportView = (r: ReportRow): AdminReport => ({
  id: r.id, status: r.status, priority: r.priority, reason: r.reason, details: r.details, targetType: r.targetType,
  targetId: r.targetId, targetUserId: r.targetUserId, spaceId: r.spaceId, channelId: r.channelId, reporterId: r.reporterId,
  snapshot: r.snapshot, action: r.action, staffId: r.staffId, staffNote: r.staffNote, createdAt: r.createdAt.toISOString(),
  resolvedAt: iso(r.resolvedAt),
})

export function adminRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, trust } = ctx
  const audits = new WeakMap<FastifyRequest, string>()
  const staffId = (req: FastifyRequest) => req.auth.user.id
  const until = (s: string | undefined) => (s ? new Date(s) : null)
  /** Only an admin may act on another staff account (a moderator cannot ban the team). */
  async function assertMayAct(req: FastifyRequest, userId: string): Promise<void> {
    const [t] = await db.select({ role: users.staffRole }).from(users).where(eq(users.id, userId))
    if (t?.role && req.auth.user.staffRole !== 'admin') throw forbidden('Só um administrador pode aplicar medidas a contas da equipe.')
  }

  app.addHook('preHandler', async (req) => {
    const role = req.auth.user.staffRole
    if (!role) throw forbidden('Acesso restrito à equipe do Alga Meet.')
    if (req.routeOptions.config.staff === 'admin' && role !== 'admin') throw forbidden('Apenas administradores.')
    const [row] = await db.insert(staffAuditLog).values({
      id: uuidv7(), staffId: req.auth.user.id, method: req.method, route: req.routeOptions.url ?? req.url,
      params: req.params ?? null, query: req.query ?? null, body: req.body ?? null,
    }).returning({ id: staffAuditLog.id })
    audits.set(req, row!.id)
  })
  app.addHook('onResponse', async (req, reply) => {
    const id = audits.get(req)
    if (id) await db.update(staffAuditLog).set({ status: reply.statusCode }).where(eq(staffAuditLog.id, id))
  })

  // ---- reports ----------------------------------------------------------------------------------------------------

  app.get('/admin/reports', async (req): Promise<AdminReport[]> => {
    const q = parse(z.object({ status: z.enum(['open', 'resolved', 'dismissed']).default('open'), limit: limitQ }), req.query)
    const rows = await db.select().from(reports).where(eq(reports.status, q.status))
      .orderBy(desc(reports.priority), q.status === 'open' ? asc(reports.createdAt) : desc(reports.resolvedAt)).limit(q.limit)
    return rows.map(reportView)
  })

  app.patch<{ Params: { id: string } }>('/admin/reports/:id', async (req): Promise<AdminReport> => {
    const body = parse(PatchReportBody, req.body)
    const [r] = await db.select().from(reports).where(eq(reports.id, idParam(req.params.id)))
    if (!r) throw notFound('Denúncia não encontrada.')
    if (r.status !== 'open') throw conflict('Esta denúncia já foi analisada.')
    if (body.status === 'dismissed' && body.action !== 'none') throw invalid({ action: 'Denúncia arquivada não tem medida.' })
    switch (body.action) {
      case 'remove_content':
        if (r.targetType === 'message') await trust.removeMessage(r.targetId)
        else if (r.targetType === 'space') {
          const [space] = await db.select().from(spaces).where(eq(spaces.id, r.targetId))
          if (space) await deleteSpace(ctx, space)
        } else throw invalid({ action: 'Para um perfil, use warn, suspend ou ban.' })
        break
      case 'warn': case 'suspend': case 'ban':
        if (!r.targetUserId || r.targetUserId === REMOVED_USER_ID) throw invalid({ action: 'A conta denunciada não existe mais.' })
        await assertMayAct(req, r.targetUserId)
        await trust.applyAction({ userId: r.targetUserId, type: body.action, reason: r.reason, until: until(body.until), note: body.note, reportId: r.id, staffId: staffId(req) })
        break
      case 'none':
        break
    }
    const [row] = await db.update(reports).set({
      status: body.status, action: body.action, staffId: staffId(req), staffNote: body.note ?? null, resolvedAt: new Date(),
    }).where(eq(reports.id, r.id)).returning()
    return reportView(row!)
  })

  // ---- accounts ---------------------------------------------------------------------------------------------------

  app.post<{ Params: { id: string } }>('/admin/users/:id/actions', async (req, reply): Promise<AccountAction> => {
    const body = parse(AccountActionBody, req.body)
    await assertMayAct(req, idParam(req.params.id))
    const row = await trust.applyAction({
      userId: idParam(req.params.id), type: body.type, reason: body.reason, until: until(body.until), note: body.note, staffId: staffId(req),
    })
    reply.code(201)
    return accountActionView(row)
  })

  app.patch<{ Params: { id: string } }>('/admin/users/:id', async (req, reply) => {
    const { legalHold } = parse(PatchAdminUserBody, req.body)
    const id = idParam(req.params.id)
    if (id === REMOVED_USER_ID) throw badRequest('Conta reservada.')
    const updated = await db.update(users).set({ legalHoldAt: legalHold ? new Date() : null }).where(eq(users.id, id)).returning({ id: users.id })
    if (!updated.length) throw notFound('Usuário não encontrado.')
    return reply.code(204).send()
  })

  // ---- appeals ----------------------------------------------------------------------------------------------------

  async function appealViews(rows: AppealRow[]): Promise<AdminAppeal[]> {
    const actions = rows.length ? await db.select().from(accountActions).where(inArray(accountActions.id, rows.map((r) => r.actionId))) : []
    return rows.map((a) => {
      const act = actions.find((x) => x.id === a.actionId)!
      return {
        id: a.id, actionId: a.actionId, status: a.status, createdAt: a.createdAt.toISOString(), decidedAt: iso(a.decidedAt),
        userId: a.userId, message: a.message, staffNote: a.staffNote,
        action: { type: act.type, reason: act.reason, until: iso(act.until), createdAt: act.createdAt.toISOString(), reportId: act.reportId },
      }
    })
  }

  app.get('/admin/appeals', async (req): Promise<AdminAppeal[]> => {
    const q = parse(z.object({ status: z.enum(['open', 'upheld', 'rejected']).default('open'), limit: limitQ }), req.query)
    return appealViews(await db.select().from(appeals).where(eq(appeals.status, q.status)).orderBy(asc(appeals.createdAt)).limit(q.limit))
  })

  app.patch<{ Params: { id: string } }>('/admin/appeals/:id', async (req): Promise<AdminAppeal> => {
    const body = parse(PatchAppealBody, req.body)
    const [a] = await db.select().from(appeals).where(eq(appeals.id, idParam(req.params.id)))
    if (!a) throw notFound('Recurso não encontrado.')
    if (a.status !== 'open') throw conflict('Este recurso já foi decidido.')
    if (a.userId === staffId(req)) throw forbidden('Outra pessoa da equipe precisa decidir o seu recurso.')
    const [user] = await db.select().from(users).where(eq(users.id, a.userId))
    // Upheld: lift the action when it is the account's current suspension/ban (a warning has nothing to lift).
    if (body.status === 'upheld' && user && isRestricted(user) && user.restrictionId === a.actionId) {
      const [act] = await db.select().from(accountActions).where(eq(accountActions.id, a.actionId))
      await trust.applyAction({ userId: a.userId, type: 'lift', reason: act!.reason, note: body.note, staffId: staffId(req) })
    }
    const [row] = await db.update(appeals).set({ status: body.status, staffId: staffId(req), staffNote: body.note ?? null, decidedAt: new Date() })
      .where(eq(appeals.id, a.id)).returning()
    if (user) trust.notify(user, 'appeal_decision', appealDecisionMail(body.status === 'upheld'))
    return (await appealViews([row!]))[0]!
  })

  // ---- quarantine (docs/trust-safety/csam-process.md) -------------------------------------------------------------

  app.post<{ Params: { id: string } }>('/admin/attachments/:id/quarantine', async (req, reply): Promise<QuarantinedFile> => {
    const body = parse(QuarantineBody, req.body)
    const q = await trust.quarantine(idParam(req.params.id), { reportId: body.reportId, staffId: staffId(req), note: body.note })
    if (!q) throw notFound('Anexo não encontrado.')
    reply.code(201)
    return quarantineView(q)
  })

  app.get('/admin/quarantine', async (req): Promise<QuarantinedFile[]> => {
    const q = parse(z.object({ limit: limitQ }), req.query)
    return (await db.select().from(quarantinedFiles).orderBy(desc(quarantinedFiles.createdAt)).limit(q.limit)).map(quarantineView)
  })

  app.patch<{ Params: { id: string } }>('/admin/quarantine/:id', async (req): Promise<QuarantinedFile> => {
    const body = parse(PatchQuarantineBody, req.body)
    const [q] = await db.select().from(quarantinedFiles).where(eq(quarantinedFiles.id, idParam(req.params.id)))
    if (!q) throw notFound('Registro não encontrado.')
    if (body.authorityProtocol) await db.update(quarantinedFiles).set({ authorityProtocol: body.authorityProtocol }).where(eq(quarantinedFiles.id, q.id))
    if (body.receiptConfirmed && !q.purgedAt) {
      if (!body.authorityProtocol && !q.authorityProtocol) throw invalid({ authorityProtocol: 'Informe o protocolo da comunicação à autoridade.' })
      await trust.purgeEvidence(q)
    }
    const [row] = await db.select().from(quarantinedFiles).where(eq(quarantinedFiles.id, q.id))
    return quarantineView(row!)
  })

  // ---- access logs (Marco Civil art. 15: sigilo; admin only) ------------------------------------------------------

  app.get('/admin/access-logs', { config: { staff: 'admin' } }, async (req): Promise<AccessLogEntry[]> => {
    const q = parse(z.object({
      userId: z.uuid().optional(), username: z.string().trim().toLowerCase().min(1).max(64).optional(),
      from: z.iso.datetime().optional(), to: z.iso.datetime().optional(), limit: z.coerce.number().int().min(1).max(5000).default(1000),
    }), req.query)
    let userId = q.userId
    if (!userId && q.username) {
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.username, q.username))
      const [gone] = u ? [] : await db.select({ id: deletedAccounts.userId }).from(deletedAccounts).where(eq(deletedAccounts.username, q.username)).orderBy(desc(deletedAccounts.deletedAt)).limit(1)
      userId = u?.id ?? gone?.id
    }
    if (!userId) throw invalid({ userId: 'Informe userId ou username de uma conta existente ou excluída há menos de 6 meses.' })
    const rows = await db.select().from(accessLogs).where(and(
      eq(accessLogs.userId, userId),
      q.from ? gte(accessLogs.at, new Date(q.from)) : undefined,
      q.to ? lte(accessLogs.at, new Date(q.to)) : undefined,
    )).orderBy(desc(accessLogs.at)).limit(q.limit)
    return rows.map((r) => ({ userId: r.userId, ip: r.ip, userAgentSha256: r.userAgentSha256, event: r.event, at: r.at.toISOString() }))
  })
}
