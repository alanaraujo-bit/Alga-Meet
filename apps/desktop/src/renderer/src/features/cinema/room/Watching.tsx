// The room's interface over the film (mockups 05–08): top bar, controls, the strip of seats and the reactions. It
// hides after 2 s without the mouse while the film plays (06); the strip stays, almost invisible, so a speaking seat
// still lights up. `center` is the screen of the moment (paused, waiting, countdown).
import type { Channel, CinemaSessionView } from '@alga/shared'
import { useEffect, useState, type ReactNode, type RefObject } from 'react'
import { Button } from '@/ui'
import * as act from '../actions'
import { t } from '../strings'
import { Controls } from './Controls'
import { NextUp } from './Credits'
import { ReactionLayer } from './ReactionLayer'
import { SeatRow } from './SeatRow'
import { SocialTimeline } from './SocialTimeline'
import { skipIntroTo } from './timeline'
import { TopBar } from './TopBar'
import type { RoomView } from './view'
import s from './room.module.css'

/** Film seconds the <video> shows, 4×/s. */
export function useFilmTime(video: RefObject<HTMLVideoElement | null>, fallback: number): number {
  const [cur, setCur] = useState(fallback)
  useEffect(() => {
    const id = setInterval(() => {
      const v = video.current
      if (v && v.readyState > 0) setCur(v.currentTime)
    }, 250)
    return () => clearInterval(id)
  }, [video])
  return cur
}

export function Watching({ session, channel, view, video, root, uiShown, onEngineering, center }: {
  session: CinemaSessionView
  channel: Channel
  view: RoomView & { position: number }
  video: RefObject<HTMLVideoElement | null>
  root: RefObject<HTMLElement | null>
  uiShown: boolean
  onEngineering: () => void
  center?: ReactNode
}) {
  const cur = useFilmTime(video, view.position)
  const [reactOpen, setReactOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || e.key.toLowerCase() !== 'r') return
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) return
      e.preventDefault()
      setReactOpen((o) => !o)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  const skipTo = view.screen === 'watching' ? skipIntroTo(session.film.chapters, cur) : null
  // the credits with a next episode (mockup 10): the card instead of the timeline and the controls
  const nextUp = view.screen === 'credits' && !!session.next
  return (
    <>
      {center && <div className={s.center}>{center}</div>}
      <div className={s.ui} data-shown={uiShown || reactOpen}>
        <div className={s.scrimTop} aria-hidden />
        <div className={s.scrimBottom} aria-hidden />
        <TopBar session={session} channel={channel} />
        {skipTo !== null && (
          <Button variant="secondary" className={s.skipIntro} onClick={() => act.control('seek', skipTo)}>{t.room.skipIntro}</Button>
        )}
        {!nextUp && <SocialTimeline session={session} cur={cur} />}
        {!nextUp && <Controls session={session} video={video} root={root} cur={cur} reactOpen={reactOpen} setReactOpen={setReactOpen} onEngineering={onEngineering} />}
      </div>
      {nextUp && <NextUp session={session} channel={channel} nextUpS={view.nextUpS} />}
      <div className={s.stripWrap}>
        <SeatRow session={session} channel={channel} variant="strip" dim={uiShown ? 0.85 : 0.3} ringFor={view.screen === 'waiting' ? view.who : null} />
      </div>
      <ReactionLayer session={session} />
    </>
  )
}
