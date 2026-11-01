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
/** `brand`: the logo's lit bars (white fading into the indigo, one gradient across the group: Marca v2). */
export function Fronds({ size = 16, getLevel, breathing, brand, className, label }: { size?: number; getLevel?: () => number; breathing?: boolean; brand?: boolean; className?: string; label?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEnvelope(ref, getLevel ?? null)
  return (
    <span
      ref={ref}
      className={`${s.fronds} ${breathing && !getLevel ? s.frondsBreathing : ''} ${getLevel ? s.frondsLive : ''} ${brand ? s.frondsBrand : ''} ${className ?? ''}`}
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
