import { Permission, type Channel } from '@alga/shared'
import { ChevronDown, Hash, HeadphoneOff, LogOut, MicOff, Plus, Search, ShieldOff, Users, Volume2 } from '@/ui/icons'
import { useMemo, useRef } from 'react'
import { useMedia } from '@/media'
import { useShallow } from 'zustand/react/shallow'
import { isUnread, useData } from '@/store/data'
import { can, channelTitle, dmChannels, dmPeers, mentionCount, presenceOf, spaceChannels, spacePermissions, voiceMembers } from '@/store/selectors'
import { useUi } from '@/store/ui'
import { Avatar, Badge, contextMenuHandler, Fronds, Icon, IconButton, MenuButton, ScrollArea, toast, Tooltip, useSpeakingGlow } from '@/ui'
import { leaveGroupDm, markSpaceRead } from '@/store/actions'
import { errorText } from '@/lib/errors'
import { arrowFocus } from '@/ui/floating'
import { VerifyStrip } from '../auth/VerifyEmail'
import { spaceMenu } from '../spaces/spaceMenu'
import { LiveNow } from '../voice/LiveNow'
import { roomLevelNow, useLevelGetter } from '../voice/levels'
import { joinVoice, openCall } from '../voice/voice'
import { UserPanel } from './UserPanel'
import { t } from './strings'
import s from './shell.module.css'

export function Sidebar() {
  const view = useUi((st) => st.view)
  return (
    <aside className={s.sidebar} aria-label={view.kind === 'space' ? 'Canais' : 'Conversas'}>
      {view.kind === 'space' ? <SpaceSidebar spaceId={view.spaceId} /> : <HomeSidebar />}
      <UserPanel />
    </aside>
  )
}

/** Choosing a conversation (Enter or click) puts you in its composer, also when it is already the open one. */
function openChat(view: { kind: 'dm'; channelId: string } | { kind: 'space'; spaceId: string; channelId: string }) {
  useUi.getState().go(view)
  // A new chat focuses its own composer on mount; the same chat (or the space's default one) needs the nudge.
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-composer]')?.focus())
}

// ── Home ──────────────────────────────────────────────

function HomeSidebar() {
  const view = useUi((st) => st.view)
  const channels = useData((st) => st.channels)
  const incoming = useData((st) => Object.values(st.relationships).filter((r) => r.type === 'incoming').length)
  const dms = useMemo(() => dmChannels({ channels }), [channels])
  const openSwitcher = () => useUi.getState().setSwitcher(true)
  return (
    <>
      <div className={s.sidebarHeader}>
        <button type="button" className={s.findBtn} onClick={openSwitcher}>
          <Icon icon={Search} size={14} />
          {t.home.find}
        </button>
      </div>
      <ScrollArea className={s.list} data-arrow-nav onKeyDown={arrowFocus}>
        <VerifyStrip />
        <LiveNow />
        <button
          type="button"
          className={s.row}
          aria-current={view.kind === 'home' ? 'page' : undefined}
          onClick={() => useUi.getState().go({ kind: 'home' })}
        >
          <span className={s.rowIcon}>
            <Icon icon={Users} size={16} filled={view.kind === 'home'} />
          </span>
          <span className={s.rowName}>{t.home.friends}</span>
          <Badge count={incoming} label={`${incoming} pedidos de amizade`} />
        </button>
        <div className={s.section}>
          <span className={s.sectionLabel}>{t.home.dms}</span>
          <IconButton icon={Plus} label={t.home.newDm} size="sm" onClick={openSwitcher} />
        </div>
        {dms.length === 0 ? (
          <p className={s.rowSub} style={{ padding: '4px 8px' }}>
            {t.home.noDms}
          </p>
        ) : (
          dms.map((c) => <DmRow key={c.id} channel={c} active={view.kind === 'dm' && view.channelId === c.id} />)
        )}
      </ScrollArea>
    </>
  )
}

function DmRow({ channel, active }: { channel: Channel; active: boolean }) {
  const { title, peer, unread, mentions, presence, inCall } = useData(
    useShallow((st) => {
      const peers = dmPeers(st, channel)
      const peer = channel.type === 'dm' ? (peers[0] ?? null) : null
      return {
        title: channelTitle(st, channel),
        peer,
        unread: isUnread(st, channel.id),
        mentions: mentionCount(st, channel.id),
        presence: peer ? presenceOf(st, peer.id) : null,
        inCall: Object.values(st.voiceStates).some((v) => v.channelId === channel.id),
      }
    }),
  )
  return (
    <button
      type="button"
      className={`${s.row} ${s.rowTall} ${unread && !active ? s.rowUnread : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={() => openChat({ kind: 'dm', channelId: channel.id })}
      onContextMenu={
        channel.type === 'group_dm'
          ? contextMenuHandler(() => [
              {
                label: t.space.leaveGroup,
                icon: LogOut,
                danger: true,
                onSelect: () =>
                  void leaveGroupDm(channel.id)
                    .then(() => toast.success(t.space.leftGroup(title)))
                    .catch((e: unknown) => toast.error(errorText(e))),
              },
            ], title)
          : undefined
      }
    >
      {peer ? (
        <Avatar user={peer} size={32} presence={presence ?? undefined} decorative />
      ) : (
        <Avatar user={{ id: channel.id, displayName: title, avatarUrl: null }} size={32} decorative />
      )}
      {/* One line: the presence dot already says "online"; a subtitle only when it adds something. */}
      <span className={s.rowName}>
        {title}
        {inCall ? <span className={`${s.rowSub} ${s.rowSubLive}`}>{t.space.inVoice}</span> : channel.type === 'group_dm' ? <span className={s.rowSub}>{channel.recipientIds?.length ?? 0} membros</span> : null}
      </span>
      {inCall && <Fronds size={14} breathing className={s.accent} />}
      <Badge count={mentions} mention />
    </button>
  )
}

// ── Space ─────────────────────────────────────────────

function SpaceSidebar({ spaceId }: { spaceId: string }) {
  const space = useData((st) => st.spaces[spaceId])
  const channels = useData((st) => st.channels)
  const perms = useData((st) => spacePermissions(st, spaceId))
  const view = useUi((st) => st.view)
  const activeId = view.kind === 'space' ? view.channelId : null
  const { text, voice } = useMemo(() => spaceChannels({ channels }, spaceId), [channels, spaceId])
  const manage = can(perms, Permission.MANAGE_CHANNELS)
  const create = (type: 'text' | 'voice') => useUi.getState().openModal({ kind: 'createChannel', spaceId, type })
  if (!space) return null
  return (
    <>
      <div className={s.sidebarHeader}>
        <MenuButton items={() => spaceMenu(spaceId)} label={t.space.menu}>
          <button type="button" className={s.spaceTitle}>
            <span>{space.name}</span>
            <Icon icon={ChevronDown} size={16} />
          </button>
        </MenuButton>
      </div>
      <ScrollArea className={s.list} data-arrow-nav onKeyDown={arrowFocus} onContextMenu={contextMenuHandler(() => spaceMenu(spaceId), space.name)}>
        <div className={s.section}>
          <span className={s.sectionLabel}>{t.space.text}</span>
          {manage && <IconButton icon={Plus} label={t.space.createText} size="sm" onClick={() => create('text')} />}
        </div>
        {text.map((c) => (
          <TextChannelRow key={c.id} channel={c} active={activeId === c.id} />
        ))}
        <div className={s.section}>
          <span className={s.sectionLabel}>{t.space.voice}</span>
          {manage && <IconButton icon={Plus} label={t.space.createVoice} size="sm" onClick={() => create('voice')} />}
        </div>
        {voice.map((c) => (
          <VoiceChannelRow key={c.id} channel={c} active={activeId === c.id} />
        ))}
      </ScrollArea>
    </>
  )
}

function TextChannelRow({ channel, active }: { channel: Channel; active: boolean }) {
  const unread = useData((st) => isUnread(st, channel.id))
  const mentions = useData((st) => mentionCount(st, channel.id))
  return (
    <button
      type="button"
      className={`${s.row} ${unread && !active ? s.rowUnread : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={() => openChat({ kind: 'space', spaceId: channel.spaceId!, channelId: channel.id })}
      onContextMenu={contextMenuHandler(() => [{ label: t.space.markRead, onSelect: () => markSpaceRead(channel.spaceId!) }], channel.name)}
    >
      <span className={s.rowIcon}>
        <Icon icon={Hash} size={16} filled={active} />
      </span>
      <span className={s.rowName}>{channel.name}</span>
      <Badge count={mentions} mention />
    </button>
  )
}

function VoiceChannelRow({ channel, active }: { channel: Channel; active: boolean }) {
  const voiceStates = useData((st) => st.voiceStates)
  const people = useMemo(() => voiceMembers({ voiceStates }, channel.id), [voiceStates, channel.id])
  const here = useMedia((st) => st.connection.channelId === channel.id && st.connection.state !== 'idle')
  // Discord habit kept on purpose: one click on a voice channel puts you in it.
  const open = () => {
    openCall(channel.id)
    if (!here) void joinVoice(channel.id)
  }
  return (
    <>
      <button
        type="button"
        className={`${s.row} ${people.length ? s.voiceActive : ''}`}
        aria-current={active ? 'page' : undefined}
        onClick={open}
        aria-label={here ? channel.name : `${t.space.joinVoice(channel.name)}${people.length ? `, ${people.length}` : ''}`}
      >
        <span className={s.rowIcon}>
          {people.length ? <Fronds size={16} breathing={!here} getLevel={here ? roomLevelNow : undefined} /> : <Icon icon={Volume2} size={16} filled={active} />}
        </span>
        <span className={s.rowName}>{channel.name}</span>
        {!!channel.userLimit && <span className={s.rowMeta}>{t.space.users(people.length, channel.userLimit)}</span>}
      </button>
      {people.length > 0 && (
        <ul className={s.voiceUsers} aria-label={`Pessoas em ${channel.name}`}>
          {people.map((v) => (
            <VoiceUser key={v.userId} userId={v.userId} channelId={channel.id} spaceId={channel.spaceId} muted={v.selfMute} deaf={v.selfDeaf} server={v.serverMute || v.serverDeaf} live={v.streaming} />
          ))}
        </ul>
      )}
    </>
  )
}

function VoiceUser({ userId, channelId, spaceId, muted, deaf, server, live }: { userId: string; channelId: string; spaceId: string | null; muted: boolean; deaf: boolean; server: boolean; live: boolean }) {
  const user = useData((st) => st.users[userId])
  const name = useData((st) => (spaceId && st.members[spaceId]?.[userId]?.nickname) || st.users[userId]?.displayName || '…')
  const glow = useRef<HTMLSpanElement>(null)
  useSpeakingGlow(glow, useLevelGetter(userId, channelId))
  if (!user) return null
  return (
    <li className={s.voiceUser}>
      <Avatar user={user} size={20} glowRef={glow} decorative />
      <span className={s.rowName}>{name}</span>
      {live && <span className={s.live}>{t.space.live}</span>}
      <span className={s.voiceFlags}>
        {server ? (
          <Tooltip content={t.space.serverMuted}>
            <span className={s.voiceFlagDanger} role="img" aria-label={t.space.serverMuted}>
              <Icon icon={ShieldOff} size={14} />
            </span>
          </Tooltip>
        ) : deaf ? (
          <Tooltip content={t.space.deafened}>
            <span className={s.voiceFlagDanger} role="img" aria-label={t.space.deafened}>
              <Icon icon={HeadphoneOff} size={14} />
            </span>
          </Tooltip>
        ) : muted ? (
          <Tooltip content={t.space.muted}>
            <span className={s.voiceFlagDanger} role="img" aria-label={t.space.muted}>
              <Icon icon={MicOff} size={14} />
            </span>
          </Tooltip>
        ) : null}
      </span>
    </li>
  )
}
