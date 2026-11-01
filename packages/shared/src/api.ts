import { z } from 'zod'
import type { Me } from './models.js'
import { ALL_PERMISSIONS } from './permissions.js'

/**
 * REST contract. All routes are prefixed with /api/v1 and use JSON.
 * Auth: `Authorization: Bearer <session token>` (opaque; the server stores only its SHA-256 hash).
 * Errors: { error: { code: ApiErrorCode, message: string, fields?: Record<string,string> } }
 *
 * POST   /auth/register            RegisterBody          -> AuthResponse
 * POST   /auth/login               LoginBody             -> AuthResponse
 * POST   /auth/logout                                    -> 204
 * POST   /auth/password            ChangePasswordBody    -> 204 (revokes every other session)
 * GET    /auth/sessions                                  -> Session[]
 * DELETE /auth/sessions                                  -> 204 (revoke all except the current one)
 * DELETE /auth/sessions/:id                              -> 204
 *   Sessions expire after 30 days without use or 90 days after login (then 401).
 * GET    /users/@me                                      -> Me
 * PATCH  /users/@me                PatchMeBody           -> Me
 * GET    /users/:id                                      -> PublicUser
 * GET    /relationships                                  -> Relationship[]
 * POST   /relationships            FriendRequestBody     -> Relationship   (send request by username)
 * PUT    /relationships/:userId    PutRelationshipBody   -> Relationship   (accept / block)
 * DELETE /relationships/:userId                          -> 204            (remove/decline/cancel/unblock)
 * POST   /users/@me/channels       OpenDmBody            -> Channel        (open or create DM / group DM)
 *   A new 1:1 DM needs friendship or a shared space; a group DM needs every recipient to be the creator's friend.
 * DELETE /channels/:id/recipients/@me                     -> 204 (leave a group DM; CHANNEL_DELETE to you, CHANNEL_UPDATE to the rest)
 * POST   /spaces                   CreateSpaceBody       -> SpaceSnapshot
 * PATCH  /spaces/:id               PatchSpaceBody        -> Space
 * DELETE /spaces/:id                                     -> 204 (owner only)
 * DELETE /spaces/:id/members/@me                         -> 204 (leave)
 * DELETE /spaces/:id/members/:userId                     -> 204 (kick)
 * POST   /spaces/:id/channels      CreateChannelBody     -> Channel
 * PATCH  /channels/:id             PatchChannelBody      -> Channel
 * DELETE /channels/:id                                   -> 204
 * GET    /channels/:id/messages?before=&after=&limit=    -> Message[] (newest first, limit<=100)
 * POST   /channels/:id/messages    SendMessageBody       -> Message
 * PATCH  /channels/:id/messages/:mid EditMessageBody     -> Message
 * DELETE /channels/:id/messages/:mid                     -> 204
 * PUT    /channels/:id/messages/:mid/reactions/:emoji    -> 204
 * DELETE /channels/:id/messages/:mid/reactions/:emoji    -> 204
 * POST   /channels/:id/typing                            -> 204
 * POST   /channels/:id/ack         AckBody               -> 204
 * GET    /spaces/:id/roles                               -> Role[] (any member; position order)
 * POST   /spaces/:id/roles         CreateRoleBody        -> Role   (MANAGE_ROLES; created at position 1, just above @everyone)
 * PATCH  /spaces/:id/roles         ReorderRolesBody      -> Role[] (MANAGE_ROLES; a role sent to an occupied position takes it)
 * PATCH  /spaces/:id/roles/:roleId PatchRoleBody         -> Role   (MANAGE_ROLES; @everyone: permissions only)
 * DELETE /spaces/:id/roles/:roleId                       -> 204    (MANAGE_ROLES; @everyone cannot be deleted)
 * PUT    /spaces/:id/members/:userId/roles/:roleId       -> 204    (MANAGE_ROLES; MEMBER_UPDATE)
 * DELETE /spaces/:id/members/:userId/roles/:roleId       -> 204    (MANAGE_ROLES; MEMBER_UPDATE)
 * PATCH  /spaces/:id/members/:userId PatchMemberBody     -> Member (nickname: `@me` needs CHANGE_NICKNAME, others MANAGE_NICKNAMES)
 * PATCH  /spaces/:id/members/:userId/voice VoiceModerationBody -> 204
 *   serverMute → MUTE_MEMBERS, serverDeaf → DEAFEN_MEMBERS (persist across joins, enforced at the SFU: no microphone /
 *   no subscribing); channelId → MOVE_MEMBERS: a voice channel of this space (VOICE_MOVE to the user) or null (disconnect,
 *   VOICE_DISCONNECT reason 'moderator'). Move/disconnect need the user to be in voice in this space.
 * GET    /spaces/:id/bans                                -> Ban[]  (BAN_MEMBERS)
 * PUT    /spaces/:id/bans/:userId  BanBody               -> 204    (BAN_MEMBERS; removes the member, invites refuse them)
 * DELETE /spaces/:id/bans/:userId                        -> 204    (BAN_MEMBERS)
 *   Hierarchy: a role outranks the ones with a lower `position` (@everyone = 0). Except for the owner, you can only
 *   create/edit/delete/assign/reorder roles below your highest role, grant permissions you have, and kick, ban or
 *   rename members whose highest role is below yours. Channel permission overwrites are not implemented yet.
 * POST   /spaces/:id/invites       CreateInviteBody      -> Invite
 * GET    /invites/:code                                  -> Invite (public preview, no auth)
 * POST   /invites/:code                                  -> SpaceSnapshot (join)
 * POST   /voice/join               VoiceJoinBody         -> VoiceJoinResponse
 * POST   /livekit/webhook          (LiveKit-signed)      -> 200 (server-to-server only)
 * GET    /health                                         -> { ok: true, version }
 */

export type ApiErrorCode =
  | 'bad_request'
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'internal'

export interface ApiError {
  error: { code: ApiErrorCode; message: string; fields?: Record<string, string> }
}

/** Profile/space images: https only (no javascript:/file:/data:/http: — tracking and unsafe schemes). */
const httpsUrl = z.url({ protocol: /^https$/ }).max(2048)

const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(32)
  .regex(/^[a-z0-9_.]+$/, 'Use apenas letras, números, "_" e "."')

export const RegisterBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  username,
  displayName: z.string().trim().min(1).max(32).optional(),
  password: z.string().min(8).max(256),
})
export type RegisterBody = z.infer<typeof RegisterBody>

export const LoginBody = z.object({
  /** Email or username. */
  login: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(256),
})
export type LoginBody = z.infer<typeof LoginBody>

export const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: RegisterBody.shape.password,
})
export type ChangePasswordBody = z.infer<typeof ChangePasswordBody>

export interface AuthResponse {
  token: string
  user: Me
}

export const PatchMeBody = z.object({
  displayName: z.string().trim().min(1).max(32).optional(),
  username: username.optional(),
  bio: z.string().max(190).optional(),
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  avatarUrl: httpsUrl.nullable().optional(),
  statusPreference: z.enum(['online', 'idle', 'dnd', 'invisible']).optional(),
})
export type PatchMeBody = z.infer<typeof PatchMeBody>

export const FriendRequestBody = z.object({ username })
export type FriendRequestBody = z.infer<typeof FriendRequestBody>

export const PutRelationshipBody = z.object({ type: z.enum(['friend', 'blocked']) })
export type PutRelationshipBody = z.infer<typeof PutRelationshipBody>

export const OpenDmBody = z.object({ recipientIds: z.array(z.string().uuid()).min(1).max(9) })
export type OpenDmBody = z.infer<typeof OpenDmBody>

export const CreateSpaceBody = z.object({ name: z.string().trim().min(1).max(100) })
export type CreateSpaceBody = z.infer<typeof CreateSpaceBody>

export const PatchSpaceBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  iconUrl: httpsUrl.nullable().optional(),
})
export type PatchSpaceBody = z.infer<typeof PatchSpaceBody>

export const CreateChannelBody = z.object({
  type: z.enum(['text', 'voice']),
  name: z.string().trim().min(1).max(100),
  topic: z.string().max(1024).optional(),
})
export type CreateChannelBody = z.infer<typeof CreateChannelBody>

export const PatchChannelBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  topic: z.string().max(1024).optional(),
  position: z.number().int().min(0).max(10_000).optional(),
  bitrateKbps: z.number().int().min(16).max(256).optional(),
  userLimit: z.number().int().min(0).max(99).optional(),
})
export type PatchChannelBody = z.infer<typeof PatchChannelBody>

export const SendMessageBody = z.object({
  content: z.string().trim().min(1).max(4000),
  nonce: z.string().max(64).optional(),
  replyToId: z.string().uuid().optional(),
})
export type SendMessageBody = z.infer<typeof SendMessageBody>

export const EditMessageBody = z.object({ content: z.string().trim().min(1).max(4000) })
export type EditMessageBody = z.infer<typeof EditMessageBody>

export const AckBody = z.object({ messageId: z.string().uuid() })
export type AckBody = z.infer<typeof AckBody>

export const CreateInviteBody = z.object({
  maxUses: z.number().int().min(0).max(1000).default(0),
  /** 0 = never expires. */
  maxAgeSeconds: z.number().int().min(0).max(60 * 60 * 24 * 30).default(60 * 60 * 24 * 7),
})
export type CreateInviteBody = z.infer<typeof CreateInviteBody>

const roleName = z.string().trim().min(1).max(100)
const roleColor = z.string().regex(/^#[0-9a-f]{6}$/i).nullable()
const permissionBits = z.number().int().min(0).refine((p) => (p & ~ALL_PERMISSIONS) === 0, 'Permissão desconhecida.')

export const CreateRoleBody = z.object({
  name: roleName,
  color: roleColor.optional(),
  permissions: permissionBits.default(0),
})
export type CreateRoleBody = z.infer<typeof CreateRoleBody>

export const PatchRoleBody = z.object({
  name: roleName.optional(),
  color: roleColor.optional(),
  permissions: permissionBits.optional(),
})
export type PatchRoleBody = z.infer<typeof PatchRoleBody>

/** Desired positions (≥ 1) for some roles; the server renumbers the roles you may move, keeping the rest. */
export const ReorderRolesBody = z.array(z.object({ id: z.string().uuid(), position: z.number().int().min(1).max(10_000) })).min(1).max(250)
export type ReorderRolesBody = z.infer<typeof ReorderRolesBody>

/** `null` or an empty string clears the nickname. */
export const PatchMemberBody = z.object({ nickname: z.string().trim().max(32).nullable() })
export type PatchMemberBody = z.infer<typeof PatchMemberBody>

export const BanBody = z.object({ reason: z.string().trim().max(512).optional() })
export type BanBody = z.infer<typeof BanBody>

export const VoiceModerationBody = z.object({
  serverMute: z.boolean().optional(),
  serverDeaf: z.boolean().optional(),
  /** Voice channel to move the member to, or null to disconnect them. */
  channelId: z.string().uuid().nullable().optional(),
})
export type VoiceModerationBody = z.infer<typeof VoiceModerationBody>

export const VoiceJoinBody = z.object({ channelId: z.string().uuid() })
export type VoiceJoinBody = z.infer<typeof VoiceJoinBody>

export interface VoiceJoinResponse {
  /** LiveKit server WebSocket URL (wss://… in production). */
  url: string
  /** Short-lived LiveKit access token scoped to this channel's room. */
  token: string
  room: string
  /** Opus target bitrate for this channel. */
  bitrateKbps: number
}
