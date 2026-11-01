import { ACCOUNT_ACTION_REASONS, REPORT_REASONS, type EquippedCosmetics } from '@alga/shared'
import { sql } from 'drizzle-orm'
import {
  boolean, date, foreignKey, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid,
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
  /** Set by the verification link or a password reset. Until then `email` is only claimed (B5: never refused). */
  emailVerifiedAt: ts('email_verified_at'),
  /** Cache of the plan entitlement (hot paths read it with the session), written only by Billing.recompute. */
  plan: text('plan', { enum: ['free', 'plus'] }).notNull().default('free'),
  /** Self-declared at signup (or once later). Used only to compute the age bracket (Lei 15.211/2025, art. 13). */
  birthDate: date('birth_date', { mode: 'string' }),
  birthDateSetAt: ts('birth_date_set_at'),
  /** Legal bundle version last accepted (history in consent_records). */
  termsVersion: text('terms_version'),
  termsAcceptedAt: ts('terms_accepted_at'),
  /** Set only by scripts/grant-staff.ts. */
  staffRole: text('staff_role', { enum: ['admin', 'moderator'] }),
  /** Account enforcement (history in account_actions): login and sessions are refused while either applies. */
  suspendedUntil: ts('suspended_until'),
  bannedAt: ts('banned_at'),
  /** The account_actions row behind the current suspension/ban. */
  restrictionId: uuid('restriction_id'),
  /** Preservation order or CSAM case: never purged, access logs kept past 6 months. */
  legalHoldAt: ts('legal_hold_at'),
  /** DELETE /users/@me (or an under-16 declaration): purged by Privacy.sweep after deletion_purge_after. */
  deletionRequestedAt: ts('deletion_requested_at'),
  deletionPurgeAfter: ts('deletion_purge_after'),
  deletionMessages: text('deletion_messages', { enum: ['anonymize', 'delete'] }),
  /** Equipped cosmetics by slot (PublicUser.cosmetics): owned or plan-included SKUs only (Billing.equip; recompute unequips). */
  cosmetics: jsonb('cosmetics').$type<EquippedCosmetics>().notNull().default({}),
  /** Call-quality telemetry opt-in (Me.telemetryOptIn) and when it was given (LGPD art. 8 §2: proof of consent). */
  telemetryOptIn: boolean('telemetry_opt_in').notNull().default(false),
  telemetryOptInAt: ts('telemetry_opt_in_at'),
  /** Reports by this account that staff dismissed (reporter reliability, AdminReport.reporterFalseReports). */
  falseReports: integer('false_reports').notNull().default(0),
}, (t) => [
  // An address belongs to at most one verified account; unverified accounts may claim a taken one.
  uniqueIndex('users_verified_email_key').on(t.email).where(sql`${t.emailVerifiedAt} is not null`),
  index('users_email_idx').on(t.email),
  uniqueIndex('users_username_key').on(t.username),
  index('users_deletion_purge_after_idx').on(t.deletionPurgeAfter).where(sql`${t.deletionPurgeAfter} is not null`),
])

/** Single-use tokens sent by e-mail. Only the SHA-256 is stored; the row is deleted when used. */
export const emailTokens = pgTable('email_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['verify_email', 'password_reset'] }).notNull(),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('email_tokens_user_id_idx').on(t.userId)])

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
  /** Voice moderation; persists across joins like Discord's server mute/deafen. */
  serverMute: boolean('server_mute').notNull().default(false),
  serverDeaf: boolean('server_deaf').notNull().default(false),
  joinedAt: ts('joined_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.spaceId, t.userId] }),
  index('space_members_user_id_idx').on(t.userId),
])

/** Banned users cannot join through invites; banning also removes the membership. */
export const spaceBans = pgTable('space_bans', {
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull().default(''),
  moderatorId: uuid('moderator_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.spaceId, t.userId] })])

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

/** Files of a message, in upload order (UUIDv7 ids). Deleted with the message; a trigger queues the object for removal. */
export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey(),
  messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  storageKey: text('storage_key').notNull(),
  /** Sanitized; display/download name only (the storage key never contains it). */
  filename: text('filename').notNull(),
  /** Sniffed from the bytes; the client's Content-Type and extension are ignored. */
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  width: integer('width'),
  height: integer('height'),
}, (t) => [index('attachments_message_id_idx').on(t.messageId)])

/**
 * Outbox of storage objects to remove (deleted attachments via trigger, replaced avatars/icons, failed sends), retried
 * with backoff by Files.sweep. Uploads are queued an hour ahead before the bytes are stored and dequeued when the row
 * that references them commits, so a crash in between still cleans up.
 */
export const storageDeletions = pgTable('storage_deletions', {
  key: text('key').primaryKey(),
  notBefore: ts('not_before').notNull().defaultNow(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
}, (t) => [index('storage_deletions_not_before_idx').on(t.notBefore)])

export type AttachmentRow = typeof attachments.$inferSelect

// ---- billing (src/billing/) ---------------------------------------------------------------------------------------

/** Mirror of src/billing/catalog.ts, upserted at startup. Rows are never deleted (orders reference them): dropped SKUs go inactive. */
export const products = pgTable('products', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['plan', 'cosmetic'] }).notNull(),
  planId: text('plan_id'),
  interval: text('interval', { enum: ['month', 'year'] }),
  cosmeticType: text('cosmetic_type'),
  name: text('name').notNull(),
  priceBrlCents: integer('price_brl_cents').notNull(),
  priceUsdCents: integer('price_usd_cents').notNull(),
  active: boolean('active').notNull().default(true),
  catalogVersion: integer('catalog_version').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})

const providerCol = (name: string) => text(name, { enum: ['sandbox', 'mercadopago'] })
const currencyCol = (name: string) => text(name, { enum: ['BRL', 'USD'] })

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey(),
  // restrict: payment records are kept for accounting (an account deletion must anonymize, not delete).
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  productId: text('product_id').notNull().references(() => products.id),
  planId: text('plan_id').notNull(),
  status: text('status', { enum: ['pending', 'active', 'past_due', 'canceled', 'expired'] }).notNull(),
  currentPeriodEnd: ts('current_period_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  amountCents: integer('amount_cents').notNull(),
  currency: currencyCol('currency').notNull(),
  provider: providerCol('provider').notNull(),
  providerSubscriptionId: text('provider_subscription_id'),
  /** Provider-side time of the last applied state: older events are ignored (out-of-order delivery). */
  providerUpdatedAt: ts('provider_updated_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  index('subscriptions_user_id_idx').on(t.userId),
  index('subscriptions_status_period_idx').on(t.status, t.currentPeriodEnd),
  uniqueIndex('subscriptions_provider_ref_key').on(t.provider, t.providerSubscriptionId),
])

/** One-time purchases (cosmetics). */
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey(),
  // restrict: payment records are kept for accounting (an account deletion must anonymize, not delete).
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  productId: text('product_id').notNull().references(() => products.id),
  status: text('status', { enum: ['pending', 'paid', 'refunded', 'canceled', 'expired'] }).notNull(),
  amountCents: integer('amount_cents').notNull(),
  currency: currencyCol('currency').notNull(),
  provider: providerCol('provider').notNull(),
  /** The provider's payment id, known once it reports one. */
  providerPaymentId: text('provider_payment_id'),
  providerUpdatedAt: ts('provider_updated_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  index('orders_user_id_idx').on(t.userId),
  index('orders_status_created_idx').on(t.status, t.createdAt),
  uniqueIndex('orders_provider_ref_key').on(t.provider, t.providerPaymentId),
])

/** What each user can use now, rebuilt by Billing.recompute from subscriptions + paid orders. Never written elsewhere. */
export const entitlements = pgTable('entitlements', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sku: text('sku').notNull(),
  kind: text('kind', { enum: ['plan', 'cosmetic'] }).notNull(),
  source: text('source', { enum: ['subscription', 'order'] }).notNull(),
  sourceId: uuid('source_id').notNull(),
  expiresAt: ts('expires_at'),
}, (t) => [primaryKey({ columns: [t.userId, t.sku] })])

/** Append-only log of verified provider events; the unique key makes delivery idempotent. No card data, only a hash of the payload. */
export const billingEvents = pgTable('billing_events', {
  id: uuid('id').primaryKey(),
  provider: providerCol('provider').notNull(),
  providerEventId: text('provider_event_id').notNull(),
  type: text('type').notNull(),
  payloadSha256: text('payload_sha256').notNull(),
  receivedAt: ts('received_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('billing_events_provider_event_key').on(t.provider, t.providerEventId)])

export type SubscriptionRow = typeof subscriptions.$inferSelect
export type OrderRow = typeof orders.$inferSelect
export type EntitlementRow = typeof entitlements.$inferSelect

// ---- trust & safety, privacy (src/trust-safety.ts, src/privacy.ts) -------------------------------------------------

/** Every acceptance of the legal bundle (proof of what was accepted and when). */
export const consentRecords = pgTable('consent_records', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  termsVersion: text('terms_version').notNull(),
  acceptedAt: ts('accepted_at').notNull().defaultNow(),
}, (t) => [index('consent_records_user_id_idx').on(t.userId)])

/**
 * Marco Civil art. 15 access records: every login plus the first use per day of each (IP, app). No FK: they must
 * outlive a deleted account for 6 months (then Privacy.sweep purges them, unless the account is on legal hold).
 */
export const accessLogs = pgTable('access_logs', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  ip: text('ip').notNull(),
  userAgentSha256: text('user_agent_sha256').notNull(),
  event: text('event', { enum: ['login', 'session_use', 'export_download'] }).notNull(),
  /** UTC day of `at`: one session_use row per user, day, IP and user agent. */
  day: date('day', { mode: 'string' }).notNull(),
  at: ts('at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('access_logs_daily_key').on(t.userId, t.day, t.ip, t.userAgentSha256).where(sql`${t.event} = 'session_use'`),
  index('access_logs_user_id_at_idx').on(t.userId, t.at),
  index('access_logs_at_idx').on(t.at),
])

/** Reports with a snapshot of the target taken at report time. Target/user ids have no FK: evidence outlives them. */
export const reports = pgTable('reports', {
  id: uuid('id').primaryKey(),
  reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
  targetType: text('target_type', { enum: ['message', 'user', 'space'] }).notNull(),
  targetId: uuid('target_id').notNull(),
  targetUserId: uuid('target_user_id'),
  spaceId: uuid('space_id'),
  channelId: uuid('channel_id'),
  reason: text('reason', { enum: REPORT_REASONS }).notNull(),
  details: text('details').notNull().default(''),
  snapshot: jsonb('snapshot').notNull(),
  priority: integer('priority').notNull(),
  status: text('status', { enum: ['open', 'resolved', 'dismissed'] }).notNull().default('open'),
  action: text('action', { enum: ['none', 'remove_content', 'warn', 'suspend', 'ban'] }),
  staffId: uuid('staff_id'),
  staffNote: text('staff_note'),
  createdAt: ts('created_at').notNull().defaultNow(),
  resolvedAt: ts('resolved_at'),
}, (t) => [
  index('reports_queue_idx').on(t.status, t.priority, t.createdAt),
  index('reports_target_user_id_idx').on(t.targetUserId),
  index('reports_reporter_created_idx').on(t.reporterId, t.createdAt),
  // A second report of the same target by the same person while the first is open is the same report.
  uniqueIndex('reports_open_dedupe_key').on(t.reporterId, t.targetType, t.targetId).where(sql`${t.status} = 'open'`),
])

/** Platform-level enforcement history (warn / suspend / ban / lift). No FK on user_id: kept with the case. */
export const accountActions = pgTable('account_actions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  type: text('type', { enum: ['warn', 'suspend', 'ban', 'lift'] }).notNull(),
  reason: text('reason', { enum: ACCOUNT_ACTION_REASONS }).notNull(),
  until: ts('until'),
  /** Internal staff note; never sent to the user. */
  note: text('note').notNull().default(''),
  reportId: uuid('report_id'),
  /** null = automatic (e.g. an under-16 declaration). */
  staffId: uuid('staff_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('account_actions_user_id_idx').on(t.userId)])

export const appeals = pgTable('appeals', {
  id: uuid('id').primaryKey(),
  actionId: uuid('action_id').notNull().references(() => accountActions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  message: text('message').notNull(),
  status: text('status', { enum: ['open', 'upheld', 'rejected'] }).notNull().default('open'),
  staffId: uuid('staff_id'),
  staffNote: text('staff_note'),
  createdAt: ts('created_at').notNull().defaultNow(),
  decidedAt: ts('decided_at'),
}, (t) => [
  uniqueIndex('appeals_action_id_key').on(t.actionId),
  index('appeals_status_created_idx').on(t.status, t.createdAt),
])

/**
 * Attachments pulled out of circulation (by staff, or automatically on a csam report). Independent of messages, so
 * the author deleting the message cannot destroy the evidence. Bytes move to `evidence/<attachmentId>` (never served).
 */
export const quarantinedFiles = pgTable('quarantined_files', {
  id: uuid('id').primaryKey(),
  attachmentId: uuid('attachment_id').notNull(),
  messageId: uuid('message_id').notNull(),
  channelId: uuid('channel_id').notNull(),
  authorId: uuid('author_id').notNull(),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  /** Kept to restore the attachment as it was (POST /admin/quarantine/:id/release). */
  width: integer('width'),
  height: integer('height'),
  sha256: text('sha256'),
  originalKey: text('original_key').notNull(),
  evidenceKey: text('evidence_key').notNull(),
  evidenceStoredAt: ts('evidence_stored_at'),
  copyError: text('copy_error'),
  reportId: uuid('report_id'),
  staffId: uuid('staff_id'),
  note: text('note').notNull().default(''),
  authorityProtocol: text('authority_protocol'),
  receiptConfirmedAt: ts('receipt_confirmed_at'),
  purgedAt: ts('purged_at'),
  /** False positive: restored to the message (under a new attachment id) and the evidence copy deleted. */
  releasedAt: ts('released_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('quarantined_files_attachment_id_key').on(t.attachmentId)])

/** POST /users/@me/export jobs. The zip lives at storage_key until expires_at. */
export const dataExports = pgTable('data_exports', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['pending', 'building', 'ready', 'failed', 'expired'] }).notNull().default('pending'),
  storageKey: text('storage_key'),
  error: text('error'),
  createdAt: ts('created_at').notNull().defaultNow(),
  startedAt: ts('started_at'),
  readyAt: ts('ready_at'),
  expiresAt: ts('expires_at'),
}, (t) => [index('data_exports_user_id_created_idx').on(t.userId, t.createdAt), index('data_exports_status_idx').on(t.status)])

/**
 * Purged accounts, kept 6 months alongside the access logs so a court order naming the account can still be answered.
 * The e-mail is kept only as a SHA-256 (a given address can be matched, not read back).
 */
export const deletedAccounts = pgTable('deleted_accounts', {
  userId: uuid('user_id').primaryKey(),
  username: text('username').notNull(),
  emailSha256: text('email_sha256').notNull(),
  deletedAt: ts('deleted_at').notNull().defaultNow(),
}, (t) => [index('deleted_accounts_username_idx').on(t.username)])

/** Every staff API call; staff role grants from the CLI have staff_id null. */
export const staffAuditLog = pgTable('staff_audit_log', {
  id: uuid('id').primaryKey(),
  staffId: uuid('staff_id'),
  method: text('method').notNull(),
  route: text('route').notNull(),
  params: jsonb('params'),
  query: jsonb('query'),
  body: jsonb('body'),
  status: integer('status'),
  at: ts('at').notNull().defaultNow(),
}, (t) => [index('staff_audit_log_at_idx').on(t.at)])

export type ReportRow = typeof reports.$inferSelect
export type AccountActionRow = typeof accountActions.$inferSelect
export type AppealRow = typeof appeals.$inferSelect
export type QuarantinedFileRow = typeof quarantinedFiles.$inferSelect
export type DataExportRow = typeof dataExports.$inferSelect

// ---- observability (src/telemetry.ts) ------------------------------------------------------------------------------

/**
 * Opt-in call-quality aggregates (CallQualityReport). No FK, no IP, no room, no time of day (only `day`), random v4
 * ids (a UUIDv7 would carry the time); `user_hash` is an HMAC whose salt rotates daily and is never stored. Purged
 * after CALL_QUALITY_RETENTION_DAYS by Telemetry.sweep.
 */
export const callQualityReports = pgTable('call_quality_reports', {
  id: uuid('id').primaryKey(),
  day: date('day', { mode: 'string' }).notNull(),
  userHash: text('user_hash').notNull(),
  sessionDurationS: integer('session_duration_s').notNull(),
  joinMs: integer('join_ms'),
  reconnects: integer('reconnects').notNull(),
  reconnectFailed: boolean('reconnect_failed').notNull(),
  rttAvgMs: real('rtt_avg_ms'),
  rttP95Ms: real('rtt_p95_ms'),
  jitterMs: real('jitter_ms'),
  packetLossPct: real('packet_loss_pct'),
  concealmentPct: real('concealment_pct'),
  audioCodec: text('audio_codec'),
  videoCodec: text('video_codec'),
  encoderHardware: boolean('encoder_hardware'),
  streamFps: text('stream_fps'),
  streamResolution: text('stream_resolution'),
  os: text('os').notNull(),
  osVersion: text('os_version').notNull(),
  appVersion: text('app_version').notNull(),
  cpuVendor: text('cpu_vendor').notNull(),
  gpuVendor: text('gpu_vendor').notNull(),
}, (t) => [index('call_quality_reports_day_idx').on(t.day)])
