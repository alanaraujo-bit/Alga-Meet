import {
  ACCOUNT_ACTION_REASONS, FEEDBACK_KINDS, REPORT_REASONS, WORLD_ROOM_ACCESS, WORLD_SHELL_IDS,
  type EcoSpec, type EquippedCosmetics, type FeedbackContext, type ReleaseContent, type WorldAvatar, type WorldPlacedItem, type WorldRoomFinish,
} from '@alga/shared'
import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn, boolean, date, foreignKey, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid,
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
  /** The Eco (mascot avatar) this person picked; null = the automatic one derived from the id (client-side). */
  eco: jsonb('eco').$type<EcoSpec>(),
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
  /**
   * Cache written only by Billing.recompute: while a paid Plus is active, now − (months of Plus summed so far), so
   * PublicUser.plusBadge needs no query; null without a paid Plus.
   */
  plusSince: ts('plus_since'),
  /** Wishlist shown to friends; null = the default for the age bracket (on for 18+, off for 16–17). */
  wishlistVisible: boolean('wishlist_visible'),
  /**
   * The 3D figure of Alga Worlds (PublicUser.world); null = the automatic one, derived client-side. Paid parts are
   * held SKUs only (PUT /worlds/avatar checks; Billing.recompute puts the free part back when one lapses).
   */
  worldAvatar: jsonb('world_avatar').$type<WorldAvatar>(),
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
  /** Validated X-Alga-Client header ("<app version>; <os>"), refreshed when the session is used; null if never sent. */
  clientInfo: text('client_info'),
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
  /** Space.e2ee: calls in its voice channels are end-to-end encrypted (opt-in, rollout phase 5a). */
  e2ee: boolean('e2ee').notNull().default(false),
  /** Casa (Space.upgrade): end of the paid days, rebuilt by Billing from space_upgrade_contributions; null = never had one. */
  upgradeEndsAt: ts('upgrade_ends_at'),
  upgradeTone: text('upgrade_tone'),
  /** Code of the vanity invite (an `invites` row expiring with the Casa). */
  upgradeInviteCode: text('upgrade_invite_code'),
}, (t) => [
  index('spaces_owner_id_idx').on(t.ownerId),
  uniqueIndex('spaces_upgrade_invite_code_key').on(t.upgradeInviteCode),
  index('spaces_upgrade_ends_at_idx').on(t.upgradeEndsAt),
])

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
  /** The client's send id: a retried send (response lost, reconnect) returns the saved message instead of a copy. */
  nonce: text('nonce'),
}, (t) => [
  index('messages_channel_id_id_idx').on(t.channelId, t.id),
  uniqueIndex('messages_channel_author_nonce_uq').on(t.channelId, t.authorId, t.nonce),
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

/** Soundboard sounds of a space (WAV PCM16 mono 48 kHz, ≤ 5 s). A trigger queues the object when a row is deleted. */
export const spaceSounds = pgTable('space_sounds', {
  id: uuid('id').primaryKey(),
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  emoji: text('emoji'),
  storageKey: text('storage_key').notNull(),
  durationMs: integer('duration_ms').notNull(),
  /** Normalization gain the editor baked into the WAV (record only; players do not apply it). */
  gainDb: real('gain_db').notNull().default(0),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [index('space_sounds_space_id_idx').on(t.spaceId)])

export type SpaceSoundRow = typeof spaceSounds.$inferSelect

// ---- billing (src/billing/) ---------------------------------------------------------------------------------------

/** Mirror of src/billing/catalog.ts, upserted at startup. Rows are never deleted (orders reference them): dropped SKUs go inactive. */
export const products = pgTable('products', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['plan', 'cosmetic', 'bundle', 'space_upgrade'] }).notNull(),
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

const providerCol = (name: string) => text(name, { enum: ['sandbox', 'mercadopago', 'stripe'] })
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
  /** renewing = provider subscription; period = one paid period from `orderId` (Pix, gift); pass = free 7-day pass from `grantedBy`. */
  kind: text('kind', { enum: ['renewing', 'period', 'pass'] }).notNull().default('renewing'),
  orderId: uuid('order_id').references((): AnyPgColumn => orders.id),
  grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  /** Start of the paid time (first activation; a period stacked after another starts later). */
  startedAt: ts('started_at'),
  /** First charge's payment at the provider (what a 7-day refund refunds). */
  providerPaymentId: text('provider_payment_id'),
  refundRequestedAt: ts('refund_requested_at'),
}, (t) => [
  index('subscriptions_user_id_idx').on(t.userId),
  index('subscriptions_order_id_idx').on(t.orderId),
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
  /** Cosmetic SKUs this order grants (a bundle: the ones missing at checkout); [] for plan periods and Casa. */
  items: jsonb('items').$type<string[]>().notNull().default([]),
  /** The annual Plus item: claimed under this subscription (amount 0, revoked if the subscription is refunded). */
  subscriptionId: uuid('subscription_id').references((): AnyPgColumn => subscriptions.id),
  paidAt: ts('paid_at'),
  refundRequestedAt: ts('refund_requested_at'),
}, (t) => [
  index('orders_subscription_id_idx').on(t.subscriptionId),
  index('orders_user_id_idx').on(t.userId),
  index('orders_status_created_idx').on(t.status, t.createdAt),
  uniqueIndex('orders_provider_ref_key').on(t.provider, t.providerPaymentId),
])

/** What each user can use now, rebuilt by Billing.recompute from subscriptions + paid orders. Never written elsewhere. */
export const entitlements = pgTable('entitlements', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sku: text('sku').notNull(),
  kind: text('kind', { enum: ['plan', 'cosmetic'] }).notNull(),
  source: text('source', { enum: ['subscription', 'order', 'grant'] }).notNull(),
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

/** Gifts (growth-plan §2.4). A Plus pass has no order. Sender/recipient go null when that account is purged. */
export const gifts = pgTable('gifts', {
  id: uuid('id').primaryKey(),
  orderId: uuid('order_id').references(() => orders.id),
  productId: text('product_id').notNull().references(() => products.id),
  senderId: uuid('sender_id').references(() => users.id, { onDelete: 'set null' }),
  recipientId: uuid('recipient_id').references(() => users.id, { onDelete: 'set null' }),
  message: text('message'),
  deliverAt: ts('deliver_at'),
  deliveredAt: ts('delivered_at'),
  status: text('status', { enum: ['unpaid', 'scheduled', 'delivered', 'accepted', 'declined', 'refunded', 'canceled'] }).notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('gifts_order_id_key').on(t.orderId),
  index('gifts_sender_id_idx').on(t.senderId),
  index('gifts_recipient_id_idx').on(t.recipientId),
  index('gifts_status_deliver_at_idx').on(t.status, t.deliverAt),
])

export const wishlists = pgTable('wishlists', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => products.id),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.productId] })])

/** One per Casa contribution order; the order's status says whether its days count. */
export const spaceUpgradeContributions = pgTable('space_upgrade_contributions', {
  orderId: uuid('order_id').primaryKey().references(() => orders.id),
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  // set null: the days stay with the space when the contributor's account is purged.
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  days: integer('days').notNull(),
  /** Appears on the Mural da Casa (name only, never the amount). */
  showOnWall: boolean('show_on_wall').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('space_upgrade_contributions_space_id_idx').on(t.spaceId)])

export type SubscriptionRow = typeof subscriptions.$inferSelect
export type OrderRow = typeof orders.$inferSelect
export type EntitlementRow = typeof entitlements.$inferSelect
export type GiftRow = typeof gifts.$inferSelect

// ---- trust & safety, privacy (src/trust-safety.ts, src/privacy.ts) -------------------------------------------------

/**
 * Every acceptance of the legal bundle, and every opt-in consent (LGPD art. 8: proof of what was accepted and when).
 * purpose 'terms': `terms_version` is the legal bundle. 'activity_email': `terms_version` is the consent text version
 * (src/activity/email.ts) and `withdrawn_at` is set when it is turned off (a new row for each new opt-in).
 */
export const consentRecords = pgTable('consent_records', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  termsVersion: text('terms_version').notNull(),
  acceptedAt: ts('accepted_at').notNull().defaultNow(),
  purpose: text('purpose', { enum: ['terms', 'activity_email'] }).notNull().default('terms'),
  withdrawnAt: ts('withdrawn_at'),
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

// ---- E2EE Delivery Service (src/e2ee.ts; docs/decisions/0004-e2ee.md) ---------------------------------------------
// Public keys only: no MLS group secret, private key or media key ever reaches the server.

/**
 * A client device's MLS identity. Bound to the user and to the session that registered it (one device per session):
 * deleting the session (logout, revoke, password change, suspension) deletes the device and its key packages.
 */
export const deviceKeys = pgTable('device_keys', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id').notNull(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  /** Raw Ed25519 public key, base64: the leaf signature key of the device's key packages and MLS leaves. */
  signatureKey: text('signature_key').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.deviceId] }),
  uniqueIndex('device_keys_session_id_key').on(t.sessionId),
])

/** Single-use MLS key packages (public data), claimed with DELETE … FOR UPDATE SKIP LOCKED so no two joins share one. */
export const keyPackages = pgTable('key_packages', {
  /** KeyPackageRef (RFC 9420 §5.2), hex: what a Welcome names its recipient by. */
  ref: text('ref').primaryKey(),
  userId: uuid('user_id').notNull(),
  deviceId: uuid('device_id').notNull(),
  /** MLSMessage(KeyPackage), base64. */
  keyPackage: text('key_package').notNull(),
  notAfter: ts('not_after').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.userId, t.deviceId], foreignColumns: [deviceKeys.userId, deviceKeys.deviceId] }).onDelete('cascade'),
  index('key_packages_device_idx').on(t.userId, t.deviceId, t.createdAt),
])

export type DeviceKeyRow = typeof deviceKeys.$inferSelect

// ---- retention (src/events/, src/activity/; docs/retention/server.md) ----------------------------------------------

/** Space events (EventView). A weekly one repeats at the wall time of starts_local (America/Sao_Paulo). */
export const events = pgTable('events', {
  id: uuid('id').primaryKey(),
  spaceId: uuid('space_id').notNull().references(() => spaces.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
  creatorId: uuid('creator_id').references(() => users.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  template: text('template', { enum: ['game_night', 'sunday_cinema', 'study'] }),
  /** 'YYYY-MM-DDTHH:MM' wall time of the first occurrence. */
  startsLocal: text('starts_local').notNull(),
  /** The first occurrence as an instant (derived from starts_local). */
  startsAt: ts('starts_at').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  weekly: boolean('weekly').notNull().default(false),
  /** Kept when the Casa ends; shown only while it is lit. */
  cover: text('cover', { enum: ['hora_azul', 'game', 'cinema', 'study'] }),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [index('events_space_id_idx').on(t.spaceId), index('events_starts_at_idx').on(t.startsAt)])

/** One answer per member per event, for every occurrence. */
export const eventRsvps = pgTable('event_rsvps', {
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['going', 'maybe', 'not_going'] }).notNull(),
  /** Asked for the 2 h e-mail on this event. */
  emailReminder: boolean('email_reminder').notNull().default(false),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.eventId, t.userId] }), index('event_rsvps_user_id_idx').on(t.userId)])

/** Sent reminders. The primary key is the claim: whoever inserts the row sends, so each goes out once per occurrence. */
export const eventReminders = pgTable('event_reminders', {
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  occurrenceAt: ts('occurrence_at').notNull(),
  kind: text('kind', { enum: ['app', 'email'] }).notNull(),
  sentAt: ts('sent_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.eventId, t.occurrenceAt, t.kind] }), index('event_reminders_sent_at_idx').on(t.sentAt)])

/**
 * Raw voice sessions from the LiveKit webhooks (D7), written when the session ends. Kept 35 days. No FK on channel or
 * space: a deleted channel's time still counts in the recap of the people who were there.
 */
export const voiceSessions = pgTable('voice_sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').notNull(),
  /** null = a DM / group DM call. */
  spaceId: uuid('space_id'),
  joinedAt: ts('joined_at').notNull(),
  leftAt: ts('left_at').notNull(),
}, (t) => [
  index('voice_sessions_joined_at_idx').on(t.joinedAt),
  index('voice_sessions_user_left_idx').on(t.userId, t.leftAt),
  index('voice_sessions_channel_idx').on(t.channelId, t.joinedAt),
])

/** Per user and BRT day: bits of ACTIVITY_FLAGS (src/activity/activity.ts). Kept 90 days; never kept for metrics opt-outs. */
export const activityDays = pgTable('activity_days', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: date('day', { mode: 'string' }).notNull(),
  flags: integer('flags').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.userId, t.day] }), index('activity_days_day_idx').on(t.day)])

/** Nightly product metrics, no ids. value null = hidden (fewer than 10 people). */
export const metricDaily = pgTable('metric_daily', {
  day: date('day', { mode: 'string' }).notNull(),
  metric: text('metric').notNull(),
  value: integer('value'),
}, (t) => [primaryKey({ columns: [t.day, t.metric] })])

/** Retention by signup day (BRT): cohort size and users counted per metric (d1, d7, d30, activated_24h); null = hidden. */
export const metricCohorts = pgTable('metric_cohorts', {
  cohortDay: date('cohort_day', { mode: 'string' }).notNull(),
  metric: text('metric').notNull(),
  size: integer('size'),
  value: integer('value'),
}, (t) => [primaryKey({ columns: [t.cohortDay, t.metric] })])

/** Weekly voice minutes per user and channel (week = its Monday, BRT), the recap's source. Kept 12 weeks. */
export const voiceWeekly = pgTable('voice_weekly', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  week: date('week', { mode: 'string' }).notNull(),
  channelId: uuid('channel_id').notNull(),
  spaceId: uuid('space_id'),
  minutes: integer('minutes').notNull(),
  /** Days with 30+ minutes in this channel. */
  nights: integer('nights').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.week, t.channelId] }), index('voice_weekly_week_idx').on(t.week)])

export interface StoredRecap {
  voiceMinutes: number
  nights: number
  topChannel?: { channelId: string; spaceId: string }
  events: { eventId: string; spaceId: string; title: string; startsAt: string }[]
  /** Who you were with the most, best first (up to 10; the 3 shown are picked at read time). Copresence lives only here. */
  people: string[]
}

/** The weekly recap as computed Monday 10:00 BRT. Kept 12 weeks. */
export const weeklyRecaps = pgTable('weekly_recaps', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  week: date('week', { mode: 'string' }).notNull(),
  data: jsonb('data').$type<StoredRecap>().notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.week] }), index('weekly_recaps_week_idx').on(t.week)])

/** "Semanas juntos" per space (WeeksTogether). No row = on, 0 weeks. */
export const spaceStreaks = pgTable('space_streaks', {
  spaceId: uuid('space_id').primaryKey().references(() => spaces.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(true),
  weeks: integer('weeks').notNull().default(0),
  /** Counted weeks since the last automatic pause (or the start); a pause needs WEEKS_TOGETHER_PAUSE_EVERY of them. */
  sincePause: integer('since_pause').notNull().default(0),
  lastWeek: date('last_week', { mode: 'string' }),
})

/** ActivitySettings, plus what the activity e-mail needs. No row = the defaults. */
export const activitySettings = pgTable('activity_settings', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  showInOthersRecap: boolean('show_in_others_recap').notNull().default(true),
  metricsOptOut: boolean('metrics_opt_out').notNull().default(false),
  /** Mirror of the open activity_email consent_records row. */
  activityEmail: boolean('activity_email').notNull().default(false),
  /** First authenticated use of the day (BRT): "inactive for 7+ days" and "until you come back". */
  lastSeenAt: ts('last_seen_at'),
  /** Activity e-mails since lastSeenAt: at ACTIVITY_EMAIL_MAX_IN_60_DAYS they stop until the user is back. */
  emailsSinceSeen: integer('emails_since_seen').notNull().default(0),
})

/** Activity e-mails sent (the 7-day gap and the 60-day cap). Kept 60 days. */
export const activityEmails = pgTable('activity_emails', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  reason: text('reason', { enum: ['event', 'friend_call'] }).notNull(),
  sentAt: ts('sent_at').notNull().defaultNow(),
}, (t) => [index('activity_emails_user_sent_idx').on(t.userId, t.sentAt)])

/** "Avisar" choices for the "entrou na voz" notice (VoiceNotifyScope.notify); no row = automatic. */
export const voiceNotifyPrefs = pgTable('voice_notify_prefs', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  scopeId: uuid('scope_id').notNull(),
  kind: text('kind', { enum: ['space', 'dm'] }).notNull(),
  notify: boolean('notify').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.scopeId] })])

/** Claims of the periodic jobs (one row per job and period): a period runs once, across restarts and workers. */
export const jobRuns = pgTable('job_runs', {
  job: text('job').notNull(),
  period: text('period').notNull(),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
}, (t) => [primaryKey({ columns: [t.job, t.period] })])

export type EventRow = typeof events.$inferSelect

/** "Por que está saindo?" from the uninstall window: anonymous by design (no user, no IP), kept 6 months. */
export const uninstallFeedback = pgTable('uninstall_feedback', {
  id: uuid('id').primaryKey(),
  reason: text('reason').notNull(),
  note: text('note'),
  appVersion: text('app_version'),
  createdAt: ts('created_at').notNull().defaultNow(),
})

/**
 * App feedback ("Conta pro Eco", packages/shared/src/feedback.ts): what a person told the team from the desktop app.
 * Private to the sender and the team; read by a future admin panel. Goes away with the account.
 */
export const feedback = pgTable('feedback', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: FEEDBACK_KINDS }).notNull(),
  text: text('text').notNull(),
  /** algaClientHeader of the request: "<app version>; <os>", null when the header was absent or invalid. */
  client: text('client'),
  context: jsonb('context').$type<FeedbackContext>().notNull(),
  /** End of the app's main.log, only for bug/crash and only when the person left it on. */
  log: text('log'),
  /** Screenshot object (feedback/<userId>/<id>.webp), null when none. The delete trigger queues it (0019). */
  storageKey: text('storage_key'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('feedback_user_created_idx').on(t.userId, t.createdAt)])
export type FeedbackRow = typeof feedback.$inferSelect

// ---- Alga Worlds (src/worlds.ts; packages/shared/src/worlds.ts) -----------------------------------------------------

/**
 * The personal room of an account, as its owner saved it (created from STARTER_ROOM on first need). Pieces the owner
 * stops holding stay here and are left out when the room is shown, so buying them again brings them back.
 */
export const worldRooms = pgTable('world_rooms', {
  ownerId: uuid('owner_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  access: text('access', { enum: WORLD_ROOM_ACCESS }).notNull().default('call'),
  shell: text('shell', { enum: WORLD_SHELL_IDS }).notNull().default('loft'),
  finish: jsonb('finish').$type<WorldRoomFinish>().notNull(),
  items: jsonb('items').$type<WorldPlacedItem[]>().notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})
export type WorldRoomRow = typeof worldRooms.$inferSelect

// ---- Novidades (release notes; packages/shared/src/releases.ts) -----------------------------------------------------

/** One note per app version. Only `published` ones reach people, and the client never shows a version above its own. */
export const releaseNotes = pgTable('release_notes', {
  version: text('version').primaryKey(),
  status: text('status', { enum: ['draft', 'published'] }).notNull().default('draft'),
  content: jsonb('content').$type<ReleaseContent>().notNull(),
  revision: integer('revision').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  /** Staff account of the last save (null after that account is deleted). */
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  /** First publication; kept when unpublished and published again. */
  publishedAt: ts('published_at'),
})
export type ReleaseNoteRow = typeof releaseNotes.$inferSelect

/** 👍/👎 per person per item: the primary key is what makes a second vote an edit, never a duplicate. */
export const releaseReactions = pgTable('release_reactions', {
  version: text('version').notNull().references(() => releaseNotes.version, { onDelete: 'cascade', onUpdate: 'cascade' }),
  itemId: text('item_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  value: integer('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.version, t.itemId, t.userId] }), index('release_reactions_user_idx').on(t.userId)])
