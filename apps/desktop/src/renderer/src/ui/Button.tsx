import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { Icon } from './Icon'
import { Spinner } from './Spinner'
import { Tooltip } from './Tooltip'
import type { Side } from './floating'
import s from './Button.module.css'

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ')

/** `secondary-danger`: a destructive action at rest (secondary surface, `--danger` text); `danger` fill is for the confirmation. */
type Variant = 'primary' | 'secondary' | 'secondary-danger' | 'ghost' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: LucideIcon
  full?: boolean
  ref?: Ref<HTMLButtonElement>
  children?: ReactNode
}

export function Button({ variant = 'secondary', size = 'md', loading, icon, full, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(s.button, s[variant], size !== 'md' && s[size], full && s.full, loading && s.busy, className)}
    >
      <span className={s.label}>
        {icon && <Icon icon={icon} size={size === 'lg' ? 16 : 14} />}
        {children}
      </span>
      {loading && (
        <span className={s.spinner}>
          <Spinner size={16} />
        </span>
      )}
    </button>
  )
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon
  /** Accessible name, also shown as tooltip. */
  label: string
  shortcut?: string
  size?: 'sm' | 'md' | 'lg'
  tooltipSide?: Side
  /** Shown instead of the label when unavailable; keeps the control focusable (aria-disabled). */
  disabledReason?: string
  danger?: boolean
  ref?: Ref<HTMLButtonElement>
}

export function IconButton({
  icon,
  label,
  shortcut,
  size = 'md',
  tooltipSide = 'top',
  disabledReason,
  danger,
  className,
  onClick,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const unavailable = !!disabledReason
  return (
    <Tooltip content={disabledReason ?? label} shortcut={unavailable ? undefined : shortcut} side={tooltipSide}>
      <button
        {...rest}
        type={type}
        aria-label={label}
        aria-disabled={unavailable || undefined}
        onClick={unavailable ? undefined : onClick}
        className={cx(s.icon, size === 'sm' && s.iconSm, size === 'lg' && s.iconLg, danger && s.iconDanger, className)}
        style={unavailable ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
      >
        <Icon icon={icon} size={size === 'sm' ? 14 : size === 'lg' ? 18 : 16} />
      </button>
    </Tooltip>
  )
}
