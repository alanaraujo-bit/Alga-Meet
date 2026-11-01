/**
 * Weekly job (Monday 10:00 BRT, for the week before): voice_weekly, the recaps (copresence is computed here, once, and
 * kept only inside each recap), "Semanas juntos" and the "grupos ativos" metric. "Semanas juntos" never notifies: the
 * only dispatch here is WEEKLY_RECAP_READY to adults (test/retention.test.ts asserts both).
 */
import {
  RECAP_NIGHT_MINUTES, WEEKS_TOGETHER_MIN_MEMBERS, WEEKS_TOGETHER_MIN_MINUTES, WEEKS_TOGETHER_PAUSE_EVERY,
  type WeeklyRecap, type WeeksTogether,
} from '@alga/shared'
import { and, desc, eq, gt, inArray, lt, or } from 'drizzle-orm'
import { isBlockedBetween } from '../access.js'
import type { Ctx } from '../app.js'
import {
  activitySettings, events, metricDaily, spaceMembers, spaceStreaks, spaces, users, voiceSessions, voiceWeekly, weeklyRecaps,
  type StoredRecap,
} from '../db/schema.js'
import { ageBracketOf } from '../legal.js'
import { publicUser } from '../views.js'
import { MIN_MS, addDays, attendance, clip, concurrentMs, dayStart, groupBy, msByDay, pairMs, type Span } from './spans.js'

/** Counts under this are stored as null (hidden). */
export const MIN_CELL = 10
export const hide = (n: number) => (n < MIN_CELL ? null : n)

export interface StreakState {
  weeks: number
  sincePause: number
  lastWeek: string | null
}

/**
 * One week of "Semanas juntos": a counted week adds one; a missed week is paused automatically when the group has
 * WEEKS_TOGETHER_PAUSE_EVERY counted weeks since the last pause, otherwise the streak ends. Nothing else happens.
 */
export function nextStreak(s: StreakState, week: string, counted: boolean): StreakState {
  if (counted) return { weeks: s.weeks + 1, sincePause: s.sincePause + 1, lastWeek: week }
  if (s.weeks > 0 && s.sincePause >= WEEKS_TOGETHER_PAUSE_EVERY) return { weeks: s.weeks, sincePause: 0, lastWeek: week }
  return { weeks: 0, sincePause: 0, lastWeek: week }
}

/** Spaces with one call of WEEKS_TOGETHER_MIN_MEMBERS+ together for WEEKS_TOGETHER_MIN_MINUTES+ (in one channel). */
export function countedSpaces(spans: Span[]): Set<string> {
  const out = new Set<string>()
  for (const list of groupBy(spans.filter((s) => s.spaceId), (s) => s.channelId).values()) {
    if (concurrentMs(list, WEEKS_TOGETHER_MIN_MEMBERS) >= WEEKS_TOGETHER_MIN_MINUTES * MIN_MS) out.add(list[0]!.spaceId!)
  }
  return out
}

async function updateStreaks(ctx: Ctx, week: string, spans: Span[]): Promise<void> {
  const { db } = ctx
  const counted = countedSpaces(spans)
  const rows = await db.select().from(spaceStreaks).where(or(gt(spaceStreaks.weeks, 0), eq(spaceStreaks.enabled, false)))
  const seen = [...new Set(spans.map((s) => s.spaceId).filter((id): id is string => !!id))]
  const live = seen.length ? new Set((await db.select({ id: spaces.id }).from(spaces).where(inArray(spaces.id, seen))).map((s) => s.id)) : new Set<string>()
  const known = new Map(rows.map((r) => [r.spaceId, r]))
  for (const spaceId of new Set([...live, ...rows.filter((r) => r.weeks > 0).map((r) => r.spaceId)])) {
    const row = known.get(spaceId)
    if (row && !row.enabled) continue
    if (row?.lastWeek && row.lastWeek >= week) continue // this week was applied already (job re-run)
    let s: StreakState = row ?? { weeks: 0, sincePause: 0, lastWeek: null }
    // Weeks never evaluated (the server was down for a whole week) count as missed.
    if (s.lastWeek) for (let w = addDays(s.lastWeek, 7); w < week; w = addDays(w, 7)) s = nextStreak(s, w, false)
    s = nextStreak(s, week, counted.has(spaceId))
    await db.insert(spaceStreaks).values({ spaceId, ...s })
      .onConflictDoUpdate({ target: spaceStreaks.spaceId, set: { weeks: s.weeks, sincePause: s.sincePause, lastWeek: s.lastWeek } })
  }
}

/** The weekly job for `week` (its Monday). `notify`: dispatch WEEKLY_RECAP_READY (only the latest week). Re-runnable. */
export async function runWeekly(ctx: Ctx, week: string, notify: boolean): Promise<void> {
  const { db, hub } = ctx
  const from = dayStart(week)
  const to = dayStart(addDays(week, 7))
  const rows = await db.select().from(voiceSessions).where(and(lt(voiceSessions.joinedAt, new Date(to)), gt(voiceSessions.leftAt, new Date(from))))
  const spans = clip(rows, from, to)

  // voice_weekly: minutes and nights per user and channel; totals per user.
  const totals = new Map<string, { ms: number; days: Map<string, number>; channels: Map<string, { spaceId: string | null; ms: number }> }>()
  for (const [key, list] of groupBy(spans, (s) => `${s.userId}|${s.channelId}`)) {
    const [userId, channelId] = key.split('|') as [string, string]
    const days = new Map<string, number>()
    for (const s of list) for (const [d, ms] of msByDay(s)) days.set(d, (days.get(d) ?? 0) + ms)
    const ms = [...days.values()].reduce((a, b) => a + b, 0)
    const nights = [...days.values()].filter((v) => v >= RECAP_NIGHT_MINUTES * MIN_MS).length
    await db.insert(voiceWeekly).values({ userId, week, channelId, spaceId: list[0]!.spaceId, minutes: Math.round(ms / MIN_MS), nights })
      .onConflictDoUpdate({ target: [voiceWeekly.userId, voiceWeekly.week, voiceWeekly.channelId], set: { minutes: Math.round(ms / MIN_MS), nights } })
    let t = totals.get(userId)
    if (!t) totals.set(userId, t = { ms: 0, days: new Map(), channels: new Map() })
    t.ms += ms
    for (const [d, v] of days) t.days.set(d, (t.days.get(d) ?? 0) + v)
    t.channels.set(channelId, { spaceId: list[0]!.spaceId, ms })
  }

  // Event occurrences of the week and who was there.
  const spaceIds = [...new Set(spans.map((s) => s.spaceId).filter((id): id is string => !!id))]
  const evRows = spaceIds.length ? await db.select().from(events).where(inArray(events.spaceId, spaceIds)) : []
  const attended = new Map<string, StoredRecap['events']>()
  for (const ev of evRows) {
    for (const occ of attendance(ev, spans, from, to)) {
      for (const id of occ.userIds) {
        attended.set(id, [...(attended.get(id) ?? []), { eventId: ev.id, spaceId: ev.spaceId, title: ev.title, startsAt: occ.startsAt.toISOString() }])
      }
    }
  }

  // Copresence, once a week; people who switched "Aparecer no resumo dos outros" off are never candidates.
  const pairs = pairMs(spans)
  const hidden = new Set((await db.select({ id: activitySettings.userId }).from(activitySettings)
    .where(eq(activitySettings.showInOthersRecap, false))).map((r) => r.id))
  for (const [userId, t] of totals) {
    const top = [...t.channels].filter(([, c]) => c.spaceId).sort((a, b) => b[1].ms - a[1].ms)[0]
    const data: StoredRecap = {
      voiceMinutes: Math.round(t.ms / MIN_MS),
      nights: [...t.days.values()].filter((v) => v >= RECAP_NIGHT_MINUTES * MIN_MS).length,
      ...(top ? { topChannel: { channelId: top[0], spaceId: top[1].spaceId! } } : {}),
      events: (attended.get(userId) ?? []).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      people: [...(pairs.get(userId) ?? new Map<string, number>())].filter(([id]) => !hidden.has(id))
        .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => id),
    }
    await db.insert(weeklyRecaps).values({ userId, week, data }).onConflictDoUpdate({ target: [weeklyRecaps.userId, weeklyRecaps.week], set: { data } })
  }

  await updateStreaks(ctx, week, spans)
  await activeGroups(ctx, week, spans)

  if (notify && totals.size) {
    const adults = (await db.select().from(users).where(inArray(users.id, [...totals.keys()]))).filter((u) => ageBracketOf(u) === 'adult')
    hub.dispatch(adults.map((u) => u.id), 'WEEKLY_RECAP_READY', { week })
  }
}

/**
 * North-star metric (growth-plan §4.4): spaces or DM groups with 3+ different people together in voice (2+ at once) for
 * 30+ minutes in the week. Metrics opt-outs are left out before counting.
 */
async function activeGroups(ctx: Ctx, week: string, spans: Span[]): Promise<void> {
  const out = new Set((await ctx.db.select({ id: activitySettings.userId }).from(activitySettings)
    .where(eq(activitySettings.metricsOptOut, true))).map((r) => r.id))
  const kept = spans.filter((s) => !out.has(s.userId))
  let n = 0
  for (const list of groupBy(kept, (s) => s.spaceId ?? s.channelId).values()) {
    const together = new Set([...pairMs(list)].filter(([, m]) => m.size).map(([id]) => id))
    const ms = [...groupBy(list, (s) => s.channelId).values()].reduce((a, l) => a + concurrentMs(l, 2), 0)
    if (together.size >= 3 && ms >= 30 * MIN_MS) n++
  }
  await ctx.db.insert(metricDaily).values({ day: week, metric: 'active_groups_week', value: hide(n) })
    .onConflictDoUpdate({ target: [metricDaily.day, metricDaily.metric], set: { value: hide(n) } })
}

// ---- views ----------------------------------------------------------------------------------------------------------

/** GET /users/@me/recap: the stored recap filtered by what is true now (membership, blocks, switches). */
export async function recapView(ctx: Ctx, userId: string, week?: string): Promise<WeeklyRecap | null> {
  const { db } = ctx
  const [row] = await db.select().from(weeklyRecaps)
    .where(week ? and(eq(weeklyRecaps.userId, userId), eq(weeklyRecaps.week, week)) : eq(weeklyRecaps.userId, userId))
    .orderBy(desc(weeklyRecaps.week)).limit(1)
  if (!row) return null
  const mine = new Set((await db.select({ id: spaceMembers.spaceId }).from(spaceMembers).where(eq(spaceMembers.userId, userId))).map((r) => r.id))
  const d = row.data
  const people = []
  if (d.people.length) {
    const rows = await db.select({ u: users, show: activitySettings.showInOthersRecap }).from(users)
      .leftJoin(activitySettings, eq(activitySettings.userId, users.id)).where(inArray(users.id, d.people))
    for (const id of d.people) {
      const r = rows.find((x) => x.u.id === id)
      if (!r || r.show === false || await isBlockedBetween(db, userId, id)) continue
      people.push(publicUser(r.u))
      if (people.length === 3) break
    }
  }
  const streaks = mine.size
    ? await db.select().from(spaceStreaks).where(and(inArray(spaceStreaks.spaceId, [...mine]), eq(spaceStreaks.enabled, true), gt(spaceStreaks.weeks, 0)))
    : []
  return {
    week: row.week,
    voiceMinutes: d.voiceMinutes,
    nights: d.nights,
    ...(d.topChannel && mine.has(d.topChannel.spaceId) ? { topChannel: d.topChannel } : {}),
    events: d.events.filter((e) => mine.has(e.spaceId)),
    people,
    weeksTogether: streaks.map((s) => ({ spaceId: s.spaceId, weeks: s.weeks })),
  }
}

export async function weeksTogetherView(ctx: Ctx, spaceId: string): Promise<WeeksTogether> {
  const [s] = await ctx.db.select().from(spaceStreaks).where(eq(spaceStreaks.spaceId, spaceId))
  const enabled = s?.enabled ?? true
  const weeks = enabled ? s?.weeks ?? 0 : 0
  return { spaceId, enabled, weeks, pauseAvailable: weeks > 0 && (s?.sincePause ?? 0) >= WEEKS_TOGETHER_PAUSE_EVERY, lastWeek: s?.lastWeek ?? null }
}

/** Admin switch: off clears the count, on starts from 0; the same value again changes nothing. Never dispatched. */
export async function setWeeksTogether(ctx: Ctx, spaceId: string, enabled: boolean): Promise<void> {
  const [s] = await ctx.db.select({ enabled: spaceStreaks.enabled }).from(spaceStreaks).where(eq(spaceStreaks.spaceId, spaceId))
  if ((s?.enabled ?? true) === enabled) return
  const fresh = { enabled, weeks: 0, sincePause: 0, lastWeek: null }
  await ctx.db.insert(spaceStreaks).values({ spaceId, ...fresh }).onConflictDoUpdate({ target: spaceStreaks.spaceId, set: fresh })
}
