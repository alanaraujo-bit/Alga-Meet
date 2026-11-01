import type { LucideIcon } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { Icon } from './Icon'
import s from './misc.module.css'

export function Skeleton({ width, height = 12, radius, style }: { width?: number | string; height?: number; radius?: number; style?: CSSProperties }) {
  return <span aria-hidden className={s.skeleton} style={{ width, height, borderRadius: radius, ...style }} />
}

export function Divider({ vertical, label, style }: { vertical?: boolean; label?: string; style?: CSSProperties }) {
  if (label)
    return (
      <div role="separator" className={s.dividerLabel} style={style}>
        {label}
      </div>
    )
  return <hr aria-orientation={vertical ? 'vertical' : 'horizontal'} className={`${s.divider} ${vertical ? s.dividerV : s.dividerH}`} style={style} />
}

export function EmptyState({
  icon,
  title,
  children,
  actions,
}: {
  icon?: LucideIcon
  title: string
  children?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className={s.empty}>
      {icon && (
        <div className={s.emptyIcon}>
          <Icon icon={icon} size={24} />
        </div>
      )}
      <h2 className={s.emptyTitle}>{title}</h2>
      {children && <p className={s.emptyBody}>{children}</p>}
      {actions && <div className={s.emptyActions}>{actions}</div>}
    </div>
  )
}

/** Count badge. Red = needs you (mentions, requests); neutral = informational. */
export function Badge({ count, neutral, label }: { count: number; neutral?: boolean; label?: string }) {
  if (count <= 0) return null
  return (
    <span className={`${s.badge} ${neutral ? s.badgeNeutral : ''}`} aria-label={label}>
      {count > 99 ? '99+' : count}
    </span>
  )
}
