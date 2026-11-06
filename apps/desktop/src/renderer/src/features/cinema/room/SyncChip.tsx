// "● Em sincronia" (hover: "4 de 4 · ±6 ms": ready of seated and my |drift|); "3 de 4 prontos" while someone prepares.
import type { CinemaSessionView } from '@alga/shared'
import { useEffect, useState } from 'react'
import { Tooltip } from '@/ui'
import { cinemaStats } from '../store'
import { t } from '../strings'
import { readiness } from './seats'
import s from './room.module.css'

export function SyncChip({ session }: { session: CinemaSessionView }) {
  const [drift, setDrift] = useState<number | null>(null)
  useEffect(() => {
    const read = () => {
      const d = cinemaStats().driftMs
      setDrift(d === null ? null : Math.abs(d))
    }
    read()
    const id = setInterval(read, 1_000)
    return () => clearInterval(id)
  }, [])
  const r = readiness(session.seats)
  return (
    <Tooltip content={t.room.syncTip(r.ready, r.all, drift)} side="bottom" align="end">
      <span className={s.sync} tabIndex={0} role="status">
        <i aria-hidden />
        {r.ready === r.all ? t.room.inSync : t.room.readyOf(r.ready, r.all)}
      </span>
    </Tooltip>
  )
}
