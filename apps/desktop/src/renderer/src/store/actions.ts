import type { Channel, CreateChannelBody, Invite, Message, Relationship, SpaceSnapshot, VoiceJoinResponse } from '@alga/shared'
import { uuidv7 } from '@alga/shared'
import { api } from '@/lib/api'
import { useData } from './data'

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

/** Optimistic send: shows immediately with the nonce as a temporary id, reconciled by the server echo. */
export async function sendMessage(channelId: string, content: string, replyToId?: string): Promise<void> {
  const d = useData.getState()
  const me = d.me
  if (!me) return
  // v7 so the optimistic copy sorts after existing history.
  const nonce = uuidv7()
  const pending: Message = {
    id: nonce, nonce, channelId, author: me, content, createdAt: new Date().toISOString(),
    editedAt: null, replyToId: replyToId ?? null, reactions: [], attachments: [],
  }
  d.upsertMessages(channelId, [pending])
  try {
    const saved = await api<Message>('POST', `/channels/${channelId}/messages`, { content, nonce, replyToId })
    useData.getState().upsertMessages(channelId, [{ ...saved, nonce }])
  } catch (e) {
    useData.getState().removeMessage(channelId, nonce)
    throw e
  }
}

export const editMessage = async (channelId: string, id: string, content: string) =>
  useData.getState().upsertMessages(channelId, [await api<Message>('PATCH', `/channels/${channelId}/messages/${id}`, { content })])

export const deleteMessage = async (channelId: string, id: string) => {
  await api('DELETE', `/channels/${channelId}/messages/${id}`)
  useData.getState().removeMessage(channelId, id)
}

export const react = (channelId: string, id: string, emoji: string, on: boolean) =>
  api(on ? 'PUT' : 'DELETE', `/channels/${channelId}/messages/${id}/reactions/${encodeURIComponent(emoji)}`)

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

export const leaveSpace = (spaceId: string) => api('DELETE', `/spaces/${spaceId}/members/@me`)
export const createInvite = (spaceId: string, maxAgeSeconds = 604800, maxUses = 0) =>
  api<Invite>('POST', `/spaces/${spaceId}/invites`, { maxAgeSeconds, maxUses })
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

export const voiceJoin = (channelId: string) => api<VoiceJoinResponse>('POST', '/voice/join', { channelId })
