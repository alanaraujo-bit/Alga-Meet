/** File downloads (signed), public avatars/icons, and avatar/icon uploads. Attachments are sent in messages.ts. */
import { randomBytes } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { MAX_AVATAR_BYTES, MAX_AVATAR_SIDE, Permission, type Me, type Space } from '@alga/shared'
import { eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requireChannel, requireSpace, spaceMemberIds } from '../access.js'
import type { Ctx } from '../app.js'
import type { Tx } from '../db/index.js'
import { attachments, messages, spaces, users } from '../db/schema.js'
import { HttpError, badRequest, forbidden, idParam, invalid, notFound, parse } from '../errors.js'
import {
  FILE_HEADERS, IMAGE_EXT, IMAGE_NAME_RE, IMAGE_TYPE_BY_EXT, contentDisposition, inspect, isInlineType, spool, type Spooled,
} from '../files.js'
import type { ByteRange } from '../storage.js'
import { meView, spaceView } from '../views.js'
import { afterMeUpdate, perMinute } from './users.js'

const FileQuery = z.object({
  uid: z.uuid(),
  exp: z.coerce.number().int().positive(),
  sig: z.string().min(1).max(128),
})

// A chat page or a member list loads many files at once from one IP (CGNAT included); the global 200/min is too low.
const manyReads = { config: { rateLimit: { max: 1200, timeWindow: '1 minute' } } }

/** Single `bytes=a-b` / `a-` / `-n` range; undefined = whole file, null = unsatisfiable. */
export function parseRange(header: string | undefined, size: number): ByteRange | undefined | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null
  if (!m || (!m[1] && !m[2])) return undefined // absent or unsupported (multi-range): send everything
  const range = m[1]
    ? { start: Number(m[1]), end: m[2] ? Math.min(Number(m[2]), size - 1) : size - 1 }
    : { start: Math.max(0, size - Number(m[2])), end: size - 1 }
  return range.start <= range.end && range.start < size ? range : null
}

export function filePublicRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, files, log } = ctx

  // No auth header (works in <img>/<video>): the signature binds file, viewer and expiry, and the viewer must still
  // be able to see the channel.
  app.get<{ Params: { id: string } }>('/files/:id', manyReads, async (req, reply) => {
    const id = idParam(req.params.id)
    const q = parse(FileQuery, req.query)
    if (!files.verify(id, q.uid, q.exp, q.sig)) throw forbidden('Link expirado ou inválido.')
    const [row] = await db.select({ a: attachments, channelId: messages.channelId }).from(attachments)
      .innerJoin(messages, eq(messages.id, attachments.messageId)).where(eq(attachments.id, id))
    if (!row) throw notFound('Arquivo não encontrado.')
    try {
      await requireChannel(db, row.channelId, q.uid, Permission.VIEW_CHANNELS)
    } catch (err) {
      if (err instanceof HttpError) throw notFound('Arquivo não encontrado.')
      throw err
    }
    const { a } = row
    const range = parseRange(req.headers.range, a.size)
    if (range === null) return reply.code(416).header('content-range', `bytes */${a.size}`).send()
    const body = await files.storage.get(a.storageKey, range)
    if (!body) {
      log.error({ key: a.storageKey }, 'attachment row without a stored object')
      throw notFound('Arquivo não encontrado.')
    }
    reply.headers({
      ...FILE_HEADERS,
      // Stored types are either inline-safe media or application/octet-stream (files.ts inspect).
      'content-type': a.contentType,
      'content-disposition': contentDisposition(isInlineType(a.contentType) ? 'inline' : 'attachment', a.filename),
      'cache-control': `private, max-age=${Math.max(0, q.exp - Math.floor(Date.now() / 1000))}`,
      'accept-ranges': 'bytes',
      'content-length': String(range ? range.end - range.start + 1 : a.size),
    })
    if (range) reply.code(206).header('content-range', `bytes ${range.start}-${range.end}/${a.size}`)
    return reply.send(body)
  })

  // Avatars and space icons are public (invite previews show icons without auth); names are 128 random bits.
  for (const kind of ['avatars', 'icons'] as const) {
    app.get<{ Params: { owner: string; name: string } }>(`/${kind}/:owner/:name`, manyReads, async (req, reply) => {
      const owner = idParam(req.params.owner)
      const m = IMAGE_NAME_RE.exec(req.params.name)
      if (!m) throw notFound()
      const body = await files.storage.get(`${kind}/${owner}/${req.params.name}`)
      if (!body) throw notFound()
      return reply.headers({
        ...FILE_HEADERS,
        'content-type': IMAGE_TYPE_BY_EXT[m[1]!]!,
        'cache-control': 'public, max-age=31536000, immutable',
      }).send(body)
    })
  }
}

interface Image extends Spooled {
  ext: string
  contentType: string
}

export function fileRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, hub, files } = ctx

  /** One `file` part: png/jpeg/webp/gif by its bytes, ≤ MAX_AVATAR_BYTES, ≤ MAX_AVATAR_SIDE per side. */
  async function readImage(req: FastifyRequest): Promise<Image> {
    if (!req.isMultipart()) throw badRequest('Envie a imagem como multipart/form-data (campo "file").')
    const part = await req.file({ limits: { fileSize: MAX_AVATAR_BYTES, files: 1 } })
    if (!part) throw invalid({ file: 'Envie uma imagem.' })
    const spooled = await spool(part.file, part.filename, MAX_AVATAR_BYTES)
    try {
      const info = await inspect(spooled.path)
      const ext = info.sniffed ? IMAGE_EXT[info.sniffed] : undefined
      if (!ext || info.contentType !== info.sniffed) throw invalid({ file: 'Use uma imagem PNG, JPEG, WebP ou GIF.' })
      if (!info.width || !info.height || Math.max(info.width, info.height) > MAX_AVATAR_SIDE) {
        throw invalid({ file: `A imagem deve ter até ${MAX_AVATAR_SIDE}×${MAX_AVATAR_SIDE} px.` })
      }
      return { ...spooled, ext, contentType: info.sniffed! }
    } catch (err) {
      await rm(spooled.path, { force: true })
      throw err
    }
  }

  /**
   * Stores `img` under a fresh random name and runs `swap` (which sets the new URL and returns the previous one) in a
   * transaction that also keeps the new object and queues the previous one for deletion.
   */
  async function replaceImage<T>(kind: 'avatars' | 'icons', ownerId: string, img: Image,
    swap: (tx: Tx, url: string) => Promise<{ result: T; previous: string | null }>): Promise<T> {
    const name = `${randomBytes(16).toString('hex')}.${img.ext}`
    const key = `${kind}/${ownerId}/${name}`
    try {
      await files.store([{ ...img, key }])
    } finally {
      await rm(img.path, { force: true })
    }
    try {
      const result = await db.transaction(async (tx) => {
        const { result, previous } = await swap(tx, files.imageUrl(kind, ownerId, name))
        await files.keep(tx, [key])
        const old = files.imageKey(kind, ownerId, previous)
        if (old && old !== key) await files.queueDelete(tx, [old])
        return result
      })
      files.kick()
      return result
    } catch (err) {
      await files.abandon([key])
      throw err
    }
  }

  app.put('/users/@me/avatar', { config: perMinute(5) }, async (req): Promise<Me> => {
    const me = req.auth.user.id
    const img = await readImage(req)
    const after = await replaceImage('avatars', me, img, async (tx, url) => {
      // Row lock: concurrent uploads each see (and queue) the one they replace.
      const [cur] = await tx.select({ url: users.avatarUrl }).from(users).where(eq(users.id, me)).for('update')
      const [row] = await tx.update(users).set({ avatarUrl: url }).where(eq(users.id, me)).returning()
      return { result: row!, previous: cur?.url ?? null }
    })
    await afterMeUpdate(ctx, req.auth.user, after)
    return meView(after)
  })

  app.put<{ Params: { id: string } }>('/spaces/:id/icon', { config: perMinute(5) }, async (req): Promise<Space> => {
    const { space } = await requireSpace(db, idParam(req.params.id), req.auth.user.id, Permission.MANAGE_SPACE)
    const img = await readImage(req)
    const row = await replaceImage('icons', space.id, img, async (tx, url) => {
      const [cur] = await tx.select({ url: spaces.iconUrl }).from(spaces).where(eq(spaces.id, space.id)).for('update')
      const [updated] = await tx.update(spaces).set({ iconUrl: url }).where(eq(spaces.id, space.id)).returning()
      return { result: updated!, previous: cur?.url ?? null }
    })
    const view = spaceView(row)
    hub.dispatch(await spaceMemberIds(db, space.id), 'SPACE_UPDATE', view)
    return view
  })
}
