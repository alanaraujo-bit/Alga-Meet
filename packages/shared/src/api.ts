import { z } from 'zod'
import type { StreamPreset } from './billing.js'
import type { Me } from './models.js'
import { ALL_PERMISSIONS } from './permissions.js'
import { birthDate, termsVersion, type AccountRestriction } from './trust-safety.js'

/**
 * REST contract. All routes are prefixed with /api/v1 and use JSON.
 * Auth: `Authorization: Bearer <session token>` (opaque; the server stores only its SHA-256 hash).
 * Client: the desktop sends `X-Alga-Client: <app version>; <os version>` (e.g. `0.1.0; Windows 11`; AppConfig.version and
 *   AppConfig.osVersion) on every request. Optional; at most 96 characters, version `1.2.3[-tag]`, OS letters, digits,
 *   space and `._()-` (anything else is ignored, never an error). Stored with the session at login and refreshed when
 *   the session is used, it labels Session.client / Session.os.
 * Errors: { error: { code: ApiErrorCode, message: string, fields?: Record<string,string> } }
 *
 * POST   /auth/register            RegisterBody          -> AuthResponse
 *   409 only for a taken username (usernames are public). A taken e-mail is never revealed: the account is created
 *   unverified and the address gets a "you already have an account" mail instead of a verification link.
 *   Passwords: MIN_PASSWORD_LENGTH..256 characters and not a common/leaked password (400 `fields.password`).
 *   birthDate + termsVersion (GET /legal): required when LegalInfo.signupRequiresBirthDate (production), optional in
 *   dev until every client sends them. Under MIN_AGE -> 400 `fields.birthDate` (nothing is stored); an old
 *   termsVersion -> 400 `fields.termsVersion`.
 * POST   /auth/login               LoginBody             -> AuthResponse
 *   By username, or by e-mail once that e-mail is verified (Me.emailVerified); same 401 either way.
 *   Suspended/banned account (right password): 403 with ApiError.error.restriction (reason, until, appeal token).
 *   A pending account deletion is canceled by logging in (AuthResponse.deletionCanceled).
 * POST   /auth/verify-email        VerifyEmailBody       -> 204 (no auth; token from the e-mail, 24 h, single use;
 *                                                          ME_UPDATE; 400 `fields.token` if invalid/expired/used)
 * POST   /auth/verify-email/resend                       -> 204 (auth; 3 per 15 min; no-op when already verified)
 *   While Me.emailVerified is false: no invites (POST /spaces/:id/invites), at most one owned space (POST /spaces), and
 *   no new DM with someone who is not a friend (POST /users/@me/channels). These answer 403 `forbidden`.
 * POST   /auth/password-reset/request PasswordResetRequestBody -> 204 (no auth; always 204, whether or not the e-mail
 *                                                          exists; 5 per 15 min per IP, 3 mails per hour per address)
 * POST   /auth/password-reset/confirm PasswordResetConfirmBody -> 204 (no auth; token 1 h, single use; revokes every
 *                                                          session (gateway 4004) and verifies the e-mail)
 * POST   /auth/logout                                    -> 204
 * POST   /auth/password            ChangePasswordBody    -> 204 (revokes every other session)
 * GET    /auth/sessions                                  -> Session[] (most recently used first; client/os labels)
 * DELETE /auth/sessions                                  -> 204 (revoke all except the current one)
 * DELETE /auth/sessions/:id                              -> 204
 *   Sessions expire after 30 days without use or 90 days after login (then 401).
 * GET    /users/@me                                      -> Me
 * PATCH  /users/@me                PatchMeBody           -> Me
 * PUT    /users/@me/cosmetics      PutCosmeticsBody      -> Me (per slot: equip a cosmetic you own or your plan includes
 *                                                          (Entitlement with kind 'cosmetic'), or null to unequip; 403
 *                                                          not owned, 400 `fields.<slot>` unknown id or wrong slot;
 *                                                          ME_UPDATE + USER_UPDATE with PublicUser.cosmetics; 10/min)
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
 * POST   /channels/:id/messages    multipart/form-data   -> Message (with files; SEND_MESSAGES + ATTACH_FILES)
 *   Parts: `payload_json` = JSON text of SendMessageWithAttachmentsBody (content may be empty if a file is attached),
 *   and 1–MAX_ATTACHMENTS file parts (field name `files`). Each file ≤ the server cap (DEFAULT_MAX_ATTACHMENT_BYTES
 *   unless configured): 413 above it or above MAX_ATTACHMENTS files. The type is sniffed from the bytes (the part's
 *   Content-Type and the extension are ignored) and the filename is sanitized. Attachment.contentType is what the
 *   file is served as: an image/*, video/* or audio/* type means "render inline"; anything else (unknown types,
 *   SVG, HTML, huge images) is application/octet-stream, a download. width/height come with images.
 *   Inline images (png/jpeg/webp/gif/avif) are re-encoded before storage: no EXIF/GPS/XMP/ICC survives, the EXIF
 *   orientation is applied (width/height are as displayed), colors become sRGB, GIF/WebP animation is kept, sides above
 *   8192 px are scaled down and AVIF becomes WebP (size/filename extension follow the stored file). 400
 *   `fields.files` for more than 100 megapixels (all frames together), more than 500 frames or undecodable images.
 *   Uploads are limited to 30 files per 10 minutes per user (429). Deleting the message deletes its files.
 * GET    /files/:id?uid=&exp=&sig=                        -> file bytes (no auth header: Attachment.url is signed)
 *   Attachment.url is per viewer and expires (~1 h; every message fetch or event carries fresh ones), so it works
 *   in <img>/<video> without headers. 403 = expired or tampered, 404 = gone or the viewer lost access to the channel.
 *   Single `Range` requests are supported (video seeking).
 * PUT    /users/@me/avatar         multipart `file`      -> Me    (ME_UPDATE + USER_UPDATE)
 * PUT    /spaces/:id/icon          multipart `file`      -> Space (MANAGE_SPACE; SPACE_UPDATE)
 *   One image of AVATAR_CONTENT_TYPES (sniffed; SVG refused), ≤ MAX_AVATAR_BYTES and ≤ MAX_AVATAR_SIDE px per side,
 *   5 per minute. Stored as WebP (animated when the input was) fitting 1024 px, metadata stripped; crop on the client. Sets avatarUrl/iconUrl to our own URL, served publicly and immutably at
 * GET    /avatars/:userId/:file  ·  GET /icons/:spaceId/:file   -> image (public, no auth)
 *   PATCH /users/@me and PATCH /spaces/:id accept avatarUrl/iconUrl only as null (remove) or a URL these uploads
 *   returned for that same user/space; any other URL is a 400.
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
 * GET    /spaces/:id/invites                             -> Invite[] (usable ones, newest first: every invite with
 *                                                          MANAGE_SPACE, otherwise only the ones you created)
 * DELETE /invites/:code                                  -> 204 (revoke: MANAGE_SPACE in its space or its creator;
 *                                                          404 if it does not exist or you are not in the space)
 * GET    /invites/:code                                  -> Invite (public preview, no auth)
 * POST   /invites/:code                                  -> SpaceSnapshot (join)
 * POST   /voice/join               VoiceJoinBody         -> VoiceJoinResponse
 *   The token carries the participant attribute STREAM_PRESETS_ATTRIBUTE (the user's plan presets); the server also
 *   checks every screen-share publication against them (see VoiceJoinResponse.streamPresets).
 * E2EE devices and key packages (bodies, models and the call flow in e2ee.ts; 10/min per route; 503 when the server
 * has no MLS module):
 * POST   /e2ee/devices             RegisterDeviceBody    -> E2eeDevice (201 new, 200 again: binds the device to this
 *                                                          user + session (deleted with the session), empties its key
 *                                                          package pool; a new signatureKey replaces the old one; a
 *                                                          session holds one device (another deviceId replaces it);
 *                                                          409 above E2EE_MAX_DEVICES_PER_USER)
 * POST   /e2ee/devices/:id/key-packages UploadKeyPackagesBody -> KeyPackagesUploaded (this session's device only;
 *                                                          each must be valid, ciphersuite 1, identity
 *                                                          `userId:deviceId` and signed by the device's key, else 400
 *                                                          `fields.keyPackages.<i>`; 409 above
 *                                                          E2EE_MAX_KEY_PACKAGES_PER_DEVICE; duplicates are ignored)
 * GET    /e2ee/users/:userId/key-packages                -> ClaimedKeyPackages (claims one per device, single use;
 *                                                          yourself, a friend, someone in a shared space or private
 *                                                          channel, never across a block, else 404)
 * DELETE /e2ee/devices/:id                               -> 204 (your device: its key packages go too and it leaves
 *                                                          any call group at once)
 * GET    /billing/catalog                               -> BillingCatalog (public, no auth)
 * GET    /billing/me                                     -> BillingMe (plan, subscriptions, entitlements, orders)
 * POST   /billing/checkout         CheckoutBody          -> CheckoutResponse (201; verified e-mail required; 10/h)
 *   Creates a pending subscription (plan products) or order (cosmetics) and returns the provider's page. Nothing is
 *   granted here: the provider's verified webhook (or an API re-fetch) confirms the payment, then ENTITLEMENTS_UPDATE
 *   (+ ME_UPDATE with the new Me.plan). 404 unknown/unsold product, 409 already subscribed / already owned, 503
 *   payments disabled on this server. `sandbox: true` = test provider (dev/test only), nothing is charged.
 * POST   /billing/subscription/cancel                    -> Subscription (renewals stop now, the plan lasts until
 *                                                          currentPeriodEnd; idempotent; 404 without an active one;
 *                                                          10/h)
 * POST   /billing/subscription/resume                    -> Subscription (undoes cancel while the period is still
 *                                                          paid: cancelAtPeriodEnd false, renewals resume at the
 *                                                          provider; idempotent; 404 without an active one; 10/h)
 * POST   /billing/webhooks/:provider (provider-signed)   -> 200 (server-to-server; 401 bad signature, 404 unknown
 *                                                          provider; repeated events are acknowledged and ignored)
 * GET    /billing/sandbox/checkout/:reference?sig=&outcome=approve|decline -> HTML (sandbox provider only: the fake
 *                                                          "provider page" a sandbox checkout URL opens)
 * POST   /livekit/webhook          (LiveKit-signed)      -> 200 (server-to-server only)
 *
 * Trust & Safety and privacy (bodies and models in trust-safety.ts; policies in docs/trust-safety/README.md):
 * GET    /legal                                          -> LegalInfo (public; changeSummary = "o que mudou" in this version)
 * PATCH  /users/@me/birth-date     BirthDateBody         -> Me (once, while Me.ageBracket is 'unknown'; 409 after; under
 *                                                          MIN_AGE -> 403 restriction 'underage': sessions revoked,
 *                                                          account deleted in APPEAL_WINDOW_DAYS unless an appeal wins)
 * POST   /users/@me/accept-terms   AcceptTermsBody       -> Me (400 `fields.termsVersion` for an old version;
 *                                                          idempotent once accepted)
 * DELETE /users/@me                DeleteAccountBody     -> 202 AccountDeletionScheduled (password re-check; stops a
 *                                                          renewing subscription; every session revoked (4004); purge
 *                                                          7 days later unless you log in before)
 * POST   /users/@me/export                               -> 202 DataExportRequested (verified e-mail; 1 per 24 h, else
 *                                                          429): a zip (JSON + attachment links) whose signed link
 *                                                          (7 days) goes to your e-mail; in the app, see below
 * GET    /users/@me/exports                              -> DataExport[] (newest first, last 20; status only:
 *                                                          downloadUrl is always null; 30/min)
 * POST   /users/@me/exports/:id/download ExportDownloadBody -> DataExportDownload (password re-check; ready only,
 *                                                          else 409 / 404; link valid EXPORT_DOWNLOAD_TTL_MINUTES;
 *                                                          5 per 15 min; recorded in the access logs)
 * GET    /exports/:id?exp=&sig=                          -> application/zip (no auth: the e-mailed link and
 *                                                          DataExportDownload.downloadUrl are signed)
 * POST   /reports                  CreateReportBody      -> 201 ReportReceipt (200 + duplicate: true for your open report;
 *                                                          10 per hour, csam CSAM_REPORTS_PER_DAY per 24 h; not your
 *                                                          own content; you must see the message)
 * GET    /users/@me/actions                              -> AccountAction[]
 * POST   /appeals                  CreateAppealBody      -> 201 AppealView (session or appealToken; one per action,
 *                                                          within APPEAL_WINDOW_DAYS; 10 per hour per IP)
 * Staff only (users.staff_role, never settable through the API; every call is audit-logged; 403 otherwise):
 * GET    /admin/reports?status=open|resolved|dismissed&limit= -> AdminReport[] (priority, then oldest first)
 * PATCH  /admin/reports/:id        PatchReportBody       -> AdminReport (dismissed: +1 reporterFalseReports; csam
 *                                                          resolved: legal hold on targetUserId)
 * POST   /admin/users/:id/actions  AccountActionBody     -> AccountAction (warn | suspend until | ban | lift; e-mail
 *                                                          to the user with the reason category; suspend/ban revoke
 *                                                          sessions, close sockets with ACCOUNT_RESTRICTED, leave voice)
 * PATCH  /admin/users/:id          PatchAdminUserBody    -> 204 (legal hold)
 * GET    /admin/appeals?status=                          -> AdminAppeal[]
 * PATCH  /admin/appeals/:id        PatchAppealBody       -> AdminAppeal
 * POST   /admin/attachments/:id/quarantine QuarantineBody -> QuarantinedFile (unservable at once, preserved apart)
 * GET    /admin/quarantine                               -> QuarantinedFile[]
 * PATCH  /admin/quarantine/:id     PatchQuarantineBody   -> QuarantinedFile
 * POST   /admin/quarantine/:id/release                   -> QuarantinedFile (false positive: attachment restored with a
 *                                                          new id, MESSAGE_UPDATE, copy deleted; 409 once purged,
 *                                                          released or while the copy is pending; legal hold untouched)
 * GET    /admin/access-logs?userId=|username=&from=&to=&limit= -> AccessLogEntry[] (admin role only)
 * POST   /telemetry/call-quality   CallQualityReport     -> 204 (telemetry.ts; 403 unless Me.telemetryOptIn; 20/h;
 *                                                          400 for any unknown field)
 * GET    /health                                         -> { ok: true, version } (liveness: the process answers)
 * GET    /ready                                          -> { ok, checks: { database, livekit } } (200 when both are
 *                                                          'ok', else 503; ops/monitoring, not for clients)
 * GET    /metrics (root, not /api/v1)                    -> Prometheus text (Bearer METRICS_TOKEN; off in production
 *                                                          without it; docs/infra/observability.md)
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
  /** `restriction`: only on 403s for a suspended/banned account (login, or a session that raced the action). */
  error: { code: ApiErrorCode; message: string; fields?: Record<string, string>; restriction?: AccountRestriction }
}

/**
 * Profile/space images: https only (no javascript:/file:/data:/http: — tracking and unsafe schemes). The server also
 * requires the URL to be one of its own uploads (PUT /users/@me/avatar, PUT /spaces/:id/icon) or null.
 */
const httpsUrl = z.url({ protocol: /^https$/ }).max(2048)

const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(32)
  .regex(/^[a-z0-9_.]+$/, 'Use apenas letras, números, "_" e "."')

/** Server-side the password must also not be a common/leaked one or contain the username/e-mail (fields.password). */
export const MIN_PASSWORD_LENGTH = 10
const password = z.string().min(MIN_PASSWORD_LENGTH).max(256)
const email = z.string().trim().toLowerCase().email().max(254)

export const RegisterBody = z.object({
  email,
  username,
  displayName: z.string().trim().min(1).max(32).optional(),
  password,
  /** YYYY-MM-DD. Used only to check the age (Lei 15.211/2025, art. 13); never shown to anyone. */
  birthDate: birthDate.optional(),
  /** LegalInfo.termsVersion the user accepted (an unchecked box the user ticked). */
  termsVersion: termsVersion.optional(),
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

/** Opaque token from a verification or password-reset e-mail (link `?token=` or pasted code). */
const emailToken = z.string().trim().min(1).max(256)

export const VerifyEmailBody = z.object({ token: emailToken })
export type VerifyEmailBody = z.infer<typeof VerifyEmailBody>

export const PasswordResetRequestBody = z.object({ email })
export type PasswordResetRequestBody = z.infer<typeof PasswordResetRequestBody>

export const PasswordResetConfirmBody = z.object({ token: emailToken, password })
export type PasswordResetConfirmBody = z.infer<typeof PasswordResetConfirmBody>

export interface AuthResponse {
  token: string
  user: Me
  /** Login only: this login canceled a pending account deletion (DELETE /users/@me); tell the user. */
  deletionCanceled?: boolean
}

export const PatchMeBody = z.object({
  displayName: z.string().trim().min(1).max(32).optional(),
  username: username.optional(),
  bio: z.string().max(190).optional(),
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  avatarUrl: httpsUrl.nullable().optional(),
  statusPreference: z.enum(['online', 'idle', 'dnd', 'invisible']).optional(),
  /** Consent to send call-quality aggregates (Me.telemetryOptIn). Off unless the user turns it on. */
  telemetryOptIn: z.boolean().optional(),
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

/** Most files per message. */
export const MAX_ATTACHMENTS = 10
/** Per-file cap unless the server sets MAX_ATTACHMENT_BYTES; larger files get 413. */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
/** Avatars and space icons. */
export const MAX_AVATAR_BYTES = 8 * 1024 * 1024
export const MAX_AVATAR_SIDE = 4096
export const AVATAR_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** `payload_json` of a multipart send: as SendMessageBody, but `content` may be empty when files are attached. */
export const SendMessageWithAttachmentsBody = SendMessageBody.extend({ content: z.string().trim().max(4000).default('') })
export type SendMessageWithAttachmentsBody = z.infer<typeof SendMessageWithAttachmentsBody>

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
  /**
   * Screen-share presets this user may publish (their plan; same value as the token attribute
   * STREAM_PRESETS_ATTRIBUTE). The media engine must cap the top simulcast layer to one of them: short side ≤
   * STREAM_PRESETS[p].height, frame rate ≤ fps, maxBitrate ≤ maxBitrateKbps. The server mutes screen-share tracks
   * published above the plan's largest preset. Always sent; optional for older fixtures.
   */
  streamPresets?: StreamPreset[]
}
