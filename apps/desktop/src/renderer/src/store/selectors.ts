import { computePermissions, hasPermission, type Channel, type PresenceStatus, type PublicUser, type VoiceState } from '@alga/shared'
import { isUnread, type DataState } from './data'

/** Pure derivations over the normalized store. Components wrap them with useData + useShallow. */

type S = Pick<DataState, 'me' | 'users' | 'channels' | 'readStates' | 'spaces' | 'members' | 'roles' | 'relationships' | 'voiceStates' | 'presences'>

const byPosition = (a: Channel, b: Channel) => a.position - b.position || a.name.localeCompare(b.name, 'pt-BR')

export function spaceChannels(s: Pick<S, 'channels'>, spaceId: string): { text: Channel[]; voice: Channel[] } {
  const text: Channel[] = []
  const voice: Channel[] = []
  for (const c of Object.values(s.channels)) {
    if (c.spaceId !== spaceId) continue
    if (c.type === 'text') text.push(c)
    else if (c.type === 'voice') voice.push(c)
  }
  return { text: text.sort(byPosition), voice: voice.sort(byPosition) }
}

/** DMs, most recent activity first. */
export function dmChannels(s: Pick<S, 'channels'>): Channel[] {
  return Object.values(s.channels)
    .filter((c) => c.type === 'dm' || c.type === 'group_dm')
    .sort((a, b) => (b.lastMessageId ?? b.id).localeCompare(a.lastMessageId ?? a.id))
}

export function dmPeers(s: Pick<S, 'me' | 'users'>, c: Channel): PublicUser[] {
  return (c.recipientIds ?? []).filter((id) => id !== s.me?.id).map((id) => s.users[id]).filter((u): u is PublicUser => !!u)
}

export function channelTitle(s: Pick<S, 'me' | 'users'>, c: Channel): string {
  if (c.type !== 'dm' && c.type !== 'group_dm') return c.name
  const peers = dmPeers(s, c)
  return c.name || peers.map((u) => u.displayName).join(', ') || 'Conversa'
}

export function voiceMembers(s: Pick<S, 'voiceStates'>, channelId: string): VoiceState[] {
  return Object.values(s.voiceStates)
    .filter((v) => v.channelId === channelId)
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
}

export function mentionCount(s: Pick<S, 'readStates'>, channelId: string): number {
  return s.readStates[channelId]?.mentionCount ?? 0
}

/** Rail indicator for a space: any unread text channel, and total mentions. */
export function spaceUnread(s: Pick<S, 'channels' | 'readStates'>, spaceId: string): { unread: boolean; mentions: number } {
  let unread = false
  let mentions = 0
  for (const c of Object.values(s.channels)) {
    if (c.spaceId !== spaceId || c.type !== 'text') continue
    if (isUnread(s, c.id)) unread = true
    mentions += mentionCount(s, c.id)
  }
  return { unread, mentions }
}

/** Home badge: incoming friend requests + unread DMs (each DM counts its mentions, or 1). */
export function homeBadge(s: Pick<S, 'channels' | 'readStates' | 'relationships'>): number {
  let n = Object.values(s.relationships).filter((r) => r.type === 'incoming').length
  for (const c of Object.values(s.channels)) {
    if ((c.type === 'dm' || c.type === 'group_dm') && isUnread(s, c.id)) n += Math.max(1, mentionCount(s, c.id))
  }
  return n
}

export function displayName(s: Pick<S, 'users' | 'members'>, userId: string, spaceId?: string | null): string {
  const nick = spaceId ? s.members[spaceId]?.[userId]?.nickname : null
  return nick || s.users[userId]?.displayName || 'Usuário desconhecido'
}

export function presenceOf(s: Pick<S, 'presences' | 'me'>, userId: string): PresenceStatus {
  if (userId === s.me?.id) {
    const pref = s.me.statusPreference
    return pref === 'invisible' ? 'offline' : pref
  }
  return s.presences[userId] ?? 'offline'
}

export function spacePermissions(s: Pick<S, 'me' | 'spaces' | 'members' | 'roles'>, spaceId: string): number {
  const sp = s.spaces[spaceId]
  const me = s.me
  if (!sp || !me) return 0
  const roles = s.roles[spaceId] ?? {}
  const member = s.members[spaceId]?.[me.id]
  return computePermissions({
    isOwner: sp.ownerId === me.id,
    everyone: roles[spaceId]?.permissions ?? 0,
    roles: (member?.roleIds ?? []).map((id) => roles[id]?.permissions ?? 0),
  })
}
export const can = (perms: number, needed: number) => hasPermission(perms, needed)

/** Role color of a member's highest colored role (null = default text color). */
export function roleColor(s: Pick<S, 'members' | 'roles'>, spaceId: string, userId: string): string | null {
  const roles = s.roles[spaceId] ?? {}
  const ids = s.members[spaceId]?.[userId]?.roleIds ?? []
  let best: { color: string; position: number } | null = null
  for (const id of ids) {
    const r = roles[id]
    if (r?.color && (!best || r.position > best.position)) best = { color: r.color, position: r.position }
  }
  return best?.color ?? null
}
