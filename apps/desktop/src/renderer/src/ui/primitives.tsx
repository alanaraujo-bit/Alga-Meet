import type { Glyph } from './icons'
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
  icon?: Glyph
  title: string
  children?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className={s.empty}>
      {icon && (
        <div className={s.emptyIcon}>
          <Icon icon={icon} size={24} duotone />
        </div>
      )}
      <h2 className={s.emptyTitle}>{title}</h2>
      {children && <p className={s.emptyBody}>{children}</p>}
      {actions && <div className={s.emptyActions}>{actions}</div>}
    </div>
  )
}

/** Count badge. Neutral by default; red only for direct @mentions (red is reserved for mentions and errors). */
export function Badge({ count, mention, label }: { count: number; mention?: boolean; label?: string }) {
  if (count <= 0) return null
  return (
    <span className={`${s.badge} ${mention ? s.badgeMention : ''}`} aria-label={label}>
      {count > 99 ? '99+' : count}
    </span>
  )
}
