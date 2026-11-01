/**
 * Package D1 (docs/retention/server.md): voice sessions from LiveKit, weekly recap, "Semanas juntos", activity
 * settings and e-mail, "entrou na voz" scopes, nightly aggregates and purges, shop funnel labels, privacy coverage.
 * Fabricated dates are in 2031–2032 so the real-time scheduler (which works on today's periods) never meets them.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SHOP_FUNNEL_STEPS, uuidv7, zonedToUtc,
  type ActivitySettings, type AuthResponse, type Channel, type Invite, type SpaceSnapshot, type VoiceNotifyScopes, type WeeklyRecap,
  type WeeksTogether,
} from '@alga/shared'
import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { sendActivityEmails } from '../src/activity/email.js'
import { nextStreak, runWeekly } from '../src/activity/recap.js'
import { PRODUCTS, isAvailable } from '../src/billing/catalog.js'
import {
  activityDays, activityEmails, activitySettings, consentRecords, events, metricCohorts, metricDaily, users,
  voiceSessions, voiceWeekly, weeklyRecaps,
} from '../src/db/schema.js'
import { metrics, registry } from '../src/metrics.js'
import { countShop } from '../src/routes/activity.js'
import { api, befriend, postWebhook, register, startServer, type TestServer } from './helpers.js'

let s: TestServer
beforeAll(async () => { s = await startServer() })
afterAll(async () => { await s.close() })
afterEach(() => { vi.restoreAllMocks() })

const MIN = 60_000
const DAY = 24 * 60 * MIN
type User = AuthResponse & { password: string }
const db = () => s.app.ctx.db
const at = (local: string) => zonedToUtc(local)!

async function spaceOf(owner: User, ...members: User[]) {
  const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: owner.token, body: { name: 'Galera' } })).body
  const inv = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: owner.token, body: {} })).body
  for (const m of members) expect((await api(s.app, 'POST', `/invites/${inv.code}`, { token: m.token })).status).toBe(200)
  return { space, voice: space.channels.find((c) => c.type === 'voice')!.id }
}

/** A raw voice session, BRT wall times. */
const session = (u: User, channelId: string, spaceId: string | null, from: string, to: string) =>
  db().insert(voiceSessions).values({ id: uuidv7(), userId: u.user.id, channelId, spaceId, joinedAt: at(from), leftAt: at(to) })

const adult = (u: User) => db().update(users).set({ birthDate: '1990-01-01' }).where(eq(users.id, u.user.id))
const teen = (u: User) => db().update(users).set({ birthDate: `${new Date().getUTCFullYear() - 17}-01-01` }).where(eq(users.id, u.user.id))

describe('voice sessions (D7 webhooks)', () => {
  it('records one row per ended voice state, and lists the scope for the "entrou na voz" notice', async () => {
    const a = await register(s.app)
    const b = await register(s.app)
    const outsider = await register(s.app)
    const { space, voice } = await spaceOf(a, b)
    const joinedAt = String(Math.floor(Date.now() / 1000) - 120)
    const ev = (name: string, n: number) => ({
      event: name, id: `RT_${name}_${n}_${voice}`, createdAt: joinedAt,
      room: { sid: 'RM_x', name: `ch_${voice}` }, participant: { sid: 'PA_x', identity: b.user.id, name: 'b', joinedAt },
    })
    expect((await postWebhook(s.app, s.config, ev('participant_joined', 1))).status).toBe(200)
    expect((await postWebhook(s.app, s.config, ev('participant_left', 2))).status).toBe(200)
    await vi.waitFor(async () => {
      const rows = await db().select().from(voiceSessions).where(eq(voiceSessions.userId, b.user.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ channelId: voice, spaceId: space.id })
      expect(rows[0]!.leftAt.getTime() - rows[0]!.joinedAt.getTime()).toBeGreaterThanOrEqual(119_000)
    })

    const scopes = (await api<VoiceNotifyScopes>(s.app, 'GET', '/users/@me/voice-notify', { token: b.token })).body.scopes
    expect(scopes).toEqual([expect.objectContaining({ scopeId: space.id, kind: 'space', notify: null })])
    expect(scopes[0]!.lastCallAt).toBeTruthy()
    // "Avisar" on a space of yours; never on someone else's.
    expect((await api(s.app, 'PUT', `/users/@me/voice-notify/${space.id}`, { token: a.token, body: { notify: true } })).body)
      .toMatchObject({ scopeId: space.id, kind: 'space', lastCallAt: null, notify: true })
    expect((await api(s.app, 'PUT', `/users/@me/voice-notify/${space.id}`, { token: outsider.token, body: { notify: true } })).status).toBe(404)
    expect((await api<VoiceNotifyScopes>(s.app, 'GET', '/users/@me/voice-notify', { token: outsider.token })).body.scopes).toEqual([])
    await api(s.app, 'PUT', `/users/@me/voice-notify/${space.id}`, { token: a.token, body: { notify: null } })
    expect((await api<VoiceNotifyScopes>(s.app, 'GET', '/users/@me/voice-notify', { token: a.token })).body.scopes).toEqual([])
  })
})

describe('weekly recap and "Semanas juntos"', () => {
  const W = '2031-03-03' // a Monday

  it('builds the recap from voice and events only, with the two switches, blocks and membership applied', async () => {
    const [a, b, c, d, e, t] = [await register(s.app), await register(s.app), await register(s.app), await register(s.app), await register(s.app), await register(s.app)]
    for (const u of [a, b, c, d, e]) await adult(u)
    await teen(t)
    const { space, voice } = await spaceOf(await register(s.app), a, b, c, d, t)
    await befriend(s.app, a, e)
    const dm = (await api<Channel>(s.app, 'POST', '/users/@me/channels', { token: a.token, body: { recipientIds: [e.user.id] } })).body
    await api(s.app, 'PATCH', '/users/@me/activity-settings', { token: d.token, body: { showInOthersRecap: false } })
    const [ev] = await db().insert(events).values({
      id: uuidv7(), spaceId: space.id, channelId: voice, creatorId: a.user.id, title: 'Sexta do jogo', startsLocal: '2031-02-24T21:00',
      startsAt: at('2031-02-24T21:00'), durationMinutes: 120, weekly: true,
    }).returning()

    await session(a, voice, space.id, '2031-03-03T21:00', '2031-03-03T22:00')
    await session(b, voice, space.id, '2031-03-03T21:00', '2031-03-03T22:00')
    await session(c, voice, space.id, '2031-03-03T21:00', '2031-03-03T22:00')
    await session(t, voice, space.id, '2031-03-03T21:00', '2031-03-03T21:30')
    await session(a, voice, space.id, '2031-03-04T20:00', '2031-03-04T20:50')
    await session(d, voice, space.id, '2031-03-04T20:00', '2031-03-04T20:50')
    await session(a, voice, space.id, '2031-03-05T10:00', '2031-03-05T10:20')
    await session(a, dm.id, null, '2031-03-06T21:00', '2031-03-06T21:40')
    await session(e, dm.id, null, '2031-03-06T21:00', '2031-03-06T21:40')
    await session(a, voice, space.id, '2031-03-10T21:00', '2031-03-10T23:00') // the week after: not in this recap

    const dispatch = vi.spyOn(s.app.ctx.hub, 'dispatch')
    await runWeekly(s.app.ctx, W, true)
    await runWeekly(s.app.ctx, W, false) // a re-run changes nothing
    const kinds = new Set(dispatch.mock.calls.map((x) => x[1]))
    expect([...kinds]).toEqual(['WEEKLY_RECAP_READY'])
    const ready = [...dispatch.mock.calls[0]![0] as string[]]
    expect(ready.sort()).toEqual([a, b, c, d, e].map((u) => u.user.id).sort()) // 16–17 never get the notice

    const recapOf = async (u: User, week = W) => (await api<{ recap: WeeklyRecap | null }>(s.app, 'GET', `/users/@me/recap?week=${week}`, { token: u.token })).body.recap
    const r = (await recapOf(a))!
    expect(r).toMatchObject({
      week: W, voiceMinutes: 170, nights: 3, topChannel: { channelId: voice, spaceId: space.id },
      events: [{ eventId: ev!.id, spaceId: space.id, title: 'Sexta do jogo', startsAt: at('2031-03-03T21:00').toISOString() }],
      weeksTogether: [{ spaceId: space.id, weeks: 1 }],
    })
    expect(Object.keys(r).sort()).toEqual(['events', 'nights', 'people', 'topChannel', 'voiceMinutes', 'week', 'weeksTogether'])
    expect(r.people.map((p) => p.id).sort()).toEqual([b, c, e].map((u) => u.user.id).sort()) // d hid, t ranks 5th
    expect(JSON.stringify(r)).not.toMatch(/message|minutesWith/i)
    expect((await recapOf(t))!.voiceMinutes).toBe(30) // teens see their card in the app
    expect((await api<{ recap: WeeklyRecap | null }>(s.app, 'GET', '/users/@me/recap', { token: a.token })).body.recap!.week).toBe(W)
    expect(await recapOf(await register(s.app))).toBeNull()

    // Read-time rules: someone switching off, a block, leaving the space.
    await api(s.app, 'PATCH', '/users/@me/activity-settings', { token: b.token, body: { showInOthersRecap: false } })
    await api(s.app, 'PUT', `/relationships/${e.user.id}`, { token: a.token, body: { type: 'blocked' } })
    expect((await recapOf(a))!.people.map((p) => p.id)).toEqual([c.user.id, t.user.id])
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/members/@me`, { token: a.token })).status).toBe(204)
    const left = (await recapOf(a))!
    expect(left.topChannel).toBeUndefined()
    expect(left.events).toEqual([])
    expect(left.weeksTogether).toEqual([])
  })

  it('counts weeks with a 3+ member call of 30+ min, pauses one missed week per 4, and never notifies', async () => {
    expect(nextStreak({ weeks: 3, sincePause: 3, lastWeek: null }, W, false)).toEqual({ weeks: 0, sincePause: 0, lastWeek: W })
    const four = nextStreak({ weeks: 3, sincePause: 3, lastWeek: null }, W, true)
    expect(four).toEqual({ weeks: 4, sincePause: 4, lastWeek: W })
    const paused = nextStreak(four, '2031-03-10', false)
    expect(paused).toEqual({ weeks: 4, sincePause: 0, lastWeek: '2031-03-10' })
    expect(nextStreak(paused, '2031-03-17', false).weeks).toBe(0)

    const [o, m1, m2, outsider] = [await register(s.app), await register(s.app), await register(s.app), await register(s.app)]
    const { space, voice } = await spaceOf(o, m1, m2)
    const sends = vi.spyOn(s.app.ctx.mail.sender, 'send')
    const dispatch = vi.spyOn(s.app.ctx.hub, 'dispatch')
    const three = async (day: string, minutes: number) => {
      for (const u of [o, m1, m2]) await session(u, voice, space.id, `${day}T20:00`, `${day}T20:${String(minutes).padStart(2, '0')}`)
    }
    const view = async (u = o) => (await api<WeeksTogether>(s.app, 'GET', `/spaces/${space.id}/weeks-together`, { token: u.token })).body
    await three('2031-04-07', 45)
    await runWeekly(s.app.ctx, '2031-04-07', false)
    expect(await view(m1)).toMatchObject({ enabled: true, weeks: 1, pauseAvailable: false, lastWeek: '2031-04-07' })
    await three('2031-04-14', 25) // under 30 min: not counted, the streak ends
    await runWeekly(s.app.ctx, '2031-04-14', false)
    expect((await view()).weeks).toBe(0)
    for (const w of ['2031-04-21', '2031-04-28', '2031-05-05', '2031-05-12']) {
      await three(w, 40)
      await runWeekly(s.app.ctx, w, false)
    }
    expect(await view()).toMatchObject({ weeks: 4, pauseAvailable: true })
    await runWeekly(s.app.ctx, '2031-05-19', false) // missed: paused automatically
    expect(await view()).toMatchObject({ weeks: 4, pauseAvailable: false, lastWeek: '2031-05-19' })
    await runWeekly(s.app.ctx, '2031-05-26', false)
    expect((await view()).weeks).toBe(0)

    // Admin switch: members cannot, outsiders cannot even look; off clears it and stops counting.
    expect((await api(s.app, 'PATCH', `/spaces/${space.id}/weeks-together`, { token: m1.token, body: { enabled: false } })).status).toBe(403)
    expect((await api(s.app, 'GET', `/spaces/${space.id}/weeks-together`, { token: outsider.token })).status).toBe(403)
    await three('2031-06-02', 50)
    await runWeekly(s.app.ctx, '2031-06-02', false)
    expect((await view()).weeks).toBe(1)
    expect((await api<WeeksTogether>(s.app, 'PATCH', `/spaces/${space.id}/weeks-together`, { token: o.token, body: { enabled: false } })).body)
      .toMatchObject({ enabled: false, weeks: 0 })
    await three('2031-06-09', 50)
    await runWeekly(s.app.ctx, '2031-06-09', false)
    expect(await view()).toMatchObject({ enabled: false, weeks: 0 })
    expect((await api<WeeksTogether>(s.app, 'PATCH', `/spaces/${space.id}/weeks-together`, { token: o.token, body: { enabled: true } })).body)
      .toMatchObject({ enabled: true, weeks: 0 })

    // No code path notifies about it: nothing was dispatched or mailed by any of the above.
    expect(dispatch).not.toHaveBeenCalled()
    expect(sends).not.toHaveBeenCalled()
    // And the code says so: the contract has no streak event; the job's only dispatch is the recap one.
    const gateway = readFileSync(fileURLToPath(new URL('../../../packages/shared/src/gateway.ts', import.meta.url)), 'utf8')
    expect(gateway).not.toMatch(/t: '[A-Z_]*(STREAK|TOGETHER)[A-Z_]*'/)
    const recapSrc = readFileSync(fileURLToPath(new URL('../src/activity/recap.ts', import.meta.url)), 'utf8')
    expect(recapSrc.match(/\.dispatch\(/g)).toHaveLength(1)
    expect(recapSrc).toMatch(/'WEEKLY_RECAP_READY'/)
    expect(recapSrc).not.toMatch(/mail\.|sendActivity/)
  })
})

describe('activity settings and the activity e-mail', () => {
  const base = new Date('2032-01-05T15:00:00Z') // a Monday, 12:00 in Brasília
  const settings = (u: User, body?: unknown) =>
    api<ActivitySettings>(s.app, body ? 'PATCH' : 'GET', '/users/@me/activity-settings', { token: u.token, ...(body ? { body } : {}) })
  const sentTo = async (u: User) => (await db().select().from(activityEmails).where(eq(activityEmails.userId, u.user.id))).length
  const away = (u: User, since: Date) => db().update(activitySettings).set({ lastSeenAt: since }).where(eq(activitySettings.userId, u.user.id))

  it('needs consent (recorded), an adult with a verified e-mail, 7 days away and a reason; caps at 1/7 days and 4 per 60', async () => {
    const [a, tn, idle] = [await register(s.app), await register(s.app), await register(s.app)]
    expect((await settings(a)).body).toEqual({ showInOthersRecap: true, metricsOptOut: false, activityEmail: false, activityEmailAllowed: false })
    expect((await settings(a, { activityEmail: true })).status).toBe(403) // age unknown
    await adult(a)
    await adult(idle)
    await teen(tn)
    expect((await settings(tn, { activityEmail: true })).status).toBe(403)
    expect((await settings(a, { activityEmail: true })).body).toMatchObject({ activityEmail: true, activityEmailAllowed: true })
    await settings(idle, { activityEmail: true })
    const consents = await db().select().from(consentRecords).where(and(eq(consentRecords.userId, a.user.id), eq(consentRecords.purpose, 'activity_email')))
    expect(consents).toHaveLength(1)
    expect(consents[0]!.withdrawnAt).toBeNull()
    // A teen forced on in the database still never gets it.
    await db().insert(activitySettings).values({ userId: tn.user.id, activityEmail: true }).onConflictDoUpdate({ target: activitySettings.userId, set: { activityEmail: true } })
    await db().insert(consentRecords).values({ id: uuidv7(), userId: tn.user.id, purpose: 'activity_email', termsVersion: 'x' })

    const { space } = await spaceOf(a, tn)
    await db().insert(events).values({
      id: uuidv7(), spaceId: space.id, channelId: null, creatorId: a.user.id, title: 'Sexta', startsLocal: '2032-01-06T21:00',
      startsAt: at('2032-01-06T21:00'), durationMinutes: 120, weekly: true,
    })
    for (const u of [a, tn, idle]) await away(u, new Date(base.getTime() - 8 * DAY))

    await sendActivityEmails(s.app.ctx, base)
    expect([await sentTo(a), await sentTo(tn), await sentTo(idle)]).toEqual([1, 0, 0]) // idle: no reason
    await sendActivityEmails(s.app.ctx, new Date(base.getTime() + DAY))
    expect(await sentTo(a)).toBe(1) // 1 per 7 days
    for (const k of [1, 2, 3, 4]) await sendActivityEmails(s.app.ctx, new Date(base.getTime() + 7 * k * DAY + MIN))
    expect(await sentTo(a)).toBe(4) // 4 without coming back, then it stops
    await s.app.ctx.activity.seen(a.user.id, new Date(base.getTime() + 29 * DAY))
    await sendActivityEmails(s.app.ctx, new Date(base.getTime() + 29 * DAY))
    await sendActivityEmails(s.app.ctx, new Date(base.getTime() + 40 * DAY))
    expect(await sentTo(a)).toBe(4) // back, then away again: still 4 in 60 days

    // One-click unsubscribe from the mail itself.
    const outbox = s.config.email.driver === 'console' ? s.config.email.outboxDir : ''
    const mailOf = () => readdirSync(outbox).filter((f) => f.includes('-activity-')).map((f) => readFileSync(join(outbox, f), 'utf8')).find((m) => m.includes(a.user.id))
    const mail = await vi.waitFor(() => { // delivery is fire-and-forget
      const m = mailOf()
      if (!m) throw new Error('activity e-mail not written yet')
      return m
    })
    const link = /\/api\/v1\/email\/unsubscribe\?u=[0-9a-f-]+&sig=[\w-]+/.exec(mail)![0]
    expect((await s.app.inject({ method: 'GET', url: `${link}x` })).statusCode).toBe(403)
    const page = await s.app.inject({ method: 'GET', url: link })
    expect(page.statusCode).toBe(200)
    expect(page.body).toContain('não vai mais receber')
    expect((await settings(a)).body.activityEmail).toBe(false)
    const [withdrawn] = await db().select().from(consentRecords).where(and(eq(consentRecords.userId, a.user.id), eq(consentRecords.purpose, 'activity_email')))
    expect(withdrawn!.withdrawnAt).not.toBeNull()
    expect((await s.app.inject({ method: 'POST', url: link, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'List-Unsubscribe=One-Click' })).statusCode).toBe(204)
  })

  it('writes for a friend who called while you were away', async () => {
    const [g, h] = [await register(s.app), await register(s.app)]
    await adult(g)
    await befriend(s.app, g, h)
    const dm = (await api<Channel>(s.app, 'POST', '/users/@me/channels', { token: h.token, body: { recipientIds: [g.user.id] } })).body
    await settings(g, { activityEmail: true })
    await away(g, new Date(base.getTime() - 10 * DAY))
    await session(h, dm.id, null, '2032-01-02T20:00', '2032-01-02T20:05')
    await sendActivityEmails(s.app.ctx, base)
    const [row] = await db().select().from(activityEmails).where(eq(activityEmails.userId, g.user.id))
    expect(row!.reason).toBe('friend_call')
  })

  it('"Não usar minha atividade" deletes the daily records and stops writing them', async () => {
    const u = await register(s.app)
    expect((await db().select().from(activityDays).where(eq(activityDays.userId, u.user.id))).length).toBeGreaterThan(0) // the signup itself
    await settings(u, { metricsOptOut: true })
    expect(await db().select().from(activityDays).where(eq(activityDays.userId, u.user.id))).toEqual([])
    const later = new Date(Date.now() + 2 * DAY)
    await s.app.ctx.activity.seen(u.user.id, later)
    expect(await db().select().from(activityDays).where(eq(activityDays.userId, u.user.id))).toEqual([])
    const [row] = await db().select().from(activitySettings).where(eq(activitySettings.userId, u.user.id))
    expect(row!.lastSeenAt!.getTime()).toBe(later.getTime())
  })
})

describe('jobs, aggregates and retention', () => {
  it('claims a job period once, even concurrently', async () => {
    const claims = await Promise.all([1, 2, 3].map(() => s.app.ctx.activity.claim('test', 'p1')))
    expect(claims.filter(Boolean)).toHaveLength(1)
  })

  it('aggregates without ids: cells under 10 hidden, opt-outs left out', async () => {
    const C = '2031-08-01'
    const D = '2031-08-02'
    const ids: string[] = []
    for (let i = 0; i < 13; i++) {
      const id = uuidv7()
      ids.push(id)
      await db().insert(users).values({ id, email: `c${i}-${id}@example.com`, username: `c${i}_${id.slice(-8)}`, displayName: 'c', passwordHash: 'x', createdAt: at(`${C}T12:00`) })
    }
    await db().insert(activitySettings).values({ userId: ids[12]!, metricsOptOut: true })
    await db().insert(activityDays).values(ids.slice(0, 10).map((userId) => ({ userId, day: D, flags: 1 })))
    const now = at('2031-08-03T05:00')
    await s.app.ctx.activity.nightly(D, now)
    const cell = async () => (await db().select().from(metricCohorts).where(and(eq(metricCohorts.cohortDay, C), eq(metricCohorts.metric, 'd1'))))[0]
    expect(await cell()).toMatchObject({ size: 12, value: 10 })
    const daily = async (metric: string, day = D) => (await db().select().from(metricDaily).where(and(eq(metricDaily.day, day), eq(metricDaily.metric, metric))))[0]?.value
    expect(await daily('active_users')).toBe(10)
    expect(await daily('voice_users')).toBeNull() // 0 < 10
    await s.app.ctx.activity.nightly(C, now)
    expect(await daily('signups', C)).toBe(12)

    await db().delete(activityDays).where(eq(activityDays.userId, ids[0]!))
    await s.app.ctx.activity.nightly(D, now)
    expect(await cell()).toMatchObject({ size: 12, value: null })
    expect(await daily('active_users')).toBeNull()
  })

  it('purges raw sessions after 35 days, activity days after 90, weekly data after 12 weeks', async () => {
    const u = await register(s.app)
    const now = at('2031-12-01T05:00')
    const days = (n: number) => new Date(now.getTime() - n * DAY)
    const ch = uuidv7()
    for (const n of [36, 34]) await db().insert(voiceSessions).values({ id: uuidv7(), userId: u.user.id, channelId: ch, spaceId: null, joinedAt: days(n + 0.1), leftAt: days(n) })
    await db().insert(activityDays).values([{ userId: u.user.id, day: '2031-08-31', flags: 1 }, { userId: u.user.id, day: '2031-09-04', flags: 1 }])
    for (const week of ['2031-09-01', '2031-09-15']) {
      await db().insert(voiceWeekly).values({ userId: u.user.id, week, channelId: ch, minutes: 1, nights: 0 })
      await db().insert(weeklyRecaps).values({ userId: u.user.id, week, data: { voiceMinutes: 1, nights: 0, events: [], people: [] } })
    }
    const { space } = await spaceOf(u)
    const ev = (title: string, endedDaysAgo: number, weekly = false) => ({
      id: uuidv7(), spaceId: space.id, title, startsLocal: '2031-01-01T20:00', startsAt: days(endedDaysAgo + 1), durationMinutes: 60, weekly,
    })
    await db().insert(events).values([ev('old', 36), ev('recent', 34), ev('weekly', 200, true)])
    await s.app.ctx.activity.purge(now)
    expect((await db().select().from(events).where(eq(events.spaceId, space.id))).map((e) => e.title).sort()).toEqual(['recent', 'weekly'])
    const id = u.user.id
    expect((await db().select().from(voiceSessions).where(eq(voiceSessions.userId, id))).map((r) => Math.round((now.getTime() - r.leftAt.getTime()) / DAY))).toEqual([34])
    expect((await db().select().from(activityDays).where(eq(activityDays.userId, id))).map((r) => r.day)).toEqual(['2031-09-04'])
    expect((await db().select().from(voiceWeekly).where(eq(voiceWeekly.userId, id))).map((r) => r.week)).toEqual(['2031-09-15'])
    expect((await db().select().from(weeklyRecaps).where(eq(weeklyRecaps.userId, id))).map((r) => r.week)).toEqual(['2031-09-15'])
  })
})

describe('privacy', () => {
  it('exports the retention data and the account purge takes it all', async () => {
    const u = await register(s.app)
    const other = await register(s.app)
    const { space, voice } = await spaceOf(other, u)
    await session(u, voice, space.id, '2031-03-03T21:00', '2031-03-03T22:00')
    const [ev] = await db().insert(events).values({
      id: uuidv7(), spaceId: space.id, channelId: voice, creatorId: u.user.id, title: 'Estudo', startsLocal: '2031-03-03T19:00',
      startsAt: at('2031-03-03T19:00'), durationMinutes: 60, weekly: true,
    }).returning()
    await api(s.app, 'PUT', `/events/${ev!.id}/rsvp`, { token: u.token, body: { status: 'going' } })
    await db().insert(weeklyRecaps).values({ userId: u.user.id, week: '2031-03-03', data: { voiceMinutes: 60, nights: 1, events: [], people: [other.user.id] } })

    const data = await s.app.ctx.privacy.collect(u.user.id, new Date()) as { retention: Record<string, unknown[]> }
    expect(data.retention.eventsCreated).toHaveLength(1)
    expect(data.retention.rsvps).toEqual([expect.objectContaining({ eventId: ev!.id, status: 'going' })])
    expect(data.retention.voiceSessions).toHaveLength(1)
    expect(data.retention.activityDays!.length).toBeGreaterThan(0)
    expect(JSON.stringify(data.retention.weeklyRecaps)).not.toContain(other.user.id) // others' copresence is not exported

    await db().update(users).set({ deletionRequestedAt: new Date(), deletionPurgeAfter: new Date(Date.now() - MIN), deletionMessages: 'anonymize' }).where(eq(users.id, u.user.id))
    expect(await s.app.ctx.privacy.purgeAccount(u.user.id)).toBe(true)
    for (const t of [voiceSessions, activityDays, activitySettings, weeklyRecaps]) {
      expect(await db().select().from(t).where(eq((t as typeof voiceSessions).userId, u.user.id))).toEqual([])
    }
    expect((await db().select().from(events).where(eq(events.id, ev!.id)))[0]!.creatorId).toBeNull()
  })
})

describe('shop funnel metrics', () => {
  it('counts shop opens, try-ons and checkouts with fixed labels only', async () => {
    const u = await register(s.app)
    const before = metrics.shopFunnel.get({ step: 'shop_open', product_type: 'none' })
    expect((await api(s.app, 'POST', '/shop/opened', { token: u.token })).status).toBe(204)
    expect(metrics.shopFunnel.get({ step: 'shop_open', product_type: 'none' })).toBe(before + 1)
    const item = PRODUCTS.find((p) => p.kind === 'cosmetic' && p.purchasable && !p.retired && isAvailable(p))!
    const checkouts = metrics.shopFunnel.get({ step: 'checkout', product_type: 'cosmetic' })
    expect((await api(s.app, 'POST', '/billing/checkout', { token: u.token, body: { productId: item.id } })).status).toBe(201)
    expect(metrics.shopFunnel.get({ step: 'checkout', product_type: 'cosmetic' })).toBe(checkouts + 1)
    expect((await api(s.app, 'POST', '/billing/try-on', { token: u.token, body: { productId: item.id } })).status).toBe(409) // not in a call: not counted
    countShop('<script>', u.user.id)

    const steps = new Set<string>([...SHOP_FUNNEL_STEPS, 'other'])
    const types = new Set(['plan', 'cosmetic', 'bundle', 'space_upgrade', 'none', 'other'])
    const lines = registry.render().split('\n').filter((l) => l.startsWith('alga_shop_funnel_total{'))
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) {
      const labels = Object.fromEntries([...l.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
      expect(Object.keys(labels).sort()).toEqual(['product_type', 'step'])
      expect(steps.has(labels.step!)).toBe(true)
      expect(types.has(labels.product_type!)).toBe(true)
    }
    expect(registry.render()).not.toContain(u.user.id)
    // Rate limited like every new route (30 per hour here).
    const statuses: number[] = []
    for (let i = 0; i < 30; i++) statuses.push((await api(s.app, 'POST', '/shop/opened', { token: u.token })).status)
    expect(statuses.at(-1)).toBe(429)
  })
})
