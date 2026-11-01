// E2EE service of main (docs/decisions/0004-e2ee.md §3.1–3.2): after login it starts the "alga-e2ee" worker
// (pre-warm, so the key package is ready before the join click), loads or creates this profile's device identity
// (DPAPI only, like the session token), registers the device and keeps its key package pool filled. The renderer
// gets the narrow window.alga.e2ee bridge: gateway relay in, frame keys and epochs out.
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { E2eeStatus } from '../../shared/bridge'
import { IPC } from '../../shared/ipc'
import { emit, handle, on, str } from '../ipc'
import { log } from '../log'
import { writeFileAtomic } from '../settings'
import { mls, onWorkerExit, stopMls, warmMls } from './host'
import type { MlsMethod } from './rpc'
import { E2eeSession } from './session'

/** Key packages kept on the server: one is used per call joined. */
const POOL_TARGET = 10
const POOL_LOW = 4
const READY_WAIT_MS = 10_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DISPATCHES = new Set(['E2EE_PROPOSALS', 'E2EE_COMMIT', 'E2EE_WELCOME', 'E2EE_EPOCH', 'E2EE_RESYNC_REQUIRED'])

/** On in dev; a packaged build only with ALGA_E2EE=1 until the rollout (0004 §5.1, phase 5). */
const enabled = () => process.env.ALGA_E2EE === '1' || (!app.isPackaged && process.env.ALGA_E2EE !== '0')

interface StoredIdentity {
  v: 1
  deviceId: string
  /** native/mls export_identity blob, base64. Holds the private signature key: only ever written DPAPI-encrypted. */
  identity: string
}

let apiUrl = ''
let token: string | null = null
/** Bumped by every start/stop: steps of an older start see it and give up. */
let generation = 0
let state: E2eeStatus['state'] = 'off'
let deviceId: string | null = null
let persistent = false
let session: E2eeSession | null = null
let booting: Promise<void> | null = null
let lastCrashRestart = 0

const uuid = (v: unknown) => {
  const s = str(v, 64)
  if (!UUID_RE.test(s)) throw new TypeError('expected uuid')
  return s
}
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')

async function api<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`)
  return (await res.json()) as T
}

// ---- device identity: userData/e2ee-identity-<userId>.bin, DPAPI (safeStorage) or nothing ----------------------------

const identityFile = (userId: string) => join(app.getPath('userData'), `e2ee-identity-${userId}.bin`)

async function loadIdentity(userId: string): Promise<StoredIdentity | null> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return null
  try {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(await readFile(identityFile(userId)))
    const id = JSON.parse(result) as StoredIdentity
    if (id.v !== 1 || !UUID_RE.test(id.deviceId) || typeof id.identity !== 'string') throw new Error('unknown format')
    if (shouldReEncrypt) await saveIdentity(userId, id).catch((err: Error) => log.warn('e2ee identity re-encryption failed', err.message))
    return id
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('e2ee identity unreadable; a new device identity will be made', (err as Error).message)
    return null
  }
}

/** Refuses plaintext: without DPAPI the identity is not persisted (ephemeral device, 0004 §3.2). */
async function saveIdentity(userId: string, id: StoredIdentity): Promise<boolean> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    log.warn('safeStorage encryption unavailable: E2EE device identity kept for this run only')
    return false
  }
  writeFileAtomic(identityFile(userId), await safeStorage.encryptStringAsync(JSON.stringify(id)))
  return true
}

// ---- lifecycle ------------------------------------------------------------------------------------------------------

/** Signed in (login, or a stored session at startup). Same token again while running: no-op. */
export function startE2ee(url: string, sessionToken: string): void {
  if (token === sessionToken && (state === 'starting' || state === 'ready')) return
  apiUrl = url
  token = sessionToken
  const gen = ++generation
  session = null
  if (!enabled()) return void (state = 'off')
  state = 'starting'
  booting = boot(gen).catch((err: Error) => {
    if (gen !== generation) return
    state = 'error'
    log.warn('e2ee: start failed', err.message)
  })
}

/** Signed out or quitting: the server deletes the device with the session. */
export function stopE2ee(): void {
  ++generation
  token = null
  state = 'off'
  session = null
  deviceId = null
  booting = null
  void stopMls()
}

async function boot(gen: number, rejoin?: string): Promise<void> {
  const live = () => gen === generation
  await warmMls()
  const me = await api<{ id: string }>('GET', '/users/@me')
  if (!live() || !UUID_RE.test(me.id)) return
  const stored = await loadIdentity(me.id)
  let handle: number
  let id: StoredIdentity
  if (stored) {
    handle = (await mls({ op: 'from_identity', bytes: Buffer.from(stored.identity, 'base64') })) as number
    id = stored
    persistent = true
  } else {
    const newId = randomUUID()
    handle = (await mls({ op: 'new', bytes: Buffer.from(`${me.id}:${newId}`) })) as number
    id = { v: 1, deviceId: newId, identity: b64((await mls({ op: 'call', handle, method: 'export_identity', args: [] })) as Uint8Array) }
    persistent = await saveIdentity(me.id, id)
  }
  if (!live()) return
  const call = (method: MlsMethod, ...args: unknown[]) => mls({ op: 'call', handle, method, args })

  let pool = 0
  let refilling: Promise<void> | null = null
  const register = async () => {
    // Registering empties the server pool: the key package secrets of an earlier run are gone with its worker.
    await api('POST', '/e2ee/devices', { deviceId: id.deviceId, signatureKey: b64((await call('signature_public_key')) as Uint8Array) })
    pool = 0
    await refill(true)
  }
  const refill = (exhausted: boolean): Promise<void> => {
    if (exhausted) pool = 0
    if (pool >= POOL_LOW) return Promise.resolve()
    refilling ??= (async () => {
      const keyPackages: string[] = []
      for (let i = pool; i < POOL_TARGET; i++) keyPackages.push(b64((await call('key_package')) as Uint8Array))
      if (!live()) return
      pool = (await api<{ keyPackages: number }>('POST', `/e2ee/devices/${id.deviceId}/key-packages`, { keyPackages })).keyPackages
    })().finally(() => { refilling = null })
    return refilling
  }

  await register()
  if (!live()) return
  deviceId = id.deviceId
  session = new E2eeSession({
    mls: call,
    send: (frame) => emit(IPC.e2eeSend, frame),
    onKey: (k) => emit(IPC.e2eeKey, k),
    onEpoch: (e) => emit(IPC.e2eeEpoch, e),
    replenish: (exhausted) => {
      if (!exhausted) pool = Math.max(0, pool - 1)
      return refill(exhausted)
    },
    reregister: register,
    // Messages and error strings only: keys and MLS bytes never reach the log.
    log: (msg, extra) => log.warn(msg, extra),
  }, me.id, id.deviceId)
  state = 'ready'
  log.info('e2ee ready', { persistent })
  if (rejoin) await session.joinCall(rejoin)
}

// A crashed worker took the device's key package secrets and call state with it: start over and re-join.
onWorkerExit(() => {
  if (state === 'off' || !token || Date.now() - lastCrashRestart < 10_000) return
  lastCrashRestart = Date.now()
  const rejoin = session?.current?.channelId
  const gen = ++generation
  session = null
  state = 'starting'
  booting = boot(gen, rejoin).catch((err: Error) => {
    if (gen === generation) state = 'error'
    log.warn('e2ee: restart after worker exit failed', err.message)
  })
})

async function ready(): Promise<E2eeSession> {
  if (!session && booting) await Promise.race([booting, new Promise((r) => setTimeout(r, READY_WAIT_MS))])
  if (!session) throw new Error(state === 'off' ? 'E2EE is off' : `E2EE is not ready (${state})`)
  return session
}

export function registerE2eeIpc(): void {
  handle(IPC.e2eeStatus, (): E2eeStatus => ({ state, deviceId, persistent, call: session?.current ?? null }))
  handle(IPC.e2eeJoin, async (c) => (await ready()).joinCall(uuid(c)))
  handle(IPC.e2eeLeave, async (c) => session?.leaveCall(uuid(c)))
  handle(IPC.e2eeCode, async (c, u) => session?.verificationCode(uuid(c), u === null ? undefined : uuid(u)) ?? null)
  on(IPC.e2eeDispatch, (t, d) => {
    const type = str(t, 64)
    if (!DISPATCHES.has(type)) throw new TypeError('not an E2EE dispatch')
    void session?.handleDispatch(type, d).catch((err: Error) => log.warn('e2ee: dispatch rejected', err.message))
  })
}
