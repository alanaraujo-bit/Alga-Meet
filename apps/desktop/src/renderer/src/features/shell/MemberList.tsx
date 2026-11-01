import { Crown } from 'lucide-react'
import type { Member, PresenceStatus, PublicUser } from '@alga/shared'
import { useMemo, useRef, useState } from 'react'
import { useMedia } from '@/media'
import { useData } from '@/store/data'
import { presenceOf, roleColor } from '@/store/selectors'
import { useSession } from '@/store/session'
import { contextMenuHandler, Fronds, Icon, Popover, ScrollArea, Tooltip } from '@/ui'
import { DecoratedAvatar, Nameplate, ProfileCard } from '../billing/Cosmetics'
import { useLook } from '../billing/store'
import { roomLevelNow } from '../voice/levels'
import { personEntries, ProfileFooter } from './people'
import { t } from './strings'
import s from './shell.module.css'

type Row = { m: Member; name: string; presence: PresenceStatus; color: string | null; room: string | null }

export function MemberList({ spaceId }: { spaceId: string }) {
  const members = useData((st) => st.members[spaceId])
  const presences = useData((st) => st.presences)
  const me = useData((st) => st.me)
  const roles = useData((st) => st.roles)
  const channels = useData((st) => st.channels)
  const ownerId = useData((st) => st.spaces[spaceId]?.ownerId)
  const voiceStates = useData((st) => st.voiceStates)
  // Presence is stale while the realtime link is down: show it as uncertain, not as fact.
  const stale = useSession((st) => st.gateway !== 'ready')

  // Voice first: whoever is in one of this space's rooms opens the list, then online, then offline.
  const groups = useMemo(() => {
    const all: Row[] = Object.values(members ?? {}).map((m) => {
      const vs = voiceStates[m.user.id]
      const ch = vs?.spaceId === spaceId ? channels[vs.channelId] : undefined
      return {
        m,
        name: m.nickname || m.user.displayName,
        presence: presenceOf({ presences, me, voiceStates }, m.user.id),
        color: roleColor({ members: { [spaceId]: members ?? {} }, roles }, spaceId, m.user.id),
        room: ch ? ch.name : null,
      }
    })
    all.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    return {
      voice: all.filter((x) => x.room),
      online: all.filter((x) => !x.room && x.presence !== 'offline'),
      offline: all.filter((x) => !x.room && x.presence === 'offline'),
    }
  }, [members, presences, me, roles, spaceId, voiceStates, channels])

  const label = { voice: t.members.voice, online: t.members.online, offline: t.members.offline }
  return (
    <ScrollArea className={`${s.members} ${stale ? s.membersStale : ''}`} aria-label="Membros">
      {(['voice', 'online', 'offline'] as const).map((k) =>
        groups[k].length === 0 ? null : (
          <section key={k} aria-label={label[k](groups[k].length)}>
            <div className={s.section}>
              {k === 'voice' && (
                <span className={`${s.accent} ${s.sectionGlyph}`}>
                  <Fronds size={12} breathing />
                </span>
              )}
              <span className={s.sectionLabel}>{label[k](groups[k].length)}</span>
            </div>
            {groups[k].map((r) => (
              <MemberRow key={r.m.user.id} row={r} spaceId={spaceId} owner={r.m.user.id === ownerId} />
            ))}
          </section>
        ),
      )}
    </ScrollArea>
  )
}

function MemberRow({ row, spaceId, owner }: { row: Row; spaceId: string; owner: boolean }) {
  const { m, name, presence, color, room } = row
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  // USER_UPDATE refreshes `users`, not the member copy: the profile (and its cosmetics) stays live.
  const user = useData((st) => st.users[m.user.id]) ?? m.user
  // My room: the fronds ride its real envelope; elsewhere they just breathe.
  const mine = useMedia((st) => st.connection.state === 'connected' && !!room && useData.getState().voiceStates[m.user.id]?.channelId === st.connection.channelId)
  // Cosmetics: subtle in a list (no motion unless hovered), the full card in the popover.
  const look = useLook(m.user.id)
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`${s.member} ${presence === 'offline' ? s.memberOffline : ''}`}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        data-cosmetic-hover
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        onContextMenu={contextMenuHandler(() => personEntries(user, { spaceId, profile: () => setAnchor(btn.current) }), name)}
      >
        <DecoratedAvatar user={user} size={32} presence={presence === 'offline' ? undefined : presence} decoration={look.decoration} />
        <span className={s.memberText}>
          <span className={s.memberName} style={color ? { color } : undefined}>
            <Nameplate id={look.nameplate} row>
              {name}
            </Nameplate>
          </span>
          {room && <span className={s.memberSub}>{room}</span>}
        </span>
        {room && (
          <Tooltip content={t.members.inVoice}>
            <span className={s.accent} role="img" aria-label={t.members.inVoice}>
              <Fronds size={14} breathing={!mine} getLevel={mine ? roomLevelNow : undefined} />
            </span>
          </Tooltip>
        )}
        {owner && (
          <Tooltip content={t.members.owner}>
            <span className={s.crown} role="img" aria-label={t.members.owner}>
              <Icon icon={Crown} size={14} />
            </span>
          </Tooltip>
        )}
      </button>
      <PersonPopover user={user} spaceId={spaceId} name={name} presence={presence} anchor={anchor} onClose={() => setAnchor(null)} />
    </>
  )
}

/** Someone's profile card with the ways to reach them (member list, chat author). */
export function PersonPopover({
  user,
  spaceId,
  name,
  presence,
  anchor,
  onClose,
  side = 'left',
}: {
  user: PublicUser
  spaceId: string | null
  name: string
  presence?: PresenceStatus
  anchor: HTMLElement | null
  onClose: () => void
  side?: 'left' | 'right'
}) {
  const look = useLook(user.id)
  return (
    <Popover anchor={anchor} onClose={onClose} side={side} align="start" gap={12} label={name} width={300}>
      <ProfileCard user={user} look={look} name={name} presence={presence}>
        {spaceId && <RoleChips userId={user.id} spaceId={spaceId} />}
        <ProfileFooter user={user} spaceId={spaceId} onDone={onClose} />
      </ProfileCard>
    </Popover>
  )
}

function RoleChips({ userId, spaceId }: { userId: string; spaceId: string }) {
  const ids = useData((st) => st.members[spaceId]?.[userId]?.roleIds)
  const roles = useData((st) => st.roles[spaceId])
  const list = useMemo(
    () => (ids ?? []).map((id) => roles?.[id]).filter((r) => !!r && r.id !== spaceId).sort((a, b) => b!.position - a!.position),
    [ids, roles, spaceId],
  )
  if (!list.length) return null
  return (
    <ul className={s.roleChips} aria-label="Cargos">
      {list.map((r) => (
        <li key={r!.id} className={s.roleChip}>
          <span className={s.roleDot} style={{ background: r!.color ?? 'var(--text-tertiary)' }} />
          {r!.name}
        </li>
      ))}
    </ul>
  )
}
