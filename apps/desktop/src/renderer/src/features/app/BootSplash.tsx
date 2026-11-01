import { motion } from 'motion/react'
import { Button } from '@/ui'
import { useSession } from '@/store/session'
import { useRetryCountdown } from './ConnectionBanner'
import { LogoMark } from './Logo'
import { t } from './strings'
import s from './app.module.css'

/** Until the first READY: the mark "breathes" like a voice; failures are explained in place. */
export function BootSplash() {
  const phase = useSession((st) => st.phase)
  const gateway = useSession((st) => st.gateway)
  const secs = useRetryCountdown()
  const failing = gateway === 'reconnecting'
  return (
    <motion.main className={s.splash} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.3, delay: 0.15 } }} aria-busy="true">
      <span className={s.splashMark}>
        <LogoMark size={44} breathing />
      </span>
      <p className={`${s.splashText} tnum`} role="status" aria-live="polite">
        {failing ? t.splash.retrying(secs ?? 0) : phase === 'booting' ? t.splash.connecting : t.splash.loading}
      </p>
      <div className={s.splashActions}>
        {failing && (
          <>
            <Button variant="secondary" onClick={() => useSession.getState().reconnect()}>
              {t.splash.retryNow}
            </Button>
            <Button variant="ghost" onClick={() => void useSession.getState().logout()}>
              {t.splash.signOut}
            </Button>
          </>
        )}
      </div>
    </motion.main>
  )
}
