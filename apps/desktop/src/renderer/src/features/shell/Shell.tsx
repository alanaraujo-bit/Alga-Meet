import { motion } from 'motion/react'
import { useEffect, useMemo, useRef } from 'react'
import { useData } from '@/store/data'
import { spaceChannels } from '@/store/selectors'
import { useUi } from '@/store/ui'
import { EmptyState, Button } from '@/ui'
import { Hash } from 'lucide-react'
import { EASE_OUT_QUART } from '@/ui/motion'
import { useDeepLink } from '../app/deepLinks'
import { startBilling } from '../billing/store'
import { startNotifications } from '../app/notifications'
import { ChatView } from '../chat/ChatView'
import { FriendsView } from '../friends/FriendsView'
import { Onboarding, useNeedsOnboarding } from '../onboarding/Onboarding'
import { SettingsOverlay } from '../settings/SettingsOverlay'
import { SpaceModals } from '../spaces/SpaceModals'
import { SpaceSettingsOverlay } from '../spaceSettings/SpaceSettings'
import { VerifyEmailDialog } from '../auth/VerifyEmail'
import { QuickSwitcher } from '../switcher/QuickSwitcher'
import { CallStage } from '../voice/CallStage'
import { IncomingCall } from '../voice/IncomingCall'
import { ScreenPicker } from '../voice/ScreenPicker'
import { startVoiceSync } from '../voice/voice'
import { MemberList } from './MemberList'
import { Sidebar } from './Sidebar'
import { SpaceRail } from './SpaceRail'
import { t } from './strings'
import s from './shell.module.css'

export function Shell() {
  useGlobalShortcuts()
  useViewGuard()
  useEffect(() => startVoiceSync(), [])
  useEffect(() => startNotifications(), [])
  useEffect(() => startBilling(), [])
  useInviteLink()
  const view = useUi((st) => st.view)
  const order = useData((st) => st.spaceOrder)

  // Spatial continuity: the sheet slides in from the direction of the rail item you moved to.
  const ctx = view.kind === 'space' ? view.spaceId : 'home'
  const index = ctx === 'home' ? -1 : order.indexOf(ctx)
  const prevIndex = useRef(index)
  const dir = index === prevIndex.current ? 0 : index > prevIndex.current ? 1 : -1
  useEffect(() => {
    prevIndex.current = index
  }, [index])

  return (
    <motion.div className={s.body} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.24 } }}>
      <SpaceRail />
      <motion.div
        key={ctx}
        className={s.sheet}
        initial={dir === 0 ? false : { opacity: 0.4, y: dir * 10 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.18, ease: EASE_OUT_QUART } }}
      >
        <Sidebar />
        <main className={s.main}>
          <MainArea />
        </main>
      </motion.div>
      <SpaceModals />
      <QuickSwitcher />
      <ScreenPicker />
      <IncomingCall />
      <SettingsOverlay />
      <SpaceSettingsOverlay />
      <VerifyEmailDialog />
    </motion.div>
  )
}

function MainArea() {
  const view = useUi((st) => st.view)
  const needsOnboarding = useNeedsOnboarding()
  if (view.kind === 'home') return needsOnboarding ? <Onboarding /> : <FriendsView />
  if (view.kind === 'dm') return <ChatView key={view.channelId} channelId={view.channelId} />
  return <SpaceMain spaceId={view.spaceId} channelId={view.channelId} />
}

function SpaceMain({ spaceId, channelId }: { spaceId: string; channelId: string | null }) {
  const channels = useData((st) => st.channels)
  const memberList = useUi((st) => st.memberList)
  const { text, voice } = useMemo(() => spaceChannels({ channels }, spaceId), [channels, spaceId])
  const ch = (channelId && channels[channelId]) || text[0] || voice[0]
  if (!ch) {
    return (
      <EmptyState
        icon={Hash}
        title={t.space.noChannels}
        actions={
          <Button variant="primary" onClick={() => useUi.getState().openModal({ kind: 'createChannel', spaceId, type: 'text' })}>
            {t.space.createText}
          </Button>
        }
      >
        {t.space.noChannelsBody}
      </EmptyState>
    )
  }
  if (ch.type === 'voice') return <CallStage key={ch.id} channel={ch} />
  return <ChatView key={ch.id} channelId={ch.id} aside={memberList ? <MemberList spaceId={spaceId} /> : null} />
}

/** algameet://invite/<code>: the join preview, as soon as there is a signed-in shell (links can arrive signed out). */
function useInviteLink() {
  const code = useDeepLink((x) => x.inviteCode)
  useEffect(() => {
    if (!code) return
    useDeepLink.setState({ inviteCode: null })
    useUi.getState().openModal({ kind: 'joinSpace', code })
  }, [code])
}

/** Leave views that no longer exist (left a space, channel deleted). */
function useViewGuard() {
  const view = useUi((st) => st.view)
  const exists = useData((st) => (view.kind === 'home' ? true : view.kind === 'dm' ? !!st.channels[view.channelId] : !!st.spaces[view.spaceId]))
  const channelGone = useData((st) => view.kind === 'space' && !!view.channelId && !st.channels[view.channelId])
  useEffect(() => {
    if (!exists) useUi.getState().go({ kind: 'home' })
    else if (channelGone && view.kind === 'space') useUi.getState().go({ kind: 'space', spaceId: view.spaceId, channelId: null })
  }, [exists, channelGone, view])
}

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const ui = useUi.getState()
        ui.setSwitcher(!ui.switcherOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
