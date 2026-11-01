// E2EE Delivery Service (src/e2ee.ts) end to end: devices are the real native/mls WASM driven by the desktop's own
// client controller (apps/desktop/src/main/mls/session.ts), talking to this server over REST and the gateway.
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  E2EE_FRAME_LIMIT, GatewayClose, deviceIdentity,
  type AuthResponse, type ClaimedKeyPackages, type E2eeDevice, type Invite, type ServerFrame, type SpaceSnapshot,
} from '@alga/shared'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRunner, type Glue, type MlsMethod } from '../../desktop/src/main/mls/rpc.js'
import { E2eeSession } from '../../desktop/src/main/mls/session.js'
import type { E2eeEpochInfo } from '../../desktop/src/shared/bridge.js'
import { loadConfig, serverRoot } from '../src/config.js'
import { deviceKeys, keyPackages } from '../src/db/schema.js'
import { loadMls } from '../src/e2ee.js'
import { api, connect, freshIp, postWebhook, register, startServer, type Gateway, type TestServer } from './helpers.js'

const glue = loadMls(join(serverRoot, '..', '..', 'native', 'mls', 'pkg'))
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const enc = (s: string) => new Uint8Array(Buffer.from(s))

let s: TestServer
beforeAll(async () => { s = await startServer() })
afterAll(async () => { await s.close() })

async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 8000): Promise<void> {
  const end = Date.now() + ms
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out: ${what}`)
    await new Promise((r) => setTimeout(r, 15))
  }
}

let seq = 0
const joined = (channelId: string, userId: string) => postWebhook(s.app, s.config, {
  event: 'participant_joined', id: `E2_${++seq}`, createdAt: String(Math.floor(Date.now() / 1000)),
  room: { sid: 'RM_e2ee', name: `ch_${channelId}` }, participant: { sid: `PA_${seq}`, identity: userId, name: 'x', joinedAt: String(Math.floor(Date.now() / 1000)) },
})
const left = (channelId: string, userId: string) => postWebhook(s.app, s.config, {
  event: 'participant_left', id: `E2_${++seq}`, createdAt: String(Math.floor(Date.now() / 1000)),
  room: { sid: 'RM_e2ee', name: `ch_${channelId}` }, participant: { sid: `PA_${seq}`, identity: userId, name: 'x' },
})

/** n users in one space, all in its voice channel (as LiveKit would report). */
async function room(n: number) {
  const users = await Promise.all(Array.from({ length: n }, () => register(s.app)))
  const space = (await api<SpaceSnapshot>(s.app, 'POST', '/spaces', { token: users[0]!.token, body: { name: 'E2EE' } })).body
  const inv = (await api<Invite>(s.app, 'POST', `/spaces/${space.id}/invites`, { token: users[0]!.token, body: {} })).body
  for (const u of users.slice(1)) await api(s.app, 'POST', `/invites/${inv.code}`, { token: u.token })
  const voice = space.channels.find((c) => c.type === 'voice')!
  for (const u of users) expect((await joined(voice.id, u.user.id)).status).toBe(200)
  return { users, space, voice }
}

/** A desktop device: WASM client + the main-process session controller + a gateway socket relaying E2EE_* to it. */
class Device {
  readonly keys = new Map<string, string>()
  readonly epochs: E2eeEpochInfo[] = []
  readonly deviceId = randomUUID()
  readonly call: (method: MlsMethod, ...args: unknown[]) => Promise<unknown>
  session!: E2eeSession
  gw!: Gateway

  private constructor(readonly user: AuthResponse) {
    const run = createRunner(glue as unknown as Glue)
    const handle = run({ op: 'new', bytes: enc(deviceIdentity(user.user.id, this.deviceId)) }) as number
    this.call = async (method, ...args) => run({ op: 'call', handle, method, args })
  }

  static async open(user: AuthResponse, pool = 3): Promise<Device> {
    const d = new Device(user)
    expect((await d.register()).status).toBe(201)
    await d.upload(pool)
    d.gw = await connect(s.port, user.token)
    d.session = new E2eeSession({
      mls: d.call,
      send: (frame) => d.gw.send(frame),
      onKey: (k) => d.keys.set(`${k.epoch}:${k.userId}`, hex(k.key)),
      onEpoch: (e) => d.epochs.push(e),
      replenish: async (exhausted) => { if (exhausted) await d.upload(3) },
      reregister: async () => { await d.register(); await d.upload(3) },
      log: () => {},
      retryMs: 0,
    }, user.user.id, d.deviceId)
    d.gw.ws.on('message', (raw) => {
      const f = JSON.parse(raw.toString()) as ServerFrame
      if (f.op === 'dispatch' && f.t.startsWith('E2EE_')) void d.session.handleDispatch(f.t, f.d)
    })
    return d
  }

  get id() { return this.user.user.id }
  get state() { return this.session.current }

  async register() {
    return api<E2eeDevice>(s.app, 'POST', '/e2ee/devices', {
      token: this.user.token, body: { deviceId: this.deviceId, signatureKey: b64((await this.call('signature_public_key')) as Uint8Array) },
    })
  }

  async upload(n: number) {
    const keyPackages: string[] = []
    for (let i = 0; i < n; i++) keyPackages.push(b64((await this.call('key_package')) as Uint8Array))
    return api<{ keyPackages: number }>(s.app, 'POST', `/e2ee/devices/${this.deviceId}/key-packages`, { token: this.user.token, body: { keyPackages } })
  }

  async secret(): Promise<string> {
    return hex((await this.call('export_secret', 'probe', enc('ctx'), 32)) as Uint8Array)
  }
}

/** Every device sends with the same epoch (the DS's E2EE_EPOCH reached them all). */
const settled = (ds: Device[]) => until(`settled: ${ds.map((d) => JSON.stringify(d.state)).join(' ')}`, () => {
  const e = ds[0]!.state?.epoch
  return ds.every((d) => d.state?.state === 'active' && d.state.epoch === e && d.epochs.at(-1)?.epoch === e)
})

describe('E2EE call through the Delivery Service', () => {
  it('three devices agree on every sender key; a kicked member is removed at once and cannot follow', async () => {
    const { users, space, voice } = await room(3)
    const [a, b, c] = await Promise.all(users.map((u) => Device.open(u)))
    await a!.session.joinCall(voice.id)
    await settled([a!])
    await b!.session.joinCall(voice.id)
    await settled([a!, b!])
    await c!.session.joinCall(voice.id)
    await settled([a!, b!, c!])

    const all = [a!, b!, c!]
    const epoch = a!.state!.epoch
    expect(epoch).toBe(2) // creation, + b, + c
    expect(s.app.ctx.e2ee.epochOf(voice.id)).toBe(epoch)
    // Each sender's key (its own, from the exporter) is what every receiver installed for it.
    for (const u of users) {
      const seen = new Set(all.map((d) => d.keys.get(`${epoch}:${u.user.id}`)))
      expect(seen.size).toBe(1)
      expect([...seen][0]).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(new Set(await Promise.all(all.map((d) => d.secret()))).size).toBe(1)
    const codes = await Promise.all(all.map((d) => d.session.verificationCode(voice.id)))
    expect(new Set(codes).size).toBe(1)
    expect(codes[0]).toMatch(/^\d{5}( \d{5}){5}$/)
    const ab = await a!.session.verificationCode(voice.id, b!.id)
    expect(ab).toMatch(/^\d{5}( \d{5}){8}$/)
    expect(await b!.session.verificationCode(voice.id, a!.id)).toBe(ab)
    expect(await a!.session.verificationCode(voice.id, c!.id)).not.toBe(ab)
    expect(a!.epochs.at(-1)!.members.map((m) => m.userId).sort()).toEqual(users.map((u) => u.user.id).sort())

    // Kick: the DS proposes the Remove from the moderation path itself, not from a LiveKit webhook.
    const before = await a!.secret()
    const cKeys = new Set(c!.keys.values())
    expect((await api(s.app, 'DELETE', `/spaces/${space.id}/members/${c!.id}`, { token: a!.user.token })).status).toBe(204)
    await until('c removed', () => c!.state?.state === 'removed')
    await settled([a!, b!])
    const next = a!.state!.epoch
    expect(next).toBe(epoch + 1)
    expect(c!.epochs.at(-1)).toMatchObject({ state: 'removed' })
    for (const u of [a!, b!]) {
      const k = a!.keys.get(`${next}:${u.id}`)
      expect(k).toBe(b!.keys.get(`${next}:${u.id}`))
      expect(cKeys.has(k!)).toBe(false)
    }
    expect([...c!.keys.keys()].some((k) => k.startsWith(`${next}:`))).toBe(false)
    await expect(c!.call('export_secret', 'probe', enc('ctx'), 32)).rejects.toThrow(/no group/)
    expect(await a!.secret()).toBe(await b!.secret())
    expect(await a!.secret()).not.toBe(before)
    expect(a!.epochs.at(-1)!.members.map((m) => m.userId).sort()).toEqual([a!.id, b!.id].sort())

    // Leaving voice (LiveKit webhook) removes the leaf too; the last one stays alone at a new epoch.
    expect((await left(voice.id, b!.id)).status).toBe(200)
    await until('b gone', () => a!.state!.epoch === next + 1 && a!.epochs.at(-1)!.members.length === 1)
    for (const d of all) d.gw.close()
  })

  it('a device that lost its state resyncs: same user, one leaf, new keys', async () => {
    const { users, voice } = await room(2)
    const [a, b] = await Promise.all(users.map((u) => Device.open(u)))
    await a!.session.joinCall(voice.id)
    await settled([a!])
    await b!.session.joinCall(voice.id)
    await settled([a!, b!])
    const e = a!.state!.epoch
    // As after an app restart: the device registers again (pool emptied, old leaf dropped) and re-joins.
    expect((await b!.register()).status).toBe(200)
    await b!.upload(2)
    await b!.session.leaveCall(voice.id)
    await b!.session.joinCall(voice.id)
    await settled([a!, b!])
    expect(a!.state!.epoch).toBeGreaterThan(e)
    expect(a!.epochs.at(-1)!.members.map((m) => m.userId).sort()).toEqual([a!.id, b!.id].sort())
    expect(await a!.secret()).toBe(await b!.secret())
    for (const d of [a!, b!]) d.gw.close()
  })
})

/** Raw protocol driving (no session controller), to stage races exactly. */
describe('Delivery Service ordering and validation', () => {
  class Raw {
    readonly client: InstanceType<typeof glue.Client>
    readonly deviceId = randomUUID()
    gw!: Gateway
    constructor(readonly user: AuthResponse) {
      this.client = new glue.Client(enc(deviceIdentity(user.user.id, this.deviceId)))
    }
    static async open(user: AuthResponse) {
      const r = new Raw(user)
      await api(s.app, 'POST', '/e2ee/devices', { token: user.token, body: { deviceId: r.deviceId, signatureKey: b64(r.client.signature_public_key()) } })
      await api(s.app, 'POST', `/e2ee/devices/${r.deviceId}/key-packages`, { token: user.token, body: { keyPackages: [b64(r.client.key_package()), b64(r.client.key_package())] } })
      r.gw = await connect(s.port, user.token)
      return r
    }
  }
  const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))
  const take = (c: { commit: Uint8Array; welcome?: Uint8Array; free(): void }) => {
    const out = { commit: c.commit, welcome: c.welcome }
    c.free()
    return out
  }

  it('the first valid commit of an epoch wins; a racing, stale or tampered one is refused', async () => {
    const { users, voice } = await room(3)
    const [a, b, c] = await Promise.all(users.map((u) => Raw.open(u)))
    const ch = voice.id
    a!.gw.send({ op: 'e2ee_join', channelId: ch, deviceId: a!.deviceId })
    const create = await a!.gw.waitFor('E2EE_EPOCH', (d) => d.channelId === ch && d.create)
    a!.client.create_group(enc(ch), bytes(create.externalSender.publicKey), enc(create.externalSender.identity))
    a!.gw.send({ op: 'e2ee_group_info', channelId: ch, groupInfo: b64(a!.client.group_info()) })

    b!.gw.send({ op: 'e2ee_join', channelId: ch, deviceId: b!.deviceId })
    const p0 = await a!.gw.waitFor('E2EE_PROPOSALS', (d) => d.channelId === ch && d.epoch === 0)
    expect(p0.committerLeaf).toBe(0)
    for (const p of p0.proposals) expect(a!.client.process(bytes(p))).toBe('proposal')
    const c0 = take(a!.client.commit_pending())
    a!.gw.send({ op: 'e2ee_commit', channelId: ch, epoch: 0, commit: b64(c0.commit), welcome: b64(c0.welcome!) })
    const w = await b!.gw.waitFor('E2EE_WELCOME', (d) => d.channelId === ch)
    expect(a!.client.process(bytes((await a!.gw.waitFor('E2EE_COMMIT', (d) => d.epoch === 0)).commit))).toBe('commit')
    b!.client.process_welcome(bytes(w.welcome))
    b!.gw.send({ op: 'e2ee_welcome_ack', channelId: ch, epoch: 1 })
    await b!.gw.waitFor('E2EE_EPOCH', (d) => d.channelId === ch && d.epoch === 1)

    // c joins: both members get the Add; both commit it (a would be the committer, b races it and gets there first).
    c!.gw.send({ op: 'e2ee_join', channelId: ch, deviceId: c!.deviceId })
    const [pa, pb] = await Promise.all([a!, b!].map((m) => m.gw.waitFor('E2EE_PROPOSALS', (d) => d.epoch === 1)))
    for (const p of pa!.proposals) a!.client.process(bytes(p))
    for (const p of pb!.proposals) b!.client.process(bytes(p))
    const fromA = take(a!.client.commit_pending())
    const fromB = take(b!.client.commit_pending())
    const forged = fromB.commit.slice()
    forged[20] = forged[20]! ^ 1
    b!.gw.send({ op: 'e2ee_commit', channelId: ch, epoch: 1, commit: b64(forged), welcome: b64(fromB.welcome!) })
    await b!.gw.waitFor('E2EE_RESYNC_REQUIRED', (d) => d.reason === 'commit_rejected')
    const rejections = (r: Raw) => r.gw.events.filter((e) => e.t === 'E2EE_RESYNC_REQUIRED').length
    // Both real commits at once: whichever the DS sees first is ordered, the other one is refused.
    b!.gw.send({ op: 'e2ee_commit', channelId: ch, epoch: 1, commit: b64(fromB.commit), welcome: b64(fromB.welcome!) })
    a!.gw.send({ op: 'e2ee_commit', channelId: ch, epoch: 1, commit: b64(fromA.commit), welcome: b64(fromA.welcome!) })
    const won = await a!.gw.waitFor('E2EE_COMMIT', (d) => d.epoch === 1)
    expect((await b!.gw.waitFor('E2EE_COMMIT', (d) => d.epoch === 1)).commit).toBe(won.commit)
    await until('one loser', () => rejections(a!) + rejections(b!) === 2)
    const winner = won.commit === b64(fromA.commit) ? fromA : fromB
    expect(won.commit).toBe(b64(winner.commit))
    await c!.gw.expectNone('E2EE_COMMIT') // not a member of epoch 1
    expect(a!.gw.events.filter((e) => e.t === 'E2EE_COMMIT' && (e.d as { epoch: number }).epoch === 1)).toHaveLength(1)
    const welcomes = c!.gw.events.filter((e) => e.t === 'E2EE_WELCOME')
    expect(welcomes).toHaveLength(1)
    expect((welcomes[0]!.d as { welcome: string }).welcome).toBe(b64(winner.welcome!))
    // The loser follows the winner (merging it discards its own pending commit); everyone agrees.
    expect(a!.client.process(bytes(won.commit))).toBe('commit')
    expect(b!.client.process(bytes(won.commit))).toBe('commit')
    c!.client.process_welcome(bytes((welcomes[0]!.d as { welcome: string }).welcome))
    const probe = (r: Raw) => hex(r.client.export_secret('probe', enc('x'), 32))
    expect(new Set([a!, b!, c!].map(probe)).size).toBe(1)
    expect(s.app.ctx.e2ee.epochOf(ch)).toBe(2)
    // A replay for the old epoch changes nothing.
    a!.gw.send({ op: 'e2ee_commit', channelId: ch, epoch: 1, commit: b64(fromA.commit), welcome: b64(fromA.welcome!) })
    await until('replay refused', () => rejections(a!) + rejections(b!) === 3)
    expect(s.app.ctx.e2ee.epochOf(ch)).toBe(2)
    for (const r of [a!, b!, c!]) r.gw.close()
  })

  it('refuses unknown devices, calls without access and non-members; e2ee frames have their own size and quota', async () => {
    const { users, voice } = await room(1)
    const outsider = await register(s.app)
    const me = await Raw.open(users[0]!)
    me.gw.send({ op: 'e2ee_join', channelId: voice.id, deviceId: randomUUID() })
    expect((await me.gw.waitFor('E2EE_RESYNC_REQUIRED')).reason).toBe('unknown_device')
    const stranger = await Raw.open(outsider)
    stranger.gw.send({ op: 'e2ee_join', channelId: voice.id, deviceId: stranger.deviceId })
    expect((await stranger.gw.waitFor('E2EE_RESYNC_REQUIRED')).reason).toBe('forbidden')
    // A 21 KB e2ee frame is legal (answered, not closed); that size on any other op closes the socket.
    stranger.gw.send({ op: 'e2ee_commit', channelId: voice.id, epoch: 0, commit: 'A'.repeat(21_000) })
    await until('not_member', () => stranger.gw.events.filter((e) => e.t === 'E2EE_RESYNC_REQUIRED').length === 2)
    expect(stranger.gw.events.at(-1)).toMatchObject({ d: { reason: 'not_member' } })
    stranger.gw.send({ op: 'heartbeat', pad: 'x'.repeat(17 * 1024) })
    expect((await stranger.gw.closed).code).toBe(GatewayClose.INVALID_PAYLOAD)
    for (let i = 0; i <= E2EE_FRAME_LIMIT; i++) me.gw.send({ op: 'e2ee_welcome_ack', channelId: voice.id, epoch: 0 })
    expect((await me.gw.closed).code).toBe(GatewayClose.RATE_LIMITED)
  })
})

describe('E2EE devices and key packages', () => {
  it('registers per session, validates every key package and drops them all with the session', async () => {
    const u = await register(s.app)
    const other = await register(s.app)
    const deviceId = randomUUID()
    const client = new glue.Client(enc(deviceIdentity(u.user.id, deviceId)))
    const signatureKey = b64(client.signature_public_key())
    const reg = await api<E2eeDevice>(s.app, 'POST', '/e2ee/devices', { token: u.token, body: { deviceId, signatureKey } })
    expect(reg.status).toBe(201)
    expect(reg.body).toMatchObject({ userId: u.user.id, deviceId, signatureKey, keyPackages: 0 })
    const up = (keyPackages: string[], token = u.token, id = deviceId) => api(s.app, 'POST', `/e2ee/devices/${id}/key-packages`, { token, body: { keyPackages } })
    expect((await up([b64(client.key_package()), b64(client.key_package())])).body).toEqual({ keyPackages: 2 })

    // Someone else's key package, a forged one, garbage, another session or user: refused.
    const foreign = new glue.Client(enc(deviceIdentity(other.user.id, deviceId)))
    expect((await up([b64(client.key_package()), b64(foreign.key_package())])).body.error.fields).toHaveProperty(['keyPackages.1'])
    const mine = client.key_package()
    mine[mine.length - 1] = mine[mine.length - 1]! ^ 1
    expect((await up([b64(mine)])).status).toBe(400)
    expect((await up(['AAAA'])).status).toBe(400)
    expect((await up([b64(client.key_package())], other.token)).status).toBe(404)
    const second = await api<AuthResponse>(s.app, 'POST', '/auth/login', { ip: freshIp(), body: { login: u.user.username, password: u.password } })
    expect((await up([b64(client.key_package())], second.body.token)).status).toBe(404)
    expect((await api(s.app, 'POST', '/e2ee/devices', { token: u.token, body: { deviceId, signatureKey: 'short' } })).status).toBe(400)

    // Pool cap.
    const batch = (n: number) => Array.from({ length: n }, () => b64(client.key_package()))
    expect((await up(batch(50))).body).toEqual({ keyPackages: 52 })
    expect((await up(batch(49))).status).toBe(409)

    // Registering again empties the pool; logging out deletes the device (and its key packages).
    expect((await api(s.app, 'POST', '/e2ee/devices', { token: u.token, body: { deviceId, signatureKey } })).status).toBe(200)
    expect((await up(batch(1))).body).toEqual({ keyPackages: 1 })
    expect((await api(s.app, 'POST', '/auth/logout', { token: u.token })).status).toBe(204)
    const db = s.app.ctx.db
    expect(await db.select().from(deviceKeys).where(eq(deviceKeys.userId, u.user.id))).toHaveLength(0)
    expect(await db.select().from(keyPackages).where(eq(keyPackages.userId, u.user.id))).toHaveLength(0)

    // DELETE: own device only.
    const fresh = new glue.Client(enc(deviceIdentity(other.user.id, deviceId)))
    await api(s.app, 'POST', '/e2ee/devices', { token: other.token, body: { deviceId, signatureKey: b64(fresh.signature_public_key()) } })
    expect((await api(s.app, 'DELETE', `/e2ee/devices/${deviceId}`, { token: second.body.token })).status).toBe(404)
    expect((await api(s.app, 'DELETE', `/e2ee/devices/${deviceId}`, { token: other.token })).status).toBe(204)
    expect(await db.select().from(deviceKeys).where(and(eq(deviceKeys.userId, other.user.id), eq(deviceKeys.deviceId, deviceId)))).toHaveLength(0)
    for (const c of [client, foreign, fresh]) c.free()
  })

  it('key packages are single use: concurrent claims never share one; an empty pool makes the device upload more', async () => {
    const { users, voice } = await room(2)
    const stranger = await register(s.app)
    const [host, guest] = await Promise.all([Device.open(users[0]!), Device.open(users[1]!, 5)])
    expect((await api(s.app, 'GET', `/e2ee/users/${guest.id}/key-packages`, { token: stranger.token })).status).toBe(404)
    const claims = await Promise.all(Array.from({ length: 10 }, () =>
      api<ClaimedKeyPackages>(s.app, 'GET', `/e2ee/users/${guest.id}/key-packages`, { token: host.user.token })))
    expect(claims.every((c) => c.status === 200)).toBe(true)
    const got = claims.flatMap((c) => c.body.keyPackages)
    expect(got).toHaveLength(5)
    expect(new Set(got.map((k) => k.keyPackage)).size).toBe(5)
    expect(got.every((k) => k.deviceId === guest.deviceId)).toBe(true)

    // Pool empty: the DS answers no_key_package, the device uploads and joins.
    await host.session.joinCall(voice.id)
    await settled([host])
    await guest.session.joinCall(voice.id)
    await settled([host, guest])
    expect(guest.gw.events.some((e) => e.t === 'E2EE_RESYNC_REQUIRED' && (e.d as { reason: string }).reason === 'no_key_package')).toBe(true)
    expect(await host.secret()).toBe(await guest.secret())
    for (const d of [host, guest]) d.gw.close()
  })
})

describe('E2EE configuration', () => {
  it('production needs its own Delivery Service key (32 bytes); dev/test get a random one per process', () => {
    const PROD = {
      NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db:5432/alga', CORS_ORIGINS: 'null', LIVEKIT_API_KEY: 'k',
      LIVEKIT_API_SECRET: 'a-real-production-secret-0123456789abcdef', PUBLIC_URL: 'https://api.example.com',
      FILES_SECRET: 's'.repeat(32), STORAGE_DRIVER: 'local', EMAIL_DRIVER: 'console', ALGA_ALLOW_CONSOLE_EMAIL: '1',
    }
    expect(() => loadConfig(PROD)).toThrow(/E2EE_DS_KEY/)
    expect(() => loadConfig({ ...PROD, E2EE_DS_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/E2EE_DS_KEY/)
    const seed = Buffer.alloc(32, 7)
    expect(loadConfig({ ...PROD, E2EE_DS_KEY: seed.toString('base64') }).e2ee.dsSeed).toEqual(seed)
    expect(loadConfig({ NODE_ENV: 'test' }).e2ee.dsSeed).not.toEqual(loadConfig({ NODE_ENV: 'test' }).e2ee.dsSeed)
    expect(s.app.ctx.e2ee.externalSender).toMatchObject({ identity: 'alga-ds', publicKey: expect.stringMatching(/^[A-Za-z0-9+/]{43}=$/) })
  })
})
