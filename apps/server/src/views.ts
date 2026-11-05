/** Row → wire-model mapping and batched loaders for composite models. */
import {
  PRIVATE_COSMETIC_SLOTS,
  type Attachment, type Channel, type CosmeticSlot, type Me, type Member, type Message, type PublicUser, type Relationship, type Role,
  type Space, type SpaceSnapshot,
} from '@alga/shared'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { planSummary, plusBadgeOf } from './billing/catalog.js'
import { spaceUpgradeState } from './billing/casa.js'
import { TERMS_VERSION, ageBracketOf } from './legal.js'
import type { Db } from './db/index.js'
import {
  attachments, channelRecipients, channels, memberRoles, reactions, relationships, roles, spaceMembers, spaces, users,
  type ChannelRow, type MessageRow, type RoleRow, type SpaceRow, type UserRow,
} from './db/schema.js'

export const publicUser = (u: UserRow): PublicUser => {
  // Private slots (app icon/accent) are the user's alone; empty cosmetics are omitted so READY member lists stay small.
  const shown = Object.entries(u.cosmetics).filter(([slot]) => !PRIVATE_COSMETIC_SLOTS.includes(slot as CosmeticSlot))
  const badge = plusBadgeOf(u.plusSince, u.plan)
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    accentColor: u.accentColor,
    bio: u.bio,
    ...(u.eco ? { eco: u.eco } : {}),
    ...(shown.length ? { cosmetics: Object.fromEntries(shown) } : {}),
    ...(badge ? { plusBadge: badge } : {}),
  }
}

/** `defaultAttachmentBytes` = config.files.maxAttachmentBytes (the free plan's cap). */
export const meView = (u: UserRow, defaultAttachmentBytes: number): Me => ({
  ...publicUser(u),
  ...(Object.keys(u.cosmetics).length ? { cosmetics: { ...u.cosmetics } } : {}),
  email: u.email,
  emailVerified: u.emailVerifiedAt !== null,
  statusPreference: u.statusPreference,
  createdAt: u.createdAt.toISOString(),
  plan: planSummary(u.plan, defaultAttachmentBytes),
  ageBracket: ageBracketOf(u),
  needsTermsAcceptance: u.termsVersion !== TERMS_VERSION,
  telemetryOptIn: u.telemetryOptIn,
  staffRole: u.staffRole ?? null,
})

export const spaceView = (s: SpaceRow): Space => ({
  id: s.id,
  name: s.name,
  iconUrl: s.iconUrl,
  ownerId: s.ownerId,
  createdAt: s.createdAt.toISOString(),
  e2ee: s.e2ee,
  ...(s.upgradeEndsAt ? { upgrade: spaceUpgradeState(s)! } : {}),
})

export const roleView = (r: RoleRow): Role => ({
  id: r.id,
  spaceId: r.spaceId,
  name: r.name,
  color: r.color,
  permissions: r.permissions,
  position: r.position,
})

export function channelView(c: ChannelRow, recipientIds?: string[]): Channel {
  const out: Channel = {
    id: c.id,
    type: c.type,
    spaceId: c.spaceId,
    name: c.name,
    topic: c.topic,
    position: c.position,
    lastMessageId: c.lastMessageId,
  }
  if (c.type === 'voice') {
    out.bitrateKbps = c.bitrateKbps ?? 64
    out.userLimit = c.userLimit ?? 0
  }
  if (c.type === 'dm' || c.type === 'group_dm') out.recipientIds = recipientIds ?? []
  return out
}

export async function recipientsOf(db: Db, channelIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (!channelIds.length) return map
  const rows = await db.select().from(channelRecipients).where(inArray(channelRecipients.channelId, channelIds))
  for (const r of rows) {
    const list = map.get(r.channelId) ?? []
    list.push(r.userId)
    map.set(r.channelId, list)
  }
  return map
}

/** Channel row (+ recipients for private channels), or undefined. */
export async function loadChannel(db: Db, id: string): Promise<{ row: ChannelRow; recipientIds: string[] } | undefined> {
  const [row] = await db.select().from(channels).where(eq(channels.id, id)).limit(1)
  if (!row) return undefined
  const recipientIds = row.spaceId ? [] : ((await recipientsOf(db, [row.id])).get(row.id) ?? [])
  return { row, recipientIds }
}

export async function privateChannelsOf(db: Db, userId: string): Promise<Channel[]> {
  const rows = await db
    .select({ c: channels })
    .from(channelRecipients)
    .innerJoin(channels, eq(channels.id, channelRecipients.channelId))
    .where(eq(channelRecipients.userId, userId))
  const recips = await recipientsOf(db, rows.map((r) => r.c.id))
  return rows.map((r) => channelView(r.c, recips.get(r.c.id)))
}

export async function spaceSnapshots(db: Db, spaceIds: string[]): Promise<SpaceSnapshot[]> {
  if (!spaceIds.length) return []
  const [spaceRows, channelRows, roleRows, memberRows, memberRoleRows] = await Promise.all([
    db.select().from(spaces).where(inArray(spaces.id, spaceIds)),
    db.select().from(channels).where(inArray(channels.spaceId, spaceIds)).orderBy(asc(channels.position), asc(channels.id)),
    db.select().from(roles).where(inArray(roles.spaceId, spaceIds)).orderBy(asc(roles.position)),
    db.select({ m: spaceMembers, u: users }).from(spaceMembers)
      .innerJoin(users, eq(users.id, spaceMembers.userId))
      .where(inArray(spaceMembers.spaceId, spaceIds)),
    db.select().from(memberRoles).where(inArray(memberRoles.spaceId, spaceIds)),
  ])
  const roleIdsOf = new Map<string, string[]>()
  for (const mr of memberRoleRows) {
    const k = `${mr.spaceId}:${mr.userId}`
    roleIdsOf.set(k, [...(roleIdsOf.get(k) ?? []), mr.roleId])
  }
  return spaceRows.map((s) => ({
    ...spaceView(s),
    channels: channelRows.filter((c) => c.spaceId === s.id).map((c) => channelView(c)),
    roles: roleRows.filter((r) => r.spaceId === s.id).map(roleView),
    members: memberRows
      .filter((r) => r.m.spaceId === s.id)
      .map((r): Member => ({
        spaceId: s.id,
        user: publicUser(r.u),
        nickname: r.m.nickname,
        roleIds: roleIdsOf.get(`${s.id}:${r.u.id}`) ?? [],
        joinedAt: r.m.joinedAt.toISOString(),
      })),
  }))
}

export async function memberView(db: Db, spaceId: string, userId: string): Promise<Member | undefined> {
  const [row] = await db.select({ m: spaceMembers, u: users }).from(spaceMembers)
    .innerJoin(users, eq(users.id, spaceMembers.userId))
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)))
  if (!row) return undefined
  const roleRows = await db.select({ roleId: memberRoles.roleId }).from(memberRoles)
    .where(and(eq(memberRoles.spaceId, spaceId), eq(memberRoles.userId, userId)))
  return {
    spaceId,
    user: publicUser(row.u),
    nickname: row.m.nickname,
    roleIds: roleRows.map((r) => r.roleId),
    joinedAt: row.m.joinedAt.toISOString(),
  }
}

export async function relationshipsOf(db: Db, userId: string, targetId?: string): Promise<Relationship[]> {
  const where = targetId
    ? and(eq(relationships.userId, userId), eq(relationships.targetId, targetId))
    : eq(relationships.userId, userId)
  const rows = await db.select({ r: relationships, u: users }).from(relationships)
    .innerJoin(users, eq(users.id, relationships.targetId))
    .where(where)
  return rows.map(({ r, u }) => ({ user: publicUser(u), type: r.type, since: r.since.toISOString() }))
}

/**
 * Message without per-viewer data: reactions keep the full user list so `me` can be computed per recipient, and
 * attachments have no URL yet (it is signed per viewer).
 */
export interface MessageView extends Omit<Message, 'reactions' | 'attachments'> {
  reactionUsers: { emoji: string; userIds: string[] }[]
  files: Omit<Attachment, 'url'>[]
}

/** Signs Attachment.url for one viewer (Files.url). */
export type FileUrl = (attachmentId: string, viewerId: string) => string

export async function messageViews(db: Db, rows: MessageRow[]): Promise<MessageView[]> {
  if (!rows.length) return []
  const authorIds = [...new Set(rows.map((m) => m.authorId))]
  const ids = rows.map((m) => m.id)
  const [authors, reactionRows, fileRows] = await Promise.all([
    db.select().from(users).where(inArray(users.id, authorIds)),
    db.select().from(reactions).where(inArray(reactions.messageId, ids))
      .orderBy(asc(reactions.createdAt)),
    db.select().from(attachments).where(inArray(attachments.messageId, ids)).orderBy(asc(attachments.id)),
  ])
  const authorById = new Map(authors.map((u) => [u.id, publicUser(u)]))
  return rows.map((m) => {
    const byEmoji = new Map<string, string[]>()
    for (const r of reactionRows) {
      if (r.messageId !== m.id) continue
      byEmoji.set(r.emoji, [...(byEmoji.get(r.emoji) ?? []), r.userId])
    }
    return {
      id: m.id,
      channelId: m.channelId,
      author: authorById.get(m.authorId)!,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      editedAt: m.editedAt?.toISOString() ?? null,
      replyToId: m.replyToId,
      reactionUsers: [...byEmoji].map(([emoji, userIds]) => ({ emoji, userIds })),
      files: fileRows.filter((f) => f.messageId === m.id).map((f) => ({
        id: f.id,
        filename: f.filename,
        contentType: f.contentType,
        size: f.size,
        ...(f.width !== null && f.height !== null ? { width: f.width, height: f.height } : {}),
      })),
    }
  })
}

export function messageFor(view: MessageView, viewerId: string, fileUrl: FileUrl): Message {
  const { reactionUsers, files, ...rest } = view
  return {
    ...rest,
    reactions: reactionUsers.map((r) => ({ emoji: r.emoji, count: r.userIds.length, me: r.userIds.includes(viewerId) })),
    attachments: files.map((f) => ({ ...f, url: fileUrl(f.id, viewerId) })),
  }
}
