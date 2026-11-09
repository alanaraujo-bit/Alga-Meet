import { rm } from 'node:fs/promises'
import {
  FEEDBACK_PER_HOUR, FEEDBACK_SCREENSHOT_MAX_BYTES, FeedbackFields, UninstallFeedbackBody, kindTakesLog, uuidv7, type FeedbackItem,
} from '@alga/shared'
import { desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../app.js'
import { feedback, uninstallFeedback, type FeedbackRow } from '../db/schema.js'
import { algaClientHeader } from '../devices.js'
import { badRequest, invalid, parse } from '../errors.js'
import { inspect, scrubImage, spool, type Spooled } from '../files.js'

export function feedbackPublicRoutes(app: FastifyInstance, { db }: Ctx): void {
  // The uninstall window has no session: anonymous on purpose (nothing about the person or the request is stored).
  // The per-IP limit only keeps the table from being flooded.
  app.post('/feedback/uninstall', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const body = parse(UninstallFeedbackBody, req.body)
    await db.insert(uninstallFeedback).values({ id: uuidv7(), reason: body.reason, note: body.note || null, appVersion: body.version ?? null })
    return reply.code(204).send()
  })
}

/** A screenshot of the app window: the three formats a paste, a drop or the app's own capture produce. */
const SCREENSHOT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
/** Enough to read a 1440p window; larger captures (4K at 150 %) are scaled down. */
const SCREENSHOT_MAX_SIDE = 2560

const view = (r: FeedbackRow): FeedbackItem =>
  ({ id: r.id, kind: r.kind, text: r.text, createdAt: r.createdAt.toISOString(), hasScreenshot: r.storageKey !== null })

/**
 * App feedback ("Conta pro Eco", packages/shared/src/feedback.ts). People send and see only their own; there is no
 * route for the team yet (the admin panel will add it, and the screenshot download with it).
 */
export function feedbackRoutes(app: FastifyInstance, { db, files }: Ctx): void {
  // Multipart: the text fields `kind`, `text`, `context` (JSON), `log` (optional) and one optional `screenshot` file.
  // Keyed per person by the global rate-limit key, and checked before any upload byte is read (preHandler).
  app.post('/feedback', { config: { rateLimit: { max: FEEDBACK_PER_HOUR, timeWindow: '1 hour' } } }, async (req, reply): Promise<FeedbackItem> => {
    if (!req.isMultipart()) throw badRequest('Envie o feedback como multipart/form-data.')
    const me = req.auth.user.id
    const fields: Record<string, unknown> = {}
    let shot: Spooled | undefined
    let key: string | undefined
    try {
      for await (const part of req.parts({ limits: { fileSize: FEEDBACK_SCREENSHOT_MAX_BYTES, files: 1, fields: 4, fieldSize: 64 * 1024 } })) {
        // FormData encodes every line break of a text field as CRLF; store what the person (and the log) had.
        if (part.type !== 'file') fields[part.fieldname] = typeof part.value === 'string' ? part.value.replace(/\r\n/g, '\n') : part.value
        else if (part.fieldname !== 'screenshot' || shot) throw invalid({ screenshot: 'Envie um print só.' })
        else shot = await spool(part.file, part.filename, FEEDBACK_SCREENSHOT_MAX_BYTES)
      }
      let context: unknown
      try {
        context = JSON.parse(String(fields.context))
      } catch {
        throw invalid({ context: 'JSON inválido.' })
      }
      const body = parse(FeedbackFields, { ...fields, context })
      const id = uuidv7()
      if (shot) {
        const info = await inspect(shot.path)
        if (!info.sniffed || !SCREENSHOT_TYPES.has(info.sniffed) || info.contentType !== info.sniffed) {
          throw invalid({ screenshot: 'Use uma imagem PNG, JPEG ou WebP.' })
        }
        // Re-encoded: no metadata survives, and a file that only looks like an image fails here.
        const img = await scrubImage(shot, info.sniffed, SCREENSHOT_MAX_SIDE, 'webp')
        key = `feedback/${me}/${id}.webp`
        await files.store([{ ...img, key }])
      }
      const row = await db.transaction(async (tx) => {
        const [r] = await tx.insert(feedback).values({
          id, userId: me, kind: body.kind, text: body.text, context: body.context,
          client: algaClientHeader(req.headers['x-alga-client']),
          // The client only sends it for bug/crash; never trust that.
          log: kindTakesLog(body.kind) && body.log ? body.log : null,
          storageKey: key ?? null,
        }).returning()
        if (key) await files.keep(tx, [key])
        return r!
      })
      reply.code(201)
      return view(row)
    } catch (err) {
      if (key) await files.abandon([key])
      throw err
    } finally {
      if (shot) await rm(shot.path, { force: true })
    }
  })

  app.get('/feedback/@me', async (req): Promise<FeedbackItem[]> =>
    (await db.select().from(feedback).where(eq(feedback.userId, req.auth.user.id))
      .orderBy(desc(feedback.createdAt), desc(feedback.id)).limit(50)).map(view))
}
