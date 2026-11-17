/**
 * The numbers of the admin app, computed from what the database already holds (docs/admin-app.md says what is not
 * tracked). Money comes from the billing tables: paid orders, and renewing subscriptions whose charges are deduced
 * from their cycle (start + N intervals until the current period end), since a renewal charge is not stored as a row.
 * Days and months are BRT (America/Sao_Paulo has no DST since 2019). Activity comes from activity_days, which already
 * leaves out the metrics opt-outs.
 */
import {
  REMOVED_USER_ID, zonedDay,
  type AdminCohortRow, type AdminGrowth, type AdminHealth, type AdminOverview, type AdminPeriod, type AdminPoint,
  type AdminPurchase, type Money,
} from '@alga/shared'
import { and, count, countDistinct, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm'
import type { Ctx } from '../app.js'
import { ACTIVITY_FLAGS } from '../activity/activity.js'
import { MIN_MS, addDays, dayStart, mondayOf, msByDay } from '../activity/spans.js'
import { entitledUntil } from '../billing/billing.js'
import {
  activityDays, activitySettings, appeals, callQualityReports, gifts, jobRuns, messages, metricDaily, orders, products,
  quarantinedFiles, reports, sessions, spaces, subscriptions, uninstallFeedback, users, voiceSessions, voiceWeekly,
  type SubscriptionRow,
} from '../db/schema.js'
import { metrics } from '../metrics.js'

const DAY_MS = 24 * 60 * MIN_MS
const BRT_OFFSET_MS = 3 * 60 * MIN_MS
const ROUND_TRIP_TOLERANCE_MS = 2 * DAY_MS

const money = (): Money => ({ brl: 0, usd: 0 })
const add = (m: Money, currency: 'BRL' | 'USD', cents: number) => { if (currency === 'USD') m.usd += cents; else m.brl += cents }
const ratio = (a: number, b: number) => (b > 0 ? a / b : null)
const median = (xs: number[]) => percentile(xs, 50)
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))
  return s[i]!
}

const addMonths = (d: Date, months: number) => {
  const out = new Date(d)
  out.setUTCMonth(out.getUTCMonth() + months)
  return out
}
/** BRT 'YYYY-MM' of an instant. */
const brtMonth = (t: number) => new Date(t - BRT_OFFSET_MS).toISOString().slice(0, 7)
const brtMonthStart = (ym: string) => Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1) + BRT_OFFSET_MS
const shiftMonth = (ym: string, n: number) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7)
const brtHour = (t: number) => new Date(t - BRT_OFFSET_MS).toISOString().slice(0, 13)

/**
 * The charge instants of a renewing subscription: its start, then each interval while the next one is still before
 * the current period end (renewals move the period end forward by one interval). Not after `now`.
 */
export function renewalCharges(s: Pick<SubscriptionRow, 'kind' | 'startedAt' | 'currentPeriodEnd' | 'amountCents'>, months: number, now: number): number[] {
  if (s.kind !== 'renewing' || !s.startedAt || s.amountCents <= 0) return []
  const end = s.currentPeriodEnd?.getTime() ?? s.startedAt.getTime()
  const out: number[] = []
  for (let k = 0; k < 600; k++) {
    const t = addMonths(s.startedAt, k * months).getTime()
    if (t > now || (k > 0 && t >= end - ROUND_TRIP_TOLERANCE_MS)) break
    out.push(t)
  }
  return out
}

interface Entry { purchase: AdminPurchase; userId: string; t: number }

/** Window of a period and the one right before it (same length). */
export function periodWindow(period: AdminPeriod, now: number): { from: number; prevFrom: number; bucket: 'hour' | 'day' | 'month'; keys: string[] } {
  const today = zonedDay(now)
  if (period === 'today') {
    const from = dayStart(today)
    const keys: string[] = []
    for (let t = from; t <= now; t += 60 * MIN_MS) keys.push(brtHour(t))
    return { from, prevFrom: dayStart(addDays(today, -1)), bucket: 'hour', keys }
  }
  if (period === '12m') {
    const first = shiftMonth(brtMonth(now), -11)
    return { from: brtMonthStart(first), prevFrom: brtMonthStart(shiftMonth(first, -12)), bucket: 'month', keys: Array.from({ length: 12 }, (_, i) => shiftMonth(first, i)) }
  }
  const n = { '7d': 7, '30d': 30, '90d': 90 }[period]
  const first = addDays(today, -(n - 1))
  return { from: dayStart(first), prevFrom: dayStart(addDays(first, -n)), bucket: 'day', keys: Array.from({ length: n }, (_, i) => addDays(first, i)) }
}

export class Insights {
  constructor(private readonly ctx: Ctx) {}

  /** Defense in depth like Billing.counts: sandbox rows never count in production. */
  private counts(provider: string): boolean {
    return this.ctx.config.env !== 'production' || provider !== 'sandbox'
  }

  private async mau(now: number): Promise<number> {
    const [r] = await this.ctx.db.select({ n: countDistinct(activityDays.userId) }).from(activityDays)
      .where(and(gte(activityDays.day, addDays(zonedDay(now), -29)), sql`(${activityDays.flags} & ${ACTIVITY_FLAGS.OPENED}) <> 0`))
    return r?.n ?? 0
  }

  /** Every charge and refund (orders + deduced subscription charges), newest first. */
  private async ledger(since: number, now: number): Promise<{ entries: Entry[]; subs: SubscriptionRow[] }> {
    const { db } = this.ctx
    const names = new Map((await db.select({ id: products.id, name: products.name, interval: products.interval }).from(products)).map((p) => [p.id, p]))
    const orderRows = await db.select({ o: orders, giftId: gifts.id }).from(orders).leftJoin(gifts, eq(gifts.orderId, orders.id))
      .where(and(inArray(orders.status, ['paid', 'refunded']), gt(orders.amountCents, 0), isNotNull(orders.paidAt),
        or(gte(orders.paidAt, new Date(since)), gte(orders.updatedAt, new Date(since)))))
    // shortcut: all renewing subscriptions in memory; fine to tens of thousands, then a charges table written by Billing.
    const subs = (await db.select().from(subscriptions)).filter((s) => this.counts(s.provider))
    const entries: Entry[] = []
    const base = (id: string, kind: AdminPurchase['kind'], t: number, cents: number, currency: 'BRL' | 'USD', productId: string, provider: string, gift: boolean, userId: string): Entry => ({
      t, userId,
      purchase: { id, kind, at: new Date(t).toISOString(), amountCents: cents, currency, productId, productName: names.get(productId)?.name ?? productId, provider, gift, user: null },
    })
    for (const { o, giftId } of orderRows) {
      if (!this.counts(o.provider)) continue
      entries.push(base(`order:${o.id}`, 'order', o.paidAt!.getTime(), o.amountCents, o.currency, o.productId, o.provider, !!giftId, o.userId))
      if (o.status === 'refunded') entries.push(base(`refund:${o.id}`, 'refund', o.updatedAt.getTime(), -o.amountCents, o.currency, o.productId, o.provider, !!giftId, o.userId))
    }
    for (const s of subs) {
      const months = names.get(s.productId)?.interval === 'year' ? 12 : 1
      renewalCharges(s, months, now).forEach((t, k) => {
        if (t >= since) entries.push(base(`sub:${s.id}:${k}`, k === 0 ? 'subscription_first' : 'subscription_renewal', t, s.amountCents, s.currency, s.productId, s.provider, false, s.userId))
      })
      if (s.kind === 'renewing' && s.status === 'canceled' && s.startedAt && s.updatedAt.getTime() >= since) {
        entries.push(base(`refund:${s.id}`, 'refund', s.updatedAt.getTime(), -s.amountCents, s.currency, s.productId, s.provider, false, s.userId))
      }
    }
    entries.sort((a, b) => b.t - a.t)
    return { entries, subs }
  }

  async overview(period: AdminPeriod, nowDate = new Date()): Promise<AdminOverview> {
    const { db } = this.ctx
    const now = nowDate.getTime()
    const w = periodWindow(period, now)
    const { entries, subs } = await this.ledger(Math.min(w.prevFrom, now - 365 * DAY_MS), now)

    const inWin = entries.filter((e) => e.t >= w.from && e.t <= now)
    const gross = money(); const refunds = money(); const net = money(); const previousNet = money()
    let charges = 0; let refundCount = 0
    const payers = new Set<string>()
    const byProduct = new Map<string, { net: Money; count: number }>()
    for (const e of inWin) {
      const p = e.purchase
      add(net, p.currency, p.amountCents)
      if (p.kind === 'refund') { add(refunds, p.currency, -p.amountCents); refundCount++ } else { add(gross, p.currency, p.amountCents); charges++; payers.add(e.userId) }
      const bp = byProduct.get(p.productId) ?? { net: money(), count: 0 }
      add(bp.net, p.currency, p.amountCents)
      if (p.kind !== 'refund') bp.count++
      byProduct.set(p.productId, bp)
    }
    for (const e of entries) if (e.t >= w.prevFrom && e.t < w.from) add(previousNet, e.purchase.currency, e.purchase.amountCents)

    const keyOf = (t: number) => (w.bucket === 'hour' ? brtHour(t) : w.bucket === 'month' ? brtMonth(t) : zonedDay(t))
    const buckets = new Map(w.keys.map((k) => [k, 0]))
    for (const e of inWin) if (e.purchase.currency === 'BRL') { const k = keyOf(e.t); if (buckets.has(k)) buckets.set(k, buckets.get(k)! + e.purchase.amountCents) }

    // ---- MRR: renewing Plus, a month's worth; the series replays each subscription's covered interval.
    const productRows = await db.select({ id: products.id, name: products.name, kind: products.kind, interval: products.interval }).from(products)
    const monthly = (s: SubscriptionRow) => (productRows.find((p) => p.id === s.productId)?.interval === 'year' ? s.amountCents / 12 : s.amountCents)
    const renewing = subs.filter((s) => s.kind === 'renewing' && s.startedAt && s.amountCents > 0)
    const liveNow = (s: SubscriptionRow) => entitledUntil(s) > now
    const mrrNow = money(); const atRisk = money(); let atRiskCount = 0
    for (const s of renewing.filter(liveNow)) {
      if (s.cancelAtPeriodEnd || s.status === 'past_due') { add(atRisk, s.currency, monthly(s)); atRiskCount++ }
      if (!s.cancelAtPeriodEnd) add(mrrNow, s.currency, monthly(s))
    }
    const coverEnd = (s: SubscriptionRow) => (liveNow(s) && !s.cancelAtPeriodEnd ? Infinity : s.status === 'canceled' ? s.updatedAt.getTime() : (s.currentPeriodEnd?.getTime() ?? 0))
    const mrrAt = (t: number) => renewing.filter((s) => s.currency === 'BRL' && s.startedAt!.getTime() <= t && t < coverEnd(s)).reduce((n, s) => n + monthly(s), 0)
    const mrrKeys = w.bucket === 'month' ? w.keys : Array.from({ length: 90 }, (_, i) => addDays(zonedDay(now), i - 89))
    const mrrSeries = mrrKeys.map((k) => {
      const end = w.bucket === 'month' ? Math.min(now, brtMonthStart(shiftMonth(k, 1)) - 1) : Math.min(now, dayStart(addDays(k, 1)) - 1)
      return { t: k, value: Math.round(mrrAt(end)) }
    })

    // ---- subscribers and churn (passes are free: they never count as subscribers gained or lost).
    const [plusRow] = await db.select({ n: count() }).from(users).where(and(eq(users.plan, 'plus'), ne(users.id, REMOVED_USER_ID)))
    const liveBy = (kind: SubscriptionRow['kind']) => new Set(subs.filter((s) => s.kind === kind && liveNow(s)).map((s) => s.userId)).size
    const paid = subs.filter((s) => s.kind !== 'pass' && s.startedAt)
    const end = (s: SubscriptionRow) => (s.status === 'canceled' ? s.updatedAt.getTime() : liveNow(s) ? Infinity : (s.currentPeriodEnd?.getTime() ?? s.updatedAt.getTime()))
    const coveredAt = (t: number) => new Set(paid.filter((s) => s.startedAt!.getTime() <= t && end(s) > t).map((s) => s.userId))
    const plusUsers = new Set(paid.filter((s) => end(s) === Infinity).map((s) => s.userId))
    const lostBetween = (a: number, b: number) => {
      const lastEnd = new Map<string, number>()
      for (const s of paid) lastEnd.set(s.userId, Math.max(lastEnd.get(s.userId) ?? 0, end(s)))
      return [...lastEnd].filter(([u, t]) => t >= a && t <= b && !plusUsers.has(u)).length
    }
    const start30 = coveredAt(now - 30 * DAY_MS).size

    const mau = await this.mau(now)
    const [shop, tryOn, checkout, giftCheckout] = ['shop_open', 'try_on', 'checkout', 'gift_checkout'].map((step) => metrics.shopFunnel.sum({ step }))

    const latest = entries.slice(0, 25)
    const ids = [...new Set(latest.map((e) => e.userId))]
    const people = ids.length ? await db.select({ id: users.id, username: users.username, displayName: users.displayName }).from(users).where(inArray(users.id, ids)) : []
    for (const e of latest) e.purchase.user = e.userId === REMOVED_USER_ID ? null : (people.find((p) => p.id === e.userId) ?? null)

    return {
      period, from: new Date(w.from).toISOString(), to: nowDate.toISOString(),
      received: { gross, refunds, net, previousNet, charges, refundCount },
      series: w.keys.map((t) => ({ t, value: buckets.get(t) ?? 0 })),
      bucket: w.bucket,
      mrr: { now: { brl: Math.round(mrrNow.brl), usd: Math.round(mrrNow.usd) }, atRisk: { brl: Math.round(atRisk.brl), usd: Math.round(atRisk.usd) }, atRiskCount, series: mrrSeries },
      subscribers: {
        plus: plusRow?.n ?? 0, renewing: liveBy('renewing'), period: liveBy('period'), pass: liveBy('pass'),
        newInPeriod: paid.filter((s) => s.startedAt!.getTime() >= w.from && s.startedAt!.getTime() <= now).length,
        churnedInPeriod: lostBetween(w.from, now),
        churn30d: start30 ? lostBetween(now - 30 * DAY_MS, now) / start30 : null,
      },
      conversion: {
        mau, plusRate: ratio(plusRow?.n ?? 0, mau), payers: payers.size, payerRate: ratio(payers.size, mau),
        arppuCents: payers.size ? Math.round(net.brl / payers.size) : null, refundRate: ratio(refundCount, charges),
      },
      byProduct: [...byProduct].map(([productId, v]) => {
        const p = productRows.find((x) => x.id === productId)
        return { productId, name: p?.name ?? productId, kind: p?.kind ?? 'other', ...v }
      }).sort((a, b) => b.net.brl - a.net.brl),
      latest: latest.map((e) => e.purchase),
      funnel: { since: new Date(Date.now() - process.uptime() * 1000).toISOString(), shopOpen: shop!, tryOn: tryOn!, checkout: checkout!, giftCheckout: giftCheckout! },
    }
  }

  async growth(days: number, nowDate = new Date()): Promise<AdminGrowth> {
    const { db } = this.ctx
    const now = nowDate.getTime()
    const today = zonedDay(now)
    const first = addDays(today, -(days - 1))
    const from = dayStart(first)
    const prevFrom = dayStart(addDays(first, -days))
    const dayKeys = Array.from({ length: days }, (_, i) => addDays(first, i))
    const notRemoved = ne(users.id, REMOVED_USER_ID)
    // BRT day of a timestamp column, without relying on the server's time-zone database.
    const brtDay = (col: unknown) => sql<string>`to_char((${col} at time zone 'UTC') - interval '3 hours', 'YYYY-MM-DD')`

    const [u] = await db.select({
      total: count(),
      verified: sql<number>`count(*) filter (where ${users.emailVerifiedAt} is not null)`.mapWith(Number),
      pendingDeletion: sql<number>`count(*) filter (where ${users.deletionRequestedAt} is not null)`.mapWith(Number),
      staff: sql<number>`count(*) filter (where ${users.staffRole} is not null)`.mapWith(Number),
      restricted: sql<number>`count(*) filter (where ${users.bannedAt} is not null or ${users.suspendedUntil} > ${nowDate})`.mapWith(Number),
    }).from(users).where(notRemoved)

    const signupRows = await db.select({ day: brtDay(users.createdAt), n: count() }).from(users)
      .where(and(notRemoved, gte(users.createdAt, new Date(from)))).groupBy(brtDay(users.createdAt))
    const [prevSignups] = await db.select({ n: count() }).from(users).where(and(notRemoved, gte(users.createdAt, new Date(prevFrom)), lt(users.createdAt, new Date(from))))
    const signupMap = new Map(signupRows.map((r) => [r.day, r.n]))

    const opened = sql`(${activityDays.flags} & ${ACTIVITY_FLAGS.OPENED}) <> 0`
    const distinctSince = async (day: string, bit: number) => {
      const [r] = await db.select({ n: countDistinct(activityDays.userId) }).from(activityDays)
        .where(and(gte(activityDays.day, day), sql`(${activityDays.flags} & ${bit}) <> 0`))
      return r?.n ?? 0
    }
    const dauRows = await db.select({ day: activityDays.day, n: count() }).from(activityDays).where(and(gte(activityDays.day, first), opened)).groupBy(activityDays.day)
    const dauMap = new Map(dauRows.map((r) => [r.day, r.n]))
    const mau = await distinctSince(addDays(today, -29), ACTIVITY_FLAGS.OPENED)
    const last30 = Array.from({ length: 30 }, (_, i) => addDays(today, -30 + i))
    const avgDau = last30.reduce((n, d) => n + (dauMap.get(d) ?? 0), 0) / 30

    // ---- voice: raw sessions (35 days) for the period, voice_weekly for the 12-week trend.
    const voiceFrom = Math.max(from, now - 35 * DAY_MS)
    const vs = await db.select({ userId: voiceSessions.userId, joinedAt: voiceSessions.joinedAt, leftAt: voiceSessions.leftAt }).from(voiceSessions)
      .where(gt(voiceSessions.leftAt, new Date(voiceFrom)))
    const perDay = new Map<string, number>()
    const perUser = new Map<string, number>()
    const lengths: number[] = []
    for (const s of vs) {
      const a = Math.max(s.joinedAt.getTime(), voiceFrom)
      const b = Math.min(s.leftAt.getTime(), now)
      if (b <= a) continue
      lengths.push((s.leftAt.getTime() - s.joinedAt.getTime()) / MIN_MS)
      perUser.set(s.userId, (perUser.get(s.userId) ?? 0) + (b - a))
      for (const [d, ms] of msByDay({ userId: s.userId, channelId: '', spaceId: null, from: a, to: b })) perDay.set(d, (perDay.get(d) ?? 0) + ms)
    }
    const voiceMs = [...perUser.values()].reduce((a, b) => a + b, 0)
    const weekly = await db.select({
      week: voiceWeekly.week, minutes: sql<number>`sum(${voiceWeekly.minutes})`.mapWith(Number), people: countDistinct(voiceWeekly.userId),
    }).from(voiceWeekly).groupBy(voiceWeekly.week).orderBy(voiceWeekly.week)

    const msgRows = await db.select({ day: brtDay(messages.createdAt), n: count() }).from(messages)
      .where(gte(messages.createdAt, new Date(from))).groupBy(brtDay(messages.createdAt))
    const msgMap = new Map(msgRows.map((r) => [r.day, r.n]))
    const [sp] = await db.select({ total: count(), recent: sql<number>`count(*) filter (where ${spaces.createdAt} >= ${new Date(from)})`.mapWith(Number) }).from(spaces)

    // ---- activation and weekly cohorts (metrics opt-outs left out, like the nightly aggregates).
    const optOut = db.select({ id: activitySettings.userId }).from(activitySettings).where(eq(activitySettings.metricsOptOut, true))
    const cohortStart = mondayOf(addDays(today, -7 * 7))
    const signups = await db.select({ id: users.id, createdAt: users.createdAt }).from(users)
      .where(and(notRemoved, notInArray(users.id, optOut), gte(users.createdAt, new Date(Math.min(dayStart(cohortStart), now - 32 * DAY_MS)))))
    const flags = signups.length ? await db.select().from(activityDays).where(inArray(activityDays.userId, signups.map((s) => s.id))) : []
    const flagsOf = new Map<string, Map<string, number>>()
    for (const f of flags) {
      const m = flagsOf.get(f.userId) ?? new Map<string, number>()
      m.set(f.day, f.flags)
      flagsOf.set(f.userId, m)
    }
    // Voice-with-someone bits are written the night after: signups of the last 2 days are not judged yet.
    const actCohort = signups.filter((s) => s.createdAt.getTime() >= now - 32 * DAY_MS && s.createdAt.getTime() < dayStart(addDays(today, -1)))
    const activated = actCohort.filter((s) => {
      const d = zonedDay(s.createdAt)
      const m = flagsOf.get(s.id)
      return [d, addDays(d, 1)].some((x) => ((m?.get(x) ?? 0) & ACTIVITY_FLAGS.VOICE_WITH_OTHER) !== 0)
    }).length
    const cohorts: AdminCohortRow[] = []
    for (let week = cohortStart; week <= today; week = addDays(week, 7)) {
      const members = signups.filter((s) => mondayOf(zonedDay(s.createdAt)) === week)
      const weeks: (number | null)[] = []
      for (let n = 0; n < 8; n++) {
        const ws = addDays(week, 7 * n)
        if (ws > today) { weeks.push(null); continue }
        const span = Array.from({ length: 7 }, (_, i) => addDays(ws, i))
        const active = members.filter((m) => span.some((d) => ((flagsOf.get(m.id)?.get(d) ?? 0) & ACTIVITY_FLAGS.OPENED) !== 0)).length
        weeks.push(members.length ? active / members.length : null)
      }
      cohorts.push({ week, size: members.length, weeks })
    }

    const northStar = (await db.select({ week: metricDaily.day, value: metricDaily.value }).from(metricDaily)
      .where(eq(metricDaily.metric, 'active_groups_week')).orderBy(desc(metricDaily.day)).limit(12)).reverse()
    const un = await db.select({ reason: uninstallFeedback.reason, n: count() }).from(uninstallFeedback)
      .where(gte(uninstallFeedback.createdAt, new Date(now - 30 * DAY_MS))).groupBy(uninstallFeedback.reason)

    return {
      days,
      users: { total: u?.total ?? 0, verified: u?.verified ?? 0, pendingDeletion: u?.pendingDeletion ?? 0, staff: u?.staff ?? 0, restricted: u?.restricted ?? 0 },
      signups: { inPeriod: signupRows.reduce((n, r) => n + r.n, 0), previous: prevSignups?.n ?? 0, series: dayKeys.map((t) => ({ t, value: signupMap.get(t) ?? 0 })) },
      active: {
        dau: dauMap.get(today) ?? 0, wau: await distinctSince(addDays(today, -6), ACTIVITY_FLAGS.OPENED), mau,
        stickiness: ratio(avgDau, mau), series: dayKeys.map((t) => ({ t, value: dauMap.get(t) ?? 0 })),
        messaging30d: await distinctSince(addDays(today, -29), ACTIVITY_FLAGS.MESSAGED),
        voice30d: await distinctSince(addDays(today, -29), ACTIVITY_FLAGS.VOICE_3MIN),
      },
      voice: {
        minutesInPeriod: Math.round(voiceMs / MIN_MS), people: perUser.size,
        minutesPerPerson: perUser.size ? Math.round(voiceMs / MIN_MS / perUser.size) : null,
        medianSessionMin: median(lengths) === null ? null : Math.round(median(lengths)! * 10) / 10,
        perDay: dayKeys.map((t): AdminPoint => ({ t, value: Math.round((perDay.get(t) ?? 0) / MIN_MS) })),
        weekly: weekly.slice(-12),
      },
      messages: { inPeriod: msgRows.reduce((n, r) => n + r.n, 0), perDay: dayKeys.map((t) => ({ t, value: msgMap.get(t) ?? 0 })) },
      spaces: { total: sp?.total ?? 0, newInPeriod: sp?.recent ?? 0 },
      activation: { cohort: actCohort.length, activated, rate: ratio(activated, actCohort.length) },
      cohorts,
      northStar,
      uninstall: { total: un.reduce((n, r) => n + r.n, 0), byReason: un.sort((a, b) => b.n - a.n).map((r) => ({ reason: r.reason, count: r.n })) },
      notTracked: [
        'Tempo de uso do app: só existe o dia em que a pessoa abriu, não por quanto tempo ficou.',
        'Taxas do Mercado Pago e da Stripe: os valores são o que o cliente pagou, antes das taxas.',
        'Cobranças de renovação não viram linha no banco: cada uma é deduzida do ciclo da assinatura (início + N meses até o fim do período atual).',
        'Data exata de um reembolso: usa a última atualização do pedido ou da assinatura.',
        'Quem desligou "usar minha atividade nas métricas" fica fora de DAU/WAU/MAU, coortes e ativação.',
        'Voz por pessoa além de 35 dias (o bruto é apagado; o total por semana fica 12 semanas).',
        'De onde veio o cadastro (convite, orgânico, campanha): não é registrado.',
        'Instalações do desktop: não são contadas; desinstalações só pelo formulário anônimo de saída.',
        'Funil da loja: contadores em memória, zerados a cada reinício do servidor.',
      ],
    }
  }

  async health(nowDate = new Date()): Promise<AdminHealth> {
    const { db, hub, voice, cinema, alerts, config } = this.ctx
    const now = nowDate.getTime()
    const week = new Date(now - 7 * DAY_MS)
    const q = await db.select({
      joinMs: callQualityReports.joinMs, rtt: callQualityReports.rttAvgMs, loss: callQualityReports.packetLossPct,
      failed: callQualityReports.reconnectFailed, version: callQualityReports.appVersion,
    }).from(callQualityReports).where(gte(callQualityReports.day, week.toISOString().slice(0, 10)))
    const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null && Number.isFinite(x))
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
    const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10)
    const byVersion = new Map<string, number[]>()
    const versionCount = new Map<string, number>()
    for (const r of q) {
      versionCount.set(r.version, (versionCount.get(r.version) ?? 0) + 1)
      if (r.loss !== null) byVersion.set(r.version, [...(byVersion.get(r.version) ?? []), r.loss])
    }
    const clients = await db.select({ client: sessions.clientInfo, n: count() }).from(sessions)
      .where(and(gte(sessions.lastUsedAt, week), isNotNull(sessions.clientInfo))).groupBy(sessions.clientInfo)
    const [mod] = await db.select({
      open: sql<number>`count(*) filter (where ${reports.status} = 'open')`.mapWith(Number),
      urgent: sql<number>`count(*) filter (where ${reports.status} = 'open' and ${reports.priority} >= 50)`.mapWith(Number),
      day: sql<number>`count(*) filter (where ${reports.createdAt} >= ${new Date(now - DAY_MS)})`.mapWith(Number),
    }).from(reports)
    const [ap] = await db.select({ n: count() }).from(appeals).where(eq(appeals.status, 'open'))
    const [qu] = await db.select({ n: count() }).from(quarantinedFiles).where(and(isNull(quarantinedFiles.purgedAt), isNull(quarantinedFiles.releasedAt)))
    const jobs = await db.select({ job: jobRuns.job, period: sql<string>`max(${jobRuns.period})`, finishedAt: sql<Date | null>`max(${jobRuns.finishedAt})` })
      .from(jobRuns).groupBy(jobRuns.job)
    const states = voice.all()
    const mem = process.memoryUsage()
    return {
      at: nowDate.toISOString(), version: config.version, env: config.env, uptimeS: Math.round(process.uptime()),
      live: { online: hub.userCount(), sockets: hub.socketCount(), inVoice: states.length, voiceRooms: new Set(states.map((s) => s.channelId)).size, cinemaSeats: cinema.seatCount() },
      process: { rssBytes: mem.rss, heapUsedBytes: mem.heapUsed },
      sfu: { ok: alerts.sfu.ok, latencyMs: alerts.sfu.latencyMs, checkedAt: alerts.sfu.checkedAt?.toISOString() ?? null, downSince: alerts.sfu.downSince?.toISOString() ?? null },
      api: { ...alerts.errorCounts(now), rateLimited: metrics.rateLimited.sum() },
      quality: {
        reports7d: q.length,
        joinP50Ms: percentile(nums(q.map((r) => r.joinMs)), 50), joinP95Ms: percentile(nums(q.map((r) => r.joinMs)), 95),
        rttP50Ms: round1(percentile(nums(q.map((r) => r.rtt)), 50)), lossAvgPct: round1(avg(nums(q.map((r) => r.loss)))),
        reconnectFailRate: ratio(q.filter((r) => r.failed).length, q.length),
        byVersion: [...versionCount].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([version, reports]) => ({ version, reports, lossAvgPct: round1(avg(byVersion.get(version) ?? [])) })),
      },
      versions: clients.map((c) => {
        const [version, os] = c.client!.split('; ')
        return { version: version ?? '?', os: os ?? '?', sessions: c.n }
      }).sort((a, b) => b.sessions - a.sessions).slice(0, 8),
      moderation: { openReports: mod?.open ?? 0, urgentReports: mod?.urgent ?? 0, reports24h: mod?.day ?? 0, openAppeals: ap?.n ?? 0, quarantined: qu?.n ?? 0 },
      jobs: jobs.map((j) => ({ job: j.job, period: j.period, finishedAt: j.finishedAt ? new Date(j.finishedAt).toISOString() : null })),
      counters: {
        billingWebhookErrors: metrics.billingWebhooks.sum({ outcome: 'error' }),
        emailFailures: metrics.emailFailures.sum(),
        livekitWebhookFailures: metrics.livekitWebhookFailures.sum(),
      },
    }
  }
}
