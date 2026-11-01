import { z } from 'zod'
import type { Me } from './models.js'

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
  avatarUrl: z.string().url().max(2048).nullable().optional(),
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
  iconUrl: z.string().url().max(2048).nullable().optional(),
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
  position: z.number().int().min(0).optional(),
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
