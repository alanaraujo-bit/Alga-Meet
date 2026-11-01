import type { Glyph } from './icons'

export type IconSize = 12 | 14 | 16 | 18 | 20 | 24

/**
 * Every icon goes through here (Phosphor via ui/icons). Weight follows size so the drawn stroke stays ≈ 1.1–1.7 px:
 * bold up to 18 px (1.5 px at 16, like Linear), regular from 20 px. `filled` = the solid state for "you are here" and
 * "it is on" (current channel, pressed toggle); `duotone` = empty-state art. Hidden from AT by default.
 */
export function Icon({
  icon: G,
  size = 16,
  label,
  className,
  filled,
  duotone,
}: {
  icon: Glyph
  size?: IconSize
  /** Only for icons that carry meaning on their own (no visible text next to them). */
  label?: string
  className?: string
  filled?: boolean
  duotone?: boolean
}) {
  return (
    <G
      size={size}
      weight={filled ? 'fill' : duotone ? 'duotone' : size >= 20 ? 'regular' : 'bold'}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      className={className}
      style={{ flexShrink: 0 }}
    />
  )
}
