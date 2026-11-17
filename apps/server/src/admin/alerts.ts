/**
 * What the admin app is told, at the moment it happens: each event is stored in admin_events (the app's feed), sent to
 * the open GET /admin/stream connections and pushed through FCM to the staff devices that may see it (money kinds:
 * admins only). Callers fire and forget; nothing here can fail or delay the request or payment that caused it.
 *
 * FCM bodies never carry a username or an e-mail (they transit Google): the feed resolves the account at read time.
 *
 * Also the watchers whose events have no request to hang on: the SFU probe (2 failed checks in a row = down), the 5xx
 * burst counter and the report-spike check.
 */
import {
  ADMIN_MONEY_KINDS, uuidv7,
  type AdminEvent, type AdminEventKind, type StaffRole,
} from '@alga/shared'
import { and, count, eq, gte, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import type { Config } from '../config.js'
import type { Db } from '../db/index.js'
import { adminDevices, adminEvents, reports, users, type AdminEventRow, type ReportRow } from '../db/schema.js'
import { safeErr } from '../errors.js'
import { Fcm, parseServiceAccount } from './fcm.js'

export interface AlertInput {
  kind: AdminEventKind
  title: string
  body: string
  amountCents?: number | null
  currency?: 'BRL' | 'USD' | null
  userId?: string | null
}

const CHANNELS: Record<AdminEventKind, string> = {
  purchase: 'money', subscription_started: 'money', subscription_renewed: 'money',
  refund: 'money_issues', payment_failed: 'money_issues',
  signup: 'growth', report: 'safety', report_spike: 'safety',
  sfu_down: 'infra', sfu_up: 'infra', api_errors: 'infra', test: 'money',
}

const MIN = 60_000
const PROBE_EVERY_MS = MIN
const PROBE_TIMEOUT_MS = 3000
/** 5xx responses within 5 minutes that make an "API com erros" alert (then quiet for 30 min). */
export const API_ERROR_BURST = 20
/** Reports in the last hour that make a spike, when also 3× the hourly average of the 7 days before. */
export const REPORT_SPIKE_MIN = 5
const EVENTS_KEPT_DAYS = 180

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' })
/** "R$ 14,90" with a plain space (Intl puts a no-break space there). */
export const formatMoney = (cents: number, currency: 'BRL' | 'USD' = 'BRL') => (currency === 'USD' ? usd : brl).format(cents / 100).replace(/ /g, ' ')

export const mayReceive = (role: StaffRole, kind: AdminEventKind) => role === 'admin' || !ADMIN_MONEY_KINDS.includes(kind)

type Listener = { role: StaffRole; send: (e: AdminEvent) => void }

export class AdminAlerts {
  readonly fcm: Fcm | null
  private readonly listeners = new Set<Listener>()
  private timer: NodeJS.Timeout | undefined
  private sweepTimer: NodeJS.Timeout | undefined
  private errors: number[] = []
  private lastErrorsAlert = 0
  private lastSpike = 0
  private probeFails = 0
  private pending = new Set<Promise<unknown>>()
  readonly sfu: { ok: boolean | null; latencyMs: number | null; checkedAt: Date | null; downSince: Date | null } = {
    ok: null, latencyMs: null, checkedAt: null, downSince: null,
  }

  constructor(
    private readonly config: Config,
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
    fcm?: Fcm | null,
  ) {
    this.fcm = fcm !== undefined ? fcm : config.push.fcmServiceAccount ? new Fcm(parseServiceAccount(config.push.fcmServiceAccount)) : null
  }

  start(): void {
    // Tests drive probeSfu() themselves (their LiveKit URL is a dead port on purpose).
    if (this.config.env === 'test') return
    this.timer = setInterval(() => void this.probeSfu(), PROBE_EVERY_MS)
    this.timer.unref()
    void this.probeSfu()
    this.sweepTimer = setInterval(() => void this.sweep(), 6 * 60 * MIN)
    this.sweepTimer.unref()
  }

  async stop(): Promise<void> {
    clearInterval(this.timer)
    clearInterval(this.sweepTimer)
    await this.settled()
  }

  /** Resolves when every event fired so far has been stored and pushed (tests). */
  async settled(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending])
  }

  /** Fire and forget. */
  fire(input: AlertInput): void {
    const p = this.emit(input).finally(() => this.pending.delete(p))
    this.pending.add(p)
  }

  async emit(input: AlertInput, now = new Date()): Promise<AdminEvent | null> {
    try {
      const [row] = await this.db.insert(adminEvents).values({
        id: uuidv7(), kind: input.kind, title: input.title.slice(0, 120), body: input.body.slice(0, 400),
        amountCents: input.amountCents ?? null, currency: input.currency ?? null, userId: input.userId ?? null, createdAt: now,
      }).returning()
      const [view] = await this.views([row!])
      for (const l of this.listeners) if (mayReceive(l.role, view!.kind)) l.send(view!)
      await this.push(row!)
      return view!
    } catch (err) {
      this.log.error({ err: safeErr(err), kind: input.kind }, 'admin: alert not delivered')
      return null
    }
  }

  /** Only to the caller's own devices (POST /admin/devices/test). */
  async test(userId: string): Promise<number> {
    const devices = await this.db.select().from(adminDevices).where(eq(adminDevices.userId, userId))
    if (!this.fcm) return 0
    let sent = 0
    for (const d of devices) {
      if (d.token.startsWith('stream:')) continue
      if (await this.deliver(d.token, { kind: 'test', title: 'Teste de notificação', body: 'Se você está lendo isto, o caminho servidor → FCM → celular funciona.', id: uuidv7() })) sent++
    }
    return sent
  }

  subscribe(role: StaffRole, send: (e: AdminEvent) => void): () => void {
    const l = { role, send }
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  async views(rows: AdminEventRow[]): Promise<AdminEvent[]> {
    const ids = [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))]
    const people = ids.length ? await this.db.select({ id: users.id, username: users.username, displayName: users.displayName }).from(users).where(inArray(users.id, ids)) : []
    return rows.map((r) => ({
      id: r.id, kind: r.kind, title: r.title, body: r.body, amountCents: r.amountCents, currency: r.currency,
      user: people.find((p) => p.id === r.userId) ?? null, createdAt: r.createdAt.toISOString(),
    }))
  }

  private async push(row: AdminEventRow): Promise<void> {
    if (!this.fcm) return
    // Current role, not the one at registration: a revoked staff account stops getting anything.
    const devices = await this.db.select({ token: adminDevices.token, kinds: adminDevices.kinds, role: users.staffRole })
      .from(adminDevices).innerJoin(users, eq(users.id, adminDevices.userId))
      .where(and(isNotNull(users.staffRole), isNull(users.bannedAt), or(isNull(users.suspendedUntil), lt(users.suspendedUntil, new Date()))))
    for (const d of devices) {
      if (d.token.startsWith('stream:') || !mayReceive(d.role!, row.kind) || (d.kinds && !d.kinds.includes(row.kind))) continue
      await this.deliver(d.token, row)
    }
  }

  private async deliver(token: string, e: Pick<AdminEventRow, 'kind' | 'title' | 'body' | 'id'>): Promise<boolean> {
    try {
      const r = await this.fcm!.send(token, { title: e.title, body: e.body, channel: CHANNELS[e.kind], data: { kind: e.kind, eventId: e.id } })
      if (r === 'gone') await this.db.delete(adminDevices).where(eq(adminDevices.token, token))
      if (r === 'ok') await this.db.update(adminDevices).set({ lastPushAt: new Date() }).where(eq(adminDevices.token, token))
      if (r === 'error') this.log.warn({ kind: e.kind }, 'admin: FCM refused a push')
      return r === 'ok'
    } catch (err) {
      this.log.warn({ err: safeErr(err), kind: e.kind }, 'admin: FCM unreachable')
      return false
    }
  }

  // ---- watchers -----------------------------------------------------------------------------------------------------

  /** onResponse of every request. */
  recordStatus(status: number, now = Date.now()): void {
    if (status < 500) return
    this.errors.push(now)
    this.errors = this.errors.filter((t) => t > now - 60 * MIN)
    const recent = this.errors.filter((t) => t > now - 5 * MIN).length
    if (recent >= API_ERROR_BURST && now - this.lastErrorsAlert > 30 * MIN) {
      this.lastErrorsAlert = now
      this.fire({ kind: 'api_errors', title: 'API com erros', body: `${recent} respostas 5xx nos últimos 5 minutos.` })
    }
  }

  errorCounts(now = Date.now()): { errors5m: number; errors1h: number } {
    return { errors5m: this.errors.filter((t) => t > now - 5 * MIN).length, errors1h: this.errors.filter((t) => t > now - 60 * MIN).length }
  }

  async probeSfu(now = new Date()): Promise<void> {
    const t0 = performance.now()
    let ok = false
    try {
      const res = await fetch(this.config.livekit.url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      ok = res.ok
    } catch {
      ok = false
    }
    this.sfu.checkedAt = now
    this.sfu.latencyMs = ok ? Math.round(performance.now() - t0) : null
    if (ok) {
      this.probeFails = 0
      if (this.sfu.downSince) {
        const mins = Math.max(1, Math.round((now.getTime() - this.sfu.downSince.getTime()) / MIN))
        this.fire({ kind: 'sfu_up', title: 'Servidor de voz de volta', body: `Respondendo de novo depois de ${mins} min fora.` })
      }
      this.sfu.ok = true
      this.sfu.downSince = null
      return
    }
    this.probeFails++
    // Two misses in a row: one dropped check is not an outage.
    if (this.probeFails === 2) {
      this.sfu.ok = false
      this.sfu.downSince = new Date(now.getTime() - PROBE_EVERY_MS)
      this.fire({ kind: 'sfu_down', title: 'Servidor de voz fora do ar', body: 'O SFU não responde há 2 verificações seguidas. As chamadas não conectam.' })
    }
  }

  /** POST /reports, after the insert. */
  async reportFiled(r: ReportRow, label: string, now = new Date()): Promise<void> {
    if (r.priority >= 50) {
      this.fire({ kind: 'report', title: r.reason === 'csam' ? 'Denúncia urgente: abuso infantil' : 'Denúncia de alta prioridade', body: `Categoria: ${label}. Na fila da equipe.`, userId: r.targetUserId })
    }
    if (now.getTime() - this.lastSpike < 60 * MIN) return
    try {
      const hourAgo = new Date(now.getTime() - 60 * MIN)
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * MIN)
      const [last] = await this.db.select({ n: count() }).from(reports).where(gte(reports.createdAt, hourAgo))
      const [before] = await this.db.select({ n: count() }).from(reports).where(and(gte(reports.createdAt, weekAgo), lt(reports.createdAt, hourAgo)))
      const n = last?.n ?? 0
      const hourly = (before?.n ?? 0) / (7 * 24)
      if (n >= REPORT_SPIKE_MIN && n >= 3 * hourly) {
        this.lastSpike = now.getTime()
        this.fire({ kind: 'report_spike', title: 'Pico de denúncias', body: `${n} denúncias na última hora (média de ${hourly.toFixed(1)} por hora na semana).` })
      }
    } catch (err) {
      this.log.warn({ err: safeErr(err) }, 'admin: report spike check failed')
    }
  }

  async sweep(now = new Date()): Promise<void> {
    await this.db.delete(adminEvents).where(lt(adminEvents.createdAt, new Date(now.getTime() - EVENTS_KEPT_DAYS * 24 * 60 * MIN)))
      .catch((err: unknown) => this.log.warn({ err: safeErr(err) }, 'admin: events sweep failed'))
  }
}

