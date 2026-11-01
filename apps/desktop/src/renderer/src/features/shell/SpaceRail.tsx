import { MessageCircle, Plus, ShieldCheck } from '@/ui/icons'
import { useMemo } from 'react'
import { useMedia } from '@/media'
import { useData } from '@/store/data'
import { homeBadge, spaceUnread } from '@/store/selectors'
import { useUi } from '@/store/ui'
import { Badge, contextMenuHandler, Fronds, Icon, MenuButton, Tooltip, tintFor } from '@/ui'
import { initials } from '@/ui/Avatar'
import { arrowFocus } from '@/ui/floating'
import { roomLevelNow } from '../voice/levels'
import { spaceMenu } from '../spaces/spaceMenu'
import { openStaff } from '../staff/store'
import { t as tstaff } from '../staff/strings'
import { t } from '../app/strings'
import s from './shell.module.css'

export function SpaceRail() {
  const view = useUi((st) => st.view)
  const order = useData((st) => st.spaceOrder)
  const relationships = useData((st) => st.relationships)
  const channels = useData((st) => st.channels)
  const readStates = useData((st) => st.readStates)
  const home = useMemo(() => homeBadge({ channels, readStates, relationships }), [channels, readStates, relationships])
  const dmCall = useData((st) => Object.values(st.voiceStates).some((v) => v.spaceId === null))
  const staff = useData((st) => !!st.me?.staffRole)

  return (
    <nav className={s.rail} aria-label="Espaços">
      <div className={s.railScroll} data-arrow-nav onKeyDown={arrowFocus}>
        <div className={s.railItem}>
          <span className={`${s.pill} ${view.kind !== 'space' ? s.pillActive : ''}`} />
          <Tooltip content={t.rail.home} side="right">
            <button
              type="button"
              className={`${s.spaceBtn} ${s.homeBtn}`}
              aria-current={view.kind !== 'space' ? 'page' : undefined}
              aria-label={t.rail.home}
              onClick={() => useUi.getState().go({ kind: 'home' })}
            >
              <Icon icon={MessageCircle} size={20} filled={view.kind !== 'space'} />
              {home > 0 && (
                <span className={s.railBadge}>
                  <Badge count={home} />
                </span>
              )}
              {dmCall && (
                <span className={s.railVoice}>
                  <Fronds size={12} breathing />
                </span>
              )}
            </button>
          </Tooltip>
        </div>
        {order.length > 0 && <span className={s.railSep} />}
        {order.map((id) => (
          <SpaceIcon key={id} spaceId={id} active={view.kind === 'space' && view.spaceId === id} />
        ))}
        <div className={s.railItem}>
          <MenuButton
            side="right"
            align="start"
            label={t.rail.addSpace}
            items={() => [
              { label: t.rail.createSpace, icon: Plus, onSelect: () => useUi.getState().openModal({ kind: 'createSpace' }) },
              { label: t.rail.joinSpace, icon: MessageCircle, onSelect: () => useUi.getState().openModal({ kind: 'joinSpace' }) },
            ]}
          >
            <button type="button" className={`${s.spaceBtn} ${s.addBtn}`} aria-label={t.rail.addSpace}>
              <Icon icon={Plus} size={20} />
            </button>
          </MenuButton>
        </div>
        {staff && (
          <div className={s.railItem}>
            <Tooltip content={tstaff.open} side="right">
              <button type="button" className={`${s.spaceBtn} ${s.addBtn}`} aria-label={tstaff.open} onClick={openStaff}>
                <Icon icon={ShieldCheck} size={20} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    </nav>
  )
}

function SpaceIcon({ spaceId, active }: { spaceId: string; active: boolean }) {
  const space = useData((st) => st.spaces[spaceId])
  const channels = useData((st) => st.channels)
  const readStates = useData((st) => st.readStates)
  const { unread, mentions } = useMemo(() => spaceUnread({ channels, readStates }, spaceId), [channels, readStates, spaceId])
  const voice = useData((st) => Object.values(st.voiceStates).some((v) => v.spaceId === spaceId))
  // When I'm in this space's voice, the fronds ride the room's real envelope; elsewhere they just breathe.
  const mine = useMedia((st) => st.connection.state === 'connected' && !!st.connection.channelId && useData.getState().channels[st.connection.channelId]?.spaceId === spaceId)
  if (!space) return null
  const open = () => {
    const ui = useUi.getState()
    ui.go({ kind: 'space', spaceId, channelId: ui.lastChannelBySpace[spaceId] ?? null })
  }
  const label = mentions > 0 ? `${space.name}, ${t.rail.mentions(mentions)}` : space.name
  return (
    <div className={s.railItem}>
      <span className={`${s.pill} ${active ? s.pillActive : unread ? s.pillUnread : ''}`} />
      <Tooltip content={space.name} side="right">
        <button
          type="button"
          className={s.spaceBtn}
          style={space.iconUrl ? undefined : { ['--tile' as string]: tintFor(spaceId) }}
          aria-current={active ? 'page' : undefined}
          aria-label={voice ? `${label}, ${t.rail.inVoice}` : label}
          onClick={open}
          onContextMenu={contextMenuHandler(() => spaceMenu(spaceId), space.name)}
        >
          {space.iconUrl ? <img src={space.iconUrl} alt="" draggable={false} /> : initials(space.name)}
          {/* Separate corners: a mention never hides "people are talking there" (fronds bottom, count top). */}
          {mentions > 0 && (
            <span className={s.railBadge}>
              <Badge count={mentions} mention />
            </span>
          )}
          {voice && (
            <span className={s.railVoice}>
              <Fronds size={12} breathing={!mine} getLevel={mine ? roomLevelNow : undefined} />
            </span>
          )}
        </button>
      </Tooltip>
    </div>
  )
}
