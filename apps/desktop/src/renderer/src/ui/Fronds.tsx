import { useRef } from 'react'
import { useEnvelope } from './Avatar'
import s from './misc.module.css'

/**
 * The logo's three fronds as the product's "live / speaking" glyph.
 * - `getLevel`: bars follow the voice envelope (same attack/release as the speaking glow).
 * - `breathing`: slow idle motion for "people are here right now" when no level is known (other rooms).
 * - neither: still bars (static "voice" icon).
 */
export function Fronds({ size = 16, getLevel, breathing, className, label }: { size?: 12 | 14 | 16 | 18 | 20; getLevel?: () => number; breathing?: boolean; className?: string; label?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEnvelope(ref, getLevel ?? null)
  return (
    <span
      ref={ref}
      className={`${s.fronds} ${breathing && !getLevel ? s.frondsBreathing : ''} ${getLevel ? s.frondsLive : ''} ${className ?? ''}`}
      style={{ width: size, height: size }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <i style={{ ['--k' as string]: 0.55 }} />
      <i style={{ ['--k' as string]: 1 }} />
      <i style={{ ['--k' as string]: 0.7 }} />
    </span>
  )
}
