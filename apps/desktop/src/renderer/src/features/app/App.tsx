import '@/styles/base.css'
import { MotionConfig } from 'motion/react'
import { useEffect } from 'react'
import { useMedia } from '@/media'
import { useSession } from '@/store/session'
import { useUi } from '@/store/ui'
import { MenuHost, ToastHost, toast } from '@/ui'
import { AuthScreen } from '../auth/AuthScreen'
import { applySavedHotkeys } from '../settings/hotkeys'
import { Shell } from '../shell/Shell'
import { BootSplash } from './BootSplash'
import { TitleBar } from './TitleBar'
import s from './app.module.css'

export function App() {
  const phase = useSession((st) => st.phase)
  const hydrated = useSession((st) => st.hydrated)
  const reduced = useUi((st) => st.reducedMotion)

  useEffect(() => {
    void useSession.getState().boot()
    applySavedHotkeys()
  }, [])

  // Media engine notices (device unplugged, fallback to standard noise suppression…) surface as toasts.
  useEffect(
    () =>
      useMedia.subscribe((st, prev) => {
        if (st.notice && st.notice.id !== prev.notice?.id) toast.info(st.notice.text)
      }),
    [],
  )

  const ready = phase === 'signed_in' && hydrated
  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
      <div className={s.root}>
        <TitleBar search={ready} />
        {phase === 'signed_out' ? <AuthScreen /> : ready ? <Shell /> : <BootSplash />}
      </div>
      <MenuHost />
      <ToastHost />
    </MotionConfig>
  )
}
