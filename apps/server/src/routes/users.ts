import {
  FriendRequestBody, OpenDmBody, PatchMeBody, PutRelationshipBody, uuidv7,
  type Channel, type Me, type PublicUser, type Relationship,
} from '@alga/shared'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { isBlockedBetween, isFriend, profileAudience, requireChannel, sharesSpace } from '../access.js'
import type { Ctx } from '../app.js'
import { isUniqueViolation, type Db, type Tx } from '../db/index.js'
import { channelRecipients, channels, relationships, users, type UserRow } from '../db/schema.js'
import { badRequest, conflict, forbidden, idParam, invalid, notFound, parse } from '../errors.js'
import { broadcastPresence, exchangePresence } from '../gateway/hub.js'
import { channelView, meView, publicUser, recipientsOf, relationshipsOf } from '../views.js'

type RelType = 'friend' | 'incoming' | 'outgoing' | 'blocked'

/** Route rate limit (keyed per user by the global keyGenerator in app.ts). */
export const perMinute = (max: number) => ({ rateLimit: { max, timeWindow: '1 minute' } })

/** Fan-out after the current user's row changed (PATCH /users/@me or gateway `presence`). */
export async function afterMeUpdate(ctx: Ctx, before: UserRow, after: UserRow): Promise<void> {
  const { db, hub } = ctx
  hub.dispatch([after.id], 'ME_UPDATE', meView(after))
  const pub = publicUser(after)
  if (JSON.stringify(pub) !== JSON.stringify(publicUser(before))) {
    hub.dispatch(await profileAudience(db, after.id), 'USER_UPDATE', pub)
  }
  if (before.statusPreference !== after.statusPreference && hub.isOnline(after.id)) {
    await broadcastPresence(db, hub, after.id)
  }
}

/**
 * After PATCHing avatarUrl/iconUrl away from one of our objects: queue it for deletion, and un-queue the new one.
 * shortcut: `previous` comes from before the UPDATE, so a racing upload can leave one object unqueued (a storage leak,
 * never a broken image); lock the row like PUT /users/@me/avatar does if that ever matters.
 */
export async function swapImageKeys(ctx: Ctx, kind: 'avatars' | 'icons', ownerId: string, previous: string | null, next: string | null): Promise<void> {
  const [old, kept] = [ctx.files.imageKey(kind, ownerId, previous), ctx.files.imageKey(kind, ownerId, next)]
  if (kept) await ctx.files.keep(ctx.db, [kept])
  if (old && old !== kept) {
    await ctx.files.queueDelete(ctx.db, [old])
    ctx.files.kick()
  }
}

async function relOf(db: Db | Tx, userId: string, targetId: string): Promise<RelType | undefined> {
  const [r] = await db.select({ type: relationships.type }).from(relationships)
    .where(and(eq(relationships.userId, userId), eq(relationships.targetId, targetId)))
  return r?.type
}

/**
 * Runs a relationship change between two users with both directions read inside one transaction holding a lock on
 * the pair, so concurrent requests/blocks/accepts are serialized (B2). Row locks cannot do this: the rows may not exist
 * yet, and two opposite requests would lock them in opposite order and deadlock.
 */
async function withPair<T>(db: Db, me: string, other: string, fn: (tx: Tx, mine: RelType | undefined, theirs: RelType | undefined) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${[me, other].sort().join(':')}, 0))`)
    return fn(tx, await relOf(tx, me, other), await relOf(tx, other, me))
  })
}

/** Upsert; only a block may replace a block (unblocking is a DELETE), so a racing request cannot undo one. */
export async function setRel(db: Db | Tx, userId: string, targetId: string, type: RelType): Promise<void> {
  await db.insert(relationships).values({ userId, targetId, type, since: new Date() }).onConflictDoUpdate({
    target: [relationships.userId, relationships.targetId],
    set: { type, since: new Date() },
    ...(type === 'blocked' ? {} : { setWhere: ne(relationships.type, 'blocked') }),
  })
}

async function delRel(db: Db | Tx, userId: string, targetId: string): Promise<void> {
  await db.delete(relationships).where(and(eq(relationships.userId, userId), eq(relationships.targetId, targetId)))
}

async function publishRel(ctx: Ctx, userId: string, targetId: string): Promise<Relationship> {
  const [rel] = await relationshipsOf(ctx.db, userId, targetId)
  ctx.hub.dispatch([userId], 'RELATIONSHIP_UPSERT', rel!)
  return rel!
}

async function userById(db: Db, id: string): Promise<UserRow> {
  const [u] = await db.select().from(users).where(eq(users.id, id))
  if (!u) throw notFound('Usuário não encontrado.')
  return u
}

export function userRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, hub } = ctx

  app.get('/users/@me', async (req): Promise<Me> => meView(req.auth.user))

  // Each change fans out USER_UPDATE to everyone who knows this user.
  app.patch('/users/@me', { config: perMinute(10) }, async (req): Promise<Me> => {
    const body = parse(PatchMeBody, req.body)
    const before = req.auth.user
    if (!Object.keys(body).length) return meView(before)
    // M9: only our own uploads (no third-party URL that would log every viewer's IP), or null.
    if (body.avatarUrl && !ctx.files.imageKey('avatars', before.id, body.avatarUrl)) {
      throw invalid({ avatarUrl: 'Envie a imagem pelo upload de avatar.' })
    }
    if (body.username && body.username !== before.username) {
      const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.username, body.username))
      if (taken) throw conflict('Nome de usuário já em uso.', { username: 'Nome de usuário já em uso.' })
    }
    let after: UserRow | undefined
    try {
      ;[after] = await db.update(users).set(body).where(eq(users.id, before.id)).returning()
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Nome de usuário já em uso.', { username: 'Nome de usuário já em uso.' })
      throw err
    }
    if (after!.avatarUrl !== before.avatarUrl) await swapImageKeys(ctx, 'avatars', before.id, before.avatarUrl, after!.avatarUrl)
    await afterMeUpdate(ctx, before, after!)
    return meView(after!)
  })

  app.get<{ Params: { id: string } }>('/users/:id', async (req): Promise<PublicUser> =>
    publicUser(await userById(db, idParam(req.params.id))))

  // ---- relationships ----------------------------------------------------------------------------

  app.get('/relationships', async (req): Promise<Relationship[]> => relationshipsOf(db, req.auth.user.id))

  app.post('/relationships', { config: perMinute(10) }, async (req): Promise<Relationship> => {
    const { username } = parse(FriendRequestBody, req.body)
    const me = req.auth.user.id
    const [target] = await db.select().from(users).where(eq(users.username, username))
    if (!target) throw invalid({ username: 'Usuário não encontrado.' })
    if (target.id === me) throw invalid({ username: 'Você não pode adicionar a si mesmo.' })
    const outcome = await withPair(db, me, target.id, async (tx, mine, theirs) => {
      // Do not reveal that the target blocked us.
      if (theirs === 'blocked') throw forbidden('Não foi possível enviar o pedido de amizade.')
      if (mine === 'blocked') throw badRequest('Desbloqueie este usuário antes de enviar um pedido.')
      if (mine === 'friend') throw conflict('Vocês já são amigos.')
      if (mine === 'outgoing') return 'pending'
      // A request toward someone who already asked us is an accept.
      const accepting = mine === 'incoming'
      await setRel(tx, me, target.id, accepting ? 'friend' : 'outgoing')
      await setRel(tx, target.id, me, accepting ? 'friend' : 'incoming')
      return accepting ? 'accepted' : 'requested'
    })
    if (outcome === 'pending') return (await relationshipsOf(db, me, target.id))[0]!
    const accepting = outcome === 'accepted'
    await publishRel(ctx, target.id, me)
    if (accepting) await exchangePresence(db, hub, me, [target.id])
    return publishRel(ctx, me, target.id)
  })

  app.put<{ Params: { userId: string } }>('/relationships/:userId', async (req): Promise<Relationship> => {
    const { type } = parse(PutRelationshipBody, req.body)
    const me = req.auth.user.id
    const target = await userById(db, idParam(req.params.userId))
    if (target.id === me) throw badRequest('Operação inválida com você mesmo.')

    if (type === 'friend') {
      const changed = await withPair(db, me, target.id, async (tx, mine) => {
        if (mine === 'friend') return false
        if (mine !== 'incoming') throw badRequest('Não há pedido de amizade pendente deste usuário.')
        await setRel(tx, me, target.id, 'friend')
        await setRel(tx, target.id, me, 'friend')
        return true
      })
      if (!changed) return (await relationshipsOf(db, me, target.id))[0]!
      await publishRel(ctx, target.id, me)
      await exchangePresence(db, hub, me, [target.id])
      return publishRel(ctx, me, target.id)
    }

    // block: my row becomes 'blocked'; their friend/request row toward me disappears (their own block stays).
    const dropTheirs = await withPair(db, me, target.id, async (tx, _mine, theirs) => {
      await setRel(tx, me, target.id, 'blocked')
      const drop = theirs !== undefined && theirs !== 'blocked'
      if (drop) await delRel(tx, target.id, me)
      return drop
    })
    if (dropTheirs) hub.dispatch([target.id], 'RELATIONSHIP_REMOVE', { userId: me })
    return publishRel(ctx, me, target.id)
  })

  app.delete<{ Params: { userId: string } }>('/relationships/:userId', async (req, reply) => {
    const me = req.auth.user.id
    const targetId = idParam(req.params.userId)
    const dropTheirs = await withPair(db, me, targetId, async (tx, mine, theirs) => {
      if (!mine) throw notFound('Relacionamento não encontrado.')
      // remove friend / decline / cancel → both rows go; unblock → only mine (their block, if any, stays).
      const drop = theirs !== undefined && theirs !== 'blocked' && mine !== 'blocked'
      await delRel(tx, me, targetId)
      if (drop) await delRel(tx, targetId, me)
      return drop
    })
    hub.dispatch([me], 'RELATIONSHIP_REMOVE', { userId: targetId })
    if (dropTheirs) hub.dispatch([targetId], 'RELATIONSHIP_REMOVE', { userId: me })
    return reply.code(204).send()
  })

  // ---- private channels -------------------------------------------------------------------------

  app.post('/users/@me/channels', { config: perMinute(10) }, async (req, reply): Promise<Channel> => {
    const me = req.auth.user.id
    const ids = [...new Set(parse(OpenDmBody, req.body).recipientIds)].filter((id) => id !== me)
    if (!ids.length) throw invalid({ recipientIds: 'Informe ao menos um destinatário além de você.' })
    const found = await db.select({ id: users.id }).from(users).where(inArray(users.id, ids))
    if (found.length !== ids.length) throw notFound('Usuário não encontrado.')
    for (const id of ids) {
      if (await isBlockedBetween(db, me, id)) throw forbidden('Você não pode iniciar uma conversa com este usuário.')
    }

    const dmKey = ids.length === 1 ? [me, ids[0]!].sort().join(':') : null
    const existing = async () => {
      const [row] = await db.select().from(channels).where(eq(channels.dmKey, dmKey!))
      return row && channelView(row, (await recipientsOf(db, [row.id])).get(row.id))
    }
    if (dmKey) {
      const dm = await existing()
      if (dm) return dm
    }
    // New conversations need consent: friends, or (1:1 only) a shared space.
    for (const id of ids) {
      if (await isFriend(db, me, id)) continue
      if (ids.length > 1) throw forbidden('Só é possível adicionar amigos a um grupo.')
      if (!(await sharesSpace(db, me, id))) throw forbidden('Você só pode iniciar conversa com amigos ou membros de um espaço em comum.')
    }
    const id = uuidv7()
    const members = [me, ...ids]
    try {
      await db.transaction(async (tx) => {
        await tx.insert(channels).values({ id, type: dmKey ? 'dm' : 'group_dm', dmKey })
        await tx.insert(channelRecipients).values(members.map((userId) => ({ channelId: id, userId })))
      })
    } catch (err) {
      // Lost a race against a concurrent open of the same DM: return the winner.
      if (dmKey && isUniqueViolation(err)) {
        const dm = await existing()
        if (dm) return dm
      }
      throw err
    }
    const [row] = await db.select().from(channels).where(eq(channels.id, id))
    const channel = channelView(row!, members)
    hub.dispatch(members, 'CHANNEL_CREATE', channel)
    reply.code(201)
    return channel
  })

  app.delete<{ Params: { id: string } }>('/channels/:id/recipients/@me', async (req, reply) => {
    const me = req.auth.user.id
    const { channel, recipientIds } = await requireChannel(db, idParam(req.params.id), me)
    if (channel.type !== 'group_dm') throw badRequest('Só é possível sair de grupos.')
    await ctx.voice.disconnect(me, [channel.id])
    await db.delete(channelRecipients).where(and(eq(channelRecipients.channelId, channel.id), eq(channelRecipients.userId, me)))
    const rest = recipientIds.filter((id) => id !== me)
    hub.dispatch([me], 'CHANNEL_DELETE', { id: channel.id, spaceId: null })
    if (rest.length) hub.dispatch(rest, 'CHANNEL_UPDATE', channelView(channel, rest))
    else await db.delete(channels).where(eq(channels.id, channel.id))
    return reply.code(204).send()
  })
}
