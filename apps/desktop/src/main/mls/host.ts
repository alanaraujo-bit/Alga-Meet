import { join } from 'node:path'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import { log } from '../log'
import type { MlsMessage, MlsOp } from './rpc'

// Main-side handle on the "alga-e2ee" utilityProcess (0004 §3.1). Only src/main/mls/e2ee.ts talks to it; the renderer
// never does. The worker starts on first use and again after a crash (onWorkerExit: its handles are gone then).

/** wasm-bindgen glue + .wasm: native/mls/pkg in dev, resources/mls when packaged (electron-builder extraResources). */
const gluePath = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, 'mls', 'alga_mls.js')
    : join(app.getAppPath(), '..', '..', 'native', 'mls', 'pkg', 'alga_mls.js')

let worker: Promise<UtilityProcess> | null = null
let nextId = 1
const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()
const exitListeners = new Set<() => void>()

function start(): Promise<UtilityProcess> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(join(__dirname, 'mls-worker.js'), [gluePath()], { serviceName: 'alga-e2ee' })
    child.on('message', (m: MlsMessage) => {
      if ('ready' in m) {
        if (m.ready) return resolve(child)
        reject(new Error(`alga-e2ee: ${m.error}`))
        return void child.kill()
      }
      const p = pending.get(m.id)
      pending.delete(m.id)
      if (m.ok) p?.resolve(m.value)
      else p?.reject(new Error(m.error))
    })
    child.once('exit', (code) => {
      worker = null
      if (code !== 0) log.warn('alga-e2ee exited', code)
      reject(new Error(`alga-e2ee exited (${code})`))
      for (const p of pending.values()) p.reject(new Error(`alga-e2ee exited (${code})`))
      pending.clear()
      for (const fn of exitListeners) fn()
    })
  })
}

/** One request to the MLS worker: `new`/`from_identity` resolve to a client handle. */
export async function mls(op: MlsOp): Promise<unknown> {
  worker ??= start()
  const child = await worker.catch((err) => {
    worker = null
    throw err
  })
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    child.postMessage({ id, ...op })
  })
}

/** Starts the worker now (pre-warm: cold start is 54–77 ms, too much for the join path). */
export async function warmMls(): Promise<void> {
  worker ??= start()
  await worker
}

export function onWorkerExit(fn: () => void): () => void {
  exitListeners.add(fn)
  return () => exitListeners.delete(fn)
}

export async function stopMls(): Promise<void> {
  const w = worker
  worker = null
  if (w) (await w.catch(() => null))?.kill()
}
