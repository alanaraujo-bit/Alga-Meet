import { PLAYLISTS_MAX, type Invite, type MusicState, type SavedPlaylist, type SpaceSnapshot } from '@alga/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, connect, postWebhook, register, startServer, type Gateway, type TestServer } from './helpers.js'

let s: TestServer
let lookups = 0
beforeAll(async () => {
  s = await startServer()
  // No network: ids starting with NOEMBED/GONE stand for YouTube's refusals.
  s.app.ctx.music.meta = async (videoId) => {
    lookups++
    return videoId.startsWith('NOEMBED') ? 'not_embeddable' : videoId.startsWith('GONE') ? 'unavailable' : { title: `Song ${videoId}`, author: 'Artist' }
  }
  s.app.ctx.music.listName = async (listId) => (listId === 'PLBCF2DAC6FFB574DE' ? 'Google Search Stories' : null)
})
afterAll(async () => { await s.close() })

const id = (n: number) => `vid${String(n).padStart(8, '0')}`
const ids = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => id(from + i))

describe('saved playlists', () => {
  it('create, list, rename, reorder, delete — only my own', async () => {
    const [a, b] = [await register(s.app), await register(s.app)]
    const made = await api<SavedPlaylist>(s.app, 'POST', '/music/playlists', { token: a.token, body: { name: '  Rock  ', videoIds: [id(1), 'NOEMBED0001', id(2), id(1)] } })
    expect(made.status).toBe(201)
    // Server's own titles; the one that cannot play outside YouTube and the duplicate are left out.
    expect(made.body).toMatchObject({ name: 'Rock', items: [{ videoId: id(1), title: `Song ${id(1)}`, author: 'Artist' }, { videoId: id(2) }] })
    expect(made.body.items).toHaveLength(2)

    const fromLink = await api<SavedPlaylist>(s.app, 'POST', '/music/playlists', { token: a.token, body: { videoIds: [id(3)], listId: 'PLBCF2DAC6FFB574DE' } })
    expect(fromLink.body.name).toBe('Google Search Stories')

    const list = await api<SavedPlaylist[]>(s.app, 'GET', '/music/playlists', { token: a.token })
    expect(list.body.map((p) => p.id)).toEqual([fromLink.body.id, made.body.id])
    expect((await api<SavedPlaylist[]>(s.app, 'GET', '/music/playlists', { token: b.token })).body).toEqual([])

    const before = lookups
    const patched = await api<SavedPlaylist>(s.app, 'PATCH', `/music/playlists/${made.body.id}`, { token: a.token, body: { name: 'Rock nacional', videoIds: [id(2), id(1)] } })
    expect(patched.body).toMatchObject({ name: 'Rock nacional', items: [{ videoId: id(2) }, { videoId: id(1) }] })
    expect(lookups).toBe(before) // reordering looks nothing up again

    expect((await api(s.app, 'PATCH', `/music/playlists/${made.body.id}`, { token: b.token, body: { name: 'mine now' } })).status).toBe(404)
    expect((await api(s.app, 'DELETE', `/music/playlists/${made.body.id}`, { token: b.token })).status).toBe(404)
    expect((await api(s.app, 'DELETE', `/music/playlists/${made.body.id}`, { token: a.token })).status).toBe(204)
    expect((await api<SavedPlaylist[]>(s.app, 'GET', '/music/playlists', { token: a.token })).body).toHaveLength(1)
  })

  it('refuses empty, unplayable-only, too many', async () => {
    const a = await register(s.app)
    expect((await api(s.app, 'POST', '/music/playlists', { token: a.token, body: { name: 'x', videoIds: [] } })).status).toBe(400)
    expect((await api(s.app, 'POST', '/music/playlists', { token: a.token, body: { name: 'x', videoIds: ['GONE0000001'] } })).status).toBe(400)
    expect((await api(s.app, 'PATCH', `/music/playlists/not-a-uuid`, { token: a.token, body: { name: 'x' } })).status).toBe(404)
    for (let i = 0; i < PLAYLISTS_MAX; i++) {
      await s.app.ctx.db.insert((await import('../src/db/schema.js')).musicPlaylists).values({ id: crypto.randomUUID(), ownerId: a.user.id, name: `p${i}`, items: [] })
    }
    expect((await api(s.app, 'POST', '/music/playlists', { token: a.token, body: { name: 'x', videoIds: [id(1)] } })).status).toBe(400)
  })
})

let seq = 0
const event = (name: string, channelId: string, identity: string) => ({
  event: name, id: `EV_PL_${++seq}`, createdAt: String(Math.floor(Date.now() / 1000)),
  room: { sid: `RM_${channelId.slice(0, 8)}`, name: `ch_${channelId}` },
  participant: { sid: `PA_PL_${seq}`, identity, name: 'x', joinedAt: String(Math.floor(Date.now() / 1000)) },
})
const states = (gw: Gateway) => gw.events.filter((e) => e.t === 'MUSIC_STATE').map((e) => e.d as MusicState)

describe('a playlist in a call (music_add_many)', () => {
  it('starts at once, fills the queue, says who put which playlist; replace swaps what plays', async () => {
    const [a, b] = [await register(s.app), await register(s.app)]
    const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: a.token, body: { name: 'Som' } })).body
    const inv = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: a.token, body: {} })).body
    await api(s.app, 'POST', `/invites/${inv.code}`, { token: b.token })
    const ch = space.channels.find((x) => x.type === 'voice')!.id
    for (const u of [a, b]) await postWebhook(s.app, s.config, event('participant_joined', ch, u.user.id))
    const [ga, gb] = (await Promise.all([a, b].map((u) => connect(s.port, u.token)))) as [Gateway, Gateway]
    expect((ga.events.find((e) => e.t === 'READY')!.d as { musicPlaylists?: boolean }).musicPlaylists).toBe(true)

    const songs = [...ids(100, 120), 'NOEMBED0002', id(100)]
    ga.send({ op: 'music_add_many', channelId: ch, videoIds: songs, replace: false, label: 'Viagem' })
    const done = (await gb.waitFor('MUSIC_STATE', (d) => (d as MusicState).last?.count === 20)) as MusicState
    expect(done.now?.videoId).toBe(id(100))
    expect(done.queue.map((t) => t.videoId)).toEqual(ids(101, 120))
    expect(done.last).toMatchObject({ kind: 'playlist', by: a.user.id, title: 'Viagem', count: 20 })
    // The first batch was heard before the whole playlist was looked up.
    const first = states(gb).find((d) => d.last?.kind === 'playlist')!
    expect(first.now?.videoId).toBe(id(100))
    expect(first.queue.length).toBeLessThan(19)

    gb.send({ op: 'music_add_many', channelId: ch, videoIds: ids(200, 203), replace: true, label: 'Outra' })
    const swapped = (await ga.waitFor('MUSIC_STATE', (d) => (d as MusicState).last?.title === 'Outra' && (d as MusicState).last?.count === 3)) as MusicState
    expect(swapped.now?.videoId).toBe(id(200))
    expect(swapped.queue.map((t) => t.videoId)).toEqual(ids(201, 203))

    // Only unplayable songs: an error to the sender, nothing changes for the call.
    ga.send({ op: 'music_add_many', channelId: ch, videoIds: ['GONE0000002'], replace: true, label: 'Nada' })
    const err = (await ga.waitFor('MUSIC_ERROR', (d) => (d as { op: string }).op === 'music_add_many')) as { reason: string }
    expect(err.reason).toBe('unavailable')
    expect(states(gb).at(-1)!.now?.videoId).toBe(id(200))
    // "Voltar": right at the start of a song, the one before plays and this one comes next; deeper in, it restarts.
    const music = s.app.ctx.music as unknown as { calls: Map<string, { playback: { position: number; at: number } }> }
    gb.send({ op: 'music_control', channelId: ch, action: 'skip' })
    const skipped = (await ga.waitFor('MUSIC_STATE', (d) => (d as MusicState).now?.videoId === id(201))) as MusicState
    expect(skipped.previous).toBe(1)
    ga.send({ op: 'music_control', channelId: ch, action: 'previous' })
    const back = (await gb.waitFor('MUSIC_STATE', (d) => (d as MusicState).last?.kind === 'previous')) as MusicState
    expect(back.now?.videoId).toBe(id(200))
    expect(back.now?.id).not.toBe(swapped.now?.id) // a fresh place: every player loads it again
    expect(back.queue.map((t) => t.videoId)).toEqual([id(201), id(202)])
    expect(back.previous).toBe(0)
    music.calls.get(ch)!.playback.position = 40
    const seq = back.playback.seq
    gb.send({ op: 'music_control', channelId: ch, action: 'previous' })
    const restarted = (await ga.waitFor('MUSIC_STATE', (d) => (d as MusicState).playback.seq > seq)) as MusicState
    expect(restarted.now?.videoId).toBe(id(200))
    expect(restarted.playback.position).toBe(0)
    for (const g of [ga, gb]) g.close()
  })
})
