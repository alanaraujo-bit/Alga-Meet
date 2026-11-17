/**
 * Admin app contract (apps/admin-android). Every route sits under /api/v1/admin behind the staff check and the
 * staff_audit_log of src/routes/admin.ts; money (overview, revenue events, billing in an account) is admin-only.
 *
 * GET    /admin/me                         -> AdminMe
 * GET    /admin/overview?period=           -> AdminOverview            (admin)
 * GET    /admin/growth?days=               -> AdminGrowth              (admin)
 * GET    /admin/health                     -> AdminHealth
 * GET    /admin/events?before=&limit=      -> AdminEvent[]             (money kinds only for admins)
 * GET    /admin/stream                     -> text/event-stream of AdminEvent ("event: alert")
 * GET    /admin/users/search?q=            -> AdminUserSummary[]
 * GET    /admin/users/:id                  -> AdminUserDetail          (billing only for admins)
 * GET    /admin/feedback?limit=            -> AdminFeedback[]          ("Conta pro Eco", newest first)
 * POST   /admin/devices                    RegisterAdminDeviceBody -> AdminDevice (bound to the calling session)
 * DELETE /admin/devices/:token             -> 204
 * POST   /admin/devices/test               -> { sent: number }
 */
import { z } from 'zod'
import type { StaffRole } from './trust-safety.js'

export const ADMIN_PERIODS = ['today', '7d', '30d', '90d', '12m'] as const
export type AdminPeriod = (typeof ADMIN_PERIODS)[number]

/** Events the admin app is told about (feed + push). Money kinds reach admins only. */
export const ADMIN_EVENT_KINDS = [
  'purchase', 'subscription_started', 'subscription_renewed', 'refund', 'payment_failed',
  'signup', 'report', 'report_spike', 'sfu_down', 'sfu_up', 'api_errors', 'test',
] as const
export type AdminEventKind = (typeof ADMIN_EVENT_KINDS)[number]
export const ADMIN_MONEY_KINDS: readonly AdminEventKind[] = ['purchase', 'subscription_started', 'subscription_renewed', 'refund', 'payment_failed']

export const RegisterAdminDeviceBody = z.object({
  /** FCM registration token, or "stream:<random>" for a device that only uses GET /admin/stream. */
  token: z.string().trim().min(16).max(4096),
  platform: z.enum(['android']),
  /** Kinds this device wants pushed; omitted = all it may receive. */
  kinds: z.array(z.enum(ADMIN_EVENT_KINDS)).max(ADMIN_EVENT_KINDS.length).optional(),
})
export type RegisterAdminDeviceBody = z.infer<typeof RegisterAdminDeviceBody>

export const AdminPeriodQuery = z.object({ period: z.enum(ADMIN_PERIODS).default('30d') })
export const AdminGrowthQuery = z.object({ days: z.coerce.number().int().min(7).max(90).default(30) })
export const AdminEventsQuery = z.object({
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export const AdminUserSearchQuery = z.object({ q: z.string().trim().min(1).max(120) })

export interface AdminMe {
  id: string
  username: string
  displayName: string
  role: StaffRole
  /** 'production' only on the real API: the app shows a "QA" badge otherwise. */
  env: 'development' | 'test' | 'production'
  version: string
  push: { fcm: boolean }
}

export interface AdminDevice {
  token: string
  platform: 'android'
  kinds: AdminEventKind[] | null
  createdAt: string
}

/** Amounts in cents of `currency`; BRL is the headline, USD (Stripe) only appears when there is some. */
export interface Money { brl: number; usd: number }

export interface AdminPoint { t: string; value: number }

export interface AdminPurchase {
  /** order:<id> | sub:<id>:<n> (n = charge number, 0 = first) | refund:<id> */
  id: string
  kind: 'order' | 'subscription_first' | 'subscription_renewal' | 'refund'
  at: string
  amountCents: number
  currency: 'BRL' | 'USD'
  productId: string
  productName: string
  provider: string
  gift: boolean
  user: { id: string; username: string; displayName: string } | null
}

export interface AdminOverview {
  period: AdminPeriod
  from: string
  to: string
  /** Gross charges, refunds and net in the period, and the same net for the period right before it. */
  received: { gross: Money; refunds: Money; net: Money; previousNet: Money; charges: number; refundCount: number }
  /** Net received per bucket (hour for today, day up to 90d, month for 12m), BRL only. */
  series: AdminPoint[]
  bucket: 'hour' | 'day' | 'month'
  /** Recurring revenue now: renewing Plus normalized to a month (a year / 12). */
  mrr: { now: Money; atRisk: Money; atRiskCount: number; series: AdminPoint[] }
  subscribers: {
    plus: number
    renewing: number
    period: number
    pass: number
    newInPeriod: number
    churnedInPeriod: number
    /** Plus users lost in the last 30 days ÷ Plus users 30 days ago. null without any 30 days ago. */
    churn30d: number | null
  }
  /** Plus ÷ MAU, payers this period ÷ MAU, ARPPU (net ÷ payers, BRL). */
  conversion: { mau: number; plusRate: number | null; payers: number; payerRate: number | null; arppuCents: number | null; refundRate: number | null }
  byProduct: { productId: string; name: string; kind: string; net: Money; count: number }[]
  latest: AdminPurchase[]
  /** Shop funnel counters since the last server start (in-memory, no user). */
  funnel: { since: string; shopOpen: number; tryOn: number; checkout: number; giftCheckout: number }
}

export interface AdminCohortRow {
  /** Monday (BRT) of the signup week. */
  week: string
  size: number
  /** Share (0–1) of the cohort active in week N after signup, N = 0..; null = that week has not ended. */
  weeks: (number | null)[]
}

export interface AdminGrowth {
  days: number
  users: { total: number; verified: number; pendingDeletion: number; staff: number; restricted: number }
  signups: { inPeriod: number; previous: number; series: AdminPoint[] }
  active: { dau: number; wau: number; mau: number; stickiness: number | null; series: AdminPoint[]; messaging30d: number; voice30d: number }
  /** From voice_sessions (35 days kept) and voice_weekly (12 weeks). */
  voice: {
    minutesInPeriod: number
    people: number
    minutesPerPerson: number | null
    medianSessionMin: number | null
    perDay: AdminPoint[]
    weekly: { week: string; minutes: number; people: number }[]
  }
  messages: { inPeriod: number; perDay: AdminPoint[] }
  spaces: { total: number; newInPeriod: number }
  /** Signups of the last 30 days with 3+ min in voice with someone on the signup day or the next. */
  activation: { cohort: number; activated: number; rate: number | null }
  cohorts: AdminCohortRow[]
  /** Nightly "grupos ativos na semana" (metric_daily, null = under 10). */
  northStar: { week: string; value: number | null }[]
  uninstall: { total: number; byReason: { reason: string; count: number }[] }
  /** What the database does not hold, so the screen can say it instead of inventing it. */
  notTracked: string[]
}

export interface AdminHealth {
  at: string
  version: string
  env: 'development' | 'test' | 'production'
  uptimeS: number
  live: { online: number; sockets: number; inVoice: number; voiceRooms: number; cinemaSeats: number }
  process: { rssBytes: number; heapUsedBytes: number }
  sfu: { ok: boolean | null; latencyMs: number | null; checkedAt: string | null; downSince: string | null }
  api: { errors5m: number; errors1h: number; rateLimited: number }
  quality: {
    reports7d: number
    joinP50Ms: number | null
    joinP95Ms: number | null
    rttP50Ms: number | null
    lossAvgPct: number | null
    reconnectFailRate: number | null
    byVersion: { version: string; reports: number; lossAvgPct: number | null }[]
  }
  versions: { version: string; os: string; sessions: number }[]
  moderation: { openReports: number; urgentReports: number; reports24h: number; openAppeals: number; quarantined: number }
  jobs: { job: string; period: string; finishedAt: string | null }[]
  counters: { billingWebhookErrors: number; emailFailures: number; livekitWebhookFailures: number }
}

export interface AdminEvent {
  id: string
  kind: AdminEventKind
  title: string
  body: string
  amountCents: number | null
  currency: 'BRL' | 'USD' | null
  /** The account the event is about, resolved at read time (never written into title/body, which also go to FCM). */
  user: { id: string; username: string; displayName: string } | null
  createdAt: string
}

export interface AdminUserSummary {
  id: string
  username: string
  displayName: string
  email: string
  plan: 'free' | 'plus'
  createdAt: string
  staffRole: StaffRole | null
  state: 'ok' | 'suspended' | 'banned' | 'deleting'
}

export interface AdminUserDetail extends AdminUserSummary {
  emailVerified: boolean
  plusSince: string | null
  lastSeenAt: string | null
  suspendedUntil: string | null
  bannedAt: string | null
  legalHold: boolean
  deletionPurgeAfter: string | null
  ageBracket: string | null
  counts: { spaces: number; friends: number; reportsAgainst: number; reportsBy: number; falseReports: number }
  sessions: { id: string; client: string | null; os: string | null; createdAt: string; lastUsedAt: string }[]
  actions: { id: string; type: string; reason: string; until: string | null; createdAt: string; note: string | null }[]
  /** null for moderators. */
  billing: {
    lifetime: Money
    subscriptions: { id: string; productId: string; productName: string; kind: string; status: string; amountCents: number; currency: string; provider: string; startedAt: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean }[]
    orders: { id: string; productId: string; productName: string; status: string; amountCents: number; currency: string; provider: string; createdAt: string; paidAt: string | null; gift: boolean }[]
  } | null
}

export interface AdminFeedback {
  id: string
  kind: string
  text: string
  /** "<app version>; <os>" of the sender's app, when it sent the header. */
  client: string | null
  hasScreenshot: boolean
  createdAt: string
  user: { id: string; username: string; displayName: string }
}