/** Wire models shared by server and desktop. Timestamps are ISO-8601 strings. */
import type { EquippedCosmetics, PlanSummary, PlusBadge, SpaceUpgradeState, TryOn } from './billing.js'
import type { AgeBracket, StaffRole } from './trust-safety.js'
import type { Activity, CustomStatus } from './activity.js'


export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline'
/** What the user chose; 'invisible' is broadcast to others as 'offline'. */
export type StatusPreference = 'online' | 'idle' | 'dnd' | 'invisible'

export interface PublicUser {
  id: string
  username: string
  displayName: string
  avatarUrl: string | null
  /** Profile accent color (hex, e.g. "#7c9cff") or null. */
  accentColor: string | null
  bio: string
  /**
   * Equipped cosmetics (catalog product ids, see GET /billing/catalog). Omitted when nothing is equipped; a
   * USER_UPDATE without it means everything was unequipped. Plan-included items are unequipped when the plan ends.
   * PRIVATE_COSMETIC_SLOTS (appIcon, appAccent) appear only in Me.cosmetics.
   */
  cosmetics?: EquippedCosmetics
  /**
   * Plus tenure badge (months of Plus summed over time, PLUS_BADGES), shown while the user has a paid Plus. Omitted
   * otherwise. It is not re-sent when a threshold is crossed: the next profile fetch or READY carries it.
   */
  plusBadge?: PlusBadge
  /** Only in USER_UPDATE to the user's voice channel: an item they are trying on ("provando") until expiresAt. */
  tryOn?: TryOn
}

export interface Me extends PublicUser {
  email: string
  /**
   * The user proved they read `email` (verification link or password reset); see api.ts for what needs it. Always sent
   * by the server; optional in the type only so existing `Me` literals (fixtures) keep compiling.
   */
  emailVerified?: boolean
  statusPreference: StatusPreference
  createdAt: string
  /** Current plan and its limits (stream presets, attachment cap). Always sent by the server; optional like emailVerified. */
  plan?: PlanSummary
  /** 'unknown' -> ask the birth date once (PATCH /users/@me/birth-date). Always sent by the server; optional like plan. */
  ageBracket?: AgeBracket
  /** The legal bundle changed since the user accepted it: show it and POST /users/@me/accept-terms. Always sent. */
  needsTermsAcceptance?: boolean
  /**
   * Opt-in (default false, PATCH /users/@me) to send call-quality aggregates (POST /telemetry/call-quality). Always
   * sent by the server; optional like plan.
   */
  telemetryOptIn?: boolean
  /** Trust & safety role (granted only by apps/server/scripts/grant-staff.ts): show the admin UI. Always sent; null for everyone else. */
  staffRole?: StaffRole | null
}

export interface Presence {
  userId: string
  status: PresenceStatus
  /** What they are doing right now (activity.ts). Omitted when nothing, and always while offline/invisible. */
  activity?: Activity
  /** Their custom status (activity.ts), while visible and not expired. */
  custom?: CustomStatus
}

export type RelationshipType = 'friend' | 'incoming' | 'outgoing' | 'blocked'

export interface Relationship {
  /** The other user. */
  user: PublicUser
  type: RelationshipType
  since: string
}

export type ChannelType = 'text' | 'voice' | 'dm' | 'group_dm'

export interface Channel {
  id: string
  type: ChannelType
  /** null for dm/group_dm. */
  spaceId: string | null
  name: string
  topic: string
  position: number
  /** dm/group_dm only: every participant, including the current user. */
  recipientIds?: string[]
  /** Last message id, used for unread indicators. */
  lastMessageId: string | null
  /** voice only: Opus bitrate in kbps chosen by space admins (default 64). */
  bitrateKbps?: number
  /** voice only: 0 = unlimited. */
  userLimit?: number
}

export interface Role {
  id: string
  spaceId: string
  name: string
  color: string | null
  permissions: number
  position: number
}

export interface Member {
  spaceId: string
  user: PublicUser
  nickname: string | null
  roleIds: string[]
  joinedAt: string
}

export interface Ban {
  user: PublicUser
  reason: string
  createdAt: string
}

export interface Space {
  id: string
  name: string
  iconUrl: string | null
  ownerId: string
  createdAt: string
  /**
   * Calls in this space's voice channels are end-to-end encrypted (0004 §5.1 phase 5a: opt-in, default false; PATCH
   * /spaces/:id with MANAGE_SPACE). DM calls always are. Always sent by the server; optional for older fixtures.
   */
  e2ee?: boolean
  /** The space's Casa (billing.ts SpaceUpgradeState); omitted if it never had one. Live: SPACE_UPGRADE_UPDATE. */
  upgrade?: SpaceUpgradeState
}

/** Full space snapshot as delivered in READY / SPACE_CREATE. */
export interface SpaceSnapshot extends Space {
  channels: Channel[]
  roles: Role[]
  members: Member[]
}

export interface Reaction {
  emoji: string
  count: number
  /** Whether the current user reacted. Computed per recipient. */
  me: boolean
}

export interface Attachment {
  id: string
  /** Sanitized by the server. */
  filename: string
  /** How the file is served: image/*, video/* or audio/* = render inline; application/octet-stream = download only. */
  contentType: string
  size: number
  /** Signed for the current viewer and short-lived (GET /files/:id, see api.ts): refetch messages for fresh ones. */
  url: string
  /** Images only (as displayed, EXIF rotation applied). */
  width?: number
  height?: number
}

export interface Message {
  id: string
  channelId: string
  author: PublicUser
  content: string
  createdAt: string
  editedAt: string | null
  replyToId: string | null
  reactions: Reaction[]
  attachments: Attachment[]
  /** Client-generated id echoed back so optimistic sends can be reconciled. */
  nonce?: string
}

export interface Invite {
  code: string
  space: Space
  inviterId: string
  uses: number
  maxUses: number
  expiresAt: string | null
  memberCount: number
  /** Who sent it (public profile): only on the public preview (GET /invites/:code), so a new person sees a face. */
  inviter?: PublicUser
}

export interface VoiceState {
  userId: string
  channelId: string
  /** spaceId of the channel, null for DM calls. */
  spaceId: string | null
  selfMute: boolean
  selfDeaf: boolean
  /** Server-side moderation. */
  serverMute: boolean
  serverDeaf: boolean
  streaming: boolean
  video: boolean
  joinedAt: string
}

/** Why the server removed a user from a voice room (VOICE_DISCONNECT). */
export type VoiceDisconnectReason = 'channel_full' | 'moderator' | 'access_lost'

export interface ReadState {
  channelId: string
  lastReadMessageId: string | null
  mentionCount: number
}

export interface Session {
  id: string
  userAgent: string
  createdAt: string
  lastUsedAt: string
  current: boolean
  /**
   * Coarse labels to tell sessions apart, from the X-Alga-Client header (see api.ts) or else the User-Agent; null when
   * unknown. `client` e.g. "Alga Meet 0.1.0" or "Chrome", `os` e.g. "Windows 11" (just "Windows" from a User-Agent).
   * No location on purpose: the server does no IP geolocation. Always sent by the server; optional like Me.plan.
   */
  client?: string | null
  os?: string | null
}
