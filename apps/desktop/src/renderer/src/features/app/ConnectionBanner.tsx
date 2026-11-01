import { useEffect, useState } from 'react'
import { useSession } from '@/store/session'
import { t } from './strings'
import s from './app.module.css'

/** Seconds until the next gateway retry (null when not waiting). Re-arms on every new retryInMs. */
export function useRetryCountdown(): number | null {
  const retryInMs = useSession((st) => st.retryInMs)
  const [deadline, setDeadline] = useState<number | null>(null)
  const [, tick] = useState(0)
  useEffect(() => setDeadline(retryInMs === null ? null : Date.now() + retryInMs), [retryInMs])
  useEffect(() => {
    if (deadline === null) return
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [deadline])
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

/** Shown above the main area while the realtime connection is not ready (data stays usable). */
export function ConnectionBanner() {
  const status = useSession((st) => st.gateway)
  const secs = useRetryCountdown()
  const online = useOnline()
  if (status === 'ready' || status === 'idle' || status === 'closed') return null
  if (!online)
    return (
      <div className={`${s.banner} ${s.bannerOffline}`} role="status">
        <span className={s.bannerDot} />
        {t.banner.offline}
      </div>
    )
  return (
    <div className={s.banner} role="status" aria-live="polite">
      <span className={s.bannerDot} />
      <span className="tnum">{status === 'connecting' ? t.banner.connecting : t.banner.reconnecting(secs)}</span>
      {status === 'reconnecting' && (
        <button type="button" className={s.bannerAction} onClick={() => useSession.getState().reconnect()}>
          {t.banner.retryNow}
        </button>
      )}
    </div>
  )
}
