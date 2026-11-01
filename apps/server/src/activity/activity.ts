/**
 * Measuring without tracking (growth-plan §4.5): activity_days (who used the app on a BRT day, 4 bits, 90 days),
 * voice_sessions from the LiveKit webhooks (35 days), the nightly aggregates without ids (cells under 10 people hidden,
 * metrics opt-outs left out), the activity settings, the "entrou na voz" scopes, and the scheduler of every retention
 * job (event reminders each minute; nightly, weekly and activity e-mail runs claimed in job_runs).
 */
import {
  REMOVED_USER_ID, RECAP_WEEKS_KEPT, VOICE_NOTIFY_RECENT_DAYS, utcToZoned, uuidv7, zonedDay,
  type ActivitySettings, type PatchActivitySettingsBody, type VoiceNotifyScope, type VoiceState,
} from '@alga/shared'
import { and, eq, gt, gte, inArray, isNull, lt, ne, not, notInArray, sql } from 'drizzle-orm'
import type { Ctx } from '../app.js'
import {
  activityDays, activityEmails, activitySettings, channelRecipients, eventReminders, events, jobRuns, messages,
  metricCohorts, metricDaily, spaceMembers, users, voiceNotifyPrefs, voiceSessions, voiceWeekly, weeklyRecaps,
  type UserRow,
} from '../db/schema.js'
import { forbidden, notFound, safeErr } from '../errors.js'
import { liveEvents } from '../events/events.js'
import { DAY_MS } from '../legal.js'
import { canGetActivityEmail, sendActivityEmails, setActivityEmail } from './email.js'
import { hide, runWeekly } from './recap.js'
import { MIN_MS, addDays, attendance, clip, dayStart, mondayOf, pairMs } from './spans.js'

/** activity_days.flags. */
export const ACTIVITY_FLAGS = { OPENED: 1, MESSAGED: 2, VOICE_3MIN: 4, VOICE_WITH_OTHER: 8 } as const
const RAW_SESSION_DAYS = 35
const ACTIVITY_DAYS_KEPT = 90
/** A claimed job that has not finished after this long is assumed crashed and may be claimed again. */
const STALE_JOB_MS = 30 * MIN_MS

export class Activity {
  private timer: NodeJS.Timeout | undefined
  private running: Promise<void> | undefined
  // shortcut: per-process memory like Privacy.seen; one write per user and BRT day reaches the DB.
  private seenUsers = new Set<string>()
  private seenDay = ''

  constructor(private readonly ctx: Ctx) {}

  // ---- recording ----------------------------------------------------------------------------------------------------

  /** First authenticated use of the BRT day (REST, gateway, login): last_seen_at, and the "opened" bit unless opted out. */
  async seen(userId: string, now = new Date()): Promise<void> {
    const day = zonedDay(now)
    if (day !== this.seenDay) {
      this.seenUsers.clear()
      this.seenDay = day
    }
    if (this.seenUsers.has(userId)) return
    this.seenUsers.add(userId)
    try {
      const [s] = await this.ctx.db.insert(activitySettings).values({ userId, lastSeenAt: now })
        .onConflictDoUpdate({ target: activitySettings.userId, set: { lastSeenAt: now, emailsSinceSeen: 0 } })
        .returning({ optOut: activitySettings.metricsOptOut })
      if (!s?.optOut) await this.flag([userId], day, ACTIVITY_FLAGS.OPENED)
    } catch (err) {
      this.seenUsers.delete(userId)
      this.ctx.log.error({ err: safeErr(err) }, 'activity: last seen not recorded')
    }
  }

  private async flag(userIds: string[], day: string, bit: number): Promise<void> {
    if (!userIds.length) return
    await this.ctx.db.insert(activityDays).values(userIds.map((userId) => ({ userId, day, flags: bit })))
      .onConflictDoUpdate({ target: [activityDays.userId, activityDays.day], set: { flags: sql`${activityDays.flags} | excluded.flags` } })
  }

  /** Voice.onSessionEnd (D7): one voice_sessions row per ended VoiceState. */
  recordSession(s: VoiceState, leftAt: Date): void {
    const joinedAt = new Date(s.joinedAt)
    if (!(leftAt > joinedAt)) return
    void this.ctx.db.insert(voiceSessions).values({ id: uuidv7(), userId: s.userId, channelId: s.channelId, spaceId: s.spaceId, joinedAt, leftAt })
      .catch((err: unknown) => this.ctx.log.warn({ err: safeErr(err) }, 'activity: voice session not recorded'))
  }

  // ---- settings -----------------------------------------------------------------------------------------------------

  async settings(user: UserRow): Promise<ActivitySettings> {
    const [s] = await this.ctx.db.select().from(activitySettings).where(eq(activitySettings.userId, user.id))
    return {
      showInOthersRecap: s?.showInOthersRecap ?? true,
      metricsOptOut: s?.metricsOptOut ?? false,
      activityEmail: s?.activityEmail ?? false,
      activityEmailAllowed: canGetActivityEmail(user),
    }
  }

  async patchSettings(user: UserRow, body: PatchActivitySettingsBody, now = new Date()): Promise<ActivitySettings> {
    const { db } = this.ctx
    if (body.activityEmail && !canGetActivityEmail(user)) throw forbidden('Os e-mails de atividade são só para maiores de 18 anos com e-mail confirmado.')
    const set: Partial<typeof activitySettings.$inferInsert> = {}
    if (body.showInOthersRecap !== undefined) set.showInOthersRecap = body.showInOthersRecap
    if (body.metricsOptOut !== undefined) set.metricsOptOut = body.metricsOptOut
    if (Object.keys(set).length) {
      await db.insert(activitySettings).values({ userId: user.id, ...set }).onConflictDoUpdate({ target: activitySettings.userId, set })
    }
    // Opting out keeps only what the law requires: the daily records go now and are not written again.
    if (body.metricsOptOut) await db.delete(activityDays).where(eq(activityDays.userId, user.id))
    if (body.activityEmail !== undefined) await setActivityEmail(this.ctx, user.id, body.activityEmail, now)
    return this.settings(user)
  }

  // ---- "entrou na voz" scopes ---------------------------------------------------------------------------------------

  private async scopeKinds(userId: string): Promise<{ spaces: Set<string>; dms: Set<string> }> {
    const { db } = this.ctx
    const [s, d] = await Promise.all([
      db.select({ id: spaceMembers.spaceId }).from(spaceMembers).where(eq(spaceMembers.userId, userId)),
      db.select({ id: channelRecipients.channelId }).from(channelRecipients).where(eq(channelRecipients.userId, userId)),
    ])
    return { spaces: new Set(s.map((r) => r.id)), dms: new Set(d.map((r) => r.id)) }
  }

  async voiceNotify(userId: string, now = new Date()): Promise<VoiceNotifyScope[]> {
    const { db } = this.ctx
    const scope = sql<string>`coalesce(${voiceSessions.spaceId}, ${voiceSessions.channelId})`
    const [recent, prefs, mine] = await Promise.all([
      db.select({ scopeId: scope, last: sql<string>`max(${voiceSessions.leftAt})` }).from(voiceSessions)
        .where(and(eq(voiceSessions.userId, userId), gt(voiceSessions.leftAt, new Date(now.getTime() - VOICE_NOTIFY_RECENT_DAYS * DAY_MS))))
        .groupBy(scope),
      db.select().from(voiceNotifyPrefs).where(eq(voiceNotifyPrefs.userId, userId)),
      this.scopeKinds(userId),
    ])
    const out = new Map<string, VoiceNotifyScope>()
    const kindOf = (id: string) => (mine.spaces.has(id) ? 'space' : mine.dms.has(id) ? 'dm' : null)
    for (const r of recent) {
      const kind = kindOf(r.scopeId)
      if (kind) out.set(r.scopeId, { scopeId: r.scopeId, kind, lastCallAt: new Date(r.last).toISOString(), notify: null })
    }
    for (const p of prefs) {
      const kind = kindOf(p.scopeId)
      if (kind) out.set(p.scopeId, { ...(out.get(p.scopeId) ?? { scopeId: p.scopeId, kind, lastCallAt: null }), notify: p.notify })
    }
    return [...out.values()]
  }

  async putVoiceNotify(userId: string, scopeId: string, notify: boolean | null): Promise<VoiceNotifyScope> {
    const { db } = this.ctx
    const mine = await this.scopeKinds(userId)
    const kind = mine.spaces.has(scopeId) ? 'space' : mine.dms.has(scopeId) ? 'dm' : null
    if (!kind) throw notFound('Espaço ou conversa não encontrado.')
    if (notify === null) await db.delete(voiceNotifyPrefs).where(and(eq(voiceNotifyPrefs.userId, userId), eq(voiceNotifyPrefs.scopeId, scopeId)))
    else {
      await db.insert(voiceNotifyPrefs).values({ userId, scopeId, kind, notify })
        .onConflictDoUpdate({ target: [voiceNotifyPrefs.userId, voiceNotifyPrefs.scopeId], set: { notify } })
    }
    return (await this.voiceNotify(userId)).find((s) => s.scopeId === scopeId) ?? { scopeId, kind, lastCallAt: null, notify }
  }

  // ---- nightly aggregates -------------------------------------------------------------------------------------------

  private async optedOut(): Promise<Set<string>> {
    return new Set((await this.ctx.db.select({ id: activitySettings.userId }).from(activitySettings)
      .where(eq(activitySettings.metricsOptOut, true))).map((r) => r.id))
  }

  /** The night after BRT `day`: its activity bits, metric_daily, the cohort cells that completed, then the purges. */
  async nightly(day: string, now = new Date()): Promise<void> {
    const { db } = this.ctx
    const from = dayStart(day)
    const to = dayStart(addDays(day, 1))
    const out = await this.optedOut()
    const keep = (ids: Iterable<string>) => [...new Set(ids)].filter((id) => !out.has(id) && id !== REMOVED_USER_ID)

    const authors = await db.selectDistinct({ id: messages.authorId }).from(messages)
      .where(and(gte(messages.createdAt, new Date(from)), lt(messages.createdAt, new Date(to))))
    await this.flag(keep(authors.map((a) => a.id)), day, ACTIVITY_FLAGS.MESSAGED)
    // Sessions of the day, plus 12 h after it for event occurrences that run past midnight.
    const rows = await db.select().from(voiceSessions)
      .where(and(lt(voiceSessions.joinedAt, new Date(to + 12 * 60 * MIN_MS)), gt(voiceSessions.leftAt, new Date(from))))
    const spans = clip(rows, from, to)
    const perUser = new Map<string, number>()
    for (const s of spans) perUser.set(s.userId, (perUser.get(s.userId) ?? 0) + s.to - s.from)
    await this.flag(keep([...perUser].filter(([, ms]) => ms >= 3 * MIN_MS).map(([id]) => id)), day, ACTIVITY_FLAGS.VOICE_3MIN)
    const withOther = [...pairMs(spans)].filter(([, m]) => [...m.values()].some((ms) => ms >= 3 * MIN_MS)).map(([id]) => id)
    await this.flag(keep(withOther), day, ACTIVITY_FLAGS.VOICE_WITH_OTHER)

    const bits = async (bit: number) => {
      const [r] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(activityDays)
        .where(and(eq(activityDays.day, day), sql`(${activityDays.flags} & ${bit}) <> 0`))
      return r?.n ?? 0
    }
    const signups = (await this.cohort(day)).length
    // Event occurrences that started this day with 2+ people there ("eventos com 2+ presentes"; summed per month).
    const allSpans = clip(rows, from, to + 12 * 60 * MIN_MS).filter((s) => !out.has(s.userId))
    const channelIds = [...new Set(allSpans.map((s) => s.channelId))]
    const evs = channelIds.length ? await db.select().from(events).where(inArray(events.channelId, channelIds)) : []
    const events2 = evs.flatMap((ev) => attendance(ev, allSpans, from, to)).filter((a) => a.userIds.length >= 2).length
    const daily: Record<string, number> = {
      active_users: await bits(ACTIVITY_FLAGS.OPENED),
      messaging_users: await bits(ACTIVITY_FLAGS.MESSAGED),
      voice_users: await bits(ACTIVITY_FLAGS.VOICE_3MIN),
      voice_with_other_users: await bits(ACTIVITY_FLAGS.VOICE_WITH_OTHER),
      signups,
      events_with_2plus: events2,
    }
    for (const [metric, n] of Object.entries(daily)) {
      await db.insert(metricDaily).values({ day, metric, value: hide(n) })
        .onConflictDoUpdate({ target: [metricDaily.day, metricDaily.metric], set: { value: hide(n) } })
    }

    // D1/D7/D30: of the people who signed up N days before, who used the app on `day`. Activation: 3+ min in voice with
    // someone on the signup day or the next (shortcut: by BRT day, not exactly the first 24 h).
    const cells: [string, string, string[], (id: string) => Promise<boolean>][] = []
    for (const n of [1, 7, 30]) {
      const c = addDays(day, -n)
      cells.push([c, `d${n}`, await this.cohort(c), (id) => this.had(id, [day], ACTIVITY_FLAGS.OPENED)])
    }
    const yesterday = addDays(day, -1)
    cells.push([yesterday, 'activated_24h', await this.cohort(yesterday), (id) => this.had(id, [yesterday, day], ACTIVITY_FLAGS.VOICE_WITH_OTHER)])
    for (const [cohortDay, metric, ids, test] of cells) {
      let value = 0
      for (const id of ids) if (await test(id)) value++
      const size = hide(ids.length)
      const row = { size, value: size === null ? null : hide(value) }
      await db.insert(metricCohorts).values({ cohortDay, metric, ...row })
        .onConflictDoUpdate({ target: [metricCohorts.cohortDay, metricCohorts.metric], set: row })
    }
    await this.purge(now)
  }

  /** Users who signed up on BRT `day` and count for metrics. */
  private async cohort(day: string): Promise<string[]> {
    const out = this.ctx.db.select({ id: activitySettings.userId }).from(activitySettings).where(eq(activitySettings.metricsOptOut, true))
    const rows = await this.ctx.db.select({ id: users.id }).from(users).where(and(
      gte(users.createdAt, new Date(dayStart(day))), lt(users.createdAt, new Date(dayStart(addDays(day, 1)))),
      ne(users.id, REMOVED_USER_ID), notInArray(users.id, out),
    ))
    return rows.map((r) => r.id)
  }

  private async had(userId: string, days: string[], bit: number): Promise<boolean> {
    const [r] = await this.ctx.db.select({ day: activityDays.day }).from(activityDays)
      .where(and(eq(activityDays.userId, userId), inArray(activityDays.day, days), sql`(${activityDays.flags} & ${bit}) <> 0`)).limit(1)
    return !!r
  }

  /** Retention of the package D tables (docs/retention/server.md). */
  async purge(now = new Date()): Promise<void> {
    const { db } = this.ctx
    const ago = (days: number) => new Date(now.getTime() - days * DAY_MS)
    const today = zonedDay(now)
    await db.delete(voiceSessions).where(lt(voiceSessions.leftAt, ago(RAW_SESSION_DAYS)))
    await db.delete(activityDays).where(lt(activityDays.day, addDays(today, -ACTIVITY_DAYS_KEPT)))
    const oldestWeek = addDays(mondayOf(today), -7 * RECAP_WEEKS_KEPT)
    await db.delete(voiceWeekly).where(lt(voiceWeekly.week, oldestWeek))
    await db.delete(weeklyRecaps).where(lt(weeklyRecaps.week, oldestWeek))
    await db.delete(eventReminders).where(lt(eventReminders.sentAt, ago(RAW_SESSION_DAYS)))
    // One-off events (and their RSVPs) go 35 days after they end; weekly ones live until deleted.
    await db.delete(events).where(and(eq(events.weekly, false), not(liveEvents(ago(RAW_SESSION_DAYS)))))
    await db.delete(activityEmails).where(lt(activityEmails.sentAt, ago(60)))
    await db.delete(jobRuns).where(lt(jobRuns.startedAt, ago(180)))
  }

  // ---- scheduler ----------------------------------------------------------------------------------------------------

  /** Claims (job, period): true for exactly one caller, across restarts and workers; a crashed run is retaken later. */
  async claim(job: string, period: string, now = new Date()): Promise<boolean> {
    const [row] = await this.ctx.db.insert(jobRuns).values({ job, period, startedAt: now }).onConflictDoUpdate({
      target: [jobRuns.job, jobRuns.period],
      set: { startedAt: now },
      setWhere: and(isNull(jobRuns.finishedAt), lt(jobRuns.startedAt, new Date(now.getTime() - STALE_JOB_MS))),
    }).returning({ job: jobRuns.job })
    return !!row
  }

  private async finish(job: string, period: string, now: Date): Promise<void> {
    await this.ctx.db.update(jobRuns).set({ finishedAt: now }).where(and(eq(jobRuns.job, job), eq(jobRuns.period, period)))
  }

  private async run(job: string, period: string, now: Date, fn: () => Promise<unknown>): Promise<void> {
    if (!await this.claim(job, period, now)) return
    try {
      await fn()
      await this.finish(job, period, now)
    } catch (err) {
      this.ctx.log.error({ err: safeErr(err), job, period }, 'retention job failed; retried in 30 min')
    }
  }

  /**
   * One scheduler pass: reminders; the nightly run of each of the last 7 BRT days (from 04:00 the day after); the
   * weekly run of each of the last 4 weeks (from Monday 10:00; only the latest notifies); the activity e-mails once a
   * day between 11:00 and 20:00.
   */
  async tick(now = new Date()): Promise<void> {
    await this.ctx.events.remind(now).catch((err: unknown) => this.ctx.log.error({ err: safeErr(err) }, 'event reminders failed'))
    const local = utcToZoned(now)
    const today = local.slice(0, 10)
    const hour = Number(local.slice(11, 13))
    for (let i = 7; i >= 1; i--) {
      if (i === 1 && hour < 4) continue
      const day = addDays(today, -i)
      await this.run('nightly', day, now, () => this.nightly(day, now))
    }
    const monday = mondayOf(today)
    for (let i = 4; i >= 1; i--) {
      if (i === 1 && today === monday && hour < 10) continue
      const week = addDays(monday, -7 * i)
      await this.run('weekly', week, now, () => runWeekly(this.ctx, week, i === 1))
    }
    if (hour >= 11 && hour < 20) await this.run('activity_email', today, now, () => sendActivityEmails(this.ctx, now))
  }

  start(intervalMs = 60_000): void {
    this.timer = setInterval(() => {
      this.running ??= this.tick().finally(() => { this.running = undefined })
    }, intervalMs)
    this.timer.unref()
  }

  async stop(): Promise<void> {
    clearInterval(this.timer)
    await this.running?.catch(() => {})
  }
}

