// Credits and the next episode (mockup 10): "Próximo: S01E03 — … · Começa em 10 s · mesmas poltronas". The host's
// client prepared the next file before announcing it; only the host can watch now or cancel, everyone sees the card.
import type { Channel, CinemaSessionView } from '@alga/shared'
import { useData } from '@/store/data'
import { Button, Icon } from '@/ui'
import { Check, Play } from '@/ui/icons'
import { hostCancelNext, hostSwitchNext } from '../store'
import { t } from '../strings'
import { Cover } from './CallCard'
import { useSeatPerson } from './Seat'
import { firstName } from './seats'
import { NEXT_UP_S } from './view'
import s from './room.module.css'

export function NextUp({ session, channel, nextUpS }: { session: CinemaSessionView; channel: Channel; nextUpS: number | null }) {
  const isHost = useData((st) => st.me?.id === session.hostId)
  const host = useSeatPerson(session.hostId, channel)
  const next = session.next
  if (!next) return null
  const left = Math.min(NEXT_UP_S, Math.max(0, nextUpS ?? NEXT_UP_S))
  return (
    <section className={s.nextCard} aria-label={t.next.label(next.title, left)}>
      <div className={s.nextPic}>
        {/* the next file's frames exist only once it plays: its cover is the placeholder */}
        <Cover url={null} />
        <div className={s.nextBar} aria-hidden>
          <i style={{ width: `${((NEXT_UP_S - left) / NEXT_UP_S) * 100}%` }} />
        </div>
      </div>
      <div className={s.nextBody}>
        <div className={s.nextTitle} dir="auto">{t.next.title(next.title)}</div>
        <div className={s.nextSub}>
          {t.next.startsIn} <b>{t.next.secs(left)}</b> · {t.next.sameSeats}
        </div>
        <div className={s.nextNote}>
          <Icon icon={Check} size={12} />
          <span dir="auto">{isHost ? t.next.preparedMine : t.next.prepared(firstName(host.name))}</span>
        </div>
        {isHost && (
          <div className={s.nextActions}>
            <Button variant="primary" onClick={hostSwitchNext}><Icon icon={Play} size={14} filled />{t.next.watchNow}</Button>
            <Button variant="secondary" onClick={hostCancelNext}>{t.next.cancel}</Button>
          </div>
        )}
      </div>
    </section>
  )
}
