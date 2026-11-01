import { Crown } from 'lucide-react'
import type { Member, PresenceStatus } from '@alga/shared'
import { useMemo, useState } from 'react'
import { useData } from '@/store/data'
import { presenceOf, roleColor } from '@/store/selectors'
import { useSession } from '@/store/session'
import { Fronds, Icon, Popover, ScrollArea, Tooltip } from '@/ui'
import { DecoratedAvatar, Nameplate, ProfileCard } from '../billing/Cosmetics'
import { useLook } from '../billing/store'
import { t } from './strings'
import s from './shell.module.css'

export function MemberList({ spaceId }: { spaceId: string }) {
  const members = useData((st) => st.members[spaceId])
  const presences = useData((st) => st.presences)
  const me = useData((st) => st.me)
  const roles = useData((st) => st.roles)
  const ownerId = useData((st) => st.spaces[spaceId]?.ownerId)
  const voice = useData((st) => st.voiceStates)
  // Presence is stale while the realtime link is down: show it as uncertain, not as fact.
  const stale = useSession((st) => st.gateway !== 'ready')

  const groups = useMemo(() => {
    const all = Object.values(members ?? {}).map((m) => ({
      m,
      name: m.nickname || m.user.displayName,
      presence: presenceOf({ presences, me }, m.user.id),
      color: roleColor({ members: { [spaceId]: members ?? {} }, roles }, spaceId, m.user.id),
    }))
    all.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    return { online: all.filter((x) => x.presence !== 'offline'), offline: all.filter((x) => x.presence === 'offline') }
  }, [members, presences, me, roles, spaceId])

  return (
    <ScrollArea className={`${s.members} ${stale ? s.membersStale : ''}`} aria-label="Membros">
      {(['online', 'offline'] as const).map((k) =>
        groups[k].length === 0 ? null : (
          <section key={k} aria-label={k === 'online' ? 'Online' : 'Offline'}>
            <div className={s.section}>
              <span className={s.sectionLabel}>{k === 'online' ? t.members.online(groups[k].length) : t.members.offline(groups[k].length)}</span>
            </div>
            {groups[k].map(({ m, name, presence, color }) => (
              <MemberRow key={m.user.id} m={m} name={name} presence={presence} color={color} inVoice={voice[m.user.id]?.spaceId === spaceId} owner={m.user.id === ownerId} />
            ))}
          </section>
        ),
      )}
    </ScrollArea>
  )
}

function MemberRow({ m, name, presence, color, inVoice, owner }: { m: Member; name: string; presence: PresenceStatus; color: string | null | undefined; inVoice: boolean; owner: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  // Cosmetics: subtle in a list (no motion unless hovered), the full card in the popover.
  const look = useLook(m.user.id)
  return (
    <>
      <button
        type="button"
        className={`${s.member} ${presence === 'offline' ? s.memberOffline : ''}`}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        data-cosmetic-hover
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <DecoratedAvatar user={m.user} size={32} presence={presence === 'offline' ? undefined : presence} decoration={look.decoration} />
        <span className={s.memberName} style={color ? { color } : undefined}>
          <Nameplate id={look.nameplate} row>
            {name}
          </Nameplate>
        </span>
        {inVoice && (
          <Tooltip content={t.members.inVoice}>
            <span className={s.accent} role="img" aria-label={t.members.inVoice}>
              <Fronds size={14} breathing />
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
      <Popover anchor={anchor} onClose={() => setAnchor(null)} side="left" align="start" gap={12} label={name} width={280}>
        <ProfileCard user={m.user} look={look} name={name} presence={presence} />
      </Popover>
    </>
  )
}
