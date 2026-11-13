/** Alga Worlds over REST: the personal room, the 3D figure and the asset pack (realtime: src/worlds.ts). */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import {
  PutWorldAvatarBody, PutWorldRoomBody, STARTER_ROOM, WORLD_ROOM_MAX_ITEMS, roomProblem, worldItem,
  type Me, type RoomProblem, type WorldPlacedItem, type WorldRoom, type WorldRoomLayout,
} from '@alga/shared'
import { eq } from 'drizzle-orm'
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import type { Ctx } from '../app.js'
import { worldRooms, type WorldRoomRow } from '../db/schema.js'
import { HttpError, invalid, notFound, parse, safeErr } from '../errors.js'
import { meView } from '../views.js'
import { afterMeUpdate, perMinute } from './users.js'

const CONTROL_CHARS = /[\p{Cc}\u2028\u2029]/gu
/** Millimetres are plenty for furniture: keeps what clients send (floats of any length) short in the database. */
const mm = (v: number) => Math.round(v * 1000) / 1000

const roomView = (r: WorldRoomRow): WorldRoom =>
  ({ ownerId: r.ownerId, name: r.name, access: r.access, updatedAt: r.updatedAt.toISOString(), shell: r.shell, finish: r.finish, items: r.items })

/** ApiError.fields key of a RoomProblem: `finish.<field>`, `items.<id>` or `items`. */
function problemField(layout: WorldRoomLayout, held: ReadonlySet<string>, p: RoomProblem): string {
  if ('id' in p) return `items.${p.id}`
  if (p.reason === 'too_many' || p.reason === 'too_many_copies') return 'items'
  // A SKU: of a finish (roomProblem checks those first, in this order), else of the first placed item it applies to.
  for (const field of ['floor', 'wall', 'mood', 'accentWall'] as const) {
    if (layout.finish[field] === p.sku && roomProblem({ shell: layout.shell, items: [], finish: { ...STARTER_ROOM.finish, [field]: p.sku } }, held)) return `finish.${field}`
  }
  const badVariant = (it: WorldPlacedItem) => it.variant !== undefined && !worldItem(it.sku)?.variants?.some((v) => v.id === it.variant)
  const it = layout.items.find((i) => i.sku === p.sku && (p.reason !== 'unknown_variant' || badVariant(i)))
  return it ? `items.${it.id}` : 'items'
}

export function worldRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, worlds, config } = ctx
  const on = () => { if (!config.worlds.enabled) throw notFound() }

  app.get('/worlds/rooms/@me', async (req): Promise<WorldRoom> => {
    on()
    // As stored, pieces no longer held included: the editor says so itself from the entitlements it already has.
    return roomView(await worlds.roomOf(req.auth.user.id))
  })

  // The whole room every time. A call showing it gets WORLD_ROOM (Worlds.roomSaved).
  app.put('/worlds/rooms/@me', { config: perMinute(30) }, async (req): Promise<WorldRoom> => {
    on()
    // The body schema caps the list too; answered here so the client gets the same reason string as every other problem.
    const sent = (req.body as { items?: unknown } | null)?.items
    if (Array.isArray(sent) && sent.length > WORLD_ROOM_MAX_ITEMS) throw invalid({ items: 'too_many' })
    const body = parse(PutWorldRoomBody, req.body)
    const userId = req.auth.user.id
    // Shown to everyone in a call: plain text without control characters.
    const name = body.name.replace(CONTROL_CHARS, '').trim()
    if (!name) throw invalid({ name: 'Dê um nome à sala.' })
    const [stored, held] = await Promise.all([worlds.roomOf(userId), worlds.held(userId)])
    const layout: WorldRoomLayout = {
      shell: stored.shell,
      finish: body.finish,
      items: body.items.map(({ id, sku, x, y, z, rot, variant }) => ({ id, sku, x: mm(x), y: mm(y), z: mm(z), rot: mm(rot), ...(variant !== undefined ? { variant } : {}) })),
    }
    const problem = roomProblem(layout, held)
    if (problem) {
      const fields = { [problemField(layout, held, problem)]: problem.reason }
      throw problem.reason === 'not_owned' ? new HttpError('forbidden', 'Você não tem esta peça.', fields) : invalid(fields)
    }
    const [row] = await db.update(worldRooms).set({ name, access: body.access, finish: layout.finish, items: layout.items, updatedAt: new Date() })
      .where(eq(worldRooms.ownerId, userId)).returning()
    // The room is saved either way; a call that could not be told keeps the old layout until its next change.
    await worlds.roomSaved(userId).catch((err: unknown) => req.log.error({ err: safeErr(err) }, 'worlds: saved room not announced'))
    return roomView(row!)
  })

  // The figure, or null for the automatic one. Fans out like PATCH /users/@me (ME_UPDATE + USER_UPDATE with PublicUser.world).
  app.put('/worlds/avatar', { config: perMinute(20) }, async (req): Promise<Me> => {
    on()
    const { avatar } = parse(PutWorldAvatarBody, req.body)
    const { before, after } = await worlds.setAvatar(req.auth.user.id, avatar)
    await afterMeUpdate(ctx, before, after)
    return meView(after, config.files.maxAttachmentBytes)
  })
}

// ---- asset pack -----------------------------------------------------------------------------------------------------

const ASSET_TYPES: Record<string, string> = {
  '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.hdr': 'application/octet-stream', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8',
}
const MANIFEST = 'manifest.json'
/** Relative, forward slashes, no dot segments, nothing hidden: the only shape a manifest path may have. */
const ASSET_PATH = /^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/
const SHA256 = /^[0-9a-f]{64}$/i

interface AssetFile { abs: string; sha256: string; type: string }
interface Pack { mtimeMs: number; size: number; files: Map<string, AssetFile> | null }

/**
 * `files` of manifest.json: [{ path, sha256 }] or { "<path>": "<sha256>" | { sha256 } }. Entries that are not a plain
 * relative path with a SHA-256 are left out (and so never served).
 */
function manifestFiles(dir: string, json: unknown): Map<string, AssetFile> {
  const files = (json as { files?: unknown } | null)?.files
  const pairs: [unknown, unknown][] = Array.isArray(files)
    ? files.map((f: { path?: unknown; sha256?: unknown } | null) => [f?.path, f?.sha256])
    : Object.entries((files ?? {}) as Record<string, unknown>).map(([path, v]) => [path, typeof v === 'string' ? v : (v as { sha256?: unknown } | null)?.sha256])
  const out = new Map<string, AssetFile>()
  for (const [path, sha256] of pairs) {
    if (typeof path !== 'string' || typeof sha256 !== 'string' || !ASSET_PATH.test(path) || !SHA256.test(sha256) || path === MANIFEST) continue
    out.set(path, { abs: join(dir, ...path.split('/')), sha256: sha256.toLowerCase(), type: ASSET_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream' })
  }
  return out
}

/**
 * The pack in `dir`, read through its manifest: a request path is only ever looked up in the manifest's own list
 * (never joined to a directory), so nothing outside it can be named. The manifest is re-read when its mtime changes.
 */
class AssetPack {
  private pack: Pack | undefined
  private readonly manifestPath: string

  constructor(private readonly dir: string, private readonly log: FastifyBaseLogger) {
    this.manifestPath = join(dir, MANIFEST)
  }

  get present(): boolean {
    return existsSync(this.manifestPath)
  }

  async find(path: string): Promise<AssetFile | undefined> {
    let st
    try {
      st = await stat(this.manifestPath)
    } catch {
      return undefined
    }
    if (this.pack?.mtimeMs !== st.mtimeMs || this.pack.size !== st.size) {
      let files: Pack['files'] = null
      try {
        const raw = await readFile(this.manifestPath)
        files = manifestFiles(this.dir, JSON.parse(raw.toString('utf8')))
        files.set(MANIFEST, { abs: this.manifestPath, sha256: createHash('sha256').update(raw).digest('hex'), type: ASSET_TYPES['.json']! })
      } catch (err) {
        this.log.warn({ err: (err as Error).message }, 'worlds: manifest.json of the asset pack could not be read')
      }
      this.pack = { mtimeMs: st.mtimeMs, size: st.size, files }
    }
    return this.pack.files?.get(path)
  }
}

/** If-None-Match against a strong ETag (weak comparison, RFC 9110 §13.1.2). */
const matches = (header: string | undefined, etag: string) =>
  !!header && header.split(',').some((v) => { const t = v.trim(); return t === '*' || t.replace(/^W\//, '') === etag })

export function worldPublicRoutes(app: FastifyInstance, { config, log }: Ctx): void {
  const pack = new AssetPack(config.worlds.assetsDir, log)
  if (config.worlds.enabled && !pack.present) {
    log.warn({ dir: config.worlds.assetsDir }, 'worlds: asset pack not found (no manifest.json); GET /worlds/assets answers 404 until it is there')
  }

  // Public and immutable per pack version. A first load is a few hundred files, often from several people behind one
  // address (CGNAT): the global 200/min is too low.
  app.get<{ Params: { '*': string } }>('/worlds/assets/*', { config: perMinute(600) }, async (req, reply) => {
    if (!config.worlds.enabled) throw notFound()
    const file = await pack.find(req.params['*'])
    // Listed but not on disk = an incomplete pack. Checked before any header is set: a 404 must not carry the year of cache.
    const onDisk = file && await stat(file.abs).catch(() => undefined)
    if (!file || !onDisk?.isFile()) throw notFound()
    const etag = `"${file.sha256}"`
    reply.headers({
      etag,
      'cache-control': req.params['*'] === MANIFEST ? 'public, max-age=300' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      // Loaded by the desktop renderer, whose origin is not this API's.
      'cross-origin-resource-policy': 'cross-origin',
    })
    if (matches(req.headers['if-none-match'], etag)) return reply.code(304).send()
    // Streamed: a model is never held whole in memory.
    return reply.header('content-type', file.type).header('content-length', String(onDisk.size)).send(createReadStream(file.abs))
  })
}
