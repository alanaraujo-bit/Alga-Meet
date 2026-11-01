import s from './misc.module.css'

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  /** Accessible name when there is no visible <label htmlFor>. */
  label?: string
  disabled?: boolean
  id?: string
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={s.switch}
      onClick={() => onChange(!checked)}
    >
      <span className={s.thumb} />
    </button>
  )
}
