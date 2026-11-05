import type { UninstallFeedbackSummary } from '@alga/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uninstallFeedback } from '../src/db/schema.js'
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
