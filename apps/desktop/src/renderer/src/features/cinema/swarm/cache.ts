/** Verified swarm pieces, keyed `${track}:${n}`. OPFS in the app, memory in tests. */
export interface PieceCache {
  put(key: string, buf: ArrayBuffer): Promise<void>
  get(key: string): Promise<ArrayBuffer | null>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  bytes(): number
}

export function memoryCache(): PieceCache {
  const m = new Map<string, ArrayBuffer>()
  let total = 0
  return {
    async put(k, b) { total += b.byteLength - (m.get(k)?.byteLength ?? 0); m.set(k, b) },
    async get(k) { return m.get(k) ?? null },
    async delete(k) { total -= m.get(k)?.byteLength ?? 0; m.delete(k) },
    async clear() { m.clear(); total = 0 },
    bytes: () => total,
  }
}

const ROOT = 'cinema'

/** OPFS cache at cinema/<sessionId>/<track>/<n>; clear() removes the session dir. */
export async function opfsCache(sessionId: string): Promise<PieceCache> {
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT, { create: true })
  const dir = await root.getDirectoryHandle(sessionId, { create: true })
  const sizes = new Map<string, number>()
  let total = 0
  const split = (k: string) => k.split(':') as [string, string]
  return {
    async put(k, b) {
      const [track, n] = split(k)
      const w = await (await (await dir.getDirectoryHandle(track, { create: true })).getFileHandle(n, { create: true })).createWritable()
      try {
        await w.write(b)
        await w.close()
      } catch (e) {
        await w.abort().catch(() => {})
        throw e
      }
      total += b.byteLength - (sizes.get(k) ?? 0)
      sizes.set(k, b.byteLength)
    },
    async get(k) {
      if (!sizes.has(k)) return null
      const [track, n] = split(k)
      try {
        return await (await (await (await dir.getDirectoryHandle(track)).getFileHandle(n)).getFile()).arrayBuffer()
      } catch {
        return null
      }
    },
    async delete(k) {
      const size = sizes.get(k)
      if (size === undefined) return
      sizes.delete(k)
      total -= size
      const [track, n] = split(k)
      await dir.getDirectoryHandle(track).then((d) => d.removeEntry(n)).catch(() => {})
    },
    async clear() {
      sizes.clear()
      total = 0
      await root.removeEntry(sessionId, { recursive: true }).catch(() => {})
    },
    bytes: () => total,
  }
}

/** Removes every cinema session dir left by a crash. Call at app start, before any session opens. */
export async function clearStaleOpfs(): Promise<void> {
  await navigator.storage.getDirectory().then((r) => r.removeEntry(ROOT, { recursive: true })).catch(() => {})
}
