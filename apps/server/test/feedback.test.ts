import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { FeedbackItem, UninstallFeedbackSummary } from '@alga/shared'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { feedback, storageDeletions, uninstallFeedback, users } from '../src/db/schema.js'
import { setStaffRole } from '../src/trust-safety.js'
import { api, register, startServer, type TestServer } from './helpers.js'

let s: TestServer
beforeAll(async () => { s = await startServer() })
afterAll(async () => { await s.close() })

describe('"Por que está saindo?" (uninstall window)', () => {
  it('keeps the reason and the note, and nothing about who sent it', async () => {
    const res = await api(s.app, 'POST', '/feedback/uninstall', { body: { reason: 'audio_video', note: '  o microfone chiava  ', version: '0.1.7' } })
    expect(res.status).toBe(204)
    const rows = await s.app.ctx.db.select().from(uninstallFeedback)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ reason: 'audio_video', note: 'o microfone chiava', appVersion: '0.1.7' })
    expect(Object.keys(rows[0]!).sort()).toEqual(['appVersion', 'createdAt', 'id', 'note', 'reason'])
  })

  it('refuses reasons outside the list, long notes and odd versions', async () => {
    for (const body of [{ reason: 'hate_it' }, { reason: 'other', note: 'x'.repeat(281) }, { reason: 'other', version: '1.0.0; drop' }, {}]) {
      expect((await api(s.app, 'POST', '/feedback/uninstall', { body })).status).toBe(400)
    }
    // Five per hour from one address: enough for a household, not for a flood.
    expect((await api(s.app, 'POST', '/feedback/uninstall', { body: { reason: 'other' } })).status).toBe(429)
  })
})

describe('reading it (staff)', () => {
  it('admins get the reasons, most common first, and the latest notes; nobody else does', async () => {
    for (const body of [{ reason: 'performance' }, { reason: 'performance', note: 'travou no jogo' }, { reason: 'reinstalling' }]) {
      expect((await api(s.app, 'POST', '/feedback/uninstall', { body, ip: '10.0.0.2' })).status).toBe(204)
    }
    const admin = await register(s.app)
    await setStaffRole(s.app.ctx.db, admin.user.username, 'admin')
    const sum = await api<UninstallFeedbackSummary>(s.app, 'GET', '/admin/uninstall-feedback', { token: admin.token })
    expect(sum.status).toBe(200)
    expect(sum.body.byReason[0]).toEqual({ reason: 'performance', count: 2 })
    expect(sum.body.total).toBeGreaterThanOrEqual(4)
    expect(sum.body.notes[0]).toMatchObject({ reason: 'performance', note: 'travou no jogo' })

    const mod = await register(s.app)
    await setStaffRole(s.app.ctx.db, mod.user.username, 'moderator')
    expect((await api(s.app, 'GET', '/admin/uninstall-feedback', { token: mod.token })).status).toBe(403)
    expect((await api(s.app, 'GET', '/admin/uninstall-feedback', { token: (await register(s.app)).token })).status).toBe(403)
  })
})

describe('app feedback ("Conta pro Eco")', () => {
  const ctx = { view: 'space', inCall: true, sharing: false, cinema: false, crash: null }
  let alice: Awaited<ReturnType<typeof register>>
  let bob: Awaited<ReturnType<typeof register>>
  let png: Buffer
  beforeAll(async () => {
    alice = await register(s.app)
    bob = await register(s.app)
    png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#2a9' } }).png().toBuffer()
  })

  async function send(token: string | undefined, fields: Record<string, string>, file?: { name: string; bytes: Buffer }, headers: Record<string, string> = {}) {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.append(k, v)
    if (file) fd.append('screenshot', new Blob([new Uint8Array(file.bytes)], { type: 'image/png' }), file.name)
    const req = new Request('http://x', { method: 'POST', body: fd })
    const res = await s.app.inject({
      method: 'POST', url: '/api/v1/feedback',
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': req.headers.get('content-type')!, ...headers },
      payload: Buffer.from(await req.arrayBuffer()),
    })
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined }
  }
  const rowOf = async (id: string) => (await s.app.ctx.db.select().from(feedback).where(eq(feedback.id, id)))[0]!
  const leftoverSpools = () => readdirSync(tmpdir()).filter((f) => f.startsWith(`alga-upload-${process.pid}-`))

  it('stores a bug with context, client header and log; the sender lists it', async () => {
    const res = await send(alice.token, { kind: 'bug', text: ' áudio some ', context: JSON.stringify(ctx), log: 'l1\nl2' }, undefined, { 'x-alga-client': '0.1.15; Windows 11' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ kind: 'bug', text: 'áudio some', hasScreenshot: false })
    expect(await rowOf(res.body.id)).toMatchObject({ userId: alice.user.id, client: '0.1.15; Windows 11', log: 'l1\nl2', context: ctx, storageKey: null })
    const mine = await api<FeedbackItem[]>(s.app, 'GET', '/feedback/@me', { token: alice.token })
    expect(mine.status).toBe(200)
    expect(mine.body.map((f) => f.id)).toEqual([res.body.id])
    expect(Object.keys(mine.body[0]!).sort()).toEqual(['createdAt', 'hasScreenshot', 'id', 'kind', 'text'])
  })

  it('never shows one person the feedback of another', async () => {
    expect((await api(s.app, 'GET', '/feedback/@me', { token: bob.token })).body).toEqual([])
  })

  it('lists the newest first', async () => {
    const second = await send(alice.token, { kind: 'praise', text: 'cinema lindo', context: JSON.stringify(ctx) })
    const mine = await api<FeedbackItem[]>(s.app, 'GET', '/feedback/@me', { token: alice.token })
    expect(mine.body[0]!.id).toBe(second.body.id)
    expect(mine.body).toHaveLength(2)
  })

  it('drops the log on idea and praise', async () => {
    const res = await send(alice.token, { kind: 'idea', text: 'x', context: JSON.stringify(ctx), log: 'secret' })
    expect(res.status).toBe(201)
    expect((await rowOf(res.body.id)).log).toBeNull()
  })

  it('stores a screenshot scrubbed as webp and reports hasScreenshot', async () => {
    const res = await send(alice.token, { kind: 'bug', text: 'x', context: JSON.stringify(ctx) }, { name: 'print.png', bytes: png })
    expect(res.status).toBe(201)
    expect(res.body.hasScreenshot).toBe(true)
    const row = await rowOf(res.body.id)
    expect(row.storageKey).toBe(`feedback/${alice.user.id}/${res.body.id}.webp`)
    const stored = await s.app.ctx.files.storage.get(row.storageKey!)
    expect(stored).not.toBeNull()
    stored!.destroy()
    // Referenced by a committed row: no longer pending deletion.
    expect(await s.app.ctx.db.select().from(storageDeletions).where(eq(storageDeletions.key, row.storageKey!))).toHaveLength(0)
    expect(leftoverSpools()).toEqual([])
  })

  it('rejects a screenshot that is not an image and stores nothing', async () => {
    const before = (await s.app.ctx.db.select().from(feedback)).length
    const res = await send(alice.token, { kind: 'bug', text: 'x', context: JSON.stringify(ctx) }, { name: 'print.png', bytes: Buffer.from('MZ this is not an image at all') })
    expect(res.status).toBe(400)
    expect(res.body.error.fields.screenshot).toBeTruthy()
    expect((await s.app.ctx.db.select().from(feedback)).length).toBe(before)
    expect(leftoverSpools()).toEqual([])
  })

  it('rejects bad fields: empty text, extra context key, context that is not JSON, oversized log, unknown kind', async () => {
    // Refused sends count toward the 10 per hour too, so this runs on its own account.
    const erin = await register(s.app)
    for (const f of [
      { kind: 'bug', text: '  ', context: JSON.stringify(ctx) },
      { kind: 'bug', text: 'x', context: JSON.stringify({ ...ctx, channelId: 'c' }) },
      { kind: 'bug', text: 'x', context: '{' },
      { kind: 'bug', text: 'x', context: JSON.stringify(ctx), log: 'x'.repeat(48 * 1024 + 1) },
      { kind: 'rant', text: 'x', context: JSON.stringify(ctx) },
      { kind: 'bug', text: 'x' },
    ]) expect((await send(erin.token, f as Record<string, string>)).status, JSON.stringify(f).slice(0, 80)).toBe(400)
    expect((await api(s.app, 'POST', '/feedback', { token: erin.token, body: { kind: 'idea', text: 'x', context: ctx } })).status).toBe(400)
    expect(await s.app.ctx.db.select().from(feedback).where(eq(feedback.userId, erin.user.id))).toHaveLength(0)
  })

  it('needs a session', async () => {
    expect((await send(undefined, { kind: 'idea', text: 'x', context: JSON.stringify(ctx) })).status).toBe(401)
    expect((await api(s.app, 'GET', '/feedback/@me')).status).toBe(401)
  })

  it('allows 10 per hour per person, then 429', async () => {
    const carol = await register(s.app)
    for (let i = 0; i < 10; i++) expect((await send(carol.token, { kind: 'idea', text: `i${i}`, context: JSON.stringify(ctx) })).status).toBe(201)
    expect((await send(carol.token, { kind: 'idea', text: 'x', context: JSON.stringify(ctx) })).status).toBe(429)
    // per person, not per address: bob (same IP) still can
    expect((await send(bob.token, { kind: 'idea', text: 'x', context: JSON.stringify(ctx) })).status).toBe(201)
  })

  it('goes in the data export, without the storage key', async () => {
    const data = await s.app.ctx.privacy.collect(alice.user.id, new Date()) as { feedback: Array<Record<string, unknown>> }
    expect(data.feedback).toHaveLength(4)
    const bug = data.feedback.find((f) => f.text === 'áudio some')!
    expect(bug).toMatchObject({ kind: 'bug', context: ctx, log: 'l1\nl2', client: '0.1.15; Windows 11', hasScreenshot: false })
    expect(typeof bug.createdAt).toBe('string')
    expect(data.feedback.some((f) => f.hasScreenshot === true)).toBe(true)
    expect(JSON.stringify(data.feedback)).not.toContain('feedback/')
  })

  it('goes away with the account, and the screenshot object is queued for deletion', async () => {
    const dave = await register(s.app)
    const res = await send(dave.token, { kind: 'bug', text: 'x', context: JSON.stringify(ctx) }, { name: 'print.png', bytes: png })
    const key = (await rowOf(res.body.id)).storageKey!
    await s.app.ctx.db.delete(users).where(eq(users.id, dave.user.id))
    expect(await s.app.ctx.db.select().from(feedback).where(eq(feedback.userId, dave.user.id))).toHaveLength(0)
    expect(await s.app.ctx.db.select().from(storageDeletions).where(eq(storageDeletions.key, key))).toHaveLength(1)
  })
})
