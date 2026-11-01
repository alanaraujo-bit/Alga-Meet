/** Bans and voice moderation (server mute/deafen, move, disconnect). */
import { BanBody, Permission, VoiceModerationBody, type Ban } from '@alga/shared'
import { and, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { assertOutranks, requireActor, requireSpace } from '../access.js'
import type { Ctx } from '../app.js'
import { channels, spaceBans, spaceMembers, users } from '../db/schema.js'
import { badRequest, idParam, invalid, notFound, parse } from '../errors.js'
import { loadChannel, publicUser } from '../views.js'
import { removeMember } from './spaces.js'

export function moderationRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, voice } = ctx
  type P = { Params: { id: string } }
  type PU = { Params: { id: string; userId: string } }

  app.get<P>('/spaces/:id/bans', async (req): Promise<Ban[]> => {
    const { space } = await requireSpace(db, idParam(req.params.id), req.auth.user.id, Permission.BAN_MEMBERS)
    const rows = await db.select({ b: spaceBans, u: users }).from(spaceBans)
      .innerJoin(users, eq(users.id, spaceBans.userId))
      .where(eq(spaceBans.spaceId, space.id)).orderBy(desc(spaceBans.createdAt))
    return rows.map(({ b, u }) => ({ user: publicUser(u), reason: b.reason, createdAt: b.createdAt.toISOString() }))
  })

  app.put<PU>('/spaces/:id/bans/:userId', async (req, reply) => {
    const me = req.auth.user.id
    const actor = await requireActor(db, idParam(req.params.id), me, Permission.BAN_MEMBERS)
    const target = idParam(req.params.userId)
    const { reason } = parse(BanBody, req.body)
    if (target === me) throw badRequest('Você não pode banir a si mesmo.')
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, target))
    if (!user) throw notFound('Usuário não encontrado.')
    await assertOutranks(db, actor, target)
    const spaceId = actor.space.id
    await db.insert(spaceBans).values({ spaceId, userId: target, reason: reason ?? '', moderatorId: me })
      .onConflictDoUpdate({ target: [spaceBans.spaceId, spaceBans.userId], set: { reason: reason ?? '', moderatorId: me } })
    const [member] = await db.select({ id: spaceMembers.userId }).from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, target)))
    if (member) await removeMember(ctx, spaceId, target, 'moderator')
    return reply.code(204).send()
  })

  app.delete<PU>('/spaces/:id/bans/:userId', async (req, reply) => {
    const { space } = await requireSpace(db, idParam(req.params.id), req.auth.user.id, Permission.BAN_MEMBERS)
    const removed = await db.delete(spaceBans)
      .where(and(eq(spaceBans.spaceId, space.id), eq(spaceBans.userId, idParam(req.params.userId)))).returning()
    if (!removed.length) throw notFound('Banimento não encontrado.')
    return reply.code(204).send()
  })

  app.patch<PU>('/spaces/:id/members/:userId/voice', async (req, reply) => {
    const me = req.auth.user.id
    const body = parse(VoiceModerationBody, req.body)
    const needed = (body.serverMute !== undefined ? Permission.MUTE_MEMBERS : 0)
      | (body.serverDeaf !== undefined ? Permission.DEAFEN_MEMBERS : 0)
      | (body.channelId !== undefined ? Permission.MOVE_MEMBERS : 0)
    if (!needed) throw badRequest('Informe serverMute, serverDeaf ou channelId.')
    const { space } = await requireSpace(db, idParam(req.params.id), me, needed)
    const target = req.params.userId === '@me' ? me : idParam(req.params.userId)
    const [member] = await db.select().from(spaceMembers).where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.userId, target)))
    if (!member) throw notFound('Membro não encontrado.')

    // Validate the move/disconnect before changing anything.
    if (body.channelId !== undefined) {
      if (voice.stateOf(target)?.spaceId !== space.id) throw badRequest('Este membro não está em um canal de voz deste espaço.')
      if (body.channelId !== null) {
        const to = await loadChannel(db, body.channelId)
        if (!to || to.row.spaceId !== space.id || to.row.type !== 'voice') throw invalid({ channelId: 'Canal de voz não encontrado neste espaço.' })
      }
    }
    if (body.serverMute !== undefined || body.serverDeaf !== undefined) {
      const [mod] = await db.update(spaceMembers)
        .set({ serverMute: body.serverMute ?? member.serverMute, serverDeaf: body.serverDeaf ?? member.serverDeaf })
        .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.userId, target)))
        .returning({ serverMute: spaceMembers.serverMute, serverDeaf: spaceMembers.serverDeaf })
      await voice.moderate(target, space.id, mod!)
    }
    if (body.channelId === null) {
      const voiceChannels = await db.select({ id: channels.id }).from(channels).where(eq(channels.spaceId, space.id))
      await voice.disconnect(target, voiceChannels.map((c) => c.id), 'moderator')
    } else if (body.channelId) {
      await voice.move(target, space.id, body.channelId)
    }
    return reply.code(204).send()
  })
}
