// "Você assiste: Dublado · Português 5.1 | Legendado · Inglês 5.1" (foyer): each seat picks its own audio (+ subtitle).
import type { CinemaFilm } from '@alga/shared'
import { useRef, type KeyboardEvent } from 'react'
import * as act from '../actions'
import { useCinema } from '../store'
import { t } from '../strings'
import { watchOptions } from './film'
import f from './foyer.module.css'

export function TrackPicker({ film }: { film: CinemaFilm }) {
  const audioId = useCinema((s) => s.mine.audioId)
  const subtitleId = useCinema((s) => s.mine.subtitleId)
  const ref = useRef<HTMLDivElement>(null)
  const options = watchOptions(film)
  if (!options.length) return null
  const current = Math.max(0, options.findIndex((o) => o.audioId === audioId && (o.subtitleId === null || o.subtitleId === subtitleId)))
  const pick = (i: number) => {
    const o = options[i]!
    act.setAudio(o.audioId)
    act.setSubtitle(o.subtitleId)
  }
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    e.stopPropagation() // not the room's ←/→ seek
    const i = (current + d + options.length) % options.length
    pick(i)
    ref.current?.querySelectorAll<HTMLElement>('[role=radio]')[i]?.focus()
  }
  return (
    <div className={f.picker}>
      <span className={f.pickerLabel} id="cinema-watch-label">{t.foyer.watch}</span>
      <div ref={ref} className={f.seg} role="radiogroup" aria-labelledby="cinema-watch-label" onKeyDown={onKey}>
        {options.map((o, i) => (
          <button key={o.audioId} type="button" role="radio" aria-checked={i === current} tabIndex={i === current ? 0 : -1} onClick={() => pick(i)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
