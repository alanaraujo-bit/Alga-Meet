/** Reports, staff roles and audit, account enforcement everywhere, appeals, and CSAM quarantine with evidence. */
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GatewayClose,
  type AdminAppeal, type AdminReport, type AuthResponse, type Invite, type Message, type QuarantinedFile, type SpaceSnapshot,
} from '@alga/shared'
import { and, asc, eq } from 'drizzle-orm'
import type { RoomServiceClient } from 'livekit-server-sdk'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { quarantinedFiles, staffAuditLog, users } from '../src/db/schema.js'
import type { EmailMessage } from '../src/email.js'
import { setStaffRole } from '../src/trust-safety.js'
import { api, connect, freshIp, messageWithFile, openGateway, postWebhook, register, startServer, type TestServer } from './helpers.js'

const DAY = 24 * 60 * 60 * 1000
const PASSWORD = 'correct horse battery'
let s: TestServer
let dir: string
let sent: MockInstance<(msg: EmailMessage) => Promise<void>>
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'alga-ts-test-'))
  s = await startServer({ UPLOADS_DIR: dir })
})
afterAll(async () => {
  await s.close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => { sent = vi.spyOn(s.app.ctx.mail.sender, 'send') })
afterEach(() => { vi.restoreAllMocks() })
const mailsTo = (to: string, kind: string) => sent.mock.calls.map((c) => c[0]).filter((m) => m.to === to && m.kind === kind)

type User = Awaited<ReturnType<typeof register>>
const login = (u: User) => api<AuthResponse>(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: u.user.username, password: PASSWORD } })

async function staff(role: 'admin' | 'moderator' = 'moderator'): Promise<User> {
  const u = await register(s.app)
  await setStaffRole(s.app.ctx.db, u.user.username, role)
  return u
}

async function setup() {
  const owner = await register(s.app)
  const member = await register(s.app)
  const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: owner.token, body: { name: 'Praça' } })).body
  const invite = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: owner.token, body: {} })).body
  await api(s.app, 'POST', `/invites/${invite.code}`, { token: member.token })
  return { owner, member, space, text: space.channels.find((c) => c.type === 'text')!, voice: space.channels.find((c) => c.type === 'voice')! }
}

async function bytesOf(key: string): Promise<Buffer> {
  const body = await s.app.ctx.files.storage.get(key)
  if (!body) return Buffer.alloc(0)
  const chunks: Buffer[] = []
  for await (const c of body) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}
const fetchFile = (url: string) => { const u = new URL(url); return s.app.inject({ method: 'GET', url: u.pathname + u.search }) }
const report = (token: string, body: object) => api(s.app, 'POST', '/reports', { token, body })

describe('staff roles and audit log', () => {
  it('admin API needs a staff role that only the CLI path sets; every staff call is audit-logged with its status', async () => {
    const u = await register(s.app)
    expect((await api(s.app, 'GET', '/admin/reports', { token: u.token })).status).toBe(403)
    expect((await api(s.app, 'PATCH', '/users/@me', { token: u.token, body: { staffRole: 'admin', bio: 'oi' } })).status).toBe(200)
    expect((await s.app.ctx.db.select().from(users).where(eq(users.id, u.user.id)))[0]!.staffRole).toBeNull()
    await expect(setStaffRole(s.app.ctx.db, 'ninguem_existe', 'admin')).rejects.toThrow(/not found/)

    const mod = await staff()
    expect((await api(s.app, 'GET', '/admin/reports?status=open', { token: mod.token })).status).toBe(200)
    expect((await api(s.app, 'GET', '/admin/reports?status=nope', { token: mod.token })).status).toBe(400)
    // The status is written after the response is sent.
    let log: (typeof staffAuditLog.$inferSelect)[] = []
    for (let i = 0; i < 100 && !(log.length === 2 && log.every((l) => l.status !== null)); i++) {
      if (i) await new Promise((r) => setTimeout(r, 20))
      log = await s.app.ctx.db.select().from(staffAuditLog).where(eq(staffAuditLog.staffId, mod.user.id)).orderBy(asc(staffAuditLog.at))
    }
    expect(log.map((l) => [l.method, l.route, l.status])).toEqual([['GET', '/api/v1/admin/reports', 200], ['GET', '/api/v1/admin/reports', 400]])
    expect(log[1]!.query).toEqual({ status: 'nope' })
    const grant = await s.app.ctx.db.select().from(staffAuditLog).where(eq(staffAuditLog.route, 'scripts/grant-staff.ts'))
    expect(grant.some((g) => (g.body as { userId: string }).userId === mod.user.id)).toBe(true)
  })
})

describe('reports', () => {
  it('message/user/space reports: snapshot survives deletion, no self-report, visibility required, dedupe, rate limit', async () => {
    const { owner, member, space, text } = await setup()
    const outsider = await register(s.app)
    const { msg } = await messageWithFile(s.app, member.token, text.id, 'conteúdo ofensivo')
    const r = await report(owner.token, { targetType: 'message', targetId: msg.id, reason: 'harassment', details: 'me xingou' })
    expect(r.status).toBe(201)
    expect(Object.keys(r.body).sort()).toEqual(['createdAt', 'id'])
    const dup = await report(owner.token, { targetType: 'message', targetId: msg.id, reason: 'harassment' })
    expect([dup.status, dup.body.id]).toEqual([200, r.body.id])
    expect((await report(member.token, { targetType: 'message', targetId: msg.id, reason: 'spam' })).status).toBe(400)
    expect((await report(outsider.token, { targetType: 'message', targetId: msg.id, reason: 'spam' })).status).toBe(404)
    expect((await report(member.token, { targetType: 'user', targetId: member.user.id, reason: 'spam' })).status).toBe(400)
    expect((await report(owner.token, { targetType: 'space', targetId: space.id, reason: 'spam' })).status).toBe(400)
    expect((await report(member.token, { targetType: 'space', targetId: space.id, reason: 'illegal_goods' })).status).toBe(201)
    expect((await report(outsider.token, { targetType: 'user', targetId: member.user.id, reason: 'impersonation', details: 'x'.repeat(1001) })).status).toBe(400)

    expect((await api(s.app, 'DELETE', `/channels/${text.id}/messages/${msg.id}`, { token: member.token })).status).toBe(204)
    const mod = await staff()
    const queue = (await api<AdminReport[]>(s.app, 'GET', '/admin/reports', { token: mod.token })).body
    const mine = queue.find((q) => q.id === r.body.id)!
    expect(mine).toMatchObject({ reporterId: owner.user.id, targetUserId: member.user.id, spaceId: space.id, channelId: text.id, priority: 10, details: 'me xingou' })
    expect(mine.snapshot).toMatchObject({ content: 'conteúdo ofensivo', author: { id: member.user.id }, attachments: [{ filename: 'x.png', contentType: 'image/png' }] })
    // The reported person sees nothing of it.
    expect((await api(s.app, 'GET', '/users/@me/actions', { token: member.token })).body).toEqual([])

    for (let i = 0; i < 9; i++) await report(outsider.token, { targetType: 'user', targetId: owner.user.id, reason: 'spam' })
    expect((await report(outsider.token, { targetType: 'user', targetId: owner.user.id, reason: 'spam' })).status).toBe(429)
  })
})

describe('account enforcement and appeals', () => {
  it('suspension: sessions, gateway (4010), voice and login refused with reason; appeal by token; upheld restores', async () => {
    const { owner, member, voice } = await setup()
    const mod = await staff()
    const rooms = (s.app.ctx.voice as unknown as { rooms: RoomServiceClient }).rooms
    const remove = vi.spyOn(rooms, 'removeParticipant').mockResolvedValue(undefined)
    await postWebhook(s.app, s.config, { event: 'participant_joined', id: `TS_${Date.now()}`, room: { name: `ch_${voice.id}` }, participant: { identity: member.user.id } })
    expect(s.app.ctx.voice.stateOf(member.user.id)?.channelId).toBe(voice.id)
    const gw = await connect(s.port, member.token)
    const r = (await report(owner.token, { targetType: 'user', targetId: member.user.id, reason: 'harassment' })).body

    expect((await api(s.app, 'PATCH', `/admin/reports/${r.id}`, { token: mod.token, body: { status: 'resolved', action: 'suspend' } })).status).toBe(400) // no until
    const untilAt = new Date(Date.now() + 3 * DAY).toISOString()
    const done = await api<AdminReport>(s.app, 'PATCH', `/admin/reports/${r.id}`, { token: mod.token, body: { status: 'resolved', action: 'suspend', until: untilAt, note: 'reincidente' } })
    expect(done.body).toMatchObject({ status: 'resolved', action: 'suspend', staffId: mod.user.id })
    expect((await gw.closed).code).toBe(GatewayClose.ACCOUNT_RESTRICTED)
    expect(remove).toHaveBeenCalledWith(`ch_${voice.id}`, member.user.id)
    expect(s.app.ctx.voice.stateOf(member.user.id)).toBeUndefined()
    expect((await api(s.app, 'GET', '/users/@me', { token: member.token })).status).toBe(401)
    expect(mailsTo(member.user.email, 'enforcement')[0]!.text).toMatch(/suspensa até .*\n\nMotivo: assédio/)
    expect(mailsTo(member.user.email, 'enforcement')[0]!.text).not.toMatch(/reincidente/) // staff notes stay internal

    const denied = await login(member)
    expect(denied.status).toBe(403)
    expect(denied.body.error.message).toMatch(/suspensa até .* por assédio/)
    const restriction = denied.body.error.restriction
    expect(restriction).toMatchObject({ type: 'suspended', reason: 'harassment', until: untilAt, appealStatus: null, appealToken: expect.any(String) })
    const gw2 = await openGateway(s.port)
    gw2.send({ op: 'identify', token: member.token })
    expect((await gw2.closed).code).toBe(GatewayClose.AUTH_FAILED) // no session survived

    expect((await api(s.app, 'POST', '/appeals', { ip: freshIp(), body: { actionId: restriction.actionId, appealToken: `${restriction.appealToken}x`, message: 'Não fui eu, foi meu irmão.' } })).status).toBe(401)
    expect((await api(s.app, 'POST', '/appeals', { ip: freshIp(), body: { actionId: restriction.actionId, message: 'Não fui eu, foi meu irmão.' } })).status).toBe(401)
    const appeal = await api(s.app, 'POST', '/appeals', { ip: freshIp(), body: { actionId: restriction.actionId, appealToken: restriction.appealToken, message: 'Não fui eu, foi meu irmão.' } })
    expect(appeal.status).toBe(201)
    expect((await api(s.app, 'POST', '/appeals', { ip: freshIp(), body: { actionId: restriction.actionId, appealToken: restriction.appealToken, message: 'De novo, por favor.' } })).status).toBe(409)
    expect((await login(member)).body.error.restriction).toMatchObject({ appealStatus: 'open', appealToken: null })

    const open = (await api<AdminAppeal[]>(s.app, 'GET', '/admin/appeals', { token: mod.token })).body.find((a) => a.id === appeal.body.id)!
    expect(open).toMatchObject({ userId: member.user.id, message: 'Não fui eu, foi meu irmão.', action: { type: 'suspend', reason: 'harassment', reportId: r.id } })
    expect((await api(s.app, 'PATCH', `/admin/appeals/${appeal.body.id}`, { token: mod.token, body: { status: 'upheld' } })).body.status).toBe('upheld')
    expect(mailsTo(member.user.email, 'appeal_decision').length).toBe(1)
    expect((await login(member)).status).toBe(200)
  })

  it('ban, lift, warn (appealed with a session), expiry of a suspension, guards', async () => {
    const mod = await staff()
    const u = await register(s.app)
    const act = (body: object, token = mod.token, id = u.user.id) => api(s.app, 'POST', `/admin/users/${id}/actions`, { token, body })
    const otherMod = await staff()
    expect((await act({ type: 'ban', reason: 'spam' }, mod.token, otherMod.user.id)).status).toBe(403) // staff: admins only
    const admin = await staff('admin')
    expect((await act({ type: 'ban', reason: 'spam' }, admin.token, admin.user.id)).status).toBe(400) // never yourself
    expect((await act({ type: 'warn', reason: 'other' }, admin.token, otherMod.user.id)).status).toBe(201)
    expect((await act({ type: 'lift', reason: 'other' })).status).toBe(409) // nothing to lift
    expect((await act({ type: 'ban', reason: 'scam' })).status).toBe(201)
    expect((await login(u)).body.error.restriction).toMatchObject({ type: 'banned', reason: 'scam', until: null })
    expect((await act({ type: 'suspend', reason: 'spam', until: new Date(Date.now() + DAY).toISOString() })).status).toBe(409)
    expect((await act({ type: 'lift', reason: 'scam' })).status).toBe(201)
    const back = await login(u)
    expect(back.status).toBe(200)

    expect((await act({ type: 'warn', reason: 'spam' })).status).toBe(201)
    expect((await api(s.app, 'GET', '/users/@me', { token: back.body.token })).status).toBe(200) // a warning locks nothing
    const actions = (await api(s.app, 'GET', '/users/@me/actions', { token: back.body.token })).body
    expect(actions.map((a: { type: string }) => a.type)).toEqual(['warn', 'lift', 'ban'])
    expect(actions[0].appealDeadline).toEqual(expect.any(String))
    expect(actions[1].appealDeadline).toBeNull()
    const appeal = await api(s.app, 'POST', '/appeals', { ip: freshIp(), token: back.body.token, body: { actionId: actions[0].id, message: 'Foi um engano, não mandei spam.' } })
    expect(appeal.status).toBe(201)
    // An upheld appeal of a warning has nothing to lift.
    expect((await api(s.app, 'PATCH', `/admin/appeals/${appeal.body.id}`, { token: mod.token, body: { status: 'rejected', note: 'prints conferidos' } })).body.status).toBe('rejected')
    expect((await api(s.app, 'POST', '/appeals', { ip: freshIp(), token: back.body.token, body: { actionId: actions[2].id, message: 'Outro recurso qualquer.' } })).status).toBe(201)

    expect((await act({ type: 'suspend', reason: 'spam', until: new Date(Date.now() + DAY).toISOString() })).status).toBe(201)
    expect((await login(u)).status).toBe(403)
    await s.app.ctx.db.update(users).set({ suspendedUntil: new Date(Date.now() - 1000) }).where(eq(users.id, u.user.id))
    expect((await login(u)).status).toBe(200) // expired on its own

    // csam: no e-mail and a generic reason for the user (no tip-off); staff still see the real one.
    expect((await act({ type: 'ban', reason: 'csam' }, admin.token)).status).toBe(201)
    expect(mailsTo(u.user.email, 'enforcement').length).toBe(3) // ban, warn, suspend: not the csam ban
    expect((await login(u)).body.error.restriction.reason).toBe('other')
  })
})

describe('CSAM process: quarantine and evidence', () => {
  it('a csam report quarantines at once (unservable, out of the message), preserves bytes + hash apart, holds the account', async () => {
    const { owner, member, text } = await setup()
    const { db, files } = s.app.ctx
    const low = (await report(owner.token, { targetType: 'user', targetId: member.user.id, reason: 'spam' })).body
    const { msg, bytes } = await messageWithFile(s.app, member.token, text.id, 'material')
    const fileId = msg.attachments[0]!.id
    const originalKey = `attachments/${text.id}/${fileId}`
    expect((await fetchFile(msg.attachments[0]!.url)).statusCode).toBe(200)
    const gw = await connect(s.port, owner.token)

    const r = await report(owner.token, { targetType: 'message', targetId: msg.id, reason: 'csam' })
    expect(r.status).toBe(201)
    expect((await fetchFile(msg.attachments[0]!.url)).statusCode).toBe(404)
    expect((await gw.waitFor('MESSAGE_UPDATE', (m) => m.id === msg.id)).attachments).toEqual([])
    const history = (await api<Message[]>(s.app, 'GET', `/channels/${text.id}/messages`, { token: owner.token })).body
    expect(history.find((m) => m.id === msg.id)!.attachments).toEqual([])

    const mod = await staff()
    const queue = (await api<AdminReport[]>(s.app, 'GET', '/admin/reports', { token: mod.token })).body
    expect(queue[0]!.id).toBe(r.body.id) // highest priority first, though newer
    expect(queue.findIndex((q) => q.id === low.id)).toBeGreaterThan(0)
    const [q] = (await api<QuarantinedFile[]>(s.app, 'GET', '/admin/quarantine', { token: mod.token })).body.filter((x) => x.attachmentId === fileId)
    expect(q).toMatchObject({ reportId: r.body.id, staffId: null, authorId: member.user.id, evidenceStored: true, sha256: createHash('sha256').update(bytes).digest('hex') })
    expect((await bytesOf(`evidence/${fileId}`)).equals(bytes)).toBe(true)
    await files.sweep()
    expect(await files.storage.get(originalKey)).toBeNull()
    expect((await db.select().from(users).where(eq(users.id, member.user.id)))[0]!.legalHoldAt).not.toBeNull()

    // The author deleting the message or the account destroys nothing.
    await api(s.app, 'DELETE', `/channels/${text.id}/messages/${msg.id}`, { token: member.token })
    await files.sweep()
    expect((await bytesOf(`evidence/${fileId}`)).length).toBe(bytes.length)
    await api(s.app, 'DELETE', '/users/@me', { token: member.token, body: { password: PASSWORD } })
    await s.app.ctx.privacy.retention(new Date(Date.now() + 8 * DAY))
    expect((await db.select().from(users).where(eq(users.id, member.user.id))).length).toBe(1)

    // Reported to the authority, receipt confirmed: the material goes, the record stays (Decreto 12.880/2026 art. 39 §2).
    expect((await api(s.app, 'PATCH', `/admin/quarantine/${q!.id}`, { token: mod.token, body: { receiptConfirmed: true } })).status).toBe(400)
    const purged = await api<QuarantinedFile>(s.app, 'PATCH', `/admin/quarantine/${q!.id}`, { token: mod.token, body: { authorityProtocol: 'CNCA-2026-000123', receiptConfirmed: true } })
    expect(purged.body).toMatchObject({ authorityProtocol: 'CNCA-2026-000123', evidenceStored: false, purgedAt: expect.any(String), sha256: q!.sha256 })
    await files.sweep()
    expect(await files.storage.get(`evidence/${fileId}`)).toBeNull()
    // Hold released by staff: the pending deletion proceeds.
    expect((await api(s.app, 'PATCH', `/admin/users/${member.user.id}`, { token: mod.token, body: { legalHold: false } })).status).toBe(204)
    await s.app.ctx.privacy.retention(new Date(Date.now() + 8 * DAY))
    expect((await db.select().from(users).where(eq(users.id, member.user.id))).length).toBe(0)
    expect((await db.select().from(quarantinedFiles).where(eq(quarantinedFiles.attachmentId, fileId))).length).toBe(1)
    gw.close()
  })

  it('staff quarantine by hand (idempotent); a failed copy keeps the original held and is retried', async () => {
    const { member, text } = await setup()
    const { db, files } = s.app.ctx
    const mod = await staff()
    const { msg, bytes } = await messageWithFile(s.app, member.token, text.id, 'outro')
    const fileId = msg.attachments[0]!.id
    const put = vi.spyOn(files.storage, 'put').mockRejectedValueOnce(new Error('bucket down'))
    const first = await api<QuarantinedFile>(s.app, 'POST', `/admin/attachments/${fileId}/quarantine`, { token: mod.token, body: { note: 'imagem íntima sem consentimento' } })
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ staffId: mod.user.id, evidenceStored: false })
    expect((await fetchFile(msg.attachments[0]!.url)).statusCode).toBe(404)
    await files.sweep()
    expect((await bytesOf(`attachments/${text.id}/${fileId}`)).equals(bytes)).toBe(true) // held, not deleted
    put.mockRestore()
    await s.app.ctx.trust.sweep()
    const [row] = await db.select().from(quarantinedFiles).where(and(eq(quarantinedFiles.attachmentId, fileId)))
    expect(row!.evidenceStoredAt).not.toBeNull()
    expect((await bytesOf(`evidence/${fileId}`)).equals(bytes)).toBe(true)
    const again = await api<QuarantinedFile>(s.app, 'POST', `/admin/attachments/${fileId}/quarantine`, { token: mod.token, body: {} })
    expect([again.status, again.body.id]).toEqual([201, first.body.id])
    expect((await api(s.app, 'POST', `/admin/attachments/${crypto.randomUUID()}/quarantine`, { token: mod.token, body: {} })).status).toBe(404)
  })
})
