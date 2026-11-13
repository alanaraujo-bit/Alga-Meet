// Download cache. Everything fetched from the network lands under .cache/ (git-ignored) and is only ever
// parsed by the scripts in this package, never executed.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TOOL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const CACHE_DIR = join(TOOL_DIR, '.cache')

const USER_AGENT = 'asset-pipeline/1.0'
const ALLOWED_HOSTS = new Set(['api.polyhaven.com', 'dl.polyhaven.org', 'cdn.polyhaven.com', 'opengameart.org'])

/** Resolves a relative path inside the cache and refuses anything that would escape it. */
export function cachePath(...parts) {
  const target = resolve(CACHE_DIR, ...parts)
  if (target !== CACHE_DIR && !target.startsWith(CACHE_DIR + sep)) throw new Error(`path escapes the cache: ${parts.join('/')}`)
  return target
}

export function md5(buffer) {
  return createHash('md5').update(buffer).digest('hex')
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function fetchBuffer(url, attempts = 4) {
  const { protocol, hostname } = new URL(url)
  if (protocol !== 'https:' || !ALLOWED_HOSTS.has(hostname)) throw new Error(`refusing to fetch ${url}`)
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(180_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      await new Promise((done) => setTimeout(done, 800 * attempt))
    }
  }
  throw new Error(`download failed: ${url} (${lastError?.message})`)
}

/** Cache path -> pending read or download of it. */
const inFlight = new Map()

/**
 * Returns the bytes of `url`, downloading them into the cache at `relPath` when missing.
 * When `expectedMd5` / `expectedSha256` is given, a cached or downloaded file that does not match is rejected.
 */
export function cached(url, relPath, { expectedMd5, expectedSha256 } = {}) {
  const target = cachePath(relPath)
  // Steps run in parallel and several of them want the same file (the asset lists, shared textures): one
  // download per cache path, everyone else waits for it.
  if (!inFlight.has(target)) {
    const matches = (bytes) => (!expectedMd5 || md5(bytes) === expectedMd5) && (!expectedSha256 || sha256(bytes) === expectedSha256)
    const load = async () => {
      if (existsSync(target)) {
        const bytes = await readFile(target)
        if (matches(bytes)) return bytes
      }
      const bytes = await fetchBuffer(url)
      if (!matches(bytes)) throw new Error(`checksum mismatch for ${url}`)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(`${target}.part`, bytes)
      await rename(`${target}.part`, target)
      return bytes
    }
    inFlight.set(
      target,
      load().finally(() => inFlight.delete(target)),
    )
  }
  return inFlight.get(target)
}

export async function cachedJson(url, relPath) {
  return JSON.parse((await cached(url, relPath)).toString('utf8'))
}

/** Runs `worker` over `items` with at most `limit` in flight; results keep the input order. */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

// ---- Poly Haven -----------------------------------------------------------------------------------------------

const API = 'https://api.polyhaven.com'

/** All assets of one type (`models` | `textures` | `hdris`), keyed by id. */
export function polyhavenList(type) {
  return cachedJson(`${API}/assets?t=${type}`, `polyhaven/api/assets-${type}.json`)
}

export function polyhavenInfo(id) {
  return cachedJson(`${API}/info/${id}`, `polyhaven/api/info-${id}.json`)
}

export function polyhavenFiles(id) {
  return cachedJson(`${API}/files/${id}`, `polyhaven/api/files-${id}.json`)
}

/** Downloads one `{ url, md5 }` file entry of a /files response. */
export function polyhavenFile(entry, relPath) {
  if (!entry?.url) throw new Error(`missing file entry for ${relPath}`)
  return cached(entry.url, relPath, { expectedMd5: entry.md5 })
}

export function polyhavenThumb(id, size = 256) {
  return cached(`https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=${size}&height=${size}`, `polyhaven/thumbs/${id}-${size}.png`)
}

/** Flat preview render: for HDRIs this is the whole equirectangular panorama (2:1), tonemapped. */
export function polyhavenPreview(id, height = 256) {
  return cached(`https://cdn.polyhaven.com/asset_img/primary/${id}.png?height=${height}`, `polyhaven/previews/${id}-${height}.png`)
}
