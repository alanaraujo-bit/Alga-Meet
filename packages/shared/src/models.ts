/** Wire models shared by server and desktop. Timestamps are ISO-8601 strings. */

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
}

export interface Me extends PublicUser {
  email: string
  statusPreference: StatusPreference
  createdAt: string
}

export interface Presence {
  userId: string
  status: PresenceStatus
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

export interface Space {
  id: string
  name: string
  iconUrl: string | null
  ownerId: string
  createdAt: string
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
  filename: string
  contentType: string
  size: number
  url: string
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
}
