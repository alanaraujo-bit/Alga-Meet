import '@/styles/base.css'
import { MotionConfig } from 'motion/react'
import { useEffect } from 'react'
import { useMedia } from '@/media'
import { useData } from '@/store/data'
import { useSession } from '@/store/session'
import { useUi } from '@/store/ui'
import { MenuHost, ToastHost, toast } from '@/ui'
import { AuthScreen } from '../auth/AuthScreen'
import { applySavedHotkeys } from '../settings/hotkeys'
import '../settings/theme'
import { startZoomKeys } from '../settings/zoom'
import { Shell, ShellHosts, useShellStart } from '../shell/Shell'
import { AccountGate, needsGate } from '../trust/Gate'
import { RestrictedScreen } from '../trust/Restricted'
import { BootSplash } from './BootSplash'
import { startDeepLinks } from './deepLinks'
import { startSetupEco } from './setupEco'
import { startActivitySync } from '../activity/store'
import { startStatusSync } from '../activity/custom'
import { startSendQueue } from '@/store/actions'
import { routeStreamNotice } from '../voice/voice'
import { TitleBar } from './TitleBar'
import { MobileShell } from '../mobile/MobileShell'
import { useCompact } from '../mobile/store'
import s from './app.module.css'

export function App() {
  const phase = useSession((st) => st.phase)
  const hydrated = useSession((st) => st.hydrated)
  const reduced = useUi((st) => st.reducedMotion)
  const restricted = useSession((st) => st.restricted)
  // Terms changed or the age was never declared: asked once, before the shell.
  const gate = useData((st) => needsGate(st.me))
  // The PWA on a phone: no window chrome, the tab-and-stack layout instead of the desktop's columns.
  const compact = useCompact()

  useEffect(() => {
    void useSession.getState().boot()
    applySavedHotkeys()
  }, [])
  // Signed in or not: links are held until the screen that uses them exists.
  useEffect(() => startDeepLinks(), [])
  useEffect(() => startActivitySync(), [])
  useEffect(() => startStatusSync(), [])
  useEffect(() => startSendQueue(), [])
  useEffect(() => startZoomKeys(), [])
  useEffect(() => startSetupEco(), [])

  // Media engine notices (device unplugged, fallback to standard noise suppression…) surface as toasts; the ones
  // about your stream go on your tile while the call is on screen.
  useEffect(
    () =>
      useMedia.subscribe((st, prev) => {
        if (st.notice && st.notice.id !== prev.notice?.id && !routeStreamNotice(st.notice.text)) toast.info(st.notice.text)
      }),
    [],
  )

  const ready = phase === 'signed_in' && hydrated
  const shell = ready && !gate
  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
      <div className={s.root} data-compact={compact || undefined}>
        {!compact && <TitleBar search={shell} />}
        {phase === 'signed_out' ? restricted ? <RestrictedScreen restriction={restricted} /> : <AuthScreen /> : ready ? gate ? <AccountGate /> : compact ? <MobileShell /> : <Shell /> : <BootSplash />}
      </div>
      {/* Outside the layouts on purpose: turning a phone (or narrowing the browser) swaps Shell and MobileShell, and
          that must not leave the call or close a dialog. */}
      {shell && <SignedIn />}
      <MenuHost />
      <ToastHost />
    </MotionConfig>
  )
}

/** The signed-in app's services (voice, notifications, music…) and floating hosts, mounted once for both layouts. */
function SignedIn() {
  useShellStart()
  return <ShellHosts />
}
