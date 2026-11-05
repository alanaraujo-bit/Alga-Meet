import { rm } from 'node:fs/promises'
import {
  AckBody, EditMessageBody, MAX_ATTACHMENTS, Permission, SendMessageBody, SendMessageWithAttachmentsBody, hasPermission, uuidv7,
  type Message, type ReadState,
} from '@alga/shared'
import { and, asc, countDistinct, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { assertDmNotBlocked, channelAudience, requireChannel, type ChannelAccess } from '../access.js'
import type { Ctx } from '../app.js'
import { isUniqueViolation, type Db } from '../db/index.js'
import { attachments, channels, messages, reactions, readStates, type MessageRow } from '../db/schema.js'
import { HttpError, badRequest, forbidden, idParam, invalid, notFound, parse } from '../errors.js'
import { planSummary } from '../billing/catalog.js'
import { MAX_ATTACHMENT_SIDE, canScrub, inspect, safeFilename, scrubImage, spool, tooLarge, type Spooled } from '../files.js'
import { messageFor, messageViews, type FileUrl } from '../views.js'

const HistoryQuery = z.object({
  before: z.uuid().optional(),
  after: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

const MENTION_RE = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi
export const mentionedIds = (content: string) => [...new Set([...content.matchAll(MENTION_RE)].map((m) => m[1]!.toLowerCase()))]

const TYPING_THROTTLE_MS = 5_000

function textOnly(access: ChannelAccess): void {
  if (access.channel.type === 'voice') throw badRequest('Canais de voz não têm mensagens.')
}

async function messageIn(db: Db, channelId: string, messageId: string): Promise<MessageRow> {
  const [m] = await db.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.channelId, channelId)))
  if (!m) throw notFound('Mensagem não encontrada.')
  return m
}

// One emoji: an RGI sequence (skin tones, ZWJ families, flags, keycaps) or a pictograph with optional VS16.
// Built with RegExp because the `v` flag is newer than the ES2023 compile target (Node 24 supports it).
const EMOJI_RE = new RegExp('^(?:\\p{RGI_Emoji}|\\p{Extended_Pictographic}\\uFE0F?)$', 'v')
const MAX_DISTINCT_REACTIONS = 20

/** `strict` for adding; removal only bounds the length, so reactions stored before validation can still go. */
function checkEmoji(emoji: string, strict = true): string {
  if (!emoji.trim() || emoji.length > 32 || (strict && !EMOJI_RE.test(emoji))) throw invalid({ emoji: 'Emoji inválido.' })
  return emoji
}

export function messageRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, hub, files } = ctx
  const fileUrl: FileUrl = (id, uid) => files.url(id, uid)
  // Every stored file counts, across messages and channels.
  const uploadLimit = app.createRateLimit({ max: 30, timeWindow: '10 minutes', keyGenerator: (req) => `upload:${req.auth.user.id}` })

  /** Multipart send: `payload_json` + up to MAX_ATTACHMENTS files spooled to temp files (removed by the caller). */
  async function readUpload(req: FastifyRequest): Promise<{ payload: unknown; spooled: Spooled[] }> {
    // Per-file cap of the sender's plan (Me.plan.maxAttachmentBytes).
    const maxBytes = planSummary(req.auth.user.plan, ctx.config.files.maxAttachmentBytes).maxAttachmentBytes
    if (Number(req.headers['content-length']) > MAX_ATTACHMENTS * maxBytes + 1024 * 1024) throw tooLarge(maxBytes)
    const spooled: Spooled[] = []
    let payload: unknown
    try {
      for await (const part of req.parts({ limits: { fileSize: maxBytes, files: MAX_ATTACHMENTS + 1, fields: 4, fieldSize: 64 * 1024 } })) {
        if (part.type === 'file') {
          if (spooled.length === MAX_ATTACHMENTS) {
            throw new HttpError('validation', `No máximo ${MAX_ATTACHMENTS} arquivos por mensagem.`, { files: 'Arquivos demais.' }, 413)
          }
          const limit = await uploadLimit(req)
          if (!limit.isAllowed && limit.isExceeded) throw new HttpError('rate_limited', 'Muitos envios de arquivo. Tente novamente em alguns minutos.')
          spooled.push(await spool(part.file, part.filename, maxBytes))
        } else if (part.fieldname === 'payload_json') {
          try {
            payload = typeof part.value === 'string' ? JSON.parse(part.value) : part.value
          } catch {
            throw invalid({ payload_json: 'JSON inválido.' })
          }
        }
      }
    } catch (err) {
      await Promise.all(spooled.map((f) => rm(f.path, { force: true })))
      throw err
    }
    return { payload, spooled }
  }

  // userId:channelId → last TYPING_START. Pruned every minute.
  const typing = new Map<string, number>()
  const prune = setInterval(() => {
    const cutoff = Date.now() - TYPING_THROTTLE_MS
    for (const [k, t] of typing) if (t < cutoff) typing.delete(k)
  }, 60_000)
  prune.unref()
  app.addHook('onClose', async () => clearInterval(prune))

  type P = { Params: { id: string } }
  type PM = { Params: { id: string; mid: string } }
  type PE = { Params: { id: string; mid: string; emoji: string } }

  app.get<P>('/channels/:id/messages', async (req): Promise<Message[]> => {
    const access = await requireChannel(db, idParam(req.params.id), req.auth.user.id, Permission.VIEW_CHANNELS)
    textOnly(access)
    const q = parse(HistoryQuery, req.query)
    const where = and(
      eq(messages.channelId, access.channel.id),
      q.before ? lt(messages.id, q.before) : undefined,
      q.after ? gt(messages.id, q.after) : undefined,
    )
    // `after` alone pages forward from a point: take the oldest N after it, then return them newest first.
    const forward = q.after !== undefined && q.before === undefined
    const rows = await db.select().from(messages).where(where)
      .orderBy(forward ? asc(messages.id) : desc(messages.id)).limit(q.limit)
    if (forward) rows.reverse()
    return (await messageViews(db, rows)).map((v) => messageFor(v, req.auth.user.id, fileUrl))
  })

  app.post<P>('/channels/:id/messages', {
    config: { rateLimit: { max: 10, timeWindow: '10 seconds' } },
  }, async (req): Promise<Message> => {
    const me = req.auth.user.id
    const multipart = req.isMultipart()
    // Checked before reading any upload byte.
    const access = await requireChannel(db, idParam(req.params.id), me, Permission.SEND_MESSAGES | (multipart ? Permission.ATTACH_FILES : 0))
    textOnly(access)
    await assertDmNotBlocked(db, access, me)
    if (!multipart) {
      const body = parse(SendMessageBody, req.body)
      return (await already(me, access.channel.id, body.nonce)) ?? send(me, access, body, [])
    }
    const { payload, spooled } = await readUpload(req)
    let stored: string[] = []
    try {
      const body = parse(SendMessageWithAttachmentsBody, payload)
      if (!body.content && !spooled.length) throw invalid({ content: 'Envie um texto ou ao menos um arquivo.' })
      // A retry of a send that already went through: answer with it, store nothing.
      const dup = await already(me, access.channel.id, body.nonce)
      if (dup) return dup
      const now = Date.now()
      const prepared = await Promise.all(spooled.map(async (f, i) => {
        const info = await inspect(f.path)
        // Inline images are re-encoded in place: no EXIF/GPS reaches the other members.
        const file = canScrub(info.sniffed) ? await scrubImage(f, info.sniffed, MAX_ATTACHMENT_SIDE) : { ...f, ...info }
        const id = uuidv7(now + i) // + i ms: ids sort in upload order
        return { ...file, id, key: `attachments/${access.channel.id}/${id}`, filename: safeFilename(f.name, file) }
      }))
      await files.store(prepared)
      stored = prepared.map((f) => f.key)
      return await send(me, access, body, prepared)
    } catch (err) {
      if (stored.length) await files.abandon(stored)
      throw err
    } finally {
      await Promise.all(spooled.map((f) => rm(f.path, { force: true })))
    }
  })

  interface Prepared { id: string; key: string; filename: string; contentType: string; size: number; width?: number; height?: number }

  /**
   * Sends are idempotent per (channel, author, nonce): when the response is lost (connection drop) and the client
   * retries, it gets the message already saved instead of posting a copy. The client generates a fresh nonce per send.
   */
  async function already(me: string, channelId: string, nonce: string | undefined): Promise<Message | null> {
    if (!nonce) return null
    const [row] = await db.select().from(messages)
      .where(and(eq(messages.channelId, channelId), eq(messages.authorId, me), eq(messages.nonce, nonce)))
    if (!row) return null
    const [view] = await messageViews(db, [row])
    return messageFor({ ...view!, nonce }, me, fileUrl)
  }

  async function send(me: string, access: ChannelAccess, body: SendMessageBody, prepared: Prepared[]): Promise<Message> {
    const channelId = access.channel.id
    if (body.replyToId) {
      const [parent] = await db.select({ id: messages.id }).from(messages)
        .where(and(eq(messages.id, body.replyToId), eq(messages.channelId, channelId)))
      if (!parent) throw invalid({ replyToId: 'Mensagem respondida não encontrada neste canal.' })
    }
    const audience = await channelAudience(db, access.channel, access.recipientIds)
    const mentioned = mentionedIds(body.content).filter((id) => id !== me && audience.includes(id))
    const id = uuidv7()
    const insert = () => db.transaction(async (tx) => {
      const inserted = await tx.insert(messages).values({
        id, channelId, authorId: me, content: body.content, replyToId: body.replyToId ?? null, nonce: body.nonce ?? null,
      }).returning()
      if (prepared.length) {
        await tx.insert(attachments).values(prepared.map((f) => ({
          id: f.id, messageId: id, storageKey: f.key, filename: f.filename, contentType: f.contentType, size: f.size,
          width: f.width ?? null, height: f.height ?? null,
        })))
        await files.keep(tx, prepared.map((f) => f.key))
      }
      await tx.update(channels).set({ lastMessageId: id }).where(eq(channels.id, channelId))
      // The author has obviously read their own message.
      await tx.insert(readStates).values({ userId: me, channelId, lastReadMessageId: id, mentionCount: 0 })
        .onConflictDoUpdate({ target: [readStates.userId, readStates.channelId], set: { lastReadMessageId: id, mentionCount: 0 } })
      if (mentioned.length) {
        await tx.insert(readStates).values(mentioned.map((userId) => ({ userId, channelId, mentionCount: 1 })))
          .onConflictDoUpdate({
            target: [readStates.userId, readStates.channelId],
            set: { mentionCount: sql`${readStates.mentionCount} + 1` },
          })
      }
      return inserted
    })
    let row: MessageRow | undefined
    try {
      ;[row] = await insert()
    } catch (err) {
      // Two copies of the same send raced past already(): the loser answers with the winner's message.
      const dup = body.nonce && isUniqueViolation(err) ? await already(me, channelId, body.nonce) : null
      if (!dup) throw err
      if (prepared.length) await files.abandon(prepared.map((f) => f.key))
      return dup
    }
    const [view] = await messageViews(db, [row!])
    const withNonce = { ...view!, ...(body.nonce !== undefined ? { nonce: body.nonce } : {}) }
    hub.dispatch(audience, 'MESSAGE_CREATE', (uid) => messageFor(withNonce, uid, fileUrl))
    if (mentioned.length) {
      const states = await db.select().from(readStates)
        .where(and(eq(readStates.channelId, channelId), inArray(readStates.userId, mentioned)))
      for (const s of states) hub.dispatch([s.userId], 'READ_STATE_UPDATE', readStateView(s))
    }
    return messageFor(withNonce, me, fileUrl)
  }

  app.patch<PM>('/channels/:id/messages/:mid', async (req): Promise<Message> => {
    const me = req.auth.user.id
    // Same gate as sending: an edit is pushed live to the channel, so a block or a lost SEND_MESSAGES must stop it.
    const access = await requireChannel(db, idParam(req.params.id), me, Permission.SEND_MESSAGES)
    await assertDmNotBlocked(db, access, me)
    const msg = await messageIn(db, access.channel.id, idParam(req.params.mid))
    if (msg.authorId !== me) throw forbidden('Você só pode editar suas próprias mensagens.')
    const { content } = parse(EditMessageBody, req.body)
    const [row] = await db.update(messages).set({ content, editedAt: new Date() }).where(eq(messages.id, msg.id)).returning()
    const [view] = await messageViews(db, [row!])
    hub.dispatch(await channelAudience(db, access.channel, access.recipientIds), 'MESSAGE_UPDATE', (uid) => messageFor(view!, uid, fileUrl))
    return messageFor(view!, me, fileUrl)
  })

  app.delete<PM>('/channels/:id/messages/:mid', async (req, reply) => {
    const me = req.auth.user.id
    const access = await requireChannel(db, idParam(req.params.id), me, Permission.VIEW_CHANNELS)
    const msg = await messageIn(db, access.channel.id, idParam(req.params.mid))
    if (msg.authorId !== me && !hasPermission(access.permissions, Permission.MANAGE_MESSAGES)) {
      throw forbidden('Você não pode apagar esta mensagem.')
    }
    await db.delete(messages).where(eq(messages.id, msg.id))
    files.kick() // the delete trigger queued its attachments
    hub.dispatch(await channelAudience(db, access.channel, access.recipientIds), 'MESSAGE_DELETE', { id: msg.id, channelId: msg.channelId })
    return reply.code(204).send()
  })

  app.put<PE>('/channels/:id/messages/:mid/reactions/:emoji', { config: { rateLimit: { max: 10, timeWindow: '5 seconds' } } }, async (req, reply) => {
    const me = req.auth.user.id
    const access = await requireChannel(db, idParam(req.params.id), me, Permission.ADD_REACTIONS)
    await assertDmNotBlocked(db, access, me)
    const msg = await messageIn(db, access.channel.id, idParam(req.params.mid))
    const emoji = checkEmoji(req.params.emoji)
    const [known] = await db.select({ e: reactions.emoji }).from(reactions)
      .where(and(eq(reactions.messageId, msg.id), eq(reactions.emoji, emoji))).limit(1)
    if (!known) {
      // shortcut: check-then-insert, concurrent requests may overshoot by a few; make it conditional SQL if that matters.
      const [c] = await db.select({ n: countDistinct(reactions.emoji) }).from(reactions).where(eq(reactions.messageId, msg.id))
      if ((c?.n ?? 0) >= MAX_DISTINCT_REACTIONS) throw invalid({ emoji: `Limite de ${MAX_DISTINCT_REACTIONS} reações diferentes por mensagem.` })
    }
    const added = await db.insert(reactions).values({ messageId: msg.id, userId: me, emoji }).onConflictDoNothing().returning()
    if (added.length) {
      hub.dispatch(await channelAudience(db, access.channel, access.recipientIds), 'REACTION_ADD',
        { messageId: msg.id, channelId: msg.channelId, userId: me, emoji })
    }
    return reply.code(204).send()
  })

  app.delete<PE>('/channels/:id/messages/:mid/reactions/:emoji', async (req, reply) => {
    const me = req.auth.user.id
    const access = await requireChannel(db, idParam(req.params.id), me, Permission.VIEW_CHANNELS)
    const msg = await messageIn(db, access.channel.id, idParam(req.params.mid))
    const emoji = checkEmoji(req.params.emoji, false)
    const removed = await db.delete(reactions)
      .where(and(eq(reactions.messageId, msg.id), eq(reactions.userId, me), eq(reactions.emoji, emoji))).returning()
    if (removed.length) {
      hub.dispatch(await channelAudience(db, access.channel, access.recipientIds), 'REACTION_REMOVE',
        { messageId: msg.id, channelId: msg.channelId, userId: me, emoji })
    }
    return reply.code(204).send()
  })

  app.post<P>('/channels/:id/typing', async (req, reply) => {
    const me = req.auth.user.id
    const access = await requireChannel(db, idParam(req.params.id), me, Permission.SEND_MESSAGES)
    textOnly(access)
    await assertDmNotBlocked(db, access, me)
    const key = `${me}:${access.channel.id}`
    const now = Date.now()
    if (now - (typing.get(key) ?? 0) >= TYPING_THROTTLE_MS) {
      typing.set(key, now)
      const audience = (await channelAudience(db, access.channel, access.recipientIds)).filter((id) => id !== me)
      hub.dispatch(audience, 'TYPING_START', { channelId: access.channel.id, userId: me, at: new Date(now).toISOString() })
    }
    return reply.code(204).send()
  })

  app.post<P>('/channels/:id/ack', async (req, reply) => {
    const me = req.auth.user.id
    const access = await requireChannel(db, idParam(req.params.id), me, Permission.VIEW_CHANNELS)
    const { messageId } = parse(AckBody, req.body)
    await messageIn(db, access.channel.id, messageId)
    const [state] = await db.insert(readStates)
      .values({ userId: me, channelId: access.channel.id, lastReadMessageId: messageId, mentionCount: 0 })
      .onConflictDoUpdate({ target: [readStates.userId, readStates.channelId], set: { lastReadMessageId: messageId, mentionCount: 0 } })
      .returning()
    hub.dispatch([me], 'READ_STATE_UPDATE', readStateView(state!))
    return reply.code(204).send()
  })
}

export const readStateView = (s: typeof readStates.$inferSelect): ReadState => ({
  channelId: s.channelId,
  lastReadMessageId: s.lastReadMessageId,
  mentionCount: s.mentionCount,
})
