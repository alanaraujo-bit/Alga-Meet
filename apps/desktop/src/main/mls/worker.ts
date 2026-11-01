// utilityProcess "alga-e2ee" (docs/decisions/0004-e2ee.md §3.1): hosts the OpenMLS WASM (native/mls) out of
// main and the renderer. Talks only to main over parentPort. argv[2] = path of the wasm-bindgen glue
// (alga_mls.js, which loads alga_mls_bg.wasm from its own directory).
import { createRequire } from 'node:module'

/** Client methods main may call (the DS-only `external_propose_*` stay server-side). */
export const MLS_METHODS = [
  'export_identity',
  'signature_public_key',
  'save_state',
  'key_package',
  'create_group',
  'process_welcome',
  'add_members',
  'remove_members',
  'commit_pending',
  'merge_pending_commit',
  'process',
  'epoch',
  'own_leaf_index',
  'export_secret',
] as const
export type MlsMethod = (typeof MLS_METHODS)[number]

export type MlsOp =
  | { op: 'new' | 'from_identity' | 'load_state'; bytes: Uint8Array }
  | { op: 'call'; handle: number; method: MlsMethod; args: unknown[] }
  | { op: 'free'; handle: number }
export type MlsMessage =
  | { ready: true; initMs: number }
  | { ready: false; error: string }
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string }

type WasmClient = Record<string, unknown> & { free(): void }
interface Glue {
  Client: {
    new (identity: Uint8Array): WasmClient
    from_identity(blob: Uint8Array): WasmClient
    load_state(blob: Uint8Array): WasmClient
  }
}

const port = process.parentPort
const clients = new Map<number, WasmClient>()
let nextHandle = 1

function run(glue: Glue, m: MlsOp): unknown {
  if (m.op === 'free') {
    clients.get(m.handle)?.free()
    return clients.delete(m.handle)
  }
  if (m.op !== 'call') {
    const c = m.op === 'new' ? new glue.Client(m.bytes) : glue.Client[m.op](m.bytes)
    clients.set(nextHandle, c)
    return nextHandle++
  }
  const c = clients.get(m.handle)
  if (!c) throw new Error('unknown handle')
  if (!MLS_METHODS.includes(m.method)) throw new Error('method not allowed')
  const value = (c[m.method] as (...a: unknown[]) => unknown).apply(c, m.args)
  // wasm-bindgen Commit object: copy out to plain bytes and release the WASM side.
  if (value && typeof value === 'object' && 'commit' in value) {
    const out = value as { commit: Uint8Array; welcome?: Uint8Array; free(): void }
    const { commit, welcome } = out
    out.free()
    return { commit, welcome: welcome ?? null }
  }
  return value
}

const t0 = performance.now()
try {
  const glue = createRequire(__filename)(process.argv[2] ?? '') as Glue
  port.on('message', ({ data }: { data: { id: number } & MlsOp }) => {
    let reply: MlsMessage
    try {
      reply = { id: data.id, ok: true, value: run(glue, data) }
    } catch (err) {
      // The WASM layer throws plain strings.
      reply = { id: data.id, ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    port.postMessage(reply)
  })
  port.postMessage({ ready: true, initMs: performance.now() - t0 } satisfies MlsMessage)
} catch (err) {
  port.postMessage({ ready: false, error: String(err) } satisfies MlsMessage)
}
