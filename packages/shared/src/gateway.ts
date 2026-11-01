import type {
  Channel, Me, Member, Message, Presence, PublicUser, ReadState, Relationship,
  Role, Space, SpaceSnapshot, StatusPreference, VoiceState,
} from './models.js'

/**
 * Realtime gateway: WebSocket at /gateway, JSON frames.
 * 1. Client connects and sends { op: 'identify', token } (token never goes in the URL).
 * 2. Server replies with dispatch READY (full snapshot) or closes with 4001 (bad token).
 * 3. Client sends { op: 'heartbeat' } every READY.heartbeatIntervalMs; server answers { op: 'heartbeat_ack' }.
 *    Server closes with 4002 if no heartbeat arrives for 2 intervals.
 * 4. On reconnect the client identifies again and receives a fresh READY (no resume yet).
 */

export const GatewayClose = {
  AUTH_FAILED: 4001,
  HEARTBEAT_TIMEOUT: 4002,
  INVALID_PAYLOAD: 4003,
  SESSION_REVOKED: 4004,
} as const

export type ClientFrame =
  | { op: 'identify'; token: string }
  | { op: 'heartbeat' }
  /** Update own presence preference without a REST call. */
  | { op: 'presence'; status: StatusPreference }
  /** Self voice flags while connected to a voice channel. Ignored if not in voice. */
  | { op: 'voice_state'; selfMute: boolean; selfDeaf: boolean; streaming: boolean; video: boolean }

export interface ReadyPayload {
  user: Me
  spaces: SpaceSnapshot[]
  /** DMs and group DMs the user is part of. */
  privateChannels: Channel[]
  relationships: Relationship[]
  /** Presences of friends and space co-members. */
  presences: Presence[]
  /** Voice states for every space the user is in, plus DM calls the user is part of. */
  voiceStates: VoiceState[]
  readStates: ReadState[]
  /** Users referenced by private channels that are not members of any shared space. */
  users: PublicUser[]
  heartbeatIntervalMs: number
}

export type Dispatch =
  | { t: 'READY'; d: ReadyPayload }
  | { t: 'USER_UPDATE'; d: PublicUser }
  | { t: 'ME_UPDATE'; d: Me }
  | { t: 'PRESENCE_UPDATE'; d: Presence }
  | { t: 'RELATIONSHIP_UPSERT'; d: Relationship }
  | { t: 'RELATIONSHIP_REMOVE'; d: { userId: string } }
  | { t: 'SPACE_CREATE'; d: SpaceSnapshot }
  | { t: 'SPACE_UPDATE'; d: Space }
  | { t: 'SPACE_DELETE'; d: { id: string } }
  | { t: 'MEMBER_ADD'; d: Member }
  | { t: 'MEMBER_UPDATE'; d: Member }
  | { t: 'MEMBER_REMOVE'; d: { spaceId: string; userId: string } }
  | { t: 'ROLE_UPSERT'; d: Role }
  | { t: 'ROLE_DELETE'; d: { spaceId: string; id: string } }
  | { t: 'CHANNEL_CREATE'; d: Channel }
  | { t: 'CHANNEL_UPDATE'; d: Channel }
  | { t: 'CHANNEL_DELETE'; d: { id: string; spaceId: string | null } }
  | { t: 'MESSAGE_CREATE'; d: Message }
  | { t: 'MESSAGE_UPDATE'; d: Message }
  | { t: 'MESSAGE_DELETE'; d: { id: string; channelId: string } }
  | { t: 'REACTION_ADD'; d: { messageId: string; channelId: string; userId: string; emoji: string } }
  | { t: 'REACTION_REMOVE'; d: { messageId: string; channelId: string; userId: string; emoji: string } }
  | { t: 'TYPING_START'; d: { channelId: string; userId: string; at: string } }
  | { t: 'READ_STATE_UPDATE'; d: ReadState }
  | { t: 'VOICE_STATE_UPDATE'; d: VoiceState }
  | { t: 'VOICE_STATE_REMOVE'; d: { userId: string; channelId: string } }
  /** Incoming DM call. */
  | { t: 'CALL_RING'; d: { channelId: string; fromUserId: string } }

export type DispatchType = Dispatch['t']
export type DispatchOf<T extends DispatchType> = Extract<Dispatch, { t: T }>['d']

export type ServerFrame =
  | { [K in DispatchType]: { op: 'dispatch'; t: K; d: DispatchOf<K> } }[DispatchType]
  | { op: 'heartbeat_ack' }
