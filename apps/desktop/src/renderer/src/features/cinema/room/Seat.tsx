// One seat: the person's avatar with the call's speaking glow (it lights even with the interface hidden), the thin
// preparing ring (indigo when ready), the ✓, the name and the status. `strip` is the thin one under the film.
import type { Channel, CinemaSeat } from '@alga/shared'
import { useRef, type ReactNode } from 'react'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { Avatar, Icon, useEnvelope, type AvatarSize } from '@/ui'
import { Check } from '@/ui/icons'
import { useLevelGetter } from '../../voice/levels'
import { t } from '../strings'
import { firstName, prepFrac, seatStatus } from './seats'
import s from './seats.module.css'

/** Thin ring around an avatar: frac 1 = full (ready), < 1 = an arc over a faint track (mockups' ring()). */
export function Ring({ size, frac, gap = 5, stroke = 2 }: { size: number; frac: number; gap?: number; stroke?: number }) {
  const d = size + gap * 2 + stroke * 2
  const r = size / 2 + gap
  const c = 2 * Math.PI * r
  return (
    <svg className={s.ring} width={d} height={d} viewBox={`0 0 ${d} ${d}`} style={{ left: -gap - stroke, top: -gap - stroke }} aria-hidden>
      <circle cx={d / 2} cy={d / 2} r={r} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth={stroke} />
      <circle
        className={s.arc}
        cx={d / 2} cy={d / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${(c * Math.min(1, Math.max(0, frac))).toFixed(1)} ${c.toFixed(1)}`} transform={`rotate(-90 ${d / 2} ${d / 2})`}
      />
    </svg>
  )
}

export function useSeatPerson(userId: string, channel: Channel) {
  const user = useData((st) => st.users[userId])
  const name = useData((st) => displayName(st, userId, channel.spaceId))
  return { user: user ?? { id: userId, displayName: name, avatarUrl: null }, name }
}

/** Avatar + glow + ring + ✓ (the face of a seat). */
export function SeatFace({ userId, channel, size, ring, check, children }: {
  userId: string; channel: Channel; size: AvatarSize; ring: number | null; check: boolean; children?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEnvelope(ref, useLevelGetter(userId, channel.id))
  const { user } = useSeatPerson(userId, channel)
  return (
    <div ref={ref} className={s.face} style={{ width: size, height: size }}>
      <Avatar user={user} size={size} glow decorative />
      {ring !== null && <Ring size={size} frac={ring} gap={size <= 28 ? 3 : 5} />}
      {check && (
        <span className={s.check} style={{ width: size >= 56 ? 20 : 16, height: size >= 56 ? 20 : 16 }}>
          <Icon icon={Check} size={12} />
        </span>
      )}
      {children}
    </div>
  )
}

/** A big seat (foyer 64 px, intermission 56 px): face, name "(você)", status, the audio I chose. */
export function Seat({ seat, channel, size, me, choice, status, ringWhenReadyOnly }: {
  seat: CinemaSeat; channel: Channel; size: 56 | 64; me: boolean; choice?: string | null
  /** Replaces the status line (the intermission's button or "Ainda não"). */
  status?: ReactNode
  /** Intermission: the ring and ✓ only on who is ready. */
  ringWhenReadyOnly?: boolean
}) {
  const { name } = useSeatPerson(seat.userId, channel)
  const st = seatStatus(seat)
  const ready = seat.status === 'ready'
  const ring = seat.status === 'unsupported' || (ringWhenReadyOnly && !ready) ? null : prepFrac(seat)
  return (
    <div className={s.seat} data-status={seat.status} aria-label={t.seats.seatOf(name, st.text)} role="group">
      <SeatFace userId={seat.userId} channel={channel} size={size} ring={ring} check={ready} />
      <div className={s.name} dir="auto">
        <span className={s.nameText}>{firstName(name)}</span>
        {me && <small> {t.seats.you}</small>}
      </div>
      {status ?? <div className={st.ok ? s.ok : s.status}>{st.text}</div>}
      {choice && <div className={s.choice}>{choice}</div>}
    </div>
  )
}
