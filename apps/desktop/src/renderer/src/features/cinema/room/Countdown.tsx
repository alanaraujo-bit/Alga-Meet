// The lights go down (spec §7.3.4): a thin 3 s ring that empties toward `at`, the same instant for everyone; with
// reduced motion it is the text "Começa em 3". Mount it keyed by `at`.
import { CINEMA_COUNTDOWN_MS } from '@alga/shared'
import { useState } from 'react'
import { t } from '../strings'
import { reducedMotion } from './prefs'
import s from './room.module.css'

const SIZE = 56
const R = 26

export function Countdown({ at, now }: { at: number; now: number }) {
  // the ring runs on CSS from where the countdown is at mount, so it stays smooth between the room's ticks
  const [elapsed] = useState(() => Math.min(CINEMA_COUNTDOWN_MS, Math.max(0, CINEMA_COUNTDOWN_MS - (at - now))))
  const n = Math.max(1, Math.ceil(Math.max(0, at - now) / 1000))
  if (reducedMotion()) return <p className={s.countText} role="status">{t.countdown(n)}</p>
  const c = 2 * Math.PI * R
  return (
    <svg className={s.count} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={t.countdown(n)}>
      <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="2" />
      <circle
        className={s.countArc}
        cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"
        strokeDasharray={c.toFixed(2)} transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        style={{ ['--c' as string]: c.toFixed(2), animationDuration: `${CINEMA_COUNTDOWN_MS}ms`, animationDelay: `-${elapsed}ms` }}
      />
    </svg>
  )
}
