import { useRef } from 'react'
import { useEnvelope } from './Avatar'
import s from './misc.module.css'

/**
 * The logo's three fronds as the product's "live / speaking" glyph. Rest pose = Marca v1 (`build/README.md`):
 * bars u wide and u apart, 3u / 5u / 3u tall, so the group is a 5u square. u is a whole pixel per size, so the
 * vertical edges stay sharp (14 px: u = 2, the 16 px icon's bars; 28 px: u = 4).
 * - `getLevel`: bars follow the voice envelope (same attack/release as the speaking glow).
 * - `breathing`: slow idle motion for "people are here right now" when no level is known (other rooms).
 * - neither: still bars (static "voice" icon).
 */
export function Fronds({ size = 16, getLevel, breathing, className, label }: { size?: number; getLevel?: () => number; breathing?: boolean; className?: string; label?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEnvelope(ref, getLevel ?? null)
  return (
    <span
      ref={ref}
      className={`${s.fronds} ${breathing && !getLevel ? s.frondsBreathing : ''} ${getLevel ? s.frondsLive : ''} ${className ?? ''}`}
      style={{ width: size, height: size, ['--u' as string]: `${Math.max(2, Math.round(size / 7))}px` }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <i />
      <i />
      <i />
    </span>
  )
}
