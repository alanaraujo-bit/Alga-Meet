import { useEffect, useState } from 'react'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { t } from './strings'
import s from './chat.module.css'

/** "Ana está digitando…" — entries expire on their own (the store keeps an expiry per user). */
export function TypingIndicator({ channelId, spaceId }: { channelId: string; spaceId: string | null }) {
  const entries = useData((st) => st.typing[channelId])
  const users = useData((st) => st.users)
  const members = useData((st) => st.members)
  const [now, setNow] = useState(Date.now())
  const active = Object.entries(entries ?? {}).filter(([, exp]) => exp > now)
  useEffect(() => {
    if (!active.length) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active.length])
  useEffect(() => setNow(Date.now()), [entries])
  const names = active.map(([id]) => displayName({ users, members }, id, spaceId))
  return (
    <div className={s.typing} aria-live="polite">
      {names.length > 0 && (
        <>
          <span className={s.typingDots} aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span>{t.typing(names)}…</span>
        </>
      )}
    </div>
  )
}
