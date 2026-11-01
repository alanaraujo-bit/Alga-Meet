import { AlertCircle, ArrowBigUp, Eye, EyeOff, type LucideIcon } from 'lucide-react'
import { useId, useState, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'
import { IconButton } from './Button'
import { Icon } from './Icon'
import s from './TextField.module.css'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string
  /** Hidden label for fields whose context is visual (search boxes). */
  ariaLabel?: string
  hint?: ReactNode
  error?: string | null
  optional?: boolean
  leadingIcon?: LucideIcon
  trailing?: ReactNode
  size?: 'sm' | 'md'
  ref?: Ref<HTMLInputElement>
}

/** Label + input + help/error line. Password fields get show/hide and a Caps Lock hint. */
export function TextField({ label, ariaLabel, hint, error, optional, leadingIcon, trailing, size = 'md', type = 'text', id, onKeyDown, onKeyUp, onBlur, ...rest }: TextFieldProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const helpId = `${inputId}-help`
  const isPassword = type === 'password'
  const [reveal, setReveal] = useState(false)
  const [caps, setCaps] = useState(false)
  const capsCheck = (e: React.KeyboardEvent<HTMLInputElement>) => isPassword && setCaps(e.getModifierState('CapsLock'))

  const help = error ? (
    <span className={`${s.help} ${s.error}`} id={helpId} role="alert">
      <Icon icon={AlertCircle} size={12} />
      {error}
    </span>
  ) : caps ? (
    <span className={`${s.help} ${s.caps}`} id={helpId}>
      <Icon icon={ArrowBigUp} size={12} />
      Caps Lock está ativado
    </span>
  ) : hint ? (
    <span className={s.help} id={helpId}>
      {hint}
    </span>
  ) : null

  return (
    <div className={s.field}>
      {label && (
        <label htmlFor={inputId} className={s.label}>
          {label} {optional && <span className={s.optional}>· opcional</span>}
        </label>
      )}
      <div className={`${s.control} ${error ? s.invalid : ''} ${leadingIcon ? s.withLeading : ''} ${size === 'sm' ? s.sm : ''}`}>
        {leadingIcon && (
          <span className={s.leading}>
            <Icon icon={leadingIcon} size={16} />
          </span>
        )}
        <input
          {...rest}
          id={inputId}
          type={isPassword && reveal ? 'text' : type}
          aria-label={label ? undefined : ariaLabel}
          aria-invalid={!!error || undefined}
          aria-describedby={help ? helpId : undefined}
          className={s.input}
          spellCheck={isPassword ? false : rest.spellCheck}
          onKeyDown={(e) => {
            capsCheck(e)
            onKeyDown?.(e)
          }}
          onKeyUp={(e) => {
            capsCheck(e)
            onKeyUp?.(e)
          }}
          // Caps state is kept on blur on purpose: hiding the hint on mousedown would shift the
          // layout under the pointer and make the click on "Entrar" miss.
          onBlur={onBlur}
        />
        {(isPassword || trailing) && (
          <span className={s.trailing}>
            {trailing}
            {isPassword && (
              <IconButton
                icon={reveal ? EyeOff : Eye}
                label={reveal ? 'Ocultar senha' : 'Mostrar senha'}
                size="md"
                onClick={() => setReveal((v) => !v)}
              />
            )}
          </span>
        )}
      </div>
      {help}
    </div>
  )
}
