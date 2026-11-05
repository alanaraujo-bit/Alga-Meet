/** Permission checks and fan-out audiences. Every space action goes through computePermissions/hasPermission. */
import { Permission, computePermissions, hasPermission } from '@alga/shared'
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Db } from './db/index.js'
import {
  channelRecipients, memberRoles, relationships, roles, spaceMembers, spaces,
  type ChannelRow, type SpaceRow,
} from './db/schema.js'
import { forbidden, notFound } from './errors.js'
import { loadChannel } from './views.js'

/** What a participant of a DM / group DM may do (there are no roles there). */
export const PRIVATE_CHANNEL_PERMISSIONS =
  Permission.VIEW_CHANNELS | Permission.SEND_MESSAGES | Permission.ADD_REACTIONS |
  Permission.ATTACH_FILES | Permission.CONNECT | Permission.SPEAK | Permission.STREAM

const everyone = alias(roles, 'everyone')
const memberRole = alias(roles, 'member_role')

/** Effective permissions of every member of a space (or just `userId`). */
export async function memberPermissions(db: Db, spaceId: string, userId?: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      userId: spaceMembers.userId,
      ownerId: spaces.ownerId,
      everyone: everyone.permissions,
      roles: sql<number>`coalesce(bit_or(${memberRole.permissions}), 0)`.mapWith(Number),
    })
    .from(spaceMembers)
    .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
    .innerJoin(everyone, eq(everyone.id, spaceMembers.spaceId))
    .leftJoin(memberRoles, and(eq(memberRoles.spaceId, spaceMembers.spaceId), eq(memberRoles.userId, spaceMembers.userId)))
    .leftJoin(memberRole, eq(memberRole.id, memberRoles.roleId))
    .where(userId ? and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)) : eq(spaceMembers.spaceId, spaceId))
    .groupBy(spaceMembers.userId, spaces.ownerId, everyone.permissions)
  return new Map(rows.map((r) => [
    r.userId,
    computePermissions({ isOwner: r.ownerId === r.userId, everyone: r.everyone, roles: [r.roles] }),
  ]))
}

export interface SpaceAccess {
  space: SpaceRow
  permissions: number
}

/** 404 if the space does not exist, 403 if the user is not a member or lacks `needed`. */
export async function requireSpace(db: Db, spaceId: string, userId: string, needed = 0): Promise<SpaceAccess> {
  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1)
  if (!space) throw notFound('Espaço não encontrado.')
  const permissions = (await memberPermissions(db, spaceId, userId)).get(userId)
  if (permissions === undefined) throw forbidden('Você não é membro deste espaço.')
  if (!hasPermission(permissions, needed)) throw forbidden()
  return { space, permissions }
}

/** A space actor for hierarchy checks: the owner outranks everyone, otherwise the highest role position counts. */
export interface Actor extends SpaceAccess {
  userId: string
  isOwner: boolean
  /** Highest role position (0 = only @everyone, Infinity = owner). */
  top: number
}

/** Highest role position of a member (0 when they only have @everyone). */
export async function topRole(db: Db, spaceId: string, userId: string): Promise<number> {
  const [row] = await db.select({ top: sql<number>`coalesce(max(${roles.position}), 0)`.mapWith(Number) })
    .from(memberRoles).innerJoin(roles, eq(roles.id, memberRoles.roleId))
    .where(and(eq(memberRoles.spaceId, spaceId), eq(memberRoles.userId, userId)))
  return row?.top ?? 0
}

export async function requireActor(db: Db, spaceId: string, userId: string, needed = 0): Promise<Actor> {
  const access = await requireSpace(db, spaceId, userId, needed)
  const isOwner = access.space.ownerId === userId
  return { ...access, userId, isOwner, top: isOwner ? Infinity : await topRole(db, spaceId, userId) }
}

/** Roles strictly below the actor's highest role (any role for the owner). */
export const canManageRole = (actor: Actor, role: { position: number }) => actor.isOwner || role.position < actor.top

/** 403 unless the actor outranks `targetId` (never the owner; strictly higher top role otherwise). */
export async function assertOutranks(db: Db, actor: Actor, targetId: string): Promise<void> {
  if (targetId === actor.space.ownerId) throw forbidden('O dono do espaço não pode ser moderado.')
  if (!actor.isOwner && (await topRole(db, actor.space.id, targetId)) >= actor.top) {
    throw forbidden('Este membro tem um cargo igual ou superior ao seu.')
  }
}

export interface VoiceModeration {
  serverMute: boolean
  serverDeaf: boolean
}
export const NO_MODERATION: VoiceModeration = { serverMute: false, serverDeaf: false }

export async function voiceModeration(db: Db, spaceId: string, userId: string): Promise<VoiceModeration> {
  const [row] = await db.select({ serverMute: spaceMembers.serverMute, serverDeaf: spaceMembers.serverDeaf }).from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)))
  return row ?? NO_MODERATION
}

export interface ChannelAccess {
  channel: ChannelRow
  /** Private channels only. */
  recipientIds: string[]
  permissions: number
}

/** Resolves a channel the user can see (VIEW_CHANNELS / DM membership) and checks `needed`. */
export async function requireChannel(db: Db, channelId: string, userId: string, needed = 0): Promise<ChannelAccess> {
  const found = await loadChannel(db, channelId)
  if (!found) throw notFound('Canal não encontrado.')
  const { row, recipientIds } = found
  let permissions: number
  if (row.spaceId) {
    const p = (await memberPermissions(db, row.spaceId, userId)).get(userId)
    if (p === undefined || !hasPermission(p, Permission.VIEW_CHANNELS)) throw forbidden('Você não tem acesso a este canal.')
    permissions = p
  } else {
    if (!recipientIds.includes(userId)) throw forbidden('Você não tem acesso a este canal.')
    permissions = PRIVATE_CHANNEL_PERMISSIONS
  }
  if (!hasPermission(permissions, needed)) throw forbidden()
  return { channel: row, recipientIds, permissions }
}

/** True when either user blocked the other. */
export async function isBlockedBetween(db: Db, a: string, b: string): Promise<boolean> {
  const rows = await db.select({ t: relationships.type }).from(relationships).where(and(
    eq(relationships.type, 'blocked'),
    or(
      and(eq(relationships.userId, a), eq(relationships.targetId, b)),
      and(eq(relationships.userId, b), eq(relationships.targetId, a)),
    ),
  )).limit(1)
  return rows.length > 0
}

export async function isFriend(db: Db, a: string, b: string): Promise<boolean> {
  const rows = await db.select({ t: relationships.type }).from(relationships)
    .where(and(eq(relationships.userId, a), eq(relationships.targetId, b), eq(relationships.type, 'friend'))).limit(1)
  return rows.length > 0
}

export async function sharesSpace(db: Db, a: string, b: string): Promise<boolean> {
  const theirs = db.select({ id: spaceMembers.spaceId }).from(spaceMembers).where(eq(spaceMembers.userId, b))
  const rows = await db.select({ id: spaceMembers.spaceId }).from(spaceMembers)
    .where(and(eq(spaceMembers.userId, a), inArray(spaceMembers.spaceId, theirs))).limit(1)
  return rows.length > 0
}

/** For 1:1 DMs: refuses when a block exists between the participants. */
export async function assertDmNotBlocked(db: Db, access: ChannelAccess, userId: string): Promise<void> {
  if (access.channel.type !== 'dm') return
  const other = access.recipientIds.find((id) => id !== userId)
  if (other && await isBlockedBetween(db, userId, other)) throw forbidden('Você não pode interagir com este usuário.')
}

// ---- audiences ---------------------------------------------------------------------------------

export async function spaceMemberIds(db: Db, spaceId: string): Promise<string[]> {
  const rows = await db.select({ id: spaceMembers.userId }).from(spaceMembers).where(eq(spaceMembers.spaceId, spaceId))
  return rows.map((r) => r.id)
}

/** Who receives events scoped to a channel: members that can view it, or the private channel recipients. */
export async function channelAudience(db: Db, channel: Pick<ChannelRow, 'id' | 'spaceId'>, recipientIds?: string[]): Promise<string[]> {
  if (!channel.spaceId) {
    if (recipientIds) return recipientIds
    const rows = await db.select({ id: channelRecipients.userId }).from(channelRecipients)
      .where(eq(channelRecipients.channelId, channel.id))
    return rows.map((r) => r.id)
  }
  const perms = await memberPermissions(db, channel.spaceId)
  return [...perms].filter(([, p]) => hasPermission(p, Permission.VIEW_CHANNELS)).map(([id]) => id)
}

/** Ids of users sharing at least one space with `userId` (excluding them). */
export async function coMemberIds(db: Db, userId: string): Promise<string[]> {
  const mine = db.select({ id: spaceMembers.spaceId }).from(spaceMembers).where(eq(spaceMembers.userId, userId))
  const rows = await db.selectDistinct({ id: spaceMembers.userId }).from(spaceMembers)
    .where(and(inArray(spaceMembers.spaceId, mine), ne(spaceMembers.userId, userId)))
  return rows.map((r) => r.id)
}

/** Friends + space co-members: who sees this user's presence. */
export async function presenceAudience(db: Db, userId: string): Promise<string[]> {
  const [friends, blocks] = await Promise.all([
    db.select({ id: relationships.targetId }).from(relationships)
      .where(and(eq(relationships.userId, userId), eq(relationships.type, 'friend'))),
    blockedWith(db, userId),
  ])
  return [...new Set([...friends.map((f) => f.id), ...await coMemberIds(db, userId)])].filter((id) => !blocks.has(id))
}

/** Everyone `userId` blocked or was blocked by: presence (status, activity, custom status) never crosses a block. */
export async function blockedWith(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db.select({ a: relationships.userId, b: relationships.targetId }).from(relationships).where(and(
    eq(relationships.type, 'blocked'),
    or(eq(relationships.userId, userId), eq(relationships.targetId, userId)),
  ))
  return new Set(rows.map((r) => (r.a === userId ? r.b : r.a)))
}

/** Everyone who may hold a copy of this user's public profile (relationships, co-members, DM partners). */
export async function profileAudience(db: Db, userId: string): Promise<string[]> {
  const [rels, dmPartners] = await Promise.all([
    db.select({ id: relationships.userId }).from(relationships).where(eq(relationships.targetId, userId)),
    db.selectDistinct({ id: channelRecipients.userId }).from(channelRecipients).where(and(
      inArray(channelRecipients.channelId,
        db.select({ id: channelRecipients.channelId }).from(channelRecipients).where(eq(channelRecipients.userId, userId))),
      ne(channelRecipients.userId, userId),
    )),
  ])
  return [...new Set([...rels.map((r) => r.id), ...dmPartners.map((r) => r.id), ...await coMemberIds(db, userId)])]
}
