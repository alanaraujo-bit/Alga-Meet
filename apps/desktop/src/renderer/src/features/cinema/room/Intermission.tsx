// The intermission (mockup 09): a pause longer than 3 min turns the lights on. The cover comes back soft, "Faltam
// 1h12", bigger seats (time to talk), and Voltar = seek to where the room stopped: the server gathers the seats and
// starts when they are ready.
import type { Channel, CinemaSessionView } from '@alga/shared'
import { useState, type RefObject } from 'react'
import { Button, Icon } from '@/ui'
import { LogOut, Play } from '@/ui/icons'
import * as act from '../actions'
import { clock, length, t } from '../strings'
import { Cover } from './CallCard'
import { useExtraUrl } from './poster'
import { Seat, useSeatPerson } from './Seat'
import { useOrderedSeats } from './SeatRow'
import { firstName } from './seats'
import { SocialTimeline } from './SocialTimeline'
import { TopBar } from './TopBar'
import s from './room.module.css'

/** The paused frame as an image (the cover until the poster is held). */
function useStill(video: RefObject<HTMLVideoElement | null>): string | null {
  const [url] = useState(() => {
    const v = video.current
    if (!v || v.readyState < 2 || !v.videoWidth) return null
    const c = document.createElement('canvas')
    c.width = 960
    c.height = Math.round((960 * v.videoHeight) / v.videoWidth)
    try {
      c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height)
      return c.toDataURL('image/jpeg', 0.85)
    } catch {
      return null
    }
  })
  return url
}

export function Intermission({ session, channel, video, who }: { session: CinemaSessionView; channel: Channel; video: RefObject<HTMLVideoElement | null>; who: string | null }) {
  const poster = useExtraUrl('poster')
  const still = useStill(video)
  const cover = poster ?? still
  const { meId, seats } = useOrderedSeats(session)
  const by = useSeatPerson(who ?? session.hostId, channel)
  const p = session.playback
  const f = session.film
  return (
    <div className={s.intermission}>
      <div className={s.interBackdrop} aria-hidden>
        <Cover url={cover} className={s.interBackdropImg} />
      </div>
      <div className={s.interShade} aria-hidden />
      <TopBar
        session={session}
        channel={channel}
        right={
          <Button variant="ghost" size="sm" icon={LogOut} onClick={() => act.seat(false)}>
            {t.intermission.standUp}
          </Button>
        }
      />
      <div className={s.interCover}>
        <Cover url={cover} />
      </div>
      <div className={s.interText}>
        <div className={s.overline}>{t.intermission.overline}</div>
        <div className={s.interLeft}>{t.intermission.left(length(Math.max(0, f.durationS - p.position)))}</div>
        <div className={s.interSub} dir="auto">{t.intermission.pausedAt(clock(p.position), who ? firstName(by.name) : null)}</div>
      </div>
      <div className={s.interSeats} role="group" aria-label={t.stage.seats}>
        {seats.map((x) => (
          <Seat
            key={x.userId}
            seat={x}
            channel={channel}
            size={56}
            me={x.userId === meId}
            ringWhenReadyOnly
            status={
              x.userId === meId ? (
                <Button variant="primary" size="sm" className={s.backBtn} onClick={() => act.control('seek', p.position)}>
                  <Icon icon={Play} size={12} filled />
                  {t.intermission.back}
                </Button>
              ) : x.status === 'ready' ? (
                <div className={s.seatOk}>{t.seats.ready}</div>
              ) : (
                <div className={s.seatNo}>{t.intermission.notYet}</div>
              )
            }
          />
        ))}
      </div>
      <p className={s.interHint}>{t.intermission.hint}</p>
      <div className={s.interBar}>
        <SocialTimeline session={session} cur={p.position} bare />
        <div className={s.interTimes}>
          <span>{clock(p.position)}</span>
          <span>{clock(f.durationS)}</span>
        </div>
      </div>
    </div>
  )
}
