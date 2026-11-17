/**
 * The admin app's API (contract: packages/shared/src/admin.ts). Registered on the same plugin as src/routes/admin.ts,
 * so every call already passed the staff check and is in staff_audit_log. Money is admin-only (config.staff).
 */
import {
  ADMIN_MONEY_KINDS, AdminEventsQuery, AdminGrowthQuery, AdminPeriodQuery, AdminUserSearchQuery, REMOVED_USER_ID, RegisterAdminDeviceBody,
  type AdminDevice, type AdminEvent, type AdminFeedback, type AdminGrowth, type AdminHealth, type AdminMe, type AdminOverview,
  type AdminUserDetail, type AdminUserSummary,
} from '@alga/shared'
import { and, count, desc, eq, ilike, lt, or, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { mayReceive } from '../admin/alerts.js'
import { Insights } from '../admin/insights.js'
import type { Ctx } from '../app.js'
import { isRestricted } from '../auth.js'
import {
  accountActions, activitySettings, adminDevices, adminEvents, feedback, gifts, orders, products, relationships, reports, sessions,
  spaceMembers, subscriptions, users, type UserRow,
} from '../db/schema.js'
import { sessionDevice } from '../devices.js'
import { idParam, notFound, parse } from '../errors.js'
import { ageBracketOf } from '../legal.js'
import { perMinute } from './users.js'

const admin = { staff: 'admin' as const }
const iso = (d: Date | null) => d?.toISOString() ?? null
const STREAM_PING_MS = 25_000

const summary = (u: UserRow): AdminUserSummary => ({
  id: u.id, username: u.username, displayName: u.displayName, email: u.email, plan: u.plan, createdAt: u.createdAt.toISOString(),
  staffRole: u.staffRole, state: u.bannedAt ? 'banned' : isRestricted(u) ? 'suspended' : u.deletionRequestedAt ? 'deleting' : 'ok',
})

export function adminAppRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, config, alerts } = ctx
  const insights = new Insights(ctx)

  app.get('/admin/me', async (req): Promise<AdminMe> => {
    const u = req.auth.user
    return { id: u.id, username: u.username, displayName: u.displayName, role: u.staffRole!, env: config.env, version: config.version, push: { fcm: !!alerts.fcm } }
  })

  app.get('/admin/overview', { config: { ...admin, ...perMinute(60) } }, async (req): Promise<AdminOverview> =>
    insights.overview(parse(AdminPeriodQuery, req.query).period))

  app.get('/admin/growth', { config: { ...admin, ...perMinute(60) } }, async (req): Promise<AdminGrowth> =>
    insights.growth(parse(AdminGrowthQuery, req.query).days))

  app.get('/admin/health', { config: perMinute(60) }, async (): Promise<AdminHealth> => insights.health())

  app.get('/admin/events', async (req): Promise<AdminEvent[]> => {
    const q = parse(AdminEventsQuery, req.query)
    const rows = await db.select().from(adminEvents).where(and(
      q.before ? lt(adminEvents.createdAt, new Date(q.before)) : undefined,
      req.auth.user.staffRole === 'admin' ? undefined : sql`${adminEvents.kind} not in (${sql.join(ADMIN_MONEY_KINDS.map((k) => sql`${k}`), sql`, `)})`,
    )).orderBy(desc(adminEvents.createdAt)).limit(q.limit)
    return alerts.views(rows)
  })

  // Server-sent events while the app is open (or in its "plantão" service): each new AdminEvent as `event: alert`.
  // Closed when the session goes away (logout, revoke, suspension) or the account stops being staff.
  app.get('/admin/stream', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { user, sessionId } = req.auth
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' })
    res.write(`: ok\n\n`)
    const off = alerts.subscribe(user.staffRole!, user.id, (e) => res.write(`event: alert\ndata: ${JSON.stringify(e)}\n\n`))
    const end = () => { clearInterval(ping); off(); res.end() }
    const ping = setInterval(() => {
      void db.select({ role: users.staffRole }).from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(eq(sessions.id, sessionId))
        .then(([s]) => (s?.role ? res.write(`: ping\n\n`) : end()), () => res.write(`: ping\n\n`))
    }, STREAM_PING_MS)
    req.raw.on('close', () => { clearInterval(ping); off() })
  })

  // ---- accounts -----------------------------------------------------------------------------------------------------

  app.get('/admin/users/search', { config: perMinute(120) }, async (req): Promise<AdminUserSummary[]> => {
    const { q } = parse(AdminUserSearchQuery, req.query)
    const term = q.replace(/^@/, '').toLowerCase()
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const byId = z.uuid().safeParse(term).success ? [eq(users.id, term)] : []
    const rows = await db.select().from(users).where(and(
      sql`${users.id} <> ${REMOVED_USER_ID}`,
      or(...byId, ilike(users.username, like), ilike(users.displayName, like), ilike(users.email, like)),
    )).orderBy(sql`case when ${users.username} = ${term} then 0 when ${users.username} like ${`${term}%`} then 1 else 2 end`, desc(users.createdAt)).limit(30)
    return rows.map(summary)
  })

  app.get<{ Params: { id: string } }>('/admin/users/:id', { config: perMinute(120) }, async (req): Promise<AdminUserDetail> => {
    const id = idParam(req.params.id)
    const [u] = await db.select().from(users).where(eq(users.id, id))
    if (!u || u.id === REMOVED_USER_ID) throw notFound('Usuário não encontrado.')
    const [seen] = await db.select({ at: activitySettings.lastSeenAt }).from(activitySettings).where(eq(activitySettings.userId, id))
    const [sp] = await db.select({ n: count() }).from(spaceMembers).where(eq(spaceMembers.userId, id))
    const [fr] = await db.select({ n: count() }).from(relationships).where(and(eq(relationships.userId, id), eq(relationships.type, 'friend')))
    const [ra] = await db.select({ n: count() }).from(reports).where(eq(reports.targetUserId, id))
    const [rb] = await db.select({ n: count() }).from(reports).where(eq(reports.reporterId, id))
    const sess = await db.select().from(sessions).where(eq(sessions.userId, id)).orderBy(desc(sessions.lastUsedAt)).limit(20)
    const acts = await db.select().from(accountActions).where(eq(accountActions.userId, id)).orderBy(desc(accountActions.createdAt)).limit(20)
    let billing: AdminUserDetail['billing'] = null
    if (req.auth.user.staffRole === 'admin') {
      const subs = await db.select().from(subscriptions).where(eq(subscriptions.userId, id)).orderBy(desc(subscriptions.createdAt))
      const ords = await db.select({ o: orders, giftId: gifts.id }).from(orders).leftJoin(gifts, eq(gifts.orderId, orders.id))
        .where(eq(orders.userId, id)).orderBy(desc(orders.createdAt)).limit(50)
      const names = new Map((await db.select({ id: products.id, name: products.name }).from(products)).map((p) => [p.id, p.name]))
      const lifetime = { brl: 0, usd: 0 }
      for (const { o } of ords) if (o.status === 'paid') lifetime[o.currency === 'USD' ? 'usd' : 'brl'] += o.amountCents
      for (const s of subs) if (s.kind === 'renewing' && s.startedAt && s.status !== 'canceled') lifetime[s.currency === 'USD' ? 'usd' : 'brl'] += s.amountCents
      billing = {
        lifetime,
        subscriptions: subs.map((s) => ({
          id: s.id, productId: s.productId, productName: names.get(s.productId) ?? s.productId, kind: s.kind, status: s.status, amountCents: s.amountCents, currency: s.currency, provider: s.provider,
          startedAt: iso(s.startedAt), currentPeriodEnd: iso(s.currentPeriodEnd), cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        })),
        orders: ords.map(({ o, giftId }) => ({
          id: o.id, productId: o.productId, productName: names.get(o.productId) ?? o.productId, status: o.status, amountCents: o.amountCents, currency: o.currency, provider: o.provider,
          createdAt: o.createdAt.toISOString(), paidAt: iso(o.paidAt), gift: !!giftId,
        })),
      }
    }
    return {
      ...summary(u),
      emailVerified: !!u.emailVerifiedAt, plusSince: iso(u.plusSince), lastSeenAt: iso(seen?.at ?? null),
      suspendedUntil: iso(u.suspendedUntil), bannedAt: iso(u.bannedAt), legalHold: !!u.legalHoldAt, deletionPurgeAfter: iso(u.deletionPurgeAfter),
      ageBracket: ageBracketOf(u),
      counts: { spaces: sp?.n ?? 0, friends: fr?.n ?? 0, reportsAgainst: ra?.n ?? 0, reportsBy: rb?.n ?? 0, falseReports: u.falseReports },
      // Device labels only (src/devices.ts): IPs stay in the admin-only access logs.
      sessions: sess.map((s) => ({ id: s.id, ...sessionDevice(s.userAgent, s.clientInfo), createdAt: s.createdAt.toISOString(), lastUsedAt: s.lastUsedAt.toISOString() })),
      actions: acts.map((a) => ({ id: a.id, type: a.type, reason: a.reason, until: iso(a.until), createdAt: a.createdAt.toISOString(), note: a.note || null })),
      billing,
    }
  })

  app.get('/admin/feedback', async (req): Promise<AdminFeedback[]> => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(40) }), req.query)
    const rows = await db.select({ f: feedback, username: users.username, displayName: users.displayName }).from(feedback)
      .innerJoin(users, eq(users.id, feedback.userId)).orderBy(desc(feedback.createdAt)).limit(limit)
    return rows.map(({ f, username, displayName }) => ({
      id: f.id, kind: f.kind, text: f.text, client: f.client, hasScreenshot: !!f.storageKey, createdAt: f.createdAt.toISOString(),
      user: { id: f.userId, username, displayName },
    }))
  })

  // ---- push devices -------------------------------------------------------------------------------------------------

  app.post('/admin/devices', { config: perMinute(20) }, async (req, reply): Promise<AdminDevice> => {
    const body = parse(RegisterAdminDeviceBody, req.body)
    const { user, sessionId } = req.auth
    const kinds = body.kinds ? [...new Set(body.kinds)].filter((k) => mayReceive(user.staffRole!, k)) : null
    // A token moves with the phone: re-registering under another session or account takes it over.
    const [row] = await db.insert(adminDevices).values({ token: body.token, userId: user.id, sessionId, platform: body.platform, kinds })
      .onConflictDoUpdate({ target: adminDevices.token, set: { userId: user.id, sessionId, platform: body.platform, kinds } }).returning()
    reply.code(201)
    return { token: row!.token, platform: row!.platform, kinds: row!.kinds, createdAt: row!.createdAt.toISOString() }
  })

  app.delete<{ Params: { token: string } }>('/admin/devices/:token', async (req, reply) => {
    await db.delete(adminDevices).where(and(eq(adminDevices.token, req.params.token), eq(adminDevices.userId, req.auth.user.id)))
    return reply.code(204).send()
  })

  app.post('/admin/devices/test', { config: perMinute(6) }, async (req) => ({ sent: await alerts.test(req.auth.user.id) }))

}
