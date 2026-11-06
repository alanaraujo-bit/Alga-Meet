// The call sees the session (mockup 01): the film's card above the faces, with Sentar.
import type { Channel } from '@alga/shared'
import { Fragment } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useData } from '@/store/data'
import { displayName } from '@/store/selectors'
import { Avatar, Button, Icon } from '@/ui'
import { Armchair, ProjectorScreen } from '@/ui/icons'
import { CINEMA_MAX_SEATS } from '@alga/shared'
import * as act from '../actions'
import { useCinema } from '../store'
import { length, t } from '../strings'
import { cardMeta } from './film'
import { useExtraUrl } from './poster'
import { firstName } from './seats'
import { splitTitle } from './view'
import c from './call.module.css'

/** Cover of the film: the poster once held, else a calm neutral placeholder (never a stock image). */
export function Cover({ url, className }: { url: string | null; className?: string }) {
  return url ? <img src={url} alt="" draggable={false} className={`${c.coverImg} ${className ?? ''}`} /> : <div className={`${c.placeholder} ${className ?? ''}`} aria-hidden />
}

/** `episode`: "S01E02", shown lighter after the name (the room's top bar, mockup 10). */
export function FilmTitle({ title, className, episode }: { title: string; className?: string; episode?: string | null }) {
  const { name, year } = splitTitle(title)
  return (
    <span className={className} dir="auto">
      {name}
      {year && <span className={c.year}> ({year})</span>}
      {episode && <span className={c.year}> · {episode}</span>}
    </span>
  )
}

export function CallCard({ channel }: { channel: Channel }) {
  const session = useCinema((s) => s.session)
  const poster = useExtraUrl('poster')
  const host = useData((st) => (session ? st.users[session.hostId] : undefined))
  const seatedNames = useData(useShallow((st) => (session ? session.seats.map((x) => firstName(displayName(st, x.userId, channel.spaceId))) : [])))
  const hostName = useData((st) => (session ? displayName(st, session.hostId, channel.spaceId) : ''))
  if (!session) return null
  const f = session.film
  const free = Math.max(0, CINEMA_MAX_SEATS - session.seats.length)
  const meta = cardMeta(f, length(f.durationS))
  return (
    <article className={c.card} aria-label={t.callCard.badge}>
      <div className={c.cover}>
        <Cover url={poster} />
        <div className={c.coverShade} aria-hidden />
        <span className={c.badge}>
          <Icon icon={ProjectorScreen} size={12} />
          {t.callCard.badge}
        </span>
        <div className={c.coverText}>
          <h2 className={c.cardTitle}><FilmTitle title={f.title} /></h2>
          <div className={c.meta}>
            {meta.map((m, i) => (
              <Fragment key={m}>
                {i > 0 && <span className={c.metaDot}>·</span>}
                {m}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
      <div className={c.cardRow}>
        <Avatar user={host ?? { id: session.hostId, displayName: hostName, avatarUrl: null }} size={32} decorative />
        <div className={c.cardRowText}>
          <span className={c.cardRowTitle} dir="auto">{t.callCard.opened(firstName(hostName))}</span>
          <span className={c.cardRowSub} dir="auto">{seatedNames.length ? t.callCard.seated(seatedNames, free) : t.callCard.empty(free)}</span>
        </div>
        <Button variant="primary" size="lg" icon={Armchair} onClick={() => act.seat(true)} disabled={free === 0}>
          {t.callCard.sit}
        </Button>
      </div>
    </article>
  )
}
