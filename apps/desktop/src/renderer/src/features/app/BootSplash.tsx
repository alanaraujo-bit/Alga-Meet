import { motion } from 'motion/react'
import { Button } from '@/ui'
import { useSession } from '@/store/session'
import { useRetryCountdown } from './ConnectionBanner'
import { Eco } from '@/ui/eco/Eco'
import { t } from './strings'
import s from './app.module.css'

/** Until the first READY: Eco tuning in, and the status line; failures are explained in place. */
export function BootSplash() {
  const phase = useSession((st) => st.phase)
  const gateway = useSession((st) => st.gateway)
  const secs = useRetryCountdown()
  const failing = gateway === 'reconnecting'
  return (
    <motion.main className={s.splash} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.3, delay: 0.15 } }} aria-busy="true">
      {/* Eco tunes in while the app connects (its antennae are the logo); x-eyes while the server is unreachable. */}
      <span className={`${s.splashMark} eco-alive`}>
        <Eco state={failing ? 'error' : 'connecting'} size={104} />
      </span>
      <p className={`${s.splashText} tnum`} role="status" aria-live="polite">
        {failing ? t.splash.retrying(secs ?? 0) : phase === 'booting' ? t.splash.connecting : t.splash.loading}
      </p>
      <p className={s.splashCause}>{failing ? t.splash.cause : ''}</p>
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
