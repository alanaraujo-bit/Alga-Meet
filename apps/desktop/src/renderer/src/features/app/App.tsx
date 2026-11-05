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
import { startZoomKeys } from '../settings/zoom'
import { Shell } from '../shell/Shell'
import { AccountGate, needsGate } from '../trust/Gate'
import { RestrictedScreen } from '../trust/Restricted'
import { BootSplash } from './BootSplash'
import { startDeepLinks } from './deepLinks'
import { startActivitySync } from '../activity/store'
import { routeStreamNotice } from '../voice/voice'
import { TitleBar } from './TitleBar'
import s from './app.module.css'

export function App() {
  const phase = useSession((st) => st.phase)
  const hydrated = useSession((st) => st.hydrated)
  const reduced = useUi((st) => st.reducedMotion)
  const restricted = useSession((st) => st.restricted)
  // Terms changed or the age was never declared: asked once, before the shell.
  const gate = useData((st) => needsGate(st.me))

  useEffect(() => {
    void useSession.getState().boot()
    applySavedHotkeys()
  }, [])
  // Signed in or not: links are held until the screen that uses them exists.
  useEffect(() => startDeepLinks(), [])
  useEffect(() => startActivitySync(), [])
  useEffect(() => startZoomKeys(), [])

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
  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
      <div className={s.root}>
        <TitleBar search={ready && !gate} />
        {phase === 'signed_out' ? restricted ? <RestrictedScreen restriction={restricted} /> : <AuthScreen /> : ready ? gate ? <AccountGate /> : <Shell /> : <BootSplash />}
      </div>
      <MenuHost />
      <ToastHost />
    </MotionConfig>
  )
}
