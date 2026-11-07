import type { Member, PresenceStatus, PublicUser } from '@alga/shared'
import { useMemo, useRef, useState } from 'react'
import { useData } from '@/store/data'
import { presenceOf, roleColor } from '@/store/selectors'
import { useSession } from '@/store/session'
import { contextMenuHandler, Popover, ScrollArea } from '@/ui'
import { DecoratedAvatar, Nameplate, ProfileCard } from '../billing/Cosmetics'
import { useLook } from '../billing/store'
import { ProfileStoreActions } from '../billing/TryOn'
import { ActivityBadge, ActivityCard } from '../activity/Activity'
import { PersonLine, StatusBubble } from '../activity/Status'
import { useCustomStatus } from '../activity/custom'
import { useActivity } from '../activity/store'
import { ProfileOpener } from '../profile/Opener'
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
    <ScrollArea className={`${s.members} ${stale ? s.membersStale : ''}`} role="complementary" aria-label="Membros">
      {(['voice', 'online', 'offline'] as const).map((k) =>
        groups[k].length === 0 ? null : (
          <section key={k} aria-label={label[k](groups[k].length)}>
            <div className={s.section}>
              <span className={s.sectionLabel}>{label[k](groups[k].length)}</span>
            </div>
            {groups[k].map((r) => (
              <MemberRow key={r.m.user.id} row={r} spaceId={spaceId} />
            ))}
          </section>
        ),
      )}
    </ScrollArea>
  )
}

function MemberRow({ row, spaceId }: { row: Row; spaceId: string }) {
  const { m, name, presence, color, room } = row
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  // USER_UPDATE refreshes `users`, not the member copy: the profile (and its cosmetics) stays live.
  const user = useData((st) => st.users[m.user.id]) ?? m.user
  // Cosmetics: subtle in a list (no motion unless hovered), the full card in the popover.
  const look = useLook(m.user.id)
  const activity = useActivity(m.user.id)
  const custom = useCustomStatus(m.user.id)
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
          {room ? (
            <span className={s.memberSub}>{room}</span>
          ) : (
            (activity || custom) && (
              <span className={s.memberSub}>
                <PersonLine userId={m.user.id} />
              </span>
            )
          )}
        </span>
        {room && activity && <ActivityBadge userId={m.user.id} />}
      </button>
      <PersonPopover user={user} spaceId={spaceId} name={name} presence={presence} anchor={anchor} onClose={() => setAnchor(null)} />
    </>
  )
}

/** PersonPopover from just an id (voice rows, call seats): resolves the user, their nickname here and presence. */
export function UserPopover({ userId, spaceId, anchor, onClose, side = 'right' }: { userId: string; spaceId: string | null; anchor: HTMLElement | null; onClose: () => void; side?: 'left' | 'right' }) {
  const user = useData((st) => st.users[userId])
  const name = useData((st) => (spaceId && st.members[spaceId]?.[userId]?.nickname) || st.users[userId]?.displayName || '')
  const presence = useData((st) => presenceOf(st, userId))
  if (!user || !anchor) return null
  return <PersonPopover user={user} spaceId={spaceId} name={name} presence={presence === 'offline' ? undefined : presence} anchor={anchor} onClose={onClose} side={side} />
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
        <ProfileOpener userId={user.id} spaceId={spaceId} onOpen={onClose} />
        <StatusBubble userId={user.id} />
        <ActivityCard userId={user.id} />
        {spaceId && <RoleChips userId={user.id} spaceId={spaceId} />}
        <ProfileStoreActions user={user} onDone={onClose} />
        <ProfileFooter user={user} spaceId={spaceId} onDone={onClose} />
      </ProfileCard>
    </Popover>
  )
}

function RoleChips({ userId, spaceId }: { userId: string; spaceId: string }) {
  // "Dono" lives here as a chip (critique r3 #5), not as a crown in the member list.
  const owner = useData((st) => st.spaces[spaceId]?.ownerId === userId)
  const ids = useData((st) => st.members[spaceId]?.[userId]?.roleIds)
  const roles = useData((st) => st.roles[spaceId])
  const list = useMemo(
    () => (ids ?? []).map((id) => roles?.[id]).filter((r) => !!r && r.id !== spaceId).sort((a, b) => b!.position - a!.position),
    [ids, roles, spaceId],
  )
  if (!list.length && !owner) return null
  return (
    <ul className={s.roleChips} aria-label="Cargos">
      {owner && <li className={`${s.roleChip} ${s.ownerChip}`}>{t.members.owner}</li>}
      {list.map((r) => (
        <li key={r!.id} className={s.roleChip}>
          <span className={s.roleDot} style={{ background: r!.color ?? 'var(--text-tertiary)' }} />
          {r!.name}
        </li>
      ))}
    </ul>
  )
}
