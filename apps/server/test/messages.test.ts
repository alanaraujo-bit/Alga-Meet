import type { Invite, Message, SpaceSnapshot } from '@alga/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mentionedIds } from '../src/routes/messages.js'
import { api, connect, register, startServer, type TestServer } from './helpers.js'

let s: TestServer
beforeAll(async () => { s = await startServer() })
afterAll(async () => { await s.close() })

async function setup() {
  const alice = await register(s.app)
  const bob = await register(s.app)
  const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: alice.token, body: { name: 'Chat' } })).body
  const inv = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: alice.token, body: {} })).body
  await api(s.app, 'POST', `/invites/${inv.code}`, { token: bob.token })
  const text = space.channels.find((c) => c.type === 'text')!
  const voice = space.channels.find((c) => c.type === 'voice')!
  return { alice, bob, space, text, voice }
}

const send = (token: string, channelId: string, body: object) =>
  api<Message>(s.app, 'POST', `/channels/${channelId}/messages`, { token, body })

describe('messages', () => {
  it('send → MESSAGE_CREATE on another member\'s socket (with nonce), lastMessageId updates', async () => {
    const { alice, bob, text } = await setup()
    const gwBob = await connect(s.port, bob.token)
    const sent = await send(alice.token, text.id, { content: '  olá mundo  ', nonce: 'n-1' })
    expect(sent.status).toBe(200)
    expect(sent.body).toMatchObject({ channelId: text.id, content: 'olá mundo', nonce: 'n-1', editedAt: null, reactions: [], attachments: [] })
    expect(sent.body.author.id).toBe(alice.user.id)
    const evt = await gwBob.waitFor('MESSAGE_CREATE', (m) => m.id === sent.body.id)
    expect(evt).toMatchObject({ content: 'olá mundo', nonce: 'n-1', author: { id: alice.user.id } })

    const ready = await (await connect(s.port, bob.token)).waitFor('READY')
    expect(ready.spaces[0]!.channels.find((c) => c.id === text.id)!.lastMessageId).toBe(sent.body.id)
    gwBob.close()
  })

  it('rejects messages in voice channels, empty content and unknown replies', async () => {
    const { alice, text, voice } = await setup()
    expect((await send(alice.token, voice.id, { content: 'x' })).status).toBe(400)
    const empty = await send(alice.token, text.id, { content: '   ' })
    expect(empty.status).toBe(400)
    expect(empty.body).toMatchObject({ error: { code: 'validation', fields: { content: expect.any(String) } } })
    const reply = await send(alice.token, text.id, { content: 'x', replyToId: '0190f000-0000-7000-8000-000000000000' })
    expect(reply.body.error.fields.replyToId).toBeDefined()
  })

  it('paginates newest first by id with before/after/limit', async () => {
    const { alice, text } = await setup()
    const ids: string[] = []
    for (let i = 0; i < 7; i++) ids.push((await send(alice.token, text.id, { content: `m${i}` })).body.id)

    const page = (q: string) => api<Message[]>(s.app, 'GET', `/channels/${text.id}/messages${q}`, { token: alice.token })
    expect((await page('?limit=3')).body.map((m) => m.content)).toEqual(['m6', 'm5', 'm4'])
    expect((await page(`?before=${ids[4]}&limit=3`)).body.map((m) => m.content)).toEqual(['m3', 'm2', 'm1'])
    expect((await page(`?after=${ids[1]}&limit=2`)).body.map((m) => m.content)).toEqual(['m3', 'm2'])
    expect((await page(`?after=${ids[1]}&before=${ids[5]}`)).body.map((m) => m.content)).toEqual(['m4', 'm3', 'm2'])
    expect((await page('?limit=101')).status).toBe(400)
  })

  it('edit is author-only; delete is author or MANAGE_MESSAGES', async () => {
    const { alice, bob, text } = await setup()
    const gwAlice = await connect(s.port, alice.token)
    const byBob = (await send(bob.token, text.id, { content: 'do bob' })).body
    const byAlice = (await send(alice.token, text.id, { content: 'da alice' })).body

    expect((await api(s.app, 'PATCH', `/channels/${text.id}/messages/${byBob.id}`, { token: alice.token, body: { content: 'hack' } })).status).toBe(403)
    const edited = await api<Message>(s.app, 'PATCH', `/channels/${text.id}/messages/${byBob.id}`, { token: bob.token, body: { content: 'editado' } })
    expect(edited.body.content).toBe('editado')
    expect(edited.body.editedAt).not.toBeNull()
    await gwAlice.waitFor('MESSAGE_UPDATE', (m) => m.id === byBob.id && m.content === 'editado')

    // bob (plain member) cannot delete alice's message; alice (owner → MANAGE_MESSAGES) can delete bob's.
    expect((await api(s.app, 'DELETE', `/channels/${text.id}/messages/${byAlice.id}`, { token: bob.token })).status).toBe(403)
    expect((await api(s.app, 'DELETE', `/channels/${text.id}/messages/${byBob.id}`, { token: alice.token })).status).toBe(204)
    await gwAlice.waitFor('MESSAGE_DELETE', (d) => d.id === byBob.id && d.channelId === text.id)
    expect((await api(s.app, 'DELETE', `/channels/${text.id}/messages/${byBob.id}`, { token: alice.token })).status).toBe(404)
    gwAlice.close()
  })

  it('reactions are unique per user+emoji, events fan out, and `me` is computed per viewer', async () => {
    const { alice, bob, text } = await setup()
    const gwBob = await connect(s.port, bob.token)
    const msg = (await send(alice.token, text.id, { content: 'reaja' })).body
    const url = (emoji: string) => `/channels/${text.id}/messages/${msg.id}/reactions/${encodeURIComponent(emoji)}`

    expect((await api(s.app, 'PUT', url('🔥'), { token: alice.token })).status).toBe(204)
    expect((await api(s.app, 'PUT', url('🔥'), { token: alice.token })).status).toBe(204) // idempotent
    await gwBob.waitFor('REACTION_ADD', (r) => r.messageId === msg.id && r.emoji === '🔥' && r.userId === alice.user.id)
    await api(s.app, 'PUT', url('👍🏽'), { token: bob.token })

    const asAlice = (await api<Message[]>(s.app, 'GET', `/channels/${text.id}/messages`, { token: alice.token })).body[0]!
    const asBob = (await api<Message[]>(s.app, 'GET', `/channels/${text.id}/messages`, { token: bob.token })).body[0]!
    expect(asAlice.reactions).toEqual([{ emoji: '🔥', count: 1, me: true }, { emoji: '👍🏽', count: 1, me: false }])
    expect(asBob.reactions).toEqual([{ emoji: '🔥', count: 1, me: false }, { emoji: '👍🏽', count: 1, me: true }])

    // MESSAGE_UPDATE after an edit carries per-recipient `me`.
    await api(s.app, 'PATCH', `/channels/${text.id}/messages/${msg.id}`, { token: alice.token, body: { content: 'reaja!' } })
    const upd = await gwBob.waitFor('MESSAGE_UPDATE', (m) => m.id === msg.id)
    expect(upd.reactions).toEqual([{ emoji: '🔥', count: 1, me: false }, { emoji: '👍🏽', count: 1, me: true }])

    expect((await api(s.app, 'DELETE', url('🔥'), { token: alice.token })).status).toBe(204)
    await gwBob.waitFor('REACTION_REMOVE', (r) => r.emoji === '🔥' && r.userId === alice.user.id)
    expect((await api(s.app, 'PUT', url('x'.repeat(33)), { token: alice.token })).status).toBe(400)
    gwBob.close()
  })

  it('typing is throttled to one event per 5s per user/channel and never echoed to the typer', async () => {
    const { alice, bob, text } = await setup()
    const gwBob = await connect(s.port, bob.token)
    const gwAlice = await connect(s.port, alice.token)
    for (let i = 0; i < 3; i++) expect((await api(s.app, 'POST', `/channels/${text.id}/typing`, { token: alice.token })).status).toBe(204)
    await gwBob.waitFor('TYPING_START', (t) => t.userId === alice.user.id && t.channelId === text.id)
    await gwBob.expectNone('TYPING_START', () => gwBob.events.filter((e) => e.t === 'TYPING_START').length > 1)
    await gwAlice.expectNone('TYPING_START', (t) => t.userId === alice.user.id, 50)
    gwBob.close()
    gwAlice.close()
  })

  it('ack + mention counts: <@id> mentions increment, ack resets and dispatches READ_STATE_UPDATE', async () => {
    const { alice, bob, text } = await setup()
    const outsider = await register(s.app)
    expect(mentionedIds(`oi <@${bob.user.id}> e <@${bob.user.id.toUpperCase()}>`)).toEqual([bob.user.id])

    const gwBob = await connect(s.port, bob.token)
    await send(alice.token, text.id, { content: `ei <@${bob.user.id}> e <@${outsider.user.id}>` })
    await gwBob.waitFor('READ_STATE_UPDATE', (r) => r.channelId === text.id && r.mentionCount === 1)
    const last = (await send(alice.token, text.id, { content: `de novo <@${bob.user.id}>` })).body
    await gwBob.waitFor('READ_STATE_UPDATE', (r) => r.channelId === text.id && r.mentionCount === 2)

    const ready = await (await connect(s.port, bob.token)).waitFor('READY')
    expect(ready.readStates).toContainEqual({ channelId: text.id, lastReadMessageId: null, mentionCount: 2 })
    // The author's own messages count as read for them.
    const readyAlice = await (await connect(s.port, alice.token)).waitFor('READY')
    expect(readyAlice.readStates).toContainEqual({ channelId: text.id, lastReadMessageId: last.id, mentionCount: 0 })

    expect((await api(s.app, 'POST', `/channels/${text.id}/ack`, { token: bob.token, body: { messageId: last.id } })).status).toBe(204)
    await gwBob.waitFor('READ_STATE_UPDATE', (r) => r.lastReadMessageId === last.id && r.mentionCount === 0)
    expect((await api(s.app, 'POST', `/channels/${text.id}/ack`, {
      token: bob.token, body: { messageId: '0190f000-0000-7000-8000-000000000000' },
    })).status).toBe(404)
    gwBob.close()
  })

  it('works the same in DMs, only for the two participants', async () => {
    const a = await register(s.app)
    const b = await register(s.app)
    const c = await register(s.app)
    const dm = (await api(s.app, 'POST', '/users/@me/channels', { token: a.token, body: { recipientIds: [b.user.id] } })).body
    const gwB = await connect(s.port, b.token)
    const gwC = await connect(s.port, c.token)
    const m = (await send(a.token, dm.id, { content: 'privado' })).body
    await gwB.waitFor('MESSAGE_CREATE', (x) => x.id === m.id)
    await gwC.expectNone('MESSAGE_CREATE')
    expect((await api(s.app, 'GET', `/channels/${dm.id}/messages`, { token: c.token })).status).toBe(403)
    // No MANAGE_MESSAGES in DMs: b cannot delete a's message.
    expect((await api(s.app, 'DELETE', `/channels/${dm.id}/messages/${m.id}`, { token: b.token })).status).toBe(403)
    gwB.close()
    gwC.close()
  })

  it('rate limits message sends per user', async () => {
    const { alice, text } = await setup()
    const codes: number[] = []
    for (let i = 0; i < 11; i++) codes.push((await send(alice.token, text.id, { content: `spam ${i}` })).status)
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true)
    expect(codes[10]).toBe(429)
  })
})
