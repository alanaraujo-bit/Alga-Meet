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

/**
 * Realtime link status as a chip in the title bar (where the search sits), so nothing below moves when the
 * connection wobbles. Returns null while ready.
 */
export function ConnectionChip() {
  const status = useSession((st) => st.gateway)
  const secs = useRetryCountdown()
  const online = useOnline()
  if (status === 'ready' || status === 'idle' || status === 'closed') return null
  return (
    <div className={`${s.chip} ${!online ? s.chipOffline : ''}`} role="status" aria-live="polite">
      <span className={s.bannerDot} />
      <span className={`${s.chipText} tnum`}>{!online ? t.banner.offline : status === 'connecting' ? t.banner.connecting : t.banner.reconnecting(secs)}</span>
      {online && status === 'reconnecting' && (
        <button type="button" className={s.bannerAction} onClick={() => useSession.getState().reconnect()}>
          {t.banner.retryNow}
        </button>
      )}
    </div>
  )
}
