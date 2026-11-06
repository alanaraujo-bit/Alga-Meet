// The social timeline (mockup 05, spec §7.3.6): reaction heat above the bar, what this seat holds ahead, what was
// watched, chapter gaps, and on hover/drag the thumbnail with the time, the chapter and the reactions there. Dragging
// is local; the room seeks only on release.
import type { CinemaSessionView } from '@alga/shared'
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useData } from '@/store/data'
import { Icon } from '@/ui'
import { Smile } from '@/ui/icons'
import * as act from '../actions'
import { clock, t } from '../strings'
import { useExtraUrl } from './poster'
import { useHeat } from './reactions'
import { thumbTile } from './thumbs'
import { chapterAt, heatProfile, reactionsAt } from './timeline'
import s from './room.module.css'

const HEAT_POINTS = 240
const CARD_W = 240
const SEEK_S = 10
const SEEK_LONG_S = 60

export function SocialTimeline({ session, cur, bare }: { session: CinemaSessionView; cur: number; bare?: boolean }) {
  const f = session.film
  const D = Math.max(1, f.durationS)
  const meId = useData((st) => st.me?.id)
  const heat = useHeat(session)
  const profile = useMemo(() => heatProfile(heat, HEAT_POINTS), [heat])
  const thumbs = useExtraUrl('thumbs')
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ t: number; x: number; w: number } | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const shown = scrub ?? cur
  const ahead = session.seats.find((x) => x.userId === meId)?.aheadS ?? 0
  const pct = (v: number) => `${(Math.min(Math.max(v / D, 0), 1) * 100).toFixed(3)}%`
  const locked = session.playback.reason === 'foyer' || session.playback.reason === 'host_away'

  const at = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const x = Math.min(Math.max(e.clientX - r.left, 0), r.width)
    return { t: (x / r.width) * D, x, w: r.width }
  }
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? SEEK_LONG_S : SEEK_S
    const to = e.key === 'ArrowLeft' ? cur - step : e.key === 'ArrowRight' ? cur + step : e.key === 'Home' ? 0 : e.key === 'End' ? D - 1 : null
    if (to === null || locked) return
    e.preventDefault()
    if (e.repeat && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return // auto-repeat must not flood the gateway
    act.control('seek', to)
  }

  const path = useMemo(() => {
    const pts = profile.map((v, i) => `L${((i / (HEAT_POINTS - 1)) * 1000).toFixed(1)} ${(20 - (0.05 + v * 0.95) * 18).toFixed(1)}`).join(' ')
    return `M0 20 ${pts} L1000 20 Z`
  }, [profile])

  const hoverT = scrub ?? hover?.t ?? null
  return (
    <div className={`${s.timeline} ${bare ? s.timelineBare : ''}`}>
      {!bare && (
        <svg className={s.heat} viewBox="0 0 1000 20" preserveAspectRatio="none" aria-hidden>
          <defs>
            <clipPath id="cinema-heat-played">
              <rect width={(Math.min(Math.max(shown / D, 0), 1) * 1000).toFixed(1)} height="20" />
            </clipPath>
          </defs>
          <path d={path} fill="rgba(255,255,255,.11)" />
          <path d={path} fill="rgba(255,255,255,.2)" clipPath="url(#cinema-heat-played)" />
        </svg>
      )}
      <div
        ref={ref}
        className={s.hit}
        role="slider"
        tabIndex={bare ? -1 : 0}
        aria-label={t.stage.timeline}
        aria-valuemin={0}
        aria-valuemax={Math.round(D)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={clock(shown)}
        aria-disabled={locked || bare || undefined}
        onKeyDown={onKey}
        onPointerMove={(e) => {
          if (bare) return
          const p = at(e)
          setHover(p)
          if (scrub !== null) setScrub(p.t)
        }}
        onPointerLeave={() => scrub === null && setHover(null)}
        onPointerDown={(e) => {
          if (bare || locked || e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setScrub(at(e).t)
        }}
        onPointerUp={(e) => {
          if (scrub === null) return
          e.currentTarget.releasePointerCapture(e.pointerId)
          act.control('seek', scrub)
          setScrub(null)
          setHover(null)
        }}
        onPointerCancel={() => setScrub(null)}
      >
        <div className={s.track}>
          <i className={s.loaded} style={{ width: pct(cur + ahead) }} />
          <i className={s.played} style={{ width: pct(shown) }} />
          {f.chapters.filter((c) => c.startS > 0).map((c) => <i key={c.startS} className={s.gap} style={{ left: pct(c.startS) }} />)}
          {!bare && <i className={s.knob} style={{ left: pct(shown) }} />}
        </div>
      </div>
      {hoverT !== null && hover && !bare && <HoverCard session={session} t={hoverT} x={scrub !== null ? (scrub / D) * hover.w : hover.x} w={hover.w} thumbs={thumbs} heat={heat} />}
    </div>
  )
}

function HoverCard({ session, t: time, x, w, thumbs, heat }: { session: CinemaSessionView; t: number; x: number; w: number; thumbs: string | null; heat: number[] }) {
  const f = session.film
  const chapter = chapterAt(f.chapters, time)?.chapter.title
  const count = reactionsAt(heat, time)
  const tile = thumbTile(time, f)
  const k = CARD_W / tile.w
  const left = Math.min(Math.max(x - CARD_W / 2, 0), Math.max(0, w - CARD_W))
  return (
    <>
      <i className={s.hoverLine} style={{ left: x }} aria-hidden />
      <div className={s.hoverCard} style={{ left }} aria-hidden>
        {thumbs && (
          <div
            className={s.thumb}
            style={{
              height: Math.round(tile.h * k),
              backgroundImage: `url(${thumbs})`,
              backgroundSize: `${tile.sheetW * k}px ${tile.sheetH * k}px`,
              backgroundPosition: `${-tile.x * k}px ${-tile.y * k}px`,
            }}
          />
        )}
        <div className={s.hoverRow}>
          <b>{clock(time)}</b>
          {chapter && <span className={s.hoverChapter} dir="auto">{chapter}</span>}
          {count > 0 && (
            <span className={s.hoverCount}>
              <Icon icon={Smile} size={12} />
              {count}
            </span>
          )}
        </div>
      </div>
    </>
  )
}
