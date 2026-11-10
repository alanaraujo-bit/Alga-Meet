// The lock over the room (lock.ts): the ring while Space (or the badge) is held, a cover that swallows every click
// while locked, and a small badge that says how to get out. The film, the voices and the chat keep going under it.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Icon } from '@/ui'
import { Lock, LockOpen } from '@/ui/icons'
import { EASE_IN, EASE_OUT_QUART } from '@/ui/motion'
import { t } from '../strings'
import { LOCK_HOLD_MS, TAP_MS, endHold, pokeLock, startHold, useLock } from './lock'
import s from './room.module.css'

/** How long the badge stays after a click/key while locked, and the "Travada/Destravada" confirmation. */
const BADGE_MS = 2_600
const RING_R = 9
const RING_C = 2 * Math.PI * RING_R

/** `true` until `ms` after `at` (0 = never), re-rendering once when it runs out. */
function useRecent(at: number, ms: number): boolean {
  const [, bump] = useState(0)
  const left = at + ms - Date.now()
  useEffect(() => {
    if (left <= 0) return
    const id = setTimeout(() => bump((n) => n + 1), left)
    return () => clearTimeout(id)
  }, [at, left])
  return left > 0
}

export function LockLayer() {
  const locked = useLock((st) => st.locked)
  const holdSince = useLock((st) => st.holdSince)
  const pokedAt = useLock((st) => st.pokedAt)
  const changedAt = useLock((st) => st.changedAt)
  const poked = useRecent(pokedAt, BADGE_MS)
  const changed = useRecent(changedAt, 1_400)
  const holding = useHoldShown(holdSince)
  const badge = holding || poked || changed
  return (
    <>
      {locked && (
        <div
          className={s.lockCover}
          data-poked={poked || undefined}
          aria-hidden
          onPointerDown={(e) => {
            e.preventDefault()
            pokeLock()
          }}
          onPointerMove={pokeLock}
          onWheel={pokeLock}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}
      <AnimatePresence>
        {badge && (
          <motion.div
            key="badge"
            className={s.lockBadge}
            data-locked={locked}
            role="status"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.24, ease: EASE_OUT_QUART } }}
            exit={{ opacity: 0, y: 4, transition: { duration: 0.2, ease: EASE_IN } }}
            // Hold the badge itself with the mouse: the same 3 s as Space.
            onPointerDown={(e) => {
              e.preventDefault()
              e.currentTarget.setPointerCapture(e.pointerId)
              startHold()
            }}
            onPointerUp={() => endHold()}
            onPointerCancel={() => endHold()}
          >
            <span className={s.lockIcon}>
              {holding && holdSince !== null && <Ring since={holdSince} />}
              <Icon icon={locked ? Lock : LockOpen} size={16} filled={locked} />
            </span>
            <span className={s.lockText}>
              <b>{holding ? (locked ? t.room.holdToUnlock : t.room.holdToLock) : locked ? t.room.locked : t.room.unlocked}</b>
              {locked && !holding && <span>{t.room.lockedHint}</span>}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/** The ring shows once the press is clearly not a tap (TAP_MS), so a play/pause never flashes it. */
function useHoldShown(since: number | null): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    setShown(false)
    if (since === null) return
    const id = setTimeout(() => setShown(true), Math.max(0, since + TAP_MS - Date.now()))
    return () => clearTimeout(id)
  }, [since])
  return shown && since !== null
}

/** Progress of the hold, driven by rAF (a CSS animation would be cut to nothing by reduced motion: this is information). */
function Ring({ since }: { since: number }) {
  const [p, setP] = useState(0)
  useEffect(() => {
    let raf = 0
    const loop = () => {
      setP(Math.min(1, (Date.now() - since - TAP_MS) / (LOCK_HOLD_MS - TAP_MS)))
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [since])
  return (
    <svg className={s.lockRing} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r={RING_R} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <circle
        cx="12" cy="12" r={RING_R} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
        strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - Math.max(0, p))} transform="rotate(-90 12 12)"
      />
    </svg>
  )
}
