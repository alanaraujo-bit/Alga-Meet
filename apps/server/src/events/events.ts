/**
 * Space events (growth-plan §4.1 "Noite de jogo"): CRUD, RSVP and the reminder job. Visible only to members of the space
 * who can view channels; an event id from anywhere else is a 404. Contract: packages/shared/src/events.ts.
 */
import {
  EVENT_EMAIL_REMINDER_MINUTES, EVENT_MAX_DAYS_AHEAD, EVENT_REMINDER_MINUTES, MAX_EVENTS_PER_SPACE, Permission,
  currentOccurrence, hasPermission, nextStart, uuidv7, utcToZoned, zonedToUtc,
  type CreateEventBody, type EventRsvps, type EventView, type PatchEventBody, type RsvpBody, type RsvpStatus, type SpaceEvent,
} from '@alga/shared'
import { and, count, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { channelAudience, memberPermissions } from '../access.js'
import type { Ctx } from '../app.js'
import { isRestricted, requireVerifiedEmail } from '../auth.js'
import { channels, eventReminders, eventRsvps, events, spaceMembers, spaces, users, type EventRow } from '../db/schema.js'
import { eventReminderMail } from '../email-templates.js'
import { conflict, forbidden, invalid, notFound, safeErr } from '../errors.js'
import { publicUser } from '../views.js'

const MIN = 60_000
const DAY = 24 * 60 * MIN

/** Weekly events, and one-offs not over at `at`. */
export const liveEvents = (at: Date) =>
  or(eq(events.weekly, true), gt(sql`${events.startsAt} + make_interval(mins => ${events.durationMinutes})`, at))!

/** Spaces where the user is a member who can view channels (events are visible there). */
export async function visibleSpaceIds(ctx: Ctx, userId: string): Promise<string[]> {
  const rows = await ctx.db.select({ id: spaceMembers.spaceId }).from(spaceMembers).where(eq(spaceMembers.userId, userId))
  const out: string[] = []
  for (const { id } of rows) {
    const p = (await memberPermissions(ctx.db, id, userId)).get(userId)
    if (p !== undefined && hasPermission(p, Permission.VIEW_CHANNELS)) out.push(id)
  }
  return out
}

export class Events {
  constructor(private readonly ctx: Ctx) {}

  /** Going/maybe counts among current members, per event. */
  private async counts(ids: string[]): Promise<Map<string, { going: number; maybe: number }>> {
    const out = new Map(ids.map((id) => [id, { going: 0, maybe: 0 }]))
    if (!ids.length) return out
    const rows = await this.ctx.db.select({ eventId: eventRsvps.eventId, status: eventRsvps.status, n: count() }).from(eventRsvps)
      .innerJoin(events, eq(events.id, eventRsvps.eventId))
      .innerJoin(spaceMembers, and(eq(spaceMembers.spaceId, events.spaceId), eq(spaceMembers.userId, eventRsvps.userId)))
      .where(inArray(eventRsvps.eventId, ids))
      .groupBy(eventRsvps.eventId, eventRsvps.status)
    for (const r of rows) {
      const c = out.get(r.eventId)!
      if (r.status === 'going') c.going = r.n
      else if (r.status === 'maybe') c.maybe = r.n
    }
    return out
  }

  /** SpaceEvent for each row (same for every member). */
  async views(rows: EventRow[], now = new Date()): Promise<SpaceEvent[]> {
    if (!rows.length) return []
    const counts = await this.counts(rows.map((r) => r.id))
    const lit = new Set((await this.ctx.db.select({ id: spaces.id }).from(spaces)
      .where(and(inArray(spaces.id, [...new Set(rows.map((r) => r.spaceId))]), gt(spaces.upgradeEndsAt, now)))).map((s) => s.id))
    return rows.map((r) => ({
      id: r.id, spaceId: r.spaceId, channelId: r.channelId, creatorId: r.creatorId, title: r.title, description: r.description,
      template: r.template, startsLocal: r.startsLocal, startsAt: r.startsAt.toISOString(), durationMinutes: r.durationMinutes,
      weekly: r.weekly, cover: lit.has(r.spaceId) ? r.cover : null, next: currentOccurrence(r, now),
      ...counts.get(r.id)!, createdAt: r.createdAt.toISOString(),
    }))
  }

  /** EventView for `userId` (their own answer added). */
  private async forUser(rows: EventRow[], userId: string, now = new Date()): Promise<EventView[]> {
    const base = await this.views(rows, now)
    const mine = rows.length
      ? await this.ctx.db.select().from(eventRsvps).where(and(eq(eventRsvps.userId, userId), inArray(eventRsvps.eventId, rows.map((r) => r.id))))
      : []
    return base.map((e) => {
      const r = mine.find((m) => m.eventId === e.id)
      return { ...e, myRsvp: r?.status ?? null, emailReminder: r?.emailReminder ?? false }
    })
  }

  /** Events with an occurrence live or ahead, soonest first, in the given spaces (or every visible one). */
  async list(userId: string, spaceId?: string, now = new Date()): Promise<EventView[]> {
    const ids = spaceId ? [spaceId] : await visibleSpaceIds(this.ctx, userId)
    if (!ids.length) return []
    const rows = await this.ctx.db.select().from(events).where(and(inArray(events.spaceId, ids), liveEvents(now)))
    const views = (await this.forUser(rows, userId, now)).filter((e) => e.next)
    return views.sort((a, b) => a.next!.startsAt.localeCompare(b.next!.startsAt))
  }

  /** The event if `userId` may see it (member who can view channels), else 404; plus their permissions there. */
  async load(id: string, userId: string): Promise<{ row: EventRow; permissions: number }> {
    const [row] = await this.ctx.db.select().from(events).where(eq(events.id, id))
    const permissions = row ? (await memberPermissions(this.ctx.db, row.spaceId, userId)).get(userId) : undefined
    if (!row || permissions === undefined || !hasPermission(permissions, Permission.VIEW_CHANNELS)) throw notFound('Evento não encontrado.')
    return { row, permissions }
  }

  async one(id: string, userId: string): Promise<EventView> {
    const { row } = await this.load(id, userId)
    return (await this.forUser([row], userId))[0]!
  }

  private async audience(spaceId: string): Promise<string[]> {
    return channelAudience(this.ctx.db, { id: spaceId, spaceId })
  }

  private async announce(row: EventRow, t: 'EVENT_CREATE' | 'EVENT_UPDATE'): Promise<void> {
    const [view] = await this.views([row])
    this.ctx.hub.dispatch(await this.audience(row.spaceId), t, view!)
  }

  /** startsLocal → instant, from now to EVENT_MAX_DAYS_AHEAD (400 `fields.startsLocal` otherwise). */
  private startOf(local: string, now: Date): Date {
    const at = zonedToUtc(local)
    if (!at || at.getTime() < now.getTime() - MIN || at.getTime() > now.getTime() + EVENT_MAX_DAYS_AHEAD * DAY) {
      throw invalid({ startsLocal: 'Escolha uma data a partir de agora e em até um ano.' })
    }
    return at
  }

  private async checkChannel(spaceId: string, channelId: string): Promise<void> {
    const [c] = await this.ctx.db.select({ id: channels.id }).from(channels)
      .where(and(eq(channels.id, channelId), eq(channels.spaceId, spaceId), eq(channels.type, 'voice')))
    if (!c) throw invalid({ channelId: 'Escolha um canal de voz deste espaço.' })
  }

  /** A cover is a Casa perk (growth-plan §2.3): only while the Casa is lit. */
  private async checkCover(spaceId: string, now: Date): Promise<void> {
    const [s] = await this.ctx.db.select({ endsAt: spaces.upgradeEndsAt }).from(spaces).where(eq(spaces.id, spaceId))
    if (!s?.endsAt || s.endsAt <= now) throw conflict('A capa do evento é um benefício da Casa: ela precisa estar acesa.')
  }

  async create(spaceId: string, userId: string, body: CreateEventBody, now = new Date()): Promise<EventView> {
    const { db } = this.ctx
    await this.checkChannel(spaceId, body.channelId)
    const startsAt = this.startOf(body.startsLocal, now)
    if (body.cover) await this.checkCover(spaceId, now)
    // One-offs that are over do not count. shortcut: two concurrent creates can both pass at 49; harmless.
    const [c] = await db.select({ n: count() }).from(events).where(and(eq(events.spaceId, spaceId), liveEvents(now)))
    if ((c?.n ?? 0) >= MAX_EVENTS_PER_SPACE) throw conflict(`Um espaço tem no máximo ${MAX_EVENTS_PER_SPACE} eventos marcados.`)
    const [row] = await db.insert(events).values({
      id: uuidv7(), spaceId, channelId: body.channelId, creatorId: userId, title: body.title, description: body.description,
      template: body.template, startsLocal: body.startsLocal, startsAt, durationMinutes: body.durationMinutes, weekly: body.weekly,
      cover: body.cover, createdAt: now, updatedAt: now,
    }).returning()
    await this.announce(row!, 'EVENT_CREATE')
    return (await this.forUser([row!], userId, now))[0]!
  }

  /** Its creator (still holding CREATE_EVENTS) or MANAGE_SPACE. */
  private async editable(id: string, userId: string): Promise<EventRow> {
    const { row, permissions } = await this.load(id, userId)
    const own = row.creatorId === userId && hasPermission(permissions, Permission.CREATE_EVENTS)
    if (!own && !hasPermission(permissions, Permission.MANAGE_SPACE)) throw forbidden('Só quem criou o evento ou quem gerencia o espaço pode mudá-lo.')
    return row
  }

  async patch(id: string, userId: string, body: PatchEventBody, now = new Date()): Promise<EventView> {
    const row = await this.editable(id, userId)
    const set: Partial<EventRow> = { updatedAt: now }
    if (body.title !== undefined) set.title = body.title
    if (body.description !== undefined) set.description = body.description
    if (body.durationMinutes !== undefined) set.durationMinutes = body.durationMinutes
    if (body.weekly !== undefined) set.weekly = body.weekly
    if (body.channelId !== undefined) {
      await this.checkChannel(row.spaceId, body.channelId)
      set.channelId = body.channelId
    }
    if (body.startsLocal !== undefined && body.startsLocal !== row.startsLocal) {
      set.startsAt = this.startOf(body.startsLocal, now)
      set.startsLocal = body.startsLocal
    }
    if (body.cover !== undefined) {
      if (body.cover) await this.checkCover(row.spaceId, now)
      set.cover = body.cover
    }
    const [after] = await this.ctx.db.update(events).set(set).where(eq(events.id, id)).returning()
    if (!after) throw notFound('Evento não encontrado.')
    await this.announce(after, 'EVENT_UPDATE')
    return (await this.forUser([after], userId, now))[0]!
  }

  async remove(id: string, userId: string): Promise<void> {
    const row = await this.editable(id, userId)
    await this.ctx.db.delete(events).where(eq(events.id, id))
    this.ctx.hub.dispatch(await this.audience(row.spaceId), 'EVENT_DELETE', { id, spaceId: row.spaceId })
  }

  /** PUT (status) or DELETE (null) of the caller's answer. */
  async rsvp(id: string, user: typeof users.$inferSelect, body: RsvpBody | null, now = new Date()): Promise<EventView> {
    const { db, hub } = this.ctx
    const { row } = await this.load(id, user.id)
    let status: RsvpStatus | null = null
    if (body) {
      if (!currentOccurrence(row, now)) throw conflict('Este evento já acabou.')
      if (body.emailReminder) requireVerifiedEmail(user, 'receber o lembrete por e-mail')
      status = body.status
      const [prev] = await db.select().from(eventRsvps).where(and(eq(eventRsvps.eventId, id), eq(eventRsvps.userId, user.id)))
      const emailReminder = status !== 'not_going' && (body.emailReminder ?? prev?.emailReminder ?? false)
      await db.insert(eventRsvps).values({ eventId: id, userId: user.id, status, emailReminder, updatedAt: now })
        .onConflictDoUpdate({ target: [eventRsvps.eventId, eventRsvps.userId], set: { status, emailReminder, updatedAt: now } })
    } else {
      await db.delete(eventRsvps).where(and(eq(eventRsvps.eventId, id), eq(eventRsvps.userId, user.id)))
    }
    const c = (await this.counts([id])).get(id)!
    // "Não" is nobody else's business: the others see no answer.
    hub.dispatch(await this.audience(row.spaceId), 'EVENT_RSVP_UPDATE', (to) =>
      ({ eventId: id, spaceId: row.spaceId, userId: user.id, status: status === 'not_going' && to !== user.id ? null : status, ...c }))
    return (await this.forUser([row], user.id, now))[0]!
  }

  async rsvps(id: string, userId: string): Promise<EventRsvps> {
    const { row } = await this.load(id, userId)
    const rows = await this.ctx.db.select({ u: users, status: eventRsvps.status }).from(eventRsvps)
      .innerJoin(users, eq(users.id, eventRsvps.userId))
      .innerJoin(spaceMembers, and(eq(spaceMembers.spaceId, row.spaceId), eq(spaceMembers.userId, eventRsvps.userId)))
      .where(and(eq(eventRsvps.eventId, id), inArray(eventRsvps.status, ['going', 'maybe'])))
      .orderBy(eventRsvps.updatedAt)
    return {
      going: rows.filter((r) => r.status === 'going').map((r) => publicUser(r.u)),
      maybe: rows.filter((r) => r.status === 'maybe').map((r) => publicUser(r.u)),
    }
  }

  // ---- reminders --------------------------------------------------------------------------------------------------

  /**
   * One pass of the reminder job (every minute): EVENT_REMINDER for an occurrence starting within
   * EVENT_REMINDER_MINUTES, and the e-mail from EVENT_EMAIL_REMINDER_MINUTES before until the in-app one. Each
   * (occurrence, kind) is claimed with an INSERT on a primary key before sending, so it goes out at most once whatever
   * restarts or concurrent workers happen (a crash between the claim and the send loses that one reminder).
   */
  async remind(now = new Date()): Promise<void> {
    const soon = new Date(now.getTime() + EVENT_EMAIL_REMINDER_MINUTES * MIN)
    // shortcut: scans every weekly event each minute; keep a next_start column if this passes ~50k events.
    const rows = await this.ctx.db.select().from(events).where(or(
      eq(events.weekly, true), and(gt(events.startsAt, now), lte(events.startsAt, soon)),
    ))
    for (const ev of rows) {
      const start = nextStart(ev, now)
      if (!start) continue
      const lead = start.getTime() - now.getTime()
      try {
        if (lead <= EVENT_REMINDER_MINUTES * MIN) await this.send(ev, start, 'app')
        else if (lead <= EVENT_EMAIL_REMINDER_MINUTES * MIN) await this.send(ev, start, 'email')
      } catch (err) {
        this.ctx.log.error({ err: safeErr(err), eventId: ev.id }, 'events: reminder failed')
      }
    }
  }

  private async send(ev: EventRow, start: Date, kind: 'app' | 'email'): Promise<void> {
    const { db, hub, mail } = this.ctx
    const [claimed] = await db.insert(eventReminders).values({ eventId: ev.id, occurrenceAt: start, kind })
      .onConflictDoNothing().returning({ kind: eventReminders.kind })
    if (!claimed) return
    const who = await db.select({ u: users, email: eventRsvps.emailReminder }).from(eventRsvps)
      .innerJoin(users, eq(users.id, eventRsvps.userId))
      .innerJoin(spaceMembers, and(eq(spaceMembers.spaceId, ev.spaceId), eq(spaceMembers.userId, eventRsvps.userId)))
      .where(and(eq(eventRsvps.eventId, ev.id), inArray(eventRsvps.status, ['going', 'maybe']), isNull(users.deletionRequestedAt)))
    const viewers = new Set(await this.audience(ev.spaceId))
    const to = who.filter((w) => viewers.has(w.u.id) && !isRestricted(w.u))
    if (kind === 'app') {
      hub.dispatch(to.map((w) => w.u.id), 'EVENT_REMINDER', { eventId: ev.id, spaceId: ev.spaceId, channelId: ev.channelId, title: ev.title, startsAt: start.toISOString() })
      return
    }
    const content = eventReminderMail(utcToZoned(start).slice(11))
    for (const w of to) if (w.email && w.u.emailVerifiedAt) mail.send({ to: w.u.email, kind: 'event_reminder', ...content })
  }
}
