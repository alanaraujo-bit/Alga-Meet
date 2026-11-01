import type { LucideIcon } from 'lucide-react'

export type IconSize = 12 | 14 | 16 | 18 | 20 | 24

/** Every icon goes through here: one stroke weight, sizes on the 2px grid, hidden from AT by default. */
export function Icon({
  icon: Glyph,
  size = 16,
  label,
  className,
}: {
  icon: LucideIcon
  size?: IconSize
  /** Only for icons that carry meaning on their own (no visible text next to them). */
  label?: string
  className?: string
}) {
  return (
    <Glyph
      size={size}
      strokeWidth={size <= 14 ? 2 : 1.75}
      absoluteStrokeWidth={false}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      className={className}
      style={{ flexShrink: 0 }}
    />
  )
}
