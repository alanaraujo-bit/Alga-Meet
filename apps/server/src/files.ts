/**
 * Uploads: spooling multipart files to disk, sniffing the real type, re-encoding images without metadata (sharp),
 * filename sanitizing, signed download URLs,
 * response headers that keep user files inert, and the storage deletion outbox (`storage_deletions`).
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { eq, inArray, lte, sql } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { fileTypeFromFile } from 'file-type'
import { imageSize } from 'image-size'
import sharp from 'sharp'
import type { Config } from './config.js'
import type { Db, Tx } from './db/index.js'
import { storageDeletions } from './db/schema.js'
import { HttpError, invalid, safeErr } from './errors.js'
import type { Storage } from './storage.js'

/** Served inline (and rendered by clients) only for these sniffed types; anything else is an octet-stream download. */
const INLINE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/ogg', 'audio/ogg; codecs=opus', 'audio/opus', 'audio/wav', 'audio/flac', 'audio/x-flac', 'audio/mp4', 'audio/x-m4a', 'audio/webm',
])
const OCTET = 'application/octet-stream'
/** Larger images decode to gigabytes in every viewer's renderer: they are kept as downloads. */
const MAX_INLINE_SIDE = 16_384
const MAX_INLINE_PIXELS = 50_000_000
/** image-size reads headers only; JPEG dimensions can sit behind large EXIF/ICC segments. */
const HEAD_BYTES = 1024 * 1024

export const isInlineType = (contentType: string) => INLINE_TYPES.has(contentType)

export const tooLarge = (max: number) =>
  new HttpError('validation', `Arquivo maior que o limite de ${Math.floor(max / (1024 * 1024))} MB.`, { files: 'Arquivo grande demais.' }, 413)

export interface Spooled {
  path: string
  size: number
  sha256: string
  /** Client-supplied name (unsanitized). */
  name: string
}

/** Streams an upload to a temp file, hashing and counting; 413 if busboy truncated it at `maxBytes`. */
export async function spool(file: Readable & { truncated?: boolean }, name: string, maxBytes: number): Promise<Spooled> {
  const path = join(tmpdir(), `alga-upload-${randomUUID()}`)
  const hash = createHash('sha256')
  let size = 0
  try {
    await pipeline(file, async function* (src: AsyncIterable<Buffer>) {
      for await (const chunk of src) {
        hash.update(chunk)
        size += chunk.length
        yield chunk
      }
    }, createWriteStream(path))
    if (file.truncated || size > maxBytes) throw tooLarge(maxBytes)
  } catch (err) {
    await rm(path, { force: true })
    throw err
  }
  return { path, size, sha256: hash.digest('hex'), name }
}

export interface Inspected {
  /** What is stored and served: the sniffed type when inline-safe, otherwise application/octet-stream. */
  contentType: string
  /** Sniffed type (or undefined when unknown), for validation. */
  sniffed?: string
  ext?: string
  width?: number
  height?: number
}

/** Real type from the bytes (file-type) and, for images, displayed dimensions (image-size). */
export async function inspect(path: string): Promise<Inspected> {
  const ft = await fileTypeFromFile(path)
  if (!ft) return { contentType: OCTET }
  const out: Inspected = { contentType: OCTET, sniffed: ft.mime, ext: ft.ext }
  if (ft.mime.startsWith('image/')) {
    const fh = await open(path)
    try {
      const head = Buffer.alloc(HEAD_BYTES)
      const { bytesRead } = await fh.read(head, 0, HEAD_BYTES, 0)
      const d = imageSize(head.subarray(0, bytesRead))
      if (d.width && d.height) {
        // EXIF orientations 5–8 are rotated 90°: browsers display them with the sides swapped.
        const swap = (d.orientation ?? 1) >= 5
        out.width = swap ? d.height : d.width
        out.height = swap ? d.width : d.height
      }
    } catch {
      // Unknown dimensions: stays a download (below).
    } finally {
      await fh.close()
    }
  }
  const image = ft.mime.startsWith('image/')
  const sane = !image || (out.width !== undefined && out.height !== undefined &&
    Math.max(out.width, out.height) <= MAX_INLINE_SIDE && out.width * out.height <= MAX_INLINE_PIXELS)
  if (INLINE_TYPES.has(ft.mime) && sane) out.contentType = ft.mime
  return out
}

// Uploads are one-shot: libvips' operation cache would only keep decoded inputs alive.
sharp.cache(false)

/** Decoded pixels (all frames together) above which an upload is treated as a decompression bomb and refused. */
export const MAX_IMAGE_PIXELS = 100_000_000
export const MAX_IMAGE_FRAMES = 500
/** Attachments keep their size up to this many px per side (scaled down beyond it); avatars and icons use 1024. */
export const MAX_ATTACHMENT_SIDE = 8192
export const MAX_PROFILE_IMAGE_SIDE = 1024

type ImageFormat = 'jpeg' | 'png' | 'webp' | 'gif'
/** Every inline image type is re-encoded (sniffed type → output); other images stay octet-stream downloads. */
const SCRUB_FORMAT: Record<string, ImageFormat> = {
  'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  // AVIF encoding is slow; WebP keeps alpha and renders everywhere.
  'image/avif': 'webp',
}
const FORMAT_TYPE: Record<ImageFormat, [contentType: string, ext: string]> = {
  jpeg: ['image/jpeg', 'jpg'], png: ['image/png', 'png'], webp: ['image/webp', 'webp'], gif: ['image/gif', 'gif'],
}
export const canScrub = (sniffed: string | undefined): sniffed is string => !!sniffed && sniffed in SCRUB_FORMAT

// Each decode can hold hundreds of MB: two at a time per process, the rest wait their turn.
const MAX_DECODES = 2
let decoding = 0
const decodeQueue: (() => void)[] = []
async function oneOfTwo<T>(fn: () => Promise<T>): Promise<T> {
  if (decoding < MAX_DECODES) decoding++
  else await new Promise<void>((resolve) => decodeQueue.push(resolve)) // a finishing job hands its slot over
  try {
    return await fn()
  } finally {
    const next = decodeQueue.shift()
    if (next) next()
    else decoding--
  }
}

export interface Scrubbed extends Spooled {
  contentType: string
  ext: string
  width: number
  height: number
}

/**
 * Re-encodes the image at `f.path` in place so no metadata survives (EXIF with GPS, XMP, IPTC, comments, ICC): the
 * EXIF orientation is applied to the pixels, colors are converted to sRGB, it is scaled down to fit `maxSide` (never
 * up) and animation is kept. 400 for decompression bombs (MAX_IMAGE_PIXELS), too many frames or undecodable data.
 */
export async function scrubImage(f: Spooled, sniffed: string, maxSide: number, format: ImageFormat = SCRUB_FORMAT[sniffed]!): Promise<Scrubbed> {
  const input = await readFile(f.path)
  // `limitInputPixels` counts every frame of an animation; `failOn: 'error'` tolerates truncated phone JPEGs.
  const load = { animated: true, autoOrient: true, limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' } as const
  const bomb = invalid({ files: `Imagem grande demais (máximo de ${MAX_IMAGE_PIXELS / 1_000_000} megapixels somando os quadros).` })
  const failed = (err: Error) => {
    throw /pixel limit/i.test(err.message) ? bomb : invalid({ files: 'Imagem corrompida ou em formato não suportado.' })
  }
  const { data, info } = await oneOfTwo(async () => {
    // Header only: bombs and frame counts are refused before any pixel is decoded.
    const meta = await sharp(input, load).metadata().catch(failed)
    if (!meta.width || !meta.height) failed(new Error('no dimensions'))
    if (meta.width * meta.height > MAX_IMAGE_PIXELS) throw bomb
    if ((meta.pages ?? 1) > MAX_IMAGE_FRAMES) throw invalid({ files: `Animação com mais de ${MAX_IMAGE_FRAMES} quadros.` })
    const img = sharp(input, load).resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    // Without keepMetadata/withMetadata sharp writes no metadata at all and converts to sRGB.
    const out = format === 'jpeg' ? img.jpeg({ quality: 90 }) : format === 'png' ? img.png() : format === 'webp' ? img.webp({ quality: 90 }) : img.gif()
    return out.toBuffer({ resolveWithObject: true }).catch(failed)
  })
  await writeFile(f.path, data)
  const [contentType, ext] = FORMAT_TYPE[format]
  return {
    ...f, size: data.length, sha256: createHash('sha256').update(data).digest('hex'),
    contentType, ext, width: info.width, height: info.pageHeight ?? info.height,
  }
}

// Controls, C1, zero-width and bidi overrides (spoofing "gpj.exe" as "exe.jpg"), and characters Windows refuses.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g
const RESERVED = /[<>:"/\\|?*]/g
const MAX_NAME = 128

/** Display/download name: last path segment, no unsafe characters, ≤ 128 code points; media get their real extension. */
export function safeFilename(raw: string | undefined, info: Pick<Inspected, 'contentType' | 'ext'>): string {
  let name = (raw ?? '').normalize('NFC').split(/[\\/]/).pop()!.replace(UNSAFE_CHARS, '').replace(RESERVED, '_')
  name = name.replace(/^[\s.]+|[\s.]+$/g, '') || 'arquivo'
  const dot = name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot + 1).toLowerCase()] : [name, '']
  // An image named "x.html" must not be saved as HTML (polyglot files).
  if (isInlineType(info.contentType) && info.ext && ext !== info.ext && !(info.ext === 'jpg' && ext === 'jpeg')) {
    name = `${stem}.${info.ext}`
  }
  const chars = [...name]
  if (chars.length > MAX_NAME) {
    const d = name.lastIndexOf('.')
    const keep = d > 0 && name.length - d <= 16 ? [...name.slice(d)] : []
    name = chars.slice(0, MAX_NAME - keep.length).join('') + keep.join('')
  }
  return name
}

/** RFC 6266: ASCII fallback plus the UTF-8 name. */
export function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\%]/g, '_')
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf8}`
}

/** Every user-file response: never sniffed, never scriptable, loadable from the desktop renderer's origin. */
export const FILE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; sandbox",
  'cross-origin-resource-policy': 'cross-origin',
  'referrer-policy': 'no-referrer',
} as const

/** Avatars and space icons: the four formats every client renders, never SVG (scriptable). */
export const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
export const IMAGE_TYPE_BY_EXT = Object.fromEntries(Object.entries(IMAGE_EXT).map(([t, e]) => [e, t]))
export const IMAGE_NAME_RE = /^[0-9a-f]{32}\.(png|jpg|webp|gif)$/

const URL_BUCKET_S = 300
const PENDING_MS = 60 * 60 * 1000

export class Files {
  private timer: NodeJS.Timeout | undefined
  private sweeping: Promise<number> | undefined

  constructor(private readonly config: Config, private readonly db: Db, readonly storage: Storage, private readonly log: FastifyBaseLogger) {}

  private mac(id: string, uid: string, exp: number): string {
    return createHmac('sha256', this.config.files.secret).update(`file:${id}:${uid}:${exp}`).digest('base64url')
  }

  /**
   * Download URL for one viewer. `exp` is rounded up to 5 minutes so repeated fetches yield the same URL (cacheable);
   * the download re-checks that `uid` can still view the channel.
   */
  url(id: string, uid: string, now = Date.now()): string {
    const exp = Math.ceil((now / 1000 + this.config.files.urlTtlSeconds) / URL_BUCKET_S) * URL_BUCKET_S
    return `${this.config.publicUrl}/api/v1/files/${id}?uid=${uid}&exp=${exp}&sig=${this.mac(id, uid, exp)}`
  }

  verify(id: string, uid: string, exp: number, sig: string, now = Date.now()): boolean {
    if (exp * 1000 <= now) return false
    const want = Buffer.from(this.mac(id, uid, exp))
    const got = Buffer.from(sig)
    return got.length === want.length && timingSafeEqual(got, want)
  }

  /** Public URL of an avatar/icon object and its storage key. */
  imageUrl(kind: 'avatars' | 'icons', ownerId: string, name: string): string {
    return `${this.config.publicUrl}/api/v1/${kind}/${ownerId}/${name}`
  }

  /** Storage key of `url` when it is one of our avatar/icon URLs for `ownerId`, else null. */
  imageKey(kind: 'avatars' | 'icons', ownerId: string, url: string | null | undefined): string | null {
    const prefix = `${this.config.publicUrl}/api/v1/${kind}/${ownerId}/`
    if (!url?.startsWith(prefix)) return null
    const name = url.slice(prefix.length)
    return IMAGE_NAME_RE.test(name) ? `${kind}/${ownerId}/${name}` : null
  }

  /** Queues objects for deletion `delayMs` from now (an existing entry is rescheduled). */
  async queueDelete(db: Db | Tx, keys: string[], delayMs = 0): Promise<void> {
    if (!keys.length) return
    const notBefore = new Date(Date.now() + delayMs)
    await db.insert(storageDeletions).values(keys.map((key) => ({ key, notBefore })))
      .onConflictDoUpdate({ target: storageDeletions.key, set: { notBefore } })
  }

  /** Keys now referenced by a committed row: drop their pending deletion (same transaction as the reference). */
  async keep(tx: Db | Tx, keys: string[]): Promise<void> {
    if (keys.length) await tx.delete(storageDeletions).where(inArray(storageDeletions.key, keys))
  }

  /**
   * Stores files after queueing them for deletion in an hour; the caller must `keep()` them in the transaction that
   * references them. On failure every key is rescheduled for immediate deletion.
   */
  async store(items: { key: string; path: string; size: number; sha256: string; contentType: string }[]): Promise<void> {
    const keys = items.map((i) => i.key)
    await this.queueDelete(this.db, keys, PENDING_MS)
    try {
      for (const i of items) await this.storage.put(i.key, i.path, i)
    } catch (err) {
      await this.abandon(keys)
      throw err
    }
  }

  /** Stored objects that will never be referenced (the request failed after storing). */
  async abandon(keys: string[]): Promise<void> {
    await this.queueDelete(this.db, keys).catch((err: unknown) => this.log.error({ err: safeErr(err), keys }, 'could not queue abandoned uploads; they expire from the queue in 1 h'))
    this.kick()
  }

  /** Runs a sweep in the background (errors are logged). */
  kick(): void {
    void this.sweep().catch((err: unknown) => this.log.error({ err: safeErr(err) }, 'storage sweep failed'))
  }

  /** Deletes due objects; failures stay queued with exponential backoff (1 min … 1 day) and are logged. */
  sweep(): Promise<number> {
    this.sweeping ??= this.runSweep().finally(() => { this.sweeping = undefined })
    return this.sweeping
  }

  private async runSweep(): Promise<number> {
    let deleted = 0
    for (;;) {
      const due = await this.db.select().from(storageDeletions).where(lte(storageDeletions.notBefore, new Date())).limit(100)
      if (!due.length) return deleted
      let failed = 0
      for (const row of due) {
        try {
          await this.storage.delete(row.key)
          await this.db.delete(storageDeletions).where(eq(storageDeletions.key, row.key))
          deleted++
        } catch (err) {
          failed++
          const attempts = row.attempts + 1
          const level = attempts >= 10 ? 'error' : 'warn'
          this.log[level]({ err: safeErr(err), key: row.key, attempts }, 'storage delete failed; will retry')
          await this.db.update(storageDeletions).set({
            attempts: sql`${storageDeletions.attempts} + 1`,
            notBefore: new Date(Date.now() + Math.min(60_000 * 2 ** row.attempts, 86_400_000)),
            lastError: String((err as Error)?.message ?? err).slice(0, 500),
          }).where(eq(storageDeletions.key, row.key))
        }
      }
      if (failed === due.length) return deleted // storage is down: wait for the next tick
    }
  }

  start(intervalMs = 60_000): void {
    this.timer = setInterval(() => this.kick(), intervalMs)
    this.timer.unref()
  }

  async stop(): Promise<void> {
    clearInterval(this.timer)
    await this.sweeping?.catch(() => {})
  }
}
