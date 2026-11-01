import {
  FriendRequestBody, OpenDmBody, PatchMeBody, PutRelationshipBody, uuidv7,
  type Channel, type Me, type PublicUser, type Relationship,
} from '@alga/shared'
import { and, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { isBlockedBetween, profileAudience } from '../access.js'
import type { Ctx } from '../app.js'
import { isUniqueViolation, type Db } from '../db/index.js'
import { channelRecipients, channels, relationships, users, type UserRow } from '../db/schema.js'
import { badRequest, conflict, forbidden, idParam, invalid, notFound, parse } from '../errors.js'
import { broadcastPresence, exchangePresence } from '../gateway/hub.js'
import { channelView, meView, publicUser, recipientsOf, relationshipsOf } from '../views.js'

type RelType = 'friend' | 'incoming' | 'outgoing' | 'blocked'

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

async function relOf(db: Db, userId: string, targetId: string): Promise<RelType | undefined> {
  const [r] = await db.select({ type: relationships.type }).from(relationships)
    .where(and(eq(relationships.userId, userId), eq(relationships.targetId, targetId)))
  return r?.type
}

async function setRel(db: Db, userId: string, targetId: string, type: RelType): Promise<void> {
  await db.insert(relationships).values({ userId, targetId, type, since: new Date() })
    .onConflictDoUpdate({ target: [relationships.userId, relationships.targetId], set: { type, since: new Date() } })
}

async function delRel(db: Db, userId: string, targetId: string): Promise<void> {
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

  app.patch('/users/@me', async (req): Promise<Me> => {
    const body = parse(PatchMeBody, req.body)
    const before = req.auth.user
    if (!Object.keys(body).length) return meView(before)
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
    await afterMeUpdate(ctx, before, after!)
    return meView(after!)
  })

  app.get<{ Params: { id: string } }>('/users/:id', async (req): Promise<PublicUser> =>
    publicUser(await userById(db, idParam(req.params.id))))

  // ---- relationships ----------------------------------------------------------------------------

  app.get('/relationships', async (req): Promise<Relationship[]> => relationshipsOf(db, req.auth.user.id))

  app.post('/relationships', async (req): Promise<Relationship> => {
    const { username } = parse(FriendRequestBody, req.body)
    const me = req.auth.user.id
    const [target] = await db.select().from(users).where(eq(users.username, username))
    if (!target) throw invalid({ username: 'Usuário não encontrado.' })
    if (target.id === me) throw invalid({ username: 'Você não pode adicionar a si mesmo.' })
    const [mine, theirs] = await Promise.all([relOf(db, me, target.id), relOf(db, target.id, me)])
    // Do not reveal that the target blocked us.
    if (theirs === 'blocked') throw forbidden('Não foi possível enviar o pedido de amizade.')
    if (mine === 'blocked') throw badRequest('Desbloqueie este usuário antes de enviar um pedido.')
    if (mine === 'friend') throw conflict('Vocês já são amigos.')
    if (mine === 'outgoing') return (await relationshipsOf(db, me, target.id))[0]!
    const accepting = mine === 'incoming'
    await db.transaction(async (tx) => {
      await setRel(tx, me, target.id, accepting ? 'friend' : 'outgoing')
      await setRel(tx, target.id, me, accepting ? 'friend' : 'incoming')
    })
    await publishRel(ctx, target.id, me)
    if (accepting) await exchangePresence(db, hub, me, [target.id])
    return publishRel(ctx, me, target.id)
  })

  app.put<{ Params: { userId: string } }>('/relationships/:userId', async (req): Promise<Relationship> => {
    const { type } = parse(PutRelationshipBody, req.body)
    const me = req.auth.user.id
    const target = await userById(db, idParam(req.params.userId))
    if (target.id === me) throw badRequest('Operação inválida com você mesmo.')
    const [mine, theirs] = await Promise.all([relOf(db, me, target.id), relOf(db, target.id, me)])

    if (type === 'friend') {
      if (mine === 'friend') return (await relationshipsOf(db, me, target.id))[0]!
      if (mine !== 'incoming') throw badRequest('Não há pedido de amizade pendente deste usuário.')
      await db.transaction(async (tx) => {
        await setRel(tx, me, target.id, 'friend')
        await setRel(tx, target.id, me, 'friend')
      })
      await publishRel(ctx, target.id, me)
      await exchangePresence(db, hub, me, [target.id])
      return publishRel(ctx, me, target.id)
    }

    // block: my row becomes 'blocked'; their friend/request row toward me disappears (their own block stays).
    const dropTheirs = theirs !== undefined && theirs !== 'blocked'
    await db.transaction(async (tx) => {
      await setRel(tx, me, target.id, 'blocked')
      if (dropTheirs) await delRel(tx, target.id, me)
    })
    if (dropTheirs) hub.dispatch([target.id], 'RELATIONSHIP_REMOVE', { userId: me })
    return publishRel(ctx, me, target.id)
  })

  app.delete<{ Params: { userId: string } }>('/relationships/:userId', async (req, reply) => {
    const me = req.auth.user.id
    const targetId = idParam(req.params.userId)
    const [mine, theirs] = await Promise.all([relOf(db, me, targetId), relOf(db, targetId, me)])
    if (!mine) throw notFound('Relacionamento não encontrado.')
    // remove friend / decline / cancel → both rows go; unblock → only mine (their block, if any, stays).
    const dropTheirs = theirs !== undefined && theirs !== 'blocked' && mine !== 'blocked'
    await db.transaction(async (tx) => {
      await delRel(tx, me, targetId)
      if (dropTheirs) await delRel(tx, targetId, me)
    })
    hub.dispatch([me], 'RELATIONSHIP_REMOVE', { userId: targetId })
    if (dropTheirs) hub.dispatch([targetId], 'RELATIONSHIP_REMOVE', { userId: me })
    return reply.code(204).send()
  })

  // ---- private channels -------------------------------------------------------------------------

  app.post('/users/@me/channels', async (req, reply): Promise<Channel> => {
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
}
