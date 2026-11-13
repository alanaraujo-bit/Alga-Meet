/**
 * Alga Worlds, server half: the flag, personal rooms and figures (REST), the Ateliê products in billing, the realtime
 * session of a call (gateway), the asset pack and the privacy duties. People join calls through signed LiveKit
 * webhooks and buy through signed sandbox webhooks. The asset pack is a tiny one in a temp folder, never the real one.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ECO_ACCENTS, GatewayClose, LOUNGE_ROOM, STARTER_ROOM, WORLD_FRAME_LIMIT, WORLD_PAID_SKUS, WORLD_PLACE_COOLDOWN_MS, WORLD_REACTIONS, WORLD_ROOM_NAME_MAX,
  WORLD_SHELLS, seatPlace, spawnPose, toPose, uuidv7, worldEntry,
  type AuthResponse, type BillingCatalog, type BillingMe, type CheckoutResponse, type DispatchOf, type DispatchType, type Invite, type Me, type Order,
  type PublicUser, type Quote, type SpaceSnapshot, type WorldAvatar, type WorldPlace, type WorldPose, type WorldRoom, type WorldRoomLayout, type WorldSession,
} from '@alga/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RawData } from 'ws'
import { PRODUCTS, productById } from '../src/billing/catalog.js'
import { SANDBOX_SIGNATURE_HEADER, sandboxSignature } from '../src/billing/provider.js'
import { loadConfig } from '../src/config.js'
import { products, users, worldRooms } from '../src/db/schema.js'
import { api, befriend, connect, postWebhook, register, startServer, type Gateway, type TestServer } from './helpers.js'

type User = AuthResponse & { password: string }

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
const glb = Buffer.from('glTF fake model bytes')
const webp = Buffer.from('RIFF fake texture WEBP')
const hdr = Buffer.from('#?RADIANCE fake sky')
const credits = Buffer.from('# Credits\nAll CC0.\n')
let pack: string
/** Writes manifest.json; returns its bytes. The mtime moves forward on every write so the server sees the change. */
let manifestWrites = 0
function writeManifest(json: unknown): Buffer {
  const bytes = Buffer.from(JSON.stringify(json))
  const file = join(pack, 'manifest.json')
  writeFileSync(file, bytes)
  const at = new Date(Date.now() + ++manifestWrites * 10_000)
  utimesSync(file, at, at)
  return bytes
}

let s: TestServer
let manifest: Buffer
beforeAll(async () => {
  pack = mkdtempSync(join(tmpdir(), 'alga-worlds-pack-'))
  for (const dir of ['models', 'textures', 'sky']) mkdirSync(join(pack, dir))
  writeFileSync(join(pack, 'models', 'chair.glb'), glb)
  writeFileSync(join(pack, 'textures', 'oak.webp'), webp)
  writeFileSync(join(pack, 'sky', 'noite.hdr'), hdr)
  writeFileSync(join(pack, 'CREDITS.md'), credits)
  writeFileSync(join(pack, 'secret.txt'), 'on disk, not in the manifest')
  manifest = writeManifest({
    version: 1,
    files: [
      { path: 'models/chair.glb', sha256: sha(glb), size: glb.length },
      { path: 'textures/oak.webp', sha256: sha(webp), size: webp.length },
      { path: 'models/missing.glb', sha256: sha('never written'), size: 1 },
    ],
  })
  s = await startServer({ WORLDS_ASSETS_DIR: pack })
  // Positions go out when a test calls tick(); places change freely unless a test is about the cooldown.
  s.app.ctx.worlds.start(3_600_000)
  s.app.ctx.worlds.placeCooldownMs = 0
})
afterAll(async () => {
  await s.close()
  rmSync(pack, { recursive: true, force: true })
})

// ---- calls ----------------------------------------------------------------------------------------------------------

let seq = 0
const voiceEvent = (name: string, channelId: string, identity: string) => ({
  event: name, id: `EV_WL_${++seq}`, createdAt: String(Math.floor(Date.now() / 1000)),
  room: { sid: `RM_${channelId.slice(0, 8)}`, name: `ch_${channelId}` },
  participant: { sid: `PA_WL_${seq}`, identity, name: 'x', joinedAt: String(Math.floor(Date.now() / 1000)) },
})
const join_ = (channelId: string, userId: string) => postWebhook(s.app, s.config, voiceEvent('participant_joined', channelId, userId))
const quit = (channelId: string, userId: string) => postWebhook(s.app, s.config, voiceEvent('participant_left', channelId, userId))

/** Four members of a space, all connected; the first `inCall` of them are in its voice channel. */
async function setup(inCall = 3) {
  const [a, b, c, d] = [await register(s.app), await register(s.app), await register(s.app), await register(s.app)]
  const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: a.token, body: { name: 'Mundo' } })).body
  const inv = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: a.token, body: {} })).body
  for (const u of [b, c, d]) await api(s.app, 'POST', `/invites/${inv.code}`, { token: u.token })
  const ch = space.channels.find((x) => x.type === 'voice')!.id
  for (const u of [a, b, c, d].slice(0, inCall)) await join_(ch, u.user.id)
  const [ga, gb, gc, gd] = await Promise.all([a, b, c, d].map((u) => connect(s.port, u.token)))
  return { a, b, c, d, ga: ga!, gb: gb!, gc: gc!, gd: gd!, ch }
}

/**
 * Resolves once the server handled everything `gw` sent so far and `gw` received everything sent to it until then:
 * frames of a socket are handled in order, so the ack of a heartbeat sent now comes after all of it.
 */
function settled(gw: Gateway): Promise<void> {
  return new Promise((resolve) => {
    const on = (raw: RawData) => {
      if ((JSON.parse(raw.toString()) as { op: string }).op !== 'heartbeat_ack') return
      gw.ws.off('message', on)
      resolve()
    }
    gw.ws.on('message', on)
    gw.send({ op: 'heartbeat' })
  })
}
/** Sends a frame and waits until it was handled and everyone in `watch` got what it caused. */
async function act(gw: Gateway, frame: Record<string, unknown>, ...watch: Gateway[]): Promise<void> {
  gw.send(frame)
  await settled(gw)
  for (const w of watch) await settled(w)
}
const open = (gw: Gateway, ch: string, place: WorldPlace, ...watch: Gateway[]) => act(gw, { op: 'world_open', channelId: ch, place }, ...watch)
const walkIn = (gw: Gateway, ch: string, ...watch: Gateway[]) => act(gw, { op: 'world_enter', channelId: ch }, ...watch)
const move = (gw: Gateway, ch: string, p: WorldPose) => act(gw, { op: 'world_move', channelId: ch, p })
async function tick(...watch: Gateway[]): Promise<void> {
  s.app.ctx.worlds.tick()
  for (const w of watch) await settled(w)
}

/** Dispatches of type `t` that `gw` got from event index `from` on. */
const got = <T extends DispatchType>(gw: Gateway, t: T, from = 0) => gw.events.slice(from).filter((e) => e.t === t).map((e) => e.d as DispatchOf<T>)
const sessions = (gw: Gateway, from = 0) => got(gw, 'WORLD_STATE', from).map((d) => d.session)
const lastSession = (gw: Gateway) => sessions(gw).at(-1)!
const errors = (gw: Gateway, from = 0) => got(gw, 'WORLD_ERROR', from)
/** The next dispatch of type `t` matching `pred` that arrives after this call. */
function next<T extends DispatchType>(gw: Gateway, t: T, pred: (d: DispatchOf<T>) => boolean = () => true): Promise<DispatchOf<T>> {
  const from = gw.events.length
  return gw.waitFor(t, (d) => gw.events.findIndex((e) => e.d === d) >= from && pred(d))
}
/** A pose as JSON carries it (no negative zero). */
const wire = (p: WorldPose): WorldPose => p.map((v) => v + 0) as WorldPose
const LOUNGE = WORLD_SHELLS.lounge
const LOFT = WORLD_SHELLS.loft
const seatPose = (room: Pick<WorldRoomLayout, 'items'>, seat: string) => {
  const at = seatPlace(room, seat)!
  return wire(toPose(at.x, at.z, at.yaw))
}
const memberOf = (session: WorldSession | null | undefined, u: User) => session?.members.find((m) => m.userId === u.user.id)
/** Test-only reach into a live session: the clocks of the speed limit and of the place cooldown. */
const peek = (ch: string) =>
  (s.app.ctx.worlds as unknown as { sessions: Map<string, { placedAt: number; members: Map<string, { movedAt: number }> }> }).sessions.get(ch)!

// ---- billing --------------------------------------------------------------------------------------------------------

let evSeq = 0
async function hook(event: unknown): Promise<number> {
  const raw = JSON.stringify(event)
  const res = await s.app.inject({
    method: 'POST', url: '/api/v1/billing/webhooks/sandbox',
    headers: { 'content-type': 'application/json', [SANDBOX_SIGNATURE_HEADER]: sandboxSignature(s.config.billing.sandboxSecret, raw) }, payload: raw,
  })
  return res.statusCode
}
const update = (kind: 'order' | 'subscription', reference: string, status: string, extra: Record<string, unknown> = {}) =>
  ({ id: `WL_${++evSeq}`, type: `test.${kind}`, updates: [{ kind, reference, status, occurredAt: new Date().toISOString(), ...extra }] })
const call = <T = any>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, u: User | null, body?: unknown) =>
  api<T>(s.app, method, url, { ...(u ? { token: u.token } : {}), ...(body !== undefined ? { body } : {}) })
const checkout = (u: User, productId: string) => call<CheckoutResponse>('POST', '/billing/checkout', u, { productId })
async function buy(u: User, productId: string): Promise<CheckoutResponse> {
  const co = await checkout(u, productId)
  expect(co.status).toBe(201)
  expect(await hook(update('order', co.body.reference, 'paid', { amountCents: co.body.amountCents, currency: 'BRL', providerPaymentId: `pay_${co.body.reference}` }))).toBe(200)
  return co.body
}
const refund = (u: User, reference: string) => call<Order>('POST', `/billing/orders/${reference}/refund`, u)
const skus = async (u: User) => (await call<BillingMe>('GET', '/billing/me', u)).body.items.map((i) => i.sku)
async function subscribed(productId = 'plus_monthly', days = 30) {
  const u = await register(s.app)
  const co = (await checkout(u, productId)).body
  const currentPeriodEnd = new Date(Date.now() + days * 24 * 3600_000).toISOString()
  expect(await hook(update('subscription', co.reference, 'active', { currentPeriodEnd, amountCents: productById(productId)!.priceBrlCents }))).toBe(200)
  return Object.assign(u, { reference: co.reference })
}

// ---- rooms and figures over REST ------------------------------------------------------------------------------------

const getRoom = (u: User) => call<WorldRoom>('GET', '/worlds/rooms/@me', u)
const putRoom = (u: User, room: Pick<WorldRoom, 'name' | 'access' | 'finish' | 'items'>, more: Record<string, unknown> = {}) =>
  call<WorldRoom>('PUT', '/worlds/rooms/@me', u, { name: room.name, access: room.access, finish: room.finish, items: room.items, ...more })
const putAvatar = (u: User, avatar: WorldAvatar | null) => call<Me>('PUT', '/worlds/avatar', u, { avatar })
const item = (id: string, sku: string, more: Partial<{ x: number; y: number; z: number; rot: number; variant: string }> = {}) =>
  ({ id, sku, x: 0, y: 0, z: 0, rot: 0, ...more })
const FIGURE: WorldAvatar = { body: 'b', finish: 'a_areia', accent: ECO_ACCENTS[1]!, outfit: 'o_macacao', top: 3, bottom: 4, shoes: 5, head: 'h_bone' }

describe('the flag', () => {
  it('on outside production and off in production until WORLDS=true; where the pack comes from', () => {
    expect(s.config.worlds).toEqual({ enabled: true, assetsUrl: '/api/v1/worlds/assets', assetsDir: pack })
    expect(loadConfig({ NODE_ENV: 'development' }).worlds.assetsDir).toMatch(/assets[\\/]worlds[\\/]v1$/)
    const PROD = {
      NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db:5432/alga', CORS_ORIGINS: 'null', LIVEKIT_API_KEY: 'k',
      LIVEKIT_API_SECRET: 'a-real-production-secret-0123456789abcdef', PUBLIC_URL: 'https://api.example.com', FILES_SECRET: 's'.repeat(32),
      STORAGE_DRIVER: 'local', EMAIL_DRIVER: 'console', ALGA_ALLOW_CONSOLE_EMAIL: '1', E2EE_DS_KEY: 'A'.repeat(43) + '=',
    }
    expect(loadConfig(PROD).worlds.enabled).toBe(false)
    expect(loadConfig({ ...PROD, WORLDS: 'true', WORLDS_ASSETS_URL: 'https://cdn.example.com/worlds/v1/' }).worlds)
      .toMatchObject({ enabled: true, assetsUrl: 'https://cdn.example.com/worlds/v1' })
    expect(() => loadConfig({ ...PROD, WORLDS_ASSETS_URL: 'http://cdn.example.com/worlds' })).toThrow(/WORLDS_ASSETS_URL/)
    expect(loadConfig({ NODE_ENV: 'test', WORLDS: 'false', WORLDS_ASSETS_URL: 'http://127.0.0.1:9000/w' }).worlds).toMatchObject({ enabled: false, assetsUrl: 'http://127.0.0.1:9000/w' })
    expect(() => loadConfig({ NODE_ENV: 'test', WORLDS_ASSETS_URL: 'ftp://cdn.example.com/w' })).toThrow(/WORLDS_ASSETS_URL/)
  })

  it('on: READY says where the pack is. Off: READY has no `worlds`, every op answers `disabled`, the routes do not exist', async () => {
    const me = await register(s.app)
    const gw = await connect(s.port, me.token)
    expect((gw.events.find((e) => e.t === 'READY')!.d as { worlds?: unknown }).worlds).toEqual({ assetsUrl: '/api/v1/worlds/assets' })
    gw.close()

    const off = await startServer({ WORLDS: 'false', WORLDS_ASSETS_DIR: pack })
    try {
      const u = await register(off.app)
      const g = await connect(off.port, u.token)
      expect('worlds' in (g.events.find((e) => e.t === 'READY')!.d as object)).toBe(false)
      const channelId = uuidv7()
      const frames = [
        { op: 'world_hello', channelId }, { op: 'world_open', channelId, place: { kind: 'lounge' } }, { op: 'world_enter', channelId },
        { op: 'world_leave', channelId }, { op: 'world_move', channelId, p: [0, 0, 0, 0] }, { op: 'world_sit', channelId, seat: 'sofa:0' },
        { op: 'world_stand', channelId, p: [0, 0, 0, 0] }, { op: 'world_emote', channelId, emote: { kind: 'gesture', id: 'wave' } },
        { op: 'world_rest', channelId }, { op: 'world_tv', channelId, userId: null },
      ]
      for (const f of frames) g.send(f)
      await settled(g)
      expect(errors(g)).toEqual(frames.map((f) => ({ op: f.op, reason: 'disabled' })))
      const t = { token: u.token }
      expect((await api(off.app, 'GET', '/worlds/rooms/@me', t)).status).toBe(404)
      expect((await api(off.app, 'PUT', '/worlds/rooms/@me', { ...t, body: { name: 'x', access: 'call', finish: STARTER_ROOM.finish, items: [] } })).status).toBe(404)
      expect((await api(off.app, 'PUT', '/worlds/avatar', { ...t, body: { avatar: null } })).status).toBe(404)
      expect((await off.app.inject({ method: 'GET', url: '/api/v1/worlds/assets/manifest.json' })).statusCode).toBe(404)
      expect(await off.app.ctx.db.select().from(worldRooms)).toEqual([])
    } finally {
      await off.close()
    }
  })
})

describe('personal rooms', () => {
  it('the first GET makes the room from STARTER_ROOM, named after the person', async () => {
    const u = await register(s.app)
    expect((await call('GET', '/worlds/rooms/@me', null)).status).toBe(401)
    const room = (await getRoom(u)).body
    expect(room).toEqual({
      ownerId: u.user.id, name: `Sala de ${u.user.displayName}`, access: 'call', updatedAt: expect.any(String),
      shell: 'loft', finish: STARTER_ROOM.finish, items: STARTER_ROOM.items,
    })
    expect((await getRoom(u)).body).toEqual(room) // made once
    expect(await s.app.ctx.db.select().from(worldRooms).where(eq(worldRooms.ownerId, u.user.id))).toHaveLength(1)

    // A long display name is cut so the name fits, never in the middle of a character.
    const long = await register(s.app)
    await s.app.ctx.db.update(users).set({ displayName: `${'x'.repeat(WORLD_ROOM_NAME_MAX - 9)}😀😀` }).where(eq(users.id, long.user.id))
    const name = (await getRoom(long)).body.name
    expect(name).toBe(`Sala de ${'x'.repeat(WORLD_ROOM_NAME_MAX - 9)}`)
    expect((await putRoom(long, { ...(await getRoom(long)).body })).status).toBe(200) // and is one the PUT accepts back
  })

  it('PUT saves the whole room: millimetres, a clean name, never another shell', async () => {
    const u = await register(s.app)
    const base = (await getRoom(u)).body
    const saved = await putRoom(u, {
      name: `  Canto${String.fromCharCode(7)} do Zé  `, access: 'friends', finish: { floor: 'f_concreto', wall: 'p_gesso_salvia', accentWall: null, mood: 'm_noite' },
      items: [item('sofa1', 'w_sofa_duo', { x: 1.23456789, z: -2.00049, rot: 3.14159265, variant: 'musgo' }), item('qd', 'w_quadro_paisagem', { x: -4.98, y: 1.3333333, rot: 1.5707963 })],
    })
    expect(saved.status).toBe(200)
    expect(saved.body).toEqual({
      ownerId: u.user.id, name: 'Canto do Zé', access: 'friends', updatedAt: expect.any(String), shell: 'loft',
      finish: { floor: 'f_concreto', wall: 'p_gesso_salvia', accentWall: null, mood: 'm_noite' },
      items: [{ id: 'sofa1', sku: 'w_sofa_duo', x: 1.235, y: 0, z: -2, rot: 3.142, variant: 'musgo' }, { id: 'qd', sku: 'w_quadro_paisagem', x: -4.98, y: 1.333, z: 0, rot: 1.571 }],
    })
    expect(new Date(saved.body.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(base.updatedAt).getTime())
    expect((await getRoom(u)).body).toEqual(saved.body)
    // The body is the layout and nothing else.
    expect((await putRoom(u, base, { shell: 'lounge' })).status).toBe(400)
    expect((await putRoom(u, { ...base, name: String.fromCharCode(7) })).body.error.fields).toHaveProperty('name')
    expect((await putRoom(u, { ...base, name: 'x'.repeat(WORLD_ROOM_NAME_MAX + 1) })).body.error.fields).toHaveProperty('name')
    expect((await putRoom(u, { ...base, access: 'everyone' as never })).body.error.fields).toHaveProperty('access')
    expect((await call('PUT', '/worlds/rooms/@me', null, base)).status).toBe(401)
    expect((await getRoom(u)).body).toEqual(saved.body)
  })

  it('PUT refuses what the room cannot have: each problem with its status and field', async () => {
    const u = await register(s.app)
    const base = (await getRoom(u)).body
    const withItems = (...items: ReturnType<typeof item>[]) => putRoom(u, { ...base, items })
    const withFinish = (finish: Partial<WorldRoom['finish']>) => putRoom(u, { ...base, finish: { ...base.finish, ...finish } })
    const refused = async (res: Promise<Awaited<ReturnType<typeof putRoom>>>, status: number, field: string, reason?: string) => {
      const r = await res
      expect([r.status, r.body.error?.code]).toEqual([status, status === 403 ? 'forbidden' : 'validation'])
      expect(Object.keys(r.body.error.fields)).toEqual([field])
      if (reason) expect(r.body.error.fields[field]).toBe(reason)
    }
    await refused(withItems(item('a', 'w_sofa_duo'), item('b', 'w_nao_existe')), 400, 'items.b', 'unknown_sku')
    await refused(withFinish({ mood: 'm_nao_existe' }), 400, 'finish.mood', 'unknown_sku')
    await refused(withItems(item('a', 'f_carvalho')), 400, 'items.a', 'wrong_kind') // a floor is not furniture
    await refused(withFinish({ floor: 'f_carvalho', wall: 'f_carvalho' }), 400, 'finish.wall', 'wrong_kind') // nor a wall
    await refused(withFinish({ accentWall: 'm_tarde' }), 400, 'finish.accentWall', 'wrong_kind')
    await refused(withItems(item('a', 'w_sofa_duo'), item('tv', 'w_tv_cinema')), 403, 'items.tv', 'not_owned')
    await refused(withItems(item('lin', 'w_pendente_linear', { y: 2.7 })), 403, 'items.lin', 'not_owned') // comes with Plus
    await refused(withFinish({ floor: 'f_pedra' }), 403, 'finish.floor', 'not_owned')
    await refused(withFinish({ accentWall: 'p_madeira' }), 403, 'finish.accentWall', 'not_owned')
    await refused(withItems(item('a', 'w_sofa_duo', { variant: 'areia' }), item('b', 'w_sofa_duo', { variant: 'neon' })), 400, 'items.b', 'unknown_variant')
    await refused(withItems(item('a', 'w_pufe_couro', { variant: 'areia' })), 400, 'items.a', 'unknown_variant') // it has no variants
    await refused(withItems(item('a', 'w_sofa_duo'), item('a', 'w_pufe_couro')), 400, 'items.a', 'duplicate_id')
    await refused(withItems(item('a', 'w_sofa_duo', { x: LOFT.width / 2 + 0.5 })), 400, 'items.a', 'out_of_bounds')
    await refused(withItems(item('a', 'w_pendente_globo', { y: LOFT.height + 0.1 })), 400, 'items.a', 'out_of_bounds')
    await refused(withItems(...Array.from({ length: 9 }, (_, i) => item(`v${i}`, 'w_suculenta'))), 400, 'items', 'too_many_copies')
    await refused(withItems(...Array.from({ length: 91 }, (_, i) => item(`n${i}`, 'w_suculenta'))), 400, 'items', 'too_many')
    await refused(withItems({ ...item('a', 'w_sofa_duo'), id: 'Não' }), 400, 'items.0.id')
    expect((await getRoom(u)).body).toEqual(base) // nothing of it was saved
    // 8 copies and the walls themselves are fine.
    expect((await withItems(...Array.from({ length: 8 }, (_, i) => item(`v${i}`, 'w_suculenta')), item('q', 'w_relogio', { x: -LOFT.width / 2, y: 1.7 }))).status).toBe(200)
  })

  it('a bought piece is placed; refunded, it leaves the room a call sees but not the stored one; bought again, it is back', async () => {
    const x = await setup(2)
    const { a, ch } = x
    const base = (await getRoom(a)).body
    const telao = item('telao', 'w_tv_cinema', { x: 4.97, y: 1, rot: -1.571 })
    const mine = { ...base, finish: { ...base.finish, floor: 'f_pedra' }, items: [...base.items.filter((i) => i.id !== 'tv'), telao] }
    expect((await putRoom(a, mine)).status).toBe(403)
    const screen = await buy(a, 'w_tv_cinema')
    const floor = await buy(a, 'f_pedra')
    const stored = (await putRoom(a, mine)).body
    expect(stored.items.at(-1)).toEqual(telao)

    await open(x.ga, ch, { kind: 'room', ownerId: a.user.id }, x.gb)
    const shown = got(x.gb, 'WORLD_ROOM').at(-1)!
    expect(shown).toMatchObject({ rev: 1, finish: { floor: 'f_pedra' } })
    expect(shown.items).toEqual(stored.items)

    let room = next(x.gb, 'WORLD_ROOM')
    expect((await refund(a, screen.reference)).body.status).toBe('refunded')
    expect(await room).toMatchObject({ rev: 2, finish: { floor: 'f_pedra' }, items: stored.items.filter((i) => i.id !== 'telao') })
    room = next(x.gb, 'WORLD_ROOM')
    expect((await refund(a, floor.reference)).body.status).toBe('refunded')
    expect(await room).toMatchObject({ rev: 3, finish: { ...stored.finish, floor: STARTER_ROOM.finish.floor } }) // the starter's floor
    expect((await getRoom(a)).body).toEqual(stored) // the layout is kept as saved
    expect((await putRoom(a, stored)).status).toBe(403) // but cannot be saved again like that

    // What they hold changing without touching the room says nothing to the call.
    const mark = x.gb.events.length
    await buy(a, 'deco_ha_orbita')
    await new Promise((r) => setTimeout(r, 150))
    expect(got(x.gb, 'WORLD_ROOM', mark)).toEqual([])
    room = next(x.gb, 'WORLD_ROOM')
    await buy(a, 'w_tv_cinema')
    expect((await room).items.at(-1)).toEqual(telao)
    await settled(x.gb)
    expect(lastSession(x.gb)!.seq).toBe(4) // one WORLD_STATE with each WORLD_ROOM
  })
})

describe('the 3D figure', () => {
  it('PUT /worlds/avatar: friends see it in USER_UPDATE; paid parts need holding; a refund puts the free part back', async () => {
    const [u, friend] = [await register(s.app), await register(s.app)]
    await befriend(s.app, u, friend)
    const [gu, gf] = [await connect(s.port, u.token), await connect(s.port, friend.token)]
    expect((await call<Me>('GET', '/users/@me', u)).body.world).toBeUndefined()

    let seen = next(gf, 'USER_UPDATE', (d) => d.id === u.user.id && !!d.world)
    const saved = await putAvatar(u, FIGURE)
    expect(saved.status).toBe(200)
    expect(saved.body.world).toEqual(FIGURE)
    expect((await seen).world).toEqual(FIGURE)
    expect((await gu.waitFor('ME_UPDATE', (d) => !!d.world)).world).toEqual(FIGURE)
    expect((await call<PublicUser>('GET', `/users/${u.user.id}`, friend)).body.world).toEqual(FIGURE)

    // Parts that do not exist (or are of another kind), a shape that is not a figure, parts not held.
    const bad = async (avatar: unknown, status: number, field?: string, reason?: string) => {
      const r = await call('PUT', '/worlds/avatar', u, { avatar })
      expect(r.status).toBe(status)
      if (field) expect(r.body.error.fields).toEqual({ [field]: reason })
    }
    await bad({ ...FIGURE, finish: 'a_nao_existe' }, 400, 'avatar.finish', 'unknown')
    await bad({ ...FIGURE, outfit: 'h_bone' }, 400, 'avatar.outfit', 'unknown')
    await bad({ ...FIGURE, head: 'w_sofa_duo' }, 400, 'avatar.head', 'unknown')
    await bad({ ...FIGURE, top: 99 }, 400)
    await bad({ ...FIGURE, extra: 1 }, 400)
    await bad({ ...FIGURE, finish: 'a_bronze' }, 403, 'avatar.finish', 'not_owned')
    await bad({ ...FIGURE, outfit: 'o_veludo' }, 403, 'avatar.outfit', 'not_owned')
    await bad({ ...FIGURE, finish: 'a_perola' }, 403, 'avatar.finish', 'not_owned') // comes with Plus
    expect((await call('PUT', '/worlds/avatar', null, { avatar: FIGURE })).status).toBe(401)
    expect((await call<Me>('GET', '/users/@me', u)).body.world).toEqual(FIGURE)

    const bronze = await buy(u, 'a_bronze')
    const hat = await buy(u, 'h_chapeu')
    const dressed = { ...FIGURE, finish: 'a_bronze', head: 'h_chapeu' }
    expect((await putAvatar(u, dressed)).body.world).toEqual(dressed)

    // Refunded: only that part goes back to the free one, and everyone who sees the person is told.
    seen = next(gf, 'USER_UPDATE', (d) => d.id === u.user.id && d.world?.finish === 'a_porcelana')
    const mine = next(gu, 'ME_UPDATE', (d) => d.world?.finish === 'a_porcelana')
    expect((await refund(u, bronze.reference)).body.status).toBe('refunded')
    expect((await mine).world).toEqual({ ...dressed, finish: 'a_porcelana' })
    expect((await seen).world).toEqual({ ...dressed, finish: 'a_porcelana' })
    await refund(u, hat.reference)
    expect((await call<Me>('GET', '/users/@me', u)).body.world).toEqual({ ...FIGURE, finish: 'a_porcelana', head: 'h_nenhum' })

    // null = the automatic figure again.
    seen = next(gf, 'USER_UPDATE', (d) => d.id === u.user.id && !d.world)
    expect((await putAvatar(u, null)).body.world).toBeUndefined()
    expect('world' in (await seen)).toBe(false)
    gu.close()
    gf.close()
  })

  it('a part that comes with Plus is worn while the plan lasts', async () => {
    const u = await subscribed()
    expect(await skus(u)).toEqual(expect.arrayContaining(['a_perola', 'w_pendente_linear']))
    const pearl = { ...FIGURE, finish: 'a_perola', outfit: 'o_basico' }
    expect((await putAvatar(u, pearl)).body.world).toEqual(pearl)
    const base = (await getRoom(u)).body
    expect((await putRoom(u, { ...base, items: [...base.items, item('lin', 'w_pendente_linear', { y: 2.7 })] })).status).toBe(200)
    expect(await hook(update('subscription', u.reference, 'revoked'))).toBe(200)
    expect((await call<Me>('GET', '/users/@me', u)).body.world).toEqual({ ...pearl, finish: 'a_porcelana' })
    expect((await getRoom(u)).body.items.some((i) => i.id === 'lin')).toBe(true) // the room is kept; it is filtered when shown
  })
})

describe('Ateliê in the store', () => {
  it('one product per paid SKU of the worlds catalog, with its name, price and tier', async () => {
    expect(PRODUCTS.filter((p) => p.world).map((p) => p.id).sort()).toEqual([...WORLD_PAID_SKUS].sort())
    const cat = (await call<BillingCatalog>('GET', '/billing/catalog', null)).body
    expect(cat.version).toBe(3)
    expect(cat.collections!.find((c) => c.id === 'atelie')).toEqual({
      id: 'atelie', name: 'Ateliê', description: expect.any(String), waves: [{ wave: 1, opensAt: expect.any(String), open: true }],
    })
    const world = cat.products.filter((p) => p.world)
    expect(world).toHaveLength(26)
    for (const p of world) {
      const e = worldEntry(p.id)!
      expect(p).toMatchObject({ kind: 'cosmetic', world: true, name: e.name, collectionId: 'atelie', wave: 1, giftable: false, purchasable: e.tier === 'store', available: e.tier === 'store' })
      expect(p.cosmeticType).toBeUndefined()
      expect(p.description.length).toBeGreaterThan(10)
      expect(!!p.hero).toBe(!!e.hero)
      if (e.tier === 'store') expect(p.includedIn).toBeUndefined()
      else expect(p).toMatchObject({ includedIn: ['plus'], priceBrlCents: 0, priceUsdCents: 0 })
    }
    const price = (id: string) => { const p = world.find((x) => x.id === id)!; return [p.priceBrlCents, p.priceUsdCents] }
    expect(Object.fromEntries(world.filter((p) => p.purchasable).map((p) => [p.id, p.priceBrlCents]))).toEqual({
      w_sofa_canto: 1290, w_poltrona_lounge: 990, w_sofa_chesterfield: 990, w_mesa_centro_marmore: 790, w_estante_aco_dupla: 790, w_luminaria_industrial: 590,
      w_tela_grande: 790, w_busto_marmore: 590, w_xadrez: 590, w_jogo_cha: 590, w_baleia_bronze: 790, w_ukulele: 590, w_boombox: 590, w_console_jogos: 590,
      w_tapete_grande: 790, w_tv_cinema: 1290, f_pedra: 790, p_madeira: 790, a_bronze: 990, a_obsidiana: 790, o_alfaiataria: 990, o_veludo: 790,
      h_chapeu: 590, h_oculos_sol: 590,
    })
    expect([price('w_sofa_canto'), price('a_bronze'), price('f_pedra'), price('h_chapeu')]).toEqual([[1290, 349], [990, 299], [790, 249], [590, 199]])
    expect(world.filter((p) => !p.purchasable).map((p) => p.id).sort()).toEqual(['a_perola', 'w_pendente_linear'])
    expect(world.filter((p) => p.hero).map((p) => p.id).sort()).toEqual(['a_bronze', 'o_alfaiataria', 'w_baleia_bronze', 'w_poltrona_lounge', 'w_sofa_canto', 'w_tela_grande', 'w_tv_cinema'])
    const rows = await s.app.ctx.db.select().from(products).where(eq(products.id, 'w_sofa_canto'))
    expect(rows[0]).toMatchObject({ kind: 'cosmetic', cosmeticType: null, name: 'Sofá Bloco · canto', priceBrlCents: 1290, active: true, catalogVersion: 3 })
  })

  it('bought, held and refunded like any cosmetic: checkout, the provider page or its webhook, quote, owned, refund', async () => {
    const u = await register(s.app)
    const gw = await connect(s.port, u.token)
    expect((await call<Quote>('GET', '/billing/quote?productId=w_sofa_canto', u)).body).toMatchObject({ amountCents: 1290, items: ['w_sofa_canto'], recipientId: null })
    const co = await checkout(u, 'w_sofa_canto')
    expect(co.status).toBe(201)
    expect(co.body).toMatchObject({ kind: 'order', amountCents: 1290, sandbox: true })
    expect(await skus(u)).toEqual([]) // nothing before the provider confirms
    expect(await hook(update('order', co.body.reference, 'paid', { amountCents: 1000, currency: 'BRL', providerPaymentId: 'low' }))).toBe(200) // below the price
    expect(await skus(u)).toEqual([])
    expect(await hook(update('order', co.body.reference, 'paid', { amountCents: 1290, currency: 'BRL', providerPaymentId: `pay_${co.body.reference}` }))).toBe(200)
    const ent = await gw.waitFor('ENTITLEMENTS_UPDATE', (d) => d.items.length > 0)
    expect(ent.items).toEqual([{ sku: 'w_sofa_canto', kind: 'cosmetic', source: 'order', expiresAt: null }])
    expect((await s.app.ctx.billing.entitlementsOf(u.user.id)).items.map((i) => i.sku)).toEqual(['w_sofa_canto'])
    expect([...await s.app.ctx.billing.owned(u.user.id)]).toEqual(['w_sofa_canto'])
    expect([...await s.app.ctx.worlds.held(u.user.id)]).toEqual(['w_sofa_canto'])
    expect((await checkout(u, 'w_sofa_canto')).status).toBe(409) // already theirs
    const order = (await call<BillingMe>('GET', '/billing/me', u)).body.orders[0]!
    expect(order).toMatchObject({ productId: 'w_sofa_canto', status: 'paid', items: ['w_sofa_canto'], refundableUntil: expect.any(String) })

    // The sandbox's own payment page grants the same way.
    const page = (await checkout(u, 'o_veludo')).body
    const link = new URL(page.url)
    expect((await s.app.inject({ method: 'GET', url: link.pathname + link.search })).statusCode).toBe(200)
    expect((await skus(u)).sort()).toEqual(['o_veludo', 'w_sofa_canto'])

    expect((await refund(u, co.body.reference)).body.status).toBe('refunded')
    expect(await skus(u)).toEqual(['o_veludo'])
    expect([...await s.app.ctx.billing.owned(u.user.id)]).toEqual(['o_veludo'])
    expect((await checkout(u, 'w_sofa_canto')).status).toBe(201) // and can be bought again
    expect((await checkout(u, 'w_pendente_linear')).status).toBe(404) // not sold: it comes with Plus
    gw.close()
  })

  it('they are not profile cosmetics: no slot, no try-on, no gift, no wishlist, not the annual item', async () => {
    const x = await setup(1)
    const { a, b } = x
    await buy(a, 'h_chapeu')
    // Owned, and still nothing a profile slot takes.
    for (const slot of ['avatarDecoration', 'nameplate', 'voiceAura']) {
      const r = await call('PUT', '/users/@me/cosmetics', a, { [slot]: 'h_chapeu' })
      expect([r.status, Object.keys(r.body.error.fields)]).toEqual([400, [slot]])
    }
    expect((await call<Me>('GET', '/users/@me', a)).body.cosmetics).toBeUndefined()
    // In a call, where a try-on is possible: world pieces are not something to try on a profile.
    expect((await call('POST', '/billing/try-on', a, { productId: 'deco_ha_orbita' })).status).toBe(201)
    expect((await call('POST', '/billing/try-on', a, { productId: 'h_oculos_sol' })).status).toBe(404)
    expect((await call('POST', '/billing/try-on', a, { productId: 'w_sofa_canto' })).status).toBe(404)
    await call('DELETE', '/billing/try-on', a)
    // Not giftable (yet), friends or not; so not in a wishlist either.
    await befriend(s.app, a, b)
    expect((await call('POST', '/billing/gifts', a, { productId: 'w_sofa_canto', recipientId: b.user.id })).status).toBe(404)
    expect((await call('GET', `/billing/quote?productId=w_sofa_canto&recipientId=${b.user.id}`, a)).status).toBe(404)
    expect((await call('PUT', '/billing/wishlist/w_sofa_canto', a)).status).toBe(404)
    expect((await call('PUT', '/billing/wishlist/deco_ha_orbita', a)).status).toBe(200)
    // The annual item is one of Coleção 01.
    const yearly = await subscribed('plus_yearly', 365)
    expect((await call('POST', '/billing/plus/annual-item', yearly, { productId: 'h_oculos_sol' })).status).toBe(400)
    expect(await skus(yearly)).not.toContain('h_oculos_sol')
  })
})

describe('the world of a call', () => {
  it('hello with no world; opening the lounge tells the whole call; walking in gives a key and a place to arrive', async () => {
    const x = await setup(2) // c and d are not in the call
    const { a, b, ch } = x
    await act(x.ga, { op: 'world_hello', channelId: ch })
    expect(got(x.ga, 'WORLD_STATE')).toEqual([{ channelId: ch, session: null }])
    expect(got(x.ga, 'WORLD_ROOM')).toEqual([])
    await act(x.gb, { op: 'world_enter', channelId: ch })
    await act(x.gb, { op: 'world_leave', channelId: ch })
    expect(errors(x.gb)).toEqual([{ op: 'world_enter', reason: 'no_session' }, { op: 'world_leave', reason: 'not_inside' }])
    // Outside the call there is nothing to see or do.
    for (const op of ['world_hello', 'world_enter', 'world_rest']) x.gc.send({ op, channelId: ch })
    await open(x.gc, ch, { kind: 'lounge' })
    expect(errors(x.gc)).toEqual(['world_hello', 'world_enter', 'world_rest', 'world_open'].map((op) => ({ op, reason: 'not_in_call' })))
    expect(s.app.ctx.worlds.sessionOf(ch)).toBeUndefined()

    await open(x.ga, ch, { kind: 'lounge' }, x.gb, x.gc)
    for (const gw of [x.ga, x.gb]) {
      expect(got(gw, 'WORLD_ROOM')).toEqual([{ channelId: ch, place: { kind: 'lounge' }, name: 'Lounge', rev: 1, ...LOUNGE_ROOM }])
      expect(sessions(gw).at(-1)).toEqual({ channelId: ch, place: { kind: 'lounge' }, hostId: a.user.id, members: [], tv: null, seq: 1 })
    }
    expect([...got(x.gc, 'WORLD_ROOM'), ...got(x.gc, 'WORLD_STATE')]).toEqual([])
    // Opening it where it already is changes nothing: the asker gets the state again.
    let [markA, markB] = [x.ga.events.length, x.gb.events.length]
    await open(x.gb, ch, { kind: 'lounge' }, x.ga)
    expect([sessions(x.gb, markB).map((v) => v!.seq), got(x.gb, 'WORLD_ROOM', markB).map((r) => r.rev)]).toEqual([[1], [1]])
    expect(x.ga.events.length).toBe(markA)

    await walkIn(x.ga, ch, x.gb)
    expect(lastSession(x.gb)).toMatchObject({ seq: 2, members: [{ userId: a.user.id, k: 0, pose: spawnPose(LOUNGE, 0), seat: null, loop: null }] })
    await walkIn(x.gb, ch, x.ga)
    expect(lastSession(x.ga)).toMatchObject({
      seq: 3, members: [{ userId: a.user.id, k: 0, pose: spawnPose(LOUNGE, 0) }, { userId: b.user.id, k: 1, pose: spawnPose(LOUNGE, 1), seat: null, loop: null }],
    })
    // Twice is once: the others hear nothing.
    ;[markA, markB] = [x.ga.events.length, x.gb.events.length]
    await walkIn(x.gb, ch, x.ga)
    expect(x.ga.events.length).toBe(markA)
    expect(sessions(x.gb, markB).map((v) => v!.seq)).toEqual([3])
    // A hello now carries the state and the room.
    markB = x.gb.events.length
    await act(x.gb, { op: 'world_hello', channelId: ch })
    expect(sessions(x.gb, markB)).toEqual([lastSession(x.ga)])
    expect(got(x.gb, 'WORLD_ROOM', markB)).toHaveLength(1)

    // Who leaves frees their key; the next to arrive takes the smallest free one.
    await act(x.ga, { op: 'world_leave', channelId: ch }, x.gb)
    expect(lastSession(x.gb)!.members.map((m) => [m.userId, m.k])).toEqual([[b.user.id, 1]])
    await walkIn(x.ga, ch, x.gb)
    expect(lastSession(x.gb)).toMatchObject({ seq: 5, members: [{ userId: b.user.id, k: 1 }, { userId: a.user.id, k: 0, pose: spawnPose(LOUNGE, 1) }] })
    expect(s.app.ctx.worlds.sessionOf(ch)).toEqual(lastSession(x.gb))
  })

  it('positions go out on the tick, to the people inside only and never back to who moved; too fast is dropped', async () => {
    const x = await setup() // a and b walk in, c stays in the call outside, d is not in the call
    const { a, ch } = x
    await open(x.ga, ch, { kind: 'lounge' })
    await walkIn(x.ga, ch)
    await walkIn(x.gb, ch, x.ga, x.gc)
    const all = [x.ga, x.gb, x.gc]
    const ticks = (gw: Gateway) => got(gw, 'WORLD_TICK')
    const states = all.map((gw) => sessions(gw).length)
    const [ax, az] = spawnPose(LOUNGE, 0)
    const [bx, bz] = spawnPose(LOUNGE, 1)

    await tick(...all) // nobody moved: nothing goes out
    expect(all.flatMap(ticks)).toEqual([])
    await move(x.ga, ch, [ax + 10, az, 45, 1])
    await move(x.ga, ch, [ax + 30, az, 90, 1]) // between two ticks only the latest counts
    expect(all.flatMap(ticks)).toEqual([]) // a move alone sends nothing
    await tick(...all)
    expect(ticks(x.gb)).toEqual([{ channelId: ch, e: [[0, ax + 30, az, 90, 1]] }])
    expect([...ticks(x.ga), ...ticks(x.gc)]).toEqual([])
    await tick(...all) // sent once
    expect(ticks(x.gb)).toHaveLength(1)

    // Both moved: each hears about the other.
    await move(x.ga, ch, [ax + 30, az + 15, 180, 0])
    await move(x.gb, ch, [bx, bz + 40, -90, 2])
    await tick(...all)
    expect(ticks(x.gb).at(-1)).toEqual({ channelId: ch, e: [[0, ax + 30, az + 15, 180, 0]] })
    expect(ticks(x.ga)).toEqual([{ channelId: ch, e: [[1, bx, bz + 40, -90, 2]] }])
    expect(ticks(x.gc)).toEqual([])

    // Nobody stands in a wall: the pose is brought back inside the room. (People arrive a few steps from it, so walk
    // there first: a single jump of that length would be dropped as too fast.)
    const wall = -Math.round((LOUNGE.depth / 2 - 0.3) * 100)
    for (let z = az + 15 - 80; z > wall; z -= 80) await move(x.ga, ch, [ax + 30, z, 0, 1])
    await move(x.ga, ch, [ax + 30, -5000, 0, 1])
    await tick(...all)
    const wallZ = -Math.round((LOUNGE.depth / 2 - 0.3) * 100)
    expect(ticks(x.gb).at(-1)!.e).toEqual([[0, ax + 30, wallZ, 0, 1]])
    // Across the room in an instant: dropped, in silence.
    const before = x.ga.events.length
    await move(x.ga, ch, [0, 0, 0, 2])
    await tick(...all)
    expect(ticks(x.gb)).toHaveLength(3)
    expect(x.ga.events.length).toBe(before)
    expect(memberOf(s.app.ctx.worlds.sessionOf(ch), a)!.pose).toEqual([ax + 30, wallZ, 0, 1])
    // The same move two seconds after the last accepted one is a run.
    peek(ch).members.get(a.user.id)!.movedAt -= 2000
    await move(x.ga, ch, [0, 0, 0, 2])
    await tick(...all)
    expect(ticks(x.gb).at(-1)!.e).toEqual([[0, 0, 0, 0, 2]])
    // Outside the room there is no figure to move.
    await move(x.gc, ch, [0, 0, 0, 1])
    await tick(...all)
    expect(ticks(x.gb)).toHaveLength(4)
    expect(errors(x.gc)).toEqual([])
    // None of this was a WORLD_STATE.
    expect(all.map((gw) => sessions(gw).length)).toEqual(states)
  })

  it('sitting takes a free seat of the room and puts the figure on it; standing up gives the walk back', async () => {
    const x = await setup()
    const { a, b, ch } = x
    await open(x.ga, ch, { kind: 'lounge' })
    await walkIn(x.ga, ch)
    await walkIn(x.gb, ch, x.ga, x.gc)
    const sit = (gw: Gateway, seat: string) => act(gw, { op: 'world_sit', channelId: ch, seat }, x.gc)

    await sit(x.ga, 'sofa:1')
    expect(memberOf(lastSession(x.gc), a)).toMatchObject({ seat: 'sofa:1', pose: seatPose(LOUNGE_ROOM, 'sofa:1') }) // the whole call sees it
    await sit(x.gb, 'sofa:1')
    await sit(x.gb, 'sofa:9') // the sofa has four
    await sit(x.gb, 'tv:0') // nobody sits on the screen
    await sit(x.gb, 'nada:0')
    await sit(x.gc, 'sofa:0')
    expect(errors(x.gb)).toEqual(['seat_taken', 'not_found', 'not_found', 'not_found'].map((reason) => ({ op: 'world_sit', reason })))
    expect(errors(x.gc)).toEqual([{ op: 'world_sit', reason: 'not_inside' }])
    expect(memberOf(lastSession(x.gc), b)!.seat).toBeNull()

    // Seated people do not walk; sitting where one already sits changes nothing.
    let mark = x.gc.events.length
    await move(x.ga, ch, [0, 0, 0, 1])
    await sit(x.ga, 'sofa:1')
    await tick(x.gb, x.gc)
    expect([...got(x.gb, 'WORLD_TICK'), ...sessions(x.gc, mark)]).toEqual([])
    await sit(x.gb, 'sofa:3')
    await sit(x.ga, 'che:0') // from one seat to another
    expect(lastSession(x.gc)!.members.map((m) => [m.seat, m.pose])).toEqual([['che:0', seatPose(LOUNGE_ROOM, 'che:0')], ['sofa:3', seatPose(LOUNGE_ROOM, 'sofa:3')]])
    await sit(x.gb, 'sofa:1') // free again

    mark = x.gc.events.length
    await act(x.ga, { op: 'world_stand', channelId: ch, p: [5000, 5000, 10, 0] }, x.gc)
    const corner: WorldPose = [Math.round((LOUNGE.width / 2 - 0.3) * 100), Math.round((LOUNGE.depth / 2 - 0.3) * 100), 10, 0]
    expect(memberOf(lastSession(x.gc), a)).toMatchObject({ seat: null, pose: corner })
    await act(x.ga, { op: 'world_stand', channelId: ch, p: [0, 0, 0, 0] }, x.gc) // already standing: not a way to jump
    expect(sessions(x.gc, mark)).toHaveLength(1)
    await act(x.gc, { op: 'world_stand', channelId: ch, p: [0, 0, 0, 0] })
    expect(errors(x.gc).at(-1)).toEqual({ op: 'world_stand', reason: 'not_inside' })
  })

  it('looping gestures live in the state until the person moves, rests or sits; one-shots and reactions are events for the people inside', async () => {
    const x = await setup()
    const { a, b, ch } = x
    await open(x.ga, ch, { kind: 'lounge' })
    await walkIn(x.ga, ch)
    await walkIn(x.gb, ch, x.ga, x.gc)
    const emote = (gw: Gateway, kind: 'gesture' | 'reaction', id: string) => act(gw, { op: 'world_emote', channelId: ch, emote: { kind, id } }, x.ga, x.gb, x.gc)
    const loopOf = (u: User) => memberOf(lastSession(x.gc), u)!.loop
    const [ax, az] = spawnPose(LOUNGE, 0)

    await emote(x.ga, 'gesture', 'dance')
    expect(loopOf(a)).toBe('dance')
    let mark = x.gc.events.length
    await emote(x.ga, 'gesture', 'dance') // already dancing
    await move(x.ga, ch, [ax, az, 120, 0]) // turning on the spot is still dancing
    await settled(x.gc)
    expect(sessions(x.gc, mark)).toEqual([])
    await move(x.ga, ch, [ax + 20, az, 120, 1]) // a step ends it
    await settled(x.gc)
    expect(sessions(x.gc, mark)).toHaveLength(1)
    expect(loopOf(a)).toBeNull()

    await emote(x.ga, 'gesture', 'phone')
    expect(loopOf(a)).toBe('phone')
    await act(x.ga, { op: 'world_rest', channelId: ch }, x.gc)
    expect(loopOf(a)).toBeNull()
    mark = x.gc.events.length
    await act(x.ga, { op: 'world_rest', channelId: ch }, x.gc) // nothing to stop
    expect(sessions(x.gc, mark)).toEqual([])
    expect(got(x.ga, 'WORLD_EMOTE')).toEqual([]) // loops are state, not events

    // One-shot gestures and reactions: one event to everyone inside, the sender too; the rest of the call gets none.
    await emote(x.ga, 'gesture', 'wave')
    await emote(x.gb, 'reaction', WORLD_REACTIONS[3])
    const events = [
      { channelId: ch, userId: a.user.id, emote: { kind: 'gesture', id: 'wave' } },
      { channelId: ch, userId: b.user.id, emote: { kind: 'reaction', id: WORLD_REACTIONS[3] } },
    ]
    expect(got(x.ga, 'WORLD_EMOTE')).toEqual(events)
    expect(got(x.gb, 'WORLD_EMOTE')).toEqual(events)
    expect(got(x.gc, 'WORLD_EMOTE')).toEqual([])
    expect(sessions(x.gc, mark)).toEqual([])
    await emote(x.gc, 'gesture', 'wave')
    expect(errors(x.gc)).toEqual([{ op: 'world_emote', reason: 'not_inside' }])

    // Seated: no dancing, but arms folded is fine; sitting down ends a loop.
    await emote(x.gb, 'gesture', 'fold')
    expect(loopOf(b)).toBe('fold')
    await act(x.gb, { op: 'world_sit', channelId: ch, seat: 'sofa:0' }, x.gc)
    expect(memberOf(lastSession(x.gc), b)).toMatchObject({ seat: 'sofa:0', loop: null })
    mark = x.gc.events.length
    await emote(x.gb, 'gesture', 'dance')
    expect(sessions(x.gc, mark)).toEqual([])
    await emote(x.gb, 'gesture', 'fold')
    expect(loopOf(b)).toBe('fold')
  })

  it('gestures and reactions: a few in a row, then slow down', async () => {
    const x = await setup(2)
    const { ch } = x
    await open(x.ga, ch, { kind: 'lounge' })
    await walkIn(x.ga, ch)
    await walkIn(x.gb, ch)
    for (let i = 0; i < 8; i++) x.gb.send({ op: 'world_emote', channelId: ch, emote: { kind: 'reaction', id: WORLD_REACTIONS[i % 2] } })
    await settled(x.gb)
    await settled(x.ga)
    expect(got(x.ga, 'WORLD_EMOTE')).toHaveLength(5)
    expect(errors(x.gb)).toEqual(Array.from({ length: 3 }, () => ({ op: 'world_emote', reason: 'slow_down' })))
    // Each person has their own allowance.
    await act(x.ga, { op: 'world_emote', channelId: ch, emote: { kind: 'gesture', id: 'yes' } }, x.gb)
    expect(got(x.gb, 'WORLD_EMOTE')).toHaveLength(6)
  })

  it('the screen of the room: anyone inside picks whose share is on it; it goes back to automatic when that person leaves the call', async () => {
    const x = await setup() // d is not in the call
    const { b, c, d, ch } = x
    await open(x.ga, ch, { kind: 'lounge' })
    await walkIn(x.ga, ch, x.gb)
    const tv = (gw: Gateway, userId: string | null) => act(gw, { op: 'world_tv', channelId: ch, userId }, x.ga)
    await tv(x.ga, c.user.id) // in the call, not inside: still someone who can share
    expect(lastSession(x.ga)!.tv).toBe(c.user.id)
    await tv(x.ga, d.user.id)
    await tv(x.gb, b.user.id)
    expect([errors(x.ga), errors(x.gb)]).toEqual([[{ op: 'world_tv', reason: 'not_found' }], [{ op: 'world_tv', reason: 'not_inside' }]])
    const mark = x.ga.events.length
    await tv(x.ga, c.user.id) // already on
    expect(sessions(x.ga, mark)).toEqual([])
    await tv(x.ga, null)
    expect(lastSession(x.ga)!.tv).toBeNull()
    await tv(x.ga, c.user.id)
    await quit(ch, c.user.id)
    await settled(x.ga)
    expect(lastSession(x.ga)).toMatchObject({ tv: null, members: [{ k: 0 }] })
    // Someone leaving who was neither inside nor on the screen changes nothing of the world.
    const quiet = x.ga.events.length
    await quit(ch, b.user.id)
    await settled(x.ga)
    expect(sessions(x.ga, quiet)).toEqual([])
  })

  it('a personal room: only its owner opens it; friends-only, locked and a block decide who walks in', async () => {
    const x = await setup(4) // a owns the room, b is a friend, c is not, d blocked a
    const { a, b, c, d, ch } = x
    await befriend(s.app, a, b)
    expect((await call('PUT', `/relationships/${a.user.id}`, d, { type: 'blocked' })).status).toBe(200)
    const mine: WorldPlace = { kind: 'room', ownerId: a.user.id }

    await open(x.gb, ch, mine)
    expect(errors(x.gb)).toEqual([{ op: 'world_open', reason: 'forbidden' }])
    expect(s.app.ctx.worlds.sessionOf(ch)).toBeUndefined()
    await open(x.ga, ch, mine, x.gb, x.gc, x.gd)
    expect(got(x.gc, 'WORLD_ROOM')).toEqual([{
      channelId: ch, place: mine, name: `Sala de ${a.user.displayName}`, access: 'call', rev: 1, ...STARTER_ROOM,
    }])
    expect(lastSession(x.gc)).toMatchObject({ place: mine, hostId: a.user.id, seq: 1 })

    // Open to the call: everyone but whoever has a block with the owner (either way).
    await walkIn(x.gb, ch)
    await walkIn(x.gc, ch)
    await walkIn(x.gd, ch, x.ga)
    expect(errors(x.gd)).toEqual([{ op: 'world_enter', reason: 'forbidden' }])
    expect(lastSession(x.ga)!.members.map((m) => m.userId)).toEqual([b.user.id, c.user.id])
    expect(lastSession(x.ga)!.members[0]!.pose).toEqual(spawnPose(LOFT, 0))

    // Friends only, saved while open: who is not a friend is taken out and told why.
    const room = (await getRoom(a)).body
    expect((await putRoom(a, { ...room, access: 'friends' })).status).toBe(200)
    await settled(x.gc)
    expect(got(x.gc, 'WORLD_REMOVED')).toEqual([{ channelId: ch, reason: 'friends_only' }])
    expect(got(x.gb, 'WORLD_REMOVED')).toEqual([])
    expect(got(x.gc, 'WORLD_ROOM').at(-1)).toMatchObject({ access: 'friends', rev: 2 })
    expect(lastSession(x.gc)!.members.map((m) => m.userId)).toEqual([b.user.id])
    await walkIn(x.gc, ch)
    await walkIn(x.gd, ch)
    expect([errors(x.gc), errors(x.gd).at(-1)]).toEqual([[{ op: 'world_enter', reason: 'friends_only' }], { op: 'world_enter', reason: 'forbidden' }])

    // Locked: nobody but the owner.
    expect((await putRoom(a, { ...room, access: 'locked' })).status).toBe(200)
    await settled(x.gb)
    expect(got(x.gb, 'WORLD_REMOVED')).toEqual([{ channelId: ch, reason: 'locked' }])
    await walkIn(x.gb, ch)
    await walkIn(x.gd, ch)
    expect([errors(x.gb).at(-1), errors(x.gd).at(-1)]).toEqual([{ op: 'world_enter', reason: 'locked' }, { op: 'world_enter', reason: 'locked' }])
    await walkIn(x.ga, ch, x.gb)
    expect(lastSession(x.gb)).toMatchObject({ members: [{ userId: a.user.id, k: 0 }] })
    // Open again, and the owner inside is never the one taken out.
    expect((await putRoom(a, { ...room, access: 'call' })).status).toBe(200)
    await walkIn(x.gc, ch, x.ga)
    expect(lastSession(x.ga)!.members.map((m) => m.userId)).toEqual([a.user.id, c.user.id])
    expect(got(x.ga, 'WORLD_REMOVED')).toEqual([])
  })

  it('moving the world: who may not be in the new place is taken out, the rest arrive again; the owner leaving sends it to the lounge', async () => {
    const x = await setup() // a owns a friends-only room, b is a friend, c is not
    const { a, b, c, ch } = x
    await befriend(s.app, a, b)
    const room = (await getRoom(a)).body
    await putRoom(a, { ...room, access: 'friends' })
    const mine: WorldPlace = { kind: 'room', ownerId: a.user.id }

    await open(x.ga, ch, { kind: 'lounge' })
    for (const gw of [x.gc, x.gb, x.ga]) await walkIn(gw, ch)
    await act(x.gb, { op: 'world_sit', channelId: ch, seat: 'sofa:0' })
    await act(x.ga, { op: 'world_emote', channelId: ch, emote: { kind: 'gesture', id: 'dance' } })
    await act(x.ga, { op: 'world_tv', channelId: ch, userId: c.user.id }, x.gb, x.gc)
    expect(lastSession(x.gc)).toMatchObject({ seq: 7, tv: c.user.id, members: [{ userId: c.user.id, k: 0 }, { userId: b.user.id, k: 1, seat: 'sofa:0' }, { userId: a.user.id, k: 2, loop: 'dance' }] })

    await open(x.ga, ch, mine, x.gb, x.gc)
    expect(got(x.gc, 'WORLD_REMOVED')).toEqual([{ channelId: ch, reason: 'friends_only' }])
    expect([...got(x.ga, 'WORLD_REMOVED'), ...got(x.gb, 'WORLD_REMOVED')]).toEqual([])
    expect(got(x.gc, 'WORLD_ROOM').at(-1)).toMatchObject({ place: mine, access: 'friends', rev: 2, shell: 'loft' })
    expect(lastSession(x.gc)).toEqual({
      channelId: ch, place: mine, hostId: a.user.id, tv: c.user.id, seq: 8,
      members: [
        { userId: b.user.id, k: 1, pose: spawnPose(LOFT, 0), seat: null, loop: null },
        { userId: a.user.id, k: 2, pose: spawnPose(LOFT, 1), seat: null, loop: null },
      ],
    })
    // A move from where they stood in the lounge, already on its way, is not a walk in the new room.
    await move(x.gb, ch, [...seatPose(LOUNGE_ROOM, 'sofa:0').slice(0, 3), 1] as WorldPose)
    expect(memberOf(s.app.ctx.worlds.sessionOf(ch), b)!.pose).toEqual(spawnPose(LOFT, 0))
    await act(x.gb, { op: 'world_sit', channelId: ch, seat: 'sofa:2' }, x.gc)
    expect(memberOf(lastSession(x.gc), b)).toMatchObject({ seat: 'sofa:2', pose: seatPose(STARTER_ROOM, 'sofa:2') })

    // The room is open only while its owner is in the call.
    await quit(ch, a.user.id)
    await settled(x.gb)
    await settled(x.gc)
    expect(got(x.gb, 'WORLD_ROOM').at(-1)).toEqual({ channelId: ch, place: { kind: 'lounge' }, name: 'Lounge', rev: 3, ...LOUNGE_ROOM })
    expect(lastSession(x.gb)).toEqual({
      channelId: ch, place: { kind: 'lounge' }, hostId: a.user.id, tv: c.user.id, seq: 10,
      members: [{ userId: b.user.id, k: 1, pose: spawnPose(LOUNGE, 0), seat: null, loop: null }],
    })
    expect(got(x.gb, 'WORLD_REMOVED')).toEqual([])
    await walkIn(x.gc, ch, x.gb) // and the lounge is everyone's
    expect(lastSession(x.gb)!.members.map((m) => [m.userId, m.k])).toEqual([[b.user.id, 1], [c.user.id, 0]])
  })

  it('the place changes at most every WORLD_PLACE_COOLDOWN_MS', async () => {
    const x = await setup(2)
    const { a, b, ch } = x
    const worlds = s.app.ctx.worlds
    worlds.placeCooldownMs = WORLD_PLACE_COOLDOWN_MS
    try {
      await open(x.ga, ch, { kind: 'lounge' }, x.gb)
      await open(x.gb, ch, { kind: 'room', ownerId: b.user.id })
      await open(x.ga, ch, { kind: 'room', ownerId: a.user.id }, x.gb)
      expect([errors(x.gb), errors(x.ga)]).toEqual([[{ op: 'world_open', reason: 'slow_down' }], [{ op: 'world_open', reason: 'slow_down' }]])
      await open(x.gb, ch, { kind: 'lounge' }) // not a change: no cooldown to wait for
      expect(errors(x.gb)).toHaveLength(1)
      expect(lastSession(x.gb)).toMatchObject({ place: { kind: 'lounge' }, seq: 1 })
      peek(ch).placedAt -= WORLD_PLACE_COOLDOWN_MS
      await open(x.gb, ch, { kind: 'room', ownerId: b.user.id }, x.ga)
      expect(lastSession(x.ga)).toMatchObject({ place: { kind: 'room', ownerId: b.user.id }, hostId: a.user.id, seq: 2 })
      await open(x.ga, ch, { kind: 'lounge' }, x.gb) // and the clock starts again
      expect(errors(x.ga)).toHaveLength(2)
    } finally {
      worlds.placeCooldownMs = 0
    }
  })

  it('saving the room while it is open: the call gets the new layout and whoever sat on a seat that is gone stands up', async () => {
    const x = await setup(2)
    const { a, b, ch } = x
    const room = (await getRoom(a)).body
    await open(x.ga, ch, { kind: 'room', ownerId: a.user.id })
    await walkIn(x.ga, ch)
    await walkIn(x.gb, ch)
    await act(x.gb, { op: 'world_sit', channelId: ch, seat: 'sofa:1' })
    await act(x.ga, { op: 'world_sit', channelId: ch, seat: 'pol:0' }, x.gb)
    expect(lastSession(x.gb)!.members.map((m) => m.seat)).toEqual(['pol:0', 'sofa:1'])

    // No more sofa, and the armchair goes somewhere else.
    const items = room.items.filter((i) => i.id !== 'sofa').map((i) => (i.id === 'pol' ? { ...i, x: 1.5, z: 1.5, rot: 0 } : i))
    const saved = (await putRoom(a, { ...room, name: 'Sala nova', items })).body
    await settled(x.gb)
    expect(got(x.gb, 'WORLD_ROOM').at(-1)).toEqual({
      channelId: ch, place: { kind: 'room', ownerId: a.user.id }, name: 'Sala nova', access: 'call', rev: 2, shell: 'loft', finish: saved.finish, items: saved.items,
    })
    const after = lastSession(x.gb)!
    expect(memberOf(after, b)).toMatchObject({ seat: null, pose: seatPose(STARTER_ROOM, 'sofa:1') }) // standing where the sofa was
    expect(memberOf(after, a)).toMatchObject({ seat: 'pol:0', pose: seatPose(saved, 'pol:0') }) // still seated, where the armchair now is
    await act(x.gb, { op: 'world_sit', channelId: ch, seat: 'sofa:1' })
    expect(errors(x.gb)).toEqual([{ op: 'world_sit', reason: 'not_found' }])
    // Saved again unchanged: still announced, so every app is sure to have the room as saved.
    await putRoom(a, saved)
    await settled(x.gb)
    expect(got(x.gb, 'WORLD_ROOM').at(-1)!.rev).toBe(3)
    // A room that is not open in any call announces nothing.
    const mark = x.gb.events.length
    await putRoom(b, (await getRoom(b)).body)
    await settled(x.gb)
    expect(x.gb.events.length).toBe(mark)
  })

  it('the figure leaves with the socket that walked in; the world ends when the call empties or its channel is deleted', async () => {
    const x = await setup(2)
    const { a, b, ch } = x
    await open(x.ga, ch, { kind: 'lounge' })
    await walkIn(x.ga, ch)
    await walkIn(x.gb, ch, x.ga)
    expect(lastSession(x.ga)!.members).toHaveLength(2)

    // Another socket of b closing is not the one that walked in.
    const other = await connect(s.port, b.token)
    let mark = x.ga.events.length
    other.close()
    await other.closed
    await new Promise((r) => setTimeout(r, 100))
    expect(sessions(x.ga, mark)).toEqual([])
    const gone = next(x.ga, 'WORLD_STATE')
    x.gb.close()
    expect((await gone).session!.members.map((m) => m.userId)).toEqual([a.user.id])
    // b is still in the call: a new socket sees the world and can walk in again (a reconnect).
    const back = await connect(s.port, b.token)
    await act(back, { op: 'world_hello', channelId: ch })
    expect(lastSession(back)!.members).toHaveLength(1)
    await walkIn(back, ch, x.ga)
    expect(lastSession(x.ga)!.members.map((m) => [m.userId, m.k])).toEqual([[a.user.id, 0], [b.user.id, 1]])
    // Walking in again from yet another socket hands the figure over: the old socket closing no longer takes it out.
    const newer = await connect(s.port, b.token)
    await walkIn(newer, ch)
    mark = x.ga.events.length
    back.close()
    await back.closed
    await new Promise((r) => setTimeout(r, 100))
    expect(sessions(x.ga, mark)).toEqual([])

    // The call empties: the world is gone, and the next call starts without one.
    await quit(ch, a.user.id)
    await quit(ch, b.user.id)
    expect(s.app.ctx.worlds.sessionOf(ch)).toBeUndefined()
    await join_(ch, a.user.id)
    mark = x.ga.events.length
    await act(x.ga, { op: 'world_hello', channelId: ch })
    expect(got(x.ga, 'WORLD_STATE', mark)).toEqual([{ channelId: ch, session: null }])

    // The channel itself deleted: whoever was in the call is told there is no world any more.
    await open(x.ga, ch, { kind: 'lounge' })
    const ended = next(x.ga, 'WORLD_STATE', (d) => d.session === null)
    expect((await call('DELETE', `/channels/${ch}`, a)).status).toBe(204)
    expect(await ended).toEqual({ channelId: ch, session: null })
    expect(s.app.ctx.worlds.sessionOf(ch)).toBeUndefined()
  })

  it('world_* frames have their own quota of WORLD_FRAME_LIMIT per 60 s; a malformed one closes the socket', async () => {
    const x = await setup(2)
    const { ch } = x
    await open(x.ga, ch, { kind: 'lounge' })
    for (let i = 0; i < WORLD_FRAME_LIMIT; i++) x.gb.send({ op: 'world_move', channelId: ch, p: [i % 100, 0, 0, 1] })
    for (let i = 0; i < 118; i++) x.gb.send({ op: 'heartbeat' })
    await settled(x.gb) // identify + 118 + this one = the 120 of the general quota, next to 1200 world frames
    expect(x.gb.ws.readyState).toBe(x.gb.ws.OPEN)
    x.gb.send({ op: 'world_move', channelId: ch, p: [0, 0, 0, 1] })
    expect((await x.gb.closed).code).toBe(GatewayClose.RATE_LIMITED)

    x.ga.send({ op: 'world_move', channelId: ch, p: [0, 0, 0, 3] }) // no such gait
    expect((await x.ga.closed).code).toBe(GatewayClose.INVALID_PAYLOAD)
    for (const frame of [
      { op: 'world_open', channelId: ch, place: { kind: 'room' } }, { op: 'world_sit', channelId: ch, seat: '../x' }, { op: 'world_move', channelId: ch, p: [0.5, 0, 0, 0] },
      { op: 'world_emote', channelId: ch, emote: { kind: 'gesture', id: 'moonwalk' } }, { op: 'world_tv', channelId: ch }, { op: 'world_hello', channelId: 'x' },
    ]) {
      const gw = await connect(s.port, x.c.token)
      gw.send(frame)
      expect((await gw.closed).code).toBe(GatewayClose.INVALID_PAYLOAD)
    }
  })
})

describe('the asset pack', () => {
  const get = (path: string, headers: Record<string, string> = {}, ip = '127.0.0.1') =>
    s.app.inject({ method: 'GET', url: `/api/v1/worlds/assets/${path}`, headers, remoteAddress: ip })
  const YEAR = 'public, max-age=31536000, immutable'

  it('serves what the manifest lists, immutable and tagged with its SHA-256, to anyone; the manifest itself for five minutes', async () => {
    const m = await get('manifest.json')
    expect(m.statusCode).toBe(200)
    expect(m.headers['content-type']).toMatch(/^application\/json/)
    expect(m.headers['cache-control']).toBe('public, max-age=300')
    expect(m.headers.etag).toBe(`"${sha(manifest)}"`)
    expect(m.rawPayload.equals(manifest)).toBe(true)

    const model = await get('models/chair.glb')
    expect(model.statusCode).toBe(200)
    expect(model.rawPayload.equals(glb)).toBe(true)
    expect(model.headers).toMatchObject({
      'content-type': 'model/gltf-binary', 'content-length': String(glb.length), 'cache-control': YEAR, etag: `"${sha(glb)}"`,
      'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'cross-origin',
    })
    const texture = await get('textures/oak.webp?v=1')
    expect([texture.statusCode, texture.headers['content-type'], texture.headers.etag]).toEqual([200, 'image/webp', `"${sha(webp)}"`])
    expect(texture.rawPayload.equals(webp)).toBe(true)

    // Revalidation: the tag is the content.
    for (const tag of [`"${sha(glb)}"`, `W/"${sha(glb)}"`, `"other", "${sha(glb)}"`, '*']) {
      const r = await get('models/chair.glb', { 'if-none-match': tag })
      expect([r.statusCode, r.body, r.headers.etag, r.headers['cache-control']]).toEqual([304, '', `"${sha(glb)}"`, YEAR])
    }
    expect((await get('models/chair.glb', { 'if-none-match': `"${sha(webp)}"` })).statusCode).toBe(200)
    expect((await get('manifest.json', { 'if-none-match': `"${sha(manifest)}"` })).statusCode).toBe(304)
  })

  it('the desktop app may fetch it: its page is a file, so its requests come with Origin: null', async () => {
    expect(s.config.corsOrigins).toContain('null')
    for (const origin of ['null', 'http://localhost:5173']) {
      const r = await get('models/chair.glb', { origin })
      expect([r.statusCode, r.headers['access-control-allow-origin']]).toEqual([200, origin])
    }
    const stranger = await get('models/chair.glb', { origin: 'https://evil.example' })
    expect(stranger.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('nothing but the manifest decides what is served: no unlisted file, no way out of the folder, no listed file that is not there', async () => {
    for (const path of [
      'secret.txt', '../secret.txt', '..%2Fsecret.txt', '%2e%2e/secret.txt', 'models/../secret.txt', 'models/..%2F..%2Fsecret.txt', 'models/%2e%2e/secret.txt',
      'models/chair.glb/', 'models//chair.glb', 'MODELS/chair.glb', 'models', '', encodeURIComponent(join(pack, 'secret.txt')), 'models/missing.glb',
    ]) {
      const r = await get(path)
      expect([path, r.statusCode, r.headers['cache-control']]).toEqual([path, 404, undefined])
    }
  })

  it('reads the manifest again when it changes; entries that are not plain paths are never served', async () => {
    const before = (await get('manifest.json')).headers.etag
    expect((await get('sky/noite.hdr')).statusCode).toBe(404)
    manifest = writeManifest({
      files: {
        'models/chair.glb': sha(glb), 'sky/noite.hdr': { sha256: sha(hdr), size: hdr.length }, 'CREDITS.md': { sha256: sha(credits) },
        '../secret.txt': sha('x'), 'models/../secret.txt': sha('x'), '/secret.txt': sha('x'), 'secret.txt': 'not-a-hash', '.hidden': sha('x'),
      },
    })
    const sky = await get('sky/noite.hdr')
    expect([sky.statusCode, sky.headers['content-type'], sky.headers.etag]).toEqual([200, 'application/octet-stream', `"${sha(hdr)}"`])
    expect((await get('CREDITS.md')).headers['content-type']).toMatch(/^text\/markdown/)
    expect((await get('textures/oak.webp')).statusCode).toBe(404) // no longer listed
    for (const path of ['secret.txt', '../secret.txt', 'models/../secret.txt', '/secret.txt', '.hidden']) expect((await get(path)).statusCode).toBe(404)
    const now = await get('manifest.json')
    expect(now.headers.etag).toBe(`"${sha(manifest)}"`)
    expect(now.headers.etag).not.toBe(before)
    // A manifest that cannot be read serves nothing until it is fixed.
    writeFileSync(join(pack, 'manifest.json'), '{ not json')
    expect([(await get('manifest.json')).statusCode, (await get('models/chair.glb')).statusCode]).toEqual([404, 404])
    manifest = writeManifest({ files: [{ path: 'models/chair.glb', sha256: sha(glb) }] })
    expect((await get('models/chair.glb')).statusCode).toBe(200)
  })

  it('has its own rate limit: 600 a minute per address', async () => {
    const tag = { 'if-none-match': `"${sha(glb)}"` }
    const codes = new Set<number>()
    for (let i = 0; i < 600; i++) codes.add((await get('models/chair.glb', tag, '10.99.0.1')).statusCode)
    expect([...codes]).toEqual([304])
    expect((await get('models/chair.glb', tag, '10.99.0.1')).statusCode).toBe(429)
    expect((await get('models/chair.glb', tag, '10.99.0.2')).statusCode).toBe(304)
  })

  it('without a pack the server still starts, and the route answers 404', async () => {
    const bare = await startServer({ WORLDS_ASSETS_DIR: join(pack, 'not-there') })
    try {
      expect((await bare.app.inject({ method: 'GET', url: '/api/v1/worlds/assets/manifest.json' })).statusCode).toBe(404)
      expect((await bare.app.inject({ method: 'GET', url: '/api/v1/worlds/assets/models/chair.glb' })).statusCode).toBe(404)
      const gw = await connect(bare.port, (await register(bare.app)).token)
      expect((gw.events.find((e) => e.t === 'READY')!.d as { worlds?: unknown }).worlds).toEqual({ assetsUrl: '/api/v1/worlds/assets' })
    } finally {
      await bare.close()
    }
  })
})

describe('privacy', () => {
  it('the data export carries the room and the figure; both go away with the account', async () => {
    const u = await register(s.app)
    const fresh = await s.app.ctx.privacy.collect(u.user.id, new Date()) as { worlds: unknown }
    expect(fresh.worlds).toEqual({ avatar: null, room: null }) // never opened Worlds: nothing was made for them
    const room = (await getRoom(u)).body
    const saved = (await putRoom(u, { ...room, name: 'Meu canto', access: 'friends', items: [item('puf', 'w_pufe_couro', { x: 1, z: 1 })] })).body
    await putAvatar(u, FIGURE)
    const data = await s.app.ctx.privacy.collect(u.user.id, new Date()) as { worlds: unknown }
    expect(data.worlds).toEqual({
      avatar: FIGURE,
      room: { name: 'Meu canto', access: 'friends', shell: 'loft', finish: saved.finish, items: [{ id: 'puf', sku: 'w_pufe_couro', x: 1, y: 0, z: 1, rot: 0 }], updatedAt: saved.updatedAt },
    })
    await s.app.ctx.db.delete(users).where(eq(users.id, u.user.id))
    expect(await s.app.ctx.db.select().from(worldRooms).where(eq(worldRooms.ownerId, u.user.id))).toEqual([])
  })
})
