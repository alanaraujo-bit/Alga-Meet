/**
 * LGPD and Marco Civil duties: access logs (art. 15, 6 months), account deletion (7-day grace, then purge), data
 * export (zip in storage, signed e-mailed link) and the retention job. Policies: docs/trust-safety/README.md.
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  EXPORT_DOWNLOAD_TTL_MINUTES, GatewayClose, REMOVED_USER_ID, uuidv7, type DataExport, type DataExportStatus, type PublicUser,
} from '@alga/shared'
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, ne, notExists, notInArray, or, sql, type SQLWrapper } from 'drizzle-orm'
import { channelAudience, profileAudience, spaceMemberIds } from './access.js'
import type { Ctx } from './app.js'
import { revokeAllSessions, sha256Hex } from './auth.js'
import {
  accessLogs, accountActions, activityDays, activityEmails, activitySettings, appeals, attachments, channelRecipients, channels,
  consentRecords, dataExports, deletedAccounts, eventRsvps, events, memberRoles, messages, orders, reactions, relationships,
  reports, roles, sessions, spaceMembers, spaces, subscriptions, users, voiceNotifyPrefs, voiceSessions, voiceWeekly, weeklyRecaps,
  type DataExportRow, type UserRow,
} from './db/schema.js'
import { accountDeletedMail, dataExportMail, deletionCanceledMail, deletionScheduledMail } from './email-templates.js'
import { Quota } from './email.js'
import { safeErr } from './errors.js'
import { DAY_MS, DELETION_GRACE_MS, EXPORT_TTL_MS, ageBracketOf, dateBr, sixMonthsBefore } from './legal.js'
import { deleteSpace } from './routes/spaces.js'
import { privateChannelsOf, spaceView } from './views.js'
import { zip } from './zip.js'

/**
 * An open csam report against the account holds its purge until staff decide (the report alone never sets the legal
 * hold: docs/trust-safety/csam-process.md, section 2). Dismissing it lets the deletion proceed.
 */
const openCsamAgainst = (userId: string | SQLWrapper) =>
  and(eq(reports.targetUserId, userId), eq(reports.reason, 'csam'), eq(reports.status, 'open'))

/** Purge in 'delete' mode: MESSAGE_DELETE per message, this many per channel at a time, then a pause. */
const ANNOUNCE_BATCH = 100
const ANNOUNCE_PAUSE_MS = 100

/** Profile clients show for a purged account (USER_UPDATE with the old id; messages kept point to REMOVED_USER_ID). */
export const removedProfile = (id: string): PublicUser =>
  ({ id, username: 'deleted-user', displayName: 'Usuário removido', avatarUrl: null, accentColor: null, bio: '' })

const EXPORT_STATUS: Record<DataExportRow['status'], DataExportStatus> = {
  pending: 'queued', building: 'processing', ready: 'ready', expired: 'expired', failed: 'failed',
}

const README = `Exportação de dados do Alga Meet (LGPD, art. 18, II e V)

dados.json traz, em JSON:
- account: sua conta (inclui a data de nascimento declarada e a versão dos Termos aceita) e consents (histórico de aceites);
- sessions, relationships, spaces, privateChannels;
- messages: as mensagens que você escreveu, com a lista dos anexos. Cada anexo tem um link assinado que vale até a
  mesma data do link desta exportação e só funciona enquanto você ainda tiver acesso ao canal;
- reactions, billing (assinaturas e pedidos; nunca dados de cartão);
- accessLogs: registros de acesso dos últimos 6 meses (Marco Civil, art. 15);
- moderation: medidas aplicadas à sua conta, seus recursos e as denúncias que você fez;
- retention: eventos que você criou, suas respostas (Vou/Talvez/Não), suas configurações de atividade, seus dias de
  uso (últimos 90 dias), suas sessões de voz (últimos 35 dias), seus minutos por semana e seus resumos semanais
  (sem a lista de pessoas, que é dado de terceiros), os e-mails de atividade enviados e suas escolhas de aviso.

Não incluímos denúncias feitas contra você nem quem as fez (direitos de terceiros). Dúvidas: encarregado de dados,
na Política de Privacidade.
`

export class Privacy {
  private timer: NodeJS.Timeout | undefined
  private sweeping: Promise<void> | undefined
  // shortcut: per-process memory, like the rate limits; one row per (user, IP, app) and day reaches the DB.
  private seen = new Set<string>()
  private seenDay = ''
  // Deletion scheduled / canceled mails to the account's own address: 1 of each per 24 h (DELETE + login can loop).
  private readonly selfMails = new Quota(1, DAY_MS)

  constructor(private readonly ctx: Ctx) {}

  /**
   * Marco Civil art. 15 record: every login, plus the first use per UTC day of each (user, IP, user agent) by a session
   * (REST or gateway). A failure is logged, never fails the request.
   */
  async recordUse(userId: string, ip: string, userAgent: string | undefined, event: 'login' | 'session_use' | 'export_download', now = new Date()): Promise<void> {
    // Package D: last seen and the "opened" bit (src/activity/activity.ts; once per user and BRT day).
    if (event !== 'export_download') await this.ctx.activity.seen(userId, now)
    const day = now.toISOString().slice(0, 10)
    const userAgentSha256 = sha256Hex(userAgent ?? '')
    const key = `${userId}|${ip}|${userAgentSha256}`
    if (event === 'session_use') {
      if (day !== this.seenDay) {
        this.seen.clear()
        this.seenDay = day
      }
      if (this.seen.has(key)) return
      this.seen.add(key)
    }
    try {
      await this.ctx.db.insert(accessLogs).values({ id: uuidv7(), userId, ip, userAgentSha256, event, day, at: now }).onConflictDoNothing()
    } catch (err) {
      this.seen.delete(key)
      this.ctx.log.error({ err: safeErr(err) }, 'access log not recorded')
    }
  }

  // ---- account deletion -------------------------------------------------------------------------------------------

  /** DELETE /users/@me after the password check: schedules the purge and logs the account out everywhere. */
  async requestDeletion(user: UserRow, mode: 'anonymize' | 'delete', now = new Date()): Promise<Date> {
    const purgeAfter = new Date(now.getTime() + DELETION_GRACE_MS)
    await this.ctx.db.update(users).set({ deletionRequestedAt: now, deletionPurgeAfter: purgeAfter, deletionMessages: mode }).where(eq(users.id, user.id))
    await revokeAllSessions(this.ctx, user.id, GatewayClose.SESSION_REVOKED, 'account deletion requested')
    if (this.selfMails.take(`scheduled:${user.id}`)) this.ctx.trust.notify(user, 'account_deletion', deletionScheduledMail(dateBr(purgeAfter)))
    return purgeAfter
  }

  /** A successful login during the grace period. */
  async cancelDeletion(user: UserRow): Promise<void> {
    await this.ctx.db.update(users).set({ deletionRequestedAt: null, deletionPurgeAfter: null, deletionMessages: null }).where(eq(users.id, user.id))
    if (this.selfMails.take(`canceled:${user.id}`)) this.ctx.trust.notify(user, 'account_deletion', deletionCanceledMail())
  }

  /** Member who inherits a space: highest role, then the longest member; never a banned or leaving account. */
  private async heirOf(spaceId: string, leaving: string): Promise<string | undefined> {
    const top = sql<number>`coalesce(max(${roles.position}), 0)`.mapWith(Number)
    const [heir] = await this.ctx.db.select({ userId: spaceMembers.userId, top }).from(spaceMembers)
      .innerJoin(users, eq(users.id, spaceMembers.userId))
      .leftJoin(memberRoles, and(eq(memberRoles.spaceId, spaceMembers.spaceId), eq(memberRoles.userId, spaceMembers.userId)))
      .leftJoin(roles, eq(roles.id, memberRoles.roleId))
      .where(and(
        eq(spaceMembers.spaceId, spaceId), ne(spaceMembers.userId, leaving),
        isNull(users.bannedAt), isNull(users.deletionRequestedAt),
      ))
      .groupBy(spaceMembers.userId, spaceMembers.joinedAt)
      .orderBy(desc(top), asc(spaceMembers.joinedAt)).limit(1)
    return heir?.userId
  }

  /**
   * Purges a due account (deletion_purge_after passed, no legal hold). Owned spaces go to the heir or are deleted;
   * messages are anonymized (author REMOVED_USER_ID, attachments deleted) or deleted; payment records move to
   * REMOVED_USER_ID (fiscal retention without the identity); the user row goes and its cascade takes sessions,
   * relationships, memberships, reactions, read states, consents, exports, invites. Access logs, moderation records and
   * a username + e-mail hash tombstone stay for 6 months. Safe to re-run after a crash halfway.
   */
  async purgeAccount(userId: string, now = new Date()): Promise<boolean> {
    const { db, hub, files, voice, log } = this.ctx
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    if (!user || user.id === REMOVED_USER_ID || !user.deletionPurgeAfter || user.deletionPurgeAfter > now || user.legalHoldAt) return false
    // An appeal still waiting for staff (e.g. a contested under-16 declaration) keeps the account.
    const [pending] = await db.select({ id: appeals.id }).from(appeals).where(and(eq(appeals.userId, userId), eq(appeals.status, 'open'))).limit(1)
    if (pending) return false
    const [reported] = await db.select({ id: reports.id }).from(reports).where(openCsamAgainst(userId)).limit(1)
    if (reported) return false

    for (const space of await db.select().from(spaces).where(eq(spaces.ownerId, userId))) {
      const heir = await this.heirOf(space.id, userId)
      if (!heir) {
        await deleteSpace(this.ctx, space)
        continue
      }
      const [row] = await db.update(spaces).set({ ownerId: heir }).where(eq(spaces.id, space.id)).returning()
      hub.dispatch(await spaceMemberIds(db, space.id), 'SPACE_UPDATE', spaceView(row!))
    }

    // Audiences, before the rows that define them go.
    const memberOf = await db.select({ spaceId: spaceMembers.spaceId }).from(spaceMembers).where(eq(spaceMembers.userId, userId))
    const coMembers = new Map<string, string[]>()
    for (const { spaceId } of memberOf) coMembers.set(spaceId, (await spaceMemberIds(db, spaceId)).filter((id) => id !== userId))
    const relatedTo = (await db.select({ id: relationships.userId }).from(relationships).where(eq(relationships.targetId, userId))).map((r) => r.id)
    const audience = (await profileAudience(db, userId)).filter((id) => id !== userId)
    const avatarKey = files.imageKey('avatars', userId, user.avatarUrl)
    // Cascaded with the row below: announced like any other removal so open clients do not keep them.
    const ownReactions = await db.select({ messageId: reactions.messageId, emoji: reactions.emoji, channelId: messages.channelId, spaceId: channels.spaceId })
      .from(reactions).innerJoin(messages, eq(messages.id, reactions.messageId)).innerJoin(channels, eq(channels.id, messages.channelId))
      .where(eq(reactions.userId, userId))
    const dms = await privateChannelsOf(db, userId)
    const audiences = new Map<string, string[]>()
    const audienceOf = async (c: { id: string; spaceId: string | null }) => {
      let to = audiences.get(c.id)
      if (!to) audiences.set(c.id, to = (await channelAudience(db, c)).filter((id) => id !== userId))
      return to
    }
    // 'delete': announced after the transaction, to the audiences as they are now (DMs lose their recipient rows).
    const deleted = new Map<string, { to: string[]; ids: string[] }>()
    if (user.deletionMessages === 'delete') {
      const own = await db.select({ id: messages.id, channelId: messages.channelId, spaceId: channels.spaceId }).from(messages)
        .innerJoin(channels, eq(channels.id, messages.channelId)).where(eq(messages.authorId, userId)).orderBy(asc(messages.id))
      for (const m of own) {
        let entry = deleted.get(m.channelId)
        if (!entry) deleted.set(m.channelId, entry = { to: await audienceOf({ id: m.channelId, spaceId: m.spaceId }), ids: [] })
        entry.ids.push(m.id)
      }
    }

    await db.transaction(async (tx) => {
      const own = tx.select({ id: messages.id }).from(messages).where(eq(messages.authorId, userId))
      if (user.deletionMessages === 'delete') {
        await tx.delete(messages).where(eq(messages.authorId, userId)) // attachments cascade, trigger queues the objects
      } else {
        await tx.delete(attachments).where(inArray(attachments.messageId, own))
        await tx.update(messages).set({ authorId: REMOVED_USER_ID }).where(eq(messages.authorId, userId))
      }
      // restrict FKs on purpose: payment rows are fiscal records; they lose the identity, never the amounts.
      await tx.update(subscriptions).set({ userId: REMOVED_USER_ID }).where(eq(subscriptions.userId, userId))
      await tx.update(orders).set({ userId: REMOVED_USER_ID }).where(eq(orders.userId, userId))
      const exportKeys = (await tx.select({ key: dataExports.storageKey }).from(dataExports)
        .where(and(eq(dataExports.userId, userId), isNotNull(dataExports.storageKey)))).map((e) => e.key!)
      await files.queueDelete(tx, [...(avatarKey ? [avatarKey] : []), ...exportKeys])
      await tx.insert(deletedAccounts).values({ userId, username: user.username, emailSha256: sha256Hex(user.email), deletedAt: now }).onConflictDoNothing()
      await tx.delete(users).where(eq(users.id, userId))
      // DMs and groups nobody is left in.
      await tx.delete(channels).where(and(isNull(channels.spaceId), notExists(
        tx.select({ one: sql`1` }).from(channelRecipients).where(eq(channelRecipients.channelId, channels.id)),
      )))
    })
    files.kick()
    await voice.disconnect(userId)
    for (const [spaceId, ids] of coMembers) hub.dispatch(ids, 'MEMBER_REMOVE', { spaceId, userId })
    hub.dispatch(relatedTo, 'RELATIONSHIP_REMOVE', { userId })
    hub.dispatch(audience, 'USER_UPDATE', removedProfile(userId))
    for (const c of dms) {
      const rest = (c.recipientIds ?? []).filter((id) => id !== userId)
      if (rest.length) hub.dispatch(rest, 'CHANNEL_UPDATE', { ...c, recipientIds: rest })
    }
    for (const r of ownReactions) {
      hub.dispatch(await audienceOf({ id: r.channelId, spaceId: r.spaceId }), 'REACTION_REMOVE', { messageId: r.messageId, channelId: r.channelId, userId, emoji: r.emoji })
    }
    void this.announceDeleted(deleted).catch((err: unknown) => log.error({ err: safeErr(err), userId }, 'privacy: MESSAGE_DELETE announcement failed'))
    this.ctx.trust.notify(user, 'account_deletion', accountDeletedMail())
    log.info({ userId, messages: user.deletionMessages }, 'privacy: account purged')
    return true
  }

  /**
   * MESSAGE_DELETE for the messages a 'delete' purge removed: ANNOUNCE_BATCH per channel, then a pause, in the
   * background. shortcut: the contract has no bulk delete event, so one per message; add one if purges get slow.
   */
  private async announceDeleted(byChannel: Map<string, { to: string[]; ids: string[] }>): Promise<void> {
    for (const [channelId, { to, ids }] of byChannel) {
      for (let i = 0; i < ids.length; i += ANNOUNCE_BATCH) {
        if (i) await sleep(ANNOUNCE_PAUSE_MS, undefined, { ref: false })
        if (this.ctx.hub.closing) return
        for (const id of ids.slice(i, i + ANNOUNCE_BATCH)) this.ctx.hub.dispatch(to, 'MESSAGE_DELETE', { id, channelId })
      }
    }
  }

  // ---- data export ------------------------------------------------------------------------------------------------

  private mac(id: string, exp: number): string {
    return createHmac('sha256', this.ctx.config.files.secret).update(`export:${id}:${exp}`).digest('base64url')
  }

  exportUrl(id: string, expiresAt: Date): string {
    const exp = Math.floor(expiresAt.getTime() / 1000)
    return `${this.ctx.config.publicUrl}/api/v1/exports/${id}?exp=${exp}&sig=${this.mac(id, exp)}`
  }

  /** GET /users/@me/exports: status only (downloadUrl stays null); the in-app link needs the password (downloadLink). */
  exportView(e: DataExportRow, now = Date.now()): DataExport {
    const live = e.status === 'ready' && e.expiresAt && e.expiresAt.getTime() > now
    const status = live || e.status !== 'ready' ? EXPORT_STATUS[e.status] : 'expired'
    return {
      id: e.id, status, createdAt: e.createdAt.toISOString(),
      expiresAt: status === 'failed' ? null : e.expiresAt?.toISOString() ?? null,
      downloadUrl: null,
    }
  }

  /** POST /users/@me/exports/:id/download, after the password check: EXPORT_DOWNLOAD_TTL_MINUTES, never past the zip. */
  downloadLink(id: string, zipExpiresAt: Date, now = Date.now()): string {
    return this.exportUrl(id, new Date(Math.min(zipExpiresAt.getTime(), now + EXPORT_DOWNLOAD_TTL_MINUTES * 60_000)))
  }

  verifyExport(id: string, exp: number, sig: string, now = Date.now()): boolean {
    if (exp * 1000 <= now) return false
    const want = Buffer.from(this.mac(id, exp))
    const got = Buffer.from(sig)
    return got.length === want.length && timingSafeEqual(got, want)
  }

  /** Everything the account holds (LGPD art. 18 II/V), in English keys; README.txt in the zip explains it in pt-BR. */
  async collect(userId: string, now: Date): Promise<Record<string, unknown>> {
    const { db, files } = this.ctx
    const [u] = await db.select().from(users).where(eq(users.id, userId))
    if (!u) throw new Error('export: user not found')
    const iso = (d: Date | null) => d?.toISOString() ?? null
    const [consents, sess, rels, memberships, ownMessages, ownReactions, subs, ords, logs, actions, myAppeals, myReports] = await Promise.all([
      db.select().from(consentRecords).where(eq(consentRecords.userId, userId)).orderBy(asc(consentRecords.acceptedAt)),
      db.select().from(sessions).where(eq(sessions.userId, userId)),
      db.select({ r: relationships, username: users.username }).from(relationships).innerJoin(users, eq(users.id, relationships.targetId)).where(eq(relationships.userId, userId)),
      db.select({ m: spaceMembers, s: spaces }).from(spaceMembers).innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId)).where(eq(spaceMembers.userId, userId)),
      // shortcut: the whole export is built in memory; stream to a temp file if accounts with ~10^6 messages appear.
      db.select({ m: messages, spaceId: channels.spaceId }).from(messages).innerJoin(channels, eq(channels.id, messages.channelId)).where(eq(messages.authorId, userId)).orderBy(asc(messages.id)),
      db.select().from(reactions).where(eq(reactions.userId, userId)),
      db.select().from(subscriptions).where(eq(subscriptions.userId, userId)),
      db.select().from(orders).where(eq(orders.userId, userId)),
      db.select().from(accessLogs).where(eq(accessLogs.userId, userId)).orderBy(asc(accessLogs.at)),
      db.select().from(accountActions).where(eq(accountActions.userId, userId)),
      db.select().from(appeals).where(eq(appeals.userId, userId)),
      db.select().from(reports).where(eq(reports.reporterId, userId)),
    ])
    const ids = ownMessages.map((r) => r.m.id)
    const files_: (typeof attachments.$inferSelect)[] = []
    for (let i = 0; i < ids.length; i += 1000) files_.push(...await db.select().from(attachments).where(inArray(attachments.messageId, ids.slice(i, i + 1000))))
    const roleRows = memberships.length
      ? await db.select({ spaceId: memberRoles.spaceId, name: roles.name }).from(memberRoles).innerJoin(roles, eq(roles.id, memberRoles.roleId)).where(eq(memberRoles.userId, userId))
      : []
    const ttl = Math.floor(EXPORT_TTL_MS / 1000)
    return {
      format: 'alga-meet-export/1',
      generatedAt: now.toISOString(),
      account: {
        id: u.id, email: u.email, emailVerified: u.emailVerifiedAt !== null, username: u.username, displayName: u.displayName,
        bio: u.bio, accentColor: u.accentColor, avatarUrl: u.avatarUrl, statusPreference: u.statusPreference,
        createdAt: u.createdAt.toISOString(), birthDate: u.birthDate, birthDateSetAt: iso(u.birthDateSetAt), ageBracket: ageBracketOf(u),
        termsVersion: u.termsVersion, termsAcceptedAt: iso(u.termsAcceptedAt), plan: u.plan,
        cosmetics: u.cosmetics, telemetryOptIn: u.telemetryOptIn, telemetryOptInAt: iso(u.telemetryOptInAt),
      },
      consents: consents.map((c) => ({ purpose: c.purpose, termsVersion: c.termsVersion, acceptedAt: c.acceptedAt.toISOString(), withdrawnAt: iso(c.withdrawnAt) })),
      sessions: sess.map((s) => ({ userAgent: s.userAgent, clientInfo: s.clientInfo, createdAt: s.createdAt.toISOString(), lastUsedAt: s.lastUsedAt.toISOString() })),
      relationships: rels.map(({ r, username }) => ({ userId: r.targetId, username, type: r.type, since: r.since.toISOString() })),
      spaces: memberships.map(({ m, s }) => ({
        id: s.id, name: s.name, owner: s.ownerId === userId, nickname: m.nickname, joinedAt: m.joinedAt.toISOString(),
        roles: roleRows.filter((r) => r.spaceId === s.id).map((r) => r.name),
      })),
      privateChannels: (await privateChannelsOf(db, userId)).map((c) => ({ id: c.id, type: c.type, recipientIds: c.recipientIds })),
      messages: ownMessages.map(({ m, spaceId }) => ({
        id: m.id, channelId: m.channelId, spaceId, content: m.content, createdAt: m.createdAt.toISOString(),
        editedAt: iso(m.editedAt), replyToId: m.replyToId,
        attachments: files_.filter((f) => f.messageId === m.id).map((f) => ({
          id: f.id, filename: f.filename, contentType: f.contentType, size: f.size, url: files.url(f.id, userId, now.getTime(), ttl),
        })),
      })),
      reactions: ownReactions.map((r) => ({ messageId: r.messageId, emoji: r.emoji, createdAt: r.createdAt.toISOString() })),
      billing: {
        subscriptions: subs.map((s) => ({ id: s.id, productId: s.productId, status: s.status, amountCents: s.amountCents, currency: s.currency, currentPeriodEnd: iso(s.currentPeriodEnd), createdAt: s.createdAt.toISOString() })),
        orders: ords.map((o) => ({ id: o.id, productId: o.productId, status: o.status, amountCents: o.amountCents, currency: o.currency, createdAt: o.createdAt.toISOString() })),
      },
      accessLogs: logs.map((l) => ({ event: l.event, ip: l.ip, at: l.at.toISOString() })),
      moderation: {
        actions: actions.map((a) => ({ id: a.id, type: a.type, reason: a.reason, until: iso(a.until), createdAt: a.createdAt.toISOString() })),
        appeals: myAppeals.map((a) => ({ actionId: a.actionId, message: a.message, status: a.status, createdAt: a.createdAt.toISOString(), decidedAt: iso(a.decidedAt) })),
        reportsMade: myReports.map((r) => ({ targetType: r.targetType, targetId: r.targetId, reason: r.reason, status: r.status, createdAt: r.createdAt.toISOString() })),
        falseReports: u.falseReports,
      },
      retention: await this.collectRetention(userId),
    }
  }

  /** Package D data (docs/retention/server.md). Recaps go without `people`: who others were with is not yours to take. */
  private async collectRetention(userId: string): Promise<Record<string, unknown>> {
    const { db } = this.ctx
    const iso = (d: Date) => d.toISOString()
    const [created, rsvps, settings, days, voice, weekly, recaps, mails, notify] = await Promise.all([
      db.select().from(events).where(eq(events.creatorId, userId)),
      db.select().from(eventRsvps).where(eq(eventRsvps.userId, userId)),
      db.select().from(activitySettings).where(eq(activitySettings.userId, userId)),
      db.select().from(activityDays).where(eq(activityDays.userId, userId)).orderBy(asc(activityDays.day)),
      db.select().from(voiceSessions).where(eq(voiceSessions.userId, userId)).orderBy(asc(voiceSessions.joinedAt)),
      db.select().from(voiceWeekly).where(eq(voiceWeekly.userId, userId)),
      db.select().from(weeklyRecaps).where(eq(weeklyRecaps.userId, userId)),
      db.select().from(activityEmails).where(eq(activityEmails.userId, userId)),
      db.select().from(voiceNotifyPrefs).where(eq(voiceNotifyPrefs.userId, userId)),
    ])
    const s = settings[0]
    return {
      eventsCreated: created.map((e) => ({ id: e.id, spaceId: e.spaceId, title: e.title, description: e.description, startsLocal: e.startsLocal, durationMinutes: e.durationMinutes, weekly: e.weekly, createdAt: iso(e.createdAt) })),
      rsvps: rsvps.map((r) => ({ eventId: r.eventId, status: r.status, emailReminder: r.emailReminder, updatedAt: iso(r.updatedAt) })),
      settings: s ? { showInOthersRecap: s.showInOthersRecap, metricsOptOut: s.metricsOptOut, activityEmail: s.activityEmail, lastSeenAt: s.lastSeenAt?.toISOString() ?? null } : null,
      activityDays: days.map((d) => ({ day: d.day, opened: !!(d.flags & 1), messaged: !!(d.flags & 2), voice3min: !!(d.flags & 4), voiceWithSomeone: !!(d.flags & 8) })),
      voiceSessions: voice.map((v) => ({ channelId: v.channelId, spaceId: v.spaceId, joinedAt: iso(v.joinedAt), leftAt: iso(v.leftAt) })),
      voiceWeekly: weekly.map((w) => ({ week: w.week, channelId: w.channelId, spaceId: w.spaceId, minutes: w.minutes, nights: w.nights })),
      weeklyRecaps: recaps.map((r) => ({ week: r.week, voiceMinutes: r.data.voiceMinutes, nights: r.data.nights, topChannel: r.data.topChannel ?? null, events: r.data.events })),
      activityEmails: mails.map((m) => ({ reason: m.reason, sentAt: iso(m.sentAt) })),
      voiceNotify: notify.map((n) => ({ scopeId: n.scopeId, kind: n.kind, notify: n.notify })),
    }
  }

  /** Builds one export (claimed so two sweeps never build the same one; a crashed build is retried after 30 min). */
  async buildExport(id: string, now = new Date()): Promise<void> {
    const { db, files, log } = this.ctx
    const stale = new Date(now.getTime() - 30 * 60_000)
    const [job] = await db.update(dataExports).set({ status: 'building', startedAt: now })
      .where(and(eq(dataExports.id, id), or(eq(dataExports.status, 'pending'), and(eq(dataExports.status, 'building'), lt(dataExports.startedAt, stale)))))
      .returning()
    if (!job) return
    const tmp = join(tmpdir(), `alga-export-${randomUUID()}`)
    try {
      const data = await this.collect(job.userId, now)
      const body = zip([{ name: 'LEIA-ME.txt', data: Buffer.from(README) }, { name: 'dados.json', data: Buffer.from(JSON.stringify(data, null, 2)) }], now)
      const key = `exports/${job.userId}/${job.id}.zip`
      await writeFile(tmp, body)
      await files.store([{ key, path: tmp, size: body.length, sha256: createHash('sha256').update(body).digest('hex'), contentType: 'application/zip' }])
      const expiresAt = new Date(now.getTime() + EXPORT_TTL_MS)
      await db.transaction(async (tx) => {
        await tx.update(dataExports).set({ status: 'ready', storageKey: key, readyAt: now, expiresAt }).where(eq(dataExports.id, job.id))
        await files.keep(tx, [key])
      })
      const [u] = await db.select().from(users).where(eq(users.id, job.userId))
      if (u) this.ctx.trust.notify(u, 'data_export', dataExportMail(this.exportUrl(job.id, expiresAt), dateBr(expiresAt)))
    } catch (err) {
      log.error({ err: safeErr(err), exportId: job.id }, 'data export failed')
      await db.update(dataExports).set({ status: 'failed', error: String((err as Error)?.message ?? err).slice(0, 500) }).where(eq(dataExports.id, job.id))
    } finally {
      await rm(tmp, { force: true })
    }
  }

  /** Builds pending exports in the background (after POST /users/@me/export). */
  kickExports(): void {
    void this.processExports(new Date()).catch((err: unknown) => this.ctx.log.error({ err: safeErr(err) }, 'data export processing failed'))
  }

  private async processExports(now: Date): Promise<void> {
    const stale = new Date(now.getTime() - 30 * 60_000)
    const due = await this.ctx.db.select({ id: dataExports.id }).from(dataExports)
      .where(or(eq(dataExports.status, 'pending'), and(eq(dataExports.status, 'building'), lt(dataExports.startedAt, stale)))).limit(5)
    for (const { id } of due) await this.buildExport(id, now)
  }

  // ---- retention job ----------------------------------------------------------------------------------------------

  /** Purges due accounts, then applies the retention table of docs/trust-safety/README.md. */
  async retention(now = new Date()): Promise<void> {
    const { db, files } = this.ctx
    const due = await db.select({ id: users.id }).from(users).where(and(
      lte(users.deletionPurgeAfter, now), isNull(users.legalHoldAt),
      notExists(db.select({ one: sql`1` }).from(appeals).where(and(eq(appeals.userId, users.id), eq(appeals.status, 'open')))),
      notExists(db.select({ one: sql`1` }).from(reports).where(openCsamAgainst(users.id))),
    )).limit(20)
    for (const { id } of due) {
      await this.purgeAccount(id, now).catch((err: unknown) => this.ctx.log.error({ err: safeErr(err), userId: id }, 'account purge failed; will retry'))
    }
    const cutoff = sixMonthsBefore(now)
    const held = db.select({ id: users.id }).from(users).where(isNotNull(users.legalHoldAt))
    await db.delete(accessLogs).where(and(lt(accessLogs.at, cutoff), notInArray(accessLogs.userId, held)))
    await db.delete(deletedAccounts).where(lt(deletedAccounts.deletedAt, cutoff))
    // Closed cases 6 months after the decision; csam ones only by hand (they follow the authority's case).
    await db.delete(reports).where(and(ne(reports.status, 'open'), lt(reports.resolvedAt, cutoff), ne(reports.reason, 'csam')))
    await db.delete(appeals).where(and(ne(appeals.status, 'open'), lt(appeals.decidedAt, cutoff)))
    // Enforcement history lives as long as the account (graduated sanctions); of purged accounts, 6 months.
    await db.delete(accountActions).where(and(lt(accountActions.createdAt, cutoff), notExists(
      db.select({ one: sql`1` }).from(users).where(eq(users.id, accountActions.userId)),
    )))
    const expired = await db.update(dataExports).set({ status: 'expired' })
      .where(and(eq(dataExports.status, 'ready'), lte(dataExports.expiresAt, now))).returning({ key: dataExports.storageKey })
    const keys = expired.map((e) => e.key).filter((k): k is string => !!k)
    if (keys.length) {
      await files.queueDelete(db, keys)
      files.kick()
    }
    await db.delete(dataExports).where(and(inArray(dataExports.status, ['expired', 'failed']), lt(dataExports.createdAt, new Date(now.getTime() - 30 * DAY_MS))))
  }

  sweep(now = new Date()): Promise<void> {
    this.sweeping ??= (async () => {
      await this.retention(now).catch((err: unknown) => this.ctx.log.error({ err: safeErr(err) }, 'retention job failed'))
      await this.processExports(now).catch((err: unknown) => this.ctx.log.error({ err: safeErr(err) }, 'data export processing failed'))
    })().finally(() => { this.sweeping = undefined })
    return this.sweeping
  }

  /** At most one export per user per 24 h (DB-backed, survives restarts); a failed one can be asked again. */
  async lastExportWithin(userId: string, now = new Date()): Promise<boolean> {
    const [row] = await this.ctx.db.select({ id: dataExports.id }).from(dataExports)
      .where(and(eq(dataExports.userId, userId), ne(dataExports.status, 'failed'), gt(dataExports.createdAt, new Date(now.getTime() - DAY_MS)))).limit(1)
    return !!row
  }

  start(intervalMs = 60_000): void {
    this.timer = setInterval(() => void this.sweep(), intervalMs)
    this.timer.unref()
  }

  async stop(): Promise<void> {
    clearInterval(this.timer)
    await this.sweeping?.catch(() => {})
  }
}
