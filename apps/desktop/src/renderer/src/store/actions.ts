import type {
  Attachment, Ban, ChangePasswordBody, Channel, CreateChannelBody, CreateRoleBody, Invite, Me, Member, Message, PatchMeBody, PatchRoleBody,
  PatchSpaceBody, Relationship, ReorderRolesBody, Role, Session, Space, SpaceSnapshot, StatusPreference, VoiceJoinBody, VoiceJoinResponse, VoiceModerationBody,
} from '@alga/shared'
import { DECODE_CODECS, uuidv7 } from '@alga/shared'
import { api, ApiRequestError, upload } from '@/lib/api'
import { errorText } from '@/lib/errors'
import { localKind } from '@/lib/files'
import { useData } from './data'
import { useSession } from './session'

/**
 * Server mutations. Realtime echoes arrive via the gateway and are applied by the data store;
 * we also apply REST responses immediately so the acting client never waits on the socket.
 */

const PAGE = 50

export async function loadMessages(channelId: string): Promise<void> {
  const d = useData.getState()
  const list = d.messages[channelId]
  if (list?.loading || (list && !list.hasMoreBefore)) return
  // Oldest confirmed message (optimistic ones use their nonce as id).
  const before = list?.ids.find((id) => list.byId[id]?.nonce !== id)
  d.setMessagesLoading(channelId, true)
  try {
    const q = before ? `?before=${before}&limit=${PAGE}` : `?limit=${PAGE}`
    const page = await api<Message[]>('GET', `/channels/${channelId}/messages${q}`)
    d.upsertMessages(channelId, page, { hasMoreBefore: page.length === PAGE })
  } finally {
    useData.getState().setMessagesLoading(channelId, false)
  }
}

/** A picked file with its local preview (object URL, owned by whoever holds it; revoked on send/discard). */
export interface OutgoingFile {
  file: File
  url: string
  width?: number
  height?: number
}
/** Files of optimistic messages, kept until the send succeeds or is discarded (retry re-uploads them). */
const outbox = new Map<string, OutgoingFile[]>()
const release = (nonce: string) => {
  for (const f of outbox.get(nonce) ?? []) URL.revokeObjectURL(f.url)
  outbox.delete(nonce)
}

/**
 * Optimistic send: shows immediately with the nonce as a temporary id, reconciled by the server echo.
 * With files it is a multipart upload with progress (`uploads[nonce]`); the local previews stand in meanwhile.
 * On failure the copy stays in place, flagged in `sendFailures` (with the server's reason when there is one),
 * until retried or discarded.
 */
export async function sendMessage(channelId: string, content: string, replyToId?: string, retryNonce?: string, files?: OutgoingFile[]): Promise<void> {
  const d = useData.getState()
  const me = d.me
  if (!me) return
  // v7 so the optimistic copy sorts after existing history.
  const nonce = retryNonce ?? uuidv7()
  if (files?.length) outbox.set(nonce, files)
  const out = outbox.get(nonce) ?? []
  const attachments: Attachment[] = out.map((f, i) => ({
    id: `${nonce}-${i}`,
    filename: f.file.name,
    contentType: localKind(f.file.type) === 'file' ? 'application/octet-stream' : f.file.type,
    size: f.file.size,
    url: f.url,
    width: f.width,
    height: f.height,
  }))
  const pending: Message = {
    id: nonce, nonce, channelId, author: me, content, createdAt: new Date().toISOString(),
    editedAt: null, replyToId: replyToId ?? null, reactions: [], attachments,
  }
  d.setSendFailed(nonce, false)
  d.upsertMessages(channelId, [pending])
  try {
    let saved: Message
    if (out.length) {
      const form = new FormData()
      form.append('payload_json', JSON.stringify({ content, nonce, replyToId }))
      for (const f of out) form.append('files', f.file, f.file.name)
      d.setUpload(nonce, 0)
      saved = await upload<Message>('POST', `/channels/${channelId}/messages`, form, (p) => useData.getState().setUpload(nonce, p))
    } else saved = await api<Message>('POST', `/channels/${channelId}/messages`, { content, nonce, replyToId })
    useData.getState().upsertMessages(channelId, [{ ...saved, nonce }])
    useData.getState().markRead(channelId, saved.id)
    release(nonce)
  } catch (e) {
    // The gateway echo may have reconciled it already (response lost, message saved).
    if (useData.getState().messages[channelId]?.byId[nonce]) {
      useData.getState().setSendFailed(nonce, e instanceof ApiRequestError && e.status !== 0 ? errorText(e) : true)
    } else release(nonce)
    throw e
  } finally {
    useData.getState().setUpload(nonce, null)
  }
}

export function retrySend(channelId: string, nonce: string): Promise<void> {
  const m = useData.getState().messages[channelId]?.byId[nonce]
  if (!m) return Promise.resolve()
  return sendMessage(channelId, m.content, m.replyToId ?? undefined, nonce)
}

export function discardSend(channelId: string, nonce: string): void {
  release(nonce)
  useData.getState().setSendFailed(nonce, false)
  useData.getState().removeMessage(channelId, nonce)
}

/**
 * Sends that failed for lack of connection (`sendFailures[nonce] === true`) go out again on their own, oldest first,
 * when the realtime link is back or Windows says we are online. Repeating is safe: the server answers a retried nonce
 * with the message it already saved (no copies). A refusal with a reason (`string`) waits for the person.
 * shortcut: the queue lives in memory; closing the app drops what was still waiting (persist it if that shows up).
 */
let flushing = false
export async function flushQueuedSends(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    const st = useData.getState()
    // uuidv7 nonces sort by creation time: the conversation keeps its order.
    const queued = Object.entries(st.sendFailures).filter(([, v]) => v === true).map(([nonce]) => nonce).sort()
    for (const nonce of queued) {
      const channelId = Object.keys(st.messages).find((c) => st.messages[c]?.byId[nonce])
      if (!channelId) {
        useData.getState().setSendFailed(nonce, false)
        continue
      }
      try {
        await retrySend(channelId, nonce)
      } catch {
        break // still offline: the next reconnect tries again
      }
    }
  } finally {
    flushing = false
  }
}

export function startSendQueue(): () => void {
  const flush = () => void flushQueuedSends()
  window.addEventListener('online', flush)
  const off = useSession.subscribe((s, p) => {
    if (s.gateway === 'ready' && p.gateway !== 'ready') flush()
  })
  return () => {
    window.removeEventListener('online', flush)
    off()
  }
}

/**
 * Fresh signed URLs for a message whose file failed to load (they expire after ~1 h): refetches the page that
 * ends at it, which also refreshes its older neighbours. One request per channel at a time.
 */
const refreshing = new Map<string, Promise<void>>()
export function refreshMessage(channelId: string, messageId: string): Promise<void> {
  const cur = refreshing.get(channelId)
  if (cur) return cur
  const list = useData.getState().messages[channelId]
  const next = list?.ids.find((id) => id > messageId && list.byId[id]?.nonce !== id)
  const p = api<Message[]>('GET', `/channels/${channelId}/messages?${next ? `before=${next}&` : ''}limit=${PAGE}`)
    .then((page) => useData.getState().upsertMessages(channelId, page))
    .finally(() => refreshing.delete(channelId))
  refreshing.set(channelId, p)
  return p
}

/** Mark everything loaded in the channel as read (no-op if already read). */
export function ackLatest(channelId: string): void {
  const d = useData.getState()
  const list = d.messages[channelId]
  const latest = list?.ids.findLast((id) => list.byId[id]?.nonce !== id)
  if (!latest) return
  const read = d.readStates[channelId]
  if (read?.lastReadMessageId && read.lastReadMessageId >= latest && !read.mentionCount) return
  d.markRead(channelId, latest)
  ack(channelId, latest).catch((e: unknown) => console.warn('[ack] failed', e))
}

export const editMessage = async (channelId: string, id: string, content: string) =>
  useData.getState().upsertMessages(channelId, [await api<Message>('PATCH', `/channels/${channelId}/messages/${id}`, { content })])

export const deleteMessage = async (channelId: string, id: string) => {
  await api('DELETE', `/channels/${channelId}/messages/${id}`)
  useData.getState().removeMessage(channelId, id)
}

/** Optimistic toggle; rolled back if the request fails (the gateway echo is idempotent for own reactions). */
export async function react(channelId: string, id: string, emoji: string, on: boolean): Promise<void> {
  const apply = (add: boolean) => {
    const me = useData.getState().me
    if (me) useData.getState().apply({ t: add ? 'REACTION_ADD' : 'REACTION_REMOVE', d: { channelId, messageId: id, userId: me.id, emoji } })
  }
  apply(on)
  try {
    await api(on ? 'PUT' : 'DELETE', `/channels/${channelId}/messages/${id}/reactions/${encodeURIComponent(emoji)}`)
  } catch (e) {
    apply(!on)
    throw e
  }
}

export const ack = (channelId: string, messageId: string) => api('POST', `/channels/${channelId}/ack`, { messageId })
export const typing = (channelId: string) => api('POST', `/channels/${channelId}/typing`)

export async function createSpace(name: string): Promise<SpaceSnapshot> {
  const sp = await api<SpaceSnapshot>('POST', '/spaces', { name })
  useData.getState().apply({ t: 'SPACE_CREATE', d: sp })
  return sp
}

export async function createChannel(spaceId: string, body: CreateChannelBody): Promise<Channel> {
  const ch = await api<Channel>('POST', `/spaces/${spaceId}/channels`, body)
  useData.getState().apply({ t: 'CHANNEL_CREATE', d: ch })
  return ch
}

export async function leaveSpace(spaceId: string): Promise<void> {
  await api('DELETE', `/spaces/${spaceId}/members/@me`)
  useData.getState().apply({ t: 'SPACE_DELETE', d: { id: spaceId } })
}

export async function setStatus(statusPreference: StatusPreference): Promise<void> {
  useData.getState().apply({ t: 'ME_UPDATE', d: await api<Me>('PATCH', '/users/@me', { statusPreference }) })
}
export const createInvite = (spaceId: string, maxAgeSeconds = 604800, maxUses = 0) =>
  api<Invite>('POST', `/spaces/${spaceId}/invites`, { maxAgeSeconds, maxUses })
export const listInvites = (spaceId: string) => api<Invite[]>('GET', `/spaces/${spaceId}/invites`)
export const revokeInvite = (code: string) => api<void>('DELETE', `/invites/${encodeURIComponent(code)}`)
export const previewInvite = (code: string) => api<Invite>('GET', `/invites/${encodeURIComponent(code)}`)
export async function joinInvite(code: string): Promise<SpaceSnapshot> {
  const sp = await api<SpaceSnapshot>('POST', `/invites/${encodeURIComponent(code)}`)
  useData.getState().apply({ t: 'SPACE_CREATE', d: sp })
  return sp
}

export async function sendFriendRequest(username: string): Promise<Relationship> {
  const rel = await api<Relationship>('POST', '/relationships', { username })
  useData.getState().apply({ t: 'RELATIONSHIP_UPSERT', d: rel })
  return rel
}
export async function setRelationship(userId: string, type: 'friend' | 'blocked'): Promise<void> {
  useData.getState().apply({ t: 'RELATIONSHIP_UPSERT', d: await api<Relationship>('PUT', `/relationships/${userId}`, { type }) })
}
export async function removeRelationship(userId: string): Promise<void> {
  await api('DELETE', `/relationships/${userId}`)
  useData.getState().apply({ t: 'RELATIONSHIP_REMOVE', d: { userId } })
}

export async function openDm(recipientIds: string[]): Promise<Channel> {
  const ch = await api<Channel>('POST', '/users/@me/channels', { recipientIds })
  useData.getState().apply({ t: 'CHANNEL_CREATE', d: ch })
  return ch
}

/**
 * POST /voice/join with what this client can do: E2EE while main's MLS device is up (or coming up: joinCall waits for
 * it), and the video codecs it decodes (the server's allowlist, for DECODE_ATTRIBUTE). The response says whether this
 * call is E2EE.
 */
export async function voiceJoin(channelId: string): Promise<VoiceJoinResponse> {
  const e2ee = (await window.alga?.e2ee?.status().catch(() => null))?.state
  const mimes = typeof RTCRtpReceiver === 'undefined' ? [] : (RTCRtpReceiver.getCapabilities('video')?.codecs ?? []).map((c) => c.mimeType)
  const decode = [...new Set(mimes.filter((m) => m.toLowerCase() in DECODE_CODECS))]
  const body: VoiceJoinBody = { channelId, capabilities: { e2ee: e2ee === 'ready' || e2ee === 'starting', decode } }
  return api<VoiceJoinResponse>('POST', '/voice/join', body)
}

/** Moderation: serverMute/serverDeaf (SFU-enforced), move (channelId) or disconnect (channelId: null). */
export const moderateVoice = (spaceId: string, userId: string, body: VoiceModerationBody) =>
  api<void>('PATCH', `/spaces/${spaceId}/members/${userId}/voice`, body)

export const leaveGroupDm = (channelId: string) => api<void>('DELETE', `/channels/${channelId}/recipients/@me`)

// ── Account ─────────────────────────────────────────────
export async function patchMe(body: PatchMeBody): Promise<Me> {
  const me = await api<Me>('PATCH', '/users/@me', body)
  useData.getState().apply({ t: 'ME_UPDATE', d: me })
  return me
}
/** Avatar upload (already cropped/resized by the caller): PUT /users/@me/avatar → Me. */
export async function uploadAvatar(file: Blob, name: string, onProgress?: (p: number) => void): Promise<Me> {
  const form = new FormData()
  form.append('file', file, name)
  const me = await upload<Me>('PUT', '/users/@me/avatar', form, onProgress)
  useData.getState().apply({ t: 'ME_UPDATE', d: me })
  return me
}
export const removeAvatar = () => patchMe({ avatarUrl: null })
export const listSessions = () => api<Session[]>('GET', '/auth/sessions')
export const revokeSession = (id: string) => api<void>('DELETE', `/auth/sessions/${id}`)
export const revokeOtherSessions = () => api<void>('DELETE', '/auth/sessions')
export const changePassword = (body: ChangePasswordBody) => api<void>('POST', '/auth/password', body)

// ── E-mail verification and password reset ─────────────
/** Confirms the e-mail with the token from the mail; ME_UPDATE also arrives over the gateway. */
export async function verifyEmail(token: string): Promise<void> {
  await api<void>('POST', '/auth/verify-email', { token })
  if (useData.getState().me) useData.getState().apply({ t: 'ME_UPDATE', d: await api<Me>('GET', '/users/@me') })
}
export const resendVerification = () => api<void>('POST', '/auth/verify-email/resend')
/** Always 204 (the server never says whether the e-mail has an account). */
export const requestPasswordReset = (email: string) => api<void>('POST', '/auth/password-reset/request', { email })
export const confirmPasswordReset = (token: string, password: string) => api<void>('POST', '/auth/password-reset/confirm', { token, password })

/** "Marcar como lido" for a whole space: acks each unread text channel at its last message. */
export function markSpaceRead(spaceId: string): void {
  const d = useData.getState()
  for (const c of Object.values(d.channels)) {
    if (c.spaceId !== spaceId || !c.lastMessageId) continue
    const read = d.readStates[c.id]
    if (read?.lastReadMessageId && read.lastReadMessageId >= c.lastMessageId && !read.mentionCount) continue
    d.markRead(c.id, c.lastMessageId)
    ack(c.id, c.lastMessageId).catch((e: unknown) => console.warn('[ack] failed', e))
  }
}

// ── Space settings ──────────────────────────────────────
export async function patchSpace(spaceId: string, body: PatchSpaceBody): Promise<Space> {
  const sp = await api<Space>('PATCH', `/spaces/${spaceId}`, body)
  useData.getState().apply({ t: 'SPACE_UPDATE', d: sp })
  return sp
}
export async function uploadSpaceIcon(spaceId: string, file: Blob, name: string, onProgress?: (p: number) => void): Promise<Space> {
  const form = new FormData()
  form.append('file', file, name)
  const sp = await upload<Space>('PUT', `/spaces/${spaceId}/icon`, form, onProgress)
  useData.getState().apply({ t: 'SPACE_UPDATE', d: sp })
  return sp
}
export async function deleteSpace(spaceId: string): Promise<void> {
  await api('DELETE', `/spaces/${spaceId}`)
  useData.getState().apply({ t: 'SPACE_DELETE', d: { id: spaceId } })
}

const upsertRole = (r: Role) => useData.getState().apply({ t: 'ROLE_UPSERT', d: r })
export async function createRole(spaceId: string, body: CreateRoleBody): Promise<Role> {
  const r = await api<Role>('POST', `/spaces/${spaceId}/roles`, body)
  upsertRole(r)
  return r
}
export async function patchRole(spaceId: string, roleId: string, body: PatchRoleBody): Promise<Role> {
  const r = await api<Role>('PATCH', `/spaces/${spaceId}/roles/${roleId}`, body)
  upsertRole(r)
  return r
}
export async function reorderRoles(spaceId: string, body: ReorderRolesBody): Promise<void> {
  for (const r of await api<Role[]>('PATCH', `/spaces/${spaceId}/roles`, body)) upsertRole(r)
}
export async function deleteRole(spaceId: string, roleId: string): Promise<void> {
  await api('DELETE', `/spaces/${spaceId}/roles/${roleId}`)
  useData.getState().apply({ t: 'ROLE_DELETE', d: { spaceId, id: roleId } })
}
/** Assign/remove a role; the server answers 204, so the member is updated here (MEMBER_UPDATE confirms). */
export async function setMemberRole(spaceId: string, userId: string, roleId: string, on: boolean): Promise<void> {
  await api(on ? 'PUT' : 'DELETE', `/spaces/${spaceId}/members/${userId}/roles/${roleId}`)
  const m = useData.getState().members[spaceId]?.[userId]
  if (!m) return
  const roleIds = on ? [...new Set([...m.roleIds, roleId])] : m.roleIds.filter((r) => r !== roleId)
  useData.getState().apply({ t: 'MEMBER_UPDATE', d: { ...m, roleIds } })
}
export async function setNickname(spaceId: string, userId: string, nickname: string | null): Promise<void> {
  const self = userId === useData.getState().me?.id
  const m = await api<Member>('PATCH', `/spaces/${spaceId}/members/${self ? '@me' : userId}`, { nickname })
  useData.getState().apply({ t: 'MEMBER_UPDATE', d: m })
}
export async function kickMember(spaceId: string, userId: string): Promise<void> {
  await api('DELETE', `/spaces/${spaceId}/members/${userId}`)
  useData.getState().apply({ t: 'MEMBER_REMOVE', d: { spaceId, userId } })
}
export async function banMember(spaceId: string, userId: string, reason: string): Promise<void> {
  await api('PUT', `/spaces/${spaceId}/bans/${userId}`, reason.trim() ? { reason: reason.trim() } : {})
  useData.getState().apply({ t: 'MEMBER_REMOVE', d: { spaceId, userId } })
}
export const listBans = (spaceId: string) => api<Ban[]>('GET', `/spaces/${spaceId}/bans`)
export const unban = (spaceId: string, userId: string) => api<void>('DELETE', `/spaces/${spaceId}/bans/${userId}`)
