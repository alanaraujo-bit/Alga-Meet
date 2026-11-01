import {
  foreignKey, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  /** Stored lowercased. */
  email: text('email').notNull(),
  /** Stored lowercased. */
  username: text('username').notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  avatarUrl: text('avatar_url'),
  accentColor: text('accent_color'),
  bio: text('bio').notNull().default(''),
  statusPreference: text('status_preference', { enum: ['online', 'idle', 'dnd', 'invisible'] }).notNull().default('online'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('users_email_key').on(t.email),
  uniqueIndex('users_username_key').on(t.username),
])

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** SHA-256 (hex) of the opaque bearer token; the token itself is never stored. */
  tokenHash: text('token_hash').notNull(),
  userAgent: text('user_agent').notNull().default(''),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastUsedAt: ts('last_used_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
  index('sessions_user_id_idx').on(t.userId),
])

/** Directional: one row per (user, target). A friendship is two 'friend' rows; a request is 'outgoing' + 'incoming'. */
export const relationships = pgTable('relationships', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  targetId: uuid('target_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['friend', 'incoming', 'outgoing', 'blocked'] }).notNull(),
  since: ts('since').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.targetId] }),
  index('relationships_target_id_idx').on(t.targetId),
])

export const spaces = pgTable('spaces', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  iconUrl: text('icon_url'),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('spaces_owner_id_idx').on(t.ownerId)])

export const spaceMembers = pgTable('space_members', {
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  nickname: text('nickname'),
  joinedAt: ts('joined_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.spaceId, t.userId] }),
  index('space_members_user_id_idx').on(t.userId),
])

/** The @everyone role has id == space id. */
export const roles = pgTable('roles', {
  id: uuid('id').primaryKey(),
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color'),
  permissions: integer('permissions').notNull(),
  position: integer('position').notNull().default(0),
}, (t) => [index('roles_space_id_idx').on(t.spaceId)])

export const memberRoles = pgTable('member_roles', {
  spaceId: uuid('space_id').notNull(),
  userId: uuid('user_id').notNull(),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.spaceId, t.userId, t.roleId] }),
  foreignKey({ columns: [t.spaceId, t.userId], foreignColumns: [spaceMembers.spaceId, spaceMembers.userId] }).onDelete('cascade'),
  index('member_roles_role_id_idx').on(t.roleId),
])

export const channels = pgTable('channels', {
  id: uuid('id').primaryKey(),
  type: text('type', { enum: ['text', 'voice', 'dm', 'group_dm'] }).notNull(),
  spaceId: uuid('space_id').references(() => spaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default(''),
  topic: text('topic').notNull().default(''),
  position: integer('position').notNull().default(0),
  bitrateKbps: integer('bitrate_kbps'),
  userLimit: integer('user_limit'),
  lastMessageId: uuid('last_message_id'),
  /** 1:1 DMs only: "<smaller user id>:<larger user id>", makes "open DM" idempotent and race-free. */
  dmKey: text('dm_key'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  index('channels_space_id_idx').on(t.spaceId),
  uniqueIndex('channels_dm_key_key').on(t.dmKey),
])

export const channelRecipients = pgTable('channel_recipients', {
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.channelId, t.userId] }),
  index('channel_recipients_user_id_idx').on(t.userId),
])

export const messages = pgTable('messages', {
  /** UUIDv7: ordering by id is ordering by creation time. */
  id: uuid('id').primaryKey(),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  replyToId: uuid('reply_to_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
  editedAt: ts('edited_at'),
}, (t) => [
  index('messages_channel_id_id_idx').on(t.channelId, t.id),
  foreignKey({ columns: [t.replyToId], foreignColumns: [t.id] }).onDelete('set null'),
])

export const reactions = pgTable('reactions', {
  messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji: text('emoji').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })])

export const invites = pgTable('invites', {
  code: text('code').primaryKey(),
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  inviterId: uuid('inviter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  uses: integer('uses').notNull().default(0),
  /** 0 = unlimited. */
  maxUses: integer('max_uses').notNull().default(0),
  expiresAt: ts('expires_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('invites_space_id_idx').on(t.spaceId)])

export const readStates = pgTable('read_states', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  lastReadMessageId: uuid('last_read_message_id'),
  mentionCount: integer('mention_count').notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.userId, t.channelId] }),
  index('read_states_channel_id_idx').on(t.channelId),
])

export type UserRow = typeof users.$inferSelect
export type ChannelRow = typeof channels.$inferSelect
export type MessageRow = typeof messages.$inferSelect
export type SpaceRow = typeof spaces.$inferSelect
export type RoleRow = typeof roles.$inferSelect
export type InviteRow = typeof invites.$inferSelect
