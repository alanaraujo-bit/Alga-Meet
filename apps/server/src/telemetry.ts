/**
 * Opt-in call-quality telemetry (contract: packages/shared/src/telemetry.ts). Reports are aggregates the desktop
 * computes at the end of a voice session; they land in Prometheus histograms (src/metrics.ts) and in
 * `call_quality_reports` for 30 days. What is never stored: the time of day, IPs, rooms/channels/spaces, user ids.
 * `user_hash` = HMAC-SHA256(salt, user id) with a random salt that lives only in memory and is replaced every UTC
 * day, so reports of one user can be counted within a day and cannot be linked across days or back to the account.
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import type { CallQualityReport } from '@alga/shared'
import { lt } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import type { Db } from './db/index.js'
import { callQualityReports } from './db/schema.js'
import { safeErr } from './errors.js'
import { metrics } from './metrics.js'

export const CALL_QUALITY_RETENTION_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000
const utcDay = (d: Date) => d.toISOString().slice(0, 10)

export class Telemetry {
  private salt = { day: '', key: Buffer.alloc(0) }
  private timer: NodeJS.Timeout | undefined
  private sweeping: Promise<number> | undefined

  constructor(private readonly db: Db, private readonly log: FastifyBaseLogger) {}

  /** Pseudonym valid for one UTC day (see file header). */
  userHash(userId: string, now = new Date()): string {
    const day = utcDay(now)
    if (this.salt.day !== day) this.salt = { day, key: randomBytes(32) }
    return createHmac('sha256', this.salt.key).update(userId).digest('hex').slice(0, 32)
  }

  async record(userId: string, r: CallQualityReport, now = new Date()): Promise<void> {
    const { stream, ...rest } = r
    await this.db.insert(callQualityReports).values({
      ...rest, id: randomUUID(), day: utcDay(now), userHash: this.userHash(userId, now),
      streamFps: stream?.fps ?? null, streamResolution: stream?.resolution ?? null,
    })
    const m = metrics
    m.callReports.inc({ os: r.os })
    m.callDuration.observe({}, r.sessionDurationS)
    m.callReconnects.observe({}, r.reconnects)
    if (r.reconnectFailed) m.callReconnectFailures.inc()
    if (r.joinMs !== null) m.callJoin.observe({}, r.joinMs / 1000)
    if (r.rttAvgMs !== null) m.callRtt.observe({}, r.rttAvgMs / 1000)
    if (r.rttP95Ms !== null) m.callRttP95.observe({}, r.rttP95Ms / 1000)
    if (r.jitterMs !== null) m.callJitter.observe({}, r.jitterMs / 1000)
    if (r.packetLossPct !== null) m.callLoss.observe({}, r.packetLossPct)
    if (r.concealmentPct !== null) m.callConcealment.observe({}, r.concealmentPct)
    if (stream) m.callStreams.inc({ fps: stream.fps, resolution: stream.resolution })
    if (r.videoCodec) m.callEncoders.inc({ codec: r.videoCodec, hw: r.encoderHardware === null ? 'unknown' : String(r.encoderHardware) })
  }

  /** Retention job: deletes reports older than CALL_QUALITY_RETENTION_DAYS. Returns rows deleted. */
  sweep(now = new Date()): Promise<number> {
    this.sweeping ??= (async () => {
      const cut = utcDay(new Date(now.getTime() - CALL_QUALITY_RETENTION_DAYS * DAY_MS))
      const gone = await this.db.delete(callQualityReports).where(lt(callQualityReports.day, cut)).returning({ id: callQualityReports.id })
      return gone.length
    })().finally(() => { this.sweeping = undefined })
    return this.sweeping
  }

  start(intervalMs = 60 * 60_000): void {
    const run = () => void this.sweep().catch((err: unknown) => this.log.error({ err: safeErr(err) }, 'telemetry sweep failed'))
    this.timer = setInterval(run, intervalMs)
    this.timer.unref()
  }

  async stop(): Promise<void> {
    clearInterval(this.timer)
    await this.sweeping?.catch(() => {})
  }
}
