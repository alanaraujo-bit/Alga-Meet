import type {
  Activity, Channel, CustomStatus, Dispatch, Me, Member, Message, PresenceStatus, PublicUser, ReadState, Relationship, Role, Space, VoiceState,
} from '@alga/shared'
import { create } from 'zustand'

export interface MessageList {
  /** Ascending by id (UUIDv7 = chronological). */
  ids: string[]
  byId: Record<string, Message>
  /** More history exists before ids[0]. */
  hasMoreBefore: boolean
  loading: boolean
}

export interface DataState {
  me: Me | null
  users: Record<string, PublicUser>
  presences: Record<string, PresenceStatus>
  /** userId -> what they are doing now (rich presence; your own lives in features/activity/store). */
  activities: Record<string, Activity>
  /** userId -> custom status (yours lives in features/activity/status). */
  customs: Record<string, CustomStatus>
  spaces: Record<string, Space>
  /** Space rail order. */
  spaceOrder: string[]
  channels: Record<string, Channel>
  /** spaceId -> userId -> Member */
  members: Record<string, Record<string, Member>>
  /** spaceId -> roleId -> Role */
  roles: Record<string, Record<string, Role>>
  relationships: Record<string, Relationship>
  /** userId -> VoiceState (a user is in at most one voice channel). */
  voiceStates: Record<string, VoiceState>
  readStates: Record<string, ReadState>
  messages: Record<string, MessageList>
  /** channelId -> userId -> expiry epoch ms */
  typing: Record<string, Record<string, number>>
  /** Optimistic messages (keyed by nonce) whose send failed: kept in place for retry/discard. A string = why. */
  sendFailures: Record<string, true | string>
  /** Upload progress 0..1 of optimistic messages with files (keyed by nonce). */
  uploads: Record<string, number>
  apply(d: Dispatch): void
  /** Insert a page of history (newest-first from the API) or optimistic messages. */
  upsertMessages(channelId: string, msgs: Message[], opts?: { hasMoreBefore?: boolean }): void
  removeMessage(channelId: string, id: string): void
  setMessagesLoading(channelId: string, loading: boolean): void
  setSendFailed(nonce: string, failed: boolean | string): void
  setUpload(nonce: string, progress: number | null): void
  /** Local read-state move (ack is optimistic; the server echoes READ_STATE_UPDATE). */
  markRead(channelId: string, messageId: string): void
  reset(): void
}

const empty = {
  me: null,
  users: {},
  presences: {},
  activities: {},
  customs: {},
  spaces: {},
  spaceOrder: [],
  channels: {},
  members: {},
  roles: {},
  relationships: {},
  voiceStates: {},
  readStates: {},
  messages: {},
  typing: {},
  sendFailures: {},
  uploads: {},
} satisfies Omit<DataState, 'apply' | 'upsertMessages' | 'removeMessage' | 'setMessagesLoading' | 'setSendFailed' | 'setUpload' | 'markRead' | 'reset'>

const byId = <T extends { id: string }>(xs: T[]): Record<string, T> => Object.fromEntries(xs.map((x) => [x.id, x]))
/**
 * People no longer a friend nor in any shared space stop sending us presence (the server's audience): drop what we
 * last heard (status, activity, custom status) so a frozen "Jogando…" does not linger on their profile.
 */
function forgetUnseen(s: Pick<DataState, 'me' | 'relationships' | 'members' | 'presences' | 'activities' | 'customs'>, ids: string[]) {
  const gone = ids.filter((id) => id !== s.me?.id && s.relationships[id]?.type !== 'friend' && !Object.values(s.members).some((m) => m[id]))
  if (!gone.length) return {}
  const drop = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([k]) => !gone.includes(k)))
  return { presences: drop(s.presences), activities: drop(s.activities), customs: drop(s.customs) }
}

const omit = <T>(rec: Record<string, T>, key: string): Record<string, T> => {
  const { [key]: _, ...rest } = rec
  return rest
}
const emptyList = (): MessageList => ({ ids: [], byId: {}, hasMoreBefore: true, loading: false })
/**
 * Message authors as users: READY only lists people I still share a space/DM/relationship with, so someone banned
 * or gone would be "Usuário desconhecido" in old history. Fresher copies in `users` win.
 */
const authorsOf = (msgs: Message[]): Record<string, PublicUser> => Object.fromEntries(msgs.map((m) => [m.author.id, m.author]))

function mergeMessages(list: MessageList, msgs: Message[]): MessageList {
  const map = { ...list.byId }
  for (const m of msgs) {
    // Reconcile optimistic message (keyed by nonce) with the server copy.
    if (m.nonce && map[m.nonce]) delete map[m.nonce]
    map[m.id] = m
  }
  return { ...list, byId: map, ids: Object.keys(map).sort() }
}

export function patchReaction(m: Message, emoji: string, delta: 1 | -1, mine: boolean): Message {
  const existing = m.reactions.find((r) => r.emoji === emoji)
  // Own reactions are applied optimistically; the gateway echo must not count them twice.
  if (mine && (delta > 0 ? existing?.me : !existing?.me)) return m
  let reactions = existing
    ? m.reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + delta, me: mine ? delta > 0 : r.me } : r))
    : delta > 0
      ? [...m.reactions, { emoji, count: 1, me: mine }]
      : m.reactions
  reactions = reactions.filter((r) => r.count > 0)
  return { ...m, reactions }
}

export const useData = create<DataState>()((set, get) => ({
  ...empty,

  reset: () => set(empty),

  setSendFailed: (nonce, failed) =>
    set((s) => ({ sendFailures: failed ? { ...s.sendFailures, [nonce]: failed } : omit(s.sendFailures, nonce) })),

  setUpload: (nonce, progress) => set((s) => ({ uploads: progress === null ? omit(s.uploads, nonce) : { ...s.uploads, [nonce]: progress } })),

  markRead: (channelId, messageId) =>
    set((s) => {
      const cur = s.readStates[channelId]
      if (cur?.lastReadMessageId && cur.lastReadMessageId >= messageId) return {}
      return { readStates: { ...s.readStates, [channelId]: { channelId, lastReadMessageId: messageId, mentionCount: 0 } } }
    }),

  setMessagesLoading: (channelId, loading) =>
    set((s) => ({ messages: { ...s.messages, [channelId]: { ...(s.messages[channelId] ?? emptyList()), loading } } })),

  upsertMessages: (channelId, msgs, opts) =>
    set((s) => {
      const list = mergeMessages(s.messages[channelId] ?? emptyList(), msgs)
      if (opts?.hasMoreBefore !== undefined) list.hasMoreBefore = opts.hasMoreBefore
      const users = msgs.some((m) => !s.users[m.author.id]) ? { ...authorsOf(msgs), ...s.users } : s.users
      return { messages: { ...s.messages, [channelId]: list }, users }
    }),

  removeMessage: (channelId, id) =>
    set((s) => {
      const list = s.messages[channelId]
      if (!list?.byId[id]) return {}
      return { messages: { ...s.messages, [channelId]: { ...list, byId: omit(list.byId, id), ids: list.ids.filter((x) => x !== id) } } }
    }),

  apply: (ev) => {
    const s = get()
    switch (ev.t) {
      case 'READY': {
        const r = ev.d
        const members: DataState['members'] = {}
        const roles: DataState['roles'] = {}
        const channels: Record<string, Channel> = byId(r.privateChannels)
        for (const sp of r.spaces) Object.assign(channels, byId(sp.channels))
        // READY has no messages: keep loaded history only where nothing was missed while offline.
        const messages = Object.fromEntries(
          Object.entries(s.messages).filter(([cid, list]) => {
            const last = channels[cid]?.lastMessageId
            const newest = list.ids.findLast((id) => list.byId[id]?.nonce !== id)
            return !!channels[cid] && (!last || (!!newest && newest >= last))
          }),
        )
        const users: Record<string, PublicUser> = { ...authorsOf(Object.values(messages).flatMap((l) => Object.values(l.byId))), ...byId(r.users) }
        for (const sp of r.spaces) {
          members[sp.id] = Object.fromEntries(sp.members.map((m) => [m.user.id, m]))
          roles[sp.id] = byId(sp.roles)
          for (const m of sp.members) users[m.user.id] = m.user
        }
        for (const rel of r.relationships) users[rel.user.id] = rel.user
        users[r.user.id] = r.user
        set({
          me: r.user,
          users,
          presences: Object.fromEntries(r.presences.map((p) => [p.userId, p.status])),
          activities: Object.fromEntries(r.presences.flatMap((p) => (p.activity ? [[p.userId, p.activity]] : []))),
          customs: Object.fromEntries(r.presences.flatMap((p) => (p.custom ? [[p.userId, p.custom]] : []))),
          spaces: Object.fromEntries(r.spaces.map(({ channels: _c, roles: _r, members: _m, ...sp }) => [sp.id, sp])),
          spaceOrder: r.spaces.map((sp) => sp.id),
          channels,
          members,
          roles,
          relationships: Object.fromEntries(r.relationships.map((x) => [x.user.id, x])),
          voiceStates: Object.fromEntries(r.voiceStates.map((v) => [v.userId, v])),
          readStates: Object.fromEntries(r.readStates.map((x) => [x.channelId, x])),
          messages,
          typing: {},
        })
        return
      }
      case 'ME_UPDATE':
        return set({ me: ev.d, users: { ...s.users, [ev.d.id]: ev.d } })
      case 'USER_UPDATE':
        return set({ users: { ...s.users, [ev.d.id]: ev.d } })
      case 'PRESENCE_UPDATE':
        return set({
          presences: { ...s.presences, [ev.d.userId]: ev.d.status },
          activities: ev.d.activity ? { ...s.activities, [ev.d.userId]: ev.d.activity } : omit(s.activities, ev.d.userId),
          customs: ev.d.custom ? { ...s.customs, [ev.d.userId]: ev.d.custom } : omit(s.customs, ev.d.userId),
        })
      case 'RELATIONSHIP_UPSERT':
        return set({
          relationships: { ...s.relationships, [ev.d.user.id]: ev.d },
          users: { ...s.users, [ev.d.user.id]: ev.d.user },
        })
      case 'RELATIONSHIP_REMOVE': {
        const next = { ...s, relationships: omit(s.relationships, ev.d.userId) }
        return set({ relationships: next.relationships, ...forgetUnseen(next, [ev.d.userId]) })
      }
      case 'SPACE_CREATE': {
        const { channels: chs, roles: rs, members: ms, ...sp } = ev.d
        const users = { ...s.users }
        for (const m of ms) users[m.user.id] = m.user
        return set({
          spaces: { ...s.spaces, [sp.id]: sp },
          spaceOrder: s.spaceOrder.includes(sp.id) ? s.spaceOrder : [...s.spaceOrder, sp.id],
          channels: { ...s.channels, ...byId(chs) },
          roles: { ...s.roles, [sp.id]: byId(rs) },
          members: { ...s.members, [sp.id]: Object.fromEntries(ms.map((m) => [m.user.id, m])) },
          users,
        })
      }
      case 'SPACE_UPDATE':
        return set({ spaces: { ...s.spaces, [ev.d.id]: ev.d } })
      case 'SPACE_DELETE': {
        const id = ev.d.id
        return set({
          spaces: omit(s.spaces, id),
          spaceOrder: s.spaceOrder.filter((x) => x !== id),
          channels: Object.fromEntries(Object.entries(s.channels).filter(([, c]) => c.spaceId !== id)),
          members: omit(s.members, id),
          ...forgetUnseen({ ...s, members: omit(s.members, id) }, Object.keys(s.members[id] ?? {})),
          roles: omit(s.roles, id),
          voiceStates: Object.fromEntries(Object.entries(s.voiceStates).filter(([, v]) => v.spaceId !== id)),
        })
      }
      case 'MEMBER_ADD':
      case 'MEMBER_UPDATE':
        return set({
          members: { ...s.members, [ev.d.spaceId]: { ...s.members[ev.d.spaceId], [ev.d.user.id]: ev.d } },
          users: { ...s.users, [ev.d.user.id]: ev.d.user },
        })
      case 'MEMBER_REMOVE': {
        const members = { ...s.members, [ev.d.spaceId]: omit(s.members[ev.d.spaceId] ?? {}, ev.d.userId) }
        // Me leaving: everyone of that space may be out of reach now.
        const who = ev.d.userId === s.me?.id ? Object.keys(s.members[ev.d.spaceId] ?? {}) : [ev.d.userId]
        return set({ members, ...forgetUnseen({ ...s, members }, who) })
      }
      case 'ROLE_UPSERT':
        return set({ roles: { ...s.roles, [ev.d.spaceId]: { ...s.roles[ev.d.spaceId], [ev.d.id]: ev.d } } })
      case 'ROLE_DELETE': {
        const ms = s.members[ev.d.spaceId] ?? {}
        const id = ev.d.id
        return set({
          roles: { ...s.roles, [ev.d.spaceId]: omit(s.roles[ev.d.spaceId] ?? {}, id) },
          members: {
            ...s.members,
            [ev.d.spaceId]: Object.fromEntries(Object.entries(ms).map(([k, m]) => [k, m.roleIds.includes(id) ? { ...m, roleIds: m.roleIds.filter((r) => r !== id) } : m])),
          },
        })
      }
      case 'CHANNEL_CREATE':
      case 'CHANNEL_UPDATE':
        return set({ channels: { ...s.channels, [ev.d.id]: ev.d } })
      case 'CHANNEL_DELETE':
        return set({ channels: omit(s.channels, ev.d.id), messages: omit(s.messages, ev.d.id) })
      case 'MESSAGE_CREATE': {
        const m = ev.d
        const ch = s.channels[m.channelId]
        const typing = s.typing[m.channelId]
        get().upsertMessages(m.channelId, [m])
        set({
          channels: ch && (!ch.lastMessageId || ch.lastMessageId < m.id) ? { ...s.channels, [ch.id]: { ...ch, lastMessageId: m.id } } : s.channels,
          typing: typing ? { ...s.typing, [m.channelId]: omit(typing, m.author.id) } : s.typing,
        })
        // My own message (any device) never makes a channel unread.
        if (m.author.id === s.me?.id) get().markRead(m.channelId, m.id)
        return
      }
      case 'MESSAGE_UPDATE':
        return get().upsertMessages(ev.d.channelId, [ev.d])
      case 'MESSAGE_DELETE':
        return get().removeMessage(ev.d.channelId, ev.d.id)
      case 'REACTION_ADD':
      case 'REACTION_REMOVE': {
        const list = s.messages[ev.d.channelId]
        const msg = list?.byId[ev.d.messageId]
        if (!list || !msg) return
        const next = patchReaction(msg, ev.d.emoji, ev.t === 'REACTION_ADD' ? 1 : -1, ev.d.userId === s.me?.id)
        return set({ messages: { ...s.messages, [ev.d.channelId]: { ...list, byId: { ...list.byId, [msg.id]: next } } } })
      }
      case 'TYPING_START':
        if (ev.d.userId === s.me?.id) return
        return set({
          typing: { ...s.typing, [ev.d.channelId]: { ...s.typing[ev.d.channelId], [ev.d.userId]: Date.now() + 8000 } },
        })
      case 'READ_STATE_UPDATE':
        return set({ readStates: { ...s.readStates, [ev.d.channelId]: ev.d } })
      case 'VOICE_STATE_UPDATE':
        return set({ voiceStates: { ...s.voiceStates, [ev.d.userId]: ev.d } })
      case 'VOICE_STATE_REMOVE': {
        const cur = s.voiceStates[ev.d.userId]
        if (!cur || cur.channelId !== ev.d.channelId) return
        return set({ voiceStates: omit(s.voiceStates, ev.d.userId) })
      }
      case 'CALL_RING':
        return // UI layer subscribes to the gateway for transient events like rings.
    }
  },
}))

/** Channel has messages newer than what the user has read. */
export function isUnread(s: Pick<DataState, 'channels' | 'readStates'>, channelId: string): boolean {
  const last = s.channels[channelId]?.lastMessageId
  if (!last) return false
  const read = s.readStates[channelId]?.lastReadMessageId
  return !read || read < last
}
