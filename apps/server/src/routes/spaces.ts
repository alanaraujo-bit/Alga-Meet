import { randomBytes } from 'node:crypto'
import {
  CreateChannelBody, CreateInviteBody, CreateSpaceBody, DEFAULT_EVERYONE_PERMISSIONS, PatchChannelBody,
  PatchSpaceBody, Permission, uuidv7,
  type Channel, type Invite, type Space, type SpaceSnapshot,
} from '@alga/shared'
import { and, count, eq, gt, isNull, lt, max, or, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { channelAudience, requireChannel, requireSpace, spaceMemberIds } from '../access.js'
import type { Ctx } from '../app.js'
import { isUniqueViolation, type Db } from '../db/index.js'
import { channels, invites, roles, spaceMembers, spaces, type InviteRow, type SpaceRow } from '../db/schema.js'
import { badRequest, forbidden, idParam, invalid, notFound, parse } from '../errors.js'
import { exchangePresence } from '../gateway/hub.js'
import { channelView, memberView, spaceSnapshots, spaceView } from '../views.js'

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** 8 random base62 chars; bytes ≥ 248 are rejected so every symbol is equally likely. */
export function inviteCode(): string {
  let out = ''
  while (out.length < 8) {
    for (const b of randomBytes(16)) {
      if (b < 248 && out.length < 8) out += BASE62[b % 62]
    }
  }
  return out
}

function codeParam(code: string): string {
  if (!/^[0-9A-Za-z]{1,32}$/.test(code)) throw notFound('Convite inválido ou expirado.')
  return code
}

const usable = (i: InviteRow) => (i.maxUses === 0 || i.uses < i.maxUses) && (!i.expiresAt || i.expiresAt > new Date())

async function inviteView(db: Db, i: InviteRow, space: SpaceRow): Promise<Invite> {
  const [c] = await db.select({ n: count() }).from(spaceMembers).where(eq(spaceMembers.spaceId, space.id))
  return {
    code: i.code,
    space: spaceView(space),
    inviterId: i.inviterId,
    uses: i.uses,
    maxUses: i.maxUses,
    expiresAt: i.expiresAt?.toISOString() ?? null,
    memberCount: c?.n ?? 0,
  }
}

async function loadInvite(db: Db, code: string): Promise<{ invite: InviteRow; space: SpaceRow } | undefined> {
  const [row] = await db.select({ invite: invites, space: spaces }).from(invites)
    .innerJoin(spaces, eq(spaces.id, invites.spaceId)).where(eq(invites.code, code))
  return row
}

async function removeMember(ctx: Ctx, spaceId: string, userId: string): Promise<void> {
  const { db, hub, voice } = ctx
  const chans = await db.select({ id: channels.id }).from(channels).where(eq(channels.spaceId, spaceId))
  await voice.disconnect(userId, chans.map((c) => c.id))
  await db.delete(spaceMembers).where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)))
  hub.dispatch(await spaceMemberIds(db, spaceId), 'MEMBER_REMOVE', { spaceId, userId })
  hub.dispatch([userId], 'SPACE_DELETE', { id: spaceId })
}

export function invitePublicRoutes(app: FastifyInstance, { db }: Ctx): void {
  app.get<{ Params: { code: string } }>('/invites/:code', async (req): Promise<Invite> => {
    const found = await loadInvite(db, codeParam(req.params.code))
    if (!found || !usable(found.invite)) throw notFound('Convite inválido ou expirado.')
    return inviteView(db, found.invite, found.space)
  })
}

export function spaceRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, hub, voice } = ctx

  app.post('/spaces', async (req, reply): Promise<SpaceSnapshot> => {
    const { name } = parse(CreateSpaceBody, req.body)
    const me = req.auth.user.id
    const id = uuidv7()
    await db.transaction(async (tx) => {
      await tx.insert(spaces).values({ id, name, ownerId: me })
      await tx.insert(roles).values({ id, spaceId: id, name: '@everyone', permissions: DEFAULT_EVERYONE_PERMISSIONS, position: 0 })
      await tx.insert(spaceMembers).values({ spaceId: id, userId: me })
      await tx.insert(channels).values([
        { id: uuidv7(), type: 'text', spaceId: id, name: 'geral', position: 0 },
        { id: uuidv7(), type: 'voice', spaceId: id, name: 'Geral', position: 1, bitrateKbps: 64, userLimit: 0 },
      ])
    })
    const [snapshot] = await spaceSnapshots(db, [id])
    hub.dispatch([me], 'SPACE_CREATE', snapshot!)
    reply.code(201)
    return snapshot!
  })

  app.patch<{ Params: { id: string } }>('/spaces/:id', async (req): Promise<Space> => {
    const { space } = await requireSpace(db, idParam(req.params.id), req.auth.user.id, Permission.MANAGE_SPACE)
    const body = parse(PatchSpaceBody, req.body)
    if (!Object.keys(body).length) return spaceView(space)
    const [row] = await db.update(spaces).set(body).where(eq(spaces.id, space.id)).returning()
    const view = spaceView(row!)
    hub.dispatch(await spaceMemberIds(db, space.id), 'SPACE_UPDATE', view)
    return view
  })

  app.delete<{ Params: { id: string } }>('/spaces/:id', async (req, reply) => {
    const { space } = await requireSpace(db, idParam(req.params.id), req.auth.user.id)
    if (space.ownerId !== req.auth.user.id) throw forbidden('Apenas o dono pode excluir o espaço.')
    const members = await spaceMemberIds(db, space.id)
    const voiceChannels = await db.select({ id: channels.id }).from(channels)
      .where(and(eq(channels.spaceId, space.id), eq(channels.type, 'voice')))
    await db.delete(spaces).where(eq(spaces.id, space.id))
    hub.dispatch(members, 'SPACE_DELETE', { id: space.id })
    await voice.dropChannels(voiceChannels.map((c) => c.id), members)
    return reply.code(204).send()
  })

  app.delete<{ Params: { id: string } }>('/spaces/:id/members/@me', async (req, reply) => {
    const { space } = await requireSpace(db, idParam(req.params.id), req.auth.user.id)
    if (space.ownerId === req.auth.user.id) throw badRequest('O dono não pode sair do espaço; exclua-o.')
    await removeMember(ctx, space.id, req.auth.user.id)
    return reply.code(204).send()
  })

  app.delete<{ Params: { id: string; userId: string } }>('/spaces/:id/members/:userId', async (req, reply) => {
    const { space } = await requireSpace(db, idParam(req.params.id), req.auth.user.id, Permission.KICK_MEMBERS)
    const target = idParam(req.params.userId)
    if (target === req.auth.user.id) throw badRequest('Para sair do espaço use /members/@me.')
    if (target === space.ownerId) throw forbidden('O dono do espaço não pode ser removido.')
    const [m] = await db.select({ id: spaceMembers.userId }).from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, space.id), eq(spaceMembers.userId, target)))
    if (!m) throw notFound('Membro não encontrado.')
    await removeMember(ctx, space.id, target)
    return reply.code(204).send()
  })

  // ---- channels ---------------------------------------------------------------------------------

  app.post<{ Params: { id: string } }>('/spaces/:id/channels', async (req, reply): Promise<Channel> => {
    const { space } = await requireSpace(db, idParam(req.params.id), req.auth.user.id, Permission.MANAGE_CHANNELS)
    const body = parse(CreateChannelBody, req.body)
    const [last] = await db.select({ p: max(channels.position) }).from(channels).where(eq(channels.spaceId, space.id))
    const [row] = await db.insert(channels).values({
      id: uuidv7(),
      type: body.type,
      spaceId: space.id,
      name: body.name,
      topic: body.topic ?? '',
      position: (last?.p ?? -1) + 1,
      ...(body.type === 'voice' ? { bitrateKbps: 64, userLimit: 0 } : {}),
    }).returning()
    const channel = channelView(row!)
    hub.dispatch(await channelAudience(db, row!), 'CHANNEL_CREATE', channel)
    reply.code(201)
    return channel
  })

  app.patch<{ Params: { id: string } }>('/channels/:id', async (req): Promise<Channel> => {
    const { channel } = await requireChannel(db, idParam(req.params.id), req.auth.user.id, Permission.MANAGE_CHANNELS)
    const body = parse(PatchChannelBody, req.body)
    if (channel.type !== 'voice' && (body.bitrateKbps !== undefined || body.userLimit !== undefined)) {
      throw invalid({
        ...(body.bitrateKbps !== undefined ? { bitrateKbps: 'Apenas canais de voz têm bitrate.' } : {}),
        ...(body.userLimit !== undefined ? { userLimit: 'Apenas canais de voz têm limite de usuários.' } : {}),
      })
    }
    if (!Object.keys(body).length) return channelView(channel)
    const [row] = await db.update(channels).set(body).where(eq(channels.id, channel.id)).returning()
    const view = channelView(row!)
    hub.dispatch(await channelAudience(db, row!), 'CHANNEL_UPDATE', view)
    return view
  })

  app.delete<{ Params: { id: string } }>('/channels/:id', async (req, reply) => {
    const { channel } = await requireChannel(db, idParam(req.params.id), req.auth.user.id, Permission.MANAGE_CHANNELS)
    const audience = await channelAudience(db, channel)
    await db.delete(channels).where(eq(channels.id, channel.id))
    hub.dispatch(audience, 'CHANNEL_DELETE', { id: channel.id, spaceId: channel.spaceId })
    if (channel.type === 'voice') await voice.dropChannels([channel.id], audience)
    return reply.code(204).send()
  })

  // ---- invites ----------------------------------------------------------------------------------

  app.post<{ Params: { id: string } }>('/spaces/:id/invites', async (req, reply): Promise<Invite> => {
    const { space } = await requireSpace(db, idParam(req.params.id), req.auth.user.id, Permission.CREATE_INVITES)
    const body = parse(CreateInviteBody, req.body)
    const expiresAt = body.maxAgeSeconds ? new Date(Date.now() + body.maxAgeSeconds * 1000) : null
    for (let attempt = 0; ; attempt++) {
      try {
        const [row] = await db.insert(invites).values({
          code: inviteCode(), spaceId: space.id, inviterId: req.auth.user.id, maxUses: body.maxUses, expiresAt,
        }).returning()
        reply.code(201)
        return await inviteView(db, row!, space)
      } catch (err) {
        if (!isUniqueViolation(err) || attempt >= 3) throw err
      }
    }
  })

  app.post<{ Params: { code: string } }>('/invites/:code', async (req): Promise<SpaceSnapshot> => {
    const me = req.auth.user.id
    const found = await loadInvite(db, codeParam(req.params.code))
    if (!found) throw notFound('Convite inválido ou expirado.')
    const spaceId = found.space.id
    const joined = await db.transaction(async (tx) => {
      const [added] = await tx.insert(spaceMembers).values({ spaceId, userId: me }).onConflictDoNothing().returning()
      if (!added) return false // already a member: joining is idempotent and consumes no use
      // Conditional increment: concurrent joins can never push `uses` past `maxUses`.
      const [consumed] = await tx.update(invites).set({ uses: sql`${invites.uses} + 1` }).where(and(
        eq(invites.code, found.invite.code),
        or(eq(invites.maxUses, 0), lt(invites.uses, invites.maxUses)),
        or(isNull(invites.expiresAt), gt(invites.expiresAt, new Date())),
      )).returning({ code: invites.code })
      if (!consumed) throw notFound('Convite inválido ou expirado.')
      return true
    })
    const [snapshot] = await spaceSnapshots(db, [spaceId])
    if (joined) {
      const others = (await spaceMemberIds(db, spaceId)).filter((id) => id !== me)
      hub.dispatch(others, 'MEMBER_ADD', (await memberView(db, spaceId, me))!)
      hub.dispatch([me], 'SPACE_CREATE', snapshot!)
      await exchangePresence(db, hub, me, others)
    }
    return snapshot!
  })
}

