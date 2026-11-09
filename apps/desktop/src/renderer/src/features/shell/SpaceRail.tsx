import { MessageCircle, Plus, ShieldCheck, Sparkle } from '@/ui/icons'
import { useMemo } from 'react'
import { useMedia } from '@/media'
import { useData } from '@/store/data'
import { homeBadge, spaceUnread } from '@/store/selectors'
import { useUi } from '@/store/ui'
import { Badge, contextMenuHandler, Icon, MenuButton, Tooltip, VoiceDot } from '@/ui'
import { hueFor, initials } from '@/ui/Avatar'
import { arrowFocus } from '@/ui/floating'
import { roomLevelNow } from '../voice/levels'
import { isMutedIn, useNotify, useSilenced } from '../app/notifyPrefs'
import { spaceMenu } from '../spaces/spaceMenu'
import { openStaff } from '../staff/store'
import { t as tstaff } from '../staff/strings'
import { t } from '../app/strings'
import { unviewed } from '../whatsnew/logic'
import { openCenter, useWhatsNew } from '../whatsnew/store'
import { t as tnew } from '../whatsnew/strings'
import s from './shell.module.css'

export function SpaceRail() {
  const view = useUi((st) => st.view)
  const order = useData((st) => st.spaceOrder)
  const relationships = useData((st) => st.relationships)
  const channels = useData((st) => st.channels)
  const readStates = useData((st) => st.readStates)
  const prefs = useNotify()
  const home = useMemo(() => homeBadge({ channels, readStates, relationships }, (id) => isMutedIn(prefs, id)), [channels, readStates, relationships, prefs])
  const dmCall = useData((st) => Object.values(st.voiceStates).some((v) => v.spaceId === null))
  const staff = useData((st) => !!st.me?.staffRole)
  const fresh = useWhatsNew((st) => (st.notes && st.seen ? unviewed(st.notes, st.seen).length > 0 : false))
  const centerOpen = useWhatsNew((st) => st.center !== null)

  return (
    <nav className={s.rail} aria-label="Espaços">
      <div className={s.railScroll} data-arrow-nav onKeyDown={arrowFocus}>
        <div className={s.railItem}>
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
                  <VoiceDot />
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
        <div className={s.railItem}>
          <Tooltip content={tnew.rail} side="right">
            <button
              type="button"
              className={`${s.spaceBtn} ${s.addBtn}`}
              aria-label={fresh ? tnew.railNew : tnew.rail}
              aria-pressed={centerOpen}
              onClick={() => openCenter()}
            >
              <Icon icon={Sparkle} size={20} filled={centerOpen} />
              {fresh && <span className={s.railUnread} aria-hidden />}
            </button>
          </Tooltip>
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
  const prefs = useNotify()
  const silenced = useSilenced(spaceId)
  const counts = useMemo(() => spaceUnread({ channels, readStates }, spaceId, (id) => isMutedIn(prefs, id)), [channels, readStates, spaceId, prefs])
  // A silenced space keeps its @mention badge (someone called you) but never shows the unread dot.
  const { unread, mentions } = { unread: counts.unread && !silenced, mentions: counts.mentions }
  const voice = useData((st) => Object.values(st.voiceStates).some((v) => v.spaceId === spaceId))
  // When I'm in this space's voice, the dot's ring rides the room's real envelope; elsewhere the dot is still.
  const mine = useMedia((st) => st.connection.state === 'connected' && !!st.connection.channelId && useData.getState().channels[st.connection.channelId]?.spaceId === spaceId)
  if (!space) return null
  const open = () => {
    const ui = useUi.getState()
    ui.go({ kind: 'space', spaceId, channelId: ui.lastChannelBySpace[spaceId] ?? null })
  }
  const label = mentions > 0 ? `${space.name}, ${t.rail.mentions(mentions)}` : unread && !active ? `${space.name}, ${t.rail.unread}` : space.name
  return (
    <div className={s.railItem}>
      <Tooltip content={space.name} side="right">
        <button
          type="button"
          className={`${s.spaceBtn} ${space.iconUrl ? '' : s.monogram}`}
          style={space.iconUrl ? undefined : { ['--tile-h' as string]: hueFor(spaceId) }}
          aria-current={active ? 'page' : undefined}
          aria-label={voice ? `${label}, ${t.rail.inVoice}` : label}
          onClick={open}
          onContextMenu={contextMenuHandler(() => spaceMenu(spaceId), space.name)}
        >
          {space.iconUrl ? <img src={space.iconUrl} alt="" draggable={false} /> : initials(space.name)}
          {unread && !active && mentions === 0 && <span className={s.railUnread} aria-hidden />}
          {/* Separate corners: a mention never hides "people are talking there" (dot bottom, count top). */}
          {mentions > 0 && (
            <span className={s.railBadge}>
              <Badge count={mentions} mention />
            </span>
          )}
          {voice && (
            <span className={s.railVoice}>
              <VoiceDot getLevel={mine ? roomLevelNow : undefined} />
            </span>
          )}
        </button>
      </Tooltip>
    </div>
  )
}
