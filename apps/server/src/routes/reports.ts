/** Reports by users, their enforcement history and appeals (contract in packages/shared/src/trust-safety.ts). */
import {
  CreateAppealBody, CreateReportBody, Permission, REMOVED_USER_ID, uuidv7,
  type AccountAction, type AppealView, type ReportReceipt,
} from '@alga/shared'
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { requireChannel } from '../access.js'
import type { Ctx } from '../app.js'
import { bearerToken, resolveToken } from '../auth.js'
import { accountActions, appeals, attachments, messages, reports, spaceMembers, spaces, users } from '../db/schema.js'
import { HttpError, badRequest, conflict, notFound, parse } from '../errors.js'
import { REPORT_PRIORITY } from '../legal.js'
import { accountActionView, appealDeadline, appealView } from '../trust-safety.js'
import { loadChannel, messageViews, publicUser } from '../views.js'

interface Target {
  targetUserId: string | null
  spaceId: string | null
  channelId: string | null
  snapshot: Record<string, unknown>
  attachmentIds: string[]
}

export function reportPublicRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, trust } = ctx

  // Public: a suspended or banned account has no session, only the appeal token its login returned.
  // Per IP (public route): several accounts can share one (CGNAT); one appeal per action anyway.
  app.post('/appeals', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply): Promise<AppealView> => {
    const body = parse(CreateAppealBody, req.body)
    let userId: string | null = null
    if (body.appealToken) {
      userId = trust.verifyAppealToken(body.appealToken)
    } else {
      const token = bearerToken(req)
      userId = (token ? await resolveToken(db, token) : null)?.user.id ?? null
    }
    if (!userId) throw new HttpError('unauthorized', 'Entre de novo com seu e-mail e senha para contestar.')
    const [action] = await db.select().from(accountActions).where(and(eq(accountActions.id, body.actionId), eq(accountActions.userId, userId)))
    const deadline = action ? appealDeadline(action) : null
    if (!action || !deadline) throw notFound('Medida não encontrada.')
    if (deadline.getTime() <= Date.now()) throw badRequest('O prazo para contestar esta decisão terminou.')
    const [row] = await db.insert(appeals).values({ id: uuidv7(), actionId: action.id, userId, message: body.message }).onConflictDoNothing().returning()
    if (!row) throw conflict('Você já contestou esta decisão. Aguarde a análise.')
    ctx.log.info({ appealId: row.id, actionId: action.id }, 'trust-safety: appeal received')
    reply.code(201)
    return appealView(row)
  })
}

export function reportRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, trust } = ctx

  /** Resolves the target the reporter can see and snapshots it (the evidence survives a later deletion). */
  async function target(me: string, type: CreateReportBody['targetType'], id: string): Promise<Target> {
    if (type === 'message') {
      const [m] = await db.select().from(messages).where(eq(messages.id, id))
      // Same 404 whether it does not exist or the reporter cannot see it (no oracle on other channels).
      const visible = m && await requireChannel(db, m.channelId, me, Permission.VIEW_CHANNELS).then(() => true, () => false)
      if (!m || !visible) throw notFound('Mensagem não encontrada.')
      if (m.authorId === me) throw badRequest('Você não pode denunciar a própria mensagem.')
      const [view] = await messageViews(db, [m])
      const ch = await loadChannel(db, m.channelId)
      const files = await db.select({ id: attachments.id }).from(attachments).where(eq(attachments.messageId, m.id))
      return {
        targetUserId: m.authorId, spaceId: ch?.row.spaceId ?? null, channelId: m.channelId, attachmentIds: files.map((f) => f.id),
        snapshot: {
          id: m.id, content: m.content, author: view!.author, createdAt: view!.createdAt, editedAt: view!.editedAt, replyToId: m.replyToId,
          channel: { id: m.channelId, type: ch?.row.type, name: ch?.row.name ?? '' },
          attachments: view!.files,
        },
      }
    }
    if (type === 'user') {
      if (id === me) throw badRequest('Você não pode denunciar a si mesmo.')
      const [u] = await db.select().from(users).where(eq(users.id, id))
      if (!u || u.id === REMOVED_USER_ID) throw notFound('Usuário não encontrado.')
      return { targetUserId: u.id, spaceId: null, channelId: null, attachmentIds: [], snapshot: { user: publicUser(u) } }
    }
    const [s] = await db.select().from(spaces).where(eq(spaces.id, id))
    if (!s) throw notFound('Espaço não encontrado.')
    if (s.ownerId === me) throw badRequest('Você não pode denunciar o próprio espaço.')
    const [c] = await db.select({ n: count() }).from(spaceMembers).where(eq(spaceMembers.spaceId, s.id))
    return {
      targetUserId: s.ownerId, spaceId: s.id, channelId: null, attachmentIds: [],
      snapshot: { space: { id: s.id, name: s.name, iconUrl: s.iconUrl, ownerId: s.ownerId, memberCount: c?.n ?? 0, createdAt: s.createdAt.toISOString() } },
    }
  }

  app.post('/reports', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply): Promise<ReportReceipt> => {
    const body = parse(CreateReportBody, req.body)
    const me = req.auth.user.id
    const t = await target(me, body.targetType, body.targetId)
    const [row] = await db.insert(reports).values({
      id: uuidv7(), reporterId: me, targetType: body.targetType, targetId: body.targetId, targetUserId: t.targetUserId,
      spaceId: t.spaceId, channelId: t.channelId, reason: body.reason, details: body.details ?? '', snapshot: t.snapshot,
      priority: REPORT_PRIORITY[body.reason],
    }).onConflictDoNothing().returning()
    if (!row) {
      // Same reporter, same target, still open: one report.
      const [open] = await db.select().from(reports).where(and(eq(reports.reporterId, me), eq(reports.targetType, body.targetType),
        eq(reports.targetId, body.targetId), eq(reports.status, 'open')))
      if (!open) throw conflict('Tente novamente.')
      return { id: open.id, createdAt: open.createdAt.toISOString() }
    }
    if (body.reason === 'csam') {
      // docs/trust-safety/csam-process.md: out of circulation at once, preserved, account kept (legal hold).
      for (const id of t.attachmentIds) await trust.quarantine(id, { reportId: row.id })
      if (t.targetUserId && t.targetUserId !== REMOVED_USER_ID) {
        await db.update(users).set({ legalHoldAt: new Date() }).where(and(eq(users.id, t.targetUserId), isNull(users.legalHoldAt)))
      }
      ctx.log.warn({ reportId: row.id, attachments: t.attachmentIds.length }, 'trust-safety: csam report received, highest priority')
    }
    reply.code(201)
    return { id: row.id, createdAt: row.createdAt.toISOString() }
  })

  app.get('/users/@me/actions', async (req): Promise<AccountAction[]> => {
    const rows = await db.select().from(accountActions).where(eq(accountActions.userId, req.auth.user.id)).orderBy(desc(accountActions.createdAt))
    const ap = rows.length ? await db.select().from(appeals).where(inArray(appeals.actionId, rows.map((r) => r.id))) : []
    return rows.map((r) => accountActionView(r, ap.find((a) => a.actionId === r.id)))
  })
}
