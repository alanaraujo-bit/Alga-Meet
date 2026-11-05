import {
  CINEMA_FRAME_LIMIT, CINEMA_LEAD_MS, GatewayClose, positionAt,
  type CinemaFilm, type CinemaSessionView, type Invite, type SpaceSnapshot,
} from '@alga/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { roles } from '../src/db/schema.js'
import { api, connect, postWebhook, register, startServer, type Gateway, type TestServer } from './helpers.js'

let s: TestServer
beforeAll(async () => { s = await startServer() })
afterAll(async () => { await s.close() })

const film: CinemaFilm = {
  title: 'Filme', durationS: 600, width: 1920, height: 1080, hdr: 'sdr', videoCodec: 'h264', videoMime: 'video/mp4; codecs="avc1.640028"',
  bitrateKbps: 4000, audio: [], subtitles: [], chapters: [], episode: null,
}

let seq = 0
const event = (name: string, channelId: string, identity: string) => ({
  event: name, id: `EV_CN_${++seq}`, createdAt: String(Math.floor(Date.now() / 1000)),
  room: { sid: `RM_${channelId.slice(0, 8)}`, name: `ch_${channelId}` },
  participant: { sid: `PA_CN_${seq}`, identity, name: 'x', joinedAt: String(Math.floor(Date.now() / 1000)) },
})
const enter = (channelId: string, userId: string) => postWebhook(s.app, s.config, event('participant_joined', channelId, userId))
const leave = (channelId: string, userId: string) => postWebhook(s.app, s.config, event('participant_left', channelId, userId))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type State = CinemaSessionView
type Ctx = Awaited<ReturnType<typeof setup>>
const isState = (d: unknown): d is State => !!d && typeof d === 'object' && 'playback' in d
const states = (gw: Gateway) => gw.events.filter((e) => e.t === 'CINEMA_STATE').map((e) => e.d).filter(isState)
const last = (gw: Gateway): State => states(gw).at(-1)!
const wait = (gw: Gateway, pred: (d: State) => boolean) => gw.waitFor('CINEMA_STATE', (d) => isState(d) && pred(d)) as Promise<State>

/** Space with a voice channel; a (host), b and c are in the call and connected; d is a member outside the call. */
async function setup() {
  const [a, b, c, d] = [await register(s.app), await register(s.app), await register(s.app), await register(s.app)]
  const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: a.token, body: { name: 'Cinema' } })).body
  const inv = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: a.token, body: {} })).body
  for (const u of [b, c, d]) await api(s.app, 'POST', `/invites/${inv.code}`, { token: u.token })
  const voice = space.channels.find((x) => x.type === 'voice')!
  for (const u of [a, b, c]) await enter(voice.id, u.user.id)
  const [ga, gb, gc, gd] = await Promise.all([a, b, c, d].map((u) => connect(s.port, u.token)))
  return { a, b, c, d, invite: inv.code, ga: ga!, gb: gb!, gc: gc!, gd: gd!, space, voice }
}
async function open(x: Ctx): Promise<State> {
  x.ga.send({ op: 'cinema_open', channelId: x.voice.id, film, startS: 0 })
  return wait(x.ga, () => true)
}
async function seat(gw: Gateway, sessionId: string, userId: string) {
  gw.send({ op: 'cinema_seat', sessionId, seated: true })
  await wait(gw, (d) => d.seats.some((e) => e.userId === userId))
}
const status = (gw: Gateway, sessionId: string, st: string, aheadS = 20) => gw.send({ op: 'cinema_status', sessionId, status: st, aheadS })
const control = (gw: Gateway, sessionId: string, action: string, seqNo: number, extra: object = {}) =>
  gw.send({ op: 'cinema_control', sessionId, action, seq: seqNo, ...extra })

/** Opens, seats b, starts and gets both ready: a playing session. */
async function playing(x: Ctx) {
  const st = await open(x)
  await seat(x.gb, st.sessionId, x.b.user.id)
  control(x.ga, st.sessionId, 'start', 0, { position: 0 })
  await wait(x.ga, (d) => d.playback.reason === 'buffering')
  status(x.ga, st.sessionId, 'ready'); status(x.gb, st.sessionId, 'ready')
  const p = await wait(x.ga, (d) => d.playback.playing)
  return { id: st.sessionId, p }
}

describe('cinema', () => {
  it('cinema_time answers CINEMA_PONG with the client clock and a server clock in between', async () => {
    const { ga } = await setup()
    const t0 = Date.now()
    ga.send({ op: 'cinema_time', c: 12345 })
    const pong = await ga.waitFor('CINEMA_PONG')
    expect(pong.c).toBe(12345)
    expect(pong.s).toBeGreaterThanOrEqual(t0)
    expect(pong.s).toBeLessThanOrEqual(Date.now())
  })

  it('open errors: not_in_call, forbidden, exists, disabled', async () => {
    const x = await setup()
    x.gd.send({ op: 'cinema_open', channelId: x.voice.id, film, startS: 0 })
    expect(await x.gd.waitFor('CINEMA_ERROR')).toMatchObject({ op: 'cinema_open', reason: 'not_in_call' })

    // The space loses STREAM for everyone but its owner (b is a plain member).
    await s.app.ctx.db.update(roles).set({ permissions: 0 }).where(eq(roles.spaceId, x.space.id))
    x.gb.send({ op: 'cinema_open', channelId: x.voice.id, film, startS: 0 })
    expect(await x.gb.waitFor('CINEMA_ERROR')).toMatchObject({ reason: 'forbidden' })

    const y = await setup()
    await open(y)
    y.gc.send({ op: 'cinema_open', channelId: y.voice.id, film, startS: 0 })
    expect(await y.gc.waitFor('CINEMA_ERROR')).toMatchObject({ reason: 'exists' })

    const off = await startServer({ CINEMA: 'false' })
    try {
      const g = await connect(off.port, (await register(off.app)).token)
      g.send({ op: 'cinema_open', channelId: y.voice.id, film, startS: 0 })
      expect(await g.waitFor('CINEMA_ERROR')).toMatchObject({ reason: 'disabled' })
    } finally { await off.close() }
  })

  it('open: foyer state to everyone in the call, host seated, nobody else', async () => {
    const x = await setup()
    const st = await open(x)
    expect(st).toMatchObject({ channelId: x.voice.id, hostId: x.a.user.id, playback: { playing: false, reason: 'foyer', seq: 0 } })
    expect(st.seats.map((e) => e.userId)).toEqual([x.a.user.id])
    await wait(x.gb, () => true)
    await wait(x.gc, () => true)
    await x.gd.expectNone('CINEMA_STATE')
  })

  it('the ninth seat is refused with full', async () => {
    const x = await setup()
    const st = await open(x)
    await seat(x.gb, st.sessionId, x.b.user.id)
    for (let i = 0; i < 6; i++) {
      const u = await register(s.app)
      await api(s.app, 'POST', `/invites/${x.invite}`, { token: u.token })
      await enter(x.voice.id, u.user.id)
      await seat(await connect(s.port, u.token), st.sessionId, u.user.id)
    }
    expect(last(x.ga).seats).toHaveLength(8)
    x.gc.send({ op: 'cinema_seat', sessionId: st.sessionId, seated: true })
    expect(await x.gc.waitFor('CINEMA_ERROR')).toMatchObject({ reason: 'full', sessionId: st.sessionId })
  })

  it('start buffers until both are ready, then plays LEAD ahead', async () => {
    const x = await setup()
    const st = await open(x)
    await seat(x.gb, st.sessionId, x.b.user.id)
    control(x.ga, st.sessionId, 'start', 0, { position: 5 })
    const buf = await wait(x.gb, (d) => d.playback.reason === 'buffering')
    expect(buf.playback).toMatchObject({ playing: false, position: 5, seq: 1 })
    status(x.ga, st.sessionId, 'ready')
    await sleep(150)
    expect(last(x.gb).playback.playing).toBe(false)
    status(x.gb, st.sessionId, 'ready')
    const p = await wait(x.gb, (d) => d.playback.playing)
    const dt = p.playback.at - Date.now()
    expect(dt).toBeGreaterThan(0)
    expect(dt).toBeLessThanOrEqual(CINEMA_LEAD_MS + 50)
  })

  it('start plays after the ready timeout when someone never gets ready', async () => {
    const x = await setup()
    s.app.ctx.cinema.timings.readyTimeoutMs = 300
    try {
      const st = await open(x)
      await seat(x.gb, st.sessionId, x.b.user.id)
      control(x.ga, st.sessionId, 'start', 0)
      status(x.ga, st.sessionId, 'ready')
      const t0 = Date.now()
      await wait(x.ga, (d) => d.playback.playing)
      expect(Date.now() - t0).toBeGreaterThanOrEqual(250)
    } finally { s.app.ctx.cinema.timings.readyTimeoutMs = 10_000 }
  })

  it('two pauses with the same seq: first applies, second is stale and gets the state', async () => {
    const x = await setup()
    const { id, p } = await playing(x)
    control(x.ga, id, 'pause', p.playback.seq)
    control(x.gb, id, 'pause', p.playback.seq)
    const paused = await wait(x.ga, (d) => !d.playback.playing && d.playback.seq === p.playback.seq + 1)
    expect(paused.playback.by).toBe(x.a.user.id)
    expect(await x.gb.waitFor('CINEMA_ERROR')).toMatchObject({ op: 'cinema_control', reason: 'stale', sessionId: id })
    await x.ga.expectNone('CINEMA_ERROR')
    expect(last(x.gb).playback.seq).toBe(p.playback.seq + 1)
    expect(last(x.ga).playback.seq).toBe(p.playback.seq + 1)
  })

  it('pause freezes at positionAt of the stamped instant', async () => {
    const x = await setup()
    const { id, p } = await playing(x)
    await sleep(400)
    control(x.ga, id, 'pause', p.playback.seq)
    const paused = await wait(x.ga, (d) => !d.playback.playing && d.playback.seq > p.playback.seq)
    expect(Math.abs(paused.playback.position - positionAt(p.playback, paused.playback.at, film.durationS))).toBeLessThan(0.001)
    expect(paused.playback.position).toBeGreaterThan(0.3)
  })

  it('play after a long pause counts down', async () => {
    const x = await setup()
    const { id, p } = await playing(x)
    s.app.ctx.cinema.timings.countdownAfterPauseMs = 100
    try {
      control(x.ga, id, 'pause', p.playback.seq)
      const paused = await wait(x.ga, (d) => !d.playback.playing && d.playback.seq > p.playback.seq)
      await sleep(450)
      control(x.ga, id, 'play', paused.playback.seq)
      const pl = await wait(x.ga, (d) => d.playback.playing && d.playback.seq > paused.playback.seq)
      expect(pl.playback.countdown).toBe(true)
      expect(pl.playback.at - Date.now()).toBeGreaterThan(2500)
      expect(pl.playback.at - Date.now()).toBeLessThanOrEqual(3050)
    } finally { s.app.ctx.cinema.timings.countdownAfterPauseMs = 15_000 }
  })

  it('stalled while playing waits for that seat; its ready resumes with a countdown', async () => {
    const x = await setup()
    const { id } = await playing(x)
    status(x.gb, id, 'stalled', 0)
    const w = await wait(x.ga, (d) => d.playback.reason === 'waiting')
    expect(w.playback).toMatchObject({ playing: false, waitingFor: [x.b.user.id] })
    status(x.gb, id, 'ready')
    const p = await wait(x.ga, (d) => d.playback.playing && d.playback.seq > w.playback.seq)
    expect(p.playback.countdown).toBe(true)
  })

  it('waitForStalled=false: stalled does not pause', async () => {
    const x = await setup()
    const { id } = await playing(x)
    x.ga.send({ op: 'cinema_options', sessionId: id, waitForStalled: false })
    await wait(x.ga, (d) => !d.options.waitForStalled)
    status(x.gb, id, 'stalled', 0)
    await wait(x.ga, (d) => d.seats.some((e) => e.status === 'stalled'))
    expect(last(x.ga).playback.playing).toBe(true)
  })

  it('continue_without resumes; a new stalled from that seat does not pause until it sends ready', async () => {
    const x = await setup()
    const { id } = await playing(x)
    status(x.gb, id, 'stalled', 0)
    const w = await wait(x.ga, (d) => d.playback.reason === 'waiting')
    control(x.ga, id, 'continue_without', w.playback.seq, { target: x.b.user.id })
    await wait(x.ga, (d) => d.playback.playing && d.playback.seq > w.playback.seq)
    status(x.gb, id, 'preparing', 0)
    status(x.gb, id, 'stalled', 0)
    await wait(x.ga, (d) => d.seats.some((e) => e.userId === x.b.user.id && e.status === 'stalled'))
    expect(last(x.ga).playback.playing).toBe(true)
  })

  it('status throttle applies only to repeats of the same status', async () => {
    const x = await setup()
    const st = await open(x)
    status(x.ga, st.sessionId, 'ready', 5)
    status(x.ga, st.sessionId, 'ready', 9)
    status(x.ga, st.sessionId, 'stalled', 9)
    await wait(x.ga, (d) => d.seats[0]!.status === 'stalled')
    expect(states(x.ga).some((d) => d.seats[0]!.aheadS === 5)).toBe(true)
    expect(states(x.ga).some((d) => d.seats[0]!.status === 'ready' && d.seats[0]!.aheadS === 9)).toBe(false)
  })

  it('controlLock: a non-host control is refused with locked', async () => {
    const x = await setup()
    const { id, p } = await playing(x)
    x.ga.send({ op: 'cinema_options', sessionId: id, controlLock: true })
    await wait(x.gb, (d) => d.options.controlLock)
    control(x.gb, id, 'pause', p.playback.seq)
    expect(await x.gb.waitFor('CINEMA_ERROR')).toMatchObject({ reason: 'locked' })
  })

  it('host leaves the call: host_away; back in time: paused by user; late: host_left', async () => {
    const x = await setup()
    const { id } = await playing(x)
    await leave(x.voice.id, x.a.user.id)
    const away = await wait(x.gb, (d) => d.playback.reason === 'host_away')
    expect(away.playback.playing).toBe(false)
    await sleep(1000)
    await enter(x.voice.id, x.a.user.id)
    x.ga.send({ op: 'cinema_hello' })
    const back = await wait(x.gb, (d) => d.playback.reason === 'user' && d.playback.seq > away.playback.seq)
    expect(back.playback.playing).toBe(false)
    expect(back.seats.map((e) => e.userId)).toContain(x.a.user.id)

    s.app.ctx.cinema.timings.hostAwayMs = 300
    try {
      await leave(x.voice.id, x.a.user.id)
      const gone = await x.gb.waitFor('CINEMA_STATE', (d) => 'ended' in d)
      expect(gone).toMatchObject({ reason: 'host_left', sessionId: id, ended: true })
    } finally { s.app.ctx.cinema.timings.hostAwayMs = 120_000 }
  })

  it('call_empty ends the session', async () => {
    const x = await setup()
    await open(x)
    await leave(x.voice.id, x.b.user.id)
    await leave(x.voice.id, x.c.user.id)
    await leave(x.voice.id, x.a.user.id)
    expect(s.app.ctx.cinema.sessionOf(x.voice.id)).toBeUndefined()
  })

  it('a new socket of b says hello: gets the state, stays seated, session dispatches go only to it', async () => {
    const x = await setup()
    const st = await open(x)
    await seat(x.gb, st.sessionId, x.b.user.id)
    x.gb.close()
    await x.gb.closed
    const gb2 = await connect(s.port, x.b.token)
    gb2.send({ op: 'cinema_hello' })
    const got = await wait(gb2, (d) => d.seats.some((e) => e.userId === x.b.user.id))
    expect(got.sessionId).toBe(st.sessionId)
    // Seated through the new socket: a stale control (seq below the current one) is answered there, not at the old one.
    control(x.ga, st.sessionId, 'pause', 0)
    await wait(gb2, (d) => d.playback.seq === 1)
    control(gb2, st.sessionId, 'pause', 0)
    expect(await gb2.waitFor('CINEMA_ERROR')).toMatchObject({ reason: 'stale' })
    expect(x.gb.events.some((e) => e.t === 'CINEMA_ERROR')).toBe(false)
  })

  it('cinema_* frames have their own quota of CINEMA_FRAME_LIMIT per 60 s', async () => {
    const { ga, gb } = await setup()
    for (let i = 0; i < CINEMA_FRAME_LIMIT; i++) gb.send({ op: 'cinema_time', c: i })
    for (let i = 0; i < 110; i++) gb.send({ op: 'heartbeat' }) // identify + 110 stay under the 120 general quota
    await gb.waitFor('CINEMA_PONG', (d) => d.c === CINEMA_FRAME_LIMIT - 1)
    await sleep(100)
    expect(gb.ws.readyState).toBe(gb.ws.OPEN)
    for (let i = 0; i <= CINEMA_FRAME_LIMIT; i++) ga.send({ op: 'cinema_time', c: i })
    expect((await ga.closed).code).toBe(GatewayClose.RATE_LIMITED)
  })
})
