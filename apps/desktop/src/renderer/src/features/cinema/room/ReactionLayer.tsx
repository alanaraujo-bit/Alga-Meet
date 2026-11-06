// Reactions rising from the seat of who reacted (1.6 s; with reduced motion they appear in place and fade).
import type { CinemaSessionView } from '@alga/shared'
import { useEffect } from 'react'
import { startReactions, useReactions } from './reactions'
import { useOrderedSeats } from './SeatRow'
import s from './room.module.css'

/** Center of seat k of n in the strip: 28 px seats, 14 px apart. */
const STRIP_STEP = 42

export function ReactionLayer({ session }: { session: CinemaSessionView }) {
  useEffect(() => startReactions(), [])
  const flying = useReactions((st) => st.q.flying)
  const { seats } = useOrderedSeats(session)
  return (
    <div className={s.flyLayer} aria-hidden>
      {flying.map((f) => {
        const k = seats.findIndex((x) => x.userId === f.userId)
        const dx = k < 0 ? 0 : (k - (seats.length - 1) / 2) * STRIP_STEP
        return (
          <span key={f.id} className={s.fly} style={{ left: `calc(50% + ${dx}px)` }}>
            {f.emoji}
          </span>
        )
      })}
    </div>
  )
}
