import { silencedFor, type Invite, type NotifyPrefs, type PushKey, type SpaceSnapshot } from '@alga/shared'
import webpush from 'web-push'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { messagePayload, messageTargets, type PushMessage } from '../src/push.js'
import { api, befriend, connect, register, startServer, type TestServer } from './helpers.js'

const base: PushMessage = { channelId: 'c1', channelType: 'text', channelName: 'geral', spaceId: 's1', authorId: 'ana', authorName: 'Ana', content: 'oi @bia', attachments: 0 }

describe('messageTargets', () => {
  it('a DM goes to everyone else in it; a space message only to the mentioned', () => {
    expect(messageTargets({ channelType: 'dm', authorId: 'ana' }, ['ana', 'bia'], [])).toEqual(['bia'])
    expect(messageTargets({ channelType: 'group_dm', authorId: 'ana' }, ['ana', 'bia', 'cris'], [])).toEqual(['bia', 'cris'])
    expect(messageTargets({ channelType: 'text', authorId: 'ana' }, ['ana', 'bia', 'cris'], ['bia'])).toEqual(['bia'])
    expect(messageTargets({ channelType: 'text', authorId: 'ana' }, ['ana', 'bia'], [])).toEqual([])
  })
})

describe('messagePayload', () => {
  it('names the sender, and the channel and space for a mention', () => {
    expect(messagePayload({ ...base, channelType: 'dm', spaceId: null }, null)).toMatchObject({ kind: 'dm', title: 'Ana', body: 'oi @bia', tag: 'msg:c1' })
    expect(messagePayload(base, 'Os de Sempre')).toMatchObject({ kind: 'mention', title: 'Ana em #geral · Os de Sempre' })
  })
  it('cuts long text and says when it is only a file', () => {
    expect(messagePayload({ ...base, content: 'a'.repeat(500) }, null).body).toHaveLength(140)
    expect(messagePayload({ ...base, content: '', attachments: 1 }, null).body).toBe('Enviou um anexo')
  })
})

describe('silencedFor', () => {
  const now = 1_000
  it('a silenced DM, channel or space, or a space at "none"', () => {
    expect(silencedFor({ levels: {}, muted: { c1: now + 1 } }, 'c1', null, now)).toBe(true)
    expect(silencedFor({ levels: {}, muted: { s1: now + 1 } }, 'c1', 's1', now)).toBe(true)
    expect(silencedFor({ levels: { s1: 'none' }, muted: {} }, 'c1', 's1', now)).toBe(true)
  })
  it('an ended silence or a "mentions" level still notifies', () => {
    expect(silencedFor({ levels: {}, muted: { c1: now - 1 } }, 'c1', null, now)).toBe(false)
    expect(silencedFor({ levels: { s1: 'mentions' }, muted: {} }, 'c1', 's1', now)).toBe(false)
  })
})

// ---- routes and delivery, against the real app (the push service itself is stubbed) ------------------------------
describe('web push', () => {
  let s: TestServer
  const keys = webpush.generateVAPIDKeys()
  const sent: { endpoint: string; payload: { kind: string; title: string; body: string } }[] = []
  let answer: () => Promise<unknown> = async () => ({ statusCode: 201 })
  beforeAll(async () => {
    s = await startServer({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:qa@alga.test' })
    vi.spyOn(webpush, 'sendNotification').mockImplementation(async (sub, body) => {
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(String(body)) })
      return answer() as never
    })
  })
  afterAll(async () => {
    await s.close()
  })
  const settle = () => new Promise((r) => setTimeout(r, 200))
  const sub = (n: string) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'BPx', auth: 'au' } })

  it('mentions and DMs reach the phone; activity, silences and gone subscriptions stop them', async () => {
    const ana = await register(s.app)
    const bia = await register(s.app)
    expect((await api<PushKey>(s.app, 'GET', '/push/key', { token: ana.token })).body.key).toBe(keys.publicKey)
    const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: ana.token, body: { name: 'Os de Sempre' } })).body
    const inv = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: ana.token, body: {} })).body
    await api(s.app, 'POST', `/invites/${inv.code}`, { token: bia.token })
    const text = space.channels.find((c) => c.type === 'text')!
    expect((await api(s.app, 'POST', '/push/subscriptions', { token: bia.token, body: sub('bia') })).status).toBe(204)

    // A plain message in a space: nobody's phone. A mention: Bia's.
    await api(s.app, 'POST', `/channels/${text.id}/messages`, { token: ana.token, body: { content: 'oi gente' } })
    await api(s.app, 'POST', `/channels/${text.id}/messages`, { token: ana.token, body: { content: `<@${bia.user.id}> bora?` } })
    await settle()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ endpoint: 'https://push.example/bia', payload: { kind: 'mention', title: `${ana.user.displayName} em #${text.name} · Os de Sempre` } })

    // A DM.
    await befriend(s.app, ana, bia)
    const dm = (await api<{ id: string }>(s.app, 'POST', '/users/@me/channels', { token: ana.token, body: { recipientIds: [bia.user.id] } })).body
    await api(s.app, 'POST', `/channels/${dm.id}/messages`, { token: ana.token, body: { content: 'te liguei' } })
    await settle()
    expect(sent.at(-1)?.payload).toMatchObject({ kind: 'dm', title: ana.user.displayName, body: 'te liguei' })

    // Bia silences the DM (the choice reaches her other devices): no push.
    const pc = await connect(s.port, bia.token)
    const prefs: NotifyPrefs = { levels: {}, muted: { [dm.id]: Date.now() + 3_600_000 } }
    expect((await api<NotifyPrefs>(s.app, 'PUT', '/users/@me/notify-prefs', { token: bia.token, body: prefs })).body).toEqual(prefs)
    expect(await pc.waitFor('NOTIFY_PREFS_UPDATE')).toEqual(prefs)
    expect((await api<NotifyPrefs>(s.app, 'GET', '/users/@me/notify-prefs', { token: bia.token })).body).toEqual(prefs)
    let n = sent.length
    await api(s.app, 'POST', `/channels/${dm.id}/messages`, { token: ana.token, body: { content: 'silêncio' } })
    await settle()
    expect(sent).toHaveLength(n)

    // Bia is using Alga on her PC: the mention stays off her phone.
    pc.send({ op: 'active' })
    await settle()
    await api(s.app, 'POST', `/channels/${text.id}/messages`, { token: ana.token, body: { content: `<@${bia.user.id}> tá aí?` } })
    await settle()
    expect(sent).toHaveLength(n)
    pc.close()

    // Away from the PC again, and the push service says the subscription is gone: it is dropped.
    s.app.ctx.push.sweep(Date.now() + 10 * 60_000)
    answer = async () => {
      throw Object.assign(new Error('gone'), { statusCode: 410 })
    }
    await api(s.app, 'POST', `/channels/${text.id}/messages`, { token: ana.token, body: { content: `<@${bia.user.id}> e agora?` } })
    await settle()
    expect(sent).toHaveLength(n + 1)
    answer = async () => ({ statusCode: 201 })
    await api(s.app, 'POST', `/channels/${text.id}/messages`, { token: ana.token, body: { content: `<@${bia.user.id}> de novo` } })
    await settle()
    expect(sent).toHaveLength(n + 1)
  })
})
