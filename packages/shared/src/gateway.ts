import type {
  Channel, Invite, Me, Member, Message, Presence, PublicUser, ReadState, Relationship,
  Role, Space, SpaceSnapshot, StatusPreference, VoiceDisconnectReason, VoiceState,
} from './models.js'
import type { Activity, CustomStatus } from './activity.js'
import type { Entitlements, Gift, SpaceUpgradeState } from './billing.js'
import type {
  CinemaClientFrame, CinemaEndReason, CinemaErrorReason, CinemaPieceMeta, CinemaReaction, CinemaSessionView, CinemaSignal,
  CinemaSummary, CinemaTrackId,
} from './cinema.js'
import type { MusicClientFrame, MusicErrorReason, MusicState } from './music.js'
import type { E2eeClientFrame, E2eeCommit, E2eeEpoch, E2eeProposals, E2eeResyncRequired, E2eeWelcome } from './e2ee.js'
import type { RsvpStatus, SpaceEvent } from './events.js'
import type { SpaceSound } from './soundboard.js'

/**
 * Realtime gateway: WebSocket at /gateway, JSON frames.
 * 1. Client connects and sends { op: 'identify', token } (token never goes in the URL).
 * 2. Server replies with dispatch READY (full snapshot) or closes with 4001 (bad token).
 * 3. Client sends { op: 'heartbeat' } every READY.heartbeatIntervalMs; server answers { op: 'heartbeat_ack' }.
 *    Server closes with 4002 if no heartbeat arrives for 2 intervals.
 * 4. On reconnect the client identifies again and receives a fresh READY (no resume yet).
 * Limits: identify within 10 s; at most 120 frames per 60 s and 10 identified sockets per user (else 4008, back off
 * before reconnecting). `presence` / `voice_state` fan out at most once per second per user: frames sent faster
 * collapse into the latest value, so always send the full current state. A client that stops reading is dropped.
 * E2EE (e2ee.ts, docs/decisions/0004-e2ee.md): `e2ee_*` ops and `E2EE_*` dispatches carry the MLS handshake of a call
 * (base64 MLSMessage bytes; the server is the Delivery Service and never sees a group secret). They are bound to the
 * device named in `e2ee_join` (registered with POST /e2ee/devices by this session) and go only to that device's
 * sockets. Own quota: E2EE_FRAME_LIMIT frames per 60 s per socket, apart from the 120 above; up to E2EE_MAX_FRAME_BYTES
 * per frame (other ops: 16 KiB). Invalid e2ee frames close with 4003 like any other.
 * Cinema (cinema.ts, docs/superpowers/specs/2026-11-05-sala-de-cinema-design.md §6.2): `cinema_*` ops and `CINEMA_*`
 * dispatches run a synchronized watch party inside a voice call. One session per channel, at most CINEMA_MAX_SEATS
 * seats; only users connected to the call may use them (else CINEMA_ERROR `not_in_call`). The host's `cinema_open`
 * creates the session and `cinema_pieces` indexes the pieces it can serve (hash + size only, never media bytes);
 * peers fetch pieces over their own RTCPeerConnections, negotiated with `cinema_signal` (relayed as CINEMA_SIGNAL, the
 * server never reads it). Playback is a server-owned clock: `cinema_control` carries the client's last `seq` and is
 * refused as `stale` when behind; accepted commands are stamped CINEMA_LEAD_MS ahead and fan out in CINEMA_STATE.
 * `cinema_time` / CINEMA_PONG sample the clock offset. Own quota: CINEMA_FRAME_LIMIT frames per 60 s per socket, apart
 * from the 120 above; reactions are rate limited (CINEMA_REACTION_RATE). Invalid cinema frames close with 4003.
 */

export const GatewayClose = {
  AUTH_FAILED: 4001,
  HEARTBEAT_TIMEOUT: 4002,
  INVALID_PAYLOAD: 4003,
  SESSION_REVOKED: 4004,
  /** The account was suspended or banned: do not reconnect; log in again to see the reason and appeal. */
  ACCOUNT_RESTRICTED: 4010,
  /** Too many frames or too many sockets for this user. */
  RATE_LIMITED: 4008,
} as const

export type ClientFrame =
  | { op: 'identify'; token: string }
  | { op: 'heartbeat' }
  /** Update own presence preference without a REST call. */
  | { op: 'presence'; status: StatusPreference }
  /**
   * Own rich presence (activity.ts), full current value or null. Throttled like `presence`; cleared when the socket
   * that set it closes. Send it again after every READY.
   */
  | { op: 'activity'; activity: Activity | null }
  /** Own custom status (activity.ts), or null to clear. Same rules as `activity`, but kept until the last socket closes. */
  | { op: 'custom_status'; status: CustomStatus | null }
  /** Self voice flags while connected to a voice channel. Ignored if not in voice. */
  | { op: 'voice_state'; selfMute: boolean; selfDeaf: boolean; streaming: boolean; video: boolean }
  /**
   * MLS of a call (e2ee.ts): `e2ee_join` (join intent / re-announce with the local epoch), `e2ee_group_info` (creator,
   * epoch 0), `e2ee_commit`, `e2ee_welcome_ack`, `e2ee_resync`. The server answers with E2EE_* dispatches only.
   */
  | E2eeClientFrame
  /**
   * Cinema (cinema.ts): `cinema_time`, `cinema_hello`, `cinema_open` (host), `cinema_pieces` (host), `cinema_film`
   * (host: rename / add subtitle), `cinema_seat`, `cinema_status`, `cinema_control`, `cinema_options` (host),
   * `cinema_signal`, `cinema_react`, `cinema_chat` (live chat), `cinema_end` (host or moderator), `cinema_switch` (host: next episode in the same
   * session, keeps the seats, resets pieces/reactions/heat and rebuffers at `startS`). The server answers with CINEMA_* dispatches only.
   */
  | CinemaClientFrame
  /** Music in a call (music.ts): `music_hello`, `music_add`, `music_control`, `music_remove`, `music_report`. */
  | MusicClientFrame

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
  /** The server has the Sala de Cinema on. Absent on older servers, which close the socket on cinema ops. */
  cinema: boolean
  /** The server plays music in calls. Absent on older servers, which close the socket on music ops. */
  music?: boolean
}

export type Dispatch =
  | { t: 'READY'; d: ReadyPayload }
  /** Profile changes. To your voice channel it may carry `tryOn` (POST /billing/try-on); the next one without it ends it. */
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
  /** Created/edited role, or a role whose position changed (one event per role). */
  | { t: 'ROLE_UPSERT'; d: Role }
  /** Clients also drop `id` from every member's roleIds. */
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
  /**
   * Sent only to the affected user: the server removed them from the LiveKit room of `channelId` (channel full,
   * disconnected by a moderator, access lost). Client: leave the room, do not auto-rejoin, show `reason`.
   */
  | { t: 'VOICE_DISCONNECT'; d: { channelId: string; reason: VoiceDisconnectReason } }
  /**
   * Sent only to the moved user: a moderator moved them to voice channel `channelId` (same space). The server has
   * already dropped them from the current room (VOICE_STATE_REMOVE follows). Client: treat the LiveKit disconnect as
   * expected, call POST /voice/join with this channelId (allowed even if it is full, for 60 s) and re-send the
   * voice_state op with the current self flags.
   */
  | { t: 'VOICE_MOVE'; d: { channelId: string } }
  /**
   * Only to the users in voice in `channelId`: the call's E2EE flag (VoiceJoinResponse.e2ee) is now `e2ee` (Space.e2ee
   * changed; SPACE_UPDATE goes to the whole space). Nobody is removed and media keeps its old mode until each client
   * rejoins: POST /voice/join (new token and flag), reconnect to LiveKit, e2ee_join only when true. Also sent right
   * after a LiveKit join whose token predates the change.
   */
  | { t: 'VOICE_E2EE_CHANGED'; d: { channelId: string; e2ee: boolean } }
  /** To every member of the space: its sound list changed (upload, rename, delete). The full list, newest last. */
  | { t: 'SPACE_SOUNDS_UPDATE'; d: { spaceId: string; sounds: SpaceSound[] } }
  /**
   * Only to the users in voice in `channelId`: `userId` played `soundId` (a space sound id or `alga:<slug>`). Play it
   * locally unless deafened or the soundboard is muted; always show who played it.
   */
  | { t: 'SOUNDBOARD_PLAY'; d: { channelId: string; soundId: string; userId: string; playId: string; durationMs: number } }
  /**
   * Sent only to the user: their plan or owned/included cosmetics changed (purchase confirmed by the provider, renewal,
   * a cancellation reaching its end, expiry, refund). ME_UPDATE with the new Me.plan follows when the plan changed.
   */
  | { t: 'ENTITLEMENTS_UPDATE'; d: Entitlements }
  /**
   * Only to the recipient, when a gift (or a Plus pass) is delivered: show it with "Abrir" / "Recusar". Nothing is
   * usable until POST /billing/gifts/:id/accept.
   */
  | { t: 'GIFT_RECEIVED'; d: Gift }
  /**
   * A gift changed after delivery (accepted, declined, refunded by the payer = revoked from the recipient) or, for
   * the sender, at payment/scheduling/delivery. Sent to whichever of sender and recipient may see it (Gift.status).
   */
  | { t: 'GIFT_UPDATE'; d: Gift }
  /**
   * To the space's members: its Casa changed (a contribution paid or refunded, tone or vanity invite changed, it
   * ended). Replace Space.upgrade with `upgrade`.
   */
  | { t: 'SPACE_UPGRADE_UPDATE'; d: { spaceId: string; upgrade: SpaceUpgradeState | null } }
  /** New invite. Sent to members with MANAGE_SPACE and to its creator (the people GET /spaces/:id/invites shows it to). */
  | { t: 'INVITE_CREATE'; d: Invite }
  /**
   * Invite revoked (DELETE /invites/:code) or removed with its creator (leave/kick/ban). Same audience as
   * INVITE_CREATE. Invites that expire or run out of uses are not announced: drop them by expiresAt/maxUses.
   */
  | { t: 'INVITE_DELETE'; d: { code: string; spaceId: string } }
  /**
   * Space events (events.ts). CREATE/UPDATE/DELETE go to the space's members who can view channels; the payload is the
   * same for all (no caller fields: keep your own EventView.myRsvp / emailReminder from REST and EVENT_RSVP_UPDATE).
   * Counts and `next` are as of sending; recompute `next` locally with currentOccurrence() as time passes. Not in READY:
   * fetch GET /events after it.
   */
  | { t: 'EVENT_CREATE'; d: SpaceEvent }
  | { t: 'EVENT_UPDATE'; d: SpaceEvent }
  | { t: 'EVENT_DELETE'; d: { id: string; spaceId: string } }
  /**
   * Someone's answer changed; status null = removed (DELETE /events/:id/rsvp). Same audience, except that 'not_going'
   * reaches only its author (the others get null, like no answer). A member leaving the space drops out of the counts
   * silently (the next EVENT_UPDATE / fetch has them).
   */
  | { t: 'EVENT_RSVP_UPDATE'; d: { eventId: string; spaceId: string; userId: string; status: RsvpStatus | null; going: number; maybe: number } }
  /**
   * Only to members who answered going/maybe, EVENT_REMINDER_MINUTES before an occurrence, once per occurrence (sent at
   * most once even across restarts; offline = missed, the event card still shows it). The desktop shows the notice.
   */
  | { t: 'EVENT_REMINDER'; d: { eventId: string; spaceId: string; channelId: string | null; title: string; startsAt: string } }
  /**
   * Monday 10:00 (EVENT_TIME_ZONE), to adults online with a recap for `week` (GET /users/@me/recap). 16–17 never get
   * it: they see the card when they open the app. Nothing else in the retention package ever dispatches a notice.
   */
  | { t: 'WEEKLY_RECAP_READY'; d: { week: string } }
  /** E2EE (e2ee.ts): only to member devices of the call's MLS group at `epoch` (the bound sockets of those devices). */
  | { t: 'E2EE_PROPOSALS'; d: E2eeProposals }
  | { t: 'E2EE_COMMIT'; d: E2eeCommit }
  /** Only to the added device. */
  | { t: 'E2EE_WELCOME'; d: E2eeWelcome }
  | { t: 'E2EE_EPOCH'; d: E2eeEpoch }
  /** Only to the device whose frame could not be applied (see E2EE_RESYNC_REASONS for what to do). */
  | { t: 'E2EE_RESYNC_REQUIRED'; d: E2eeResyncRequired }
  /**
   * Cinema (cinema.ts), to the users in voice in the session's channel: the full session view on every change (join,
   * seat, status, playback command, options, film edit), or `ended: true` with the reason and the closing summary.
   * Also the answer to `cinema_hello` (nothing when no session exists).
   */
  | { t: 'CINEMA_STATE'; d: CinemaSessionView | { channelId: string; sessionId: string; ended: true; reason: CinemaEndReason; summary: CinemaSummary } }
  /** Piece index appended or overwritten by the host (`from` = first piece n); also replayed to a late joiner. */
  | { t: 'CINEMA_PIECES'; d: { sessionId: string; track: CinemaTrackId; from: number; items: CinemaPieceMeta[] } }
  /** Only to `to` of the matching `cinema_signal`; `from` is the sender's user id. */
  | { t: 'CINEMA_SIGNAL'; d: { sessionId: string; from: string; signal: CinemaSignal } }
  | { t: 'CINEMA_REACTION'; d: { sessionId: string; userId: string; emoji: CinemaReaction; position: number; at: number } }
  /** Live chat of the room, to every seat except those who blocked the author or were blocked by them. Not stored. */
  | { t: 'CINEMA_CHAT'; d: { sessionId: string; id: string; userId: string; text: string; at: number } }
  /** Only to the socket that sent `cinema_time`: `c` echoes its clock, `s` is the server clock (ms). */
  | { t: 'CINEMA_PONG'; d: { c: number; s: number } }
  /** Music of a call (music.ts), to everyone in it, on every change; also the answer to `music_hello`. */
  | { t: 'MUSIC_STATE'; d: MusicState }
  /** Only to the socket whose music_* frame was refused. */
  | { t: 'MUSIC_ERROR'; d: { op: string; reason: MusicErrorReason } }
  /** Only to the socket whose cinema_* frame was refused. */
  | { t: 'CINEMA_ERROR'; d: { op: string; reason: CinemaErrorReason; sessionId?: string } }

export type DispatchType = Dispatch['t']
export type DispatchOf<T extends DispatchType> = Extract<Dispatch, { t: T }>['d']

export type ServerFrame =
  | { [K in DispatchType]: { op: 'dispatch'; t: K; d: DispatchOf<K> } }[DispatchType]
  | { op: 'heartbeat_ack' }
