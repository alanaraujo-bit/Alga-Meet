import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssetPack, PackError, resolveAssetsUrl, type PackManifest } from './pack'

const bytes = (s: string) => new TextEncoder().encode(s)
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

const CHAIR = bytes('glTF chair bytes')
const manifest = (over: Partial<PackManifest> = {}): PackManifest => ({
  version: 1, pack: '2026-11-13',
  files: { 'models/chair.glb': { sha256: sha(CHAIR), bytes: CHAIR.byteLength } },
  models: { chair: { file: 'models/chair.glb', size: [1, 1, 1], tris: 10 } },
  textures: {}, skies: {}, avatar: { bodies: { a: 'avatar/a.glb' }, animations: 'avatar/anim.glb', clips: {} },
  ...over,
})

/** A server for the pack: path → body (or a status), counting what was asked for. */
function serve(routes: Record<string, Uint8Array | string | number>) {
  const asked: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.replace('https://cdn.test/pack/', '')
    asked.push(path)
    const r = routes[path]
    if (r === undefined) return new Response(null, { status: 404 })
    if (typeof r === 'number') return new Response(null, { status: r })
    return new Response(r as BodyInit, { status: 200 })
  }))
  return asked
}

afterEach(() => vi.unstubAllGlobals())

describe('the 3D asset pack', () => {
  it('hands out a file only when its bytes match the manifest', async () => {
    const asked = serve({ 'manifest.json': JSON.stringify(manifest()), 'models/chair.glb': CHAIR })
    const pack = new AssetPack('https://cdn.test/pack')
    await pack.open()
    const got = new Uint8Array(await pack.file('models/chair.glb'))
    expect(got).toEqual(CHAIR)
    // Asked twice, fetched once.
    await pack.file('models/chair.glb')
    expect(asked.filter((p) => p === 'models/chair.glb')).toHaveLength(1)
  })

  it('refuses bytes that were changed on the way, after trying once more', async () => {
    const asked = serve({ 'manifest.json': JSON.stringify(manifest()), 'models/chair.glb': bytes('glTF chair bytez') })
    const pack = new AssetPack('https://cdn.test/pack')
    await pack.open()
    await expect(pack.file('models/chair.glb')).rejects.toMatchObject({ name: 'PackError', kind: 'corrupt' })
    expect(asked.filter((p) => p === 'models/chair.glb')).toHaveLength(2)
  })

  it('refuses a path the manifest does not list, without asking the network', async () => {
    const asked = serve({ 'manifest.json': JSON.stringify(manifest()) })
    const pack = new AssetPack('https://cdn.test/pack')
    await pack.open()
    await expect(pack.file('../secrets.txt')).rejects.toMatchObject({ kind: 'missing' })
    expect(asked).toEqual(['manifest.json'])
  })

  it('says why it cannot start: no pack on the server, unreachable, a shape or a version it does not know', async () => {
    serve({})
    await expect(new AssetPack('https://cdn.test/pack').open()).rejects.toMatchObject({ kind: 'missing' })
    serve({ 'manifest.json': 503 })
    await expect(new AssetPack('https://cdn.test/pack').open()).rejects.toMatchObject({ kind: 'offline' })
    serve({ 'manifest.json': JSON.stringify({ hello: 'world' }) })
    await expect(new AssetPack('https://cdn.test/pack').open()).rejects.toMatchObject({ kind: 'corrupt' })
    serve({ 'manifest.json': JSON.stringify(manifest({ version: 2 })) })
    const err = await new AssetPack('https://cdn.test/pack').open().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PackError)
    expect((err as PackError).kind).toBe('unsupported')
  })

  it('reports how much is still to come while files download', async () => {
    serve({ 'manifest.json': JSON.stringify(manifest()), 'models/chair.glb': CHAIR })
    const pack = new AssetPack('https://cdn.test/pack')
    await pack.open()
    const seen: [number, number][] = []
    pack.onProgress((p) => seen.push([p.loaded, p.total]))
    await pack.file('models/chair.glb')
    expect(seen[0]).toEqual([0, CHAIR.byteLength])
    expect(seen.at(-1)).toEqual([CHAIR.byteLength, CHAIR.byteLength])
  })

  it('resolves where the pack is from what the server says: a path on the API or a whole URL', () => {
    expect(resolveAssetsUrl('/api/v1/worlds/assets', 'https://api.alga.test')).toBe('https://api.alga.test/api/v1/worlds/assets')
    expect(resolveAssetsUrl('/api/v1/worlds/assets/', 'http://localhost:4000/')).toBe('http://localhost:4000/api/v1/worlds/assets')
    expect(resolveAssetsUrl('https://cdn.alga.test/worlds/v1', 'https://api.alga.test')).toBe('https://cdn.alga.test/worlds/v1')
  })
})
