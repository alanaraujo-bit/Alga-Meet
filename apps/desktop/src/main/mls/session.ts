// Client side of one device's MLS calls (docs/decisions/0004-e2ee.md §3.4–3.9; flow in packages/shared/src/e2ee.ts).
// Pure: no Electron. src/main/mls/e2ee.ts wires it to the worker, the renderer's gateway relay and the bridge; tests
// (here and apps/server/test/e2ee.test.ts) drive it over the real WASM. MLS state and identity keys stay in the
// worker; what leaves this module is gateway frames (public or encrypted to their recipients) and per-sender media
// keys of the current call.
import { createHmac, scrypt } from 'node:crypto'
import type { E2eeClientFrame } from '@alga/shared'
import type { E2eeCallState, E2eeEpochInfo, E2eeFrameKey, E2eeMember } from '../../shared/bridge'
import type { MlsMethod } from './rpc'

/** Same values as packages/shared/src/e2ee.ts (kept local: main does not bundle the shared runtime). */
export const MEDIA_LABEL = 'Alga Media v1'
export const DS_IDENTITY = 'alga-ds'
/** Label of the cinema tag key (context: the channel id); used in main only. */
export const CINEMA_LABEL = 'Alga Cinema v1'
/** Epochs whose cinema key is kept, like LiveKit's keyring for media keys. */
const CINEMA_KEEP = 16
export const mediaKeyContext = (userId: string, deviceId: string) => `${userId}\0${deviceId}`
/** LiveKit's keyring holds 16 keys per participant. */
export const keyIndexOf = (epoch: number) => epoch % 16
const MAX_RETRIES = 5
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/

export interface SessionDeps {
  /** Method on this device's client in the MLS worker. */
  mls(method: MlsMethod, ...args: unknown[]): Promise<unknown>
  /** Gateway frame for the renderer to send. */
  send(frame: E2eeClientFrame): void
  onKey(k: E2eeFrameKey): void
  onEpoch(e: E2eeEpochInfo): void
  /** A key package was used (`exhausted`: the server has none left): top the pool up. */
  replenish(exhausted: boolean): Promise<void>
  /** The server does not know this device (unknown_device): register it again. */
  reregister(): Promise<void>
  log(msg: string, extra?: Record<string, unknown>): void
  /** Base of the re-join backoff; tests pass 0. */
  retryMs?: number
}

interface Member extends E2eeMember { leaf: number; signatureKey: Buffer }

interface Call {
  channelId: string
  state: E2eeCallState
  joined: boolean
  epoch: number
  ownLeaf: number
  committerLeaf: number
  /** DS proposals of this epoch queued in the group and not committed yet. */
  pending: number
  committing: boolean
  /** Epoch whose key we send with (-1: none yet). */
  sendEpoch: number
  members: Member[]
  retries: number
  /** epoch -> cinema key of the last CINEMA_KEEP epochs (export_secret only works for the current one). */
  cinemaKeys: Map<number, Uint8Array>
}

// Payload checks: dispatches come from the renderer, which relays the gateway; anything off-shape throws.
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function int(v: unknown, min = 0): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) throw new TypeError('expected integer')
  return v
}
function bin(v: unknown, max = 96 * 1024): Uint8Array {
  if (typeof v !== 'string' || v.length > max || !B64_RE.test(v)) throw new TypeError('expected base64')
  return new Uint8Array(Buffer.from(v, 'base64'))
}
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')
const utf8 = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'))

/** `n` digits in groups of 5, each from 5 bytes big-endian mod 10^5 (DAVE's displayable code). */
export function digits(bytes: Uint8Array, n: number): string {
  const groups: string[] = []
  for (let g = 0; g < n / 5; g++) {
    let v = 0
    for (let i = 0; i < 5; i++) v = v * 256 + (bytes[g * 5 + i] ?? 0)
    groups.push(String(v % 100_000).padStart(5, '0'))
  }
  return groups.join(' ')
}

/** Pairwise code (0004 §3.9): 45 digits from scrypt (N=16384) over both devices' `v0 ‖ key ‖ userId`, sorted. */
export function pairCode(a: { userId: string; signatureKey: Uint8Array }, b: { userId: string; signatureKey: Uint8Array }): Promise<string> {
  const enc = (x: typeof a) => Buffer.concat([Buffer.from([0, 0]), Buffer.from(x.signatureKey), Buffer.from(x.userId, 'utf8')])
  const input = Buffer.concat([enc(a), enc(b)].sort(Buffer.compare))
  return new Promise((resolve, reject) => {
    scrypt(input, 'Alga Meet fingerprint v1', 45, { N: 16384, r: 8, p: 2 }, (err, key) => (err ? reject(err) : resolve(digits(key, 45))))
  })
}

/** Leaves from native/mls `members()` JSON; an identity that is not `userId:deviceId` gets empty ids (never keyed). */
function parseMembers(json: string, ownLeaf: number): Member[] {
  return (JSON.parse(json) as { leaf: number; identity: string; signatureKey: string }[]).map((m) => {
    const [userId = '', deviceId = '', extra] = Buffer.from(m.identity, 'hex').toString('utf8').split(':')
    const ok = extra === undefined && UUID_RE.test(userId) && UUID_RE.test(deviceId)
    return { leaf: m.leaf, userId: ok ? userId : '', deviceId: ok ? deviceId : '', self: m.leaf === ownLeaf, signatureKey: Buffer.from(m.signatureKey, 'hex') }
  })
}

/** Zeroes and forgets a call's cinema keys. */
function wipe(c: Call): void {
  for (const k of c.cinemaKeys.values()) k.fill(0)
  c.cinemaKeys.clear()
}

export class E2eeSession {
  private call: Call | null = null
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly deps: SessionDeps, readonly userId: string, readonly deviceId: string) {}

  get current(): { channelId: string; state: E2eeCallState; epoch: number } | null {
    const c = this.call
    return c ? { channelId: c.channelId, state: c.state, epoch: c.joined ? c.epoch : -1 } : null
  }

  /** Join (or re-announce after a gateway reconnect: the DS answers with what this device missed). */
  joinCall(channelId: string): Promise<void> {
    return this.enqueue(async () => {
      const c = this.call
      if (c?.channelId === channelId && c.joined && c.state === 'active') return this.deps.send({ op: 'e2ee_join', channelId, deviceId: this.deviceId, epoch: c.epoch })
      if (c) await this.drop()
      this.call = { channelId, state: 'joining', joined: false, epoch: -1, ownLeaf: -1, committerLeaf: -1, pending: 0, committing: false, sendEpoch: -1, members: [], retries: 0, cinemaKeys: new Map() }
      this.deps.send({ op: 'e2ee_join', channelId, deviceId: this.deviceId })
    })
  }

  leaveCall(channelId: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.call?.channelId === channelId) await this.drop()
    })
  }

  /** An E2EE_* gateway dispatch, as relayed by the renderer. Other calls' frames are ignored. */
  handleDispatch(t: string, d: unknown): Promise<void> {
    return this.enqueue(async () => {
      if (!isObj(d) || typeof d.channelId !== 'string') throw new TypeError('bad dispatch')
      const c = this.call
      if (!c || c.channelId !== d.channelId || c.state === 'failed') return
      try {
        switch (t) {
          case 'E2EE_EPOCH': return await this.onEpoch(c, d)
          case 'E2EE_PROPOSALS': return await this.onProposals(c, d)
          case 'E2EE_COMMIT': return await this.onCommit(c, d)
          case 'E2EE_WELCOME': return await this.onWelcome(c, d)
          case 'E2EE_RESYNC_REQUIRED': return await this.onResync(c, String(d.reason))
          default: throw new TypeError('unknown dispatch')
        }
      } catch (err) {
        // Anything that did not apply (bad frame, rejected handshake, worker error): re-added from scratch.
        this.deps.log('e2ee: dispatch failed, resyncing', { t, err: err instanceof Error ? err.message : String(err) })
        await this.resync(c)
      }
    })
  }

  /** Call code (30 digits, same for everyone in this epoch) or, with `userId`, the pairwise code with their device. */
  async verificationCode(channelId: string, userId?: string): Promise<string | null> {
    let me: Member | undefined
    let them: Member | undefined
    let authenticator: Uint8Array | null = null
    await this.enqueue(async () => {
      const c = this.call
      if (!c?.joined || c.channelId !== channelId) return
      if (!userId) authenticator = (await this.deps.mls('epoch_authenticator')) as Uint8Array
      me = c.members.find((m) => m.self)
      them = c.members.find((m) => m.userId === userId && !m.self)
    })
    if (!userId) return authenticator ? digits(authenticator, 30) : null
    return me && them ? pairCode(me, them) : null
  }

  /** Base64 HMAC-SHA256 of `message` under that epoch's cinema key; null if not the current call or epoch not kept. */
  async cinemaTag(channelId: string, epoch: number, message: string): Promise<string | null> {
    let tag: string | null = null
    await this.enqueue(async () => {
      const key = this.call?.channelId === channelId && this.call.joined ? this.call.cinemaKeys.get(epoch) : undefined
      if (key) tag = createHmac('sha256', key).update(message, 'utf8').digest('base64')
    })
    return tag
  }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    const run = this.queue.then(fn)
    this.queue = run.catch((err: unknown) => this.deps.log('e2ee: session step failed', { err: err instanceof Error ? err.message : String(err) }))
    return run
  }

  private async onEpoch(c: Call, d: Record<string, unknown>): Promise<void> {
    const epoch = int(d.epoch)
    if (d.create === true) {
      const es = isObj(d.externalSender) ? d.externalSender : {}
      const dsKey = bin(es.publicKey, 64)
      if (dsKey.length !== 32 || es.identity !== DS_IDENTITY || epoch !== 0) throw new TypeError('bad create')
      await this.deps.mls('create_group', utf8(c.channelId), dsKey, utf8(DS_IDENTITY))
      Object.assign(c, { joined: true, epoch: 0, ownLeaf: 0, committerLeaf: 0, pending: 0, committing: false, sendEpoch: -1 })
      this.deps.send({ op: 'e2ee_group_info', channelId: c.channelId, groupInfo: b64((await this.deps.mls('group_info')) as Uint8Array) })
      await this.receive(c)
      return this.activate(c)
    }
    if (!c.joined) return
    if (epoch > c.epoch) throw new Error('missed a commit')
    if (epoch < c.epoch) return
    c.committerLeaf = int(d.committerLeaf, -1)
    if (c.sendEpoch !== c.epoch) await this.activate(c)
    await this.maybeCommit(c)
  }

  private async onProposals(c: Call, d: Record<string, unknown>): Promise<void> {
    if (!c.joined) return
    const epoch = int(d.epoch)
    if (epoch > c.epoch) throw new Error('missed a commit')
    if (epoch < c.epoch) return
    if (!Array.isArray(d.proposals) || d.proposals.length > 256) throw new TypeError('bad proposals')
    for (const p of d.proposals) {
      if ((await this.deps.mls('process', bin(p))) !== 'proposal') throw new Error('not a DS proposal')
    }
    c.pending += d.proposals.length
    c.committerLeaf = int(d.committerLeaf, -1)
    await this.maybeCommit(c)
  }

  private async maybeCommit(c: Call): Promise<void> {
    if (c.committerLeaf !== c.ownLeaf || !c.pending || c.committing) return
    const { commit, welcome } = (await this.deps.mls('commit_pending')) as { commit: Uint8Array; welcome: Uint8Array | null }
    c.committing = true
    this.deps.send({ op: 'e2ee_commit', channelId: c.channelId, epoch: c.epoch, commit: b64(commit), ...(welcome ? { welcome: b64(welcome) } : {}) })
  }

  private async onCommit(c: Call, d: Record<string, unknown>): Promise<void> {
    if (!c.joined) return
    const epoch = int(d.epoch)
    if (epoch > c.epoch) throw new Error('missed a commit')
    if (epoch < c.epoch) return
    const result = await this.deps.mls('process', bin(d.commit))
    c.committing = false
    c.pending = 0
    if (result === 'removed') {
      c.joined = false
      c.state = 'removed'
      return this.deps.onEpoch({ channelId: c.channelId, state: 'removed', epoch: -1, keyIndex: -1, members: [] })
    }
    if (result !== 'commit') throw new Error('not a commit')
    c.epoch = Number(await this.deps.mls('epoch'))
    await this.receive(c)
  }

  private async onWelcome(c: Call, d: Record<string, unknown>): Promise<void> {
    await this.deps.mls('process_welcome', bin(d.welcome))
    c.epoch = Number(await this.deps.mls('epoch'))
    c.ownLeaf = Number(await this.deps.mls('own_leaf_index'))
    Object.assign(c, { joined: true, pending: 0, committing: false, sendEpoch: -1 })
    if (c.epoch !== int(d.epoch)) throw new Error('welcome for another epoch')
    this.deps.send({ op: 'e2ee_welcome_ack', channelId: c.channelId, epoch: c.epoch })
    await this.receive(c)
    void this.deps.replenish(false).catch((err: unknown) => this.deps.log('e2ee: key package refill failed', { err: String(err) }))
  }

  private async onResync(c: Call, reason: string): Promise<void> {
    switch (reason) {
      case 'commit_rejected':
        if (c.committing) await this.deps.mls('clear_pending_commit')
        c.committing = false
        return
      case 'forbidden':
      case 'unavailable':
        return this.fail(c, reason)
      case 'no_key_package':
        await this.deps.replenish(true)
        return this.rejoin(c, false)
      case 'unknown_device':
        await this.deps.reregister()
        return this.rejoin(c, true)
      default:
        return this.rejoin(c, true)
    }
  }

  /** Remote senders' keys for the current epoch (ours waits for E2EE_EPOCH). A userId on two leaves gets no key. */
  private async receive(c: Call): Promise<void> {
    c.ownLeaf = Number(await this.deps.mls('own_leaf_index'))
    c.members = parseMembers((await this.deps.mls('members')) as string, c.ownLeaf)
    // Never lets a cinema failure block the media keys below: cinemaTag just answers null for this epoch.
    try {
      c.cinemaKeys.set(c.epoch, (await this.deps.mls('export_secret', CINEMA_LABEL, utf8(c.channelId), 32)) as Uint8Array)
    } catch (err) {
      this.deps.log('e2ee: cinema key export failed', { err: err instanceof Error ? err.message : String(err) })
    }
    for (const [e, k] of c.cinemaKeys) if (e <= c.epoch - CINEMA_KEEP) { k.fill(0); c.cinemaKeys.delete(e) }
    const seen = new Map<string, number>()
    for (const m of c.members) seen.set(m.userId, (seen.get(m.userId) ?? 0) + 1)
    for (const m of c.members) {
      if (!m.userId || seen.get(m.userId)! > 1) {
        if (m.userId) this.deps.log('e2ee: two leaves for one user, no key for them', { leaf: m.leaf })
        continue
      }
      if (m.self) continue
      this.deps.onKey({ channelId: c.channelId, userId: m.userId, epoch: c.epoch, keyIndex: keyIndexOf(c.epoch), key: await this.mediaKey(m), self: false })
    }
  }

  /** Start sending with this epoch's key. */
  private async activate(c: Call): Promise<void> {
    const me = c.members.find((m) => m.self)
    c.sendEpoch = c.epoch
    c.state = 'active'
    c.retries = 0
    if (me) this.deps.onKey({ channelId: c.channelId, userId: me.userId, epoch: c.epoch, keyIndex: keyIndexOf(c.epoch), key: await this.mediaKey(me), self: true })
    this.deps.onEpoch({
      channelId: c.channelId, state: 'active', epoch: c.epoch, keyIndex: keyIndexOf(c.epoch),
      members: c.members.filter((m) => m.userId).map(({ userId, deviceId, self }) => ({ userId, deviceId, self })),
    })
  }

  private async mediaKey(m: Member): Promise<Uint8Array> {
    return (await this.deps.mls('export_secret', MEDIA_LABEL, utf8(mediaKeyContext(m.userId, m.deviceId)), 32)) as Uint8Array
  }

  /** Local failure: the DS removes our leaf (if any) and re-adds this device. */
  private async resync(c: Call): Promise<void> {
    if (this.call !== c || c.state === 'failed') return
    if (++c.retries > MAX_RETRIES) return this.fail(c, 'resync_limit')
    await this.forget(c)
    this.later(c, () => this.deps.send({ op: 'e2ee_resync', channelId: c.channelId, deviceId: this.deviceId }))
  }

  /** The DS asked us to join again; `fresh` drops the local group first. */
  private async rejoin(c: Call, fresh: boolean): Promise<void> {
    if (++c.retries > MAX_RETRIES) return this.fail(c, 'resync_limit')
    if (fresh) await this.forget(c)
    const epoch = c.joined ? c.epoch : undefined
    this.later(c, () => this.deps.send({ op: 'e2ee_join', channelId: c.channelId, deviceId: this.deviceId, ...(epoch === undefined ? {} : { epoch }) }))
  }

  private later(c: Call, fn: () => void): void {
    const ms = (this.deps.retryMs ?? 250) * (c.retries - 1)
    const go = () => { if (this.call === c && c.state !== 'failed') fn() }
    if (ms) setTimeout(go, ms).unref?.()
    else go()
  }

  private async forget(c: Call): Promise<void> {
    if (c.joined) await this.deps.mls('leave').catch(() => {})
    Object.assign(c, { state: 'joining', joined: false, epoch: -1, pending: 0, committing: false, sendEpoch: -1, members: [] })
    wipe(c)
  }

  private async fail(c: Call, reason: string): Promise<void> {
    await this.forget(c)
    c.state = 'failed'
    this.deps.onEpoch({ channelId: c.channelId, state: 'failed', epoch: -1, keyIndex: -1, members: [], reason })
  }

  private async drop(): Promise<void> {
    const c = this.call
    this.call = null
    if (c) wipe(c)
    if (c?.joined) await this.deps.mls('leave').catch(() => {})
  }
}
