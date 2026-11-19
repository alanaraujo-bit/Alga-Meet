import { AnimatePresence, motion } from 'motion/react'
import { useMemo, type ReactNode } from 'react'
import { media, useMedia } from '@/media'
import { useData } from '@/store/data'
import { homeBadge, spaceUnread } from '@/store/selectors'
import { useSession } from '@/store/session'
import { useUi } from '@/store/ui'
import { Avatar, Badge, Icon, Switch, toast, VoiceDot } from '@/ui'
import { hueFor, initials } from '@/ui/Avatar'
import {
  Bell,
  ChevronRight,
  CreditCard,
  LayoutGrid,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  Palette,
  PhoneOff,
  Plus,
  Shield,
  ShieldCheck,
  Sparkle,
  Storefront,
  User,
  UserRound,
  Users,
  Volume2,
  type Glyph,
} from '@/ui/icons'
import { isMutedIn, useNotify, useSilenced } from '../app/notifyPrefs'
import { disablePush, enablePush, usePush } from '../app/push'
import { ChatView } from '../chat/ChatView'
import { FriendsView } from '../friends/FriendsView'
import { openProfile } from '../profile/store'
import { openSettings, type SettingsSection } from '../settings/store'
import { HomeSidebar, SpaceSidebar } from '../shell/Sidebar'
import { SpaceMain } from '../shell/Shell'
import { openStaff } from '../staff/store'
import { leaveVoice, openCall, useVoice } from '../voice/voice'
import { openCenter } from '../whatsnew/store'
import { InstallCard } from './Install'
import { Stack } from './Stack'
import { depthOf, selectTab, useMobile, useMobileRouting, type MobileTab } from './store'
import { t } from './strings'
import m from './mobile.module.css'

export function MobileShell() {
  useMobileRouting()
  const tab = useMobile((st) => st.tab)
  const open = useMobile((st) => st.open)
  const view = useUi((st) => st.view)
  const depth = depthOf(tab, view, open)
  // Inside a conversation the tab bar steps aside: the composer and the keyboard get the room, as in native chat apps.
  const bar = !(tab === 'spaces' && depth === 2) && !(tab === 'dms' && depth === 1)
  return (
    <motion.div className={m.app} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.24 } }}>
      <div className={m.screens}>
        {tab === 'spaces' && <SpacesTab />}
        {tab === 'dms' && <DmsTab />}
        {tab === 'friends' && <Stack layers={[<FriendsView key="f" />]} />}
        {tab === 'you' && <Stack layers={[<YouScreen key="y" />]} />}
      </div>
      <CallPill raised={bar} />
      <AnimatePresence initial={false}>{bar && <TabBar key="bar" />}</AnimatePresence>
    </motion.div>
  )
}

// ── Tabs ───────────────────────────────────────────

function SpacesTab() {
  const view = useUi((st) => st.view)
  const open = useMobile((st) => st.open)
  const layers: ReactNode[] = [<SpacesScreen key="list" />]
  if (view.kind === 'space') {
    layers.push(
      <div key="space" className={m.column}>
        <SpaceSidebar spaceId={view.spaceId} />
      </div>,
    )
    if (open && view.channelId) layers.push(<SpaceMain key="ch" spaceId={view.spaceId} channelId={view.channelId} />)
  }
  return <Stack layers={layers} />
}

function DmsTab() {
  const view = useUi((st) => st.view)
  const open = useMobile((st) => st.open)
  const layers: ReactNode[] = [
    <div key="list" className={m.column}>
      <div className={m.titlePad}>
        <LargeTitle>{t.tabs.dms}</LargeTitle>
      </div>
      <HomeSidebar friends={false} />
    </div>,
  ]
  if (view.kind === 'dm' && open) layers.push(<ChatView key={view.channelId} channelId={view.channelId} />)
  return <Stack layers={layers} />
}

function TabBar() {
  const tab = useMobile((st) => st.tab)
  const channels = useData((st) => st.channels)
  const readStates = useData((st) => st.readStates)
  const relationships = useData((st) => st.relationships)
  const order = useData((st) => st.spaceOrder)
  const prefs = useNotify()
  const quiet = (id: string) => isMutedIn(prefs, id)
  const dms = useMemo(() => homeBadge({ channels, readStates, relationships: {} }, quiet), [channels, readStates, prefs]) // eslint-disable-line react-hooks/exhaustive-deps
  const requests = useMemo(() => Object.values(relationships).filter((r) => r.type === 'incoming').length, [relationships])
  const mentions = useMemo(() => order.reduce((n, id) => n + spaceUnread({ channels, readStates }, id, quiet).mentions, 0), [order, channels, readStates, prefs]) // eslint-disable-line react-hooks/exhaustive-deps
  const items: { id: MobileTab; icon: Glyph; label: string; badge: number }[] = [
    { id: 'spaces', icon: LayoutGrid, label: t.tabs.spaces, badge: mentions },
    { id: 'dms', icon: MessageCircle, label: t.tabs.dms, badge: dms },
    { id: 'friends', icon: Users, label: t.tabs.friends, badge: requests },
    { id: 'you', icon: UserRound, label: t.tabs.you, badge: 0 },
  ]
  return (
    <motion.nav
      className={m.tabbar}
      aria-label="Navegação"
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', stiffness: 500, damping: 42 }}
    >
      {items.map((it) => (
        <button key={it.id} type="button" className={m.tab} aria-current={tab === it.id ? 'page' : undefined} onClick={() => selectTab(it.id)}>
          <span className={m.tabIcon}>
            <Icon icon={it.icon} size={24} filled={tab === it.id} />
            {it.badge > 0 && (
              <span className={m.tabBadge}>
                <Badge count={it.badge} mention />
              </span>
            )}
          </span>
          <span className={m.tabLabel}>{it.label}</span>
        </button>
      ))}
    </motion.nav>
  )
}

// ── Screens ────────────────────────────────────────

function LargeTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <header className={m.largeTitle}>
      <h1>{children}</h1>
      {action}
    </header>
  )
}

function SpacesScreen() {
  const order = useData((st) => st.spaceOrder)
  return (
    <div className={m.column}>
      <div className={m.scroll}>
        <LargeTitle
          action={
            <button type="button" className={m.roundBtn} aria-label={t.spaces.create} onClick={() => useUi.getState().openModal({ kind: 'createSpace' })}>
              <Icon icon={Plus} size={20} />
            </button>
          }
        >
          {t.spaces.title}
        </LargeTitle>
        {order.length === 0 && <p className={m.empty}>{t.spaces.empty}</p>}
        <ul className={m.group}>
          {order.map((id) => (
            <SpaceRow key={id} spaceId={id} />
          ))}
        </ul>
        <ul className={m.group}>
          <Row icon={Plus} label={t.spaces.create} onClick={() => useUi.getState().openModal({ kind: 'createSpace' })} />
          <Row icon={MessageCircle} label={t.spaces.join} onClick={() => useUi.getState().openModal({ kind: 'joinSpace' })} />
        </ul>
      </div>
    </div>
  )
}

function SpaceRow({ spaceId }: { spaceId: string }) {
  const space = useData((st) => st.spaces[spaceId])
  const channels = useData((st) => st.channels)
  const readStates = useData((st) => st.readStates)
  const prefs = useNotify()
  const silenced = useSilenced(spaceId)
  const counts = useMemo(() => spaceUnread({ channels, readStates }, spaceId, (id) => isMutedIn(prefs, id)), [channels, readStates, spaceId, prefs])
  const voice = useData((st) => Object.values(st.voiceStates).filter((v) => v.spaceId === spaceId).length)
  if (!space) return null
  const unread = counts.unread && !silenced
  return (
    <li>
      <button type="button" className={m.row} onClick={() => useUi.getState().go({ kind: 'space', spaceId, channelId: null })}>
        <span className={m.tile} style={space.iconUrl ? undefined : { ['--tile-h' as string]: hueFor(spaceId) }}>
          {space.iconUrl ? <img src={space.iconUrl} alt="" draggable={false} /> : initials(space.name)}
        </span>
        <span className={m.rowText}>
          <span className={`${m.rowName} ${unread ? m.rowUnread : ''}`}>{space.name}</span>
          {voice > 0 && (
            <span className={m.rowSub}>
              <VoiceDot /> {voice} {t.spaces.inVoice}
            </span>
          )}
        </span>
        <Badge count={counts.mentions} mention />
        {unread && counts.mentions === 0 && <span className={m.dot} aria-label="mensagens novas" />}
        <Icon icon={ChevronRight} size={16} />
      </button>
    </li>
  )
}

function Row({ icon, label, onClick, danger }: { icon: Glyph; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <li>
      <button type="button" className={`${m.row} ${danger ? m.danger : ''}`} onClick={onClick}>
        <span className={m.rowGlyph}>
          <Icon icon={icon} size={20} />
        </span>
        <span className={m.rowText}>
          <span className={m.rowName}>{label}</span>
        </span>
        {!danger && <Icon icon={ChevronRight} size={16} />}
      </button>
    </li>
  )
}

function YouScreen() {
  const me = useData((st) => st.me)
  const staff = !!me?.staffRole
  const go = (s: SettingsSection) => () => openSettings(s)
  if (!me) return null
  return (
    <div className={m.column}>
      <div className={m.scroll}>
        <LargeTitle>{t.you.title}</LargeTitle>
        <button type="button" className={m.meCard} onClick={() => openProfile(me.id)}>
          <Avatar user={me} size={56} decorative />
          <span className={m.rowText}>
            <span className={m.meName}>{me.displayName ?? me.username}</span>
            <span className={m.rowSub}>@{me.username}</span>
          </span>
          <Icon icon={ChevronRight} size={16} />
        </button>
        <InstallCard />
        <PushCard />
        <ul className={m.group}>
          <Row icon={User} label={t.you.account} onClick={go('account')} />
          <Row icon={Shield} label={t.you.privacy} onClick={go('privacy')} />
          <Row icon={Bell} label={t.you.notifications} onClick={go('notifications')} />
          <Row icon={Volume2} label={t.you.voice} onClick={go('voice')} />
          <Row icon={Palette} label={t.you.appearance} onClick={go('appearance')} />
        </ul>
        <ul className={m.group}>
          <Row icon={CreditCard} label={t.you.plan} onClick={go('plan')} />
          <Row icon={Storefront} label={t.you.shop} onClick={go('shop')} />
          <Row icon={Sparkle} label={t.you.news} onClick={() => openCenter()} />
          {staff && <Row icon={ShieldCheck} label={t.you.staff} onClick={openStaff} />}
        </ul>
        <ul className={m.group}>
          <Row icon={LogOut} label={t.you.logout} danger onClick={() => void useSession.getState().logout()} />
        </ul>
        <p className={m.version}>Alga Meet {window.alga.config.version}</p>
      </div>
    </div>
  )
}

/** Notifications on this phone: the switch, or what to do first (install on iOS, allow in the browser). */
function PushCard() {
  const { state, busy } = usePush()
  if (state === 'unsupported' || state === 'unavailable') return null
  const text = t.push[state]
  return (
    <div className={m.pushCard} data-on={state === 'on' || undefined}>
      <span className={m.rowGlyph}>
        <Icon icon={Bell} size={20} filled={state === 'on'} />
      </span>
      <span className={m.rowText}>
        <span className={m.rowName}>{text.title}</span>
        <span className={m.rowSub}>{text.body}</span>
      </span>
      {(state === 'off' || state === 'on') && (
        <Switch checked={state === 'on'} label={text.title} disabled={busy} onChange={(v) => void (v ? enablePush() : disablePush()).catch(() => toast.error(t.push.failed))} />
      )}
    </div>
  )
}

/** Back on the call's screen, also when the view already points at it (it was only popped off the stack). */
function reopen(channelId: string) {
  openCall(channelId)
  const dm = !useData.getState().channels[channelId]?.spaceId
  useMobile.setState({ tab: dm ? 'dms' : 'spaces', open: true })
}

/** You are in a call but looking elsewhere: a pill to get back, mute or leave (the tray's job on the desktop). */
function CallPill({ raised }: { raised: boolean }) {
  const conn = useMedia((st) => st.connection)
  const muted = useMedia((st) => st.self.muted)
  const view = useUi((st) => st.view)
  const tab = useMobile((st) => st.tab)
  const open = useMobile((st) => st.open)
  const stage = useVoice((st) => st.stage)
  const channelId = conn.state === 'connected' || conn.state === 'reconnecting' ? conn.channelId : null
  const viewing = !!channelId && open && ((tab === 'spaces' && view.kind === 'space' && view.channelId === channelId) || (tab === 'dms' && view.kind === 'dm' && view.channelId === channelId) || stage === channelId)
  return (
    <AnimatePresence>
      {channelId && !viewing && (
        <motion.div
          key="pill"
          className={m.pill}
          data-raised={raised || undefined}
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 520, damping: 38 }}
        >
          <button type="button" className={m.pillMain} onClick={() => reopen(channelId)} aria-label={t.call.open}>
            <VoiceDot />
            <span className={m.pillText}>
              <strong>{t.call.inCall}</strong>
              <span>{conn.channelName ?? ''}</span>
            </span>
          </button>
          <button type="button" className={m.pillBtn} aria-pressed={muted} aria-label={muted ? t.call.unmute : t.call.mute} onClick={() => void media.toggleMute()}>
            <Icon icon={muted ? MicOff : Mic} size={20} />
          </button>
          <button type="button" className={`${m.pillBtn} ${m.pillLeave}`} aria-label={t.call.leave} onClick={leaveVoice}>
            <Icon icon={PhoneOff} size={20} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
