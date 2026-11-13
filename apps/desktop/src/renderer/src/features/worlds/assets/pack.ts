/**
 * The 3D asset pack (models, textures, skies, the mannequin and its animations). It is not part of the installer: the
 * app stays small, and the pack is fetched the first time someone opens a world, one file at a time and only what the
 * room in front of them uses. Every file is listed in the pack's manifest with its SHA-256; a file is kept (in the
 * origin's private file system) only after its bytes match, so a damaged or tampered download never reaches the GPU,
 * and the second visit works offline.
 */

export interface PackFile {
  sha256: string
  bytes: number
}
export interface PackManifest {
  version: number
  pack: string
  files: Record<string, PackFile>
  models: Record<string, { file: string; size: [number, number, number]; tris: number }>
  textures: Record<string, { color: string; normal: string; arm: string; tileMeters: number }>
  skies: Record<string, { image: string; hdr: string }>
  avatar: {
    bodies: Record<string, string>
    animations: string
    clips: Record<string, { duration: number; loop: boolean }>
  }
}

export type PackErrorKind = 'offline' | 'missing' | 'corrupt' | 'unsupported'
export class PackError extends Error {
  constructor(readonly kind: PackErrorKind, message: string) {
    super(message)
    this.name = 'PackError'
  }
}

const CACHE_DIR = 'alga-worlds-v1'
const MANIFEST_KEY = 'manifest.json'
const SUPPORTED_VERSION = 1
const PARALLEL = 6

/** What is being fetched, for the progress line of the loading screen. */
export interface PackProgress {
  /** Bytes still to come and already here, over the files asked for since the last time nothing was pending. */
  loaded: number
  total: number
}

function isManifest(v: unknown): v is PackManifest {
  const m = v as PackManifest | null
  return !!m && typeof m === 'object' && typeof m.version === 'number' && !!m.files && typeof m.files === 'object'
    && !!m.models && !!m.textures && !!m.skies && !!m.avatar?.bodies && typeof m.avatar.animations === 'string'
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  let s = ''
  for (const b of d) s += b.toString(16).padStart(2, '0')
  return s
}

/** The origin's private folder for the pack, or null where the platform has none (then nothing is kept between runs). */
async function cacheDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory()
    return await root.getDirectoryHandle(CACHE_DIR, { create: true })
  } catch {
    return null
  }
}

async function readCached(dir: FileSystemDirectoryHandle | null, name: string): Promise<ArrayBuffer | null> {
  if (!dir) return null
  try {
    const f = await (await dir.getFileHandle(name)).getFile()
    return await f.arrayBuffer()
  } catch {
    return null
  }
}

async function writeCached(dir: FileSystemDirectoryHandle | null, name: string, bytes: ArrayBuffer): Promise<void> {
  if (!dir) return
  try {
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
    await w.write(bytes)
    await w.close()
  } catch {
    // A full disk or a locked file only costs the next visit a download.
  }
}

export class AssetPack {
  manifest!: PackManifest
  private dir: FileSystemDirectoryHandle | null = null
  private readonly pending = new Map<string, Promise<ArrayBuffer>>()
  private readonly waiting: (() => void)[] = []
  private running = 0
  private progress: PackProgress = { loaded: 0, total: 0 }
  private readonly listeners = new Set<(p: PackProgress) => void>()

  /** `baseUrl`: where the pack is, without a trailing slash (READY.worlds.assetsUrl resolved against the API). */
  constructor(private readonly baseUrl: string) {}

  /**
   * Gets the manifest: the server's when it answers, else the one kept from the last visit. Throws PackError 'offline'
   * when neither exists.
   */
  async open(signal?: AbortSignal): Promise<void> {
    this.dir = await cacheDir()
    let fresh: PackManifest | null = null
    try {
      const res = await fetch(`${this.baseUrl}/${MANIFEST_KEY}`, { signal, cache: 'no-cache' })
      if (res.status === 404) throw new PackError('missing', 'the server has no asset pack')
      if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`)
      const text = await res.text()
      const parsed: unknown = JSON.parse(text)
      if (!isManifest(parsed)) throw new PackError('corrupt', 'the manifest has an unknown shape')
      fresh = parsed
      await writeCached(this.dir, MANIFEST_KEY, new TextEncoder().encode(text).buffer as ArrayBuffer)
    } catch (err) {
      if (signal?.aborted) throw err
      if (err instanceof PackError) throw err
      const kept = await readCached(this.dir, MANIFEST_KEY)
      if (kept) {
        try {
          const parsed: unknown = JSON.parse(new TextDecoder().decode(kept))
          if (isManifest(parsed)) fresh = parsed
        } catch { /* fall through to offline */ }
      }
      if (!fresh) throw new PackError('offline', `the asset pack could not be reached: ${(err as Error).message}`)
    }
    if (fresh.version !== SUPPORTED_VERSION) throw new PackError('unsupported', `asset pack version ${fresh.version} needs a newer app`)
    this.manifest = fresh
    void this.sweep()
  }

  onProgress(cb: (p: PackProgress) => void): () => void {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }

  /** The bytes of one file of the pack, verified. Asking twice shares the same download. */
  file(path: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    const meta = this.manifest.files[path]
    if (!meta) return Promise.reject(new PackError('missing', `not in the pack: ${path}`))
    let p = this.pending.get(path)
    if (!p) {
      p = this.load(path, meta, signal)
      this.pending.set(path, p)
      // A failed download may be tried again; a good one stays shared while the engine holds on to it.
      p.catch(() => this.pending.delete(path))
    }
    return p
  }

  /** Lets go of the shared buffers (the engine keeps what it built from them). */
  release(): void {
    this.pending.clear()
  }

  private async load(path: string, meta: PackFile, signal?: AbortSignal): Promise<ArrayBuffer> {
    const kept = await readCached(this.dir, meta.sha256)
    if (kept && kept.byteLength === meta.bytes) return kept
    this.bump(0, meta.bytes)
    await this.slot()
    try {
      let lastErr: unknown
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(`${this.baseUrl}/${path}`, { signal })
          if (!res.ok) throw new PackError(res.status === 404 ? 'missing' : 'offline', `${path}: HTTP ${res.status}`)
          const bytes = await res.arrayBuffer()
          if (bytes.byteLength !== meta.bytes || (await sha256Hex(bytes)) !== meta.sha256) throw new PackError('corrupt', `${path}: the bytes do not match the manifest`)
          await writeCached(this.dir, meta.sha256, bytes)
          this.bump(meta.bytes, 0)
          return bytes
        } catch (err) {
          if (signal?.aborted) throw err
          lastErr = err
        }
      }
      this.bump(0, -meta.bytes)
      if (lastErr instanceof PackError) throw lastErr
      throw new PackError('offline', `${path}: ${(lastErr as Error).message}`)
    } finally {
      this.done()
    }
  }

  private slot(): Promise<void> {
    if (this.running < PARALLEL) {
      this.running++
      return Promise.resolve()
    }
    return new Promise((resolve) => this.waiting.push(() => { this.running++; resolve() }))
  }

  private done(): void {
    this.running--
    this.waiting.shift()?.()
    if (this.running === 0 && this.waiting.length === 0 && this.progress.loaded >= this.progress.total) {
      this.progress = { loaded: 0, total: 0 }
    }
  }

  private bump(loaded: number, total: number): void {
    this.progress = { loaded: this.progress.loaded + loaded, total: this.progress.total + total }
    for (const cb of this.listeners) cb(this.progress)
  }

  /** Removes what an older pack left behind: files whose hash the current manifest no longer lists. */
  private async sweep(): Promise<void> {
    const dir = this.dir
    if (!dir) return
    const live = new Set(Object.values(this.manifest.files).map((f) => f.sha256))
    try {
      const names: string[] = []
      for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name)
      for (const name of names) if (name !== MANIFEST_KEY && !live.has(name)) await dir.removeEntry(name).catch(() => {})
    } catch {
      // Best effort.
    }
  }
}

/** READY.worlds.assetsUrl may be a path on the API (`/api/v1/worlds/assets`) or a whole URL (a CDN). */
export function resolveAssetsUrl(assetsUrl: string, apiUrl: string): string {
  return new URL(assetsUrl, apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`).toString().replace(/\/+$/, '')
}
