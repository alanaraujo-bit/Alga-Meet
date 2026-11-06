import { createHmac } from 'node:crypto'
import {
  CINEMA_COUNTDOWN_AFTER_PAUSE_MS, CINEMA_FRAME_LIMIT, CINEMA_HOST_AWAY_MS, CINEMA_ITEMS_PER_FRAME, CINEMA_LEAD_MS,
  CINEMA_READY_TIMEOUT_MS, CINEMA_TURN_TTL_S, GatewayClose, Permission, positionAt,
  type CinemaFilm, type CinemaPieceMeta, type CinemaSessionView, type Invite, type SpaceSnapshot,
} from '@alga/shared'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { roles } from '../src/db/schema.js'
import { metrics } from '../src/metrics.js'
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
    } finally { s.app.ctx.cinema.timings.readyTimeoutMs = CINEMA_READY_TIMEOUT_MS }
  })

  it('two pauses with the same seq: first applies, second is stale and gets the state', async () => {
    const x = await setup()
    const { id, p } = await playing(x)
    // Same socket: frames are handled in order, so which one wins does not depend on arrival.
    control(x.ga, id, 'pause', p.playback.seq)
    control(x.ga, id, 'pause', p.playback.seq)
    const paused = await wait(x.ga, (d) => !d.playback.playing && d.playback.seq === p.playback.seq + 1)
    expect(paused.playback.by).toBe(x.a.user.id)
    expect(await x.ga.waitFor('CINEMA_ERROR')).toMatchObject({ op: 'cinema_control', reason: 'stale', sessionId: id })
    await sleep(100)
    expect(x.ga.events.filter((e) => e.t === 'CINEMA_ERROR')).toHaveLength(1)
    expect(last(x.ga).playback.seq).toBe(p.playback.seq + 1)
    expect(last(x.gb).playback.seq).toBe(p.playback.seq + 1)
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
    } finally { s.app.ctx.cinema.timings.countdownAfterPauseMs = CINEMA_COUNTDOWN_AFTER_PAUSE_MS }
  })

  it('stalled while playing waits for that seat; a short stall resumes without a countdown', async () => {
    const x = await setup()
    const { id } = await playing(x)
    status(x.gb, id, 'stalled', 0)
    const w = await wait(x.ga, (d) => d.playback.reason === 'waiting')
    expect(w.playback).toMatchObject({ playing: false, waitingFor: [x.b.user.id] })
    status(x.gb, id, 'ready')
    const p = await wait(x.ga, (d) => d.playback.playing && d.playback.seq > w.playback.seq)
    expect(p.playback.countdown).toBe(false)
  })

  it('stall waiting has no timeout; the ready after a long pause resumes with a countdown', async () => {
    const x = await setup()
    const { id } = await playing(x)
    const t = s.app.ctx.cinema.timings
    t.readyTimeoutMs = 150; t.countdownAfterPauseMs = 200
    try {
      status(x.gb, id, 'stalled', 0)
      const w = await wait(x.ga, (d) => d.playback.reason === 'waiting')
      await sleep(500)
      expect(last(x.ga).playback).toMatchObject({ playing: false, reason: 'waiting', seq: w.playback.seq })
      status(x.gb, id, 'ready')
      const p = await wait(x.ga, (d) => d.playback.playing && d.playback.seq > w.playback.seq)
      expect(p.playback.countdown).toBe(true)
    } finally { t.readyTimeoutMs = CINEMA_READY_TIMEOUT_MS; t.countdownAfterPauseMs = CINEMA_COUNTDOWN_AFTER_PAUSE_MS }
  })

  it('continue_without after a long pause also counts down; its target must be in waitingFor', async () => {
    const x = await setup()
    const { id } = await playing(x)
    const t = s.app.ctx.cinema.timings
    t.countdownAfterPauseMs = 100
    try {
      status(x.gb, id, 'stalled', 0)
      const w = await wait(x.ga, (d) => d.playback.reason === 'waiting')
      control(x.ga, id, 'continue_without', w.playback.seq, { target: x.c.user.id })
      expect(await x.ga.waitFor('CINEMA_ERROR', (d) => d.op === 'cinema_control')).toMatchObject({ reason: 'invalid' })
      await sleep(500)
      control(x.ga, id, 'continue_without', w.playback.seq, { target: x.b.user.id })
      const p = await wait(x.ga, (d) => d.playback.playing && d.playback.seq > w.playback.seq)
      expect(p.playback.countdown).toBe(true)
    } finally { t.countdownAfterPauseMs = CINEMA_COUNTDOWN_AFTER_PAUSE_MS }
  })

  it('play is invalid in the foyer and while the host is away', async () => {
    const x = await setup()
    const st = await open(x)
    await seat(x.gb, st.sessionId, x.b.user.id)
    control(x.gb, st.sessionId, 'play', 0)
    expect(await x.gb.waitFor('CINEMA_ERROR')).toMatchObject({ op: 'cinema_control', reason: 'invalid' })
    control(x.ga, st.sessionId, 'start', 0)
    status(x.ga, st.sessionId, 'ready'); status(x.gb, st.sessionId, 'ready')
    const p = await wait(x.gb, (d) => d.playback.playing)
    control(x.ga, st.sessionId, 'pause', p.playback.seq)
    await leave(x.voice.id, x.a.user.id)
    const away = await wait(x.gb, (d) => d.playback.reason === 'host_away')
    control(x.gb, st.sessionId, 'play', away.playback.seq)
    await sleep(200)
    expect(x.gb.events.filter((e) => e.t === 'CINEMA_ERROR' && (e.d as { reason: string }).reason === 'invalid')).toHaveLength(2)
    expect(last(x.gb).playback.playing).toBe(false)
  })

  it('every playback change bumps seq: a second staller joins waitingFor, a ready leaves it', async () => {
    const x = await setup()
    const st = await open(x)
    await seat(x.gb, st.sessionId, x.b.user.id)
    await seat(x.gc, st.sessionId, x.c.user.id)
    control(x.ga, st.sessionId, 'start', 0)
    await wait(x.ga, (d) => d.playback.reason === 'buffering')
    for (const g of [x.ga, x.gb, x.gc]) status(g, st.sessionId, 'ready')
    const p = await wait(x.ga, (d) => d.playback.playing)
    status(x.gb, st.sessionId, 'stalled', 0)
    const w1 = await wait(x.ga, (d) => d.playback.reason === 'waiting')
    status(x.gc, st.sessionId, 'stalled', 0)
    const w2 = await wait(x.ga, (d) => d.playback.waitingFor.length === 2)
    status(x.gb, st.sessionId, 'ready')
    const w3 = await wait(x.ga, (d) => d.playback.waitingFor.length === 1 && d.playback.waitingFor[0] === x.c.user.id)
    expect(w1.playback.seq).toBeGreaterThan(p.playback.seq)
    expect(w2.playback.seq).toBeGreaterThan(w1.playback.seq)
    expect(w3.playback.seq).toBeGreaterThan(w2.playback.seq)
    expect(w3.playback).toMatchObject({ playing: false, waitingFor: [x.c.user.id] })
  })

  it('the host is exempt from the seat cap when sitting again', async () => {
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
    x.ga.send({ op: 'cinema_seat', sessionId: st.sessionId, seated: false })
    await wait(x.gb, (d) => d.seats.length === 7)
    await seat(x.gc, st.sessionId, x.c.user.id)
    x.ga.send({ op: 'cinema_seat', sessionId: st.sessionId, seated: true })
    const back = await wait(x.ga, (d) => d.seats.length === 9)
    expect(back.seats.some((e) => e.userId === x.a.user.id)).toBe(true)
  })

  it('host_away entered from the foyer returns to the foyer', async () => {
    const x = await setup()
    const st = await open(x)
    await seat(x.gb, st.sessionId, x.b.user.id)
    x.ga.send({ op: 'cinema_seat', sessionId: st.sessionId, seated: false })
    const away = await wait(x.gb, (d) => !d.seats.some((e) => e.userId === x.a.user.id))
    expect(away.playback.reason).toBe('foyer')
    x.ga.send({ op: 'cinema_seat', sessionId: st.sessionId, seated: true })
    const back = await wait(x.gb, (d) => d.seats.some((e) => e.userId === x.a.user.id) && d.playback.seq > away.playback.seq)
    expect(back.playback).toMatchObject({ reason: 'foyer', playing: false })
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
    } finally { s.app.ctx.cinema.timings.hostAwayMs = CINEMA_HOST_AWAY_MS }
  })

  it('hello with no session in the caller call answers not_found (also after the session ended)', async () => {
    const x = await setup()
    x.gb.send({ op: 'cinema_hello' })
    expect(await x.gb.waitFor('CINEMA_ERROR')).toEqual({ op: 'cinema_hello', reason: 'not_found' })
    const st = await open(x)
    x.ga.send({ op: 'cinema_end', sessionId: st.sessionId })
    await x.gb.waitFor('CINEMA_STATE', (d) => 'ended' in d)
    x.gb.send({ op: 'cinema_hello' })
    expect(await x.gb.waitFor('CINEMA_ERROR')).toEqual({ op: 'cinema_hello', reason: 'not_found' })
  })

  it('call_empty ends the session', async () => {
    const x = await setup()
    await open(x)
    await leave(x.voice.id, x.b.user.id)
    await leave(x.voice.id, x.c.user.id)
    await leave(x.voice.id, x.a.user.id)
    expect(s.app.ctx.cinema.sessionOf(x.voice.id)).toBeUndefined()
  })

  it('a new socket of b says hello: gets the state, stays seated, seat dispatches go only to it', async () => {
    const x = await setup()
    const st = await open(x)
    await seat(x.gb, st.sessionId, x.b.user.id)
    const gb2 = await connect(s.port, x.b.token)
    gb2.send({ op: 'cinema_hello' })
    const got = await wait(gb2, (d) => d.seats.some((e) => e.userId === x.b.user.id))
    expect(got.sessionId).toBe(st.sessionId)
    // The old socket stays open: a seat-scoped dispatch must reach the new one only.
    x.ga.send({ op: 'cinema_signal', sessionId: st.sessionId, to: x.b.user.id, signal: { kind: 'ice', candidates: ['c1'] } })
    expect(await gb2.waitFor('CINEMA_SIGNAL')).toMatchObject({ from: x.a.user.id })
    await x.gb.expectNone('CINEMA_SIGNAL')
    // A stale control is answered at the socket that sent it.
    control(x.ga, st.sessionId, 'pause', 0)
    await wait(gb2, (d) => d.playback.seq === 1)
    control(gb2, st.sessionId, 'pause', 0)
    expect(await gb2.waitFor('CINEMA_ERROR')).toMatchObject({ reason: 'stale' })
    expect(x.gb.ws.readyState).toBe(x.gb.ws.OPEN)
  })

  it('a seat without a socket gets seat dispatches on every socket of the user', async () => {
    const x = await setup()
    const st = await open(x)
    await seat(x.gb, st.sessionId, x.b.user.id)
    const gb2 = await connect(s.port, x.b.token) // never says hello
    x.gb.close()
    await x.gb.closed
    await sleep(100) // let the server see the close
    x.ga.send({ op: 'cinema_signal', sessionId: st.sessionId, to: x.b.user.id, signal: { kind: 'ice', candidates: ['c1'] } })
    expect(await gb2.waitFor('CINEMA_SIGNAL')).toMatchObject({ from: x.a.user.id })
  })

  it('the host losing every socket sends the room to host_away', async () => {
    const x = await setup()
    await playing(x)
    x.ga.close()
    await x.ga.closed
    const away = await wait(x.gb, (d) => d.playback.reason === 'host_away')
    expect(away.playback.playing).toBe(false)
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

  // ---- signaling, pieces, film, reactions, end, summary, TURN ----------------------------------------------------------

  const sig = { kind: 'ice' as const, candidates: ['c1'] }
  const block = (by: Ctx['a'], target: Ctx['a']) => api(s.app, 'PUT', `/relationships/${target.user.id}`, { token: by.token, body: { type: 'blocked' } })

  it('signal goes only to the seat of `to`; unseated and blocked pairs are forbidden; direct is per recipient', async () => {
    const x = await setup()
    const st = await open(x)
    await seat(x.gb, st.sessionId, x.b.user.id)
    x.ga.send({ op: 'cinema_signal', sessionId: st.sessionId, to: x.b.user.id, signal: sig })
    expect(await x.gb.waitFor('CINEMA_SIGNAL')).toEqual({ sessionId: st.sessionId, from: x.a.user.id, signal: sig })
    await x.gc.expectNone('CINEMA_SIGNAL')
    await x.ga.expectNone('CINEMA_SIGNAL')

    x.ga.send({ op: 'cinema_signal', sessionId: st.sessionId, to: x.c.user.id, signal: sig }) // c is not seated
    expect(await x.ga.waitFor('CINEMA_ERROR')).toMatchObject({ op: 'cinema_signal', reason: 'forbidden' })

    expect((await block(x.a, x.c)).status).toBe(200)
    await seat(x.gc, st.sessionId, x.c.user.id)
    const direct = (g: Gateway, u: string) => last(g).seats.find((e) => e.userId === u)!.direct
    expect(direct(x.ga, x.c.user.id)).toBe(false)
    expect(direct(x.gc, x.a.user.id)).toBe(false)
    expect(direct(x.gb, x.c.user.id)).toBe(true) // a third party still connects to both
    expect(direct(x.gb, x.a.user.id)).toBe(true)
    x.ga.send({ op: 'cinema_signal', sessionId: st.sessionId, to: x.c.user.id, signal: sig })
    await wait(x.ga, () => true)
    await sleep(150)
    expect(x.ga.events.filter((e) => e.t === 'CINEMA_ERROR' && (e.d as { reason: string }).reason === 'forbidden')).toHaveLength(2)
    await x.gc.expectNone('CINEMA_SIGNAL')
  })

  it('iceServers: STUN plus TURN REST credentials, only for seated recipients', async () => {
    const x = await setup()
    const c = s.app.ctx.config.cinema
    const saved = { ...c }
    Object.assign(c, { stunUrls: ['stun:s:3478'], turnUrls: ['turn:x:3479'], turnSecret: 's' })
    try {
      const st = await open(x)
      await seat(x.gb, st.sessionId, x.b.user.id)
      const mine = await wait(x.gb, (d) => d.seats.length === 2)
      expect(mine.iceServers).toHaveLength(2)
      expect(mine.iceServers[0]).toEqual({ urls: ['stun:s:3478'] })
      const turn = mine.iceServers[1]!
      expect(turn.urls).toEqual(['turn:x:3479'])
      expect(turn.username).toMatch(new RegExp(`^\\d+:${x.b.user.id}$`))
      const expiry = Number(turn.username!.split(':')[0])
      expect(Math.abs(expiry - (Date.now() / 1000 + CINEMA_TURN_TTL_S))).toBeLessThan(5)
      expect(turn.credential).toBe(createHmac('sha1', 's').update(turn.username!).digest('base64'))
      expect(last(x.gc).iceServers).toEqual([]) // c is in the call but not seated
    } finally { Object.assign(c, saved) }
    const st2 = await open(await setup())
    expect(st2.iceServers).toEqual([]) // no secret, no stun configured here
  })

  const hash = (c: string) => c.repeat(64)
  const piece = (n: number, c = 'a'): CinemaPieceMeta => [n === 0 ? -1 : n * 4, n === 0 ? 0 : 4, 1000 + n, hash(c)]
  const run = (from: number, len: number, c = 'a') => Array.from({ length: len }, (_, i) => piece(from + i, c))
  const pieceFrames = (g: Gateway) => g.events.filter((e) => e.t === 'CINEMA_PIECES').map((e) => e.d as { track: string; from: number; items: CinemaPieceMeta[] })

  it('pieces: host appends contiguous runs, seats get them, a gap is invalid, others are forbidden, late joiners get the index first', async () => {
    const x = await setup()
    const st = await open(x)
    await seat(x.gb, st.sessionId, x.b.user.id)
    const N = CINEMA_ITEMS_PER_FRAME
    x.ga.send({ op: 'cinema_pieces', sessionId: st.sessionId, track: 'v', from: 0, items: run(0, N) })
    x.ga.send({ op: 'cinema_pieces', sessionId: st.sessionId, track: 'v', from: N, items: run(N, N) })
    await x.gb.waitFor('CINEMA_PIECES', (d) => d.from === N)
    expect(pieceFrames(x.gb).map((f) => [f.track, f.from, f.items.length])).toEqual([['v', 0, N], ['v', N, N]])
    expect(pieceFrames(x.ga)).toHaveLength(0) // not echoed to the sender

    x.ga.send({ op: 'cinema_pieces', sessionId: st.sessionId, track: 'v', from: 2 * N + 1, items: run(2 * N + 1, 1) })
    expect(await x.ga.waitFor('CINEMA_ERROR')).toMatchObject({ op: 'cinema_pieces', reason: 'invalid' })
    x.gb.send({ op: 'cinema_pieces', sessionId: st.sessionId, track: 'v', from: 2 * N, items: run(2 * N, 1) })
    expect(await x.gb.waitFor('CINEMA_ERROR')).toMatchObject({ op: 'cinema_pieces', reason: 'forbidden' })

    // Regeneration: from <= length overwrites (a new hash for n = 5).
    x.ga.send({ op: 'cinema_pieces', sessionId: st.sessionId, track: 'v', from: 5, items: [piece(5, 'b')] })
    await x.gb.waitFor('CINEMA_PIECES', (d) => d.from === 5)

    await seat(x.gc, st.sessionId, x.c.user.id)
    const frames = pieceFrames(x.gc)
    expect(frames.map((f) => [f.track, f.from, f.items.length])).toEqual([['v', 0, N], ['v', N, N]])
    expect(frames[0]!.items[5]![3]).toBe(hash('b'))
    const iPieces = x.gc.events.findIndex((e) => e.t === 'CINEMA_PIECES')
    const iState = x.gc.events.findIndex((e) => e.t === 'CINEMA_STATE' && isState(e.d) && e.d.seats.some((q) => q.userId === x.c.user.id))
    expect(iPieces).toBeGreaterThanOrEqual(0)
    expect(iPieces).toBeLessThan(iState)
  })

  it('film: title is cleaned of controls, empty or missing edits are invalid, addSubtitle is external, host only', async () => {
    const x = await setup()
    const st = await open(x)
    await seat(x.gb, st.sessionId, x.b.user.id)
    x.ga.send({ op: 'cinema_film', sessionId: st.sessionId, title: '  <b>Duna</b>\u0007 ' })
    const f = await wait(x.gb, (d) => d.film.title === '<b>Duna</b>')
    expect(f.film.title).toBe('<b>Duna</b>')
    x.ga.send({ op: 'cinema_film', sessionId: st.sessionId, title: '\u0007 \u0008' })
    expect(await x.ga.waitFor('CINEMA_ERROR')).toMatchObject({ op: 'cinema_film', reason: 'invalid' })
    x.ga.send({ op: 'cinema_film', sessionId: st.sessionId })
    await sleep(150)
    expect(x.ga.events.filter((e) => e.t === 'CINEMA_ERROR')).toHaveLength(2)
    x.ga.send({ op: 'cinema_film', sessionId: st.sessionId, addSubtitle: { id: 7, lang: 'pt', title: null, format: 'vtt', external: false } })
    const g = await wait(x.gb, (d) => d.film.subtitles.length === 1)
    expect(g.film.subtitles[0]).toMatchObject({ id: 7, external: true })
    expect(g.film.title).toBe('<b>Duna</b>')
    x.gb.send({ op: 'cinema_film', sessionId: st.sessionId, title: 'Outro' })
    expect(await x.gb.waitFor('CINEMA_ERROR')).toMatchObject({ op: 'cinema_film', reason: 'forbidden' })
  })

  it('reactions: a seated user is limited to a burst of 5; an emoji outside the list closes the socket', async () => {
    const x = await setup()
    const st = await open(x)
    await seat(x.gb, st.sessionId, x.b.user.id)
    for (let i = 0; i < 8; i++) x.gb.send({ op: 'cinema_react', sessionId: st.sessionId, emoji: '🔥' })
    await sleep(400)
    const got = x.ga.events.filter((e) => e.t === 'CINEMA_REACTION')
    expect(got).toHaveLength(5)
    expect(got[0]!.d).toMatchObject({ sessionId: st.sessionId, userId: x.b.user.id, emoji: '🔥', position: 0 })
    expect(x.gb.events.filter((e) => e.t === 'CINEMA_REACTION')).toHaveLength(5) // the reactor sees them too
    x.gc.send({ op: 'cinema_react', sessionId: st.sessionId, emoji: '🔥' }) // c is not seated
    expect(await x.gc.waitFor('CINEMA_ERROR')).toMatchObject({ op: 'cinema_react', reason: 'not_seated' })
    x.gb.send({ op: 'cinema_react', sessionId: st.sessionId, emoji: '💩' })
    expect((await x.gb.closed).code).toBe(GatewayClose.INVALID_PAYLOAD)
  })

  it('end: a plain member is forbidden, a moderator ends as moderator, the host as host_ended', async () => {
    const x = await setup()
    // b hosts; a (the space owner) moderates; c is a plain member.
    x.gb.send({ op: 'cinema_open', channelId: x.voice.id, film, startS: 0 })
    const st = await wait(x.gb, () => true)
    const before = metrics.cinemaEnded.get({ reason: 'moderator' })
    x.gc.send({ op: 'cinema_end', sessionId: st.sessionId })
    expect(await x.gc.waitFor('CINEMA_ERROR')).toMatchObject({ op: 'cinema_end', reason: 'forbidden' })
    expect(s.app.ctx.cinema.sessionOf(x.voice.id)).toBeDefined()
    x.ga.send({ op: 'cinema_end', sessionId: st.sessionId })
    const ended = await x.gc.waitFor('CINEMA_STATE', (d) => 'ended' in d)
    expect(ended).toMatchObject({ ended: true, reason: 'moderator', sessionId: st.sessionId })
    expect(metrics.cinemaEnded.get({ reason: 'moderator' })).toBe(before + 1)

    const y = await setup()
    const st2 = await open(y)
    y.ga.send({ op: 'cinema_end', sessionId: st2.sessionId })
    expect(await y.gb.waitFor('CINEMA_STATE', (d) => 'ended' in d)).toMatchObject({ reason: 'host_ended' })
  })

  it('open cleans every free-text field of the film; a title empty after cleaning is invalid and opens nothing', async () => {
    const x = await setup()
    const dirty: CinemaFilm = {
      ...film, title: '  Duna\u0007  ',
      audio: [{ id: 1, lang: ' pt\u0007 ', title: '\u0007 ', sourceCodec: 'aac', channels: 2, out: 'copy', mime: 'audio/mp4', default: true }],
      subtitles: [{ id: 2, lang: null, title: ' \u0008Legenda ', format: 'vtt', external: false }],
      chapters: [{ startS: 0, title: '\u0007' }, { startS: 5, title: ' Fim\u0007 ' }],
    }
    x.ga.send({ op: 'cinema_open', channelId: x.voice.id, film: dirty, startS: 0 })
    const st = await wait(x.ga, () => true)
    expect(st.film.title).toBe('Duna')
    expect(st.film.audio[0]).toMatchObject({ lang: 'pt', title: null })
    expect(st.film.subtitles[0]).toMatchObject({ lang: null, title: 'Legenda' })
    expect(st.film.chapters.map((c) => c.title)).toEqual(['', 'Fim'])

    const y = await setup()
    y.ga.send({ op: 'cinema_open', channelId: y.voice.id, film: { ...film, title: '\u0007\u0008' }, startS: 0 })
    expect(await y.ga.waitFor('CINEMA_ERROR')).toMatchObject({ op: 'cinema_open', reason: 'invalid' })
    await sleep(150)
    expect(y.ga.events.some((e) => e.t === 'CINEMA_STATE')).toBe(false)
    expect(s.app.ctx.cinema.sessionOf(y.voice.id)).toBeUndefined()
  })

  it('film addSubtitle cleans title and lang', async () => {
    const x = await setup()
    const st = await open(x)
    x.ga.send({ op: 'cinema_film', sessionId: st.sessionId, addSubtitle: { id: 3, lang: '\u0007', title: ' Ext\u0008 ', format: 'ass', external: true } })
    const g = await wait(x.ga, (d) => d.film.subtitles.length === 1)
    expect(g.film.subtitles[0]).toMatchObject({ id: 3, lang: null, title: 'Ext' })
  })

  it('stored piece items are capped per session across tracks', async () => {
    const x = await setup()
    const st = await open(x)
    await seat(x.gb, st.sessionId, x.b.user.id)
    // Frames are limited per socket (and 20,000 items per track): three sockets for the host, one track each.
    const socks = [x.ga, (await connect(s.port, x.a.token))!, (await connect(s.port, x.a.token))!]
    const tracks = ['v', 'a1', 'a2'] as const
    const N = CINEMA_ITEMS_PER_FRAME
    const frames = 138 // 3 tracks x 138 x 120 = 49,680 items
    for (let i = 0; i < frames; i++) {
      socks.forEach((g, k) => g.send({ op: 'cinema_pieces', sessionId: st.sessionId, track: tracks[k], from: i * N, items: run(i * N, N) }))
      if (i % 10 === 9) await sleep(15) // the gateway drops a socket whose write buffer passes 1 MiB: let the reader drain
    }
    for (const tr of tracks) await x.gb.waitFor('CINEMA_PIECES', (d) => d.track === tr && d.from === (frames - 1) * N, 10_000)
    // 49,680 stored; two more full frames reach 49,920, the next would pass 50,000.
    for (const k of [0, 1]) x.ga.send({ op: 'cinema_pieces', sessionId: st.sessionId, track: 'v', from: (frames + k) * N, items: run((frames + k) * N, N) })
    await x.gb.waitFor('CINEMA_PIECES', (d) => d.track === 'v' && d.from === (frames + 1) * N)
    x.ga.send({ op: 'cinema_pieces', sessionId: st.sessionId, track: 'v', from: (frames + 2) * N, items: run((frames + 2) * N, N) })
    expect(await x.ga.waitFor('CINEMA_ERROR')).toMatchObject({ op: 'cinema_pieces', reason: 'invalid' })
    // Nothing was stored by the refused frame: exactly 80 more still fit.
    x.ga.send({ op: 'cinema_pieces', sessionId: st.sessionId, track: 'v', from: (frames + 2) * N, items: run((frames + 2) * N, 80) })
    await x.gb.waitFor('CINEMA_PIECES', (d) => d.track === 'v' && d.items.length === 80)
    await sleep(100)
    expect(x.ga.events.filter((e) => e.t === 'CINEMA_ERROR')).toHaveLength(1)
  })

  it('a member holding only MOVE_MEMBERS can end the session as moderator', async () => {
    const x = await setup()
    x.gb.send({ op: 'cinema_open', channelId: x.voice.id, film, startS: 0 })
    const st = await wait(x.gb, () => true)
    await s.app.ctx.db.update(roles).set({ permissions: Permission.MOVE_MEMBERS }).where(eq(roles.spaceId, x.space.id))
    x.gc.send({ op: 'cinema_end', sessionId: st.sessionId })
    expect(await x.gb.waitFor('CINEMA_STATE', (d) => 'ended' in d)).toMatchObject({ ended: true, reason: 'moderator' })
  })

  it('deleting the channel ends the session as channel_gone', async () => {
    const x = await setup()
    await open(x)
    expect((await api(s.app, 'DELETE', `/channels/${x.voice.id}`, { token: x.a.token })).status).toBe(204)
    expect(await x.gb.waitFor('CINEMA_STATE', (d) => 'ended' in d)).toMatchObject({ ended: true, reason: 'channel_gone' })
    expect(s.app.ctx.cinema.sessionOf(x.voice.id)).toBeUndefined()
  })

  describe('switch', () => {
    it('only a seated host, only an existing session, and the title is cleaned like in open; a 24 h film has 8,640 heat slots', async () => {
      const x = await setup()
      x.ga.send({ op: 'cinema_open', channelId: x.voice.id, film: { ...film, durationS: 86_400 }, startS: 0 })
      const st = await wait(x.ga, () => true)
      expect(st.heat).toHaveLength(8_640)
      await seat(x.gb, st.sessionId, x.b.user.id)
      x.gb.send({ op: 'cinema_switch', sessionId: st.sessionId, film, startS: 0 })
      expect(await x.gb.waitFor('CINEMA_ERROR')).toMatchObject({ op: 'cinema_switch', reason: 'forbidden' })
      x.ga.send({ op: 'cinema_switch', sessionId: '0198b3f0-0000-7000-8000-000000000000', film, startS: 0 })
      expect(await x.ga.waitFor('CINEMA_ERROR')).toMatchObject({ op: 'cinema_switch', reason: 'not_found' })
      x.ga.send({ op: 'cinema_switch', sessionId: st.sessionId, film: { ...film, title: '\u0007 ' }, startS: 0 })
      expect(await x.ga.waitFor('CINEMA_ERROR', (d) => d.reason === 'invalid')).toMatchObject({ op: 'cinema_switch' })
      x.ga.send({ op: 'cinema_switch', sessionId: st.sessionId, film: { ...film, title: ' <b>Ep 2</b>\u0007' }, startS: 0 })
      expect((await wait(x.gb, (d) => d.film.title === '<b>Ep 2</b>')).film.title).toBe('<b>Ep 2</b>')
      // A host who left their seat cannot switch (it would overwrite host_away).
      x.ga.send({ op: 'cinema_seat', sessionId: st.sessionId, seated: false })
      await wait(x.gb, (d) => !d.seats.some((e) => e.userId === x.a.user.id))
      x.ga.send({ op: 'cinema_switch', sessionId: st.sessionId, film: { ...film, title: 'Ep 3' }, startS: 0 })
      expect(await x.ga.waitFor('CINEMA_ERROR', (d) => d.reason === 'not_seated')).toMatchObject({ op: 'cinema_switch' })
      expect(last(x.gb).film.title).toBe('<b>Ep 2</b>')
    })

    it('keeps the seats, wipes pieces and heat, and rebuffers at startS (clamped) with everyone preparing', async () => {
      const x = await setup()
      const { id, p } = await playing(x)
      await seat(x.gc, id, x.c.user.id)
      x.ga.send({ op: 'cinema_pieces', sessionId: id, track: 'v', from: 0, items: [piece(0), piece(1)] })
      await x.gb.waitFor('CINEMA_PIECES')
      expect(p.heat).toEqual(Array(60).fill(0)) // one slot per 10 s of film
      // Reactions land in the bucket of their position (frozen at 0 s here, then at 25 s after a seek).
      x.gb.send({ op: 'cinema_react', sessionId: id, emoji: '😂' })
      await x.ga.waitFor('CINEMA_REACTION')
      x.ga.send({ op: 'cinema_hello' })
      const h0 = await wait(x.ga, (d) => d.heat[0] === 1)
      control(x.ga, id, 'seek', h0.playback.seq, { position: 25 })
      await wait(x.ga, (d) => d.playback.position === 25)
      x.gb.send({ op: 'cinema_react', sessionId: id, emoji: '😂' })
      await x.ga.waitFor('CINEMA_REACTION', () => x.ga.events.filter((e) => e.t === 'CINEMA_REACTION').length === 2)
      x.ga.send({ op: 'cinema_hello' })
      expect((await wait(x.ga, (d) => d.heat[2] === 1)).heat.slice(0, 3)).toEqual([1, 0, 1])
      const seqBefore = last(x.ga).playback.seq
      const next = { ...film, title: 'Ep 2', durationS: 100 }
      x.ga.send({ op: 'cinema_switch', sessionId: id, film: next, startS: 5000 })
      const sw = await wait(x.gb, (d) => d.film.title === 'Ep 2')
      expect(sw.playback).toMatchObject({ playing: false, position: 100, reason: 'buffering', seq: seqBefore + 1, waitingFor: [], countdown: false, by: x.a.user.id })
      expect(sw.seats.map((e) => [e.userId, e.status]).sort()).toEqual([x.a.user.id, x.b.user.id, x.c.user.id].map((u) => [u, 'preparing']).sort())
      expect(sw.heat).toEqual(Array(10).fill(0))
      await wait(x.gc, (d) => d.film.title === 'Ep 2') // everyone in the call gets it

      // The index is gone: a seat joining afterwards is replayed nothing; the host's new index starts at 0.
      const before = pieceFrames(x.gc).length
      x.gc.send({ op: 'cinema_seat', sessionId: id, seated: false })
      await wait(x.gb, (d) => !d.seats.some((e) => e.userId === x.c.user.id))
      await seat(x.gc, id, x.c.user.id)
      expect(pieceFrames(x.gc).length).toBe(before)
      x.ga.send({ op: 'cinema_pieces', sessionId: id, track: 'v', from: 0, items: [piece(0)] }) // from 0 is valid again
      await x.gb.waitFor('CINEMA_PIECES', (d) => d.items.length === 1 && d.from === 0 && pieceFrames(x.gb).length === 2)

      // Ready gating works as for start.
      for (const g of [x.ga, x.gb, x.gc]) status(g, id, 'ready')
      expect((await wait(x.gb, (d) => d.playback.playing && d.film.title === 'Ep 2')).playback.position).toBe(100)
    })
  })

  describe('summary', () => {
    afterEach(() => { vi.useRealTimers() })

    it('counts played media time, everyone who sat, reactions and the busiest 10 s bucket', async () => {
      const x = await setup()
      const st = await open(x)
      await seat(x.gb, st.sessionId, x.b.user.id)
      control(x.ga, st.sessionId, 'start', 0, { position: 0 })
      await wait(x.ga, (d) => d.playback.reason === 'buffering')
      status(x.ga, st.sessionId, 'ready'); status(x.gb, st.sessionId, 'ready')
      const p = await wait(x.ga, (d) => d.playback.playing)
      // Only the clock is faked: sockets and timers stay real.
      vi.useFakeTimers({ toFake: ['Date'] })
      const t0 = p.playback.at
      const react = async () => { x.gb.send({ op: 'cinema_react', sessionId: st.sessionId, emoji: '😂' }); await sleep(30) }
      vi.setSystemTime(t0 + 5000)
      for (let i = 0; i < 3; i++) await react()
      vi.setSystemTime(t0 + 10_000)
      control(x.ga, st.sessionId, 'pause', p.playback.seq)
      const paused = await wait(x.ga, (d) => !d.playback.playing && d.playback.seq > p.playback.seq)
      control(x.ga, st.sessionId, 'seek', paused.playback.seq, { position: 30 })
      await wait(x.ga, (d) => d.playback.reason === 'buffering')
      status(x.ga, st.sessionId, 'ready'); status(x.gb, st.sessionId, 'ready')
      await wait(x.ga, (d) => d.playback.playing && d.playback.position === 30)
      await react()
      x.ga.send({ op: 'cinema_end', sessionId: st.sessionId })
      const end = await x.gb.waitFor('CINEMA_STATE', (d) => 'ended' in d)
      if (!('summary' in end)) throw new Error('no summary')
      expect(end.summary.peak).toEqual({ position: 0, count: 3 })
      expect(end.summary.reactions).toBe(4)
      expect(end.summary.seats.sort()).toEqual([x.a.user.id, x.b.user.id].sort())
      expect(Math.abs(end.summary.watchedS - 10)).toBeLessThan(0.6)
    })

    it('has no peak without reactions', async () => {
      const x = await setup()
      const st = await open(x)
      x.ga.send({ op: 'cinema_end', sessionId: st.sessionId })
      const end = await x.gb.waitFor('CINEMA_STATE', (d) => 'ended' in d)
      expect(end).toMatchObject({ summary: { reactions: 0, peak: null, watchedS: 0 } })
    })
  })
})
