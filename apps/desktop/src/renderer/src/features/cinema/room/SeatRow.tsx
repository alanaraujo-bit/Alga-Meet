// The row of seats: `foyer` (big, with free seats and the Eco keeping them) and `strip` (thin, under the film, almost
// invisible; whoever speaks lights up, even with the interface hidden).
import type { Channel, CinemaSessionView } from '@alga/shared'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useData } from '@/store/data'
import { Icon } from '@/ui'
import { Eco } from '@/ui/eco/Eco'
import { Armchair } from '@/ui/icons'
import { useCinema } from '../store'
import { t } from '../strings'
import { Seat, SeatFace, useSeatPerson } from './Seat'
import { foyerSlots, orderSeats, prepFrac, seatStatus } from './seats'
import s from './seats.module.css'

const HOP_MS = 700

export function useOrderedSeats(session: CinemaSessionView) {
  const meId = useData((st) => st.me?.id)
  return { meId, seats: orderSeats(session.seats, meId, session.hostId) }
}

export function SeatRow({ session, channel, variant, choice, ringFor, dim = 1 }: {
  session: CinemaSessionView
  channel: Channel
  variant: 'foyer' | 'strip'
  /** Foyer: what I chose to watch ("Dublado"), under my seat. */
  choice?: string | null
  /** Strip: the seat with a progress ring (the one the room waits for). */
  ringFor?: string | null
  /** Strip: resting opacity of the seats (a speaking seat always shows). */
  dim?: number
}) {
  const { meId, seats } = useOrderedSeats(session)
  // The Eco hops when someone sits next to me, then gives the place up.
  const [hopping, setHopping] = useState(false)
  const count = useRef(seats.length)
  useEffect(() => {
    const was = count.current
    count.current = seats.length
    if (variant !== 'foyer' || was !== 1 || seats.length < 2) return
    setHopping(true)
    const id = setTimeout(() => setHopping(false), HOP_MS)
    return () => clearTimeout(id)
  }, [seats.length, variant])

  if (variant === 'strip') {
    return (
      <div className={s.strip} role="group" aria-label={t.stage.seats} style={{ ['--seat-dim' as string]: dim } as CSSProperties}>
        {seats.map((x) => (
          <StripSeat key={x.userId} channel={channel} userId={x.userId} ring={ringFor === x.userId ? prepFrac({ status: 'preparing', aheadS: x.aheadS }) : null} label={seatStatus(x).text} />
        ))}
      </div>
    )
  }
  const slots = foyerSlots(seats, seats.length === 1 || hopping)
  return (
    <div className={s.row} role="group" aria-label={t.stage.seats}>
      {slots.map((slot, i) =>
        slot.kind === 'seat' ? (
          <Seat key={slot.seat.userId} seat={slot.seat} channel={channel} size={64} me={slot.seat.userId === meId} choice={slot.seat.userId === meId ? choice : null} />
        ) : slot.kind === 'eco' ? (
          <div key="eco" className={`${s.seat} ${s.eco} eco-alive`}>
            <Eco state={hopping ? 'hop' : 'idle'} size={104} />
            <div className={s.ecoTitle}>{t.seats.ecoTitle}</div>
            <div className={s.status}>{t.seats.ecoSub}</div>
          </div>
        ) : (
          <div key={`free-${i}`} className={s.seat}>
            <div className={s.free}><Icon icon={Armchair} size={20} /></div>
            <div className={`${s.name} ${s.freeName}`}>{t.seats.free}</div>
          </div>
        ),
      )}
    </div>
  )
}

function StripSeat({ userId, channel, ring, label }: { userId: string; channel: Channel; ring: number | null; label: string }) {
  const { name } = useSeatPerson(userId, channel)
  return (
    <div className={s.stripSeat} data-ring={ring !== null || undefined} role="img" aria-label={t.seats.seatOf(name, label)} data-user-id={userId}>
      <SeatFace userId={userId} channel={channel} size={28} ring={ring} check={false} />
    </div>
  )
}

/** My audio choice's short name for the foyer ("Dublado"). */
export function useMyChoice(session: CinemaSessionView): string | null {
  const audioId = useCinema((st) => st.mine.audioId)
  const subtitleId = useCinema((st) => st.mine.subtitleId)
  const a = session.film.audio.find((x) => x.id === audioId)
  if (!a) return null
  return subtitleId !== null && session.film.subtitles.some((x) => x.id === subtitleId) && !/^(por|pt)$/i.test(a.lang ?? '') ? t.film.subtitled : (a.title ?? null)
}
