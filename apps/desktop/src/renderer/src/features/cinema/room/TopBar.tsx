// Top of the room (mockups 05–09): ←, title (year lighter), "✓ Nativo · 4K HDR", who projects, and the sync chip.
import type { Channel, CinemaSessionView } from '@alga/shared'
import type { ReactNode } from 'react'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { Icon, Tooltip } from '@/ui'
import { ArrowLeft, Check, ProjectorScreen } from '@/ui/icons'
import * as act from '../actions'
import { t } from '../strings'
import { FilmTitle } from './CallCard'
import { videoLabel } from './film'
import { firstName } from './seats'
import { SyncChip } from './SyncChip'
import s from './room.module.css'

export function TopBar({ session, channel, right }: { session: CinemaSessionView; channel: Channel; right?: ReactNode }) {
  const hostName = useData((st) => displayName(st, session.hostId, channel.spaceId))
  return (
    <div className={s.top}>
      <Tooltip content={t.room.leave} side="bottom">
        <button type="button" className={`${s.ib} ${s.back}`} aria-label={t.room.leave} onClick={() => act.seat(false)}>
          <Icon icon={ArrowLeft} size={20} />
        </button>
      </Tooltip>
      <FilmTitle title={session.film.title} className={s.title} />
      <span className={s.chip}>
        <span className={s.accent}><Icon icon={Check} size={12} /></span>
        <b>{t.native}</b> · {videoLabel(session.film)}
      </span>
      <span className={s.by}>
        <Icon icon={ProjectorScreen} size={14} />
        <span dir="auto">{t.foyer.projecting(firstName(hostName))}</span>
      </span>
      <span className={s.topEnd}>{right ?? <SyncChip session={session} />}</span>
    </div>
  )
}
