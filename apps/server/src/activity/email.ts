/**
 * Activity e-mail (growth-plan §4.3): only with a consent row in consent_records, only adults with a verified address,
 * only when inactive for ACTIVITY_EMAIL_INACTIVE_DAYS+ and there is a concrete reason (an event coming up in one of
 * their spaces, a friend called them). At most 1 per ACTIVITY_EMAIL_MIN_GAP_DAYS and ACTIVITY_EMAIL_MAX_IN_60_DAYS in
 * 60 days; after that many without a visit it stops until they come back. One-click unsubscribe (signed link).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  ACTIVITY_EMAIL_INACTIVE_DAYS, ACTIVITY_EMAIL_MAX_IN_60_DAYS, ACTIVITY_EMAIL_MIN_GAP_DAYS, nextStart, uuidv7,
} from '@alga/shared'
import { and, eq, gt, inArray, isNotNull, isNull, lt, notInArray } from 'drizzle-orm'
import type { Ctx } from '../app.js'
import { isRestricted } from '../auth.js'
import {
  activityEmails, activitySettings, channelRecipients, consentRecords, eventRsvps, events, relationships, users, voiceSessions,
  type UserRow,
} from '../db/schema.js'
import { activityMail } from '../email-templates.js'
import { safeErr } from '../errors.js'
import { visibleSpaceIds } from '../events/events.js'
import { DAY_MS, ageBracketOf } from '../legal.js'

/** Version of the consent text shown next to the box (docs/legal/politica-diff-pacote-d.md, item f). */
export const ACTIVITY_EMAIL_CONSENT_VERSION = '2026-11-01'
/** An event counts as a reason when its next occurrence is this close. */
const EVENT_HORIZON_MS = 3 * DAY_MS

export const canGetActivityEmail = (u: UserRow) => ageBracketOf(u) === 'adult' && u.emailVerifiedAt !== null

const mac = (secret: string, userId: string) => createHmac('sha256', secret).update(`unsubscribe:activity_email:${userId}`).digest('base64url')

export const unsubscribeUrl = (ctx: Ctx, userId: string) =>
  `${ctx.config.publicUrl}/api/v1/email/unsubscribe?u=${userId}&sig=${mac(ctx.config.files.secret, userId)}`

export function verifyUnsubscribe(ctx: Ctx, userId: string, sig: string): boolean {
  const want = Buffer.from(mac(ctx.config.files.secret, userId))
  const got = Buffer.from(sig)
  return got.length === want.length && timingSafeEqual(got, want)
}

/** Turns the consent on (a new consent row) or off (the open row gets withdrawn_at). No-op when unchanged. */
export async function setActivityEmail(ctx: Ctx, userId: string, on: boolean, now = new Date()): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const [s] = await tx.select({ on: activitySettings.activityEmail }).from(activitySettings).where(eq(activitySettings.userId, userId)).for('update')
    if ((s?.on ?? false) === on) return
    await tx.insert(activitySettings).values({ userId, activityEmail: on }).onConflictDoUpdate({ target: activitySettings.userId, set: { activityEmail: on } })
    const open = and(eq(consentRecords.userId, userId), eq(consentRecords.purpose, 'activity_email'), isNull(consentRecords.withdrawnAt))
    if (on) await tx.insert(consentRecords).values({ id: uuidv7(), userId, purpose: 'activity_email', termsVersion: ACTIVITY_EMAIL_CONSENT_VERSION, acceptedAt: now })
    else await tx.update(consentRecords).set({ withdrawnAt: now }).where(open)
  })
}

/** A concrete reason to write, or null (then nothing is sent). */
async function reasonFor(ctx: Ctx, user: UserRow, lastSeenAt: Date, now: Date): Promise<'event' | 'friend_call' | null> {
  const { db } = ctx
  const spaceIds = await visibleSpaceIds(ctx, user.id)
  if (spaceIds.length) {
    const declined = db.select({ id: eventRsvps.eventId }).from(eventRsvps).where(and(eq(eventRsvps.userId, user.id), eq(eventRsvps.status, 'not_going')))
    for (const ev of await db.select().from(events).where(and(inArray(events.spaceId, spaceIds), notInArray(events.id, declined)))) {
      const s = nextStart(ev, now)
      if (s && s.getTime() - now.getTime() <= EVENT_HORIZON_MS) return 'event'
    }
  }
  // A friend started or joined a DM / group DM call with them while they were away.
  const mineDms = db.select({ id: channelRecipients.channelId }).from(channelRecipients).where(eq(channelRecipients.userId, user.id))
  const friends = db.select({ id: relationships.targetId }).from(relationships).where(and(eq(relationships.userId, user.id), eq(relationships.type, 'friend')))
  const [call] = await db.select({ id: voiceSessions.id }).from(voiceSessions).where(and(
    isNull(voiceSessions.spaceId), inArray(voiceSessions.channelId, mineDms), inArray(voiceSessions.userId, friends),
    gt(voiceSessions.joinedAt, lastSeenAt),
  )).limit(1)
  return call ? 'friend_call' : null
}

/** The daily run (claimed once per BRT day by the scheduler). */
export async function sendActivityEmails(ctx: Ctx, now = new Date()): Promise<number> {
  const { db, mail, log } = ctx
  const rows = await db.select({ u: users, s: activitySettings }).from(activitySettings).innerJoin(users, eq(users.id, activitySettings.userId))
    .where(and(
      eq(activitySettings.activityEmail, true), isNotNull(activitySettings.lastSeenAt),
      lt(activitySettings.lastSeenAt, new Date(now.getTime() - ACTIVITY_EMAIL_INACTIVE_DAYS * DAY_MS)),
      lt(activitySettings.emailsSinceSeen, ACTIVITY_EMAIL_MAX_IN_60_DAYS),
      isNotNull(users.emailVerifiedAt), isNull(users.deletionRequestedAt),
    ))
  let sent = 0
  for (const { u, s } of rows) {
    try {
      if (!canGetActivityEmail(u) || isRestricted(u, now.getTime())) continue
      const [consent] = await db.select({ id: consentRecords.id }).from(consentRecords).where(and(
        eq(consentRecords.userId, u.id), eq(consentRecords.purpose, 'activity_email'), isNull(consentRecords.withdrawnAt),
      )).limit(1)
      if (!consent) continue
      const recent = await db.select({ at: activityEmails.sentAt }).from(activityEmails)
        .where(and(eq(activityEmails.userId, u.id), gt(activityEmails.sentAt, new Date(now.getTime() - 60 * DAY_MS))))
      if (recent.length >= ACTIVITY_EMAIL_MAX_IN_60_DAYS) continue
      if (recent.some((r) => r.at.getTime() > now.getTime() - ACTIVITY_EMAIL_MIN_GAP_DAYS * DAY_MS)) continue
      const reason = await reasonFor(ctx, u, s.lastSeenAt!, now)
      if (!reason) continue
      await db.insert(activityEmails).values({ id: uuidv7(), userId: u.id, reason, sentAt: now })
      await db.update(activitySettings).set({ emailsSinceSeen: s.emailsSinceSeen + 1 }).where(eq(activitySettings.userId, u.id))
      mail.send({ to: u.email, kind: 'activity', ...activityMail(reason, unsubscribeUrl(ctx, u.id)) })
      sent++
    } catch (err) {
      log.error({ err: safeErr(err) }, 'activity e-mail failed for one user')
    }
  }
  return sent
}

