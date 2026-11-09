import { ReleaseContent, type AdminReleaseNote, type ReleaseContent as Content, type ReleaseNote } from '@alga/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { releaseNotes, staffAuditLog } from '../src/db/schema.js'
import { setStaffRole } from '../src/trust-safety.js'
import { api, register, startServer, type TestServer } from './helpers.js'

let s: TestServer
let admin: string
let mod: string
let alice: Awaited<ReturnType<typeof register>>
let bob: Awaited<ReturnType<typeof register>>

beforeAll(async () => {
  s = await startServer()
  const a = await register(s.app)
  await setStaffRole(s.app.ctx.db, a.user.username, 'admin')
  admin = a.token
  const m = await register(s.app)
  await setStaffRole(s.app.ctx.db, m.user.username, 'moderator')
  mod = m.token
  alice = await register(s.app)
  bob = await register(s.app)
})
afterAll(async () => { await s.close() })

const note = (title = 'Tudo novo'): Content => ({
  items: [
    { id: 'palco', category: 'new', highlight: true, media: { kind: 'image', url: 'https://github.com/alanaraujo-bit/Alga-Meet/releases/download/v9.0.0/palco.png' } },
    { id: 'conserto', category: 'fixed', highlight: false, media: null },
  ],
  text: { 'pt-BR': { title, summary: 'Resumo', items: { palco: { title: 'Palco', body: 'Novo palco.' }, conserto: { title: 'Conserto', body: '' } } } },
})

describe('history seeded by the migration', () => {
  it('every seeded note is valid content, published up to 0.1.14 and a draft for 0.1.15', async () => {
    const rows = await s.app.ctx.db.select().from(releaseNotes)
    expect(rows.length).toBeGreaterThanOrEqual(13)
    for (const r of rows) expect(ReleaseContent.safeParse(r.content).success, r.version).toBe(true)
    expect(rows.find((r) => r.version === '0.1.15')?.status).toBe('draft')
    expect(rows.filter((r) => r.status === 'published').every((r) => r.publishedAt)).toBe(true)
  })

  it('people get published notes up to their version, newest first, never a draft or a later version', async () => {
    const res = await api<ReleaseNote[]>(s.app, 'GET', '/releases?upTo=0.1.10', { token: alice.token })
    expect(res.status).toBe(200)
    expect(res.body.map((n) => n.version)).toEqual(['0.1.10', '0.1.9', '0.1.8', '0.1.7', '0.1.6', '0.1.5', '0.1.4', '0.1.3'])
    const all = await api<ReleaseNote[]>(s.app, 'GET', '/releases?upTo=0.1.15', { token: alice.token })
    expect(all.body[0]!.version).toBe('0.1.14') // 0.1.15 is still a draft
    expect((await api(s.app, 'GET', '/releases/0.1.15', { token: alice.token })).status).toBe(404)
    expect((await api(s.app, 'GET', '/releases?upTo=latest', { token: alice.token })).status).toBe(400)
    expect((await api(s.app, 'GET', '/releases?upTo=0.1.10')).status).toBe(401)
  })
})

describe('the studio (admin)', () => {
  it('only admins write; moderators and people get 403; every call is audit-logged', async () => {
    expect((await api(s.app, 'GET', '/admin/releases', { token: mod })).status).toBe(403)
    expect((await api(s.app, 'POST', '/admin/releases', { token: alice.token, body: { version: '9.0.0', content: note() } })).status).toBe(403)
    const list = await api<AdminReleaseNote[]>(s.app, 'GET', '/admin/releases', { token: admin })
    expect(list.status).toBe(200)
    expect(list.body[0]!.version).toBe('0.1.15')
    // The status is written in onResponse, after the reply: wait for it.
    let logged = false
    for (let i = 0; i < 50 && !logged; i++) {
      logged = (await s.app.ctx.db.select().from(staffAuditLog)).some((a) => a.route === '/api/v1/admin/releases' && a.method === 'GET' && a.status === 200)
      if (!logged) await new Promise((r) => setTimeout(r, 20))
    }
    expect(logged).toBe(true)
  })

  it('draft → edit (with revision) → publish → visible to people with that version', async () => {
    const created = await api<AdminReleaseNote>(s.app, 'POST', '/admin/releases', { token: admin, body: { version: '9.0.0', content: note() } })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ status: 'draft', revision: 1, publishedAt: null })
    expect((await api(s.app, 'POST', '/admin/releases', { token: admin, body: { version: '9.0.0', content: note() } })).status).toBe(409)
    expect((await api(s.app, 'POST', '/admin/releases', { token: admin, body: { version: '9.0.1', content: { ...note(), items: [] } } })).status).toBe(400)

    // A draft is invisible, even to someone already on that version.
    expect((await api<ReleaseNote[]>(s.app, 'GET', '/releases?upTo=9.0.0', { token: alice.token })).body[0]!.version).toBe('0.1.14')

    const edited = await api<AdminReleaseNote>(s.app, 'PUT', '/admin/releases/9.0.0', { token: admin, body: { content: note('Palco novo'), revision: 1 } })
    expect(edited.body).toMatchObject({ revision: 2 })
    // Someone else saved meanwhile: refused, nothing lost silently.
    const stale = await api(s.app, 'PUT', '/admin/releases/9.0.0', { token: admin, body: { content: note('Outro'), revision: 1 } })
    expect(stale.status).toBe(409)
    expect((await api(s.app, 'PUT', '/admin/releases/9.9.9', { token: admin, body: { content: note(), revision: 1 } })).status).toBe(404)

    const pub = await api<AdminReleaseNote>(s.app, 'POST', '/admin/releases/9.0.0/publish', { token: admin })
    expect(pub.body.status).toBe('published')
    expect(pub.body.publishedAt).not.toBeNull()
    const seen = await api<ReleaseNote>(s.app, 'GET', '/releases/9.0.0', { token: alice.token })
    expect(seen.body.content.text['pt-BR'].title).toBe('Palco novo')
    // Not to someone still on 0.1.14 asking for their history.
    expect((await api<ReleaseNote[]>(s.app, 'GET', '/releases?upTo=0.1.14', { token: alice.token })).body.some((n) => n.version === '9.0.0')).toBe(false)
    expect((await api(s.app, 'POST', '/admin/releases/9.0.0/launch', { token: admin })).status).toBe(400)
  })

  it('deletes only drafts that were never published', async () => {
    expect((await api(s.app, 'DELETE', '/admin/releases/9.0.0', { token: admin })).status).toBe(409)
    await api(s.app, 'POST', '/admin/releases', { token: admin, body: { version: '9.1.0', content: note() } })
    expect((await api(s.app, 'DELETE', '/admin/releases/9.1.0', { token: admin })).status).toBe(204)
    expect((await api(s.app, 'DELETE', '/admin/releases/9.1.0', { token: admin })).status).toBe(404)
  })
})

describe('reactions', () => {
  it('one per person per item: changing it replaces, 0 removes; the team sees totals only', async () => {
    const put = (token: string, item: string, value: number) => api(s.app, 'PUT', `/releases/9.0.0/reactions/${item}`, { token, body: { value } })
    expect((await put(alice.token, 'palco', 1)).status).toBe(204)
    expect((await put(alice.token, 'palco', 1)).status).toBe(204) // same vote twice: still one
    expect((await put(bob.token, 'palco', -1)).status).toBe(204)
    expect((await put(bob.token, 'conserto', 1)).status).toBe(204)

    let mine = await api<ReleaseNote>(s.app, 'GET', '/releases/9.0.0', { token: bob.token })
    expect(mine.body.mine).toEqual({ palco: -1, conserto: 1 })
    expect((await put(bob.token, 'palco', 1)).status).toBe(204) // changed my mind
    expect((await put(bob.token, 'conserto', 0)).status).toBe(204) // took it back
    mine = await api<ReleaseNote>(s.app, 'GET', '/releases/9.0.0', { token: bob.token })
    expect(mine.body.mine).toEqual({ palco: 1 })

    const stats = (await api<AdminReleaseNote[]>(s.app, 'GET', '/admin/releases', { token: admin })).body.find((n) => n.version === '9.0.0')!.stats
    expect(stats).toEqual({ people: 2, items: { palco: { up: 2, down: 0 } } })
    expect(JSON.stringify(stats)).not.toContain(alice.user.id)
  })

  it('refuses unknown items, drafts, odd values', async () => {
    const put = (path: string, value: unknown) => api(s.app, 'PUT', path, { token: alice.token, body: { value } })
    expect((await put('/releases/9.0.0/reactions/nada', 1)).status).toBe(404)
    expect((await put('/releases/0.1.15/reactions/novidades', 1)).status).toBe(404) // draft
    expect((await put('/releases/9.0.0/reactions/palco', 2)).status).toBe(400)
    expect((await put('/releases/x/reactions/palco', 1)).status).toBe(400)
  })

  it('a published note that goes back to draft disappears for people but keeps its totals', async () => {
    await api(s.app, 'POST', '/admin/releases/9.0.0/unpublish', { token: admin })
    expect((await api(s.app, 'GET', '/releases/9.0.0', { token: alice.token })).status).toBe(404)
    const n = (await api<AdminReleaseNote[]>(s.app, 'GET', '/admin/releases', { token: admin })).body.find((x) => x.version === '9.0.0')!
    expect(n.status).toBe('draft')
    expect(n.publishedAt).not.toBeNull()
    expect(n.stats.items.palco!.up).toBe(2)
  })
})
