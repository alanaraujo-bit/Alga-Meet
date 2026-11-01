/** Age gate, consent records, access logs (Marco Civil art. 15), account deletion and data export (LGPD art. 18). */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import {
  GatewayClose, REMOVED_USER_ID, todayInBrazil, uuidv7,
  type AuthResponse, type DataExport, type Invite, type LegalInfo, type Me, type Message, type SpaceSnapshot,
} from '@alga/shared'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { sha256Hex } from '../src/auth.js'
import { loadConfig } from '../src/config.js'
import type { EmailMessage } from '../src/email.js'
import {
  accessLogs, attachments, channels, consentRecords, dataExports, deletedAccounts, messages, orders, reports, spaces, users,
} from '../src/db/schema.js'
import { LEGAL_VERSIONS, TERMS_VERSION } from '../src/legal.js'
import { removedProfile } from '../src/privacy.js'
import { setStaffRole } from '../src/trust-safety.js'
import { api, befriend, connect, freshIp, messageWithFile, register, startServer, type TestServer } from './helpers.js'

const DAY = 24 * 60 * 60 * 1000
const PASSWORD = 'correct horse battery'
const dirs: string[] = []
let s: TestServer
let sent: MockInstance<(msg: EmailMessage) => Promise<void>>
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alga-privacy-test-'))
  dirs.push(dir)
  s = await startServer({ UPLOADS_DIR: dir })
})
afterAll(async () => {
  await s.close()
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
beforeEach(() => {
  sent?.mockRestore()
  sent = vi.spyOn(s.app.ctx.mail.sender, 'send')
})
const mailsTo = (to: string, kind: string) => sent.mock.calls.map((c) => c[0]).filter((m) => m.to === to && m.kind === kind)

/** YYYY-MM-DD `years` years before today in Brazil, shifted by `days`. */
function born(years: number, days = 0): string {
  const [y, m, d] = todayInBrazil().split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y - years, m - 1, d + days)).toISOString().slice(0, 10)
}

let n = 0
const fresh = () => `p${++n}_${Math.random().toString(36).slice(2, 6)}`
const signup = (body: Record<string, unknown>, app: FastifyInstance = s.app) => {
  const username = fresh()
  return api<AuthResponse>(app, 'POST', '/auth/register', { ip: freshIp(), body: { email: `${username}@example.com`, username, password: PASSWORD, ...body } })
}
const login = (u: { user: { username: string } }, ip = freshIp()) =>
  api<AuthResponse>(s.app, 'POST', '/auth/login', { ip, body: { login: u.user.username, password: PASSWORD } })
const userRow = async (id: string) => (await s.app.ctx.db.select().from(users).where(eq(users.id, id)))[0]

async function until<T>(fn: () => Promise<T | undefined | null | false>, ms = 5000): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 25))
  }
}

/** Files of a zip produced by src/zip.ts (local headers in order). */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  let at = 0
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18)
    const nameLen = buf.readUInt16LE(at + 26)
    const extra = buf.readUInt16LE(at + 28)
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString('utf8')
    const start = at + 30 + nameLen + extra
    out.set(name, inflateRawSync(buf.subarray(start, start + size)))
    at = start + size
  }
  return out
}

describe('age gate (Lei 15.211/2025)', () => {
  it('signup: under 16 refused with nothing stored; 16–17 teen; 18+ adult; bad dates; no date = unknown (dev)', async () => {
    const under = await signup({ birthDate: born(16, 1) }) // 16 tomorrow
    expect(under.status).toBe(400)
    expect(under.body.error.fields.birthDate).toMatch(/16 anos/)
    expect(under.body.error.message).toMatch(/16 anos/)
    expect((await s.app.ctx.db.select().from(users).where(eq(users.birthDate, born(16, 1)))).length).toBe(0)

    expect((await signup({ birthDate: born(16) })).body.user.ageBracket).toBe('teen') // 16 today
    expect((await signup({ birthDate: born(18, 1) })).body.user.ageBracket).toBe('teen')
    expect((await signup({ birthDate: born(18) })).body.user.ageBracket).toBe('adult')
    for (const bad of ['2010-02-30', '15/03/2000', born(-1), '1850-01-01']) {
      expect((await signup({ birthDate: bad })).body.error.fields).toHaveProperty('birthDate')
    }
    const legacy = await signup({})
    expect(legacy.status).toBe(201)
    expect(legacy.body.user).toMatchObject({ ageBracket: 'unknown', needsTermsAcceptance: true })
  })

  it('REQUIRE_BIRTHDATE=1 (and production) require birthDate and termsVersion', async () => {
    const strict = await startServer({ REQUIRE_BIRTHDATE: '1' })
    try {
      const res = await signup({}, strict.app)
      expect(res.status).toBe(400)
      expect(Object.keys(res.body.error.fields).sort()).toEqual(['birthDate', 'termsVersion'])
      expect((await signup({ birthDate: born(30), termsVersion: 'velha' }, strict.app)).body.error.fields).toHaveProperty('termsVersion')
      const ok = await signup({ birthDate: born(30), termsVersion: TERMS_VERSION }, strict.app)
      expect(ok.body.user).toMatchObject({ ageBracket: 'adult', needsTermsAcceptance: false })
      expect((await api<LegalInfo>(strict.app, 'GET', '/legal')).body).toMatchObject({ termsVersion: TERMS_VERSION, minAge: 16, signupRequiresBirthDate: true })
      // In production an unknown age cannot buy either.
      await strict.app.ctx.db.update(users).set({ birthDate: null, emailVerifiedAt: new Date() }).where(eq(users.id, ok.body.user.id))
      expect((await api(strict.app, 'POST', '/billing/checkout', { token: ok.body.token, body: { productId: 'plus_monthly' } })).body.error.message).toMatch(/data de nascimento/)
    } finally {
      await strict.close()
    }
    const PROD = {
      NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db:5432/alga', CORS_ORIGINS: 'null', LIVEKIT_API_KEY: 'k',
      LIVEKIT_API_SECRET: 'a-real-production-secret-0123456789abcdef', PUBLIC_URL: 'https://api.example.com', FILES_SECRET: 's'.repeat(32),
      STORAGE_DRIVER: 'local', EMAIL_DRIVER: 'console', ALGA_ALLOW_CONSOLE_EMAIL: '1',
    }
    expect(loadConfig(PROD).legal.requireBirthDate).toBe(true)
    expect(loadConfig({ NODE_ENV: 'test' }).legal.requireBirthDate).toBe(false)
  })

  it('existing accounts declare once; an under-16 declaration suspends, schedules deletion, and an upheld appeal undoes it', async () => {
    const old = await register(s.app)
    expect(old.user.ageBracket).toBe('unknown')
    const ok = await api<Me>(s.app, 'PATCH', '/users/@me/birth-date', { token: old.token, body: { birthDate: born(20) } })
    expect(ok.body.ageBracket).toBe('adult')
    expect((await api(s.app, 'PATCH', '/users/@me/birth-date', { token: old.token, body: { birthDate: born(30) } })).status).toBe(409)

    const kid = await register(s.app)
    const gw = await connect(s.port, kid.token)
    const res = await api(s.app, 'PATCH', '/users/@me/birth-date', { token: kid.token, body: { birthDate: born(14) } })
    expect(res.status).toBe(403)
    expect(res.body.error.restriction).toMatchObject({ type: 'suspended', reason: 'underage', appealToken: expect.any(String) })
    expect((await gw.closed).code).toBe(GatewayClose.ACCOUNT_RESTRICTED)
    expect((await api(s.app, 'GET', '/users/@me', { token: kid.token })).status).toBe(401)
    expect(mailsTo(kid.user.email, 'enforcement')[0]!.text).toMatch(/idade abaixo do mínimo/)
    const row = await userRow(kid.user.id)
    expect(row!.deletionPurgeAfter!.getTime()).toBeGreaterThan(Date.now() + 29 * DAY)

    const denied = await login(kid)
    expect(denied.status).toBe(403)
    const appeal = await api(s.app, 'POST', '/appeals', {
      body: { actionId: denied.body.error.restriction.actionId, appealToken: denied.body.error.restriction.appealToken, message: 'Errei a data, tenho 19 anos.' },
    })
    expect(appeal.status).toBe(201)
    // An open appeal keeps the account past the scheduled purge.
    await s.app.ctx.privacy.retention(new Date(Date.now() + 31 * DAY))
    expect(await userRow(kid.user.id)).toBeDefined()

    const staff = await register(s.app)
    await setStaffRole(s.app.ctx.db, staff.user.username, 'moderator')
    expect((await api(s.app, 'PATCH', `/admin/appeals/${appeal.body.id}`, { token: staff.token, body: { status: 'upheld', note: 'documento conferido' } })).status).toBe(200)
    const back = await login(kid)
    expect(back.status).toBe(200)
    expect(back.body.user.ageBracket).toBe('unknown') // asked again
    expect((await userRow(kid.user.id))!.deletionPurgeAfter).toBeNull()
  })

  it('16–17: DMs only with friends (both ways, without revealing the age) and no purchases', async () => {
    const teen = await register(s.app, undefined, { extra: { birthDate: born(17) } })
    const adult = await register(s.app, undefined, { extra: { birthDate: born(30) } })
    const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: adult.token, body: { name: 'Jogos' } })).body
    const inv = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: adult.token, body: {} })).body
    await api(s.app, 'POST', `/invites/${inv.code}`, { token: teen.token })
    const toTeen = await api(s.app, 'POST', '/users/@me/channels', { token: adult.token, body: { recipientIds: [teen.user.id] } })
    expect(toTeen.status).toBe(403)
    expect(toTeen.body.error.message).not.toMatch(/anos|idade/)
    expect((await api(s.app, 'POST', '/users/@me/channels', { token: teen.token, body: { recipientIds: [adult.user.id] } })).status).toBe(403)
    await befriend(s.app, adult, teen)
    expect((await api(s.app, 'POST', '/users/@me/channels', { token: adult.token, body: { recipientIds: [teen.user.id] } })).status).toBe(201)
    expect((await api(s.app, 'POST', '/billing/checkout', { token: teen.token, body: { productId: 'plus_monthly' } })).body.error.message).toMatch(/18 anos/)
  })
})

describe('consent records', () => {
  it('signup records the accepted version; a new version asks again with what changed; accept-terms keeps the history', async () => {
    const u = await register(s.app, undefined, { extra: { termsVersion: TERMS_VERSION } })
    expect(u.user.needsTermsAcceptance).toBe(false)
    const { db } = s.app.ctx
    await db.update(users).set({ termsVersion: '2026-01-01' }).where(eq(users.id, u.user.id))
    expect((await api<Me>(s.app, 'GET', '/users/@me', { token: u.token })).body.needsTermsAcceptance).toBe(true)
    // The re-acceptance screen shows the catalog's summary of the current version.
    const legal = (await api<LegalInfo>(s.app, 'GET', '/legal')).body
    expect(LEGAL_VERSIONS[0]!.version).toBe(TERMS_VERSION)
    expect(legal).toMatchObject({ termsVersion: TERMS_VERSION, changeSummary: LEGAL_VERSIONS[0]!.changeSummary })
    expect(legal.changeSummary!.length).toBeGreaterThan(0)
    expect(legal.changeSummary!.length).toBeLessThanOrEqual(400)
    expect((await api(s.app, 'POST', '/users/@me/accept-terms', { token: u.token, body: { termsVersion: '2026-01-01' } })).status).toBe(400)
    const gw = await connect(s.port, u.token)
    const ok = await api<Me>(s.app, 'POST', '/users/@me/accept-terms', { token: u.token, body: { termsVersion: TERMS_VERSION } })
    expect(ok.body.needsTermsAcceptance).toBe(false)
    await gw.waitFor('ME_UPDATE', (m) => m.needsTermsAcceptance === false)
    // Accepting again changes nothing (no extra consent row to farm).
    expect((await api<Me>(s.app, 'POST', '/users/@me/accept-terms', { token: u.token, body: { termsVersion: TERMS_VERSION } })).body.needsTermsAcceptance).toBe(false)
    expect((await db.select().from(consentRecords).where(eq(consentRecords.userId, u.user.id))).map((c) => c.termsVersion)).toEqual([TERMS_VERSION, TERMS_VERSION])
    gw.close()
  })
})

describe('access logs (Marco Civil art. 15)', () => {
  it('logins and the first use per day per IP/app; gateway too; 6-month purge except under legal hold; admin-only, audited', async () => {
    const { db } = s.app.ctx
    const u = await register(s.app)
    const ip = freshIp()
    await login(u, ip)
    for (let i = 0; i < 3; i++) await api(s.app, 'GET', '/users/@me', { token: u.token, ip, headers: { 'user-agent': 'AlgaMeet/1.0' } })
    await api(s.app, 'GET', '/users/@me', { token: u.token, ip, headers: { 'user-agent': 'AlgaMeet/2.0' } })
    const gw = await connect(s.port, u.token)
    gw.close()
    const rows = await until(async () => {
      const r = await db.select().from(accessLogs).where(eq(accessLogs.userId, u.user.id))
      return r.some((x) => x.ip === '127.0.0.1' && x.event === 'session_use') && r
    })
    expect(rows.filter((r) => r.event === 'login').length).toBe(2) // register + login
    expect(rows.filter((r) => r.event === 'session_use' && r.ip === ip).map((r) => r.userAgentSha256).sort())
      .toEqual([sha256Hex('AlgaMeet/1.0'), sha256Hex('AlgaMeet/2.0')].sort())

    const held = await register(s.app)
    await db.update(users).set({ legalHoldAt: new Date() }).where(eq(users.id, held.user.id))
    const old = new Date(Date.now() - 200 * DAY)
    for (const id of [u.user.id, held.user.id]) {
      await db.insert(accessLogs).values({ id: crypto.randomUUID(), userId: id, ip: '10.9.9.9', userAgentSha256: 'x', event: 'login', day: old.toISOString().slice(0, 10), at: old })
    }
    await s.app.ctx.privacy.retention()
    expect((await db.select().from(accessLogs).where(and(eq(accessLogs.userId, u.user.id), eq(accessLogs.ip, '10.9.9.9')))).length).toBe(0)
    expect((await db.select().from(accessLogs).where(and(eq(accessLogs.userId, held.user.id), eq(accessLogs.ip, '10.9.9.9')))).length).toBe(1)
    expect((await db.select().from(accessLogs).where(eq(accessLogs.userId, u.user.id))).length).toBe(rows.length)

    const mod = await register(s.app)
    await setStaffRole(db, mod.user.username, 'moderator')
    expect((await api(s.app, 'GET', `/admin/access-logs?userId=${u.user.id}`, { token: mod.token })).status).toBe(403)
    expect((await api(s.app, 'GET', `/admin/access-logs?userId=${u.user.id}`, { token: u.token })).status).toBe(403)
    const admin = await register(s.app)
    await setStaffRole(db, admin.user.username, 'admin')
    const list = await api(s.app, 'GET', `/admin/access-logs?username=${u.user.username}`, { token: admin.token })
    expect(list.status).toBe(200)
    // u's own refused call above was a use too.
    expect(list.body.length).toBe((await db.select().from(accessLogs).where(eq(accessLogs.userId, u.user.id))).length)
    expect(list.body[0]).toEqual({ userId: u.user.id, ip: expect.any(String), userAgentSha256: expect.any(String), event: expect.any(String), at: expect.any(String) })
  })
})

describe('account deletion (LGPD art. 18 VI)', () => {
  it('password re-check, 7-day grace cancelled by login, then the purge (spaces, messages, payments, tombstone)', async () => {
    const { db, files } = s.app.ctx
    const alice = await register(s.app)
    const [bob, carol] = [await register(s.app), await register(s.app)]
    await befriend(s.app, alice, bob)
    const shared = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: alice.token, body: { name: 'Clã' } })).body
    const solo = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: alice.token, body: { name: 'Só eu' } })).body
    const inv = (await api<Invite>(s.app, 'POST', `/spaces/${shared.id}/invites`, { token: alice.token, body: {} })).body
    await api(s.app, 'POST', `/invites/${inv.code}`, { token: carol.token })
    await api(s.app, 'POST', `/invites/${inv.code}`, { token: bob.token })
    // Bob joined later but holds a role: he inherits.
    const mod = (await api(s.app, 'POST', `/spaces/${shared.id}/roles`, { token: alice.token, body: { name: 'Mod' } })).body
    await api(s.app, 'PUT', `/spaces/${shared.id}/members/${bob.user.id}/roles/${mod.id}`, { token: alice.token })
    const text = shared.channels.find((c) => c.type === 'text')!
    const { msg: withFile } = await messageWithFile(s.app, alice.token, text.id, 'olha a foto')
    const plain = (await api<Message>(s.app, 'POST', `/channels/${text.id}/messages`, { token: alice.token, body: { content: 'mensagem que fica' } })).body
    const dm = (await api(s.app, 'POST', '/users/@me/channels', { token: alice.token, body: { recipientIds: [bob.user.id] } })).body
    await api(s.app, 'POST', `/channels/${dm.id}/messages`, { token: alice.token, body: { content: 'oi bob' } })
    await api(s.app, 'POST', '/reports', { token: alice.token, body: { targetType: 'user', targetId: carol.user.id, reason: 'spam' } })
    const co = (await api(s.app, 'POST', '/billing/checkout', { token: alice.token, body: { productId: 'deco_coral' } })).body
    await s.app.inject({ method: 'GET', url: new URL(co.url).pathname + new URL(co.url).search })
    expect((await db.select().from(orders).where(eq(orders.userId, alice.user.id)))[0]!.status).toBe('paid')

    expect((await api(s.app, 'DELETE', '/users/@me', { token: alice.token, body: { password: 'senha errada aqui' } })).status).toBe(400)
    const gw = await connect(s.port, alice.token)
    const del = await api(s.app, 'DELETE', '/users/@me', { token: alice.token, body: { password: PASSWORD } })
    expect(del.status).toBe(202)
    expect(new Date(del.body.purgeAfter).getTime()).toBeGreaterThan(Date.now() + 6.9 * DAY)
    expect(del.body.messages).toBe('anonymize')
    expect((await gw.closed).code).toBe(GatewayClose.SESSION_REVOKED)
    expect((await api(s.app, 'GET', '/users/@me', { token: alice.token })).status).toBe(401)
    expect(mailsTo(alice.user.email, 'account_deletion').length).toBe(1)

    const back = await login(alice)
    expect(back.body.deletionCanceled).toBe(true)
    expect((await userRow(alice.user.id))!.deletionPurgeAfter).toBeNull()
    expect(mailsTo(alice.user.email, 'account_deletion').length).toBe(2)

    await api(s.app, 'DELETE', '/users/@me', { token: back.body.token, body: { password: PASSWORD } })
    await s.app.ctx.privacy.retention(new Date(Date.now() + 6 * DAY))
    expect(await userRow(alice.user.id)).toBeDefined() // still in the grace period
    const bobGw = await connect(s.port, bob.token)
    await s.app.ctx.privacy.retention(new Date(Date.now() + 8 * DAY))

    expect(await userRow(alice.user.id)).toBeUndefined()
    expect((await login(alice)).status).toBe(401)
    expect((await api(s.app, 'GET', `/users/${alice.user.id}`, { token: bob.token })).status).toBe(404)
    expect((await db.select().from(spaces).where(eq(spaces.id, shared.id)))[0]!.ownerId).toBe(bob.user.id)
    await bobGw.waitFor('SPACE_UPDATE', (sp) => sp.id === shared.id && sp.ownerId === bob.user.id)
    await bobGw.waitFor('RELATIONSHIP_REMOVE', (r) => r.userId === alice.user.id)
    await bobGw.waitFor('USER_UPDATE', (u) => u.id === alice.user.id && u.displayName === 'Usuário removido')
    expect((await db.select().from(spaces).where(eq(spaces.id, solo.id))).length).toBe(0)
    // Kept text under "Usuário removido"; the file is gone from the row and queued for the bucket.
    const kept = (await api<Message[]>(s.app, 'GET', `/channels/${text.id}/messages`, { token: bob.token })).body
    expect(kept.find((m) => m.id === plain.id)!.author).toMatchObject({ id: REMOVED_USER_ID, displayName: 'Usuário removido' })
    expect(kept.find((m) => m.id === withFile.id)!.attachments).toEqual([])
    expect((await db.select().from(attachments).where(eq(attachments.messageId, withFile.id))).length).toBe(0)
    const fileKey = `attachments/${text.id}/${withFile.attachments[0]!.id}`
    await files.sweep()
    expect(await files.storage.get(fileKey)).toBeNull()
    const dmMsgs = (await api<Message[]>(s.app, 'GET', `/channels/${dm.id}/messages`, { token: bob.token })).body
    expect(dmMsgs.map((m) => [m.author.id, m.content])).toEqual([[REMOVED_USER_ID, 'oi bob']])
    // Fiscal records stay, without the identity; reports by the account survive without the reporter.
    expect((await db.select().from(orders).where(eq(orders.userId, alice.user.id))).length).toBe(0)
    expect((await db.select().from(orders).where(eq(orders.userId, REMOVED_USER_ID))).some((o) => o.status === 'paid')).toBe(true)
    expect((await db.select().from(reports).where(eq(reports.targetId, carol.user.id)))[0]!.reporterId).toBeNull()
    expect((await db.select().from(deletedAccounts).where(eq(deletedAccounts.userId, alice.user.id)))[0])
      .toMatchObject({ username: alice.user.username, emailSha256: sha256Hex(alice.user.email) })
    // The removed author can be neither logged into nor reported as a user.
    expect((await api(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: 'deleted-user', password: PASSWORD } })).status).toBe(401)
    bobGw.close()
  })

  it('"delete" removes the messages; a legal hold postpones the purge', async () => {
    const { db } = s.app.ctx
    const [dan, eve] = [await register(s.app), await register(s.app)]
    await befriend(s.app, dan, eve)
    const dm = (await api(s.app, 'POST', '/users/@me/channels', { token: dan.token, body: { recipientIds: [eve.user.id] } })).body
    const msg = (await api<Message>(s.app, 'POST', `/channels/${dm.id}/messages`, { token: dan.token, body: { content: 'apaga isso' } })).body
    await api(s.app, 'POST', `/channels/${dm.id}/messages`, { token: eve.token, body: { content: 'resposta da eve' } })
    expect((await api(s.app, 'DELETE', '/users/@me', { token: dan.token, body: { password: PASSWORD, messages: 'delete' } })).status).toBe(202)
    await db.update(users).set({ legalHoldAt: new Date() }).where(eq(users.id, dan.user.id))
    await s.app.ctx.privacy.retention(new Date(Date.now() + 8 * DAY))
    expect(await userRow(dan.user.id)).toBeDefined()
    await db.update(users).set({ legalHoldAt: null }).where(eq(users.id, dan.user.id))
    await s.app.ctx.privacy.retention(new Date(Date.now() + 8 * DAY))
    expect(await userRow(dan.user.id)).toBeUndefined()
    expect((await db.select().from(messages).where(eq(messages.id, msg.id))).length).toBe(0)
    expect((await api<Message[]>(s.app, 'GET', `/channels/${dm.id}/messages`, { token: eve.token })).body.map((m) => m.content)).toEqual(['resposta da eve'])
    expect((await db.select().from(channels).where(eq(channels.id, dm.id))).length).toBe(1) // Eve keeps the DM
  })

  it('removed author parity: REMOVED_USER_ID only as Message.author; reactions and DMs announced; never in members, recipients or typing', async () => {
    const { db } = s.app.ctx
    const [gone, bob] = [await register(s.app), await register(s.app)]
    await befriend(s.app, gone, bob)
    const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: bob.token, body: { name: 'Sala' } })).body
    const inv = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: bob.token, body: {} })).body
    await api(s.app, 'POST', `/invites/${inv.code}`, { token: gone.token })
    const text = space.channels.find((c) => c.type === 'text')!
    const send = async (token: string, channelId: string, content: string) =>
      (await api<Message>(s.app, 'POST', `/channels/${channelId}/messages`, { token, body: { content } })).body
    const react = (token: string, m: Message) => api(s.app, 'PUT', `/channels/${m.channelId}/messages/${m.id}/reactions/${encodeURIComponent('👍')}`, { token })
    const kept = await send(gone.token, text.id, 'fica com o autor removido')
    const bobs = await send(bob.token, text.id, 'mensagem do bob')
    for (const [token, m] of [[gone.token, bobs], [gone.token, kept], [bob.token, kept]] as const) expect((await react(token, m)).status).toBe(204)
    const dm = (await api(s.app, 'POST', '/users/@me/channels', { token: gone.token, body: { recipientIds: [bob.user.id] } })).body
    await send(gone.token, dm.id, 'tchau')
    expect((await api(s.app, 'DELETE', '/users/@me', { token: gone.token, body: { password: PASSWORD } })).status).toBe(202)
    const gw = await connect(s.port, bob.token)
    await s.app.ctx.privacy.retention(new Date(Date.now() + 8 * DAY))
    expect(await userRow(gone.user.id)).toBeUndefined()

    // Open clients: everything that showed the old id is told, under the old id, with the same profile as the author.
    const removed = { ...removedProfile(gone.user.id), id: REMOVED_USER_ID }
    expect(await gw.waitFor('USER_UPDATE', (u) => u.id === gone.user.id)).toEqual(removedProfile(gone.user.id))
    await gw.waitFor('MEMBER_REMOVE', (m) => m.spaceId === space.id && m.userId === gone.user.id)
    for (const m of [bobs, kept]) await gw.waitFor('REACTION_REMOVE', (r) => r.messageId === m.id && r.userId === gone.user.id && r.emoji === '👍')
    expect((await gw.waitFor('CHANNEL_UPDATE', (c) => c.id === dm.id)).recipientIds).toEqual([bob.user.id])

    // REST, profile lookup and report snapshots: REMOVED_USER_ID with that same profile.
    const msgs = (await api<Message[]>(s.app, 'GET', `/channels/${text.id}/messages`, { token: bob.token })).body
    expect(msgs.find((m) => m.id === kept.id)).toMatchObject({ author: removed, reactions: [{ emoji: '👍', count: 1, me: true }] })
    expect(msgs.find((m) => m.id === bobs.id)!.reactions).toEqual([])
    expect((await api<Message[]>(s.app, 'GET', `/channels/${dm.id}/messages`, { token: bob.token })).body.map((m) => m.author)).toEqual([removed])
    expect((await api(s.app, 'GET', `/users/${REMOVED_USER_ID}`, { token: bob.token })).body).toEqual(removed)
    const r = await api(s.app, 'POST', '/reports', { token: bob.token, body: { targetType: 'message', targetId: kept.id, reason: 'spam' } })
    const [row] = await db.select().from(reports).where(eq(reports.id, r.body.id))
    expect(row!.targetUserId).toBe(REMOVED_USER_ID)
    expect((row!.snapshot as { author: unknown }).author).toEqual(removed)

    // A fresh READY: neither id among members, DM recipients or users; typing needs a session that no longer exists.
    const gw2 = await connect(s.port, bob.token)
    const ready = await gw2.waitFor('READY')
    expect(ready.privateChannels.find((c) => c.id === dm.id)!.recipientIds).toEqual([bob.user.id])
    const seen = JSON.stringify([ready.spaces.find((sp) => sp.id === space.id)!.members, ready.privateChannels, ready.users, ready.relationships])
    expect(seen).not.toContain(gone.user.id)
    expect(seen).not.toContain(REMOVED_USER_ID)
    expect((await api(s.app, 'POST', `/channels/${text.id}/typing`, { token: gone.token })).status).toBe(401)
    gw.close()
    gw2.close()
  })
})

describe('data export (LGPD art. 18 II/V)', () => {
  it('verified only, 1 per day, built in the background, e-mailed signed link to a zip, expires', async () => {
    const { db } = s.app.ctx
    const unverified = await register(s.app, undefined, { verified: false })
    expect((await api(s.app, 'POST', '/users/@me/export', { token: unverified.token })).status).toBe(403)

    const u = await register(s.app, undefined, { extra: { birthDate: born(25), termsVersion: TERMS_VERSION } })
    const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: u.token, body: { name: 'Meu' } })).body
    const text = space.channels.find((c) => c.type === 'text')!
    const { msg } = await messageWithFile(s.app, u.token, text.id, 'minha mensagem')
    const res = await api(s.app, 'POST', '/users/@me/export', { token: u.token })
    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({ status: 'pending', id: expect.any(String) })
    expect((await api(s.app, 'POST', '/users/@me/export', { token: u.token })).status).toBe(429)

    await until(async () => (await db.select().from(dataExports).where(eq(dataExports.id, res.body.id)))[0]?.status === 'ready')
    const mail = await until(async () => mailsTo(u.user.email, 'data_export')[0])
    const link = new URL(/https?:\/\/\S+\/exports\/\S+/.exec(mail.text)![0])
    expect(link.pathname).toBe(`/api/v1/exports/${res.body.id}`)
    const zip = await s.app.inject({ method: 'GET', url: link.pathname + link.search })
    expect(zip.statusCode).toBe(200)
    expect(zip.headers['content-type']).toBe('application/zip')
    expect(zip.headers['content-disposition']).toMatch(/^attachment/)
    const entries = unzip(zip.rawPayload)
    expect([...entries.keys()]).toEqual(['LEIA-ME.txt', 'dados.json'])
    const data = JSON.parse(entries.get('dados.json')!.toString('utf8'))
    expect(data.account).toMatchObject({ id: u.user.id, email: u.user.email, birthDate: born(25), termsVersion: TERMS_VERSION })
    expect(data.consents.length).toBe(1)
    expect(data.spaces[0]).toMatchObject({ id: space.id, owner: true })
    const exported = data.messages.find((m: { id: string }) => m.id === msg.id)
    expect(exported.content).toBe('minha mensagem')
    const fileUrl = new URL(exported.attachments[0].url)
    expect(Number(fileUrl.searchParams.get('exp')) * 1000).toBeGreaterThan(Date.now() + 6 * DAY) // lives as long as the link
    expect((await s.app.inject({ method: 'GET', url: fileUrl.pathname + fileUrl.search })).statusCode).toBe(200)
    expect(data.accessLogs.length).toBeGreaterThan(0)

    const tampered = new URL(link)
    tampered.searchParams.set('sig', 'x'.repeat(43))
    expect((await s.app.inject({ method: 'GET', url: tampered.pathname + tampered.search })).statusCode).toBe(403)
    await s.app.ctx.privacy.retention(new Date(Date.now() + 8 * DAY))
    const [row] = await db.select().from(dataExports).where(eq(dataExports.id, res.body.id))
    expect(row!.status).toBe('expired')
    await s.app.ctx.files.sweep()
    expect(await s.app.ctx.files.storage.get(row!.storageKey!)).toBeNull()
    expect((await s.app.inject({ method: 'GET', url: link.pathname + link.search })).statusCode).toBe(404)
  })

  it('GET /users/@me/exports: status of your own requests; a ready one carries a short-lived link to the zip', async () => {
    const { db, privacy } = s.app.ctx
    const [u, other] = [await register(s.app), await register(s.app)]
    const list = async (token = u.token) => (await api<DataExport[]>(s.app, 'GET', '/users/@me/exports', { token })).body
    expect(await list()).toEqual([])
    const [failed] = await db.insert(dataExports).values({ id: uuidv7(), userId: u.user.id, status: 'failed', error: 'x', createdAt: new Date(Date.now() - 2 * DAY) }).returning()
    const res = await api(s.app, 'POST', '/users/@me/export', { token: u.token })
    expect(res.status).toBe(202)
    await until(async () => (await db.select().from(dataExports).where(eq(dataExports.id, res.body.id)))[0]?.status === 'ready')

    const [ready, fail] = await list()
    expect(fail).toEqual({ id: failed!.id, status: 'failed', createdAt: failed!.createdAt.toISOString(), expiresAt: null, downloadUrl: null })
    expect(ready).toMatchObject({ id: res.body.id, status: 'ready', createdAt: res.body.createdAt })
    expect(new Date(ready!.expiresAt!).getTime()).toBeGreaterThan(Date.now() + 6 * DAY)
    const link = new URL(ready!.downloadUrl!)
    expect(link.pathname).toBe(`/api/v1/exports/${ready!.id}`)
    const exp = Number(link.searchParams.get('exp')) * 1000
    expect(exp).toBeGreaterThan(Date.now())
    expect(exp).toBeLessThanOrEqual(Date.now() + s.config.files.urlTtlSeconds * 1000)
    const zip = await s.app.inject({ method: 'GET', url: link.pathname + link.search })
    expect([zip.statusCode, zip.headers['content-type']]).toEqual([200, 'application/zip'])
    expect(await list(other.token)).toEqual([])

    // The other stages, and a ready row the sweep has not expired yet.
    const [row] = await db.select().from(dataExports).where(eq(dataExports.id, ready!.id))
    expect(privacy.exportView({ ...row!, status: 'pending', expiresAt: null })).toMatchObject({ status: 'queued', expiresAt: null, downloadUrl: null })
    expect(privacy.exportView({ ...row!, status: 'building', expiresAt: null })).toMatchObject({ status: 'processing', downloadUrl: null })
    expect(privacy.exportView(row!, row!.expiresAt!.getTime() + 1)).toMatchObject({ status: 'expired', downloadUrl: null })
    await privacy.retention(new Date(Date.now() + 8 * DAY))
    expect((await list())[0]).toMatchObject({ id: ready!.id, status: 'expired', expiresAt: ready!.expiresAt, downloadUrl: null })
    expect((await s.app.inject({ method: 'GET', url: link.pathname + link.search })).statusCode).toBe(404)
  })
})
