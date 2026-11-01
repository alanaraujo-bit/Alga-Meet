import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { E2EE_DS_IDENTITY, E2EE_MEDIA_LABEL, mediaKeyContext as sharedContext, type E2eeClientFrame } from '@alga/shared'
import { describe, expect, it } from 'vitest'
import type { E2eeEpochInfo, E2eeFrameKey } from '../../shared/bridge'
import { createRunner, type Glue } from './rpc'
import { DS_IDENTITY, E2eeSession, MEDIA_LABEL, digits, keyIndexOf, mediaKeyContext, pairCode } from './session'

// The real WASM build (native/mls/pkg, committed); the server's DS has its own end-to-end test (apps/server/test/e2ee.test.ts).
const glue = createRequire(import.meta.url)(join(__dirname, '..', '..', '..', '..', '..', 'native', 'mls', 'pkg', 'alga_mls.js')) as Glue

describe('e2ee constants and codes', () => {
  it('match the shared contract', () => {
    expect(MEDIA_LABEL).toBe(E2EE_MEDIA_LABEL)
    expect(DS_IDENTITY).toBe(E2EE_DS_IDENTITY)
    expect(mediaKeyContext('u', 'd')).toBe(sharedContext('u', 'd'))
    expect([0, 15, 16, 33].map(keyIndexOf)).toEqual([0, 15, 0, 1])
  })

  it('digits: 5 bytes big-endian mod 10^5 per group', () => {
    expect(digits(new Uint8Array([0, 0, 0, 0, 1, 255, 255, 255, 255, 255]), 10)).toBe('00001 27775')
  })

  it('pairwise code is symmetric and tied to both keys', async () => {
    const a = { userId: randomUUID(), signatureKey: new Uint8Array(32).fill(1) }
    const b = { userId: randomUUID(), signatureKey: new Uint8Array(32).fill(2) }
    const ab = await pairCode(a, b)
    expect(ab).toMatch(/^\d{5}( \d{5}){8}$/)
    expect(await pairCode(b, a)).toBe(ab)
    expect(await pairCode(a, { ...b, signatureKey: new Uint8Array(32).fill(3) })).not.toBe(ab)
  })
})

describe('MLS worker RPC', () => {
  it('only exposes the client methods main needs (no DS role, no state export)', () => {
    const run = createRunner(glue)
    const handle = run({ op: 'new', bytes: new Uint8Array(Buffer.from('u:d')) }) as number
    expect(run({ op: 'call', handle, method: 'signature_public_key', args: [] })).toHaveLength(32)
    for (const method of ['external_propose_add', 'save_state', 'free']) {
      expect(() => run({ op: 'call', handle, method: method as never, args: [] })).toThrow('method not allowed')
    }
    expect(() => run({ op: 'call', handle: 999, method: 'epoch', args: [] })).toThrow('unknown handle')
    expect(run({ op: 'free', handle })).toBe(true)
  })
})

describe('E2eeSession', () => {
  function device() {
    const run = createRunner(glue)
    const userId = randomUUID()
    const deviceId = randomUUID()
    const handle = run({ op: 'new', bytes: new Uint8Array(Buffer.from(`${userId}:${deviceId}`)) }) as number
    const sent: E2eeClientFrame[] = []
    const keys: E2eeFrameKey[] = []
    const epochs: E2eeEpochInfo[] = []
    const session = new E2eeSession({
      mls: async (method, ...args) => run({ op: 'call', handle, method, args }),
      send: (f) => sent.push(f),
      onKey: (k) => keys.push(k),
      onEpoch: (e) => epochs.push(e),
      replenish: async () => {},
      reregister: async () => {},
      log: () => {},
      retryMs: 0,
    }, userId, deviceId)
    return { session, sent, keys, epochs, userId, deviceId }
  }
  const ds = new glue.Client(new Uint8Array(Buffer.from('alga-ds'))) as unknown as { signature_public_key(): Uint8Array }
  const externalSender = { publicKey: Buffer.from(ds.signature_public_key()).toString('base64'), identity: 'alga-ds' }

  it('creates the group when the DS says the call is empty: group info out, own key, call code', async () => {
    const d = device()
    const channelId = randomUUID()
    await d.session.joinCall(channelId)
    expect(d.sent).toEqual([{ op: 'e2ee_join', channelId, deviceId: d.deviceId }])
    await d.session.handleDispatch('E2EE_EPOCH', { channelId, epoch: 0, committerLeaf: 0, create: true, externalSender })
    expect(d.sent[1]).toMatchObject({ op: 'e2ee_group_info', channelId })
    expect(d.keys).toEqual([expect.objectContaining({ channelId, userId: d.userId, epoch: 0, keyIndex: 0, self: true })])
    expect(d.keys[0]!.key).toHaveLength(32)
    expect(d.epochs.at(-1)).toMatchObject({ channelId, state: 'active', epoch: 0, members: [{ userId: d.userId, deviceId: d.deviceId, self: true }] })
    expect(await d.session.verificationCode(channelId)).toMatch(/^\d{5}( \d{5}){5}$/)
    expect(d.session.current).toEqual({ channelId, state: 'active', epoch: 0 })
    // Re-announce after a gateway reconnect carries the epoch; another call's frames are ignored.
    await d.session.joinCall(channelId)
    expect(d.sent.at(-1)).toEqual({ op: 'e2ee_join', channelId, deviceId: d.deviceId, epoch: 0 })
    await d.session.handleDispatch('E2EE_COMMIT', { channelId: randomUUID(), epoch: 0, commit: 'AAAA' })
    expect(d.sent).toHaveLength(3)
  })

  it('a create from another external sender identity, or garbage, makes it resync instead of joining', async () => {
    const d = device()
    const channelId = randomUUID()
    await d.session.joinCall(channelId)
    await d.session.handleDispatch('E2EE_EPOCH', { channelId, epoch: 0, committerLeaf: 0, create: true, externalSender: { ...externalSender, identity: 'evil' } })
    expect(d.sent.at(-1)).toEqual({ op: 'e2ee_resync', channelId, deviceId: d.deviceId })
    await d.session.handleDispatch('E2EE_WELCOME', { channelId, epoch: 1, welcome: 'not base64!' })
    expect(d.sent.filter((f) => f.op === 'e2ee_resync')).toHaveLength(2)
    expect(d.keys).toHaveLength(0)
    // The DS refuses the call: given up, no retries.
    await d.session.handleDispatch('E2EE_RESYNC_REQUIRED', { channelId, reason: 'forbidden' })
    expect(d.epochs.at(-1)).toMatchObject({ state: 'failed', reason: 'forbidden' })
    const n = d.sent.length
    await d.session.handleDispatch('E2EE_RESYNC_REQUIRED', { channelId, reason: 'not_member' })
    expect(d.sent).toHaveLength(n)
  })
})
