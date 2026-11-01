import {
  AckBody, EditMessageBody, Permission, SendMessageBody, hasPermission, uuidv7,
  type Message, type ReadState,
} from '@alga/shared'
import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { assertDmNotBlocked, channelAudience, requireChannel, type ChannelAccess } from '../access.js'
import type { Ctx } from '../app.js'
import type { Db } from '../db/index.js'
import { channels, messages, reactions, readStates, type MessageRow } from '../db/schema.js'
import { badRequest, forbidden, idParam, invalid, notFound, parse } from '../errors.js'
import { messageFor, messageViews } from '../views.js'

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

function checkEmoji(emoji: string): string {
  if (!emoji.trim() || emoji.length > 32) throw invalid({ emoji: 'Emoji inválido (máx. 32 caracteres).' })
  return emoji
}

export function messageRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, hub } = ctx

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
    return (await messageViews(db, rows)).map((v) => messageFor(v, req.auth.user.id))
  })

  app.post<P>('/channels/:id/messages', {
    config: { rateLimit: { max: 10, timeWindow: '10 seconds', keyGenerator: (req) => `msg:${req.auth.user.id}` } },
  }, async (req): Promise<Message> => {
    const me = req.auth.user.id
    const access = await requireChannel(db, idParam(req.params.id), me, Permission.SEND_MESSAGES)
    textOnly(access)
    await assertDmNotBlocked(db, access, me)
    const body = parse(SendMessageBody, req.body)
    const channelId = access.channel.id
    if (body.replyToId) {
      const [parent] = await db.select({ id: messages.id }).from(messages)
        .where(and(eq(messages.id, body.replyToId), eq(messages.channelId, channelId)))
      if (!parent) throw invalid({ replyToId: 'Mensagem respondida não encontrada neste canal.' })
    }
    const audience = await channelAudience(db, access.channel, access.recipientIds)
    const mentioned = mentionedIds(body.content).filter((id) => id !== me && audience.includes(id))
    const id = uuidv7()
    const [row] = await db.transaction(async (tx) => {
      const inserted = await tx.insert(messages).values({
        id, channelId, authorId: me, content: body.content, replyToId: body.replyToId ?? null,
      }).returning()
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
    const [view] = await messageViews(db, [row!])
    const withNonce = { ...view!, ...(body.nonce !== undefined ? { nonce: body.nonce } : {}) }
    hub.dispatch(audience, 'MESSAGE_CREATE', (uid) => messageFor(withNonce, uid))
    if (mentioned.length) {
      const states = await db.select().from(readStates)
        .where(and(eq(readStates.channelId, channelId), inArray(readStates.userId, mentioned)))
      for (const s of states) hub.dispatch([s.userId], 'READ_STATE_UPDATE', readStateView(s))
    }
    return messageFor(withNonce, me)
  })

  app.patch<PM>('/channels/:id/messages/:mid', async (req): Promise<Message> => {
    const me = req.auth.user.id
    const access = await requireChannel(db, idParam(req.params.id), me, Permission.VIEW_CHANNELS)
    const msg = await messageIn(db, access.channel.id, idParam(req.params.mid))
    if (msg.authorId !== me) throw forbidden('Você só pode editar suas próprias mensagens.')
    const { content } = parse(EditMessageBody, req.body)
    const [row] = await db.update(messages).set({ content, editedAt: new Date() }).where(eq(messages.id, msg.id)).returning()
    const [view] = await messageViews(db, [row!])
    hub.dispatch(await channelAudience(db, access.channel, access.recipientIds), 'MESSAGE_UPDATE', (uid) => messageFor(view!, uid))
    return messageFor(view!, me)
  })

  app.delete<PM>('/channels/:id/messages/:mid', async (req, reply) => {
    const me = req.auth.user.id
    const access = await requireChannel(db, idParam(req.params.id), me, Permission.VIEW_CHANNELS)
    const msg = await messageIn(db, access.channel.id, idParam(req.params.mid))
    if (msg.authorId !== me && !hasPermission(access.permissions, Permission.MANAGE_MESSAGES)) {
      throw forbidden('Você não pode apagar esta mensagem.')
    }
    await db.delete(messages).where(eq(messages.id, msg.id))
    hub.dispatch(await channelAudience(db, access.channel, access.recipientIds), 'MESSAGE_DELETE', { id: msg.id, channelId: msg.channelId })
    return reply.code(204).send()
  })

  app.put<PE>('/channels/:id/messages/:mid/reactions/:emoji', async (req, reply) => {
    const me = req.auth.user.id
    const access = await requireChannel(db, idParam(req.params.id), me, Permission.ADD_REACTIONS)
    await assertDmNotBlocked(db, access, me)
    const msg = await messageIn(db, access.channel.id, idParam(req.params.mid))
    const emoji = checkEmoji(req.params.emoji)
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
    const emoji = checkEmoji(req.params.emoji)
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
