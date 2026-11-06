// Waiting for someone (mockup 08): their seat with the ring of what they hold ahead, "6 de 10 s", and
// "Continuar sem …" (continue_without). A start/seek that takes a while: who is still loading.
import { CINEMA_RESUME_AHEAD_S, type Channel, type CinemaSessionView } from '@alga/shared'
import { useShallow } from 'zustand/react/shallow'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { Button } from '@/ui'
import * as act from '../actions'
import { t } from '../strings'
import { SeatFace, useSeatPerson } from './Seat'
import { firstName } from './seats'
import s from './room.module.css'

export function Waiting({ session, channel, who }: { session: CinemaSessionView; channel: Channel; who: string | null }) {
  const person = useSeatPerson(who ?? session.hostId, channel)
  const seat = session.seats.find((x) => x.userId === who)
  const loading = useData(useShallow((st) => session.seats.filter((x) => x.status !== 'ready' && x.status !== 'unsupported').map((x) => firstName(displayName(st, x.userId, channel.spaceId)))))
  if (!who) {
    return (
      <>
        <h2 className={s.bigTitle}>{t.waiting.loading}</h2>
        {loading.length > 0 && <p className={s.bigSub} dir="auto">{t.waiting.loadingWho(loading.join(' e '))}</p>}
      </>
    )
  }
  const ahead = Math.min(CINEMA_RESUME_AHEAD_S, Math.floor(seat?.aheadS ?? 0))
  const name = firstName(person.name)
  return (
    <>
      <SeatFace userId={who} channel={channel} size={64} ring={ahead / CINEMA_RESUME_AHEAD_S} check={false} />
      <h2 className={`${s.bigTitle} ${s.afterRing}`} dir="auto">{t.waiting.title(name)}</h2>
      <p className={s.bigSub}>{t.waiting.sub(CINEMA_RESUME_AHEAD_S)}</p>
      <p className={s.progress}>{t.waiting.progress(ahead, CINEMA_RESUME_AHEAD_S)}</p>
      <div className={s.actions}>
        <Button variant="secondary" size="lg" onClick={() => act.continueWithout(who)}>{t.waiting.continueWithout(name)}</Button>
      </div>
    </>
  )
}
