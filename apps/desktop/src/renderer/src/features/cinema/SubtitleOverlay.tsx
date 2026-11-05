import { useEffect, useState, type ReactNode } from 'react'
import styles from './cinema.module.css'
import { activeCues, parseInline, type Cue } from './subtitles'

export type SubtitleSize = 'P' | 'M' | 'G'

const BASE_BOTTOM = 56
const CONTROLS_RAISE = 64

/** Cue text → React elements; only <i>/<b>/<u> survive (see parseInline), nothing is injected as HTML. */
function renderRuns(text: string): ReactNode[] {
  return parseInline(text).map((r, k) => {
    let n: ReactNode = r.text
    if (r.u) n = <u>{n}</u>
    if (r.b) n = <b>{n}</b>
    if (r.i) n = <i>{n}</i>
    return <span key={k}>{n}</span>
  })
}

export function SubtitleOverlay(props: {
  cues: Cue[]
  /** Current film time in seconds (e.g. () => video.currentTime). */
  getTime: () => number
  size: SubtitleSize
  offsetS: number
  controlsVisible: boolean
}) {
  const { cues, getTime, size, offsetS, controlsVisible } = props
  const [active, setActive] = useState<Cue[]>([])
  useEffect(() => {
    let raf = 0
    const loop = () => {
      const next = activeCues(cues, getTime(), offsetS)
      setActive((prev) => (prev.length === next.length && prev.every((c, i) => c === next[i]) ? prev : next))
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [cues, getTime, offsetS])
  if (!active.length) return null
  return (
    <div className={`${styles.subtitles} ${styles[size]}`} style={{ bottom: BASE_BOTTOM + (controlsVisible ? CONTROLS_RAISE : 0) }} aria-live="off">
      {active.map((c, i) => (
        <div key={`${c.startS}-${i}`}>{renderRuns(c.text)}</div>
      ))}
    </div>
  )
}
