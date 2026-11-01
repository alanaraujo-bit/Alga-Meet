import { Permission, type Channel } from '@alga/shared'
import { ChevronDown, Hash, HeadphoneOff, MicOff, Plus, Search, Users, Volume2 } from 'lucide-react'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { isUnread, useData } from '@/store/data'
import { can, channelTitle, dmChannels, dmPeers, mentionCount, presenceOf, spaceChannels, spacePermissions, voiceMembers } from '@/store/selectors'
import { useUi } from '@/store/ui'
import { Avatar, Badge, contextMenuHandler, Icon, IconButton, MenuButton, PRESENCE_LABEL, ScrollArea, Tooltip } from '@/ui'
import { markSpaceRead } from '@/store/actions'
import { spaceMenu } from '../spaces/spaceMenu'
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
      <ScrollArea className={s.list}>
        <button
          type="button"
          className={s.row}
          aria-current={view.kind === 'home' ? 'page' : undefined}
          onClick={() => useUi.getState().go({ kind: 'home' })}
        >
          <span className={s.rowIcon}>
            <Icon icon={Users} size={16} />
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
  const { title, peer, unread, mentions, presence } = useData(
    useShallow((st) => {
      const peers = dmPeers(st, channel)
      const peer = channel.type === 'dm' ? (peers[0] ?? null) : null
      return {
        title: channelTitle(st, channel),
        peer,
        unread: isUnread(st, channel.id),
        mentions: mentionCount(st, channel.id),
        presence: peer ? presenceOf(st, peer.id) : null,
      }
    }),
  )
  return (
    <button
      type="button"
      className={`${s.row} ${s.rowTall} ${unread && !active ? s.rowUnread : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={() => useUi.getState().go({ kind: 'dm', channelId: channel.id })}
    >
      {peer ? (
        <Avatar user={peer} size={32} presence={presence ?? undefined} decorative />
      ) : (
        <Avatar user={{ id: channel.id, displayName: title, avatarUrl: null }} size={32} decorative />
      )}
      <span className={s.rowName}>
        {title}
        {channel.type === 'group_dm' ? (
          <span className={s.rowSub}>{(channel.recipientIds?.length ?? 0)} membros</span>
        ) : presence && presence !== 'offline' ? (
          <span className={s.rowSub}>{PRESENCE_LABEL[presence]}</span>
        ) : null}
      </span>
      <Badge count={mentions} />
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
      <ScrollArea className={s.list} onContextMenu={contextMenuHandler(() => spaceMenu(spaceId), space.name)}>
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
      onClick={() => useUi.getState().go({ kind: 'space', spaceId: channel.spaceId!, channelId: channel.id })}
      onContextMenu={contextMenuHandler(() => [{ label: t.space.markRead, onSelect: () => markSpaceRead(channel.spaceId!) }])}
    >
      <span className={s.rowIcon}>
        <Icon icon={Hash} size={16} />
      </span>
      <span className={s.rowName}>{channel.name}</span>
      <Badge count={mentions} />
    </button>
  )
}

function VoiceChannelRow({ channel, active }: { channel: Channel; active: boolean }) {
  const voiceStates = useData((st) => st.voiceStates)
  const people = useMemo(() => voiceMembers({ voiceStates }, channel.id), [voiceStates, channel.id])
  return (
    <>
      <button
        type="button"
        className={`${s.row} ${people.length ? s.voiceActive : ''}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => useUi.getState().go({ kind: 'space', spaceId: channel.spaceId!, channelId: channel.id })}
      >
        <span className={s.rowIcon}>
          <Icon icon={Volume2} size={16} />
        </span>
        <span className={s.rowName}>{channel.name}</span>
        {(people.length > 0 || !!channel.userLimit) && <span className={s.rowMeta}>{t.space.users(people.length, channel.userLimit || undefined)}</span>}
      </button>
      {people.length > 0 && (
        <ul className={s.voiceUsers} aria-label={`Pessoas em ${channel.name}`}>
          {people.map((v) => (
            <VoiceUser key={v.userId} userId={v.userId} spaceId={channel.spaceId} muted={v.selfMute || v.serverMute} deaf={v.selfDeaf || v.serverDeaf} live={v.streaming} />
          ))}
        </ul>
      )}
    </>
  )
}

function VoiceUser({ userId, spaceId, muted, deaf, live }: { userId: string; spaceId: string | null; muted: boolean; deaf: boolean; live: boolean }) {
  const user = useData((st) => st.users[userId])
  const name = useData((st) => (spaceId && st.members[spaceId]?.[userId]?.nickname) || st.users[userId]?.displayName || '…')
  if (!user) return null
  return (
    <li className={s.voiceUser}>
      <Avatar user={user} size={20} decorative />
      <span className={s.rowName}>{name}</span>
      {live && <span className={s.live}>{t.space.live}</span>}
      <span className={s.voiceFlags}>
        {deaf ? (
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
