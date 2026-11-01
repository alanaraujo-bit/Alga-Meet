/**
 * Package D1: space events, RSVP and reminders (docs/retention/server.md). Reminder tests call Events.remind with a
 * fabricated "now"; the events start days ahead so the real-time scheduler never reaches them during the run.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_EVERYONE_PERMISSIONS, EVENT_TEMPLATE_DEFAULTS, Permission, addLocalDays, currentOccurrence, nextStart, utcToZoned, zonedToUtc,
  type AuthResponse, type EventRsvps, type EventView, type Invite, type SpaceSnapshot,
} from '@alga/shared'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { roles, spaces } from '../src/db/schema.js'
import { api, connect, freshDatabaseUrl, register, startServer, type TestServer } from './helpers.js'

let s: TestServer
beforeAll(async () => { s = await startServer() })
afterAll(async () => { await s.close() })
afterEach(() => { vi.restoreAllMocks() })

const MIN = 60_000
const DAY = 24 * 60 * MIN
type User = AuthResponse & { password: string }

async function group(app: FastifyInstance = s.app, n = 3) {
  const owner = await register(app)
  const space = (await api<SpaceSnapshot>(app, 'POST', '/spaces', { token: owner.token, body: { name: 'Galera' } })).body
  const inv = (await api<Invite>(app, 'POST', `/spaces/${space.id}/invites`, { token: owner.token, body: {} })).body
  const members: User[] = []
  for (let i = 0; i < n; i++) {
    const m = await register(app)
    expect((await api(app, 'POST', `/invites/${inv.code}`, { token: m.token })).status).toBe(200)
    members.push(m)
  }
  const voice = space.channels.find((c) => c.type === 'voice')!.id
  const text = space.channels.find((c) => c.type === 'text')!.id
  return { owner, members, space, voice, text }
}

/** A wall time `days` ahead at `time` (BRT). */
const localIn = (days: number, time = '23:50') => `${utcToZoned(Date.now() + days * DAY).slice(0, 10)}T${time}`

const create = (u: User, spaceId: string, body: Record<string, unknown>, app = s.app) =>
  api<EventView>(app, 'POST', `/spaces/${spaceId}/events`, { token: u.token, body })

/** EVENT_REMINDER dispatches about `eventId` (other tests' events share the database). */
const reminderCalls = (spy: { mock: { calls: unknown[][] } }, eventId: string) =>
  spy.mock.calls.filter((c) => c[1] === 'EVENT_REMINDER' && (c[2] as { eventId: string }).eventId === eventId)

describe('wall time in America/Sao_Paulo', () => {
  it('converts both ways and refuses dates that do not exist', () => {
    expect(zonedToUtc('2031-03-07T23:50')!.toISOString()).toBe('2031-03-08T02:50:00.000Z') // Friday night = Saturday UTC
    expect(utcToZoned(new Date('2031-03-08T02:50:00Z'))).toBe('2031-03-07T23:50')
    expect(zonedToUtc('2031-02-30T10:00')).toBeNull()
    expect(zonedToUtc('2031-03-07T24:00')).toBeNull()
  })

  it('keeps a weekly event on its wall time across midnight UTC and across a DST change (Brazil 2018/19)', () => {
    const friday = { startsLocal: '2031-03-07T23:50', durationMinutes: 120, weekly: true }
    const next = nextStart(friday, new Date('2031-03-08T03:00:00Z'))!
    expect(utcToZoned(next)).toBe('2031-03-14T23:50')
    expect(next.getUTCDay()).toBe(6) // still Saturday in UTC, Friday in Brasília

    // Brazilian DST began 2018-11-04 and ended 2019-02-17: 21:00 stays 21:00 local, the UTC hour moves.
    const dst = { startsLocal: '2018-10-26T21:00', durationMinutes: 60, weekly: true }
    expect(nextStart(dst, new Date('2018-10-28T00:00:00Z'))!.toISOString()).toBe('2018-11-03T00:00:00.000Z') // UTC-3
    expect(nextStart(dst, new Date('2018-11-04T00:00:00Z'))!.toISOString()).toBe('2018-11-09T23:00:00.000Z') // UTC-2
    expect(utcToZoned(nextStart(dst, new Date('2019-02-17T12:00:00Z'))!)).toBe('2019-02-22T21:00')
    expect(nextStart(dst, new Date('2019-02-17T12:00:00Z'))!.toISOString()).toBe('2019-02-23T00:00:00.000Z') // UTC-3 again
  })

  it('reports the live occurrence, then the next, and null for a one-off that is over', () => {
    const ev = { startsLocal: '2031-03-07T21:00', durationMinutes: 120, weekly: true }
    expect(currentOccurrence(ev, new Date('2031-03-08T01:00:00Z'))).toEqual({ startsAt: '2031-03-08T00:00:00.000Z', endsAt: '2031-03-08T02:00:00.000Z' })
    expect(currentOccurrence(ev, new Date('2031-03-08T02:00:00Z'))!.startsAt).toBe('2031-03-15T00:00:00.000Z')
    expect(currentOccurrence({ ...ev, weekly: false }, new Date('2031-03-08T02:00:00Z'))).toBeNull()
  })
})

describe('events', () => {
  it('lets members create events (CREATE_EVENTS is on for @everyone) and tells the space', async () => {
    const { owner, members: [b], space, voice } = await group()
    const gw = await connect(s.port, owner.token)
    const t = EVENT_TEMPLATE_DEFAULTS.game_night
    const res = await create(b!, space.id, { title: t.title, channelId: voice, startsLocal: localIn(3, t.time), durationMinutes: t.durationMinutes, weekly: true, template: 'game_night' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ spaceId: space.id, channelId: voice, creatorId: b!.user.id, title: 'Sexta do jogo', weekly: true, template: 'game_night', cover: null, going: 0, maybe: 0, myRsvp: null })
    expect(res.body.next!.startsAt).toBe(zonedToUtc(res.body.startsLocal)!.toISOString())
    const pushed = await gw.waitFor('EVENT_CREATE', (e) => e.id === res.body.id)
    expect(pushed).not.toHaveProperty('myRsvp')
    gw.close()
    expect((await api<EventView[]>(s.app, 'GET', '/events', { token: owner.token })).body.map((e) => e.id)).toContain(res.body.id)
    expect((await api<EventView[]>(s.app, 'GET', `/spaces/${space.id}/events`, { token: owner.token })).body).toHaveLength(1)
  })

  it('validates the channel, the date and the cover (a Casa perk)', async () => {
    const { owner, space, voice, text } = await group(s.app, 0)
    const base = { title: 'Estudo', channelId: voice, startsLocal: localIn(2, '19:00') }
    expect((await create(owner, space.id, { ...base, channelId: text })).body.error.fields.channelId).toBeTruthy()
    expect((await create(owner, space.id, { ...base, startsLocal: localIn(-2, '19:00') })).body.error.fields.startsLocal).toBeTruthy()
    expect((await create(owner, space.id, { ...base, startsLocal: localIn(400, '19:00') })).status).toBe(400)
    expect((await create(owner, space.id, { ...base, startsLocal: '2031-02-30T19:00' })).status).toBe(400)
    expect((await create(owner, space.id, { ...base, cover: 'study' })).status).toBe(409)

    await s.app.ctx.db.update(spaces).set({ upgradeEndsAt: new Date(Date.now() + 10 * DAY) }).where(eq(spaces.id, space.id))
    const lit = await create(owner, space.id, { ...base, cover: 'study' })
    expect(lit.status).toBe(201)
    expect(lit.body.cover).toBe('study')
    // The Casa ends: the choice is kept but not shown.
    await s.app.ctx.db.update(spaces).set({ upgradeEndsAt: new Date(Date.now() - DAY) }).where(eq(spaces.id, space.id))
    expect((await api<EventView[]>(s.app, 'GET', `/spaces/${space.id}/events`, { token: owner.token })).body[0]!.cover).toBeNull()
  })

  it('checks permissions on the server: CREATE_EVENTS to create, creator or MANAGE_SPACE to edit/delete', async () => {
    const { owner, members: [b, c], space, voice } = await group()
    const ev = (await create(b!, space.id, { title: 'Cinema', channelId: voice, startsLocal: localIn(4, '20:00') })).body
    expect((await api(s.app, 'PATCH', `/events/${ev.id}`, { token: c!.token, body: { title: 'meu' } })).status).toBe(403)
    expect((await api(s.app, 'DELETE', `/events/${ev.id}`, { token: c!.token })).status).toBe(403)
    expect((await api<EventView>(s.app, 'PATCH', `/events/${ev.id}`, { token: b!.token, body: { title: 'Cinema de domingo' } })).body.title).toBe('Cinema de domingo')

    // @everyone without CREATE_EVENTS: no new events, and the creator can no longer edit theirs; the owner still can.
    await s.app.ctx.db.update(roles).set({ permissions: DEFAULT_EVERYONE_PERMISSIONS & ~Permission.CREATE_EVENTS }).where(eq(roles.id, space.id))
    expect((await create(c!, space.id, { title: 'x', channelId: voice, startsLocal: localIn(4) })).status).toBe(403)
    expect((await api(s.app, 'PATCH', `/events/${ev.id}`, { token: b!.token, body: { title: 'y' } })).status).toBe(403)
    expect((await api(s.app, 'PATCH', `/events/${ev.id}`, { token: owner.token, body: { durationMinutes: 90 } })).status).toBe(200)
    const gw = await connect(s.port, c!.token)
    expect((await api(s.app, 'DELETE', `/events/${ev.id}`, { token: owner.token })).status).toBe(204)
    await gw.waitFor('EVENT_DELETE', (d) => d.id === ev.id)
    gw.close()
  })

  it('hides events, RSVPs and their lists from anyone outside the space (IDOR)', async () => {
    const { members: [b], space, voice } = await group(s.app, 1)
    const outsider = await register(s.app)
    const ev = (await create(b!, space.id, { title: 'Sexta', channelId: voice, startsLocal: localIn(3) })).body
    await api(s.app, 'PUT', `/events/${ev.id}/rsvp`, { token: b!.token, body: { status: 'going' } })
    const as = { token: outsider.token }
    expect((await api(s.app, 'GET', `/spaces/${space.id}/events`, as)).status).toBe(403)
    expect((await create(outsider, space.id, { title: 'x', channelId: voice, startsLocal: localIn(3) })).status).toBe(403)
    expect((await api(s.app, 'GET', `/events/${ev.id}/rsvps`, as)).status).toBe(404)
    expect((await api(s.app, 'PUT', `/events/${ev.id}/rsvp`, { ...as, body: { status: 'going' } })).status).toBe(404)
    expect((await api(s.app, 'DELETE', `/events/${ev.id}/rsvp`, as)).status).toBe(404)
    expect((await api(s.app, 'PATCH', `/events/${ev.id}`, { ...as, body: { title: 'x' } })).status).toBe(404)
    expect((await api(s.app, 'DELETE', `/events/${ev.id}`, as)).status).toBe(404)
    expect((await api<EventView[]>(s.app, 'GET', '/events', as)).body).toEqual([])
    // A member who leaves stops seeing it and drops out of the counts.
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/members/@me`, { token: b!.token })).status).toBe(204)
    expect((await api(s.app, 'GET', `/events/${ev.id}/rsvps`, { token: b!.token })).status).toBe(404)
  })

  it('records Vou/Talvez/Não with counts, lists only going/maybe, and keeps the e-mail choice only with going/maybe', async () => {
    const { owner, members: [b, c, d], space, voice } = await group()
    const ev = (await create(owner, space.id, { title: 'Sexta', channelId: voice, startsLocal: localIn(3), weekly: true })).body
    const gw = await connect(s.port, owner.token)
    const rsvp = (u: User, body: unknown) => api<EventView>(s.app, 'PUT', `/events/${ev.id}/rsvp`, { token: u.token, body })
    const going = await rsvp(b!, { status: 'going', emailReminder: true })
    expect(going.body).toMatchObject({ myRsvp: 'going', emailReminder: true, going: 1, maybe: 0 })
    await gw.waitFor('EVENT_RSVP_UPDATE', (e) => e.userId === b!.user.id && e.status === 'going' && e.going === 1)
    expect((await rsvp(c!, { status: 'maybe' })).body).toMatchObject({ myRsvp: 'maybe', emailReminder: false, going: 1, maybe: 1 })
    const dGw = await connect(s.port, d!.token)
    expect((await rsvp(d!, { status: 'not_going', emailReminder: true })).body).toMatchObject({ myRsvp: 'not_going', emailReminder: false })
    expect((await gw.waitFor('EVENT_RSVP_UPDATE', (e) => e.userId === d!.user.id)).status).toBeNull() // "Não" stays private
    expect((await dGw.waitFor('EVENT_RSVP_UPDATE', (e) => e.userId === d!.user.id)).status).toBe('not_going')
    dGw.close()
    const list = (await api<EventRsvps>(s.app, 'GET', `/events/${ev.id}/rsvps`, { token: c!.token })).body
    expect(list.going.map((u) => u.id)).toEqual([b!.user.id])
    expect(list.maybe.map((u) => u.id)).toEqual([c!.user.id])
    expect(JSON.stringify(list)).not.toContain(d!.user.id)
    // Unchanged when omitted; dropped with "Não"; removed with DELETE.
    expect((await rsvp(b!, { status: 'maybe' })).body.emailReminder).toBe(true)
    expect((await rsvp(b!, { status: 'not_going' })).body.emailReminder).toBe(false)
    expect((await api<EventView>(s.app, 'DELETE', `/events/${ev.id}/rsvp`, { token: b!.token })).body.myRsvp).toBeNull()
    await gw.waitFor('EVENT_RSVP_UPDATE', (e) => e.userId === b!.user.id && e.status === null)
    gw.close()
    // The e-mail needs a verified address.
    const unverified = await register(s.app, undefined, { verified: false })
    const inv = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: owner.token, body: {} })).body
    await api(s.app, 'POST', `/invites/${inv.code}`, { token: unverified.token })
    expect((await rsvp(unverified, { status: 'going', emailReminder: true })).status).toBe(403)
  })
})

describe('reminders', () => {
  it('reminds going/maybe exactly once per occurrence, 15 min before, every week, even with two concurrent runs', async () => {
    const { owner, members: [b, c, d], space, voice } = await group()
    const startsLocal = localIn(3, '23:50') // 02:50 UTC the next day
    const ev = (await create(owner, space.id, { title: 'Sexta do jogo', channelId: voice, startsLocal, weekly: true })).body
    await api(s.app, 'PUT', `/events/${ev.id}/rsvp`, { token: b!.token, body: { status: 'going' } })
    await api(s.app, 'PUT', `/events/${ev.id}/rsvp`, { token: c!.token, body: { status: 'maybe' } })
    await api(s.app, 'PUT', `/events/${ev.id}/rsvp`, { token: d!.token, body: { status: 'not_going' } })
    const start = zonedToUtc(startsLocal)!.getTime()
    const spy = vi.spyOn(s.app.ctx.hub, 'dispatch')

    await s.app.ctx.events.remind(new Date(start - 20 * MIN)) // too early
    expect(reminderCalls(spy, ev.id)).toHaveLength(0)
    await Promise.all([s.app.ctx.events.remind(new Date(start - 10 * MIN)), s.app.ctx.events.remind(new Date(start - 10 * MIN))])
    await s.app.ctx.events.remind(new Date(start - 5 * MIN))
    const first = reminderCalls(spy, ev.id)
    expect(first).toHaveLength(1)
    expect([...first[0]![0] as string[]].sort()).toEqual([b!.user.id, c!.user.id].sort())
    expect(first[0]![2]).toMatchObject({ eventId: ev.id, spaceId: space.id, channelId: voice, startsAt: new Date(start).toISOString() })

    // Next week, same wall time.
    const week2 = zonedToUtc(addLocalDays(startsLocal, 7))!.getTime()
    expect(week2 - start).toBe(7 * DAY)
    await s.app.ctx.events.remind(new Date(week2 - 14 * MIN))
    await s.app.ctx.events.remind(new Date(week2 - 1 * MIN))
    const all = reminderCalls(spy, ev.id)
    expect(all).toHaveLength(2)
    expect(utcToZoned(new Date((all[1]![2] as { startsAt: string }).startsAt))).toBe(addLocalDays(startsLocal, 7))
  })

  it('sends the 2 h e-mail only to who asked on that event, once', async () => {
    const { owner, members: [b, c], space, voice } = await group(s.app, 2)
    const startsLocal = localIn(5, '21:00')
    const ev = (await create(owner, space.id, { title: 'Cinema', channelId: voice, startsLocal })).body
    await api(s.app, 'PUT', `/events/${ev.id}/rsvp`, { token: b!.token, body: { status: 'going', emailReminder: true } })
    await api(s.app, 'PUT', `/events/${ev.id}/rsvp`, { token: c!.token, body: { status: 'going' } })
    const outbox = s.config.email.driver === 'console' ? s.config.email.outboxDir : ''
    const mails = () => readdirSync(outbox).filter((f) => f.includes('-event_reminder-'))
    const before = mails().length
    const start = zonedToUtc(startsLocal)!.getTime()
    await Promise.all([s.app.ctx.events.remind(new Date(start - 100 * MIN)), s.app.ctx.events.remind(new Date(start - 90 * MIN))])
    await s.app.ctx.events.remind(new Date(start - 30 * MIN))
    await vi.waitFor(() => expect(mails().length).toBe(before + 1))
    await new Promise((r) => setTimeout(r, 200))
    expect(mails().length).toBe(before + 1)
  })

  it('never repeats a reminder after a restart on the same database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'alga-pglite-'))
    const url = await freshDatabaseUrl()
    const env: Record<string, string> = url ? { DATABASE_URL: url } : { PGLITE_DIR: dir }
    try {
      const a = await startServer(env)
      const { owner, members: [b], space, voice } = await group(a.app, 1)
      const startsLocal = localIn(6, '22:00')
      const ev = (await create(owner, space.id, { title: 'Sexta', channelId: voice, startsLocal, weekly: true }, a.app)).body
      await api(a.app, 'PUT', `/events/${ev.id}/rsvp`, { token: b!.token, body: { status: 'going' } })
      const start = zonedToUtc(startsLocal)!.getTime()
      const spyA = vi.spyOn(a.app.ctx.hub, 'dispatch')
      await a.app.ctx.events.remind(new Date(start - 12 * MIN))
      expect(reminderCalls(spyA, ev.id)).toHaveLength(1)
      await a.close()

      const restarted = await startServer(env)
      const spyB = vi.spyOn(restarted.app.ctx.hub, 'dispatch')
      await restarted.app.ctx.events.remind(new Date(start - 11 * MIN))
      expect(reminderCalls(spyB, ev.id)).toHaveLength(0)
      await restarted.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000) // two boots of an on-disk database, migrations included
})
