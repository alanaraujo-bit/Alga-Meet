import { Crown } from 'lucide-react'
import { useMemo } from 'react'
import { useData } from '@/store/data'
import { presenceOf, roleColor } from '@/store/selectors'
import { Avatar, Icon, ScrollArea, Tooltip } from '@/ui'
import { t } from './strings'
import s from './shell.module.css'

export function MemberList({ spaceId }: { spaceId: string }) {
  const members = useData((st) => st.members[spaceId])
  const presences = useData((st) => st.presences)
  const me = useData((st) => st.me)
  const roles = useData((st) => st.roles)
  const ownerId = useData((st) => st.spaces[spaceId]?.ownerId)

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
    <ScrollArea className={s.members} aria-label="Membros">
      {(['online', 'offline'] as const).map((k) =>
        groups[k].length === 0 ? null : (
          <section key={k} aria-label={k === 'online' ? 'Online' : 'Offline'}>
            <div className={s.section}>
              <span className={s.sectionLabel}>{k === 'online' ? t.members.online(groups[k].length) : t.members.offline(groups[k].length)}</span>
            </div>
            {groups[k].map(({ m, name, presence, color }) => (
              <div key={m.user.id} className={`${s.member} ${presence === 'offline' ? s.memberOffline : ''}`}>
                <Avatar user={m.user} size={32} presence={presence === 'offline' ? undefined : presence} />
                <span className={s.memberName} style={color ? { color } : undefined}>
                  {name}
                </span>
                {m.user.id === ownerId && (
                  <Tooltip content={t.members.owner}>
                    <span className={s.crown} role="img" aria-label={t.members.owner}>
                      <Icon icon={Crown} size={14} />
                    </span>
                  </Tooltip>
                )}
              </div>
            ))}
          </section>
        ),
      )}
    </ScrollArea>
  )
}
