// The foyer (mockups 03/04), on the call's stage with the lights on: the cover, the film, each seat's own audio,
// the row of seats with their preparing rings, and the host's "Começar" ("Começar mesmo assim" after 10 s).
import type { Channel, CinemaSessionView } from '@alga/shared'
import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useData } from '@/store/data'
import { displayName, voiceMembers } from '@/store/selectors'
import { Button, Icon } from '@/ui'
import { Check, Play, ProjectorScreen } from '@/ui/icons'
import * as act from '../actions'
import { useCinema } from '../store'
import { length, t } from '../strings'
import { Cover, FilmTitle } from './CallCard'
import { defaultAudio, resolution } from './film'
import { useExtraUrl } from './poster'
import { SeatRow, useMyChoice } from './SeatRow'
import { firstName, readiness } from './seats'
import { TrackPicker } from './TrackPicker'
import f from './foyer.module.css'

/** "Começar mesmo assim" once the host has waited this long for the last seats. */
const START_ANYWAY_MS = 10_000

export function Foyer({ channel }: { channel: Channel }) {
  const session = useCinema((s) => s.session) as CinemaSessionView
  const meId = useData((st) => st.me?.id)
  const poster = useExtraUrl('poster')
  const choice = useMyChoice(session)
  const film = session.film
  const isHost = session.hostId === meId
  const hostName = useData((st) => displayName(st, session.hostId, channel.spaceId))
  const a = defaultAudio(film)
  const hdr = film.hdr === 'sdr' ? null : t.film.hdr[film.hdr]
  return (
    <div className={f.foyer}>
      <div className={f.backdrop} aria-hidden>
        <Cover url={poster} className={f.backdropImg} />
      </div>
      <div className={f.shade} aria-hidden />
      <div className={f.body}>
        <div className={f.poster}>
          <Cover url={poster} />
        </div>
        <h1 className={f.title}><FilmTitle title={film.title} /></h1>
        <div className={f.chips}>
          <span className={f.chip}>
            <span className={f.accent}><Icon icon={Check} size={12} /></span>
            <b>{t.native}</b> · {[resolution(film), hdr].filter(Boolean).join(' · ')}
          </span>
          {a && <span className={f.chip}>{t.film.audio(t.film.channels(a.channels))}</span>}
          <span className={f.chip}>{length(film.durationS)}</span>
          <span className={f.chip}>
            <Icon icon={ProjectorScreen} size={12} />
            <span dir="auto">{t.foyer.projecting(firstName(hostName))}</span>
          </span>
        </div>
        <TrackPicker film={film} />
        <div className={f.seats}>
          <SeatRow session={session} channel={channel} variant="foyer" choice={choice} />
        </div>
      </div>
      <StartBar session={session} channel={channel} isHost={isHost} hostName={hostName} />
    </div>
  )
}

function StartBar({ session, channel, isHost, hostName }: { session: CinemaSessionView; channel: Channel; isHost: boolean; hostName: string }) {
  const r = readiness(session.seats)
  const seatedIds = session.seats.map((x) => x.userId)
  const preparingName = useData((st) => (r.firstPreparing ? displayName(st, r.firstPreparing.userId, channel.spaceId) : ''))
  // Who is in the call but not seated (they see the card).
  const others = useData(useShallow((st) => voiceMembers(st, channel.id).filter((v) => !seatedIds.includes(v.userId)).map((v) => firstName(displayName(st, v.userId, channel.spaceId)))))
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setWaited(true), START_ANYWAY_MS)
    return () => clearTimeout(id)
  }, [])
  const allReady = r.ready === r.all
  let line1: string
  let line2: string
  if (session.seats.length === 1) {
    line1 = t.foyer.alone
    line2 = others.length ? t.foyer.sawCard(others) : t.foyer.nobodyElse
  } else {
    line1 = t.foyer.readyOf(r.ready, r.all)
    line2 = allReady ? t.foyer.allReady : r.all - r.ready > 1 ? t.foyer.loadingMany(r.all - r.ready) : t.foyer.loading(firstName(preparingName))
  }
  if (!isHost) {
    line2 = line1
    line1 = t.foyer.waitHost(firstName(hostName))
  }
  return (
    <div className={f.startBar}>
      <div className={f.hint} role="status" aria-live="polite">
        <span className={f.hint1} dir="auto">{line1}</span>
        <span className={f.hint2} dir="auto">{line2}</span>
      </div>
      {isHost && (
        <Button variant="primary" size="lg" disabled={!allReady && !waited} onClick={() => act.control('start', session.playback.position)}>
          <Icon icon={Play} size={14} filled />
          {allReady || !waited ? t.foyer.start : t.foyer.startAnyway}
        </Button>
      )}
    </div>
  )
}
