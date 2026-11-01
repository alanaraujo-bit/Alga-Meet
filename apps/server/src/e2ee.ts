/**
 * E2EE Delivery Service (docs/decisions/0004-e2ee.md §3.3; contract and call flow in packages/shared/src/e2ee.ts).
 * The server orders the MLS handshake of each call and is every group's only external sender, but never holds a group
 * secret: per call it keeps the public state (OpenMLS PublicGroup via native/mls), the membership changes still to be
 * committed and who commits them. Device keys and key packages (public) live in Postgres.
 * shortcut: groups are in memory, single instance (like Voice and Hub). A restart drops them and clients rebuild them
 * (they re-send e2ee_join on every READY). Shared state comes with the Redis plan.
 * What a malicious server can still do: docs/security/e2ee-delivery-service.md.
 */
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import {
  E2EE_COMMIT_TIMEOUT_MS, E2EE_DS_IDENTITY, E2EE_JOIN_GRACE_MS, E2EE_MAX_DEVICES_PER_USER, E2EE_MAX_KEY_PACKAGE_BYTES,
  E2EE_MAX_KEY_PACKAGES_PER_DEVICE, E2EE_WELCOME_ACK_TIMEOUT_MS, Permission, deviceIdentity,
  type ClaimedKeyPackages, type DispatchOf, type DispatchType, type E2eeClientFrame, type E2eeDevice, type E2eeEpoch,
  type E2eeExternalSender, type E2eeResyncReason, type RegisterDeviceBody,
} from '@alga/shared'
import { and, asc, count, eq, inArray, lte, sql } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import type * as Glue from '../../../native/mls/pkg/alga_mls.js'
import { assertDmNotBlocked, isBlockedBetween, profileAudience, requireChannel, sharesSpace } from './access.js'
import type { Config } from './config.js'
import type { Db, Tx } from './db/index.js'
import { deviceKeys, keyPackages, type DeviceKeyRow } from './db/schema.js'
import { HttpError, conflict, invalid, notFound, safeErr } from './errors.js'
import type { Conn, Hub } from './gateway/hub.js'
import { metrics } from './metrics.js'
import type { Voice } from './voice.js'

type Mls = typeof Glue

/** The wasm-bindgen glue (CommonJS, reads alga_mls_bg.wasm next to itself). */
export const loadMls = (dir: string): Mls => createRequire(import.meta.url)(join(dir, 'alga_mls.js')) as Mls

/** No group info from the asked creator within this: the group is reset. */
const CREATE_TIMEOUT_MS = 5_000
/** Commit timeouts in one epoch before the group is reset (every member re-joins). */
const MAX_STALLS = 3

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')
const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Raw Ed25519 public key of a 32-byte seed (PKCS#8 wrapping of RFC 8410). */
function ed25519Public(seed: Buffer): Buffer {
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' })
  return createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32)
}

/** native/mls `export_identity` blob: "AMI1" ‖ (u32 BE length ‖ bytes) × identity, private seed, public key. */
function identityBlob(identity: string, seed: Buffer, pub: Buffer): Uint8Array {
  const field = (b: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(b.length)
    return [len, b]
  }
  return new Uint8Array(Buffer.concat([Buffer.from('AMI1'), ...field(Buffer.from(identity)), ...field(seed), ...field(pub)]))
}

interface Leaf { leaf: number; userId: string; deviceId: string; signatureKey: string }

/** Parses native/mls `members()` JSON. A leaf whose identity is not `userId:deviceId` keeps empty ids (never matches). */
export function parseMembers(json: string): Leaf[] {
  return (JSON.parse(json) as { leaf: number; identity: string; signatureKey: string }[]).map((m) => {
    const [userId = '', deviceId = '', extra] = Buffer.from(m.identity, 'hex').toString('utf8').split(':')
    const ok = extra === undefined && UUID_RE.test(userId) && UUID_RE.test(deviceId)
    return { leaf: m.leaf, userId: ok ? userId : '', deviceId: ok ? deviceId : '', signatureKey: m.signatureKey }
  })
}

/**
 * A membership change the DS still has to get committed; re-proposed every epoch until a commit covers it. A proposal
 * cannot be withdrawn within its epoch, so an Add that is no longer wanted after it went out is only `cancelled`: if a
 * commit still covers it, the new leaf is removed right in the next epoch.
 */
type Intent = { userId: string; deviceId: string; proposal?: string } & (
  | { kind: 'add'; keyPackage: Uint8Array; ref: string; cancelled?: boolean }
  | { kind: 'remove'; leaf: number }
)

interface Group {
  channelId: string
  gid: Uint8Array
  /** Public state; null until the creator's GroupInfo arrives. */
  call: Glue.PublicCall | null
  /** While `call` is null: the device asked to create the group. */
  creator: { userId: string; deviceId: string } | null
  members: Leaf[]
  /** Devices that can commit: the creator, and welcomed devices that acked. */
  ready: Set<string>
  intents: Intent[]
  committer: number | null
  /** Committers that let this epoch's commit time out. */
  skipped: Set<number>
  stalls: number
  /** Devices added by the last commit that have not acked their Welcome. */
  awaiting: Set<string>
  timer?: NodeJS.Timeout
  ackTimer?: NodeJS.Timeout
}

export class E2ee {
  /** Null when native/mls/pkg could not be loaded: E2EE is off (REST 503, e2ee_* answered `unavailable`). */
  readonly mls: Mls | null
  readonly externalSender: E2eeExternalSender | null = null
  private readonly ds: Glue.Client | null = null
  private readonly dsKey: Uint8Array = new Uint8Array()
  private readonly groups = new Map<string, Group>()
  private readonly locks = new Map<string, Promise<unknown>>()
  /** `userId:channelId` → check that the e2ee_join was followed by a voice state. */
  private readonly graces = new Map<string, NodeJS.Timeout>()

  constructor(config: Config, private readonly db: Db, private readonly hub: Hub, private readonly voice: Voice, private readonly log: FastifyBaseLogger) {
    let mls: Mls | null = null
    try {
      mls = loadMls(config.e2ee.mlsPkg)
      const pub = ed25519Public(config.e2ee.dsSeed)
      this.ds = mls.Client.from_identity(identityBlob(E2EE_DS_IDENTITY, config.e2ee.dsSeed, pub))
      this.dsKey = new Uint8Array(pub)
      this.externalSender = { publicKey: b64(pub), identity: E2EE_DS_IDENTITY }
    } catch (err) {
      mls = null
      log.error({ err: safeErr(err), dir: config.e2ee.mlsPkg }, 'e2ee: MLS module unavailable, E2EE disabled (run sh native/mls/build.sh)')
    }
    this.mls = mls
    voice.onLeave = (userId, channelId) => this.left(userId, channelId)
  }

  stop(): void {
    for (const g of this.groups.values()) this.drop(g)
    for (const t of this.graces.values()) clearTimeout(t)
    this.graces.clear()
  }

  // ---- REST: devices and key packages -------------------------------------------------------------------------------

  available(): void {
    if (!this.mls) throw new HttpError('internal', 'Criptografia de ponta a ponta indisponível neste servidor.', undefined, 503)
  }

  /** POST /e2ee/devices. Every registration empties the pool (the client holds key package secrets in memory only). */
  async registerDevice(userId: string, sessionId: string, body: RegisterDeviceBody): Promise<{ device: E2eeDevice; created: boolean }> {
    this.available()
    const { deviceId, signatureKey } = body
    const { device, created, gone } = await this.underUserLock(userId, async (tx) => {
      const mine = await tx.select().from(deviceKeys).where(eq(deviceKeys.userId, userId))
      const same = mine.find((d) => d.deviceId === deviceId)
      // A session holds one device; registering another replaces it.
      const replaced = mine.filter((d) => d.sessionId === sessionId && d.deviceId !== deviceId)
      if (!same && mine.length - replaced.length >= E2EE_MAX_DEVICES_PER_USER) {
        throw conflict(`No máximo ${E2EE_MAX_DEVICES_PER_USER} dispositivos com criptografia por conta. Saia de um deles.`)
      }
      if (replaced.length) {
        await tx.delete(deviceKeys).where(and(eq(deviceKeys.userId, userId), inArray(deviceKeys.deviceId, replaced.map((d) => d.deviceId))))
      }
      let row: DeviceKeyRow
      if (same) {
        await tx.delete(keyPackages).where(and(eq(keyPackages.userId, userId), eq(keyPackages.deviceId, deviceId)))
        ;[row] = await tx.update(deviceKeys).set({ sessionId, signatureKey })
          .where(and(eq(deviceKeys.userId, userId), eq(deviceKeys.deviceId, deviceId))).returning() as [DeviceKeyRow]
      } else {
        ;[row] = await tx.insert(deviceKeys).values({ userId, deviceId, sessionId, signatureKey }).returning() as [DeviceKeyRow]
      }
      // Whatever this device had in a call is stale now (new key, or the app restarted without its group state).
      return { device: row, created: !same, gone: [...replaced.map((d) => d.deviceId), ...(same ? [deviceId] : [])] }
    })
    for (const id of gone) this.deviceGone(userId, id)
    return { device: this.deviceView(device, 0), created }
  }

  /** POST /e2ee/devices/:id/key-packages. Returns the pool size afterwards. */
  async uploadKeyPackages(userId: string, sessionId: string, deviceId: string, encoded: string[]): Promise<number> {
    this.available()
    const device = await this.sessionDevice(userId, sessionId, deviceId)
    if (!device) throw notFound('Dispositivo não encontrado.')
    const identity = deviceIdentity(userId, deviceId)
    const now = Date.now() / 1000
    const rows = encoded.map((kp, i) => {
      const raw = bytes(kp)
      let info: Glue.KeyPackageInfo | undefined
      try {
        if (raw.length > E2EE_MAX_KEY_PACKAGE_BYTES) throw new Error('too large')
        info = this.mls!.inspect_key_package(raw)
        const ok = Buffer.from(info.identity).toString('utf8') === identity && b64(info.signature_key) === device.signatureKey
          && Number(info.not_after) > now + 3600
        if (!ok) throw new Error('not this device')
        return { ref: hex(info.reference), userId, deviceId, keyPackage: b64(raw), notAfter: new Date(Number(info.not_after) * 1000) }
      } catch {
        throw invalid({ [`keyPackages.${i}`]: 'Key package inválido para este dispositivo.' })
      } finally {
        info?.free()
      }
    })
    return this.underUserLock(userId, async (tx) => {
      const mine = and(eq(keyPackages.userId, userId), eq(keyPackages.deviceId, deviceId))
      await tx.delete(keyPackages).where(and(mine, lte(keyPackages.notAfter, new Date())))
      const [held] = await tx.select({ n: count() }).from(keyPackages).where(mine)
      if (held!.n + rows.length > E2EE_MAX_KEY_PACKAGES_PER_DEVICE) {
        throw conflict(`No máximo ${E2EE_MAX_KEY_PACKAGES_PER_DEVICE} key packages por dispositivo.`)
      }
      await tx.insert(keyPackages).values(rows).onConflictDoNothing()
      const [after] = await tx.select({ n: count() }).from(keyPackages).where(mine)
      return after!.n
    })
  }

  /** GET /e2ee/users/:userId/key-packages: one per device of `targetId`, consumed. 404 for users you have no tie with. */
  async claimForUser(callerId: string, targetId: string): Promise<ClaimedKeyPackages> {
    this.available()
    const related = callerId === targetId || (!(await isBlockedBetween(this.db, callerId, targetId))
      && ((await sharesSpace(this.db, callerId, targetId)) || (await profileAudience(this.db, targetId)).includes(callerId)))
    if (!related) throw notFound('Usuário não encontrado.')
    const devices = await this.db.select().from(deviceKeys).where(eq(deviceKeys.userId, targetId))
    const out: ClaimedKeyPackages['keyPackages'] = []
    for (const d of devices) {
      const kp = await this.claim(targetId, d.deviceId)
      if (kp) out.push({ deviceId: d.deviceId, signatureKey: d.signatureKey, keyPackage: b64(kp.keyPackage) })
    }
    return { keyPackages: out }
  }

  /** DELETE /e2ee/devices/:id. */
  async deleteDevice(userId: string, deviceId: string): Promise<void> {
    const gone = await this.db.delete(deviceKeys).where(and(eq(deviceKeys.userId, userId), eq(deviceKeys.deviceId, deviceId))).returning()
    if (!gone.length) throw notFound('Dispositivo não encontrado.')
    this.deviceGone(userId, deviceId)
  }

  /** Atomically takes the device's oldest live key package: concurrent claims never share one (SKIP LOCKED). */
  async claim(userId: string, deviceId: string): Promise<{ keyPackage: Uint8Array; ref: string } | null> {
    const oldest = this.db.select({ ref: keyPackages.ref }).from(keyPackages)
      .where(and(eq(keyPackages.userId, userId), eq(keyPackages.deviceId, deviceId), sql`${keyPackages.notAfter} > now()`))
      .orderBy(asc(keyPackages.createdAt)).limit(1).for('update', { skipLocked: true })
    const [row] = await this.db.delete(keyPackages).where(inArray(keyPackages.ref, oldest)).returning()
    return row ? { keyPackage: bytes(row.keyPackage), ref: row.ref } : null
  }

  private deviceView(d: DeviceKeyRow, pool: number): E2eeDevice {
    return { userId: d.userId, deviceId: d.deviceId, signatureKey: d.signatureKey, keyPackages: pool, createdAt: d.createdAt.toISOString() }
  }

  private async sessionDevice(userId: string, sessionId: string, deviceId: string): Promise<DeviceKeyRow | undefined> {
    const [d] = await this.db.select().from(deviceKeys).where(and(eq(deviceKeys.userId, userId), eq(deviceKeys.deviceId, deviceId)))
    return d?.sessionId === sessionId ? d : undefined
  }

  /** Per-user transaction lock: device cap and pool cap stay exact under concurrent requests. */
  private underUserLock<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`e2ee:${userId}`}, 0))`)
      return fn(tx)
    })
  }

  // ---- gateway: the Delivery Service --------------------------------------------------------------------------------

  /** One e2ee_* frame from an identified socket. Per call, frames are applied one at a time, in arrival order. */
  async handle(conn: Conn, frame: E2eeClientFrame): Promise<void> {
    if (!this.mls) return this.reply(conn, frame.channelId, 'unavailable')
    await this.locked(frame.channelId, async () => {
      switch (frame.op) {
        case 'e2ee_join':
          return this.join(conn, frame.channelId, frame.deviceId, frame.epoch)
        case 'e2ee_resync':
          return this.join(conn, frame.channelId, frame.deviceId, undefined)
        case 'e2ee_group_info':
          return this.groupInfo(conn, frame.channelId, bytes(frame.groupInfo))
        case 'e2ee_commit':
          return this.commit(conn, frame.channelId, frame.epoch, bytes(frame.commit), frame.welcome ? bytes(frame.welcome) : new Uint8Array())
        case 'e2ee_welcome_ack':
          return this.ack(conn, frame.channelId, frame.epoch)
      }
    }).catch((err: unknown) => this.log.error({ err: safeErr(err), op: frame.op }, 'e2ee: frame failed'))
  }

  /** Voice state ended (leave, kick, ban, move, lost access, channel deleted): remove the user's leaf at once. */
  left(userId: string, channelId: string): void {
    clearTimeout(this.graces.get(`${userId}:${channelId}`))
    this.graces.delete(`${userId}:${channelId}`)
    if (!this.groups.has(channelId)) return
    void this.locked(channelId, async () => this.leave(userId, channelId))
      .catch((err: unknown) => this.log.error({ err: safeErr(err) }, 'e2ee: leave failed'))
  }

  groupCount(): number {
    return this.groups.size
  }

  /** Epoch of a tracked call (tests, diagnostics). */
  epochOf(channelId: string): number | null {
    const g = this.groups.get(channelId)
    return g ? this.epoch(g) : null
  }

  private locked(channelId: string, fn: () => Promise<void>): Promise<void> {
    const run = (this.locks.get(channelId) ?? Promise.resolve()).then(fn)
    const tail = run.catch(() => {})
    this.locks.set(channelId, tail)
    void tail.then(() => { if (this.locks.get(channelId) === tail) this.locks.delete(channelId) })
    return run
  }

  private async join(conn: Conn, channelId: string, deviceId: string, epoch: number | undefined): Promise<void> {
    const { userId } = conn
    if (!(await this.sessionDevice(userId, conn.sessionId, deviceId))) return this.reply(conn, channelId, 'unknown_device')
    try {
      const access = await requireChannel(this.db, channelId, userId, Permission.CONNECT)
      if (access.channel.type === 'text') throw new Error('text channel')
      await assertDmNotBlocked(this.db, access, userId)
    } catch {
      return this.reply(conn, channelId, 'forbidden')
    }
    conn.e2eeDevice = deviceId
    this.armGrace(userId, channelId)

    let g = this.groups.get(channelId)
    if (!g) {
      g = {
        channelId, gid: new Uint8Array(Buffer.from(channelId)), call: null, creator: null, members: [], ready: new Set(),
        intents: [], committer: null, skipped: new Set(), stalls: 0, awaiting: new Set(),
      }
      this.groups.set(channelId, g)
    }
    // Empty call (or its creator again): this device creates the group.
    if (!g.call && (!g.creator || g.creator.userId === userId)) {
      g.creator = { userId, deviceId }
      this.send(userId, deviceId, 'E2EE_EPOCH', this.epochInfo(g, true))
      return this.arm(g)
    }
    const leaf = g.members.find((m) => m.userId === userId)
    // Same device, same epoch (a gateway reconnect): only what it may have missed.
    if (leaf?.deviceId === deviceId && epoch === this.epoch(g)) {
      this.send(userId, deviceId, 'E2EE_EPOCH', this.epochInfo(g))
      const pending = g.intents.flatMap((i) => (i.proposal ? [i.proposal] : []))
      if (pending.length) this.send(userId, deviceId, 'E2EE_PROPOSALS', { channelId, epoch: this.epoch(g), proposals: pending, committerLeaf: g.committer ?? -1 })
      return
    }
    // Already on its way (its Welcome follows the commit; a device that lost the key package resyncs then).
    if (g.intents.some((i) => i.kind === 'add' && i.userId === userId && i.deviceId === deviceId && i.proposal && !i.cancelled)) return
    // Alone in the call: start over as its creator.
    const others = this.staying(g).filter((m) => m.userId !== userId)
    if (g.call && !others.length && !g.intents.some((i) => i.kind === 'add' && i.userId !== userId && !i.cancelled)) {
      this.drop(g)
      return this.join(conn, channelId, deviceId, undefined)
    }
    // (Re-)join: one leaf per user, so their current leaf goes in the same commit that adds this device.
    this.supersedeAdds(g, userId)
    if (leaf && !g.intents.some((i) => i.kind === 'remove' && i.leaf === leaf.leaf)) {
      g.intents.push({ kind: 'remove', userId, deviceId: leaf.deviceId, leaf: leaf.leaf })
    }
    const kp = await this.claim(userId, deviceId)
    if (kp) g.intents.push({ kind: 'add', userId, deviceId, keyPackage: kp.keyPackage, ref: kp.ref })
    else this.reply(conn, channelId, 'no_key_package')
    this.propose(g)
  }

  /** Drops the user's Adds not proposed yet and cancels the ones already out. */
  private supersedeAdds(g: Group, userId: string): void {
    g.intents = g.intents.filter((i) => !(i.kind === 'add' && i.userId === userId && !i.proposal))
    for (const i of g.intents) if (i.kind === 'add' && i.userId === userId) i.cancelled = true
  }

  private async groupInfo(conn: Conn, channelId: string, info: Uint8Array): Promise<void> {
    const g = this.groups.get(channelId)
    const deviceId = conn.e2eeDevice
    if (!g || g.call || !deviceId || g.creator?.userId !== conn.userId || g.creator.deviceId !== deviceId) {
      return this.reply(conn, channelId, 'not_member')
    }
    const device = await this.sessionDevice(conn.userId, conn.sessionId, deviceId)
    let call: Glue.PublicCall
    try {
      call = this.mls!.PublicCall.from_group_info(info)
    } catch (err) {
      this.log.info({ channelId, reason: String(err) }, 'e2ee: group info refused')
      return this.reset(g, 'invalid group info')
    }
    const members = parseMembers(call.members())
    const ok = device && Buffer.from(call.group_id()).toString('utf8') === channelId && call.epoch() === 0n
      && call.has_external_sender(this.dsKey, Buffer.from(E2EE_DS_IDENTITY))
      && members.length === 1 && members[0]!.userId === conn.userId && members[0]!.deviceId === deviceId
      && Buffer.from(members[0]!.signatureKey, 'hex').toString('base64') === device.signatureKey
    if (!ok) {
      call.free()
      return this.reset(g, 'group info does not match the call')
    }
    g.call = call
    g.creator = null
    g.members = members
    g.ready.add(deviceIdentity(conn.userId, deviceId))
    clearTimeout(g.timer)
    this.propose(g) // adds that queued up while the creator was setting up
  }

  private async commit(conn: Conn, channelId: string, epoch: number, commit: Uint8Array, welcome: Uint8Array): Promise<void> {
    const g = this.groups.get(channelId)
    const me = g?.members.find((m) => m.userId === conn.userId && m.deviceId === conn.e2eeDevice)
    if (!g?.call || !me) return this.reply(conn, channelId, 'not_member')
    const reject = (why: string) => {
      metrics.e2eeCommits.inc({ result: 'rejected' })
      this.log.info({ channelId, epoch, why }, 'e2ee: commit rejected')
      this.reply(conn, channelId, 'commit_rejected')
    }
    if (epoch !== this.epoch(g)) return reject('stale epoch') // another commit already won this epoch
    let info: Glue.CommitInfo
    try {
      info = g.call.stage_commit(commit, welcome, me.leaf)
    } catch (err) {
      return reject(String(err))
    }
    const removed = new Set(info.removed)
    const covered = [...chunks(info.added)].map((r) => g.intents.find((i) => i.kind === 'add' && i.ref === hex(r)))
    info.free()
    const adds = covered.filter((a): a is Extract<Intent, { kind: 'add' }> => a?.kind === 'add')
    const live = adds.filter((a) => !a.cancelled)
    const after = [...g.members.filter((m) => !removed.has(m.leaf)).map((m) => m.userId), ...live.map((a) => a.userId)]
    if (adds.length !== covered.length || new Set(after).size !== after.length) {
      g.call.discard()
      return reject('would leave a user with two leaves')
    }
    g.call.merge()
    metrics.e2eeCommits.inc({ result: 'accepted' })
    const before = g.members
    g.members = parseMembers(g.call.members())
    for (const m of before) if (removed.has(m.leaf)) g.ready.delete(deviceIdentity(m.userId, m.deviceId))
    // Left over: re-proposed for the new epoch (a Remove only while that leaf still holds the same device; a cancelled
    // Add never again). Cancelled Adds that made it in are removed now.
    g.intents = g.intents.filter((i) => i.kind === 'add'
      ? !adds.includes(i) && !i.cancelled
      : !removed.has(i.leaf) && g.members.some((m) => m.leaf === i.leaf && m.deviceId === i.deviceId))
    for (const a of adds.filter((x) => x.cancelled)) {
      const leaf = g.members.find((m) => m.userId === a.userId && m.deviceId === a.deviceId && !g.intents.some((i) => i.kind === 'remove' && i.leaf === m.leaf))
      if (leaf) g.intents.push({ kind: 'remove', userId: a.userId, deviceId: a.deviceId, leaf: leaf.leaf })
    }
    for (const i of g.intents) delete i.proposal
    g.skipped.clear()
    g.stalls = 0

    for (const m of before) this.send(m.userId, m.deviceId, 'E2EE_COMMIT', { channelId, epoch, commit: b64(commit) })
    for (const a of live) this.send(a.userId, a.deviceId, 'E2EE_WELCOME', { channelId, epoch: epoch + 1, welcome: b64(welcome) })
    g.awaiting = new Set(live.map((a) => deviceIdentity(a.userId, a.deviceId)))
    g.committer = this.pick(g)
    this.propose(g)
    clearTimeout(g.ackTimer)
    if (!g.awaiting.size) this.execute(g)
    else g.ackTimer = setTimeout(() => void this.locked(channelId, async () => { if (this.groups.get(channelId) === g) this.execute(g) }), E2EE_WELCOME_ACK_TIMEOUT_MS).unref()
  }

  private async ack(conn: Conn, channelId: string, epoch: number): Promise<void> {
    const g = this.groups.get(channelId)
    const me = g?.members.find((m) => m.userId === conn.userId && m.deviceId === conn.e2eeDevice)
    if (!g || !me || epoch > this.epoch(g)) return this.reply(conn, channelId, 'not_member')
    const id = deviceIdentity(me.userId, me.deviceId)
    g.ready.add(id)
    if (g.awaiting.delete(id) && !g.awaiting.size) this.execute(g)
    if (g.committer === null && g.intents.length) {
      g.committer = this.pick(g)
      if (g.committer !== null) this.toMembers(g, 'E2EE_EPOCH', this.epochInfo(g))
    }
  }

  private async leave(userId: string, channelId: string): Promise<void> {
    const g = this.groups.get(channelId)
    if (!g) return
    this.supersedeAdds(g, userId)
    if (!g.call) {
      if (g.creator?.userId === userId) this.reset(g, 'creator left')
      return
    }
    const leaf = g.members.find((m) => m.userId === userId)
    if (leaf && !g.intents.some((i) => i.kind === 'remove' && i.leaf === leaf.leaf)) {
      g.intents.push({ kind: 'remove', userId, deviceId: leaf.deviceId, leaf: leaf.leaf })
    }
    if (!this.staying(g).length) {
      // The last member left: nothing to protect any more. Someone still joining re-joins and creates a new group.
      if (g.intents.some((i) => i.kind === 'add' && !i.cancelled)) return this.reset(g, 'last member left while others join')
      return this.drop(g)
    }
    this.propose(g)
  }

  /** The device lost its state (re-registered, replaced, deleted): leave the call it was in. */
  private deviceGone(userId: string, deviceId: string): void {
    for (const g of this.groups.values()) {
      if (g.members.some((m) => m.userId === userId && m.deviceId === deviceId) || g.creator?.deviceId === deviceId
        || g.intents.some((i) => i.kind === 'add' && i.deviceId === deviceId)) this.left(userId, g.channelId)
    }
  }

  /** Sends this epoch's proposals not sent yet (signed by the DS, checked by the public state first) and arms the timer. */
  private propose(g: Group): void {
    if (!g.call) return this.arm(g)
    const epoch = BigInt(this.epoch(g))
    const fresh: string[] = []
    g.intents = g.intents.filter((i) => {
      if (i.proposal) return true
      try {
        const msg = i.kind === 'add' ? this.ds!.external_propose_add(g.gid, epoch, i.keyPackage) : this.ds!.external_propose_remove(g.gid, epoch, i.leaf)
        g.call!.add_proposal(msg)
        i.proposal = b64(msg)
        fresh.push(i.proposal)
        return true
      } catch (err) {
        // The group refuses it (e.g. a key package it cannot take): dropped; that device resyncs after its timeout.
        this.log.warn({ channelId: g.channelId, kind: i.kind, reason: String(err) }, 'e2ee: proposal dropped')
        return false
      }
    })
    if (fresh.length) {
      g.committer = this.pick(g)
      this.toMembers(g, 'E2EE_PROPOSALS', { channelId: g.channelId, epoch: Number(epoch), proposals: fresh, committerLeaf: g.committer ?? -1 })
    }
    this.arm(g)
  }

  /** Senders switch to this epoch's key (after every added device acked, or the ack timeout). */
  private execute(g: Group): void {
    clearTimeout(g.ackTimer)
    g.awaiting.clear()
    this.toMembers(g, 'E2EE_EPOCH', this.epochInfo(g))
  }

  /** Lowest connected ready leaf that is not being removed, preferring ones that have not timed out this epoch. */
  private pick(g: Group): number | null {
    const removing = new Set(g.intents.flatMap((i) => (i.kind === 'remove' ? [i.leaf] : [])))
    const able = g.members.filter((m) => !removing.has(m.leaf) && g.ready.has(deviceIdentity(m.userId, m.deviceId))
      && this.hub.deviceOnline(m.userId, m.deviceId))
    return (able.find((m) => !g.skipped.has(m.leaf)) ?? able[0])?.leaf ?? null
  }

  private staying(g: Group): Leaf[] {
    return g.members.filter((m) => !g.intents.some((i) => i.kind === 'remove' && i.leaf === m.leaf))
  }

  /** One timer per group: the creator's group info, or a commit for the pending proposals. */
  private arm(g: Group): void {
    clearTimeout(g.timer)
    if (g.call && !g.intents.length) return
    g.timer = setTimeout(() => void this.locked(g.channelId, async () => this.stalled(g)), g.call ? E2EE_COMMIT_TIMEOUT_MS : CREATE_TIMEOUT_MS).unref()
  }

  private stalled(g: Group): void {
    if (this.groups.get(g.channelId) !== g) return
    if (!g.call) return this.reset(g, 'no group info from the creator')
    if (!g.intents.length) return
    if (g.committer !== null) g.skipped.add(g.committer)
    g.committer = this.pick(g)
    if (g.committer === null || ++g.stalls >= MAX_STALLS) return this.reset(g, 'no commit')
    this.toMembers(g, 'E2EE_EPOCH', this.epochInfo(g))
    this.arm(g)
  }

  /** Stuck group: forget it and have every device involved re-join (the first one creates a new group). */
  private reset(g: Group, why: string): void {
    this.log.warn({ channelId: g.channelId, why }, 'e2ee: group reset')
    this.drop(g)
    const devices = new Map<string, { userId: string; deviceId: string }>()
    for (const d of [...g.members, ...g.intents, ...(g.creator ? [g.creator] : [])]) {
      if (d.userId) devices.set(deviceIdentity(d.userId, d.deviceId), d)
    }
    for (const d of devices.values()) this.resync(d.userId, d.deviceId, g.channelId, 'not_member')
  }

  private drop(g: Group): void {
    clearTimeout(g.timer)
    clearTimeout(g.ackTimer)
    g.call?.free()
    g.call = null
    if (this.groups.get(g.channelId) === g) this.groups.delete(g.channelId)
  }

  private armGrace(userId: string, channelId: string): void {
    const key = `${userId}:${channelId}`
    clearTimeout(this.graces.get(key))
    this.graces.set(key, setTimeout(() => {
      this.graces.delete(key)
      if (this.voice.stateOf(userId)?.channelId !== channelId) this.left(userId, channelId)
    }, E2EE_JOIN_GRACE_MS).unref())
  }

  private epoch(g: Group): number {
    return g.call ? Number(g.call.epoch()) : 0
  }

  private epochInfo(g: Group, create = false): E2eeEpoch {
    return { channelId: g.channelId, epoch: this.epoch(g), committerLeaf: create ? 0 : g.committer ?? -1, create, externalSender: this.externalSender! }
  }

  private send<T extends DispatchType>(userId: string, deviceId: string, t: T, d: DispatchOf<T>): void {
    if (userId) this.hub.toDevice(userId, deviceId, t, d)
  }

  private toMembers<T extends DispatchType>(g: Group, t: T, d: DispatchOf<T>): void {
    for (const m of g.members) this.send(m.userId, m.deviceId, t, d)
  }

  private resync(userId: string, deviceId: string, channelId: string, reason: E2eeResyncReason): void {
    metrics.e2eeResyncs.inc({ reason })
    this.send(userId, deviceId, 'E2EE_RESYNC_REQUIRED', { channelId, reason })
  }

  /** Answer on the socket itself (it may not be bound to a device yet). */
  private reply(conn: Conn, channelId: string, reason: E2eeResyncReason): void {
    metrics.e2eeResyncs.inc({ reason })
    conn.send(JSON.stringify({ op: 'dispatch', t: 'E2EE_RESYNC_REQUIRED', d: { channelId, reason } }))
  }
}

function* chunks(b: Uint8Array, size = 32): Generator<Uint8Array> {
  for (let i = 0; i + size <= b.length; i += size) yield b.subarray(i, i + size)
}
