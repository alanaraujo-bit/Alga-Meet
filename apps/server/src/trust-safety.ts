/**
 * Platform moderation: account actions (warn / suspend / ban / lift) enforced everywhere (login, sessions, gateway,
 * voice), appeal tokens, attachment quarantine with evidence preservation, staff role grants.
 * Policies: docs/trust-safety/README.md; illegal content: docs/trust-safety/csam-process.md.
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import {
  APPEAL_WINDOW_DAYS, GatewayClose, REMOVED_USER_ID, uuidv7,
  type AccountAction, type AccountActionReason, type AccountActionType, type AccountRestriction, type AppealView,
  type QuarantinedFile, type StaffRole,
} from '@alga/shared'
import { and, eq, isNull, ne, or } from 'drizzle-orm'
import { channelAudience } from './access.js'
import type { Ctx } from './app.js'
import { isRestricted, revokeAllSessions } from './auth.js'
import type { Db, Tx } from './db/index.js'
import {
  accountActions, appeals, attachments, messages, quarantinedFiles, staffAuditLog, storageDeletions, users,
  type AccountActionRow, type AppealRow, type QuarantinedFileRow, type UserRow,
} from './db/schema.js'
import type { EmailKind } from './email.js'
import { enforcementMail } from './email-templates.js'
import { HttpError, badRequest, conflict, invalid, notFound, safeErr } from './errors.js'
import { DAY_MS, REASON_LABELS, dateBr } from './legal.js'
import { loadChannel, messageFor, messageViews } from './views.js'

const APPEAL_WINDOW_MS = APPEAL_WINDOW_DAYS * DAY_MS
const APPEAL_TOKEN_TTL_MS = 60 * 60 * 1000
const MISSING = 'original object missing'
const iso = (d: Date | null) => d?.toISOString() ?? null
/**
 * What the affected user is told. A csam action is shown as 'other' and never e-mailed: naming it would tip off a
 * suspect before the authority acts (Termos 8.4 allows withholding; docs/trust-safety/csam-process.md, section 6).
 */
const shownReason = (r: AccountActionReason): AccountActionReason => (r === 'csam' ? 'other' : r)

export const appealDeadline = (a: Pick<AccountActionRow, 'type' | 'createdAt'>): Date | null =>
  a.type === 'lift' ? null : new Date(a.createdAt.getTime() + APPEAL_WINDOW_MS)

export const appealView = (a: AppealRow): AppealView => ({
  id: a.id, actionId: a.actionId, status: a.status, createdAt: a.createdAt.toISOString(), decidedAt: iso(a.decidedAt),
})

export function accountActionView(a: AccountActionRow, appeal?: AppealRow, now = Date.now()): AccountAction {
  const deadline = appealDeadline(a)
  return {
    id: a.id, type: a.type, reason: shownReason(a.reason), until: iso(a.until), createdAt: a.createdAt.toISOString(),
    appealDeadline: deadline && deadline.getTime() > now ? deadline.toISOString() : null,
    appeal: appeal ? appealView(appeal) : null,
  }
}

export const quarantineView = (q: QuarantinedFileRow): QuarantinedFile => ({
  id: q.id, attachmentId: q.attachmentId, messageId: q.messageId, channelId: q.channelId, authorId: q.authorId,
  filename: q.filename, contentType: q.contentType, size: q.size, sha256: q.sha256, reportId: q.reportId, staffId: q.staffId,
  evidenceStored: q.evidenceStoredAt !== null && q.purgedAt === null && q.releasedAt === null, authorityProtocol: q.authorityProtocol,
  receiptConfirmedAt: iso(q.receiptConfirmedAt), purgedAt: iso(q.purgedAt), releasedAt: iso(q.releasedAt), createdAt: q.createdAt.toISOString(),
})

/** 403 for a suspended/banned account; clients read ApiError.error.restriction. */
export function restrictedError(r: AccountRestriction): HttpError {
  const why = REASON_LABELS[r.reason]
  const msg = r.type === 'banned'
    ? `Sua conta foi encerrada por ${why}.`
    : `Sua conta está suspensa${r.until ? ` até ${dateBr(new Date(r.until))}` : ''} por ${why}.`
  const appeal = r.appealStatus === 'open' ? ' Seu recurso está em análise.' : r.appealDeadline && !r.appealStatus ? ' Você pode contestar a decisão.' : ''
  return new HttpError('forbidden', msg + appeal, undefined, undefined, { restriction: r })
}

/** Staff roles are granted only here (scripts/grant-staff.ts), never through the API. The grant is audit-logged. */
export async function setStaffRole(db: Db, username: string, role: StaffRole | null): Promise<UserRow> {
  const [u] = await db.update(users).set({ staffRole: role }).where(eq(users.username, username.trim().toLowerCase())).returning()
  if (!u || u.id === REMOVED_USER_ID) throw new Error(`user not found: ${username}`)
  await db.insert(staffAuditLog).values({
    id: uuidv7(), staffId: null, method: 'CLI', route: 'scripts/grant-staff.ts', body: { userId: u.id, username: u.username, staffRole: role }, status: 0,
  })
  return u
}

export class TrustSafety {
  private timer: NodeJS.Timeout | undefined
  private sweeping: Promise<void> | undefined

  constructor(private readonly ctx: Ctx) {}

  // The files secret, domain-separated: required (and random-per-process in dev) like every server HMAC.
  private mac(msg: string): string {
    return createHmac('sha256', this.ctx.config.files.secret).update(msg).digest('base64url')
  }

  /** Proves a correct login of a restricted account for 1 h; accepted only by POST /appeals. */
  appealToken(userId: string, now = Date.now()): string {
    const exp = Math.floor((now + APPEAL_TOKEN_TTL_MS) / 1000)
    return `${userId}.${exp}.${this.mac(`appeal:${userId}:${exp}`)}`
  }

  verifyAppealToken(token: string, now = Date.now()): string | null {
    const [userId, exp, sig, extra] = token.split('.')
    if (!userId || !exp || !sig || extra !== undefined || !(Number(exp) * 1000 > now)) return null
    const want = Buffer.from(this.mac(`appeal:${userId}:${exp}`))
    const got = Buffer.from(sig)
    return got.length === want.length && timingSafeEqual(got, want) ? userId : null
  }

  /** The account's current suspension/ban, or null. `withToken` only right after the password was checked. */
  async restrictionOf(u: UserRow, withToken = false): Promise<AccountRestriction | null> {
    if (!isRestricted(u)) return null
    const { db } = this.ctx
    const [action] = u.restrictionId ? await db.select().from(accountActions).where(eq(accountActions.id, u.restrictionId)) : []
    const [appeal] = action ? await db.select().from(appeals).where(eq(appeals.actionId, action.id)) : []
    const deadline = action ? appealDeadline(action) : null
    const appealable = !!deadline && deadline.getTime() > Date.now()
    return {
      type: u.bannedAt ? 'banned' : 'suspended',
      actionId: action?.id ?? null,
      reason: shownReason(action?.reason ?? 'other'),
      createdAt: iso(action?.createdAt ?? null),
      until: u.bannedAt ? null : iso(u.suspendedUntil),
      appealDeadline: appealable ? deadline.toISOString() : null,
      appealStatus: appeal?.status ?? null,
      appealToken: withToken && appealable && !appeal ? this.appealToken(u.id) : null,
    }
  }

  /** E-mails go only to verified addresses (an unverified one may belong to someone else, B5). */
  notify(u: Pick<UserRow, 'id' | 'email' | 'emailVerifiedAt'>, kind: EmailKind, content: { subject: string; text: string; html: string }): void {
    if (u.emailVerifiedAt && u.id !== REMOVED_USER_ID) this.ctx.mail.send({ to: u.email, kind, ...content })
  }

  /**
   * Records and enforces an account action. suspend/ban: every session deleted, sockets closed with ACCOUNT_RESTRICTED,
   * voice left (LiveKit removeParticipant); login answers 403 with the restriction until it ends. lift: ends the current
   * suspension/ban (an 'underage' one also forgets the declared birth date and cancels the scheduled deletion).
   * The user is e-mailed the category and the appeal deadline (`deletionOn` only adds a line to that e-mail).
   */
  async applyAction(a: {
    userId: string; type: AccountActionType; reason: AccountActionReason; until?: Date | null; note?: string
    reportId?: string | null; staffId?: string | null; deletionOn?: Date
  }): Promise<AccountActionRow> {
    const { db } = this.ctx
    if (a.userId === REMOVED_USER_ID) throw badRequest('Esta conta já foi excluída.')
    if (a.staffId && a.staffId === a.userId) throw badRequest('Você não pode aplicar uma medida à sua própria conta.')
    const [target] = await db.select().from(users).where(eq(users.id, a.userId))
    if (!target) throw notFound('Usuário não encontrado.')
    const now = new Date()
    if (a.type === 'suspend' && !(a.until && a.until > now)) throw invalid({ until: 'Informe até quando a conta fica suspensa (no futuro).' })
    if (a.type === 'suspend' && target.bannedAt) throw conflict('Esta conta já está encerrada.')
    if (a.type === 'lift' && !isRestricted(target)) throw conflict('Esta conta não tem suspensão nem banimento em vigor.')
    const action = await db.transaction(async (tx) => {
      const [row] = await tx.insert(accountActions).values({
        id: uuidv7(), userId: a.userId, type: a.type, reason: a.reason, until: a.type === 'suspend' ? a.until! : null,
        note: a.note ?? '', reportId: a.reportId ?? null, staffId: a.staffId ?? null,
      }).returning()
      if (a.type === 'suspend') {
        await tx.update(users).set({ suspendedUntil: a.until!, restrictionId: row!.id }).where(eq(users.id, a.userId))
      } else if (a.type === 'ban') {
        await tx.update(users).set({ bannedAt: now, restrictionId: row!.id }).where(eq(users.id, a.userId))
      } else if (a.type === 'lift') {
        const [current] = target.restrictionId
          ? await tx.select({ reason: accountActions.reason }).from(accountActions).where(eq(accountActions.id, target.restrictionId))
          : []
        const underage = current?.reason === 'underage'
          ? { birthDate: null, birthDateSetAt: null, deletionRequestedAt: null, deletionPurgeAfter: null, deletionMessages: null }
          : {}
        await tx.update(users).set({ suspendedUntil: null, bannedAt: null, restrictionId: null, ...underage }).where(eq(users.id, a.userId))
      }
      return row!
    })
    if (a.type === 'suspend' || a.type === 'ban') {
      await revokeAllSessions(this.ctx, a.userId, GatewayClose.ACCOUNT_RESTRICTED, a.type === 'ban' ? 'account banned' : 'account suspended')
    }
    if (a.type !== 'lift' && a.reason !== 'csam') {
      const deadline = appealDeadline(action)
      this.notify(target, 'enforcement', enforcementMail(a.type, REASON_LABELS[a.reason], {
        until: a.until && a.type === 'suspend' ? dateBr(a.until) : null,
        appealBy: deadline ? dateBr(deadline) : null,
        deletionOn: a.deletionOn ? dateBr(a.deletionOn) : null,
      }))
    }
    this.ctx.log.info({ actionId: action.id, userId: a.userId, type: a.type, reason: a.reason, staffId: a.staffId ?? null }, 'trust-safety: account action')
    return action
  }

  /** Deletes a message for everyone (staff removal): attachments queued by the cascade, MESSAGE_DELETE to the channel. */
  async removeMessage(messageId: string): Promise<boolean> {
    const { db, hub, files } = this.ctx
    const [m] = await db.select().from(messages).where(eq(messages.id, messageId))
    if (!m) return false
    const ch = await loadChannel(db, m.channelId)
    const audience = ch ? await channelAudience(db, ch.row, ch.recipientIds) : []
    await db.delete(messages).where(eq(messages.id, m.id))
    files.kick()
    hub.dispatch(audience, 'MESSAGE_DELETE', { id: m.id, channelId: m.channelId })
    return true
  }

  /**
   * Takes an attachment out of circulation at once: its row goes (GET /files/:id → 404; MESSAGE_UPDATE without it), its
   * object is held out of the deletion queue and copied to `evidence/<attachmentId>` (never served by any route), then
   * the original is deleted. Reversible (release). Done by staff (`staffId`), it also puts the author's account on legal
   * hold (Decreto 12.880/2026 art. 39 §1); a csam report alone never does (docs/trust-safety/csam-process.md, section 2).
   * Idempotent: an attachment already quarantined returns its record; an unknown one returns null.
   */
  async quarantine(attachmentId: string, o: { reportId?: string | null; staffId?: string | null; note?: string } = {}): Promise<QuarantinedFileRow | null> {
    const { db } = this.ctx
    const existing = async () => (await db.select().from(quarantinedFiles).where(eq(quarantinedFiles.attachmentId, attachmentId)))[0] ?? null
    const [row] = await db.select({ a: attachments, m: messages }).from(attachments)
      .innerJoin(messages, eq(messages.id, attachments.messageId)).where(eq(attachments.id, attachmentId))
    if (!row) return existing()
    const { a, m } = row
    const q = await db.transaction(async (tx) => {
      const [q] = await tx.insert(quarantinedFiles).values({
        id: uuidv7(), attachmentId: a.id, messageId: m.id, channelId: m.channelId, authorId: m.authorId, filename: a.filename,
        contentType: a.contentType, size: a.size, width: a.width, height: a.height, originalKey: a.storageKey, evidenceKey: `evidence/${a.id}`,
        reportId: o.reportId ?? null, staffId: o.staffId ?? null, note: o.note ?? '',
      }).onConflictDoNothing().returning()
      if (!q) return null
      await tx.delete(attachments).where(eq(attachments.id, a.id))
      // The delete trigger queued the object; it stays until the evidence copy exists.
      await tx.delete(storageDeletions).where(eq(storageDeletions.key, a.storageKey))
      if (o.staffId) await this.hold(tx, m.authorId)
      return q
    })
    if (!q) return existing()
    this.ctx.log.warn({ quarantineId: q.id, attachmentId, reportId: q.reportId, staffId: q.staffId }, 'trust-safety: attachment quarantined')
    await this.announceMessage(m.id)
    await this.storeEvidence(q)
    return existing()
  }

  /** Legal hold (never purged, access logs kept): staff decisions only. */
  async hold(db: Db | Tx, userId: string): Promise<void> {
    if (userId === REMOVED_USER_ID) return
    await db.update(users).set({ legalHoldAt: new Date() }).where(and(eq(users.id, userId), isNull(users.legalHoldAt)))
  }

  /** MESSAGE_UPDATE of a message as it is now (its attachments changed). */
  private async announceMessage(messageId: string): Promise<void> {
    const { db, hub, files } = this.ctx
    const [msg] = await db.select().from(messages).where(eq(messages.id, messageId))
    const ch = msg && await loadChannel(db, msg.channelId)
    if (!msg || !ch) return
    const [view] = await messageViews(db, [msg])
    hub.dispatch(await channelAudience(db, ch.row, ch.recipientIds), 'MESSAGE_UPDATE', (uid) => messageFor(view!, uid, (id, u) => files.url(id, u)))
  }

  /** Streams an object to `tmp`, hashing it; null when it does not exist. */
  private async spool(key: string, tmp: string): Promise<{ size: number; sha256: string } | null> {
    const src = await this.ctx.files.storage.get(key)
    if (!src) return null
    const hash = createHash('sha256')
    let size = 0
    await pipeline(src, async function* (s: AsyncIterable<Buffer>) {
      for await (const c of s) {
        hash.update(c)
        size += c.length
        yield c
      }
    }, createWriteStream(tmp))
    return { size, sha256: hash.digest('hex') }
  }

  /**
   * False positive (POST /admin/quarantine/:id/release): the preserved copy goes back into its message as a new
   * attachment (new id, so it can be quarantined again; MESSAGE_UPDATE), then the copy is deleted. The record stays
   * with released_at. A legal hold is left as is (staff lift it). Refused once purged, twice, or while the copy is pending.
   */
  async release(q: QuarantinedFileRow): Promise<QuarantinedFileRow> {
    const { db, files, log } = this.ctx
    if (q.purgedAt || q.releasedAt) throw conflict('Este arquivo já foi liberado ou apagado.')
    const missing = q.copyError === MISSING
    if (!q.evidenceStoredAt && !missing) throw conflict('A cópia de preservação ainda não terminou. Tente de novo em instantes.')
    const id = uuidv7()
    const key = `attachments/${q.channelId}/${id}`
    let stored = false
    if (!missing) {
      const tmp = join(tmpdir(), `alga-release-${randomUUID()}`)
      try {
        const got = await this.spool(q.evidenceKey, tmp)
        if (!got) throw new Error('evidence object missing')
        // Queued for deletion until the row below keeps it (the upload pattern of Files.store).
        await files.store([{ key, path: tmp, contentType: q.contentType, ...got }])
        stored = true
      } finally {
        await rm(tmp, { force: true })
      }
    }
    const row = await db.transaction(async (tx) => {
      const [row] = await tx.update(quarantinedFiles).set({ releasedAt: new Date() })
        .where(and(eq(quarantinedFiles.id, q.id), isNull(quarantinedFiles.releasedAt), isNull(quarantinedFiles.purgedAt))).returning()
      if (!row) throw conflict('Este arquivo já foi liberado ou apagado.')
      const [m] = stored ? await tx.select({ id: messages.id }).from(messages).where(eq(messages.id, q.messageId)) : []
      if (m) {
        await tx.insert(attachments).values({
          id, messageId: m.id, storageKey: key, filename: q.filename, contentType: q.contentType, size: q.size, width: q.width, height: q.height,
        })
        await files.keep(tx, [key])
      }
      await files.queueDelete(tx, [q.evidenceKey])
      return { ...row, restored: !!m }
    })
    files.kick()
    log.warn({ quarantineId: q.id, attachmentId: row.restored ? id : null }, 'trust-safety: quarantine released (false positive)')
    if (row.restored) await this.announceMessage(q.messageId)
    return row
  }

  /** Copies the held original to the evidence key (recording its SHA-256), then lets the original go. Retried by the sweep. */
  async storeEvidence(q: QuarantinedFileRow): Promise<void> {
    const { db, files, log } = this.ctx
    const tmp = join(tmpdir(), `alga-evidence-${randomUUID()}`)
    try {
      const got = await this.spool(q.originalKey, tmp)
      if (!got) {
        log.error({ quarantineId: q.id }, 'quarantine: original object missing, nothing could be preserved')
        await db.update(quarantinedFiles).set({ copyError: MISSING }).where(eq(quarantinedFiles.id, q.id))
        return
      }
      const { size, sha256 } = got
      await files.storage.put(q.evidenceKey, tmp, { size, sha256, contentType: 'application/octet-stream' })
      await db.update(quarantinedFiles).set({ evidenceStoredAt: new Date(), sha256, copyError: null }).where(eq(quarantinedFiles.id, q.id))
      await files.queueDelete(db, [q.originalKey])
      files.kick()
    } catch (err) {
      log.error({ err: safeErr(err), quarantineId: q.id }, 'quarantine: evidence copy failed; the original is held, will retry')
      await db.update(quarantinedFiles).set({ copyError: String((err as Error)?.message ?? err).slice(0, 500) })
        .where(eq(quarantinedFiles.id, q.id)).catch(() => {})
    } finally {
      await rm(tmp, { force: true })
    }
  }

  /**
   * The authority confirmed receipt (Decreto 12.880/2026, art. 39 §2): the material itself is deleted from storage; the
   * record (hash, ids, protocol) and the account's other data stay under the legal hold.
   */
  async purgeEvidence(q: QuarantinedFileRow): Promise<void> {
    const { db, files } = this.ctx
    await db.transaction(async (tx) => {
      await files.queueDelete(tx, [q.evidenceKey, q.originalKey])
      await tx.update(quarantinedFiles).set({ receiptConfirmedAt: new Date(), purgedAt: new Date() }).where(eq(quarantinedFiles.id, q.id))
    })
    files.kick()
  }

  /** Sweep: evidence copies that failed for a transient reason. */
  sweep(): Promise<void> {
    this.sweeping ??= (async () => {
      const due = await this.ctx.db.select().from(quarantinedFiles).where(and(
        isNull(quarantinedFiles.evidenceStoredAt), isNull(quarantinedFiles.purgedAt),
        or(isNull(quarantinedFiles.copyError), ne(quarantinedFiles.copyError, MISSING)),
      )).limit(20)
      for (const q of due) await this.storeEvidence(q)
    })().finally(() => { this.sweeping = undefined })
    return this.sweeping
  }

  start(intervalMs = 60_000): void {
    this.timer = setInterval(() => {
      void this.sweep().catch((err: unknown) => this.ctx.log.error({ err: safeErr(err) }, 'trust-safety sweep failed'))
    }, intervalMs)
    this.timer.unref()
  }

  async stop(): Promise<void> {
    clearInterval(this.timer)
    await this.sweeping?.catch(() => {})
  }
}
