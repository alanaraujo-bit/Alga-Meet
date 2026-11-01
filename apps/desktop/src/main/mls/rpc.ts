// The MLS RPC surface of the "alga-e2ee" worker, kept free of Electron so tests drive the same code over the real WASM.

/** Client methods main may call (the DS-only `external_propose_*` stay server-side). */
export const MLS_METHODS = [
  'export_identity',
  'signature_public_key',
  'key_package',
  'create_group',
  'group_info',
  'process_welcome',
  'commit_pending',
  'clear_pending_commit',
  'process',
  'leave',
  'epoch',
  'own_leaf_index',
  'members',
  'epoch_authenticator',
  'export_secret',
] as const
export type MlsMethod = (typeof MLS_METHODS)[number]

export type MlsOp =
  | { op: 'new' | 'from_identity'; bytes: Uint8Array }
  | { op: 'call'; handle: number; method: MlsMethod; args: unknown[] }
  | { op: 'free'; handle: number }
export type MlsMessage =
  | { ready: true; initMs: number }
  | { ready: false; error: string }
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string }

type WasmClient = Record<string, unknown> & { free(): void }
export interface Glue {
  Client: {
    new (identity: Uint8Array): WasmClient
    from_identity(blob: Uint8Array): WasmClient
  }
}

/** Handle table over the wasm-bindgen glue; one runner per worker. Throws (strings from WASM) on failure. */
export function createRunner(glue: Glue): (m: MlsOp) => unknown {
  const clients = new Map<number, WasmClient>()
  let nextHandle = 1
  return (m) => {
    if (m.op === 'free') {
      clients.get(m.handle)?.free()
      return clients.delete(m.handle)
    }
    if (m.op !== 'call') {
      const c = m.op === 'new' ? new glue.Client(m.bytes) : glue.Client.from_identity(m.bytes)
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
}
