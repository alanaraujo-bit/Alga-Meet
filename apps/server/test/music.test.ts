import { GatewayClose, MUSIC_LEAD_MS, type Invite, type MusicState, type SpaceSnapshot } from '@alga/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, connect, postWebhook, register, startServer, type Gateway, type TestServer } from './helpers.js'

let s: TestServer
beforeAll(async () => {
  s = await startServer()
  // No network in tests: the title comes from here. A few ids stand for YouTube's answers.
  s.app.ctx.music.meta = async (videoId) =>
    videoId === 'NOEMBED0000' ? 'not_embeddable' : videoId === 'GONE0000000' ? 'unavailable' : { title: `Song ${videoId}`, author: 'Artist' }
})
afterAll(async () => { await s.close() })

let seq = 0
const event = (name: string, channelId: string, identity: string) => ({
  event: name, id: `EV_MU_${++seq}`, createdAt: String(Math.floor(Date.now() / 1000)),
  room: { sid: `RM_${channelId.slice(0, 8)}`, name: `ch_${channelId}` },
  participant: { sid: `PA_MU_${seq}`, identity, name: 'x', joinedAt: String(Math.floor(Date.now() / 1000)) },
})
const enter = (channelId: string, userId: string) => postWebhook(s.app, s.config, event('participant_joined', channelId, userId))
const leave = (channelId: string, userId: string) => postWebhook(s.app, s.config, event('participant_left', channelId, userId))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const link = (id: string) => `https://youtu.be/${id}`
const A1 = 'aaaaaaaaaa1'
const A2 = 'aaaaaaaaaa2'
const A3 = 'aaaaaaaaaa3'

/** a and b in the call; c is a member outside it. */
async function setup() {
  const [a, b, c] = [await register(s.app), await register(s.app), await register(s.app)]
  const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: a.token, body: { name: 'Som' } })).body
  const inv = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: a.token, body: {} })).body
  for (const u of [b, c]) await api(s.app, 'POST', `/invites/${inv.code}`, { token: u.token })
  const voice = space.channels.find((x) => x.type === 'voice')!
  for (const u of [a, b]) await enter(voice.id, u.user.id)
  const [ga, gb, gc] = await Promise.all([a, b, c].map((u) => connect(s.port, u.token)))
  return { a, b, c, ga: ga!, gb: gb!, gc: gc!, voice }
}
const states = (gw: Gateway) => gw.events.filter((e) => e.t === 'MUSIC_STATE').map((e) => e.d as MusicState)
/** The next dispatch of type `t` matching `pred` that arrives AFTER this call (waitFor alone also matches old ones). */
function fresh(gw: Gateway, t: 'MUSIC_STATE' | 'MUSIC_ERROR', pred: (d: never) => boolean, timeoutMs?: number): Promise<unknown> {
  const from = gw.events.length
  return gw.waitFor(t, (d) => gw.events.findIndex((e) => e.d === d) >= from && pred(d as never), timeoutMs)
}
const next = (gw: Gateway, pred: (d: MusicState) => boolean, timeoutMs?: number) => fresh(gw, 'MUSIC_STATE', pred, timeoutMs) as Promise<MusicState>
const error = (gw: Gateway, op: string) => fresh(gw, 'MUSIC_ERROR', (d: { op: string }) => d.op === op) as Promise<{ op: string; reason: string }>

describe('music in a call', () => {
  it('a link starts playing for everyone in the call; what follows queues; only the call hears it', async () => {
    const x = await setup()
    const ch = x.voice.id
    // READY says the server has music (older ones close the socket on music_*).
    const ready = x.ga.events.find((e) => e.t === 'READY')!.d as { music?: boolean }
    expect(ready.music).toBe(true)

    const t0 = Date.now()
    x.ga.send({ op: 'music_add', channelId: ch, url: `https://www.youtube.com/watch?v=${A1}&t=10s` })
    const st = await next(x.gb, (d) => d.now !== null)
    expect(st.now).toMatchObject({ videoId: A1, title: `Song ${A1}`, author: 'Artist', addedBy: x.a.user.id, durationS: null })
    expect(st.playback).toMatchObject({ playing: true, position: 0 })
    expect(st.playback.at).toBeGreaterThanOrEqual(t0 + MUSIC_LEAD_MS - 50) // a moment for every app to load it
    expect(st.last).toMatchObject({ kind: 'add', by: x.a.user.id, title: `Song ${A1}` })
    expect(st.serverNow).toBeGreaterThan(0)

    x.gb.send({ op: 'music_add', channelId: ch, url: link(A2) })
    const q = await next(x.ga, (d) => d.queue.length === 1)
    expect(q.now?.videoId).toBe(A1)
    expect(q.queue[0]).toMatchObject({ videoId: A2, addedBy: x.b.user.id })
    await sleep(200)
    expect(states(x.gc)).toEqual([]) // c is not in the call

    // c cannot drive a call they are not in.
    x.gc.send({ op: 'music_add', channelId: ch, url: link(A3) })
    expect((await error(x.gc, 'music_add')).reason).toBe('not_in_call')
    x.gc.send({ op: 'music_hello', channelId: ch })
    expect((await error(x.gc, 'music_hello')).reason).toBe('not_in_call')
  })

  it('pause, play, seek and skip move the shared clock; a stale "ended" is ignored; the last one ending stops', async () => {
    const x = await setup()
    const ch = x.voice.id
    x.ga.send({ op: 'music_add', channelId: ch, url: link(A1) })
    const first = (await next(x.ga, (d) => d.now !== null)).now!
    x.ga.send({ op: 'music_add', channelId: ch, url: link(A2) })
    await next(x.ga, (d) => d.queue.length === 1)

    x.gb.send({ op: 'music_control', channelId: ch, action: 'pause' })
    const paused = await next(x.ga, (d) => !d.playback.playing)
    expect(paused.last).toMatchObject({ kind: 'pause', by: x.b.user.id })
    x.gb.send({ op: 'music_control', channelId: ch, action: 'seek', position: 42 })
    expect((await next(x.ga, (d) => d.playback.position === 42)).playback.playing).toBe(false)
    x.gb.send({ op: 'music_control', channelId: ch, action: 'play' })
    const playing = await next(x.ga, (d) => d.playback.playing)
    expect(playing.playback.position).toBe(42)

    x.ga.send({ op: 'music_control', channelId: ch, action: 'skip' })
    const skipped = await next(x.gb, (d) => d.now?.videoId === A2)
    expect(skipped).toMatchObject({ queue: [], last: { kind: 'skip', by: x.a.user.id, title: `Song ${A1}` } })
    expect(skipped.playback).toMatchObject({ playing: true, position: 0 })

    // Two apps report the end: the first moves on, the stale one (old track) does nothing.
    x.gb.send({ op: 'music_report', channelId: ch, trackId: first.id, kind: 'ended' })
    x.ga.send({ op: 'music_report', channelId: ch, trackId: skipped.now!.id, kind: 'ended' })
    x.gb.send({ op: 'music_report', channelId: ch, trackId: skipped.now!.id, kind: 'ended' })
    const done = await next(x.gb, (d) => d.now === null)
    expect(done.last).toMatchObject({ kind: 'ended' })
    await sleep(200)
    expect(states(x.gb).filter((d) => d.now === null)).toHaveLength(1)
  })

  it('remove and stop; duration from the first player; the server moves on by itself when nobody reports the end', async () => {
    const x = await setup()
    const ch = x.voice.id
    for (const id of [A1, A2, A3]) x.ga.send({ op: 'music_add', channelId: ch, url: link(id) })
    const full = await next(x.ga, (d) => d.queue.length === 2)
    x.gb.send({ op: 'music_remove', channelId: ch, trackId: full.queue[0]!.id })
    expect((await next(x.ga, (d) => d.queue.length === 1)).queue[0]!.videoId).toBe(A3)
    x.gb.send({ op: 'music_remove', channelId: ch, trackId: full.queue[0]!.id })
    expect((await error(x.gb, 'music_remove')).reason).toBe('not_found')

    // The first player to know the length tells it; a second report does not change it.
    x.gb.send({ op: 'music_report', channelId: ch, trackId: full.now!.id, kind: 'duration', durationS: 1 })
    x.ga.send({ op: 'music_report', channelId: ch, trackId: full.now!.id, kind: 'duration', durationS: 999 })
    expect((await next(x.ga, (d) => d.now?.durationS === 1)).now!.durationS).toBe(1)
    // Nobody reports the end (every app closed, ads...): the server moves on after the song and a grace.
    const moved = await next(x.ga, (d) => d.now?.videoId === A3, 8000)
    expect(moved.last).toMatchObject({ kind: 'ended' })

    x.gb.send({ op: 'music_control', channelId: ch, action: 'stop' })
    const stopped = await next(x.ga, (d) => d.now === null)
    expect(stopped).toMatchObject({ queue: [], last: { kind: 'stop', by: x.b.user.id } })
  })

  it('refuses what it cannot play, and floods; the queue has a limit; an unplayable song is skipped', async () => {
    const x = await setup()
    const ch = x.voice.id
    x.ga.send({ op: 'music_add', channelId: ch, url: 'https://vimeo.com/1' })
    expect((await error(x.ga, 'music_add')).reason).toBe('invalid_link')
    x.ga.send({ op: 'music_add', channelId: ch, url: link('NOEMBED0000') })
    expect((await error(x.ga, 'music_add')).reason).toBe('not_embeddable')
    x.ga.send({ op: 'music_add', channelId: ch, url: link('GONE0000000') })
    expect((await error(x.ga, 'music_add')).reason).toBe('unavailable')
    // those three used the bucket (5): two more pass, then slow_down
    x.ga.send({ op: 'music_add', channelId: ch, url: link(A1) })
    x.ga.send({ op: 'music_add', channelId: ch, url: link(A2) })
    x.ga.send({ op: 'music_add', channelId: ch, url: link(A3) })
    expect((await error(x.ga, 'music_add')).reason).toBe('slow_down')
    const st = await next(x.gb, (d) => d.queue.length === 1)
    expect(st.now?.videoId).toBe(A1)

    // A player says it cannot play this one outside YouTube: skipped for everyone, with the reason.
    x.gb.send({ op: 'music_report', channelId: ch, trackId: st.now!.id, kind: 'unplayable' })
    expect((await next(x.ga, (d) => d.now?.videoId === A2)).last).toMatchObject({ kind: 'unplayable', title: `Song ${A1}` })

    // The queue limit (b has a fresh bucket of its own; the limit is checked before the rate).
    const music = s.app.ctx.music as unknown as { calls: Map<string, { queue: unknown[] }> }
    music.calls.get(ch)!.queue.push(...Array.from({ length: 50 }, (_, i) => ({ id: `f${i}`, videoId: A3, title: 'x', author: null, durationS: null, addedBy: x.a.user.id })))
    x.gb.send({ op: 'music_add', channelId: ch, url: link(A3) })
    expect((await error(x.gb, 'music_add')).reason).toBe('queue_full')
  })

  it('a hello gets the state; the music ends when the call empties; bad frames close the socket', async () => {
    const x = await setup()
    const ch = x.voice.id
    x.ga.send({ op: 'music_add', channelId: ch, url: link(A1) })
    await next(x.gb, (d) => d.now !== null)
    const before = states(x.gb).length
    x.gb.send({ op: 'music_hello', channelId: ch })
    await x.gb.waitFor('MUSIC_STATE', () => states(x.gb).length > before)
    expect(states(x.gb).at(-1)!.now?.videoId).toBe(A1)

    await leave(ch, x.a.user.id)
    await leave(ch, x.b.user.id)
    await enter(ch, x.a.user.id)
    const n = states(x.ga).length
    x.ga.send({ op: 'music_hello', channelId: ch })
    await x.ga.waitFor('MUSIC_STATE', () => states(x.ga).length > n)
    expect(states(x.ga).at(-1)).toMatchObject({ now: null, queue: [] })

    x.ga.send({ op: 'music_control', channelId: ch, action: 'explode' })
    expect((await x.ga.closed).code).toBe(GatewayClose.INVALID_PAYLOAD)
  })
})
