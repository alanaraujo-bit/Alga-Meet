// Paused (mockup 07): half light, the frozen frame darkened, "Pedro pausou · em 1:02:13 · o mesmo frame para todos",
// Continuar (Espaço), and when it turns into the intermission. Host away: who left, and no Continuar (the server waits).
import type { Channel, CinemaSessionView } from '@alga/shared'
import { Avatar, Button, Icon, Kbd } from '@/ui'
import { Play } from '@/ui/icons'
import * as act from '../actions'
import { clock, t } from '../strings'
import { useSeatPerson } from './Seat'
import { firstName } from './seats'
import { INTERMISSION_MS } from './view'
import s from './room.module.css'

export function Paused({ session, channel, who, pausedSince, now }: { session: CinemaSessionView; channel: Channel; who: string | null; pausedSince: number | null; now: number }) {
  const p = session.playback
  const away = p.reason === 'host_away'
  const person = useSeatPerson(who ?? session.hostId, channel)
  const left = pausedSince === null ? null : Math.max(0, (INTERMISSION_MS - (now - pausedSince)) / 1000)
  return (
    <>
      {who && <Avatar user={person.user} size={56} decorative />}
      <h2 className={s.bigTitle} dir="auto">{away ? t.paused.hostAway(firstName(person.name)) : who ? t.paused.title(firstName(person.name)) : t.paused.plain}</h2>
      <p className={s.bigSub}>{away ? t.paused.hostAwaySub : t.paused.at(clock(p.position))}</p>
      {!away && (
        <div className={s.actions}>
          <Button variant="primary" size="lg" onClick={() => act.control('play')}>
            <Icon icon={Play} size={14} filled />
            {t.paused.resume}
          </Button>
          <Kbd>{t.paused.space}</Kbd>
        </div>
      )}
      {!away && left !== null && <p className={s.note}>{t.paused.toIntermission(clock(left))}</p>}
    </>
  )
}
