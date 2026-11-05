import { afterEach, describe, expect, it, vi } from 'vitest'
import { MEMORY_CAP_BYTES, clearStaleOpfs, createPieceCache } from './cache'

/** Just enough of the OPFS handles for the cache (Node has no OPFS). */
class FakeFile {
  data = new ArrayBuffer(0)
  async createWritable() {
    let next = new ArrayBuffer(0)
    return { write: async (b: ArrayBuffer) => { next = b }, close: async () => { this.data = next }, abort: async () => {} }
  }
  async getFile() { return { arrayBuffer: async () => this.data.slice(0) } }
}
class FakeDir {
  entries = new Map<string, FakeDir | FakeFile>()
  private open<T>(name: string, create: boolean | undefined, Kind: new () => T): T {
    let e = this.entries.get(name)
    if (!e) {
      if (!create) throw new DOMException(name, 'NotFoundError')
      this.entries.set(name, (e = new Kind() as FakeDir | FakeFile))
    }
    return e as T
  }
  async getDirectoryHandle(name: string, o?: { create?: boolean }) { return this.open(name, o?.create, FakeDir) }
  async getFileHandle(name: string, o?: { create?: boolean }) { return this.open(name, o?.create, FakeFile) }
  async removeEntry(name: string) { if (!this.entries.delete(name)) throw new DOMException(name, 'NotFoundError') }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('createPieceCache', () => {
  it('uses OPFS at cinema/<sessionId>/<track>/<n> when it is there', async () => {
    const root = new FakeDir()
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } })
    const { cache, kind, capBytes } = await createPieceCache('sess', 4 * 1024 ** 3)
    expect([kind, capBytes]).toEqual(['opfs', 4 * 1024 ** 3])
    await cache.put('v:3', new Uint8Array([1, 2, 3]).buffer)
    await cache.put('a1:0', new Uint8Array([9]).buffer)
    expect(cache.bytes()).toBe(4)
    const file = ((root.entries.get('cinema') as FakeDir).entries.get('sess') as FakeDir).entries.get('v') as FakeDir
    expect(file.entries.has('3')).toBe(true)
    expect([...new Uint8Array((await cache.get('v:3'))!)]).toEqual([1, 2, 3])
    expect(await cache.get('v:4')).toBeNull()
    await cache.delete('v:3')
    expect([cache.bytes(), await cache.get('v:3')]).toEqual([1, null])
    await cache.clear()
    expect([cache.bytes(), (root.entries.get('cinema') as FakeDir).entries.has('sess')]).toEqual([0, false])
    await clearStaleOpfs()
    expect(root.entries.has('cinema')).toBe(false)
  })

  it('falls back to memory (cap ≤ 1 GiB) when OPFS throws or is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('navigator', { storage: { getDirectory: () => Promise.reject(new DOMException('no', 'SecurityError')) } })
    const a = await createPieceCache('sess', 4 * 1024 ** 3)
    expect([a.kind, a.capBytes]).toEqual(['memory', MEMORY_CAP_BYTES])
    vi.stubGlobal('navigator', {})
    const b = await createPieceCache('sess', 512 * 1024 ** 2)
    expect([b.kind, b.capBytes]).toEqual(['memory', 512 * 1024 ** 2])
    await b.cache.put('v:1', new ArrayBuffer(5))
    expect(b.cache.bytes()).toBe(5)
    await expect(clearStaleOpfs()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
